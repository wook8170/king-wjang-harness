import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { ledgerPath, wavesDir } from './paths';
import type { LedgerNode } from './types';

export function loadLedger(root: string): LedgerNode[] {
  if (!fs.existsSync(ledgerPath(root))) return [];
  const doc = YAML.parse(fs.readFileSync(ledgerPath(root), 'utf8')) as { nodes?: LedgerNode[] } | null;
  return doc?.nodes ?? [];
}

export function saveLedger(root: string, nodes: LedgerNode[]): void {
  fs.writeFileSync(ledgerPath(root), YAML.stringify({ nodes }));
}

export function getNode(root: string, id: string): LedgerNode | undefined {
  return loadLedger(root).find(n => n.id === id);
}

export function upsertNode(root: string, node: LedgerNode): void {
  const nodes = loadLedger(root).filter(n => n.id !== node.id);
  nodes.push(node);
  saveLedger(root, nodes);
}

/**
 * 설계 개정: version++ + stale 마킹.
 * 반환된 affectedWaves(해당 노드를 design_refs로 참조하며 status가 stale이 아닌 웨이브)는
 * 호출측(CLI)이 wave.markStale로 마킹한다 — 순환 의존 방지를 위한 분리.
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
    for (const f of fs.readdirSync(wavesDir(root)).filter(f => f.endsWith('.md')).sort()) {
      const txt = fs.readFileSync(path.join(wavesDir(root), f), 'utf8');
      const m = /^---\n([\s\S]*?)\n---/.exec(txt);
      if (!m) continue;
      let meta: { id?: string; design_refs?: string[]; status?: string };
      try { meta = YAML.parse(m[1]) ?? {}; } catch { continue; } // 깨진 frontmatter는 스킵
      if (typeof meta.id === 'string' && meta.design_refs?.includes(id) && meta.status !== 'stale') {
        affectedWaves.push(meta.id);
      }
    }
  }
  return { node, affectedWaves };
}
