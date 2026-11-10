/**
 * 릴리스 보안 관문 — 출하(P11 배포 · P12 출하 승인, `ship verdict`) 전에 그 프로젝트의 보안 점검
 * 관문 명령이 **지금 커밋에서** 통과했는지 본다.
 *
 * ## 설정은 프로파일이 한다
 *
 * 관문 명령은 프로젝트마다 다르다(예: P3vot `pnpm security:release-check`). 그래서 코어가 명령을
 * 만들지 않고 프로파일이 준다:
 *
 *  - `commands.yaml` 의 `release-security-check` — 관문 명령. 비면 미설정이다.
 *  - `profile.yaml` 의 `release_security: required` — 필수. 없거나 `optional` 이면 선택이다.
 *
 * | 설정 | 판정 |
 * |---|---|
 * | 명령 없음 · 선택 | 막지 않는다. 「보안 관문 미설정」 경고만 낸다 |
 * | 명령 없음 · 필수 | 막는다 — 프로파일에 명령을 채우라고 알린다 |
 * | 명령 있음 | 지금 HEAD 에서 통과한 기록이 있어야 한다. 없거나 실패면 막고 `harness ship security` 를 알린다 |
 *
 * ## 다시 묻지 않는다
 *
 * `harness ship security` 가 명령을 한 번 돌리고 결과(커밋 · 종료 코드)를
 * `.harness/ship/release-security.yaml` 에 남긴다. 같은 커밋이면 판정은 그 기록을 그대로 쓴다 —
 * 이미 통과한 관문을 승인 때마다 다시 돌리지 않는다. 커밋이 바뀌면 기록은 낡은 것으로 본다.
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
import { tr } from './tr';

/** 관문 명령을 담는 commands.yaml 키. */
export const RELEASE_SECURITY_KEY = 'release-security-check';

export const releaseSecurityPath = (root: string) => path.join(harnessDir(root), 'ship', 'release-security.yaml');

export interface ReleaseSecurityRecord {
  command: string;
  commitSha: string;
  exitCode: number;
  /** 명령 출력의 끝부분(사람이 실패 사유를 보도록). 판정에는 쓰지 않는다. */
  outputTail: string;
  recordedAt: string;
}

export type ReleaseSecurityState =
  | 'passed'          // 지금 HEAD 에서 통과
  | 'unconfigured'    // 명령 없음 · 선택 — 경고만
  | 'required-unset'  // 명령 없음 · 필수 — 막음
  | 'missing'         // 명령 있음 · 기록 없음
  | 'stale'           // 기록이 다른 커밋 것이거나 명령이 바뀜
  | 'failed'          // 지금 HEAD 에서 실패
  | 'unknown-head'    // HEAD 를 알 수 없음
  | 'unreadable';     // 기록 손상

export interface ReleaseSecurityStatus {
  state: ReleaseSecurityState;
  /** 출하를 막는가. */
  blocking: boolean;
  /** 사람이 읽는 한 줄(무엇을 돌리면 풀리는지까지). */
  message: string;
  command?: string;
  required: boolean;
}

/** 프로파일에서 관문 설정을 읽는다. */
export function releaseSecurityConfig(profile: Profile): { command?: string; required: boolean } {
  return { command: commandFor(profile, RELEASE_SECURITY_KEY), required: profile.releaseSecurity === 'required' };
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

export function readReleaseSecurity(root: string): ReleaseSecurityRecord | null {
  const f = releaseSecurityPath(root);
  if (!fs.existsSync(f)) return null;
  const doc = YAML.parse(fs.readFileSync(f, 'utf8')) as Record<string, unknown> | null;
  const o = (doc ?? {}) as Record<string, unknown>;
  if (typeof o.command !== 'string' || typeof o.commitSha !== 'string' || typeof o.exitCode !== 'number') {
    throw new Error(tr(root, {
      en: `${f} is damaged (command · commitSha · exitCode) — run \`harness ship security\` again`,
      ko: `${f} 가 손상됐다(command · commitSha · exitCode) — \`harness ship security\` 를 다시 돌려라`,
    }));
  }
  return {
    command: o.command, commitSha: o.commitSha, exitCode: o.exitCode,
    outputTail: typeof o.outputTail === 'string' ? o.outputTail : '',
    recordedAt: typeof o.recordedAt === 'string' ? o.recordedAt : '',
  };
}

/** 관문 결과 1건을 남긴다. 순서: 저널 먼저, 파일은 원자적으로. */
export function recordReleaseSecurity(root: string, rec: Omit<ReleaseSecurityRecord, 'recordedAt'>): ReleaseSecurityRecord {
  const full: ReleaseSecurityRecord = { ...rec, recordedAt: new Date().toISOString() };
  appendEvent(root, 'release-security-recorded', { command: rec.command, commitSha: rec.commitSha, exitCode: rec.exitCode });
  const f = releaseSecurityPath(root);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, YAML.stringify(full));
  fs.renameSync(tmp, f);
  return full;
}

/**
 * 판정. `head` 와 `profile` 은 시험이 넣을 수 있게 열어 둔다(기본은 실제 값).
 * 던지지 않는다.
 */
export function releaseSecurityStatus(
  root: string,
  opts: { profile?: Profile; head?: string | null } = {},
): ReleaseSecurityStatus {
  let profile: Profile;
  try {
    profile = opts.profile ?? loadProfile(root);
  } catch (e) {
    return {
      state: 'unreadable', blocking: true, required: false,
      message: tr(root, {
        en: `cannot read the profile to find the release security check: ${(e as Error).message}`,
        ko: `릴리스 보안 관문 설정을 찾으려고 프로파일을 읽지 못했다: ${(e as Error).message}`,
      }),
    };
  }
  const { command, required } = releaseSecurityConfig(profile);
  if (!command) {
    return required
      ? {
        state: 'required-unset', blocking: true, required,
        message: tr(root, {
          en: `release security check is required by profile ${profile.name} but \`${RELEASE_SECURITY_KEY}\` is empty in commands.yaml — `
            + 'set the project\'s security gate command there',
          ko: `프로파일 ${profile.name} 이 릴리스 보안 관문을 필수로 켰는데 commands.yaml 의 \`${RELEASE_SECURITY_KEY}\` 가 비어 있다 — `
            + '그 프로젝트의 보안 점검 관문 명령을 채워라',
        }),
      }
      : {
        state: 'unconfigured', blocking: false, required,
        message: tr(root, {
          en: `release security check not configured — set \`${RELEASE_SECURITY_KEY}\` in the profile's commands.yaml `
            + '(and `release_security: required` in profile.yaml to enforce it)',
          ko: `보안 관문 미설정 — 프로파일 commands.yaml 에 \`${RELEASE_SECURITY_KEY}\` 를 채워라`
            + '(강제하려면 profile.yaml 에 `release_security: required`)',
        }),
      };
  }
  const run = tr(root, { en: 'run `harness ship security`', ko: '`harness ship security` 를 돌려라' });
  const head = opts.head === undefined ? headCommit(root) : opts.head;
  if (!head) {
    return {
      state: 'unknown-head', blocking: true, required, command,
      message: tr(root, {
        en: 'cannot determine the current commit (git rev-parse HEAD) — the release security result is tied to a commit',
        ko: '지금 커밋을 알 수 없다(git rev-parse HEAD) — 릴리스 보안 관문 결과는 커밋에 묶인다',
      }),
    };
  }
  let rec: ReleaseSecurityRecord | null;
  try {
    rec = readReleaseSecurity(root);
  } catch (e) {
    return { state: 'unreadable', blocking: true, required, command, message: (e as Error).message };
  }
  if (!rec) {
    return {
      state: 'missing', blocking: true, required, command,
      message: tr(root, {
        en: `release security check (${command}) has not been run on this commit — ${run}`,
        ko: `릴리스 보안 관문(${command})을 이 커밋에서 돌린 기록이 없다 — ${run}`,
      }),
    };
  }
  if (rec.commitSha !== head || rec.command !== command) {
    return {
      state: 'stale', blocking: true, required, command,
      message: tr(root, {
        en: `release security result is for ${rec.commitSha.slice(0, 9)} (\`${rec.command}\`), not the current ${head.slice(0, 9)} (\`${command}\`) — ${run}`,
        ko: `릴리스 보안 관문 결과가 지금 커밋 ${head.slice(0, 9)}(\`${command}\`)가 아니라 ${rec.commitSha.slice(0, 9)}(\`${rec.command}\`) 것이다 — ${run}`,
      }),
    };
  }
  if (rec.exitCode !== 0) {
    return {
      state: 'failed', blocking: true, required, command,
      message: tr(root, {
        en: `release security check failed on this commit (\`${command}\` exit ${rec.exitCode}) — fix what it reports, then ${run}`,
        ko: `릴리스 보안 관문이 이 커밋에서 실패했다(\`${command}\` 종료 코드 ${rec.exitCode}) — 보고된 항목을 고친 뒤 ${run}`,
      }),
    };
  }
  return {
    state: 'passed', blocking: false, required, command,
    message: tr(root, {
      en: `release security check passed on ${head.slice(0, 9)} (\`${command}\`)`,
      ko: `릴리스 보안 관문 통과 — ${head.slice(0, 9)}(\`${command}\`)`,
    }),
  };
}

/**
 * `harness ship security` — 관문 명령을 프로젝트 루트에서 한 번 돌리고 결과를 남긴다.
 * 이미 지금 커밋에서 통과했으면 돌리지 않는다(`force` 면 다시 돈다).
 */
export function runReleaseSecurity(root: string, opts: { force?: boolean } = {}): { status: ReleaseSecurityStatus; ran: boolean; output: string } {
  const before = releaseSecurityStatus(root);
  if (!before.command || before.state === 'unknown-head') return { status: before, ran: false, output: '' };
  if (before.state === 'passed' && !opts.force) return { status: before, ran: false, output: '' };
  const head = headCommit(root) as string;
  const r = spawnSync(before.command, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const exitCode = typeof r.status === 'number' ? r.status : 1;
  recordReleaseSecurity(root, { command: before.command, commitSha: head, exitCode, outputTail: output.split('\n').slice(-40).join('\n') });
  return { status: releaseSecurityStatus(root), ran: true, output };
}
