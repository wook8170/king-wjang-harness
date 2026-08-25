/**
 * 리포트 — 게이트 리뷰 패킷·요구사항 추적 매트릭스(RTM)·프로젝트 허브 (§3-7, §4-3).
 *
 * 네 가지 계약:
 *
 *  (1) **읽기 전용**. 이 모듈은 state 도 저널도 레지스트리도 건드리지 않는다. 문자열(마크다운)과
 *      구조체만 돌려주고 발행·저장·이벤트는 전부 호출측(CLI·에이전트) 책임이다. 리포트를 뽑는
 *      행위가 상태를 바꾸면 "보고서를 만들었더니 게이트가 열렸다"가 가능해진다. packetsDir 은
 *      호출측이 쓸 자리이지 여기서 쓰는 자리가 아니다.
 *
 *  (2) **판정에 시계·난수를 쓰지 않는다.** 본문 머리의 `생성:` 타임스탬프는 사람이 읽는
 *      머리글일 뿐이고, 차단 사항·미커버 판정은 전부 디스크 내용만으로 결정된다 —
 *      같은 입력이면 같은 판정.
 *
 *  (3) **빈 것과 못 읽은 것을 구분해 말한다.** 등록된 산출물이 없으면 그렇다고 적는다.
 *      빈 패킷이 심사를 통과한 패킷처럼 보이면 게이트 전체가 장식이 된다. 원장·상태·
 *      레지스트리·웨이브가 깨져 읽지 못했으면 섹션을 조용히 빼지 않고 "읽지 못한 입력"에
 *      사유와 함께 남긴다 (관용적 스킵은 관측 가능성과 함께 — registry.ts 와 같은 규칙).
 *
 *  (4) **RTM 의 존재 이유는 표가 아니라 구멍이다.** 행마다 `gaps` 에 무엇이 비었는지 문장으로
 *      적는다(설계만 있고 구현 없음 / 구현만 있고 검증 없음 / 문서 없음). 구멍을 드러내지 않는
 *      RTM 은 승인 근거가 아니라 장식이다.
 *
 * 증적 인정 기준은 wave.ts 의 evidenceFiles 와 **같아야 한다** — dot 파일·빈 파일·디렉토리 제외.
 * 디렉토리 제외가 핵심이다: stat.size 는 디렉토리에서도 0 이 아니라 size 만 보면 빈 서브디렉토리
 * 하나로 "검증 있음"이 된다. 그 함수는 wave.ts 비공개라 여기서 같은 규칙을 최소 재현한다 —
 * 기준이 갈리면 RTM 이 완료 게이트와 다른 말을 하게 된다.
 *
 * 웨이브 식별자는 **파일명 stem** 이다(frontmatter 의 id 가 아니라). evidence/ 디렉토리가
 * 파일명으로 나뉘므로 meta.id 를 믿으면 손편집된 웨이브에서 남의 증적을 읽는다
 * (wave.ts writeWave 주석과 같은 이유).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { evidenceDir, wavesDir } from './paths';
import { verifyGate, readGateFeedback, submissionSignals, MIN_SUBSTANCE_CHARS } from './gate';
import { loadLedger, getNode } from './ledger';
import { docsForPhase, inspectRegistry, staleDocs, loadRegistry } from './registry';
import { readState } from './state';
import { readWave, listWaves, isWaveFile } from './wave';
import { PHASES } from './types';
import type { DocNode, LedgerNode, Phase, WaveMeta } from './types';
import { pick, type Lang, type Msg } from './i18n';
import { langFor } from './tr';

/**
 * 이 모듈의 문자열은 **생성 문서에 그대로 실린다**(리뷰 패킷·RTM·허브). 언어는 진입점에서
 * root 로 한 번만 해석해 하위 헬퍼에 함수로 넘긴다 — 줄마다 config 를 다시 읽지 않기 위해서다.
 */
type Tr = (m: Msg) => string;
const trFor = (lang: Lang): Tr => (m: Msg) => pick(m, lang);

/** 세 문서(패킷·RTM·허브)가 함께 쓰는 문장. 한 곳에 두어 번역이 갈리지 않게 한다. */
const MSG = {
  ledgerUnreadable: { en: 'cannot read the design ledger', ko: '설계 원장을 읽을 수 없다' },
  registryUnreadable: { en: 'cannot read the artifact registry', ko: '산출물 레지스트리를 읽을 수 없다' },
  stateUnreadable: { en: 'cannot read the state file', ko: '상태 파일을 읽을 수 없다' },
  unreadableHeading: { en: 'Unread inputs', ko: '읽지 못한 입력' },
  gateStatusHeading: { en: 'Gate status', ko: '게이트 현황' },
  none: { en: 'none', ko: '없음' },
  seeUnreadable: {
    en: 'cannot read the state — see "Unread inputs" below.',
    ko: '상태를 읽지 못해 게이트 현황을 낼 수 없다 — 아래 "읽지 못한 입력" 참조.',
  },
} satisfies Record<string, Msg>;

const GAPS_HEADING: Msg = { en: 'Gaps', ko: '미커버 구간' };
const BLOCKERS_HEADING: Msg = { en: 'Blockers', ko: '차단 사항' };
const AWAITING_PUBLISH: Msg = { en: 'Awaiting publication', ko: '발행 대기' };

/** RTM 한 행 — 요구(F-x) 하나의 전 구간 추적 상태(§3-7). */
export interface RtmRow {
  /** 원장 F- 노드 id */
  id: string;
  title: string;
  version: number;
  status: LedgerNode['status'];
  /** 이 요구를 linkedNodes 로 참조하는 등록 문서(ADR- 제외) */
  docs: string[];
  /** ADR- 문서 + 이 요구를 parent 로 갖는 원장 ADR- 노드 */
  adrs: string[];
  /** design_refs 에 이 요구를 담은 웨이브(파일명 stem) */
  waves: string[];
  /** 그중 실제 증적 파일이 있는 웨이브 */
  evidence: string[];
  /** P11 배포 기록이 채운다(§3-7) — 아직 등록 경로가 없어 항상 빈 배열 */
  deployments: string[];
  /** 미커버 구간 — 비어 있어야 정상이고, 비어 있지 않으면 그것이 이 표의 결론이다 */
  gaps: string[];
}

type Safe<T> = { ok: true; value: T } | { ok: false; error: string };

function attempt<T>(fn: () => T): Safe<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 사람이 읽는 머리글. 어떤 판정도 이 값에 의존하지 않는다(계약 2). */
const generatedAt = (t: Tr) => `${t({ en: 'Generated', ko: '생성' })}: ${new Date().toISOString()}`;

/** 표 셀 이스케이프 — 제목에 든 `|` 하나로 표 전체가 무너지지 않게. */
const cell = (s: string) => s.replace(/\|/g, '\\|');
const listCell = (xs: string[]) => (xs.length ? xs.map(cell).join(', ') : '—');

/**
 * 원장 색인 — getNode 와 같은 규칙(id 첫 일치)이되 한 번만 읽는다.
 * 손상된 원장은 여기서 사유와 함께 잡혀 "읽지 못한 입력"으로 나간다(loadLedger 는 throw 한다).
 */
function ledgerIndex(root: string): Safe<Map<string, LedgerNode>> {
  return attempt(() => {
    const m = new Map<string, LedgerNode>();
    for (const n of loadLedger(root)) {
      if (n && typeof n.id === 'string' && n.id && !m.has(n.id)) m.set(n.id, n);
    }
    return m;
  });
}

/** 페이즈 순서를 보존한 현재 문서 묶음(최신 비-superseded 만). */
function docsByPhase(root: string): { phase: Phase; docs: DocNode[] }[] {
  return PHASES.map(phase => ({ phase, docs: docsForPhase(root, phase) }));
}

function currentDocs(root: string): DocNode[] {
  return docsByPhase(root).flatMap(g => g.docs);
}

/** 파일명 stem 기준 웨이브 목록. 해석 실패는 침묵 스킵이 아니라 보고 대상이다. */
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
  for (const f of files.filter(isWaveFile).sort()) {
    const id = f.replace(/\.md$/, '');
    const r = attempt(() => readWave(root, id).meta);
    if (r.ok) entries.push({ id, meta: r.value });
    else unreadable.push(`${t({ en: `cannot parse wave ${id}`, ko: `웨이브 ${id} 를 해석할 수 없다` })}: ${r.error}`);
  }
  return { entries, unreadable };
}

/**
 * 증적으로 인정되는 파일이 하나라도 있는가 — wave.ts 의 evidenceFiles 와 같은 기준.
 * dot 파일·빈 파일·**디렉토리** 제외(빈 서브디렉토리로 검증 통과를 만들지 못하게).
 */
function hasEvidence(root: string, waveId: string): boolean {
  const dir = evidenceDir(root, waveId);
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return false;
  }
  return files.some((f) => {
    if (f.startsWith('.')) return false;
    try {
      const st = fs.statSync(path.join(dir, f));
      return st.isFile() && st.size > 0;
    } catch {
      return false; // 끊긴 심볼릭 링크 등 — 셀 수 없는 것은 증적이 아니다
    }
  });
}

/** 미커버 판정 — 스펙 §3-7 이 이름 붙인 구간 그대로. */
function gapsFor(row: RtmRow, t: Tr): string[] {
  const gaps: string[] = [];
  if (row.docs.length === 0 && row.adrs.length === 0) {
    gaps.push(t({
      en: 'no document — no registered artifact covers this requirement',
      ko: '문서 없음 — 이 요구를 다루는 등록 산출물이 없다',
    }));
  }
  if (row.waves.length === 0) {
    gaps.push(t({
      en: 'design only, no implementation — no wave references this requirement in design_refs',
      ko: '설계만 있고 구현 없음 — 이 요구를 design_refs 로 참조하는 웨이브가 없다',
    }));
  } else if (row.evidence.length === 0) {
    gaps.push(t({
      en: `implementation only, no verification — the evidence directory of ${row.waves.join(', ')} is empty`,
      ko: `구현만 있고 검증 없음 — ${row.waves.join(', ')} 의 증적 디렉토리가 비어 있다`,
    }));
  }
  return gaps;
}

interface RtmCollection {
  rows: RtmRow[];
  unreadable: string[];
}

function collectRtm(root: string, t: Tr): RtmCollection {
  const unreadable: string[] = [];
  const idx = ledgerIndex(root);
  if (!idx.ok) {
    // 원장을 못 읽으면 추적할 요구 자체를 셀 수 없다 — 빈 표가 아니라 사유를 낸다.
    return { rows: [], unreadable: [`${t(MSG.ledgerUnreadable)}: ${idx.error}`] };
  }
  const nodes = [...idx.value.values()];
  const reg = inspectRegistry(root);
  if (reg.parseError) unreadable.push(`${t(MSG.registryUnreadable)}: ${reg.parseError}`);
  if (reg.invalid.length > 0) {
    unreadable.push(t({
      en: `${reg.invalid.length} registry entrie(s) are malformed and were dropped from tracing`,
      ko: `레지스트리 엔트리 ${reg.invalid.length}건이 형태 불량이라 추적에서 빠졌다`,
    }));
  }
  const docs = currentDocs(root);
  const waves = waveEntries(root, t);
  unreadable.push(...waves.unreadable);

  const rows: RtmRow[] = [];
  for (const node of nodes) {
    if (!node.id.startsWith('F-')) continue;
    const linked = docs.filter(d => d.linkedNodes.includes(node.id));
    const waveIds = waves.entries
      .filter(w => w.meta.design_refs.includes(node.id)) // 배열 멤버십 = 정확 일치(부분문자열 오탐 없음)
      .map(w => w.id);
    const row: RtmRow = {
      id: node.id,
      title: typeof node.title === 'string' && node.title ? node.title : t({ en: '(untitled)', ko: '(제목 없음)' }),
      version: typeof node.version === 'number' ? node.version : 0,
      status: node.status,
      docs: linked.filter(d => !d.id.startsWith('ADR-')).map(d => d.id),
      adrs: [...new Set([
        ...linked.filter(d => d.id.startsWith('ADR-')).map(d => d.id),
        ...nodes.filter(n => n.id.startsWith('ADR-') && n.parent === node.id).map(n => n.id),
      ])].sort(),
      waves: waveIds,
      evidence: waveIds.filter(id => hasEvidence(root, id)),
      deployments: [],
      gaps: [],
    };
    row.gaps = gapsFor(row, t);
    rows.push(row);
  }
  return { rows, unreadable };
}

export function buildRtm(root: string): RtmRow[] {
  return collectRtm(root, trFor(langFor(root))).rows;
}

/** 미커버 요약 — 허브와 RTM 이 같은 문장을 쓴다. */
function gapLines(rows: RtmRow[], t: Tr): string[] {
  const holed = rows.filter(r => r.gaps.length > 0);
  if (rows.length === 0) {
    return [`- ${t({
      en: 'the ledger has no requirement (F-) node to trace — the RTM guarantees nothing yet',
      ko: '추적할 요구(F-) 노드가 원장에 없다 — RTM 은 아직 아무것도 보증하지 않는다',
    })}`];
  }
  if (holed.length === 0) {
    return [`- ${t({
      en: 'no gaps — every requirement has a document, a wave, and evidence',
      ko: '미커버 구간 없음 — 모든 요구가 문서·웨이브·증적을 갖췄다',
    })}`];
  }
  return holed.map(r => `- **${r.id}** ${r.title}: ${r.gaps.join(' / ')}`);
}

function unreadableSection(unreadable: string[], t: Tr): string[] {
  if (unreadable.length === 0) return [];
  return [
    '',
    `## ${t(MSG.unreadableHeading)}`,
    '',
    t({
      en: 'The inputs below could not be read (corrupt or missing). They are absent from this report, '
        + 'which is **not the same as not existing.**',
      ko: '아래는 손상·부재로 읽지 못한 입력이다. 리포트에서 빠졌으므로 **없는 것과 다르다.**',
    }),
    ...unreadable.map(u => `- ${u}`),
  ];
}

export function renderRtm(root: string): string {
  const t = trFor(langFor(root));
  const { rows, unreadable } = collectRtm(root, t);
  const out: string[] = [
    `# ${t({ en: 'Requirements Traceability Matrix (RTM)', ko: '요구사항 추적 매트릭스(RTM)' })}`,
    '', generatedAt(t), '',
  ];

  if (rows.length === 0) {
    out.push(t({
      en: 'The ledger has no F- node — no requirement is registered to trace.',
      ko: '원장에 F- 노드가 없다 — 추적할 요구가 등록되지 않았다.',
    }));
  } else {
    out.push(
      t({
        en: '| Req | Title | Design docs | ADR | Waves | Tests·evidence | Deploys | Gaps |',
        ko: '| 요구 | 제목 | 설계문서 | ADR | 웨이브 | 테스트·증적 | 배포 | 미커버 |',
      }),
      '|---|---|---|---|---|---|---|---|',
      ...rows.map(r => [
        '', r.id, cell(r.title), listCell(r.docs), listCell(r.adrs),
        listCell(r.waves), listCell(r.evidence), listCell(r.deployments),
        r.gaps.length === 0 ? '—' : `**${t({ en: `${r.gaps.length}`, ko: `${r.gaps.length}건` })}**`, '',
      ].join(' | ').trim()),
    );
  }
  out.push('', `## ${t(GAPS_HEADING)}`, '', ...gapLines(rows, t));
  out.push(...unreadableSection(unreadable, t));
  return out.join('\n') + '\n';
}

export interface TraceResult {
  node: LedgerNode;
  waves: WaveMeta[];
  docs: DocNode[];
}

/**
 * FEAT-22: 설계→웨이브→문서 추적(§3-2). 스펙 §125·§200 이 정의하고
 * `agents/wave-verifier.md` 가 검증 절차로 지시하는데 **CLI 에 없었다** — MCP 도구로만
 * 존재해 MCP 없이 에이전트를 돌리면 그 단계가 죽었다.
 * 조인 규칙을 CLI·MCP 두 벌로 두지 않으려고 여기 한 곳에 둔다.
 */
export function traceNode(root: string, id: string): TraceResult | undefined {
  const node = getNode(root, id);
  if (!node) return undefined;
  return {
    node,
    waves: listWaves(root).filter(w => w.design_refs.includes(id)),
    docs: loadRegistry(root).docs.filter(d => d.linkedNodes.includes(id)),
  };
}

/** 게이트 레코드를 사람이 읽는 줄로. 상태 파일을 못 읽으면 사유를 그대로 올린다. */
function gateLines(root: string, phase: Phase, t: Tr): { lines: string[]; unreadable: string[] } {
  const state = attempt(() => readState(root));
  if (!state.ok) return { lines: [], unreadable: [`${t(MSG.stateUnreadable)}: ${state.error}`] };
  const g = state.value.gates[phase];
  if (!g || g.status === 'pending') {
    return {
      lines: [`- ${t({ en: 'Status', ko: '상태' })}: pending — ${t({
        en: 'not submitted yet', ko: '아직 제출되지 않았다',
      })}`],
      unreadable: [],
    };
  }
  const lines = [
    `- ${t({ en: 'Status', ko: '상태' })}: ${g.status} (${t({ en: 'evidence', ko: '근거' })}: ${g.evidence ?? t(MSG.none)})`,
    `- ${t({ en: 'Artifact hash', ko: '산출물 해시' })}: ${g.artifactHash ? g.artifactHash.slice(0, 12) : t(MSG.none)}`,
  ];
  if (g.submittedAt) lines.push(`- ${t({ en: 'Submitted', ko: '제출' })}: ${g.submittedAt}`);
  if (g.approvedAt) lines.push(`- ${t({ en: 'Approved', ko: '승인' })}: ${g.approvedAt}`);
  if (g.invalidatedReason) {
    lines.push(`- ${t({ en: 'Invalidation reason', ko: '무효화 사유' })}: ${g.invalidatedReason}`);
  }
  const verdict = verifyGate(root, phase);
  const label = t({ en: 'Verification', ko: '검증' });
  lines.push(verdict.ok
    ? `- ${label}: PASS`
    : `- ${label}: **FAIL** — ${verdict.reason ?? t({ en: 'no reason given', ko: '사유 없음' })}`);
  return { lines, unreadable: [] };
}

/**
 * 게이트 리뷰 패킷(§4-3) — 산출물 요약 + 연결 설계 노드 + 게이트 현황 + 차단 사항.
 * 승인 심사의 입력이므로 "차단 사항"이 이 문서의 결론이다.
 */
export function buildReviewPacket(root: string, phase: Phase): string {
  const t = trFor(langFor(root));
  const out: string[] = [
    `# ${t({ en: 'Review packet', ko: '리뷰 패킷' })} — ${phase}`, '', generatedAt(t), '',
  ];
  const blockers: string[] = [];
  const unreadable: string[] = [];

  const reg = inspectRegistry(root);
  if (reg.parseError) unreadable.push(`${t(MSG.registryUnreadable)}: ${reg.parseError}`);
  if (reg.invalid.length > 0) {
    unreadable.push(t({
      en: `${reg.invalid.length} registry entrie(s) are malformed and were dropped from this packet`,
      ko: `레지스트리 엔트리 ${reg.invalid.length}건이 형태 불량이라 패킷에서 빠졌다`,
    }));
  }
  const docs = docsForPhase(root, phase);
  const idx = ledgerIndex(root);
  if (!idx.ok) unreadable.push(`${t(MSG.ledgerUnreadable)}: ${idx.error}`);

  out.push(`## ${t({ en: `Artifacts (${docs.length})`, ko: `산출물 (${docs.length}건)` })}`, '');
  if (docs.length === 0) {
    out.push(t({
      en: `**No artifact is registered for ${phase}.** With no document to review this packet is not `
        + 'grounds for approval — register the artifacts, publish them, then regenerate.',
      ko: `**${phase} 에 등록된 산출물이 없다.** 심사할 문서가 없으므로 이 패킷은 승인 근거가 아니다 — `
        + '레지스트리에 산출물을 등록하고 아티팩트를 발행한 뒤 다시 생성하라.',
    }));
    // [UX-116] **없는 강제를 단언하지 않는다.** 예전 문구는 "빈 패킷으로는 게이트를 열 수
    // 없다"였는데 실제로는 `gate approve` 도 `phase set` 도 성공했다. 리뷰어가 「어차피
    // 시스템이 거부한다」고 믿게 만드는 문구는, 그 믿음이 틀렸을 때 승인 한 번을 그냥 통과시킨다.
    // 판단하는 것은 사람이므로 **사람에게 판단 재료와 처방을 준다.**
    blockers.push(t({
      en: `no artifact registered for ${phase} — this packet has nothing to review, so approving it now `
        + 'approves something you have not seen. Register it first: '
        + '`harness doc upsert --id <DOC-x> --phase ' + phase + ' --path <file>`, publish it, then '
        + '`harness doc url <DOC-x> <artifact-url>` and regenerate this packet.',
      ko: `${phase} 에 등록된 산출물이 없다 — 이 패킷에는 심사할 것이 없으므로, 지금 승인하면 `
        + '보지 않은 것을 승인하는 것이다. 먼저 등록하라: '
        + '`harness doc upsert --id <DOC-x> --phase ' + phase + ' --path <파일>` → 발행 → '
        + '`harness doc url <DOC-x> <아티팩트-URL>` 후 이 패킷을 다시 생성하라.',
    }));
  }
  for (const d of docs) {
    out.push(`### ${d.id} v${d.version} — ${d.status}`, `- ${t({ en: 'Path', ko: '경로' })}: \`${d.path}\``);
    const artifactLabel = t({ en: 'Artifact', ko: '아티팩트' });
    if (d.artifactUrl) {
      out.push(`- ${artifactLabel}: ${d.artifactUrl}`);
    } else {
      out.push(`- ${artifactLabel}: **${t({
        en: 'none — an unpublished document cannot go to a gate (requirement 16)',
        ko: '없음 — 발행되지 않은 문서로는 게이트에 올릴 수 없다(요구 16)',
      })}**`);
      blockers.push(t({
        en: `${d.id} has no artifact URL — publish it as a claude.ai artifact and register the URL (requirement 16)`,
        ko: `${d.id} 에 아티팩트 URL 이 없다 — claude.ai 아티팩트로 발행하고 URL 을 등록하라(요구 16)`,
      }));
    }
    out.push(`- ${t({ en: 'Linked nodes', ko: '연결 노드' })}: ${d.linkedNodes.length ? d.linkedNodes.join(', ') : t(MSG.none)}`, '');
  }

  for (const d of staleDocs(root).filter(d => d.phase === phase)) {
    blockers.push(t({
      en: `${d.id} differs from the hash recorded at approval — the current \`${d.path}\` changed; resubmit a revision`,
      ko: `${d.id} 는 승인 시점 해시와 현재 \`${d.path}\` 내용이 다르다 — 개정본으로 재제출하라`,
    }));
  }

  // 원장 노드 — 패킷이 말하는 "원장 diff"의 자리. 버전·상태가 심사 대상 설계의 현재 좌표다.
  const linkedIds = [...new Set(docs.flatMap(d => d.linkedNodes))];
  out.push(`## ${t({ en: 'Design ledger nodes', ko: '설계 원장 노드' })}`, '');
  if (!idx.ok) {
    out.push(t({
      en: 'the ledger could not be read, so linked nodes cannot be checked — see "Unread inputs" below.',
      ko: '원장을 읽지 못해 연결 노드를 확인할 수 없다 — 아래 "읽지 못한 입력" 참조.',
    }), '');
  } else if (linkedIds.length === 0) {
    out.push(t({
      en: 'no ledger node is linked — there is no way to trace which design these artifacts cover.',
      ko: '연결된 원장 노드가 없다 — 이 산출물이 어떤 설계를 다루는지 추적할 수 없다.',
    }), '');
  } else {
    out.push(t({
      en: '| Node | Title | Version | Status |',
      ko: '| 노드 | 제목 | 버전 | 상태 |',
    }), '|---|---|---|---|');
    const stale: LedgerNode[] = [];
    for (const id of linkedIds) {
      const n = idx.value.get(id);
      if (!n) {
        out.push(`| ${id} | **${t({ en: 'not in the ledger', ko: '원장에 없음' })}** | — | — |`);
        blockers.push(t({
          en: `${id} is not in the design ledger — the document references a node that does not exist`,
          ko: `${id} 가 설계 원장에 없다 — 문서가 존재하지 않는 노드를 참조한다`,
        }));
        continue;
      }
      out.push(`| ${n.id} | ${cell(n.title ?? '')} | ${n.version} | ${n.status} |`);
      if (n.status === 'stale') stale.push(n);
    }
    out.push('');
    if (stale.length > 0) {
      out.push(`## ${t({ en: 'STALE warnings', ko: 'STALE 경고' })}`, '');
      for (const n of stale) {
        out.push(t({
          en: `- **${n.id}** ${n.title} (v${n.version}) — the design was revised. `
            + 'Do not approve before confirming the artifacts reflect the revision.',
          ko: `- **${n.id}** ${n.title} (v${n.version}) — 설계가 개정됐다. `
            + '산출물이 개정본을 반영하는지 확인하기 전에는 승인하지 마라.',
        }));
        blockers.push(t({
          en: `${n.id} is STALE — confirm the artifacts reflect the revised design`,
          ko: `${n.id} 가 STALE 이다 — 개정된 설계를 산출물이 반영하는지 확인하라`,
        }));
      }
      out.push('');
    }
  }

  // FEAT-23: 수집된 리뷰 피드백. 개정 근거가 패킷 안에 있어야 「검토 → 코멘트 → 개정 →
  // 재제출」 루프가 채팅 없이 닫힌다. 내용은 수집 시점에 이미 중화됐다.
  const feedback = readGateFeedback(root, phase).trim();
  if (feedback) {
    out.push(`## ${t({ en: 'Review feedback (collected)', ko: '리뷰 피드백 (수집됨)' })}`, '', feedback, '');
  }

  const gate = gateLines(root, phase, t);
  unreadable.push(...gate.unreadable);
  out.push(`## ${t(MSG.gateStatusHeading)}`, '');
  out.push(...(gate.lines.length ? gate.lines : [`- ${t(MSG.seeUnreadable)}`]));
  out.push('');

  /**
   * [SEC-79] **게이트에 실제로 올라간 것**을 사람 앞에 놓는다.
   *
   * 이 절이 없어서 필러 13장이 13게이트를 열고 GO 까지 갔다 — 패킷은 레지스트리에 등록된
   * 문서만 실었고, `gate submit --paths` 로 올라간 경로는 승인자가 읽는 어디에도 없었다.
   * 내용의 **질**은 이 코어가 판정하지 않는다. 대신 **분량·글자 다양성·낱말 수·존재**를 재서
   * 놓는다 — 「80자짜리 13장」은 그 표에서 눈에 띈다. 최종 판단은 사람이 한다(§4-3).
   */
  const sig = submissionSignals(root, phase);
  out.push(`## ${t({ en: 'What was submitted to this gate', ko: '이 게이트에 제출된 것' })}`, '');
  if (!sig) {
    out.push(t({
      en: `Nothing has been submitted to gate ${phase} yet — \`harness gate submit ${phase} --paths <a,b>\`.`,
      ko: `게이트 ${phase} 에 아직 제출된 것이 없다 — \`harness gate submit ${phase} --paths <a,b>\`.`,
    }), '');
  } else {
    out.push(
      `| ${t({ en: 'Path', ko: '경로' })} | ${t({ en: 'chars', ko: '실질 문자' })} `
      + `| ${t({ en: 'distinct', ko: '고유 글자' })} | ${t({ en: 'words', ko: '낱말' })} |`,
      '|---|---:|---:|---:|',
    );
    for (const a of sig.paths) {
      const note = a.missing
        ? ` — **${t({ en: 'unreadable', ko: '읽을 수 없음' })}**`
        : (a.binary ? ` — ${t({ en: 'binary', ko: '바이너리' })}` : '');
      out.push(`| \`${a.rel}\`${note} | ${a.substance} | ${a.distinctChars} | ${a.words} |`);
    }
    out.push('');
    if (sig.nearFloor) {
      out.push(t({
        en: `**These artifacts sit near the floor** (${sig.substance} non-whitespace characters, `
          + `minimum ${MIN_SUBSTANCE_CHARS}; ${sig.distinctChars} distinct letters/digits at most). `
          + 'The core measures size, not quality — open the files before approving.',
        ko: `**이 제출물은 최소치 근처다** (공백 제외 ${sig.substance}자, 최소치 ${MIN_SUBSTANCE_CHARS}자 · `
          + `고유 글자 최대 ${sig.distinctChars}종). 코어가 재는 것은 분량이지 질이 아니다 — `
          + '승인 전에 파일을 직접 열어 보라.',
      }), '');
    }
    for (const a of sig.paths.filter(x => x.missing)) {
      blockers.push(t({
        en: `${a.rel} was submitted to ${phase} but cannot be read now — the gate would approve a file that is not there`,
        ko: `${a.rel} 은 ${phase} 에 제출됐으나 지금 읽을 수 없다 — 없는 파일에 승인 도장이 찍힌다`,
      }));
    }
  }

  out.push(`## ${t(BLOCKERS_HEADING)}`, '');
  out.push(...(blockers.length === 0
    ? [t({
      en: 'No blockers — approval review can proceed on the artifacts above.',
      ko: '차단 사항 없음 — 위 산출물 기준으로 승인 심사를 진행할 수 있다.',
    })]
    : blockers.map(b => `- ${b}`)));
  out.push(...unreadableSection(unreadable, t));
  return out.join('\n') + '\n';
}

/**
 * 프로젝트 허브(§3-7) — 전 산출물의 현재 링크·상태 + 게이트 현황 + RTM 미커버 요약.
 * 사용자는 이 아티팩트 URL 하나만 북마크하면 전 문서에 도달한다.
 */
export function buildHub(root: string): string {
  const t = trFor(langFor(root));
  const out: string[] = [`# ${t({ en: 'Project hub', ko: '프로젝트 허브' })}`, '', generatedAt(t), ''];
  const unreadable: string[] = [];

  const reg = inspectRegistry(root);
  if (reg.parseError) unreadable.push(`${t(MSG.registryUnreadable)}: ${reg.parseError}`);
  if (reg.invalid.length > 0) {
    unreadable.push(t({
      en: `${reg.invalid.length} registry entrie(s) are malformed and were dropped from this index`,
      ko: `레지스트리 엔트리 ${reg.invalid.length}건이 형태 불량이라 목차에서 빠졌다`,
    }));
  }
  const groups = docsByPhase(root);
  const all = groups.flatMap(g => g.docs);

  out.push(`## ${t({ en: 'Artifacts by phase', ko: '페이즈별 산출물' })}`, '');
  if (all.length === 0) {
    out.push(t({
      en: 'No artifact is registered — there is nothing to index yet.',
      ko: '등록된 산출물이 없다 — 아직 목차에 올릴 문서가 없다.',
    }), '');
  }
  const openLabel = t({ en: 'open', ko: '열기' });
  const awaitingCell = `**${t(AWAITING_PUBLISH)}**`;
  for (const { phase, docs } of groups) {
    if (docs.length === 0) continue;
    out.push(`### ${phase}`, '', t({
      en: '| Document | Version | Status | Artifact |',
      ko: '| 문서 | 버전 | 상태 | 아티팩트 |',
    }), '|---|---|---|---|');
    for (const d of docs) {
      out.push(`| ${d.id} | ${d.version} | ${d.status} | ${d.artifactUrl ? `[${openLabel}](${d.artifactUrl})` : awaitingCell} |`);
    }
    out.push('');
  }

  const state = attempt(() => readState(root));
  out.push(`## ${t(MSG.gateStatusHeading)}`, '');
  if (!state.ok) {
    unreadable.push(`${t(MSG.stateUnreadable)}: ${state.error}`);
    out.push(t(MSG.seeUnreadable), '');
  } else {
    out.push(`- ${t({ en: 'Current phase', ko: '현재 페이즈' })}: ${state.value.phase}`, '', t({
      en: '| Phase | Status | Evidence | Approved |',
      ko: '| 페이즈 | 상태 | 근거 | 승인 |',
    }), '|---|---|---|---|');
    for (const phase of PHASES) {
      const g = state.value.gates[phase];
      out.push(`| ${phase} | ${g?.status ?? 'pending'} | ${g?.evidence ?? '—'} | ${g?.approvedAt ?? '—'} |`);
    }
    out.push('');
  }

  // 발행 대기 — 스펙 §3-7 의 열화 경로. 오프라인 등으로 발행되지 못한 문서는 draft 에 머문다.
  const pending = all.filter(d => !d.artifactUrl);
  out.push(`## ${t(AWAITING_PUBLISH)}`, '');
  out.push(pending.length === 0
    ? t({
      en: 'Nothing awaiting publication — every registered document has an artifact URL.',
      ko: '발행 대기 없음 — 등록된 문서 전부가 아티팩트 URL 을 가진다.',
    })
    : t({
      en: 'These documents have no artifact URL and cannot go to a gate (requirement 16). '
        + 'Publish them in one batch once publishing is possible.',
      ko: '아티팩트 URL 이 없어 게이트에 올릴 수 없는 문서다(요구 16). 발행 가능해지면 일괄 처리하라.',
    }));
  for (const d of pending) out.push(`- ${d.phase} **${d.id}** v${d.version} (${d.status}) — \`${d.path}\``);
  out.push('');

  const rtm = collectRtm(root, t);
  unreadable.push(...rtm.unreadable);
  out.push(`## ${t({ en: 'Gap summary', ko: '미커버 요약' })}`, '', ...gapLines(rtm.rows, t));
  out.push(...unreadableSection(unreadable, t));
  return out.join('\n') + '\n';
}
