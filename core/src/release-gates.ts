/**
 * 출하 관문 — 출하(P11 배포 · P12 출하 승인, `ship verdict`) 전에 프로젝트가 정한 관문 명령들이
 * **지금 커밋에서** 통과했는지 본다. 보안 점검 · 정적 분석(SonarQube · Semgrep) 같은 것이 관문이다.
 *
 * ## 설정은 프로파일이 한다
 *
 * `profile.yaml` 의 `release_gates:` 가 관문 목록이다(항목마다 `name` · `command` · `required`,
 * 읽기는 `release-gates-spec.ts`). 옛 단일 설정(commands.yaml `release-security-check` +
 * profile.yaml `release_security`)은 `security` 관문 한 개로 바꿔 읽는다 — 목록에 `security` 가
 * 이미 있으면 목록이 이긴다. 옛 설정에서 명령이 있으면 `release_security: optional` 이 아닌 한 필수다
 * (옛 동작 그대로 막는다).
 *
 * | 관문 상태 | 필수 | 필수 아님 |
 * |---|---|---|
 * | 지금 HEAD 에서 통과 | 통과 | 통과 |
 * | 명령 없음 · 기록 없음 · 실패 · 다른 커밋 기록 · 명령 바뀜 · 손상 | 막는다 | 경고만 |
 *
 * 관문이 하나도 없으면 막지 않고 「출하 관문 미설정」 경고만 낸다.
 *
 * ## 다시 묻지 않는다
 *
 * `harness ship gates` 가 관문 명령을 돌리고 관문마다 커밋 · 종료 코드 · 명령을
 * `.harness/ship/release-gates.yaml` 에 남긴다. 같은 커밋 · 같은 명령에서 통과한 관문은 다시 돌리지
 * 않는다. 막을 때는 그 관문만 돌리는 정확한 명령(`harness ship gates --name <이름>`, `security` 는
 * `harness ship security`)을 알려 준다. 옛 기록 `.harness/ship/release-security.yaml` 은 `security`
 * 관문 기록으로 읽는다(새 파일에 `security` 기록이 없을 때만).
 *
 * 판정 함수는 던지지 않는다 — 기록 손상도 사유를 담은 「통과 아님」이다(ship.ts 계약 4 와 같다).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as YAML from 'yaml';
import { harnessDir } from './paths';
import { appendEvent } from './events';
import { loadProfile, commandFor, type Profile } from './profile';
import type { ReleaseGateSpec } from './release-gates-spec';
import { tr } from './tr';

/** 옛 단일 설정의 commands.yaml 키. */
export const RELEASE_SECURITY_KEY = 'release-security-check';
/** 옛 단일 설정을 바꿔 읽은 관문 이름. */
export const SECURITY_GATE = 'security';

export const releaseGatesPath = (root: string) => path.join(harnessDir(root), 'ship', 'release-gates.yaml');
/** 옛 기록 파일(읽기 호환만). */
export const legacySecurityPath = (root: string) => path.join(harnessDir(root), 'ship', 'release-security.yaml');

export interface ReleaseGateRecord {
  command: string;
  commitSha: string;
  exitCode: number;
  /** 명령 출력의 끝부분(사람이 실패 사유를 보도록). 판정에는 쓰지 않는다. */
  outputTail: string;
  recordedAt: string;
}

export type ReleaseGateState =
  | 'passed'        // 지금 HEAD 에서 통과
  | 'unset'         // 명령 없음
  | 'missing'       // 기록 없음
  | 'stale'         // 다른 커밋 기록이거나 명령이 바뀜
  | 'failed'        // 지금 HEAD 에서 실패
  | 'unknown-head'  // HEAD 를 알 수 없음
  | 'unreadable';   // 기록 손상 · 프로파일을 못 읽음

export interface EffectiveGate extends ReleaseGateSpec {
  /** 옛 단일 설정에서 바꿔 읽은 관문인가(안내 문구에 옛 키를 적는다). */
  legacy?: boolean;
}

export interface ReleaseGateStatus {
  name: string;
  state: ReleaseGateState;
  required: boolean;
  /** 필수인데 통과가 아님. */
  blocking: boolean;
  command?: string;
  /** 사람이 읽는 한 줄(무엇을 돌리면 풀리는지까지). */
  message: string;
}

export interface ReleaseGatesStatus {
  gates: ReleaseGateStatus[];
  blocking: ReleaseGateStatus[];
  /** 막지 않는 알림(필수 아닌 관문 미통과 · 관문 미설정). */
  warnings: string[];
}

/** 그 관문만 돌리는 정확한 명령. */
export const gateRunCommand = (name: string): string =>
  name === SECURITY_GATE ? 'harness ship security' : `harness ship gates --name ${name}`;

/** 프로파일의 관문 목록. 옛 단일 설정은 `security` 관문으로 합친다. */
export function releaseGatesConfig(profile: Profile): EffectiveGate[] {
  const list: EffectiveGate[] = (profile.releaseGates ?? []).map(g => ({ ...g }));
  if (list.some(g => g.name === SECURITY_GATE)) return list;
  const command = commandFor(profile, RELEASE_SECURITY_KEY);
  if (!command && profile.releaseSecurity !== 'required') return list;
  const required = command ? profile.releaseSecurity !== 'optional' : true;
  return [{ name: SECURITY_GATE, ...(command ? { command } : {}), required, legacy: true }, ...list];
}

/** 지금 HEAD 커밋. git 저장소가 아니면 null. */
export function headCommit(root: string): string | null {
  try {
    const out = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
    const sha = out.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

function toRecord(root: string, file: string, v: unknown): ReleaseGateRecord {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  if (typeof o.command !== 'string' || typeof o.commitSha !== 'string' || typeof o.exitCode !== 'number') {
    throw new Error(tr(root, {
      en: `${file} is damaged (command · commitSha · exitCode)`,
      ko: `${file} 가 손상됐다(command · commitSha · exitCode)`,
    }));
  }
  return {
    command: o.command, commitSha: o.commitSha, exitCode: o.exitCode,
    outputTail: typeof o.outputTail === 'string' ? o.outputTail : '',
    recordedAt: typeof o.recordedAt === 'string' ? o.recordedAt : '',
  };
}

/** 관문 기록 전체(이름 → 기록 원본). 파일이 손상되면 던진다. */
function readGateFile(root: string): Record<string, unknown> {
  const f = releaseGatesPath(root);
  if (!fs.existsSync(f)) return {};
  const doc = YAML.parse(fs.readFileSync(f, 'utf8')) as { gates?: unknown } | null;
  const gates = doc?.gates;
  if (!gates || typeof gates !== 'object' || Array.isArray(gates)) {
    throw new Error(tr(root, { en: `${f} is damaged (no \`gates\` mapping)`, ko: `${f} 가 손상됐다(\`gates\` 매핑 없음)` }));
  }
  return gates as Record<string, unknown>;
}

/** 관문 하나의 기록. 새 파일에 없고 `security` 면 옛 파일을 읽는다. 손상이면 던진다. */
export function readReleaseGate(root: string, name: string): ReleaseGateRecord | null {
  const gates = readGateFile(root);
  if (Object.prototype.hasOwnProperty.call(gates, name)) return toRecord(root, releaseGatesPath(root), gates[name]);
  if (name !== SECURITY_GATE) return null;
  const old = legacySecurityPath(root);
  if (!fs.existsSync(old)) return null;
  return toRecord(root, old, YAML.parse(fs.readFileSync(old, 'utf8')));
}

/** 관문 결과 1건을 남긴다. 순서: 저널 먼저, 파일은 원자적으로. 손상된 파일은 새로 쓴다. */
export function recordReleaseGate(
  root: string, name: string, rec: Omit<ReleaseGateRecord, 'recordedAt'>,
): ReleaseGateRecord {
  const full: ReleaseGateRecord = { ...rec, recordedAt: new Date().toISOString() };
  appendEvent(root, 'release-gate-recorded', { gate: name, command: rec.command, commitSha: rec.commitSha, exitCode: rec.exitCode });
  let gates: Record<string, unknown> = {};
  try { gates = readGateFile(root); } catch { /* 손상 — 이번 기록부터 다시 쌓는다 */ }
  gates[name] = full;
  const f = releaseGatesPath(root);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, YAML.stringify({ gates }));
  fs.renameSync(tmp, f);
  return full;
}

/** 관문 하나의 판정. 던지지 않는다. */
export function releaseGateStatus(root: string, gate: EffectiveGate, head: string | null): ReleaseGateStatus {
  const { name, command, required } = gate;
  const run = tr(root, { en: `run \`${gateRunCommand(name)}\``, ko: `\`${gateRunCommand(name)}\` 를 돌려라` });
  const tag = required ? '' : tr(root, { en: ' (not required — warning only)', ko: '(필수 아님 — 경고만)' });
  const out = (state: ReleaseGateState, m: { en: string; ko: string }): ReleaseGateStatus => ({
    name, state, required, blocking: required && state !== 'passed',
    ...(command ? { command } : {}), message: `${tr(root, m)}${state === 'passed' ? '' : tag}`,
  });
  if (!command) {
    return gate.legacy
      ? out('unset', {
        en: `release gate \`${name}\` is required but \`${RELEASE_SECURITY_KEY}\` is empty in commands.yaml — set the project's security gate command there (or list it under \`release_gates\` in profile.yaml)`,
        ko: `출하 관문 \`${name}\` 이 필수인데 commands.yaml 의 \`${RELEASE_SECURITY_KEY}\` 가 비어 있다 — 그 프로젝트의 보안 점검 관문 명령을 채워라(또는 profile.yaml \`release_gates\` 에 적어라)`,
      })
      : out('unset', {
        en: `release gate \`${name}\` has no command — set \`command\` under \`release_gates\` in profile.yaml`,
        ko: `출하 관문 \`${name}\` 의 명령이 비어 있다 — profile.yaml \`release_gates\` 의 \`command\` 를 채워라`,
      });
  }
  if (!head) {
    return out('unknown-head', {
      en: `cannot determine the current commit (git rev-parse HEAD) — release gate \`${name}\` results are tied to a commit`,
      ko: `지금 커밋을 알 수 없다(git rev-parse HEAD) — 출하 관문 \`${name}\` 결과는 커밋에 묶인다`,
    });
  }
  let rec: ReleaseGateRecord | null;
  try {
    rec = readReleaseGate(root, name);
  } catch (e) {
    const msg = (e as Error).message;
    return out('unreadable', { en: `release gate \`${name}\`: ${msg} — ${run}`, ko: `출하 관문 \`${name}\`: ${msg} — ${run}` });
  }
  if (!rec) {
    return out('missing', {
      en: `release gate \`${name}\` (${command}) has not been run on this commit — ${run}`,
      ko: `출하 관문 \`${name}\`(${command})을 이 커밋에서 돌린 기록이 없다 — ${run}`,
    });
  }
  if (rec.commitSha !== head || rec.command !== command) {
    return out('stale', {
      en: `release gate \`${name}\` result is for ${rec.commitSha.slice(0, 9)} (\`${rec.command}\`), not the current ${head.slice(0, 9)} (\`${command}\`) — ${run}`,
      ko: `출하 관문 \`${name}\` 결과가 지금 커밋 ${head.slice(0, 9)}(\`${command}\`)가 아니라 ${rec.commitSha.slice(0, 9)}(\`${rec.command}\`) 것이다 — ${run}`,
    });
  }
  if (rec.exitCode !== 0) {
    return out('failed', {
      en: `release gate \`${name}\` failed on this commit (\`${command}\` exit ${rec.exitCode}) — fix what it reports, then ${run}`,
      ko: `출하 관문 \`${name}\` 이 이 커밋에서 실패했다(\`${command}\` 종료 코드 ${rec.exitCode}) — 보고된 항목을 고친 뒤 ${run}`,
    });
  }
  return out('passed', {
    en: `release gate \`${name}\` passed on ${head.slice(0, 9)} (\`${command}\`)`,
    ko: `출하 관문 \`${name}\` 통과 — ${head.slice(0, 9)}(\`${command}\`)`,
  });
}

/** 관문 목록과 프로파일 오류를 함께 준다. 프로파일을 못 읽으면 막는 항목 하나로 바꾼다. */
function gatesOf(root: string, profile?: Profile): { gates: EffectiveGate[]; error?: ReleaseGateStatus } {
  try {
    return { gates: releaseGatesConfig(profile ?? loadProfile(root)) };
  } catch (e) {
    return {
      gates: [],
      error: {
        name: '(profile)', state: 'unreadable', required: true, blocking: true,
        message: tr(root, {
          en: `cannot read the profile to find the release gates: ${(e as Error).message}`,
          ko: `출하 관문 설정을 찾으려고 프로파일을 읽지 못했다: ${(e as Error).message}`,
        }),
      },
    };
  }
}

/**
 * 전체 판정. `head` 와 `profile` 은 시험이 넣을 수 있게 열어 둔다(기본은 실제 값). 던지지 않는다.
 */
export function releaseGatesStatus(
  root: string, opts: { profile?: Profile; head?: string | null } = {},
): ReleaseGatesStatus {
  const { gates, error } = gatesOf(root, opts.profile);
  if (error) return { gates: [error], blocking: [error], warnings: [] };
  if (gates.length === 0) {
    return {
      gates: [], blocking: [],
      warnings: [tr(root, {
        en: 'release gates not configured — list them under `release_gates` in profile.yaml (security · static analysis)',
        ko: '출하 관문 미설정 — profile.yaml 의 `release_gates` 에 관문(보안 점검 · 정적 분석)을 적어라',
      })],
    };
  }
  const head = opts.head === undefined ? headCommit(root) : opts.head;
  const all = gates.map(g => releaseGateStatus(root, g, head));
  return {
    gates: all,
    blocking: all.filter(s => s.blocking),
    warnings: all.filter(s => !s.required && s.state !== 'passed').map(s => s.message),
  };
}

export interface GateRunResult { status: ReleaseGateStatus; ran: boolean; output: string }

/**
 * `harness ship gates` — 관문 명령을 프로젝트 루트에서 돌리고 결과를 남긴다. `name` 이 있으면 그 관문만.
 * 지금 커밋에서 이미 통과한 관문은 돌리지 않는다(`force` 면 다시 돈다). 모르는 이름이면 던진다.
 */
export function runReleaseGates(
  root: string, opts: { name?: string; force?: boolean } = {},
): GateRunResult[] {
  const { gates, error } = gatesOf(root);
  if (error) return [{ status: error, ran: false, output: '' }];
  const picked = opts.name === undefined ? gates : gates.filter(g => g.name === opts.name);
  if (opts.name !== undefined && picked.length === 0) {
    const names = gates.map(g => g.name).join(', ') || '-';
    throw new Error(tr(root, {
      en: `no release gate named \`${opts.name}\` (configured: ${names})`,
      ko: `\`${opts.name}\` 라는 출하 관문이 없다(설정된 관문: ${names})`,
    }));
  }
  const head = headCommit(root);
  return picked.map(g => {
    const before = releaseGateStatus(root, g, head);
    if (!g.command || !head || (before.state === 'passed' && !opts.force)) return { status: before, ran: false, output: '' };
    const r = spawnSync(g.command, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const exitCode = typeof r.status === 'number' ? r.status : 1;
    recordReleaseGate(root, g.name, { command: g.command, commitSha: head, exitCode, outputTail: output.split('\n').slice(-40).join('\n') });
    return { status: releaseGateStatus(root, g, head), ran: true, output };
  });
}
