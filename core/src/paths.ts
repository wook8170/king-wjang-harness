import * as path from 'node:path';

export const harnessDir = (root: string) => path.join(root, '.harness');
export const statePath = (root: string) => path.join(harnessDir(root), 'state.json');
export const eventsPath = (root: string) => path.join(harnessDir(root), 'events.jsonl');
export const configPath = (root: string) => path.join(harnessDir(root), 'config.yaml');
export const designDir = (root: string) => path.join(harnessDir(root), 'design');
export const ledgerPath = (root: string) => path.join(designDir(root), 'ledger.yaml');
export const wavesDir = (root: string) => path.join(harnessDir(root), 'waves');
export const wavePath = (root: string, id: string) => path.join(wavesDir(root), `${id}.md`);
export const evidenceDir = (root: string, waveId: string) =>
  path.join(harnessDir(root), 'evidence', waveId);
export const runtimeDir = (root: string) => path.join(harnessDir(root), '.runtime');
