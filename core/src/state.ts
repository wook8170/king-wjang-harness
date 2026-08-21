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

export function readState(root: string): HarnessState {
  return JSON.parse(fs.readFileSync(statePath(root), 'utf8')) as HarnessState;
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
