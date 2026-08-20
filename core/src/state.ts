import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  harnessDir, statePath, wavesDir, designDir, ledgerPath, configPath, runtimeDir, eventsPath,
} from './paths';
import type { HarnessState } from './types';

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
  // config.yaml이 덮여 전멸한다 — isInitialized(state.json 존재)는 훅 비간섭 판정용으로 별도 유지.
  if (fs.existsSync(harnessDir(root))) throw new Error(`.harness/ 가 이미 초기화되어 있다: ${harnessDir(root)}`);
  for (const d of [harnessDir(root), designDir(root), wavesDir(root), runtimeDir(root)]) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.writeFileSync(path.join(runtimeDir(root), '.gitignore'), '*\n'); // 세션 스크래치는 커밋 금지
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
