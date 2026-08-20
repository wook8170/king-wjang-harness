import * as fs from 'node:fs';
import * as YAML from 'yaml';
import { configPath } from './paths';
import type { HarnessConfig } from './types';

export const DEFAULT_CONFIG: HarnessConfig = {
  profile: 'generic',
  remote_control: true,
  terse: false,
  design_allowed_prefixes: ['.harness/', 'docs/'],
  design_blocked_bash: ['docker push', 'kubectl apply', 'vercel deploy', 'netlify deploy', 'fly deploy'],
};

export function loadConfig(root: string): HarnessConfig {
  const p = configPath(root);
  if (!fs.existsSync(p)) return { ...DEFAULT_CONFIG };
  const raw = (YAML.parse(fs.readFileSync(p, 'utf8')) ?? {}) as Partial<HarnessConfig>;
  return { ...DEFAULT_CONFIG, ...raw };
}
