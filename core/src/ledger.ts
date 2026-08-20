import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { ledgerPath, wavesDir } from './paths';
import type { LedgerNode } from './types';

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
  const i = nodes.findIndex(n => n.id === node.id);
  if (i >= 0) nodes[i] = node; else nodes.push(node);
  saveLedger(root, nodes);
}

/**
 * 설계 개정: version++ + stale 마킹.
 * 반환된 affectedWaves(해당 노드를 design_refs로 참조하며 status가 stale이 아닌 웨이브의
 * 파일명 stem — 소비처 markStale이 파일명으로 해석)는 호출측(CLI)이 wave.markStale로
 * 마킹한다 — 순환 의존 방지를 위한 분리.
 */
export function bumpNode(root: string, id: string): { node: LedgerNode; affectedWaves: string[] } {
  const nodes = loadLedger(root);
  const node = nodes.find(n => n.id === id);
  if (!node) throw new Error(`노드 ${id} 가 원장에 없다`);
  node.version += 1;
  node.status = 'stale';
  saveLedger(root, nodes);

  const affectedWaves: string[] = [];
  if (fs.existsSync(wavesDir(root))) {
    for (const f of fs.readdirSync(wavesDir(root)).filter(f => /^wave-\d+\.md$/.test(f)).sort()) {
      const txt = fs.readFileSync(path.join(wavesDir(root), f), 'utf8');
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(txt);
      if (!m) continue;
      let meta: { design_refs?: string[]; status?: string };
      try { meta = YAML.parse(m[1]) ?? {}; } catch { continue; } // 깨진 frontmatter는 스킵
      if (meta.design_refs?.includes(id) && meta.status !== 'stale') {
        affectedWaves.push(f.replace(/\.md$/, ''));
      }
    }
  }
  return { node, affectedWaves };
}
