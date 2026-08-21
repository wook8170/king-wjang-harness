import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { ledgerPath, wavesDir } from './paths';
import { tr } from './tr';
import { parseWave } from './wave';
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
  const parent = node.parent;
  if (parent !== undefined && parent !== '') {
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
  const i = nodes.findIndex(n => n.id === node.id);
  if (i >= 0) nodes[i] = node; else nodes.push(node);
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
