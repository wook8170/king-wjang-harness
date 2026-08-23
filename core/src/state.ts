import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  harnessDir, statePath, wavesDir, designDir, ledgerPath, configPath, runtimeDir, eventsPath,
} from './paths';
import type { HarnessState } from './types';
import { tr } from './tr';

export function defaultState(): HarnessState {
  return {
    schemaVersion: 1,
    phase: 'P0',
    activeWave: null,
    gates: {},
    backtrack: null,
    updatedAt: new Date().toISOString(),
  };
}

export function isInitialized(root: string): boolean {
  return fs.existsSync(statePath(root));
}

/**
 * [OPS-94] **하네스가 걸려 있는가** — `state.json` 이 아니라 `.harness/` 디렉토리로 판정한다.
 *
 * `isInitialized`(state.json 존재)를 「초기화됐는가」로 쓰면 **복구 경로가 막힌다**: state.json 만
 * 지운 상태에서 모든 명령이 「`harness init` 을 먼저 실행하라」고 하고, `init` 은 「이미 있다」고
 * 거부한다. 정작 저널은 멀쩡하고 `doctor --repair` 가 그걸 재생해 복구할 수 있는데, 그 명령까지
 * 같은 가드에 막혀 **막다른 길**이 된다(독립 감정이 실측).
 *
 * 그래서 둘을 나눈다: 「.harness/ 가 있는가」(= 이 프로젝트가 하네스를 쓴다)와
 * 「state.json 이 있는가」(= 파생 상태가 성하다). 앞은 가드가, 뒤는 복구가 본다.
 */
export function hasHarness(root: string): boolean {
  return fs.existsSync(harnessDir(root));
}

/**
 * [UTIL-A2] `state.json` 만 사라진 상태에서 **내부 절대경로가 박힌 raw ENOENT** 를 뱉었다 —
 * 사람은 오류가 가리키는 곳을 고치려 드는데, 그 문구는 「이 경로가 왜 여기 있나」만 남긴다.
 * 이 상태는 **미초기화가 아니라 열화**이고 복구 수단이 실제로 있다(저널 재생).
 *
 * 한 곳에서 고친다 — 명령마다 안내를 복제하면 새 명령이 생길 때마다 빠진다([USE-93]·[OPS-94]가
 * 같은 사고였다). 던지는 것은 그대로 유지한다: `doctor` 는 자기 존재 검사로 이 상태를 잡으므로
 * 복구 경로는 이 문구에 걸리지 않는다.
 */
export function readState(root: string): HarnessState {
  try {
    return JSON.parse(fs.readFileSync(statePath(root), 'utf8')) as HarnessState;
  } catch (e) {
    /**
     * [UX-117] **손상된 상태 파일에도 처방을 준다.** 예전에는 `state.json` 이 깨져 있으면
     * `harness status` 가 `Unexpected token 'g' … is not valid JSON` 만 뱉고 끝났다 —
     * 혼란스러운 순간에 가장 먼저 치는 명령이 원인만 던지고 나가는 길을 안 알려 준 것이다.
     * 파일이 **없는** 경우(아래)와 원인은 다르지만 처방은 같다: 저널이 진실이므로 재생하면 된다.
     */
    if (isInitialized(root)) {
      throw new Error(tr(root, {
        en: `state.json is damaged and could not be parsed (${(e as Error).message}) — the state store is `
          + 'derived, so the event journal can rebuild it: run `harness doctor --repair`. '
          + '`harness doctor` alone reports what it finds without changing anything.',
        ko: `state.json 이 손상돼 해석할 수 없다 (${(e as Error).message}) — 상태 저장소는 파생물이라 `
          + '이벤트 저널로 다시 만들 수 있다: `harness doctor --repair` 를 실행하라. '
          + '`harness doctor` 만 실행하면 아무것도 바꾸지 않고 진단만 한다.',
      }));
    }
    if (hasHarness(root) && !isInitialized(root)) {
      throw new Error(tr(root, {
        en: '.harness/ is here but state.json is missing — the state store is derived, so the event '
          + 'journal can rebuild it. Run `harness doctor --repair`. Do not run `harness init`: it refuses '
          + 'while .harness/ exists',
        ko: '.harness/ 는 있는데 state.json 이 없다 — 상태 저장소는 파생물이라 이벤트 저널로 다시 '
          + '만들 수 있다. `harness doctor --repair` 를 실행하라. `harness init` 은 .harness/ 가 있으면 '
          + '거부하므로 그쪽이 아니다',
      }));
    }
    throw e;
  }
}

export function writeState(root: string, state: HarnessState): void {
  const target = statePath(root);
  const tmp = `${target}.tmp-${process.pid}`;
  const next = { ...state, updatedAt: new Date().toISOString() };
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(tmp, target); // 같은 디렉토리 내 rename = POSIX 원자적 (내구성은 events.jsonl 재생이 담당)
}

export function initHarness(root: string): void {
  // 디렉토리 기준 가드: state.json만 사라진 상태에서 재실행하면 events.jsonl(진실의 원천)·
  // config.yaml이 덮여 전멸한다. 훅 비간섭 게이트도 이 디렉토리 기준을 쓴다(hook.ts, LOGIC-11) —
  // 같은 개념에 두 정의를 두지 않는다. isInitialized(state.json 존재)는 status·복구 판정용으로 남는다.
  if (fs.existsSync(harnessDir(root))) throw new Error(tr(root, { en: `.harness/ is already initialised: ${harnessDir(root)}`, ko: `.harness/ 가 이미 초기화되어 있다: ${harnessDir(root)}` }));
  for (const d of [harnessDir(root), designDir(root), wavesDir(root), runtimeDir(root)]) {
    fs.mkdirSync(d, { recursive: true });
  }
  // 세션 스크래치는 커밋 금지. 단 `*` 만 두면 .gitignore 자신도 무시되어 디렉토리가
  // 통째로 커밋에서 빠진다 — 클론하면 .runtime/ 이 없어 훅의 hook-errors.log append 가
  // 조용히 실패한다(로깅은 비간섭 때문에 mkdir 하지 않는다).
  fs.writeFileSync(path.join(runtimeDir(root), '.gitignore'), '*\n!.gitignore\n');
  fs.writeFileSync(ledgerPath(root), 'nodes: []\n');
  fs.writeFileSync(configPath(root), [
    'profile: generic',
    'remote_control: true',
    'terse: false',
    '', ].join('\n'));
  fs.writeFileSync(eventsPath(root), '');
  const tmp = `${statePath(root)}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(defaultState(), null, 2) + '\n');
  fs.renameSync(tmp, statePath(root));
}
