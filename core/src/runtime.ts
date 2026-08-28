import * as fs from 'node:fs';
import * as path from 'node:path';
import { runtimeDir } from './paths';

const f = (root: string, name: string) => path.join(runtimeDir(root), name);

/**
 * [OPS-03] **활동 마커는 조용히 실패하되 흔적을 남긴다.**
 *
 * 예전에는 try/catch 가 아예 없었다. `.harness/` 가 쓰기 불가가 되면(권한 실수·읽기전용
 * 마운트·컨테이너 볼륨) 마커가 안 써지고, 그러면 stop 가드는 아래 `readRuntime` 의 결과를
 * 「마커가 없다 = 이번 세션엔 작업이 없었다」로 읽어 **턴 로그 정산 강제를 건너뛴다** —
 * 실제로는 소스를 고쳤는데도. 강제를 파는 제품에서 가장 나쁜 것은 강제가 꺼진 줄 모르는 것이다.
 *
 * 위로 던질 수는 없다(훅 무해 계약: 판정 실패가 세션을 깨뜨리지 않는다). 그래서 **이미 있는
 * 통로**에 흔적을 남긴다 — `.runtime/hook-errors.log` 는 `doctor` 의 countHookErrors 가 세어
 * 경고로 올린다. 새 통로를 만들면 아무도 보지 않는다.
 *
 * 남는 사각은 하나다: 그 로그도 같은 디렉토리라 **전면 읽기전용**에서는 함께 실패한다.
 * 그 상태는 `doctor` 의 쓰기 프로브(OPS-04)가 잡는다 — 여기서 할 수 있는 일은 여기까지다.
 */
export function noteActivity(root: string): void {
  try {
    fs.mkdirSync(runtimeDir(root), { recursive: true });
    fs.writeFileSync(f(root, 'last-activity'), new Date().toISOString());
  } catch (e) {
    noteMarkerFailure(root, 'last-activity', e);
  }
}

/** fail-open 을 관측 가능하게 만드는 기존 통로(hook.ts 의 logHookError 와 같은 파일). */
function noteMarkerFailure(root: string, marker: string, err: unknown): void {
  try {
    fs.appendFileSync(
      path.join(runtimeDir(root), 'hook-errors.log'),
      `${new Date().toISOString()} activity-marker ${marker} ${String(err)}\n`,
    );
  } catch {
    // 로그도 같은 디렉토리다 — 함께 못 쓰는 상태는 doctor 의 쓰기 프로브가 본다(OPS-04)
  }
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
