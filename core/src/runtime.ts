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

/**
 * 세션 시작 시 이전 세션의 활동 마커를 지운다 — stop 가드는 "현 세션에 작업이 있었나"만
 * 판정하고, 세션을 넘긴 미정산 변경은 session-start 의 정산 지시가 담당한다.
 * 실패는 무시한다(최악: 이전 세션 활동 때문에 정산을 한 번 더 요구 — fail-closed).
 */
export function clearActivity(root: string): void {
  try {
    const p = f(root, 'last-activity');
    if (fs.existsSync(p)) fs.rmSync(p);
  } catch {
    // 마커 삭제 실패가 세션 시작을 막지는 않는다
  }
}

export function readRuntime(root: string): { lastActivityAt?: string; lastTurnAt?: string } {
  const read = (name: string): string | undefined => {
    if (!fs.existsSync(f(root, name))) return undefined;
    const v = fs.readFileSync(f(root, name), 'utf8').trim();
    return v || undefined;
  };
  return { lastActivityAt: read('last-activity'), lastTurnAt: read('last-turn') };
}
