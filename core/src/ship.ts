/**
 * 출하 트랙(P10 HARDEN · P11 DEPLOY · P12 SHIP) — 결함 대장 · 배포 기록 · go/no-go 판정
 * (스펙 §2 출하 트랙, §3-1, §3-4, §3-7).
 *
 * ## 이 모듈이 하지 않는 것
 *
 * **출하 게이트의 `measured` 강제는 gate.ts 가 이미 한다**(`approveGate`) — 여기서 그 규칙을
 * 다시 구현하지 않는다. 같은 규칙을 두 곳에 두면 언젠가 한쪽만 고쳐지고, 그때 느슨한 쪽이
 * 이긴다. 이 모듈은 그 위에 얹힌다: 게이트가 **열릴 수 있는 상태인지를 미리 판정**해
 * (`shipVerdict`) 사람이 승인 버튼 앞에서 알게 하고, 판정 결과를 P12 체크리스트에 싣는다.
 *
 * 브라우저도 배포 명령도 몰지 않는다 — 실주행은 에이전트, 배포 명령은 프로파일의 몫이다.
 * 코어는 그 결과(증적·커밋 SHA·환경)를 **기록하고 판정**할 뿐이다.
 *
 * ## 저장 구조: 기계 정본 yaml + 렌더 사본 md
 *
 * 스펙 §3-1 은 결함 대장의 자리를 `.harness/ship/readiness.md` 로 못 박았다. 그런데 마크다운
 * 표는 기계가 읽기에 취약하다 — 셀에 `|` 하나가 섞이거나 사람이 열을 하나 지우면 파싱이
 * 어긋나고, **그 어긋남이 "open blocker 0" 으로 보이면 블로커가 실려 나간다.** 그래서 하나의
 * 대장을 둘로 나눠 둔다:
 *
 *  - `.harness/ship/defects.yaml` — **기계 정본.** 판정(`openBlockers`·`shipVerdict`)이 읽는 곳.
 *  - `.harness/ship/readiness.md` — **렌더 사본.** 사람이 읽고 아티팩트로 발행하는 곳.
 *    `addDefect`/`updateDefect` 가 yaml 을 쓴 뒤 매번 다시 찍어낸다. 손으로 고치면 다음 실행이
 *    덮어쓴다(문서 첫머리에 그렇게 적혀 나간다).
 *
 * state.json 이 events.jsonl 의 파생 캐시인 것과 같은 관계다 — 진실은 하나, 나머지는 사본.
 *
 * ## 계약
 *
 *  1. **변이 순서** — 모든 변이는 appendEvent 를 파일 쓰기보다 먼저 한다(events.ts 헤더 계약).
 *  2. **원자적 쓰기** — yaml·md 모두 tmp + rename.
 *  3. **판정에 시계·난수 없음** — `shipVerdict` 는 디스크 내용만으로 결정된다. 같은 입력이면
 *     같은 판정이고, 사유 순서까지 고정이다(결함 등록순 → 게이트 페이즈순 → 웨이브 파일명순).
 *  4. **손상은 삼키지 않는다** — 대장 yaml 이 깨지면 `listDefects` 는 던진다. 관용적으로 빈
 *     배열을 돌려주면 "결함 0건 → 출하 가능" 이 되어 **손상이 곧 통과**가 된다. `shipVerdict` 는
 *     그 예외를 잡아 NO-GO 사유로 바꾼다(판정 함수는 던지지 않는다).
 *
 * NOTE(배선): 아래 이벤트 타입은 events.ts 의 KNOWN_EVENT_TYPES 에 아직 없다 — CLI 배선 시
 * 'defect-added' 'defect-updated' 'deployment-recorded' 를 등록해야 doctor 가 "미지 이벤트 타입
 * → 재생 불신" 경고를 내지 않는다. replayState 는 이 이벤트들을 폴드하지 않는다(state 무변이).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { harnessDir, evidenceDir, wavesDir } from './paths';
import { tr, langFor } from './tr';
import { pick, type Lang, type Msg } from './i18n';
import { appendEvent } from './events';
import { hasMeasuredEvidence } from './evidence';
import { renderRtm } from './report';
import { readState } from './state';
import { parseWave } from './wave';
import { SHIP_PHASES } from './types';
import type { WaveMeta } from './types';

/**
 * 생성 문서(결함 대장·릴리스 체크리스트)의 문자열. 예외 메시지는 `tr(root, …)` 로 바로 가지만
 * 문서 렌더는 줄이 많아 언어를 진입점에서 한 번 해석해 함수로 넘긴다(report.ts 와 같은 형태).
 */
type Tr = (m: Msg) => string;
const trFor = (lang: Lang): Tr => (m: Msg) => pick(m, lang);

// ─────────────────────────────────────────────────────────────────────────────
// 경로 · 모델
// ─────────────────────────────────────────────────────────────────────────────

/** 출하 트랙 산출물 자리(§3-1). paths.ts 를 넓히지 않고 여기 둔다(adr.ts 의 adrDir 과 같은 방식). */
export const shipDir = (root: string) => path.join(harnessDir(root), 'ship');
/** 결함 대장 **기계 정본**. */
export const defectsPath = (root: string) => path.join(shipDir(root), 'defects.yaml');
/** 결함 대장 **렌더 사본**(§3-1 이 지정한 자리). */
export const readinessPath = (root: string) => path.join(shipDir(root), 'readiness.md');
/** 배포 기록(§3-7). */
export const deploymentsPath = (root: string) => path.join(shipDir(root), 'deployments.yaml');

export const DEFECT_SEVERITIES = ['blocker', 'high', 'medium', 'low'] as const;
export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

export const DEFECT_STATUSES = ['open', 'fixed', 'verified', 'deferred'] as const;
export type DefectStatus = (typeof DEFECT_STATUSES)[number];

export interface DefectRecord {
  id: string;
  severity: DefectSeverity;
  /** 한 줄 요약. */
  title: string;
  /** `파일:줄` 또는 재현 명령·증적 경로 — 근거 없는 지적은 발견이 아니라 인상이다. */
  evidence: string;
  status: DefectStatus;
  /** `deferred` 일 때만 존재하며, 그때는 **필수**다. */
  deferReason?: string;
}

export interface DeploymentRecord {
  version: string;
  commitSha: string;
  environment: string;
  /** 스모크·카나리 등 이 배포를 뒷받침하는 증적 참조. */
  evidence: string[];
  recordedAt: string;
}

export interface ShipVerdict {
  ok: boolean;
  /** NO-GO 사유. 전부 구체적이어야 한다 — 무엇을(id·게이트·웨이브) 어떻게 닫는지까지. */
  reasons: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 저수준 IO — 원자적 쓰기 · 손상 불관용 읽기
// ─────────────────────────────────────────────────────────────────────────────

function writeAtomic(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target); // 같은 디렉토리 내 rename = POSIX 원자적
}

/**
 * `{ [key]: [...] }` 형태의 기록 파일을 읽는다. **깨진 파일은 빈 목록이 아니라 예외다** —
 * 출하 판정의 입력에서 손상을 관용하면 손상이 곧 통과가 된다(계약 4).
 */
function readRecords<T>(root: string, file: string, key: string, to: (v: unknown) => T | null): T[] {
  if (!fs.existsSync(file)) return [];
  let doc: unknown;
  try {
    doc = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(tr(root, { en: `Cannot parse ${file}: ${(e as Error).message} — restore it from git history`, ko: `${file} 을 해석할 수 없다: ${(e as Error).message} — git 이력에서 복원하라` }));
  }
  if (doc === null || doc === undefined) return [];
  const list = (doc as Record<string, unknown>)[key];
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) {
    throw new Error(tr(root, { en: `${key} in ${file} is not a list — the file is damaged. Restore it from git history`, ko: `${file} 의 ${key} 가 목록이 아니다 — 파일이 손상됐다. git 이력에서 복원하라` }));
  }
  return list.map((entry, i) => {
    const rec = to(entry);
    if (!rec) {
      throw new Error(tr(root, {
        en: `Cannot parse ${key}[${i}] in ${file} — silently dropping a malformed entry would let the `
          + 'ship verdict pass with a blocker line missing. Fix the entry, or restore from git history',
        ko: `${file} 의 ${key}[${i}] 를 해석할 수 없다 — 형태 불량 항목을 조용히 버리면 `
          + '차단 결함 한 줄이 사라진 채 출하 판정이 통과한다. 항목을 고치거나 git 이력에서 복원하라',
      }));
    }
    return rec;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 결함 대장 (P10)
// ─────────────────────────────────────────────────────────────────────────────

const isSeverity = (v: unknown): v is DefectSeverity =>
  (DEFECT_SEVERITIES as readonly string[]).includes(v as string);
const isStatus = (v: unknown): v is DefectStatus =>
  (DEFECT_STATUSES as readonly string[]).includes(v as string);

function toDefect(v: unknown): DefectRecord | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (typeof o.title !== 'string' || typeof o.evidence !== 'string') return null;
  if (!isSeverity(o.severity) || !isStatus(o.status)) return null;
  const rec: DefectRecord = {
    id: o.id, severity: o.severity, title: o.title, evidence: o.evidence, status: o.status,
  };
  if (typeof o.deferReason === 'string' && o.deferReason) rec.deferReason = o.deferReason;
  return rec;
}

export function listDefects(root: string): DefectRecord[] {
  return readRecords(root, defectsPath(root), 'defects', toDefect);
}

/** yaml(정본) 을 쓰고 readiness.md(사본) 를 다시 찍는다. 순서: 정본 먼저. */
function saveDefects(root: string, defects: DefectRecord[]): void {
  writeAtomic(defectsPath(root), YAML.stringify({ defects }));
  writeAtomic(readinessPath(root), renderLedger(defects, trFor(langFor(root))));
}

/** `deferred` 에는 사유가 **반드시** 있어야 한다 — 조용한 유예가 블로커를 실어 보낸다. */
function assertDeferReason(root: string, rec: DefectRecord): void {
  if (rec.status === 'deferred' && !rec.deferReason) {
    throw new Error(
      tr(root, {
        en: `Deferring needs a reason: ${rec.id} — a deferral without one is concealment, not deferral. `
          + `\`harness ship defect update ${rec.id} --status deferred --defer-reason "<why it can wait>"\``,
        ko: `deferred 로 두려면 사유가 필요하다: ${rec.id} — 사유 없는 유예는 유예가 아니라 은폐다. `
          + `\`harness ship defect update ${rec.id} --status deferred --defer-reason "<왜 지금 안 고쳐도 되는가>"\``,
      }),
    );
  }
}

export interface AddDefectInput {
  id: string;
  severity: DefectSeverity;
  title: string;
  /** `파일:줄` 또는 재현 명령. 비어 있으면 거부된다. */
  evidence: string;
  /** 기본 `open`. */
  status?: DefectStatus;
  deferReason?: string;
}

export function addDefect(root: string, input: AddDefectInput): DefectRecord {
  const id = String(input.id ?? '').trim();
  if (!id) throw new Error(tr(root, { en: 'The defect id is empty — give it a name the ledger can call it by, like `SEC-01`', ko: '결함 id 가 비어 있다 — `SEC-01` 처럼 대장에서 부를 이름을 붙여라' }));
  if (!isSeverity(input.severity)) {
    throw new Error(
      tr(root, { en: `Invalid severity: ${String(input.severity)} (one of ${DEFECT_SEVERITIES.join(', ')})`, ko: `유효하지 않은 심각도: ${String(input.severity)} (${DEFECT_SEVERITIES.join(', ')} 중 하나)` }),
    );
  }
  const status = input.status ?? 'open';
  if (!isStatus(status)) {
    throw new Error(tr(root, { en: `Invalid defect status: ${String(status)} (one of ${DEFECT_STATUSES.join(', ')})`, ko: `유효하지 않은 결함 상태: ${String(status)} (${DEFECT_STATUSES.join(', ')} 중 하나)` }));
  }
  const title = String(input.title ?? '').trim();
  if (!title) throw new Error(tr(root, { en: `Defect ${id} has no one-line summary — pass it with \`--title <one line>\`: say what is wrong in one line`, ko: `결함 ${id} 의 한 줄 요약이 비어 있다 — \`--title <한 줄>\` 로 넘겨라: 무엇이 잘못됐는지 한 줄로 적어라` }));
  const evidence = String(input.evidence ?? '').trim();
  if (!evidence) {
    throw new Error(
      tr(root, {
        en: `Defect ${id} has no evidence — a finding without evidence is an impression, not a finding. `
          + 'Attach `file:line` (`src/auth.ts:88`), a repro command, or an evidence path',
        ko: `결함 ${id} 에 근거가 없다 — 근거 없는 지적은 발견이 아니라 인상이다. `
          + '`파일:줄`(`src/auth.ts:88`) 또는 재현 명령·증적 경로를 달아라',
      }),
    );
  }

  const defects = listDefects(root);
  if (defects.some(d => d.id === id)) {
    throw new Error(
      tr(root, {
        en: `That defect id is already in the ledger: ${id} — two rows with the same id break tracing. `
          + `To change it use \`harness ship defect update ${id}\`; if it is a different defect, give it a different id`,
        ko: `이미 대장에 있는 결함 id 다: ${id} — 같은 id 두 줄은 추적을 무너뜨린다. `
          + `고칠 내용이면 \`harness ship defect update ${id}\` 를 쓰고, 다른 결함이면 다른 id 를 붙여라`,
      }),
    );
  }

  const rec: DefectRecord = {
    id, severity: input.severity, title, evidence, status,
    ...(input.deferReason?.trim() ? { deferReason: input.deferReason.trim() } : {}),
  };
  assertDeferReason(root, rec);

  appendEvent(root, 'defect-added', {
    id: rec.id, severity: rec.severity, status: rec.status, evidence: rec.evidence,
  }); // 순서 계약: 저널 먼저
  saveDefects(root, [...defects, rec]);
  return rec;
}

export interface UpdateDefectInput {
  severity?: DefectSeverity;
  status?: DefectStatus;
  title?: string;
  evidence?: string;
  deferReason?: string;
}

/**
 * 대장 한 줄 갱신. 심각도는 올릴 수도 내릴 수도 있지만(판단은 사람 몫) **열거형 밖 값은
 * 막는다** — CLI 문자열이 그대로 들어오는 자리다.
 *
 * `deferred` 가 아닌 상태로 옮기면 `deferReason` 은 지운다. 다시 열린 결함에 예전 유예 사유가
 * 붙어 있으면 대장을 읽는 사람이 "이건 미뤄도 되는 것" 으로 오독한다.
 */
export function updateDefect(root: string, id: string, patch: UpdateDefectInput): DefectRecord {
  const defects = listDefects(root);
  const i = defects.findIndex(d => d.id === id);
  if (i < 0) {
    throw new Error(
      tr(root, {
        en: `No such defect id in the ledger: ${id} — check ids with \`harness ship defect list\`, `
          + `or register it first with \`harness ship defect add\``,
        ko: `대장에 없는 결함 id 다: ${id} — \`harness ship defect list\` 로 id 를 확인하거나 `
          + `\`harness ship defect add\` 로 먼저 등록하라`,
      }),
    );
  }
  if (patch.severity !== undefined && !isSeverity(patch.severity)) {
    throw new Error(tr(root, { en: `Invalid severity: ${String(patch.severity)} (one of ${DEFECT_SEVERITIES.join(', ')})`, ko: `유효하지 않은 심각도: ${String(patch.severity)} (${DEFECT_SEVERITIES.join(', ')} 중 하나)` }));
  }
  if (patch.status !== undefined && !isStatus(patch.status)) {
    throw new Error(tr(root, { en: `Invalid defect status: ${String(patch.status)} (one of ${DEFECT_STATUSES.join(', ')})`, ko: `유효하지 않은 결함 상태: ${String(patch.status)} (${DEFECT_STATUSES.join(', ')} 중 하나)` }));
  }
  if (patch.evidence !== undefined && !patch.evidence.trim()) {
    throw new Error(tr(root, { en: `Cannot clear the evidence on defect ${id} — without it the row demotes to an impression`, ko: `결함 ${id} 의 근거를 비울 수 없다 — 근거를 지우면 대장 한 줄이 인상으로 내려앉는다` }));
  }
  if (patch.title !== undefined && !patch.title.trim()) {
    throw new Error(tr(root, { en: `Cannot clear the one-line summary of defect ${id}`, ko: `결함 ${id} 의 한 줄 요약을 비울 수 없다` }));
  }

  const prev = defects[i];
  const status = patch.status ?? prev.status;
  const deferReason = (patch.deferReason ?? prev.deferReason ?? '').trim();
  const next: DefectRecord = {
    ...prev,
    severity: patch.severity ?? prev.severity,
    status,
    title: patch.title?.trim() ?? prev.title,
    evidence: patch.evidence?.trim() ?? prev.evidence,
  };
  delete next.deferReason;
  if (status === 'deferred' && deferReason) next.deferReason = deferReason;
  assertDeferReason(root, next);

  appendEvent(root, 'defect-updated', {
    id: next.id, from: prev.status, to: next.status, severity: next.severity,
  }); // 순서 계약: 저널 먼저
  const all = [...defects];
  all[i] = next;
  saveDefects(root, all);
  return next;
}

/** P12 게이트가 비어 있기를 요구하는 목록 — 열린 차단 결함. */
export function openBlockers(root: string): DefectRecord[] {
  return listDefects(root).filter(d => d.severity === 'blocker' && d.status === 'open');
}

// ── 렌더 ────────────────────────────────────────────────────────────────────

/** 표 셀 이스케이프 — 제목에 든 `|` 하나로 표 전체가 무너지지 않게(report.ts 와 같은 규칙). */
const cell = (s: string) => String(s).replace(/\|/g, '\\|');

function ledgerRows(defects: DefectRecord[]): string[] {
  return defects.map(d => [
    '', d.id, d.severity.toUpperCase(), cell(d.title), d.status,
    `\`${cell(d.evidence)}\``, d.deferReason ? cell(d.deferReason) : '—', '',
  ].join(' | ').trim());
}

function renderLedger(defects: DefectRecord[], t: Tr): string {
  const open = defects.filter(d => d.status === 'open');
  const n = (st: DefectRecord['status']) => defects.filter(d => d.status === st).length;
  const blockers = defects.filter(d => d.severity === 'blocker' && d.status === 'open').length;
  const out: string[] = [
    `# ${t({ en: 'Defect ledger', ko: '결함 대장' })} — P10 HARDEN`,
    '',
    t({
      en: 'The source of truth is `.harness/ship/defects.yaml`. This file is a **copy** rendered from it, '
        + 'so do not hand-edit — the next `harness ship defect` run overwrites it.',
      ko: '정본은 `.harness/ship/defects.yaml` 이다. 이 파일은 거기서 렌더한 **사본**이므로 손으로 고치지 마라 —\n'
        + '다음 `harness ship defect` 실행이 덮어쓴다.',
    }),
    '',
    t({
      en: `- open BLOCKER **${blockers}** · open total ${open.length} · fixed ${n('fixed')}`
        + ` · verified ${n('verified')} · deferred ${n('deferred')} · total ${defects.length}`,
      ko: `- open BLOCKER **${blockers}건** · open 전체 ${open.length}건 · fixed ${n('fixed')}건`
        + ` · verified ${n('verified')}건 · deferred ${n('deferred')}건 · 전체 ${defects.length}건`,
    }),
    '',
  ];
  if (defects.length === 0) {
    out.push(
      t({
        en: 'No defect is registered — if the `verifying-production-readiness` audit has not been run, this '
          + 'ledger guarantees nothing. An empty ledger means "not looked at yet", not "no defects".',
        ko: '등록된 결함이 없다 — `verifying-production-readiness` 판정을 아직 돌리지 않았다면 이 대장은\n'
          + '아무것도 보증하지 않는다. 빈 대장은 "결함이 없다"가 아니라 "아직 보지 않았다"이다.',
      }),
      '',
    );
    return out.join('\n');
  }
  out.push(
    t(LEDGER_TABLE_HEAD),
    '|---|---|---|---|---|---|',
    ...ledgerRows(defects),
    '',
  );
  return out.join('\n');
}

const LEDGER_TABLE_HEAD: Msg = {
  en: '| ID | Severity | Summary | Status | Evidence | Deferral reason |',
  ko: '| ID | 심각도 | 한 줄 | 상태 | 근거 | 미룬 사유 |',
};

/** 기계 정본(yaml) → 사람이 읽는 마크다운. `.harness/ship/readiness.md` 의 내용과 같다. */
export function renderDefectLedger(root: string): string {
  return renderLedger(listDefects(root), trFor(langFor(root)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 배포 기록 (P11 · §3-7)
// ─────────────────────────────────────────────────────────────────────────────

function toDeployment(v: unknown): DeploymentRecord | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.version !== 'string' || !o.version) return null;
  if (typeof o.commitSha !== 'string' || !o.commitSha) return null;
  if (typeof o.environment !== 'string' || !o.environment) return null;
  return {
    version: o.version,
    commitSha: o.commitSha,
    environment: o.environment,
    evidence: Array.isArray(o.evidence) ? o.evidence.map(String) : [],
    recordedAt: typeof o.recordedAt === 'string' ? o.recordedAt : '',
  };
}

export function listDeployments(root: string): DeploymentRecord[] {
  return readRecords(root, deploymentsPath(root), 'deployments', toDeployment);
}

export interface RecordDeploymentInput {
  version: string;
  commitSha: string;
  environment: string;
  /** 스모크·카나리 로그·캡처 등 이 배포를 뒷받침하는 증적 참조. */
  evidence?: string[];
}

/**
 * 배포 1건 등록(§3-7). 존재 이유는 로그가 아니라 **역추적**이다 — "이 요구사항이 어느 배포에
 * 실렸나" 에 답하려면 커밋 SHA(무엇이 나갔나) · 버전(어떤 이름으로) · 환경(어디로) ·
 * 증적(무엇으로 확인했나)이 한 줄에 함께 있어야 한다. 그래서 셋 중 하나라도 비면 거부한다.
 */
export function recordDeployment(root: string, input: RecordDeploymentInput): DeploymentRecord {
  const version = String(input.version ?? '').trim();
  const commitSha = String(input.commitSha ?? '').trim();
  const environment = String(input.environment ?? '').trim();
  if (!version) {
    throw new Error(
      tr(root, {
        en: 'The deployment version is empty — release notes need a name to point at, like `v1.2.0` '
          + '(`harness ship deploy --version <v> --sha <commit> --env <env>`)',
        ko: '배포 버전이 비어 있다 — `v1.2.0` 처럼 릴리스 노트가 가리킬 이름이 필요하다 '
          + '(`harness ship deploy --version <버전> --sha <커밋> --env <환경>`)',
      }),
    );
  }
  if (!commitSha) {
    throw new Error(
      tr(root, {
        en: `Deployment ${version} has no commit SHA — without it you cannot trace back "which release `
          + 'carried this requirement" (§3-7). Pass `git rev-parse HEAD` as `--sha`',
        ko: `배포 ${version} 의 커밋 SHA 가 비어 있다 — SHA 없는 배포 기록으로는 "이 요구사항이 어느 배포에 `
          + '실렸나"를 역추적할 수 없다(§3-7). `git rev-parse HEAD` 값을 `--sha` 로 넘겨라',
      }),
    );
  }
  if (!environment) {
    throw new Error(
      tr(root, {
        en: `Deployment ${version} has no environment — say where it went with \`--env\` `
          + '(`production`, `staging`, …). Without it, smoke evidence cannot say which environment it came from',
        ko: `배포 ${version} 의 환경이 비어 있다 — \`production\`·\`staging\` 처럼 어디로 나갔는지 `
          + '`--env` 로 밝혀라. 환경 없는 배포 기록은 스모크 증적이 어느 환경 것인지 말하지 못한다',
      }),
    );
  }
  const evidence = (input.evidence ?? []).map(e => String(e).trim()).filter(Boolean);

  const rec: DeploymentRecord = {
    version, commitSha, environment, evidence,
    // 판정이 아니라 기록이다 — `shipVerdict` 는 이 값을 읽지 않는다(계약 3).
    recordedAt: new Date().toISOString(),
  };
  appendEvent(root, 'deployment-recorded', {
    version, commitSha, environment, evidence,
  }); // 순서 계약: 저널 먼저
  writeAtomic(deploymentsPath(root), YAML.stringify({ deployments: [...listDeployments(root), rec] }));
  return rec;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 출하 판정 (P12 go/no-go)
// ─────────────────────────────────────────────────────────────────────────────

type Safe<T> = { ok: true; value: T } | { ok: false; error: string };

function attempt<T>(fn: () => T): Safe<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 웨이브 식별자는 **파일명 stem** 이다(frontmatter 의 id 가 아니라) — evidence/ 디렉토리가
 * 파일명으로 나뉘므로 meta.id 를 믿으면 남의 증적을 읽는다(report.ts·wave.ts 와 같은 이유).
 * 해석 불가는 침묵 스킵이 아니라 사유로 올린다 — 판정 불가는 통과가 아니다.
 */
function waveEntries(root: string, t: Tr): { entries: { id: string; meta: WaveMeta }[]; unreadable: string[] } {
  const entries: { id: string; meta: WaveMeta }[] = [];
  const unreadable: string[] = [];
  if (!fs.existsSync(wavesDir(root))) return { entries, unreadable };
  let files: string[];
  try {
    files = fs.readdirSync(wavesDir(root));
  } catch (e) {
    return { entries, unreadable: [`${t({ en: 'cannot read the waves directory', ko: '웨이브 디렉토리를 읽을 수 없다' })}: ${(e as Error).message}`] };
  }
  for (const f of files.filter(n => /^wave-\d+\.md$/.test(n)).sort()) {
    const id = f.replace(/\.md$/, '');
    const r = attempt(() => parseWave(fs.readFileSync(path.join(wavesDir(root), f), 'utf8')).meta);
    if (r.ok) entries.push({ id, meta: r.value });
    else {
      unreadable.push(t({
        en: `cannot parse wave ${id}: ${r.error} — being unable to judge evidence is not a pass`,
        ko: `웨이브 ${id} 를 해석할 수 없다: ${r.error} — 증적 판정 불가는 통과가 아니다`,
      }));
    }
  }
  return { entries, unreadable };
}

/**
 * 출하 go/no-go(§2 출하 트랙 · §3-4 · §3-5).
 *
 * NO-GO 사유는 **전부 지목한다** — 어느 결함 id, 어느 게이트, 어느 웨이브인지. "준비 안 됨"
 * 한 줄짜리 판정은 다음 사람이 무엇을 해야 할지 알려주지 않아 아무 쓸모가 없다.
 *
 * `fixed` 인 blocker 도 막는다. 「고쳤다」는 주장이고 **재측정이 관측**이다 — 수정은 다음
 * 결함을 드러내므로, 닫힌 것으로 세려면 `verified` 여야 한다.
 *
 * 던지지 않는다(판정 함수) — 대장·상태 손상도 사유를 담은 NO-GO 다.
 */
export function shipVerdict(root: string): ShipVerdict {
  const t = trFor(langFor(root));
  const reasons: string[] = [];

  // ── 결함 대장 (등록 순서 = 사유 순서)
  const defects = attempt(() => listDefects(root));
  if (!defects.ok) {
    reasons.push(t({
      en: `cannot read the defect ledger: ${defects.error} — an unreadable ledger is not "no defects"`,
      ko: `결함 대장을 읽을 수 없다: ${defects.error} — 대장을 못 읽는 상태는 "결함 없음"이 아니다`,
    }));
  } else {
    for (const d of defects.value) {
      if (d.severity !== 'blocker') continue;
      if (d.status === 'open') {
        reasons.push(t({
          en: `open blocker: ${d.id} ${d.title} (evidence ${d.evidence}) — fix it, re-measure, then close it `
            + `with \`harness ship defect update ${d.id} --status verified\``,
          ko: `열린 차단 결함: ${d.id} ${d.title} (근거 ${d.evidence}) — 수정 후 재측정하고 `
            + `\`harness ship defect update ${d.id} --status verified\` 로 닫아라`,
        }));
      } else if (d.status === 'fixed') {
        reasons.push(t({
          en: `unverified blocker: ${d.id} ${d.title} (fixed) — "fixed" is a claim, re-measurement is the `
            + `observation. Run it again, then raise it with \`harness ship defect update ${d.id} --status verified\``,
          ko: `재측정되지 않은 차단 결함: ${d.id} ${d.title} (fixed) — 「고쳤다」는 주장이고 재측정이 `
            + `관측이다. 다시 돌려 확인한 뒤 \`harness ship defect update ${d.id} --status verified\` 로 올려라`,
        }));
      }
    }
  }

  // ── 게이트 (페이즈 순서)
  const state = attempt(() => readState(root));
  if (!state.ok) {
    reasons.push(t({
      en: `cannot read the state file: ${state.error} — repair it first with \`harness doctor --repair\``,
      ko: `상태 파일을 읽을 수 없다: ${state.error} — \`harness doctor --repair\` 로 먼저 복구하라`,
    }));
  } else {
    for (const phase of ['P10', 'P11'] as const) {
      const g = state.value.gates[phase];
      if (g?.status === 'approved') continue;
      reasons.push(t({
        en: `ship gate not approved: ${phase} (currently: ${g?.status ?? 'pending'}) — run `
          + `\`harness gate submit ${phase} --evidence measured --paths <artifacts>\`, then a human must approve`,
        ko: `출하 게이트 미승인: ${phase} (현재: ${g?.status ?? 'pending'}) — `
          + `\`harness gate submit ${phase} --evidence measured --paths <산출물>\` 뒤 사용자 승인이 필요하다`,
      }));
    }
    for (const phase of SHIP_PHASES) {
      const g = state.value.gates[phase];
      if (!g || g.status === 'pending') continue; // 아직 제출 전 — 위 승인 검사가 이미 말했다
      if (g.evidence !== 'measured') {
        reasons.push(t({
          en: `ship gate ${phase} evidence grade is not measured (currently: ${g.evidence ?? 'none'}) — the ship `
            + 'track passes on measured only (Iron Rule, spec §3-4). Attach real-run evidence and resubmit',
          ko: `출하 게이트 ${phase} 의 근거 등급이 measured 가 아니다 (현재: ${g.evidence ?? '없음'}) — `
            + '출하 트랙은 measured 만 통과한다(Iron Rule, 스펙 §3-4). 실주행·측정 증적을 붙여 재제출하라',
        }));
      }
    }
  }

  // ── UX 참조 웨이브의 실주행 증적 (§3-5: E2E 실주행 증적 없으면 measured 불가)
  const waves = waveEntries(root, t);
  for (const { id, meta } of waves.entries) {
    const ux = meta.design_refs.filter(r => r.startsWith('UX-'));
    if (ux.length === 0) continue;
    if (hasMeasuredEvidence(root, id)) continue;
    reasons.push(t({
      en: `${id} references UX nodes (${ux.join(', ')}) but has no real-run capture — leave headless 2x `
        + `screenshots in ${evidenceDir(root, id)} before claiming measured (§3-5)`,
      ko: `UX 노드(${ux.join(', ')})를 참조하는 ${id} 에 실주행 캡처 증적이 없다 — `
        + `headless 2x 스크린샷을 ${evidenceDir(root, id)} 에 남겨야 measured 를 주장할 수 있다(§3-5)`,
    }));
  }
  reasons.push(...waves.unreadable);

  return { ok: reasons.length === 0, reasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 릴리스 체크리스트 (P12)
// ─────────────────────────────────────────────────────────────────────────────

/** 사람이 읽는 머리글. 어떤 판정도 이 값에 의존하지 않는다(report.ts 와 같은 계약). */
const generatedAt = (t: Tr) => `${t({ en: 'Generated', ko: '생성' })}: ${new Date().toISOString()}`;

/**
 * P12 최종 체크리스트(§2·§3-7) — 판정 · 결함 대장 요약 · 배포 기록 · RTM 첨부.
 *
 * RTM 은 요약해 옮겨 적지 않고 `renderRtm` 출력을 **그대로 첨부**한다(§3-7: "게이트 리뷰 패킷과
 * P12 출하 체크리스트에 첨부"). 옮겨 적는 순간 두 문서가 갈라지고, 갈라지면 느슨한 쪽이 읽힌다.
 */
export function renderReleaseChecklist(root: string): string {
  const t = trFor(langFor(root));
  const verdict = shipVerdict(root);
  const out: string[] = [
    `# ${t({ en: 'Release checklist', ko: '출하 체크리스트' })} — P12 SHIP`, '', generatedAt(t), '',
    `## ${t({ en: 'Verdict', ko: '판정' })}`, '',
  ];

  if (verdict.ok) {
    out.push(
      t({
        en: '**Ready to ship** — every blocking condition below is empty.',
        ko: '**출하 가능** — 아래 차단 조건이 모두 비어 있다.',
      }),
      '',
      t({
        en: '- No open blocker · P10·P11 gates approved · ship gate evidence is measured · UX waves have real-run evidence',
        ko: '- 열린 차단 결함 없음 · P10·P11 게이트 승인 완료 · 출하 게이트 근거 measured · UX 웨이브 실주행 증적 있음',
      }),
      '',
      t({
        en: 'This verdict does not open the gate for you — a human presses `harness gate approve P12`.',
        ko: '이 판정은 게이트를 대신 열지 않는다 — `harness gate approve P12` 는 사람이 누른다.',
      }),
    );
  } else {
    out.push(t({
      en: `**Do not ship** — ${verdict.reasons.length} blocking reason(s). If even one remains, do not ship.`,
      ko: `**출하 불가** — 차단 사유 ${verdict.reasons.length}건. 하나라도 남으면 출하하지 않는다.`,
    }), '');
    out.push(...verdict.reasons.map(r => `- ${r}`));
  }
  out.push('');

  // ── 결함 대장
  out.push(`## ${t({ en: 'Defect ledger', ko: '결함 대장' })}`, '');
  const defects = attempt(() => listDefects(root));
  if (!defects.ok) {
    out.push(`${t({ en: 'cannot read the ledger', ko: '대장을 읽을 수 없다' })}: ${defects.error}`, '');
  } else if (defects.value.length === 0) {
    out.push(t({
      en: 'No defect is registered — if the audit has not been run, this section means "not looked at yet", '
        + 'not "no defects".',
      ko: '등록된 결함이 없다 — 판정을 돌리지 않았다면 이 칸은 "결함 없음"이 아니라 "아직 보지 않았다"이다.',
    }), '');
  } else {
    const openish = defects.value.filter(d => d.status !== 'verified');
    const blockers = defects.value.filter(d => d.severity === 'blocker' && d.status === 'open').length;
    out.push(
      t({
        en: 'Source of truth: `.harness/ship/defects.yaml` · human-readable copy: `.harness/ship/readiness.md`',
        ko: '정본: `.harness/ship/defects.yaml` · 사람이 읽는 사본: `.harness/ship/readiness.md`',
      }),
      '',
      t({
        en: `- total ${defects.value.length} · unclosed (not verified) ${openish.length} · open BLOCKER ${blockers}`,
        ko: `- 전체 ${defects.value.length}건 · 미종결(verified 아님) ${openish.length}건 · open BLOCKER ${blockers}건`,
      }),
      '',
    );
    if (openish.length > 0) {
      out.push(
        t(LEDGER_TABLE_HEAD),
        '|---|---|---|---|---|---|',
        ...ledgerRows(openish),
        '',
      );
    }
  }

  // ── 배포 기록
  out.push(`## ${t({ en: 'Deployment record', ko: '배포 기록' })}`, '');
  const deployments = attempt(() => listDeployments(root));
  if (!deployments.ok) {
    out.push(`${t({ en: 'cannot read the deployment record', ko: '배포 기록을 읽을 수 없다' })}: ${deployments.error}`, '');
  } else if (deployments.value.length === 0) {
    out.push(t({
      en: 'No deployment is recorded — register one in P11 with `harness ship deploy --version <version> '
        + '--sha <commit> --env <environment>`. Without records there is no way to trace which deployment '
        + 'carried a given requirement (§3-7).',
      ko: '배포 기록이 없다 — P11 에서 `harness ship deploy --version <버전> --sha <커밋> --env <환경>` 로\n'
        + '등록하라. 기록이 없으면 "이 요구사항이 어느 배포에 실렸나"를 역추적할 수 없다(§3-7).',
    }), '');
  } else {
    out.push(t({
      en: '| Version | Commit | Environment | Time | Evidence |',
      ko: '| 버전 | 커밋 | 환경 | 시각 | 증적 |',
    }), '|---|---|---|---|---|');
    const noneCell = `**${t({ en: 'none', ko: '없음' })}**`;
    for (const d of deployments.value) {
      out.push(
        `| ${cell(d.version)} | \`${cell(d.commitSha)}\` | ${cell(d.environment)} | ${d.recordedAt || '—'} `
        + `| ${d.evidence.length ? d.evidence.map(cell).join(', ') : noneCell} |`,
      );
    }
    out.push('');
  }

  // ── RTM 첨부
  out.push(`## ${t({
    en: 'Attachment — Requirements Traceability Matrix',
    ko: '첨부 — 요구사항 추적 매트릭스',
  })}`, '');
  const rtm = attempt(() => renderRtm(root));
  out.push(rtm.ok ? rtm.value : `${t({ en: 'cannot generate the RTM', ko: 'RTM 을 생성할 수 없다' })}: ${rtm.error}`);
  return out.join('\n').replace(/\n+$/, '\n');
}
