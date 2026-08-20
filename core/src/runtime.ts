import * as fs from 'node:fs';
import * as path from 'node:path';
import { runtimeDir } from './paths';

const f = (root: string, name: string) => path.join(runtimeDir(root), name);

export function noteActivity(root: string): void {
  fs.mkdirSync(runtimeDir(root), { recursive: true });
  fs.writeFileSync(f(root, 'last-activity'), new Date().toISOString());
}

export function noteTurnLogged(root: string): void {
  fs.mkdirSync(runtimeDir(root), { recursive: true });
  fs.writeFileSync(f(root, 'last-turn'), new Date().toISOString());
}

export function readRuntime(root: string): { lastActivityAt?: string; lastTurnAt?: string } {
  const read = (name: string): string | undefined => {
    if (!fs.existsSync(f(root, name))) return undefined;
    const v = fs.readFileSync(f(root, name), 'utf8').trim();
    return v || undefined;
  };
  return { lastActivityAt: read('last-activity'), lastTurnAt: read('last-turn') };
}
