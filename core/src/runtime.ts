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
  const read = (name: string) =>
    fs.existsSync(f(root, name)) ? fs.readFileSync(f(root, name), 'utf8').trim() : undefined;
  return { lastActivityAt: read('last-activity'), lastTurnAt: read('last-turn') };
}
