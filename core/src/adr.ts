/**
 * 결정 포인트(ADR) 서브시스템 (§5, 요구 13).
 *
 * 패턴: 시스템 성격 + 사용자 의도 → **추천 패킷**(선택지 2~4 + 트레이드오프 + 추천안)
 * → 사용자 채택 또는 재정의(자유 정의 포함) → `ADR-x` 노드로 영구 기록
 * (선택지·근거·**기각 사유** 포함). ADR 변경 = 정식 개정 = version++ + STALE 전파.
 *
 * 정식 결정 지점은 셋이다(§5 표): P2 기술 스택, P2 운영·배포·확장, P4 디자인 기반.
 * 이 모듈은 그 셋을 하드코딩하지 않는다 — 셋 다 같은 형태(질문·선택지·추천·채택·기각)라
 * 형태만 코어가 강제하고 내용은 스킬·CLI 가 채운다.
 *
 * ## 저장 구조: 원장 색인 + 사이드카 본문
 *
 * 원장 노드 스키마는 `{id,title,parent,doc_anchor,version,status}` 로 고정돼 있다(§3-2).
 * 선택지·기각 사유 같은 결정 본문이 들어갈 자리가 없다. 그렇다고 원장 **밖에** 별도 저장소를
 * 세우면 ADR 이 추적 체인(F-x → 설계 문서 → ADR → 웨이브 → 커밋, §3-7)에서 통째로 빠진다.
 * 그래서 하나의 기록을 둘로 나눠 둔다:
 *
 *  - **원장 노드 `ADR-x`** = 색인이자 추적의 척추. `title`=질문, `version`, `status`.
 *    웨이브 frontmatter 의 `design_refs` 가 참조하는 대상, `harness trace` 가 잡는 대상이
 *    바로 이 노드다. 원장만 보고도 "이 웨이브가 어떤 결정 위에 서 있나"를 답할 수 있다.
 *  - **사이드카 `.harness/design/adr/ADR-x.yaml`** = 본문. 선택지·트레이드오프·추천안·
 *    채택·근거·기각 사유. 개정 시 이전 본문은 `ADR-x.v<N>.yaml` 로 `superseded` 상태로
 *    남는다 — 레지스트리(§3-7)의 "개정 = 새 버전 + 이전 superseded" 와 같은 이력 규칙이다.
 *
 * 색인의 `version` 은 본문의 `version` 과 항상 같다. 어긋나 있으면 개정이 중간에 끊긴 것이다.
 * status 사상: `proposed`→`draft`, `accepted`→`approved`, `superseded`→`stale`.
 *
 * ## 왜 bumpNode 를 쓰지 않는가
 *
 * `bumpNode` 는 원장을 **먼저 쓰고** 참조 웨이브 스캔 결과를 돌려준다. 반면 `adr-revised`
 * 이벤트는 그 스캔 결과(affected·unverifiable)를 실으면서 **모든 쓰기보다 먼저** 기록돼야
 * 한다(events.ts 변이 순서 계약). 두 요구가 동시에 성립하려면 스캔이 읽기 전용이어야 한다 —
 * 그것이 `referencingWaves()` 다. 인정 기준은 bumpNode 와 동일하게 정본 `parseWave` 를 쓴다
 * (API-10 교훈: 스칼라 design_refs 를 부분문자열로 비교하면 `"ADR-10".includes("ADR-1")`
 * 오탐이 난다 — 배열 정규화 후 정확 일치만 인정).
 *
 * **검증 불가는 침묵 스킵이 아니라 보고 대상**(ledger.ts bumpNode 의 교훈) — 읽거나 해석할 수
 * 없어 참조 여부를 판정하지 못한 웨이브는 `unverifiable` 로 돌려준다. 조용히 넘기면 STALE
 * 전파가 뚫린 줄 아무도 모른다.
 *
 * NOTE(배선): 아래 이벤트 타입은 events.ts 의 KNOWN_EVENT_TYPES 에 아직 없다 — CLI 배선 시
 * 'adr-proposed' 'adr-decided' 'adr-revised' 를 등록해야 doctor 가 "미지 이벤트 타입 →
 * 재생 불신" 경고를 내지 않는다. 또한 §5 의 "ADR 변경 = **backtrack** + STALE 전파" 중
 * backtrack 발동은 CLI 의 몫이다 — reviseAdr 는 STALE 전파까지만 책임진다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { designDir, wavesDir } from './paths';
import { tr } from './tr';
import { pick, DEFAULT_LANG, type Lang, type Msg } from './i18n';
import { appendEvent } from './events';
import { getNode, upsertNode } from './ledger';
import { parseWave, markStale } from './wave';
import type { LedgerNode, Phase, WaveMeta } from './types';

export const adrDir = (root: string) => path.join(designDir(root), 'adr');
export const adrPath = (root: string, id: string) => path.join(adrDir(root), `${id}.yaml`);
/** 개정 이력 — 이전 본문을 superseded 로 얼려 둔다. */
const adrHistoryPath = (root: string, id: string, version: number) =>
  path.join(adrDir(root), `${id}.v${version}.yaml`);

export interface AdrOption {
  id: string;
  title: string;
  pros: string[];
  cons: string[];
}

export interface AdrRejection {
  id: string;
  reason: string;
}

export interface AdrRecord {
  id: string;
  phase: Phase;
  question: string;
  options: AdrOption[];
  recommended?: string;
  /** 채택된 선택지 id. 자유 정의로 재정의한 경우 'custom'. */
  chosen?: string;
  rationale?: string;
  rejected: AdrRejection[];
  status: 'proposed' | 'accepted' | 'superseded';
  version: number;
}

/** 자유 정의(재정의) 채택을 담는 합성 선택지 id — 기록이 스스로를 설명하도록. */
const CUSTOM_OPTION_ID = 'custom';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

// ── 저장 ───────────────────────────────────────────────────────────────────

function writeAdrFile(target: string, rec: AdrRecord): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, YAML.stringify(rec));
  fs.renameSync(tmp, target); // 같은 디렉토리 내 rename = POSIX 원자적
}

/** 관용 해석: 필수 필드가 성립하면 정규화한 AdrRecord, 아니면 null. */
function toAdrRecord(v: unknown): AdrRecord | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (typeof o.question !== 'string') return null;
  if (typeof o.version !== 'number' || !Number.isFinite(o.version)) return null;
  if (o.status !== 'proposed' && o.status !== 'accepted' && o.status !== 'superseded') return null;
  const options: AdrOption[] = (Array.isArray(o.options) ? o.options : [])
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map(e => ({
      id: String(e.id ?? ''),
      title: String(e.title ?? ''),
      pros: Array.isArray(e.pros) ? e.pros.map(String) : [],
      cons: Array.isArray(e.cons) ? e.cons.map(String) : [],
    }));
  const rejected: AdrRejection[] = (Array.isArray(o.rejected) ? o.rejected : [])
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map(e => ({ id: String(e.id ?? ''), reason: String(e.reason ?? '') }));
  const rec: AdrRecord = {
    id: o.id,
    phase: o.phase as Phase,
    question: o.question,
    options,
    rejected,
    status: o.status,
    version: o.version,
  };
  if (typeof o.recommended === 'string' && o.recommended) rec.recommended = o.recommended;
  if (typeof o.chosen === 'string' && o.chosen) rec.chosen = o.chosen;
  if (typeof o.rationale === 'string' && o.rationale) rec.rationale = o.rationale;
  return rec;
}

export function getAdr(root: string, id: string): AdrRecord | undefined {
  const p = adrPath(root, id);
  if (!fs.existsSync(p)) return undefined;
  // 파싱 손상은 조용히 삼키지 않는다(원장 loadLedger 와 같은 태도) — 호출측에서 시끄럽게.
  const parsed = toAdrRecord(YAML.parse(fs.readFileSync(p, 'utf8')));
  if (!parsed) throw new Error(tr(root, { en: `The body of ADR record ${id} is damaged: ${p} — restore it from git history`, ko: `ADR 기록 ${id} 의 본문이 손상됐다: ${p} — git 이력에서 복원하라` }));
  return parsed;
}

/** 깨진 사이드카는 목록 조회를 죽이지 않는다(wave.ts listWaves 와 같은 관용). 이력 파일은 제외. */
export function listAdrs(root: string): AdrRecord[] {
  const dir = adrDir(root);
  if (!fs.existsSync(dir)) return [];
  const out: AdrRecord[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.startsWith('ADR-') || !f.endsWith('.yaml')) continue;
    if (/\.v\d+\.yaml$/.test(f)) continue; // 개정 이력 스냅샷
    try {
      const rec = toAdrRecord(YAML.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      if (rec) out.push(rec);
    } catch {
      continue;
    }
  }
  return out;
}

// ── 검증 ───────────────────────────────────────────────────────────────────

/**
 * 선택지 2~4 강제(§5). 이 가드가 "결정"이 고무도장이 되는 걸 막는다 — 선택지 1개짜리
 * 결정은 결정이 아니라 통보고, 5개 이상은 트레이드오프를 비교한 흔적이 아니라 나열이다.
 */
function assertOptions(root: string, options: AdrOption[], recommended?: string): void {
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    throw new Error(
      tr(root, {
        en: `An ADR needs ${MIN_OPTIONS}–${MAX_OPTIONS} options (currently ${options.length}) — a `
          + 'one-option decision is an announcement, not a decision. Offer comparable alternatives with trade-offs.',
        ko: `ADR 선택지는 ${MIN_OPTIONS}~${MAX_OPTIONS}개여야 한다(현재 ${options.length}개) — `
          + '선택지 하나짜리 결정은 결정이 아니라 통보다. 비교 가능한 대안을 트레이드오프와 함께 제시하라.',
      }),
    );
  }
  if (recommended !== undefined && !options.some(o => o.id === recommended)) {
    throw new Error(
      tr(root, { en: `The recommendation "${recommended}" is not among the options — it must be one of (${options.map(o => o.id).join(', ')})`, ko: `추천안 "${recommended}" 이 선택지에 없다 — 선택지 id 중 하나여야 한다(${options.map(o => o.id).join(', ')})` }),
    );
  }
}

function requireAdr(root: string, id: string): AdrRecord {
  const rec = getAdr(root, id);
  if (!rec) {
    throw new Error(tr(root, { en: `No ADR record ${id} (${adrPath(root, id)}) — propose it first`, ko: `ADR ${id} 기록이 없다 (${adrPath(root, id)}) — 먼저 제안(propose)하라` }));
  }
  return rec;
}

// ── 원장 색인 ───────────────────────────────────────────────────────────────

const INDEX_STATUS: Record<AdrRecord['status'], LedgerNode['status']> = {
  proposed: 'draft',
  accepted: 'approved',
  superseded: 'stale',
};

/** 본문 → 원장 색인 노드. parent·doc_anchor 는 사람이 원장에서 손본 값이므로 보존한다. */
function syncIndex(root: string, rec: AdrRecord): void {
  const prev = getNode(root, rec.id);
  upsertNode(root, {
    id: rec.id,
    title: rec.question,
    parent: prev?.parent,
    doc_anchor: prev?.doc_anchor,
    version: rec.version,
    status: INDEX_STATUS[rec.status],
  });
}

// ── 참조 웨이브 스캔 (읽기 전용) ─────────────────────────────────────────────

/**
 * 이 ADR 을 design_refs 로 참조하며 아직 stale 이 아닌 웨이브 = STALE 전파 대상.
 * 읽기 전용이라 이벤트를 먼저 기록할 수 있다(모듈 헤더 "왜 bumpNode 를 쓰지 않는가" 참조).
 * 판정 자체가 불가능했던 웨이브는 버리지 않고 unverifiable 로 올려 보낸다.
 */
function referencingWaves(root: string, id: string): { affected: string[]; unverifiable: string[] } {
  const affected: string[] = [];
  const unverifiable: string[] = [];
  if (!fs.existsSync(wavesDir(root))) return { affected, unverifiable };
  for (const f of fs.readdirSync(wavesDir(root)).filter(f => /^wave-\d+\.md$/.test(f)).sort()) {
    const stem = f.replace(/\.md$/, '');
    let txt: string;
    try {
      txt = fs.readFileSync(path.join(wavesDir(root), f), 'utf8');
    } catch {
      unverifiable.push(stem); continue; // 읽기 실패 — 참조 여부 판정 불가
    }
    let meta: WaveMeta;
    try {
      meta = parseWave(txt).meta; // 정본 파서 — 스칼라 design_refs 도 배열로 정규화(API-10)
    } catch {
      unverifiable.push(stem); continue;
    }
    if (meta.design_refs.includes(id) && meta.status !== 'stale') affected.push(stem);
  }
  return { affected, unverifiable };
}

// ── 공개 API ────────────────────────────────────────────────────────────────

export interface ProposeAdrInput {
  id: string;
  phase: Phase;
  question: string;
  options: AdrOption[];
  recommended?: string;
}

/** 추천 패킷 제안 — status `proposed`. 사이드카 본문 + 원장 색인을 함께 만든다. */
export function proposeAdr(root: string, input: ProposeAdrInput): AdrRecord {
  if (!input.id.startsWith('ADR-')) {
    throw new Error(tr(root, { en: `An ADR node id must start with "ADR-": "${input.id}" (§3-2 ledger id convention)`, ko: `ADR 노드 id 는 "ADR-" 로 시작해야 한다: "${input.id}" (§3-2 원장 ID 규약)` }));
  }
  if (fs.existsSync(adrPath(root, input.id))) {
    throw new Error(
      tr(root, {
        en: `ADR ${input.id} already exists — do not overwrite a decision. To change it, revise formally `
          + 'with reviseAdr (version++ and STALE propagation).',
        ko: `ADR ${input.id} 가 이미 있다 — 결정을 덮어쓰지 마라. 바꾸려면 reviseAdr 로 정식 개정하라`
          + '(version++ + STALE 전파).',
      }),
    );
  }
  assertOptions(root, input.options, input.recommended);

  const rec: AdrRecord = {
    id: input.id,
    phase: input.phase,
    question: input.question,
    options: input.options,
    ...(input.recommended ? { recommended: input.recommended } : {}),
    rejected: [],
    status: 'proposed',
    version: 1,
  };
  appendEvent(root, 'adr-proposed', {
    id: rec.id, phase: rec.phase, version: rec.version,
    options: rec.options.map(o => o.id), recommended: rec.recommended,
  }); // 순서 계약: 저널 먼저
  writeAdrFile(adrPath(root, rec.id), rec);
  syncIndex(root, rec);
  return rec;
}

export interface DecideAdrInput {
  /** 선택지 id 또는 자유 정의 값(재정의). 자유 정의는 'custom' 선택지로 기록된다. */
  chosen: string;
  rationale: string;
  /** 선택지 id → 기각 사유. 채택되지 않은 **모든** 선택지에 사유가 있어야 한다. */
  rejectedReasons: Record<string, string>;
}

/**
 * 채택 — status `accepted`.
 *
 * 근거와 기각 사유를 **강제**한다. 근거 없는 결정 로그는 반년 뒤 아무 쓸모가 없고,
 * 기각 사유 없는 로그는 "왜 저건 안 했나"라는 가장 비싼 질문에 답하지 못한다(§5).
 */
export function decideAdr(root: string, id: string, input: DecideAdrInput): AdrRecord {
  const prev = requireAdr(root, id);
  if (prev.status !== 'proposed') {
    throw new Error(
      tr(root, {
        en: `ADR ${id} is not proposed (currently ${prev.status}) — a recorded decision cannot be `
          + 'overwritten. Revise it formally (version++ and STALE propagation), then decide again.',
        ko: `ADR ${id} 는 proposed 가 아니다(현재 ${prev.status}) — 기록된 결정을 덮어쓸 수 없다. `
          + 'reviseAdr 로 정식 개정(version++ + STALE 전파)한 뒤 다시 채택하라.',
      }),
    );
  }
  const chosenRaw = input.chosen.trim();
  if (!chosenRaw) throw new Error(tr(root, { en: `The chosen value for ADR ${id} is empty — give an option id or a free-form value`, ko: `ADR ${id} 채택 값이 비어 있다 — 선택지 id 또는 자유 정의 값을 넣어라` }));
  if (!input.rationale.trim()) {
    throw new Error(
      tr(root, {
        en: `ADR ${id} has no rationale — a decision log without one tells the reader nothing six months `
          + 'later. Leave at least one line on why this option won.',
        ko: `ADR ${id} 채택 근거가 없다 — 근거 없는 결정 기록은 반년 뒤 읽는 사람에게 아무 정보도 주지 않는다. `
          + '왜 이 안을 골랐는지 한 줄이라도 남겨라.',
      }),
    );
  }

  // 자유 정의(재정의)는 'custom' 선택지로 흡수해 기록이 스스로를 설명하게 한다(§5).
  const known = prev.options.some(o => o.id === chosenRaw);
  const options = known
    ? prev.options
    : [...prev.options, { id: CUSTOM_OPTION_ID, title: chosenRaw, pros: [], cons: [] }];
  const chosen = known ? chosenRaw : CUSTOM_OPTION_ID;

  const missing: string[] = [];
  const rejected: AdrRejection[] = [];
  for (const o of options) {
    if (o.id === chosen) continue;
    const reason = (input.rejectedReasons[o.id] ?? '').trim();
    if (!reason) { missing.push(o.id); continue; }
    rejected.push({ id: o.id, reason });
  }
  if (missing.length > 0) {
    throw new Error(
      tr(root, {
        en: `Options in ADR ${id} with no rejection reason: ${missing.join(', ')} — a decision log without `
          + 'them cannot answer "why not that one". Give a reason for every option you did not take.',
        ko: `ADR ${id} 의 기각 사유가 빠진 선택지: ${missing.join(', ')} — 기각 사유 없는 결정 로그는 `
          + '"왜 저건 안 했나"에 답하지 못한다. 채택하지 않은 모든 선택지에 사유를 달아라.',
      }),
    );
  }

  const rec: AdrRecord = {
    ...prev,
    options,
    chosen,
    rationale: input.rationale.trim(),
    rejected,
    status: 'accepted',
  };
  appendEvent(root, 'adr-decided', {
    id: rec.id, phase: rec.phase, version: rec.version, chosen: rec.chosen,
    custom: !known, rejected: rec.rejected.map(r => r.id),
  }); // 순서 계약: 저널 먼저
  writeAdrFile(adrPath(root, rec.id), rec);
  syncIndex(root, rec);
  return rec;
}

export interface ReviseAdrInput {
  question?: string;
  options?: AdrOption[];
  recommended?: string;
}

export interface ReviseAdrResult {
  record: AdrRecord;
  /** STALE 마킹한 웨이브 id 들. */
  affectedWaves: string[];
  /** 참조 여부를 **판정하지 못한** 웨이브 — 침묵 스킵이 아니라 보고 대상. */
  unverifiable: string[];
}

/**
 * 정식 개정 — version++, status 를 `proposed` 로 되돌리고, 참조 웨이브에 STALE 을 전파한다.
 * 이전 본문은 `ADR-x.v<N>.yaml` 에 `superseded` 로 얼려 남긴다.
 *
 * 채택·근거·기각 사유는 지운다 — 결정이 다시 열린 상태이지 "예전 결정에 새 선택지가 붙은"
 * 상태가 아니다. 예전 결정은 이력 파일에 그대로 있다.
 */
export function reviseAdr(root: string, id: string, input: ReviseAdrInput): ReviseAdrResult {
  const prev = requireAdr(root, id);
  const options = input.options ?? prev.options;
  const recommended = input.options ? input.recommended : (input.recommended ?? prev.recommended);
  assertOptions(root, options, recommended);

  // 스캔은 읽기 전용 — 그래야 결과를 실은 이벤트를 모든 쓰기보다 먼저 남길 수 있다.
  const { affected, unverifiable } = referencingWaves(root, id);

  const rec: AdrRecord = {
    id: prev.id,
    phase: prev.phase,
    question: input.question ?? prev.question,
    options,
    ...(recommended ? { recommended } : {}),
    rejected: [],
    status: 'proposed',
    version: prev.version + 1,
  };

  appendEvent(root, 'adr-revised', {
    id: rec.id, phase: rec.phase, from: prev.version, to: rec.version,
    affected, unverifiable,
  }); // 순서 계약: 저널 먼저 — 마킹 루프 도중에 죽어도 개정 사실은 남아야 한다

  writeAdrFile(adrHistoryPath(root, id, prev.version), { ...prev, status: 'superseded' });
  writeAdrFile(adrPath(root, id), rec);
  syncIndex(root, rec);
  for (const w of affected) markStale(root, w);

  return { record: rec, affectedWaves: affected, unverifiable };
}

// ── 추천 패킷 렌더 ──────────────────────────────────────────────────────────

const STATUS_LABEL: Record<AdrRecord['status'], Msg> = {
  proposed: { en: 'proposed', ko: '제안됨' },
  accepted: { en: 'accepted', ko: '채택됨' },
  superseded: { en: 'superseded', ko: '대체됨' },
};

const M = {
  status: { en: 'Status', ko: '상태' },
  options: { en: 'Options', ko: '선택지' },
  chosenMark: { en: ' ← chosen', ko: ' ← 채택' },
  recommendedMark: { en: ' ← recommended', ko: ' ← 추천' },
  pros: { en: 'Pros', ko: '장점' },
  cons: { en: 'Cons', ko: '단점' },
  unstated: { en: '(not stated)', ko: '(미기재)' },
  recommendation: { en: 'Recommendation', ko: '추천안' },
  goneFromOptions: { en: '(no longer among the options)', ko: '(선택지에서 사라짐)' },
  decision: { en: 'Decision', ko: '결정' },
  chosen: { en: 'Chosen', ko: '채택' },
  rationale: { en: 'Rationale', ko: '근거' },
  rejectedReasons: { en: 'Rejection reasons', ko: '기각 사유' },
  none: { en: '(none)', ko: '(없음)' },
} satisfies Record<string, Msg>;

/**
 * 사람이 읽고 고르는 화면 — 순수 문자열 빌더(디스크·시각 무접촉).
 * 순수하므로 `root` 가 없다. 언어는 인자로 받고 호출측(cli)이 config 에서 해석해 넘긴다.
 */
export function renderAdrPacket(rec: AdrRecord, lang: Lang = DEFAULT_LANG): string {
  const t = (m: Msg): string => pick(m, lang);
  const L: string[] = [];
  L.push(`# ${rec.id} · ${rec.phase} — ${rec.question}`, '');
  L.push(`- ${t(M.status)}: ${t(STATUS_LABEL[rec.status])} (v${rec.version})`, '');
  L.push(`## ${t(M.options)}`, '');
  for (const o of rec.options) {
    const mark = o.id === rec.chosen ? t(M.chosenMark) : o.id === rec.recommended ? t(M.recommendedMark) : '';
    L.push(`### ${o.title} (\`${o.id}\`)${mark}`);
    L.push(`- ${t(M.pros)}: ${o.pros.length ? o.pros.join(', ') : t(M.unstated)}`);
    L.push(`- ${t(M.cons)}: ${o.cons.length ? o.cons.join(', ') : t(M.unstated)}`, '');
  }
  if (rec.recommended) {
    const r = rec.options.find(o => o.id === rec.recommended);
    L.push(`## ${t(M.recommendation)}`, '', `\`${rec.recommended}\` — ${r ? r.title : t(M.goneFromOptions)}`, '');
  }
  if (rec.chosen) {
    const c = rec.options.find(o => o.id === rec.chosen);
    L.push(`## ${t(M.decision)}`, '');
    L.push(`- ${t(M.chosen)}: \`${rec.chosen}\` — ${c ? c.title : t(M.goneFromOptions)}`);
    L.push(`- ${t(M.rationale)}: ${rec.rationale ?? t(M.unstated)}`);
    L.push(`- ${t(M.rejectedReasons)}:`);
    if (rec.rejected.length === 0) {
      L.push(`  - ${t(M.none)}`);
    } else {
      for (const r of rec.rejected) {
        const o = rec.options.find(x => x.id === r.id);
        L.push(`  - \`${r.id}\`${o ? ` (${o.title})` : ''}: ${r.reason}`);
      }
    }
    L.push('');
  }
  return L.join('\n');
}
