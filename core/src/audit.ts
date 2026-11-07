/**
 * P6 설계 감사 회차 판정 — `.harness/audit/` 의 파일만 읽는 순수 판정이다.
 *
 * 규칙의 정본은 `skills/phase-p6-audit/SKILL.md` 이고, 여기서는 셀 수 있는 것만 잰다:
 *  - 최신 회차의 끝 줄 `HIGH N` 과 지적 표의 HIGH 행 수가 같은가(숫자만 고친 HIGH 0 을 거부한다)
 *  - 네 렌즈 전체 회차가 상한을 넘지 않았는가
 *  - 짧은 재감사의 형식을 갖췄는가
 *  - 처리표가 지적을 한 행씩 덮는가, 심각도를 낮추지 않았는가
 *  - HIGH 를 이월이나 시험 전환으로 옮겨 숫자를 줄이지 않았는가
 *  - 번복 충돌을 오너가 골랐는가, 확정 문장을 개정본에 반영했는가
 *
 * **HIGH 를 옮기는 길은 이렇게 막는다.** HIGH 는 `carried` 로 적을 수 없다. `test-transfer` 로 적은
 * HIGH 는 그 회차에서 열린 채로 남고, 다음 회차의 `## Classification check` 에 `upheld` 가 있어야 닫힌다.
 * `overturned` 면 그 회차의 지적 표에 HIGH 로 다시 있어야 한다. 수정한 쪽은 분류만 제안하고, 판단은
 * 다음 감사자가 한다.
 *
 * **오너 결정에는 별도 승인 경로가 없다.** 처리표의 `owner-accepted`·`owner-decided` 행은 에이전트도
 * 쓸 수 있는 제안일 뿐이다. 그 행은 P6 승인 묶음과 확인 창(슬래시 경로는 `--accept-risk` 거부 문구)에
 * 그대로 실리고, 사람이 P6 을 승인할 때 비로소 효력을 갖는다. 승인 기록은 `gate-approved` 이벤트의
 * `auditAcceptedHighs`·`auditOwnerDecisions` 에 남는다. 전체 감사를 한 회 더 돌리는 결정도 같다:
 * 오너가 `audit_full_round_cap` 을 올리고 정책을 재고정해야 그 값이 쓰인다.
 *
 * **예전 형식은 파일이 아니라 프로젝트 상태로 정한다.** 줄 하나를 빼서 모든 검사를 끌 수 있으면
 * 게이트가 없는 것과 같다(적대 검증 H1 실측). `state.auditFormat.legacyThrough` 이하의 회차만
 * `Audit-Kind:` 없이 읽고, 그 값은 저널의 첫 기록이 정한다(`ensureAuditFormat`).
 *
 * **못 재는 것**: 문서가 고른 `Audit-Kind: short` 가 정말 구조 변경이 아닌지, 지적 내용이 맞는지,
 * 합본이 렌즈 원본의 HIGH 를 빠뜨리지 않았는지, 표와 끝 줄을 함께 고쳐 앞뒤를 맞춘 회차는 코드로
 * 가려내지 못한다. 제출 뒤의 변경은 해시가 잡는다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_CONFIG, loadConfig } from './config';
import { appendEvent } from './events';
import type { Msg } from './i18n';
import { computePolicyHash, pinnedPolicy } from './policy';
import { readState, writeState } from './state';
import { tr } from './tr';
import { listWaves } from './wave';

export const AUDIT_DIR = '.harness/audit';

const SEVERITIES = ['HIGH', 'MED', 'LOW'] as const;
type Severity = (typeof SEVERITIES)[number];

/** 처리표의 결정 값. `accepted`·`owner-decided` 는 문서를 고쳤다는 뜻이라 짧은 재감사가 뒤따른다. */
const DECISIONS = ['accepted', 'not accepted', 'owner-decided', 'owner-accepted', 'carried', 'test-transfer'] as const;
const DOC_CHANGING: readonly string[] = ['accepted', 'owner-decided'];
const NEEDS_REASON: readonly string[] = ['not accepted', 'owner-decided', 'owner-accepted', 'carried', 'test-transfer'];
const NEEDS_LOCATION: readonly string[] = ['carried', 'test-transfer'];

/** 회차 번호는 1 부터다. 0 이나 앞자리 0 은 `legacyThrough: 0` 비교를 지나가므로 위반으로 거부한다. */
const ROUND_FILE_RE = /^audit-r([1-9]\d*)\.md$/u;
const BAD_NUMBER_RE = /^(?:audit|reconcile)-r0\d*\.md$/u;
const APPLICATION_CHECK_RE = /^##\s+Application check$/iu;
/** 표의 구분선(`|---|---|`). */
const TABLE_RULE_RE = /^\|[-:\s|]+\|$/u;

const LENS_TOKENS: ReadonlyArray<RegExp> = [/logical/i, /ambiguity/i, /blockers|feasibility/i, /ux/i];

export interface AuditFinding { id: string; severity: Severity; evidence: string }
interface ReconcileRow { id: string; severity: string; decision: string; appliedAt: string; reason: string }

export interface AuditRound {
  n: number;
  rel: string;
  kind: 'full' | 'short';
  /** `Audit-Kind:` 줄이 있는 새 형식인가. 없으면 예전 회차이고 전체 감사로 센다. */
  labelled: boolean;
  /** 끝 줄의 `HIGH N`. 끝 줄이 그 형식이 아니면 null. */
  high: number | null;
}

export interface AcceptedHigh { round: number; id: string; reason: string }

/** P7~P9 로 넘긴 지적. `token` 을 웨이브 수용 기준에 적으면 RTM 이 그 웨이브와 잇는다. */
export interface CarryItem {
  token: string;
  round: number;
  id: string;
  severity: string;
  decision: 'carried' | 'test-transfer';
  target: string;
  reason: string;
  /** 무엇으로 닫는가. 시험 전환 HIGH 는 적합성 감사의 `holds` 로만 닫힌다. */
  closure: 'wave' | 'conformance';
}

export type AuditNext =
  | 'run-full-audit' | 'fix-and-reaudit' | 'owner-decision' | 'short-reaudit' | 'fix-format' | 'ready';

export interface AuditStatus {
  rounds: AuditRound[];
  fullRounds: number;
  cap: number;
  capReached: boolean;
  /** 최신 회차에서 오너 수용 행이 없는 HIGH. */
  openHighs: string[];
  /** 전 회차의 `owner-accepted` HIGH. P6 승인 때 효력을 갖는다. */
  acceptedHighs: AcceptedHigh[];
  /** 전 회차의 `owner-decided` 행. P6 승인 때 효력을 갖는다. */
  ownerDecisions: AcceptedHigh[];
  /** 다음 감사자가 `upheld` 로 확인한 `test-transfer` HIGH. P6 승인 묶음에 그대로 보인다. */
  transferredHighs: AcceptedHigh[];
  /** 이월 대장 — 처리표의 `carried`·`test-transfer` 행을 모은 것이다. 따로 적는 파일은 없다. */
  carryItems: CarryItem[];
  violations: string[];
  next: AuditNext;
}

interface ParsedRound extends AuditRound {
  text: string;
  /** `## Findings` 절의 지적. 절이 없으면 null. */
  findings: AuditFinding[] | null;
  rows: ReconcileRow[] | null;
  /** 처리표 `## Application check` 의 지적별 결과. 표가 없으면 null. */
  applied: Map<string, 'applied' | 'missing'> | null;
  /** `## Classification check` 의 다음 감사자 판정. */
  classification: Map<string, 'upheld' | 'overturned'>;
  /** `## Reversal conflicts` 의 `RC-` 항목. HIGH 로 세지 않는다. */
  conflicts: string[];
  /** `## Owner re-check needed` 의 항목 줄. */
  rechecks: string[];
}

function tableCells(line: string): string[] | null {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  return t.replace(/^\|/u, '').replace(/\|$/u, '').split(/(?<!\\)\|/u).map(c => c.trim());
}

const plainCell = (c: string): string => c.replace(/[*`]/gu, '').trim();
/** 대소문자를 무시하고 접두로 읽는다(`high`, `HIGH (provisional)`). 글자를 더해 숫자에서 빠지지 못한다. */
const asSeverity = (c: string | undefined): Severity | null => {
  const m = /^(HIGH|MED|LOW)/iu.exec(plainCell(c ?? ''));
  return m ? m[1].toUpperCase() as Severity : null;
};

/** 제목이 맞는 절을 전부 모은다. 렌즈 보고를 절째로 이어 붙여도 뒤 절이 빠지지 않는다. */
function sectionLines(text: string, heading: RegExp): string[] | null {
  let out: string[] | null = null;
  let inside = false;
  for (const line of text.split('\n')) {
    if (/^##\s/u.test(line)) {
      inside = heading.test(line.trim());
      if (inside) out ??= [];
    } else if (inside) out?.push(line);
  }
  return out;
}

function parseFindings(text: string): AuditFinding[] | null {
  const lines = sectionLines(text, /^##\s+Findings\b/iu);
  if (!lines) return null;
  const out: AuditFinding[] = [];
  for (const line of lines) {
    const cells = tableCells(line);
    const severity = asSeverity(cells?.[1]);
    if (cells && severity) out.push({ id: plainCell(cells[0]), severity, evidence: cells[2] ?? '' });
  }
  return out;
}

function parseReconcile(text: string): ReconcileRow[] {
  const out: ReconcileRow[] = [];
  for (const line of text.split('\n')) {
    const cells = tableCells(line);
    if (!cells) continue;
    const severity = asSeverity(cells[1]) ?? (plainCell(cells[1] ?? '') === 'CONFLICT' ? 'CONFLICT' : null);
    if (!severity) continue;
    out.push({
      id: plainCell(cells[0]), severity, decision: plainCell(cells[2] ?? '').toLowerCase(),
      appliedAt: (cells[3] ?? '').trim(), reason: (cells[4] ?? '').trim(),
    });
  }
  return out;
}

function parseApplied(text: string): ParsedRound['applied'] {
  const lines = sectionLines(text, APPLICATION_CHECK_RE);
  if (!lines) return null;
  const out: NonNullable<ParsedRound['applied']> = new Map();
  for (const line of lines) {
    const cells = tableCells(line);
    const result = plainCell(cells?.[cells.length - 1] ?? '').toLowerCase();
    if (!cells || (result !== 'applied' && result !== 'missing')) continue;
    // 한 지적의 확정 문장이 여럿이면 `MED-4.1`·`MED-4.2` 로 적는다. 하나라도 빠지면 그 지적은 빠진 것이다.
    const id = plainCell(cells[0]).replace(/\.\d+$/u, '');
    if (out.get(id) !== 'missing') out.set(id, result);
  }
  return out;
}

function parseClassification(text: string): ParsedRound['classification'] {
  const out: ParsedRound['classification'] = new Map();
  for (const line of sectionLines(text, /^##\s+Classification check$/iu) ?? []) {
    const cells = tableCells(line);
    const verdict = plainCell(cells?.[1] ?? '').toLowerCase();
    if (cells && (verdict === 'upheld' || verdict === 'overturned')) out.set(plainCell(cells[0]), verdict);
  }
  return out;
}

function parseConflicts(text: string): string[] {
  const out: string[] = [];
  for (const line of sectionLines(text, /^##\s+Reversal conflicts$/iu) ?? []) {
    const id = plainCell(tableCells(line)?.[0] ?? '');
    if (/^RC-\S+$/u.test(id)) out.push(id);
  }
  return out;
}

/** 재확인 절의 항목. 표라면 머리글과 구분선을 뺀다. `none`·`없음` 은 항목이 아니다. */
function parseRechecks(text: string): string[] {
  const lines = (sectionLines(text, /^##\s+Owner re-check needed\b/iu) ?? []).map(l => l.trim());
  return lines.filter((l, i) => {
    if (l.startsWith('- ')) return !/^-\s*(?:none\b|없음)/iu.test(l);
    if (!l.startsWith('|') || TABLE_RULE_RE.test(l)) return false;
    return !TABLE_RULE_RE.test(lines[i + 1] ?? '');
  });
}

/**
 * HIGH 의 근거: `경로:줄`, 재현 기록(`repro:`·`재현:`), 또는 줄 번호를 댈 수 없는 시안에 대한
 * UX 노드와 시나리오 단계(`UX-7 · S2-3`). 설계 문서 번호로 줄이는 기존 표기(`02:42`)도 받는다.
 * 노드 id 만 적은 것은 근거로 치지 않는다.
 */
export function hasCheckableEvidence(evidence: string): boolean {
  // 앞에 숫자나 `-` 가 붙거나 맨 앞에 오는 `T12` 는 시각이지 경로가 아니다.
  const isPathLine = [...evidence.matchAll(/([\w./-]*[A-Za-z][\w./-]*):\d+/gu)]
    .some(hit => !/(?:^|[\d-])T\d{1,2}$/u.test(hit[1]));
  // `02:42` 는 시각과 모양이 같아 문서 번호 범위(00~05), 앞 글자, 줄 번호 0, 초 표기로 가른다.
  return isPathLine
    || /(?<![\w:./-])(?<!\d{4}-\d{2}-\d{2}\s)0[0-5]:0*[1-9]\d*\b(?!:)/u.test(evidence)
    || /(?:^|\s)(?:repro|재현)\s*:/iu.test(evidence)
    || /\bUX-\d+\b.*\bS\d+-\d+\b/u.test(evidence);
}

const hasId = (text: string, id: string): boolean => {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}-])${esc}(?![\\p{L}\\p{N}-])`, 'u').test(text);
};

function readRounds(root: string, violations: string[], m: (x: Msg) => string): ParsedRound[] {
  const dir = path.join(root, AUDIT_DIR);
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const rounds: ParsedRound[] = [];
  for (const name of names) {
    if (BAD_NUMBER_RE.test(name)) {
      violations.push(m({
        en: `${AUDIT_DIR}/${name}: round numbers start at 1 and have no leading zero. Rename it.`,
        ko: `${AUDIT_DIR}/${name}: 회차 번호는 1 부터이고 앞자리에 0 을 쓰지 않는다. 이름을 고쳐라.`,
      }));
    }
    const hit = ROUND_FILE_RE.exec(name);
    if (!hit) continue;
    const n = Number(hit[1]);
    const rel = `${AUDIT_DIR}/${name}`;
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
      violations.push(m({ en: `Cannot read ${rel}.`, ko: `${rel} 을 읽을 수 없다.` }));
      text = '';
    }
    const kindLine = /^Audit-Kind:[ \t]*(full|short)[ \t]*$/mu.exec(text);
    const last = text.split('\n').map(l => l.trim()).filter(Boolean).pop() ?? '';
    const highLine = /^HIGH (\d+)$/u.exec(last);
    let rows: ParsedRound['rows'] = null;
    let applied: ParsedRound['applied'] = null;
    try {
      const table = fs.readFileSync(path.join(dir, `reconcile-r${n}.md`), 'utf8');
      rows = parseReconcile(table);
      applied = parseApplied(table);
    } catch { /* 없으면 null */ }
    rounds.push({
      n, rel, text, rows, applied,
      classification: kindLine ? parseClassification(text) : new Map(),
      conflicts: kindLine ? parseConflicts(text) : [],
      rechecks: kindLine ? parseRechecks(text) : [],
      kind: kindLine?.[1] === 'short' ? 'short' : 'full',
      labelled: kindLine !== null,
      high: highLine ? Number(highLine[1]) : null,
      findings: kindLine ? parseFindings(text) : null,
    });
  }
  return rounds.sort((a, b) => a.n - b.n);
}

/** 앞 회차의 시험 전환 판정과 반영 대조를 잰다. */
function checkAgainstPrior(r: ParsedRound, prior: ParsedRound, out: string[], m: (x: Msg) => string): void {
  for (const f of prior.findings ?? []) {
    const row = prior.rows?.find(x => x.id === f.id);
    if (!row) continue;
    if (f.severity === 'HIGH' && row.decision === 'test-transfer') {
      const verdict = r.classification.get(f.id);
      if (!verdict) {
        out.push(m({
          en: `${r.rel}: HIGH ${f.id} was moved to testing in the previous round, but \`## Classification check\` has no upheld or overturned row for it.`,
          ko: `${r.rel}: 앞 회차에서 시험으로 옮긴 HIGH ${f.id} 의 upheld·overturned 행이 \`## Classification check\` 에 없다.`,
        }));
      } else if (verdict === 'overturned' && !r.findings?.some(x => x.id === f.id && x.severity === 'HIGH')) {
        out.push(m({
          en: `${r.rel}: the auditor overturned the move of ${f.id}, so it must be a HIGH row in this round's findings table.`,
          ko: `${r.rel}: 감사자가 ${f.id} 의 시험 전환을 뒤집었으므로 이 회차의 지적 표에 HIGH 행으로 있어야 한다.`,
        }));
      }
    }
    if (DOC_CHANGING.includes(row.decision)) {
      const result = prior.applied?.get(f.id);
      const file = `${AUDIT_DIR}/reconcile-r${prior.n}.md`;
      if (result === undefined) {
        out.push(m({
          en: `${file}: \`## Application check\` has no result for ${f.id}. Compare each confirmed sentence with the revised text before the re-audit.`,
          ko: `${file}: \`## Application check\` 에 ${f.id} 의 결과가 없다. 재감사 전에 확정 문장을 개정본과 문장별로 대조하라.`,
        }));
      } else if (result === 'missing') {
        out.push(m({
          en: `${file}: the fix for ${f.id} is marked missing. Apply it${f.severity === 'HIGH' ? '; this HIGH stays open until then' : ''}.`,
          ko: `${file}: ${f.id} 의 수정이 미반영이다. 반영하라${f.severity === 'HIGH' ? '. 그때까지 이 HIGH 는 닫히지 않는다' : ''}.`,
        }));
      }
    }
  }
}

/** 새 형식 회차 하나의 형식과 숫자를 잰다. 예전 회차는 부르지 않는다. */
function checkLabelledRound(r: ParsedRound, prior: ParsedRound | undefined, out: string[], m: (x: Msg) => string): void {
  if (r.high === null) {
    out.push(m({ en: `${r.rel}: the last line must be \`HIGH N\`.`, ko: `${r.rel}: 끝 줄은 \`HIGH N\` 이어야 한다.` }));
  }
  if (r.findings === null) {
    out.push(m({ en: `${r.rel}: there is no \`## Findings\` section.`, ko: `${r.rel}: \`## Findings\` 절이 없다.` }));
  } else if (r.high !== null) {
    const counted = r.findings.filter(f => f.severity === 'HIGH').length;
    if (counted !== r.high) {
      out.push(m({
        en: `${r.rel}: the last line says HIGH ${r.high} but the findings table has ${counted} HIGH row(s). A HIGH leaves the count only by being fixed and re-audited.`,
        ko: `${r.rel}: 끝 줄은 HIGH ${r.high} 인데 지적 표의 HIGH 행은 ${counted}개다. HIGH 는 고치고 재감사해야 숫자에서 빠진다.`,
      }));
    }
  }
  if (prior?.findings) checkAgainstPrior(r, prior, out, m);
  if (r.kind === 'full') {
    const lenses = /^Lenses:(.*)$/mu.exec(r.text)?.[1] ?? '';
    if (!LENS_TOKENS.every(t => t.test(lenses))) {
      out.push(m({
        en: `${r.rel}: a full audit needs a \`Lenses:\` line naming all four lenses (logical coherence, ambiguity, blockers, UX walkthrough).`,
        ko: `${r.rel}: 전체 감사에는 네 렌즈를 모두 적은 \`Lenses:\` 줄이 있어야 한다 (logical coherence, ambiguity, blockers, UX walkthrough).`,
      }));
    }
  } else {
    if (!prior) {
      out.push(m({ en: `${r.rel}: the first round must be a full audit.`, ko: `${r.rel}: 첫 회차는 전체 감사여야 한다.` }));
    }
    if (!/^##\s+New risks/imu.test(r.text)) {
      out.push(m({ en: `${r.rel}: a short re-audit needs a \`## New risks of this revision\` section.`, ko: `${r.rel}: 짧은 재감사에는 \`## New risks of this revision\` 절이 있어야 한다.` }));
    }
    const scope = /^structural change:[ \t]*(yes|no)[ \t]*$/imu.exec(r.text)?.[1]?.toLowerCase();
    if (scope === undefined) {
      out.push(m({ en: `${r.rel}: a short re-audit needs a \`structural change: yes|no\` line from the auditor.`, ko: `${r.rel}: 짧은 재감사에는 감사자가 적은 \`structural change: yes|no\` 줄이 있어야 한다.` }));
    } else if (scope === 'yes') {
      out.push(m({ en: `${r.rel}: the auditor found a structural change, so this revision needs all four lenses.`, ko: `${r.rel}: 감사자가 구조 변경을 확인했으므로 이 개정은 네 렌즈 전체 감사가 필요하다.` }));
    }
  }
  const owed = (prior?.findings ?? [])
    .filter(f => f.severity === 'HIGH')
    .filter(f => prior?.rows?.find(x => x.id === f.id)?.decision !== 'owner-accepted')
    .filter(f => !hasId(r.text, f.id));
  if (owed.length > 0) {
    out.push(m({
      en: `${r.rel}: this round does not mention HIGH finding(s) of the previous round: ${owed.map(f => f.id).join(', ')}.`,
      ko: `${r.rel}: 이 회차가 앞 회차의 HIGH 를 다루지 않았다: ${owed.map(f => f.id).join(', ')}.`,
    }));
  }
}

/** 처리표가 그 회차의 지적을 한 행씩 덮는지 잰다. */
function checkReconcile(r: ParsedRound, out: string[], m: (x: Msg) => string): void {
  const findings = r.findings ?? [];
  const file = `${AUDIT_DIR}/reconcile-r${r.n}.md`;
  for (const id of r.conflicts) {
    const row = r.rows?.find(x => x.id === id);
    if (row?.decision !== 'owner-decided' || !row.reason) {
      out.push(m({
        en: `${r.rel}: reversal conflict ${id} needs the owner's choice. Stop fixing, show both sides, and record it in ${file} as \`owner-decided\` with the reason.`,
        ko: `${r.rel}: 번복 충돌 ${id} 은 오너가 골라야 한다. 수정을 멈추고 양쪽 근거를 보인 뒤 ${file} 에 사유와 함께 \`owner-decided\` 로 적어라.`,
      }));
    }
  }
  if (findings.length === 0) return;
  if (r.rows === null) {
    out.push(m({ en: `${file} is missing: it needs one row per finding of ${r.rel}.`, ko: `${file} 이 없다: ${r.rel} 의 지적마다 한 행이 필요하다.` }));
    return;
  }
  for (const f of findings) {
    const row = r.rows.find(x => x.id === f.id);
    if (!row) {
      out.push(m({ en: `${file}: no row for finding ${f.id}.`, ko: `${file}: 지적 ${f.id} 의 행이 없다.` }));
      continue;
    }
    if (row.severity !== f.severity) {
      out.push(m({
        en: `${file}: ${f.id} is ${f.severity} in the audit but ${row.severity} here. Lowering a severity is not a fix.`,
        ko: `${file}: ${f.id} 는 감사에서 ${f.severity} 인데 여기서는 ${row.severity} 다. 심각도를 낮추는 것은 수정이 아니다.`,
      }));
    }
    if (!(DECISIONS as readonly string[]).includes(row.decision)) {
      out.push(m({
        en: `${file}: ${f.id} has an unknown decision "${row.decision}" (one of ${DECISIONS.join(', ')}).`,
        ko: `${file}: ${f.id} 의 결정 "${row.decision}" 을 알 수 없다 (${DECISIONS.join(', ')} 중 하나).`,
      }));
    } else if (NEEDS_REASON.includes(row.decision) && !row.reason) {
      out.push(m({ en: `${file}: ${f.id} is "${row.decision}" without a reason.`, ko: `${file}: ${f.id} 가 사유 없이 "${row.decision}" 이다.` }));
    }
    if (NEEDS_LOCATION.includes(row.decision) && /^(?:[-—–]*)$/u.test(row.appliedAt)) {
      out.push(m({
        en: `${file}: ${f.id} is "${row.decision}" without a target in the Applied at column (F-x acceptance criterion, P7 scenario or P9 check).`,
        ko: `${file}: ${f.id} 가 "${row.decision}" 인데 반영 위치 칸에 옮긴 곳이 없다 (F-x 수용 기준, P7 시나리오, P9 검증 항목).`,
      }));
    }
    if (f.severity === 'HIGH' && row.decision === 'carried') {
      out.push(m({
        en: `${file}: HIGH ${f.id} cannot be carried over. Only MED and LOW go to the carry-over ledger; only an auditor can change a severity.`,
        ko: `${file}: HIGH ${f.id} 는 이월할 수 없다. 이월 대장에는 MED·LOW 만 들어가고, 심각도는 감사자만 바꾼다.`,
      }));
    }
  }
}

const roundNumbers = (root: string): number[] => {
  try {
    return fs.readdirSync(path.join(root, AUDIT_DIR)).flatMap((f) => {
      const hit = ROUND_FILE_RE.exec(f);
      return hit ? [Number(hit[1])] : [];
    });
  } catch { return []; }
};

/**
 * 판이 없는 프로젝트(이 판 이전에 시작)에 예전 회차의 끝을 한 번 적는다. 세션 시작과 P6 제출·승인이
 * 부른다. 이미 있으면 아무것도 하지 않는다 — 값을 다시 정하는 길은 없고, 재생도 첫 기록을 따른다.
 */
export function ensureAuditFormat(root: string): void {
  const state = readState(root);
  if (state.auditFormat) return;
  const auditFormat = { version: 1 as const, legacyThrough: Math.max(0, ...roundNumbers(root)) };
  appendEvent(root, 'audit-format-pinned', auditFormat);
  writeState(root, { ...state, auditFormat });
}

/** 예전 형식으로 읽어도 되는 마지막 회차. 판이 없으면 아직 적지 않은 것이므로 지금 있는 회차까지다. */
function legacyThrough(root: string): number {
  let pinned: number | undefined;
  try { pinned = readState(root).auditFormat?.legacyThrough; } catch { /* 아래 값을 쓴다 */ }
  return pinned ?? Math.max(0, ...roundNumbers(root));
}

/**
 * 믿을 수 있는 상한. 기본값이 아닌 값은 정책 기준선과 일치할 때만 믿는다. 재고정은 사람 전용이므로
 * 이 대조가 있어야 「상한을 올리는 것이 오너 승인」이 코드로 성립한다. 어긋나면 조용히 기본값을 쓰고,
 * 재고정 요구는 전체 회차가 기본값을 실제로 넘을 때만 낸다. 드리프트 자체는 `doctor` 가 보고한다.
 */
function effectiveCap(root: string): { cap: number; untrusted: number | null } {
  const configured = loadConfig(root).audit_full_round_cap;
  const fallback = DEFAULT_CONFIG.audit_full_round_cap;
  if (configured === fallback) return { cap: fallback, untrusted: null };
  try {
    const pin = pinnedPolicy(root);
    if (pin !== null && pin.hash === computePolicyHash(root).hash) return { cap: configured, untrusted: null };
  } catch { /* 믿지 않는다 */ }
  return { cap: fallback, untrusted: configured };
}

/**
 * 감사 회차 전체를 판정한다. 던지지 않는다.
 * `submittedPaths` 를 주면 판정의 근거가 된 파일이 제출 집합에 들어 있는지도 잰다 — 그래야 승인 뒤의
 * 변경을 해시가 잡는다.
 */
export function auditStatus(root: string, submittedPaths?: string[]): AuditStatus {
  const m = (x: Msg): string => tr(root, x);
  const violations: string[] = [];
  const { cap, untrusted } = effectiveCap(root);
  const rounds = readRounds(root, violations, m);
  const legacyEnd = legacyThrough(root);

  let fullRounds = 0;
  let seenLabelled = false;
  const acceptedHighs: AcceptedHigh[] = [];
  const ownerDecisions: AcceptedHigh[] = [];
  const transferredHighs: AcceptedHigh[] = [];
  const carryItems: CarryItem[] = [];
  rounds.forEach((r, i) => {
    if (r.kind === 'full') fullRounds++;
    if (!r.labelled) {
      if (seenLabelled || r.n > legacyEnd) {
        violations.push(m({
          en: `${r.rel}: there is no \`Audit-Kind:\` line. Only rounds from before this project adopted the format (r${legacyEnd} and earlier) may omit it.`,
          ko: `${r.rel}: \`Audit-Kind:\` 줄이 없다. 이 프로젝트가 형식을 적용하기 전의 회차(r${legacyEnd} 까지)만 생략할 수 있다.`,
        }));
      }
      return;
    }
    seenLabelled = true;
    if (r.kind === 'full' && fullRounds > cap) {
      violations.push(m({
        en: `${r.rel} is full audit number ${fullRounds} but the cap is ${cap}. Another full audit is the owner's decision: raise \`audit_full_round_cap\` in .harness/config.yaml.`,
        ko: `${r.rel} 은 ${fullRounds}번째 전체 감사인데 상한은 ${cap}회다. 전체 감사 추가는 오너의 결정이다: .harness/config.yaml 의 \`audit_full_round_cap\` 을 오너가 올린다.`,
      }));
    }
    checkLabelledRound(r, rounds[i - 1], violations, m);
    checkReconcile(r, violations, m);
    for (const row of r.rows ?? []) {
      if (row.decision === 'owner-decided') ownerDecisions.push({ round: r.n, id: row.id, reason: row.reason });
    }
    for (const f of r.findings ?? []) {
      const row = r.rows?.find(x => x.id === f.id);
      if (!row) continue;
      if (f.severity === 'HIGH' && row.decision === 'owner-accepted') acceptedHighs.push({ round: r.n, id: f.id, reason: row.reason });
      if (row.decision !== 'carried' && row.decision !== 'test-transfer') continue;
      // 다음 감사자가 뒤집은 분류는 대장에 넣지 않는다. 판정 전의 HIGH 는 대장도 승인 묶음도 아직 아니다.
      const verdict = rounds[i + 1]?.classification.get(f.id);
      if (verdict === 'overturned' || (f.severity === 'HIGH' && verdict !== 'upheld')) continue;
      if (f.severity === 'HIGH') transferredHighs.push({ round: r.n, id: f.id, reason: row.reason });
      carryItems.push({
        token: `AUD-r${r.n}-${f.id}`, round: r.n, id: f.id, severity: f.severity,
        decision: row.decision, target: row.appliedAt, reason: row.reason,
        closure: f.severity === 'HIGH' ? 'conformance' : 'wave',
      });
    }
  });

  if (untrusted !== null && fullRounds > cap) {
    violations.push(m({
      en: `audit_full_round_cap is ${untrusted} but the policy files differ from the pinned baseline, so the default ${cap} applies. The owner re-pins with \`HARNESS_ACCEPT_POLICY=1 harness doctor --accept-policy\`.`,
      ko: `audit_full_round_cap 이 ${untrusted} 인데 정책 파일이 고정된 기준선과 달라 기본값 ${cap} 을 쓴다. 오너가 \`HARNESS_ACCEPT_POLICY=1 harness doctor --accept-policy\` 로 재고정해야 한다.`,
    }));
  }
  const capReached = fullRounds >= cap;
  const openHighs: string[] = [];
  const pendingTransfers: string[] = [];
  let next: AuditNext = 'ready';
  const newest = rounds[rounds.length - 1];

  if (!newest) {
    violations.push(m({
      en: `No audit round in ${AUDIT_DIR}/: P6 needs at least one full audit (audit-r1.md).`,
      ko: `${AUDIT_DIR}/ 에 감사 회차가 없다: P6 에는 전체 감사가 한 회 이상 필요하다 (audit-r1.md).`,
    }));
    next = 'run-full-audit';
  } else if (newest.high === null && !newest.labelled) {
    violations.push(m({
      en: `${newest.rel} does not end with \`HIGH N\`, so its result cannot be read. Run a short re-audit in the current format.`,
      ko: `${newest.rel} 이 \`HIGH N\` 으로 끝나지 않아 결과를 읽을 수 없다. 현재 형식으로 짧은 재감사를 돌려라.`,
    }));
    next = 'short-reaudit';
  } else {
    if (newest.labelled) {
      const rows = newest.rows ?? [];
      for (const f of newest.findings ?? []) {
        if (f.severity !== 'HIGH') continue;
        const decision = rows.find(x => x.id === f.id)?.decision;
        if (decision === 'test-transfer') pendingTransfers.push(f.id);
        else if (decision !== 'owner-accepted') openHighs.push(f.id);
        if (!hasCheckableEvidence(f.evidence)) {
          violations.push(m({
            en: `${newest.rel}: HIGH ${f.id} has no checkable evidence (path:line, repro:, or a UX node with a scenario step). Ask the auditor for evidence or a new severity.`,
            ko: `${newest.rel}: HIGH ${f.id} 에 확인할 수 있는 근거가 없다 (경로:줄, 재현:, UX 노드와 시나리오 단계). 감사자에게 근거나 새 판정을 받아라.`,
          }));
        }
      }
      // 재확인은 HIGH 로 세지 않는 대신 실제 오너 결정을 가리켜야 한다. 가리키지 못하면 열린 HIGH 다.
      for (const line of newest.rechecks) {
        const ref = /\br(\d+)\/[`(.]*([^\s:|,`)\]]+)/u.exec(line);
        const id = ref?.[2].replace(/\.+$/u, '');
        const row = ref ? rounds.find(x => x.n === Number(ref[1]))?.rows?.find(x => x.id === id) : undefined;
        if (row?.decision !== 'owner-decided' && row?.decision !== 'owner-accepted') {
          openHighs.push(`re-check without an owner decision (r<N>/<ID>): ${line.slice(0, 80)}`);
        }
      }
    } else if ((newest.high ?? 0) > 0) {
      // 예전 회차에는 읽을 지적 표가 없다. 위험 수용 행 수가 끝 줄을 채우면 닫고, 효력은 같은 승인에서 생긴다.
      const accepted = (newest.rows ?? []).filter(x => x.severity === 'HIGH' && x.decision === 'owner-accepted' && x.reason);
      if (accepted.length >= (newest.high ?? 0)) {
        acceptedHighs.push(...accepted.map(x => ({ round: newest.n, id: x.id, reason: x.reason })));
      } else openHighs.push(`${newest.rel}: HIGH ${newest.high}`);
    }
    // `[rN]` 표시는 그 위치의 문단을 고쳤다는 뜻이다 — 수용 기준으로 옮긴 시험 전환이 여기 든다.
    const changed = (newest.rows ?? []).some(x => DOC_CHANGING.includes(x.decision) || /\[r\d+\]/u.test(x.appliedAt));
    if (openHighs.length > 0) {
      violations.push(m({
        en: `${newest.rel} has open HIGH finding(s): ${openHighs.join(', ')}.`,
        ko: `${newest.rel} 에 열린 HIGH 가 있다: ${openHighs.join(', ')}.`,
      }));
      next = capReached ? 'owner-decision' : 'fix-and-reaudit';
    } else if (pendingTransfers.length > 0) {
      violations.push(m({
        en: `${pendingTransfers.join(', ')} moved to testing but still count as HIGH until the next auditor upholds the move in a short round (audit-r${newest.n + 1}.md).`,
        ko: `시험으로 옮긴 ${pendingTransfers.join(', ')} 는 다음 감사자가 짧은 재감사(audit-r${newest.n + 1}.md)에서 upheld 로 확인할 때까지 HIGH 로 남는다.`,
      }));
      next = 'short-reaudit';
    } else if (changed) {
      violations.push(m({
        en: `reconcile-r${newest.n}.md records document changes after ${newest.rel}. Re-audit the changed paragraphs in a short round (audit-r${newest.n + 1}.md).`,
        ko: `reconcile-r${newest.n}.md 에 ${newest.rel} 뒤의 문서 수정이 적혀 있다. 고친 문단을 짧은 재감사(audit-r${newest.n + 1}.md)로 확인하라.`,
      }));
      next = 'short-reaudit';
    }
  }

  if (newest && submittedPaths) {
    const have = new Set(submittedPaths.map(p => path.normalize(p).split(path.sep).join('/')));
    const needed = [newest.rel, ...rounds.filter(r => r.rows !== null).map(r => `${AUDIT_DIR}/reconcile-r${r.n}.md`)];
    const missing = needed.filter(p => !have.has(p));
    if (missing.length > 0) {
      violations.push(m({
        en: `The P6 submission must include the newest round and every reconciliation table. Missing: ${missing.join(', ')}.`,
        ko: `P6 제출에는 최신 회차와 모든 처리표가 들어가야 한다. 빠진 것: ${missing.join(', ')}.`,
      }));
    }
  }

  if (next === 'ready' && violations.length > 0) next = 'fix-format';
  return {
    rounds: rounds.map(({ n, rel, kind, labelled, high }) => ({ n, rel, kind, labelled, high })),
    fullRounds, cap, capReached, openHighs, acceptedHighs, ownerDecisions, transferredHighs, carryItems, violations, next,
  };
}

/**
 * 적합성 감사(`conformance-rN.md`)가 이 표식을 `holds` 로 판정했는가. 모든 회차를 읽되 같은 표식은
 * 가장 새 판정을 쓴다. 부분 재감사가 표식을 다시 적지 않아도 앞 판정이 남고, `breaks` 는 앞 판정을 덮는다.
 */
function conformanceHolds(root: string): (token: string) => boolean {
  const verdicts: Array<{ cells: string[]; holds: boolean }> = [];
  try {
    const dir = path.join(root, AUDIT_DIR);
    const files = fs.readdirSync(dir).flatMap((f) => {
      const hit = /^conformance-r([1-9]\d*)\.md$/u.exec(f);
      return hit ? [{ f, n: Number(hit[1]) }] : [];
    }).sort((x, y) => x.n - y.n);
    for (const { f } of files) {
      for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
        const cells = tableCells(line);
        const results = (cells ?? []).map(c => plainCell(c).toLowerCase());
        if (cells && (results.includes('holds') || results.includes('breaks'))) {
          verdicts.push({ cells, holds: !results.includes('breaks') });
        }
      }
    }
  } catch { return () => false; /* 못 읽으면 닫힌 것이 없다 */ }
  return (token) => {
    const latest = verdicts.filter(v => v.cells.some(c => hasId(c, token))).pop();
    return latest?.holds ?? false;
  };
}

/**
 * 아직 닫히지 않은 이월·시험 전환 항목. MED·LOW 는 표식을 수용 기준에 담은 웨이브가 완료(done)돼야
 * 닫힌다. 시험 전환 HIGH 는 적합성 감사의 `holds` 로만 닫힌다 — 웨이브 완료에는 검증 기록이 없어
 * 되돌리기 어려운 결함을 문자열 하나로 닫을 수 있기 때문이다(적대 검증 M5 실측).
 * 읽지 못해도 던지지 않는다 — 그때는 전부 빈 항목으로 나오므로 빠뜨리는 쪽으로 틀리지 않는다.
 */
export function carryItemGaps(root: string): CarryItem[] {
  const items = auditStatus(root).carryItems;
  if (items.length === 0) return [];
  let criteria: string[] = [];
  try {
    criteria = listWaves(root).filter(w => w.status === 'done').flatMap(w => w.acceptance);
  } catch { /* 아래에서 전부 빈 항목이 된다 */ }
  const holds = conformanceHolds(root);
  return items.filter(c => (c.closure === 'conformance' ? !holds(c.token) : !criteria.some(a => hasId(a, c.token))));
}

export interface ClosedItems {
  closed: Array<{ round: number; id: string; decision: string; evidence: string; appliedAt: string }>;
  /** 최신 회차에서 수정한 쪽이 옮긴 항목. 다음 감사자가 판정한다. */
  moved: Array<{ round: number; id: string; severity: string; decision: string; reason: string; appliedAt: string }>;
  /** 최신 처리표의 `## Application check` 원문. */
  applicationCheck: string[];
}

/**
 * 감사자에게 넘기는 닫힌 결정. 메인이 베껴 넘기면 `missing` 행을 뺄 수 있으므로 코드가 처리표에서
 * 만든다. 심각도와 회차별 개수, 앞 회차 본문은 싣지 않는다 — 감사자는 흐름을 모른 채 판단한다.
 */
export function auditClosedItems(root: string): ClosedItems {
  const rounds = readRounds(root, [], x => tr(root, x));
  const newest = rounds[rounds.length - 1];
  const out: ClosedItems = { closed: [], moved: [], applicationCheck: [] };
  for (const r of rounds) {
    for (const row of r.rows ?? []) {
      if (r === newest && NEEDS_LOCATION.includes(row.decision)) {
        out.moved.push({ round: r.n, id: row.id, severity: row.severity, decision: row.decision, reason: row.reason, appliedAt: row.appliedAt });
      } else {
        out.closed.push({ round: r.n, id: row.id, decision: row.decision, evidence: row.reason, appliedAt: row.appliedAt });
      }
    }
  }
  if (newest) {
    try {
      const table = fs.readFileSync(path.join(root, AUDIT_DIR, `reconcile-r${newest.n}.md`), 'utf8');
      out.applicationCheck = (sectionLines(table, APPLICATION_CHECK_RE) ?? []).filter(l => l.trim().startsWith('|'));
    } catch { /* 처리표가 없으면 비어 있다 */ }
  }
  return out;
}
