import * as path from 'node:path';

export const harnessDir = (root: string) => path.join(root, '.harness');
export const statePath = (root: string) => path.join(harnessDir(root), 'state.json');
export const eventsPath = (root: string) => path.join(harnessDir(root), 'events.jsonl');
export const configPath = (root: string) => path.join(harnessDir(root), 'config.yaml');
export const designDir = (root: string) => path.join(harnessDir(root), 'design');
export const ledgerPath = (root: string) => path.join(designDir(root), 'ledger.yaml');
/** 산출물 레지스트리(DOC-x 노드) — 설계 원장과 나란히 둔다(§3-7). */
export const registryPath = (root: string) => path.join(designDir(root), 'registry.yaml');
/** 게이트 리뷰 패킷 산출 위치(§4-3). */
export const packetsDir = (root: string) => path.join(harnessDir(root), 'packets');
export const wavesDir = (root: string) => path.join(harnessDir(root), 'waves');
export const wavePath = (root: string, id: string) => path.join(wavesDir(root), `${id}.md`);
export const evidenceDir = (root: string, waveId: string) =>
  path.join(harnessDir(root), 'evidence', waveId);
export const runtimeDir = (root: string) => path.join(harnessDir(root), '.runtime');
