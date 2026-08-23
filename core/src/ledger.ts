import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { ledgerPath, wavesDir } from './paths';
import { tr } from './tr';
import { parseWave, markStale } from './wave';
import { appendEvent } from './events';
import { readState } from './state';
import type { LedgerNode, WaveMeta } from './types';

// 원장은 저널 파생이 아니다 — replayState가 node-* 이벤트를 폴드하지 않으며, 손상 시
// 복구 수단은 git이다. 파일 없음은 조용히 [], 파싱 손상은 throw(CLI에서 시끄럽게)가 의도다.

export function loadLedger(root: string): LedgerNode[] {
  if (!fs.existsSync(ledgerPath(root))) return [];
  const doc = YAML.parse(fs.readFileSync(ledgerPath(root), 'utf8')) as { nodes?: unknown } | null;
  const nodes = doc?.nodes;
  return Array.isArray(nodes) ? (nodes as LedgerNode[]) : [];
}

export function saveLedger(root: string, nodes: LedgerNode[]): void {
  const target = ledgerPath(root);
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, YAML.stringify({ nodes }));
  fs.renameSync(tmp, target);
}

export function getNode(root: string, id: string): LedgerNode | undefined {
  return loadLedger(root).find(n => n.id === id);
}

export function upsertNode(root: string, node: LedgerNode): void {
  const nodes = loadLedger(root);
  // [LOGIC-93] 부모 검증은 **여기**에 산다 — CLI 에만 두었더니 MCP 표면으로 댕글링 부모가
  // 그대로 들어왔다(독립 감정이 실측). SEC-50 이 정확히 같은 사고였다: Write 만 막고 Bash 는
  // 비어 있었다. **규칙을 도메인에 두면 표면이 몇 개든 함께 상속한다.**
  /**
   * [ENG-E] 빈 부모는 **부모 없음**으로 정규화한다. 예전에는 `''` 가 검증만 건너뛰고 그대로
   * 저장돼, CLI 는 거부하는데 MCP 는 ok 로 빈 부모를 원장에 남기는 표면 비대칭이 됐다.
   * 값의 해석은 도메인이 한 번에 정한다 — 표면마다 정하면 그때부터 갈린다.
   */
  const parent = node.parent === '' ? undefined : node.parent;
  if (parent !== undefined) {
    if (parent === node.id) {
      throw new Error(tr(root, {
        en: `A node cannot be its own parent: ${node.id}`,
        ko: `자기 자신을 부모로 둘 수 없다: ${node.id}`,
      }));
    }
    if (!nodes.some(n => n.id === parent)) {
      throw new Error(tr(root, {
        en: `Parent ${parent} is not in the design ledger — register it first `
          + `(node upsert --id ${parent} --title "<title>"). A parentless chain breaks the RTM.`,
        ko: `부모 ${parent} 가 설계 원장에 없다 — 먼저 등록하라 `
          + `(node upsert --id ${parent} --title "<제목>"). 끊긴 사슬은 RTM 의 뼈대를 깬다.`,
      }));
    }
  }
  // 정규화한 값으로 **저장한다** — 검증만 정규화하고 원본을 넣으면 `parent: ''` 가 그대로 남아
  // 표면 비대칭이 원장에 기록된다(ENG-E 가 정확히 그 모습이었다).
  const stored: LedgerNode = parent === undefined
    ? (() => { const { parent: _drop, ...rest } = node; return rest as LedgerNode; })()
    : { ...node, parent };
  const i = nodes.findIndex(n => n.id === node.id);
  if (i >= 0) nodes[i] = stored; else nodes.push(stored);
  saveLedger(root, nodes);
}

/**
 * 설계 개정: version++ + stale 마킹.
 * 반환된 affectedWaves(해당 노드를 design_refs로 참조하며 status가 stale이 아닌 웨이브의
 * 파일명 stem — 소비처 markStale이 파일명으로 해석)는 호출측(CLI)이 wave.markStale로
 * 마킹한다 — 순환 의존 방지를 위한 분리.
 *
 * unverifiable = 읽기 실패(I/O)나 frontmatter 해석 실패로 **참조 여부를 판정할 수 없었던**
 * 웨이브. 검증 불가는 침묵 스킵이 아니라 보고 대상이다 — 마킹할 수도, 무시해도 된다고
 * 단정할 수도 없으므로 호출측이 사람에게 넘겨야 한다. 조용히 넘기면 STALE 전파가
 * 뚫린 줄 아무도 모른다.
 */
export function bumpNode(
  root: string, id: string,
): { node: LedgerNode; affectedWaves: string[]; unverifiable: string[] } {
  const nodes = loadLedger(root);
  const node = nodes.find(n => n.id === id);
  if (!node) throw new Error(tr(root, { en: `Node ${id} is not in the design ledger`, ko: `노드 ${id} 가 원장에 없다` }));
  node.version += 1;
  node.status = 'stale';
  saveLedger(root, nodes);

  const affectedWaves: string[] = [];
  const unverifiable: string[] = [];
  if (fs.existsSync(wavesDir(root))) {
    for (const f of fs.readdirSync(wavesDir(root)).filter(f => /^wave-\d+\.md$/.test(f)).sort()) {
      const stem = f.replace(/\.md$/, '');
      let txt: string;
      try {
        txt = fs.readFileSync(path.join(wavesDir(root), f), 'utf8');
      } catch {
        unverifiable.push(stem); continue; // 읽기 실패 — 참조 여부 판정 불가
      }
      // 참조 인정 기준을 정본 parseWave 로 단일화한다. 자체 파싱은 스칼라 design_refs 를
      // 배열로 정규화하지 못해 `"UX-10".includes("UX-1")` 부분문자열 오탐을 냈다(API-10).
      // parseWave 는 asArr 로 정규화하므로 정확 일치(배열 멤버십)만 인정된다.
      // parseWave throw = frontmatter 없음·깨진 YAML·스칼라 frontmatter → 검증 불가(침묵 스킵 아님).
      let meta: WaveMeta;
      try {
        meta = parseWave(txt).meta;
      } catch {
        unverifiable.push(stem); continue;
      }
      if (meta.design_refs.includes(id) && meta.status !== 'stale') {
        affectedWaves.push(stem);
      }
    }
  }
  return { node, affectedWaves, unverifiable };
}

/**
 * [UTIL-105·ENG-106] **개정 = 판 올림 + 저널 + STALE 전파.** 한 벌로 둔다.
 *
 * `bumpNode` 는 「누가 영향을 받는가」를 **계산만** 했고, 저널 기록과 `markStale` 루프는
 * CLI 와 MCP 가 **각자** 구현하고 있었다 — 같은 규칙 두 벌이다(이 리포가 반복해서 무는 사고).
 * 그 결과 도메인만 부르는 경로(테스트·다른 호출자)에서는 웨이브가 STALE 이 되지 않았다.
 *
 * 여기서 전부 한다. 표면은 결과를 **보고만** 한다.
 */
export interface NodeRevision {
  node: LedgerNode;
  /** 실제로 STALE 로 표시한 웨이브. */
  marked: string[];
  /** 표시하려다 실패한 웨이브 — 전파가 뚫린 것이므로 감추지 않는다. */
  failed: string[];
  /** 참조 여부를 판정할 수 없던 웨이브(읽기·파싱 실패). */
  unverifiable: string[];
  /**
   * 마킹 **전에** 활성이던 웨이브. 그것이 STALE 로 정산되면 이 세션의 턴 로그 가드가 함께
   * 풀리므로 호출측이 사람에게 고지해야 한다.
   */
  activeBefore: string | null;
}

export function reviseNode(root: string, id: string): NodeRevision {
  const { node, affectedWaves, unverifiable } = bumpNode(root, id);
  // 저널 먼저 — 마킹 루프 도중에 죽어도 bump 가 일어났다는 사실은 남아야 한다(events.ts 순서 계약).
  // affected 는 「마킹 대상」이지 「마킹 성공」이 아니다.
  appendEvent(root, 'node-bumped', {
    id: node.id, version: node.version, affected: affectedWaves, unverifiable,
  });
  let activeBefore: string | null = null;
  try { activeBefore = readState(root).activeWave; } catch { /* 판정 불가 → 고지 생략 */ }
  // 한 웨이브의 실패가 나머지 마킹을 막지 않는다 — 부분 실패는 감추지 말고 보고한다.
  const failed: string[] = [];
  for (const w of affectedWaves) {
    try { markStale(root, w); } catch { failed.push(w); }
  }
  return {
    node, marked: affectedWaves.filter(w => !failed.includes(w)),
    failed, unverifiable, activeBefore,
  };
}

/**
 * [ENG-106] **등록·갱신의 병합 의미론도 한 벌이다.**
 *
 * `cli.ts` 와 `mcp.ts` 가 각자 「이전 값을 읽어 합치고, upsert 하고, 저널에 적는다」를
 * 똑같이 구현하고 있었다. 뮤테이션으로 실증됐다 — MCP 쪽 `version` 보존을 망가뜨려도
 * 전건 초록이었다(그 사본을 보는 테스트가 없었다). 개정 카운터가 조용히 리셋되면
 * STALE 전파의 기준이 무너진다.
 *
 * 규칙:
 *  - **version 은 보존한다** — 판을 올리는 것은 `reviseNode` 뿐이다.
 *  - 주지 않은 필드는 이전 값을 잇는다(부분 갱신).
 *  - 처음 등록이면 `draft` 로 시작한다.
 */
export function mergeNode(
  root: string,
  patch: { id: string; title: string; parent?: string; doc_anchor?: string; status?: LedgerNode['status'] },
): LedgerNode {
  const prev = getNode(root, patch.id);
  const node: LedgerNode = {
    id: patch.id,
    title: patch.title,
    parent: patch.parent ?? prev?.parent,
    doc_anchor: patch.doc_anchor ?? prev?.doc_anchor,
    version: prev?.version ?? 1,                       // bump 이력 보존
    status: patch.status ?? prev?.status ?? 'draft',
  };
  upsertNode(root, node);
  appendEvent(root, 'node-upserted', { id: node.id });
  return node;
}
