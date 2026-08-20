# 코어 엔진 v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** king-wjang-harness 플러그인의 심장인 `harness` CLI 코어 v0 — 상태 저장소(state.json 원자적 쓰기 + events.jsonl 저널), 설계 원장(STALE 전파), 웨이브 지시서 수명주기, 훅 판정기(session-start 주입 / pre-tool 차단 / stop 가드), doctor 복구 — 를 TDD로 구현한다.

**Architecture:** 단일 TS 패키지. 모든 상태 변이는 "이벤트 append + state 재기록" 쌍으로 수행 (이벤트가 진실, state는 파생 캐시 → doctor가 재생으로 복구). 훅은 `harness hook <event>`로 stdin JSON을 받아 판정 JSON을 stdout으로 반환. `.harness/`가 없는 프로젝트에서는 모든 훅이 침묵(비간섭 원칙).

**Tech Stack:** Node ≥18, TypeScript, `yaml`(유일한 런타임 의존성), vitest(테스트), tsup(번들 — 훅은 <100ms 기동이 목표라 단일 CJS 번들로 빌드).

**참고 문서:** 마스터 스펙 `docs/superpowers/specs/2026-08-20-king-harness-design.md` §1(아키텍처)·§3(상태 모델)·§4(훅). Claude Code 훅 출력 계약은 https://docs.claude.com/en/docs/claude-code/hooks 에서 확인 (PreToolUse는 `hookSpecificOutput.permissionDecision`, Stop은 최상위 `decision:"block"`, SessionStart는 `hookSpecificOutput.additionalContext`).

**v0 범위 제외 (후속 로드맵):** 게이트 submit/approve·리뷰 패킷·아티팩트 발행(로드맵 2), 페이즈 스킬(3), Claude Design 연동(4), 프로파일 상세·시각 증적 자동화(5), usage 티어·auto-retry 이식(7). 단 페이즈 전환이 필요하므로 임시 명령 `harness phase set`을 두고 로드맵 2에서 게이트로 대체한다.

---

## File Structure

```
package.json / tsconfig.json / tsup.config.ts / vitest.config.ts
bin/harness                 # 실행 진입점 (dist 번들 require)
core/src/types.ts           # Phase·State·Event·WaveMeta·LedgerNode 타입과 상수 (단일 정의처)
core/src/paths.ts           # .harness/ 경로 헬퍼 (경로 문자열의 단일 정의처)
core/src/config.ts          # config.yaml 로드 + 기본값
core/src/state.ts           # 상태 읽기/원자적 쓰기/초기화
core/src/events.ts          # 저널 append/read/replay
core/src/ledger.ts          # 원장 CRUD + bump/STALE 전파
core/src/wave.ts            # 웨이브 파일 파싱/수명주기
core/src/runtime.ts         # 세션 스크래치 (.harness/.runtime/ — gitignore 대상)
core/src/hook.ts            # 훅 판정기 (순수 함수 + I/O 래퍼)
core/src/doctor.ts          # 무결성 검사·재생 복구
core/src/cli.ts             # argv 디스패치
core/test/*.test.ts         # 모듈별 vitest (임시 디렉토리 기반)
hooks/hooks.json            # 플러그인 훅 배선 (전부 harness hook 한 줄)
```

각 모듈은 `(root: string)`을 첫 인자로 받는 순수 함수 모음 — 전역 상태 없음, 테스트는 `fs.mkdtempSync` 임시 디렉토리로 완전 격리.

---

### Task 1: 프로젝트 스캐폴드

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `bin/harness`, `core/src/cli.ts`, `.gitignore`

- [ ] **Step 1: 설정 파일 작성**

`package.json`:
```json
{
  "name": "king-wjang-harness",
  "version": "0.0.1",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "check": "tsc --noEmit"
  },
  "dependencies": {
    "yaml": "^2.5.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "core/dist",
    "types": ["node"]
  },
  "include": ["core/src/**/*.ts", "core/test/**/*.ts"]
}
```

`tsup.config.ts`:
```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'core/src/cli.ts' },
  outDir: 'core/dist',
  format: ['cjs'],
  bundle: true,
  clean: true,
  minify: false,
  target: 'node18',
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['core/test/**/*.test.ts'] },
});
```

`.gitignore`:
```
node_modules/
core/dist/
```

`bin/harness` (실행권한 필요):
```js
#!/usr/bin/env node
require('../core/dist/cli.js').main(process.argv.slice(2));
```

`core/src/cli.ts` (스텁 — Task 12에서 완성):
```ts
export function main(argv: string[]): void {
  if (argv[0] === '--version') {
    console.log('king-wjang-harness core v0');
    return;
  }
  console.error(`unknown command: ${argv.join(' ') || '(none)'}`);
  process.exitCode = 1;
}

if (require.main === module) main(process.argv.slice(2));
```

- [ ] **Step 2: 설치·빌드·스모크 확인**

```bash
npm install && npm run build && chmod +x bin/harness && ./bin/harness --version
```
Expected: `king-wjang-harness core v0`

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: 코어 엔진 v0 스캐폴드 (tsup/vitest/bin 진입점)"
```

---

### Task 2: 타입·경로·config

**Files:**
- Create: `core/src/types.ts`, `core/src/paths.ts`, `core/src/config.ts`
- Test: `core/test/config.test.ts`

- [ ] **Step 1: 타입 정의 작성** — 이후 모든 태스크가 이 시그니처를 따른다

`core/src/types.ts`:
```ts
export const PHASES = [
  'P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6',
  'P7', 'P8', 'P9', 'P10', 'P11', 'P12',
] as const;
export type Phase = (typeof PHASES)[number];

export const DESIGN_PHASES: readonly Phase[] = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
export const BUILD_PHASES: readonly Phase[] = ['P7', 'P8', 'P9'];
export const SHIP_PHASES: readonly Phase[] = ['P10', 'P11', 'P12'];

export interface GateRecord {
  status: 'pending' | 'submitted' | 'approved' | 'invalidated';
  artifactHash?: string;
  approvedAt?: string;
}

export interface HarnessState {
  schemaVersion: 1;
  phase: Phase;
  activeWave: string | null;
  gates: Partial<Record<Phase, GateRecord>>;
  backtrack: { to: Phase; reason: string } | null;
  updatedAt: string;
}

export interface HarnessEvent {
  ts: string;
  type: string;
  data: Record<string, unknown>;
}

export interface WaveMeta {
  id: string;
  milestone: string;
  design_refs: string[];
  status: 'pending' | 'active' | 'done' | 'stale';
  acceptance: string[];
}

export interface LedgerNode {
  id: string;
  title: string;
  parent?: string;
  doc_anchor?: string;
  version: number;
  status: 'draft' | 'approved' | 'stale';
}

export interface HarnessConfig {
  profile: string;
  remote_control: boolean;
  terse: boolean;
  design_allowed_prefixes: string[];
  design_blocked_bash: string[];
}
```

`core/src/paths.ts`:
```ts
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
```

`core/src/config.ts`:
```ts
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
```

- [ ] **Step 2: 실패하는 테스트 작성**

`core/test/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig, DEFAULT_CONFIG } from '../src/config';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));

describe('config', () => {
  it('config.yaml 없으면 기본값', () => {
    expect(loadConfig(tmp())).toEqual(DEFAULT_CONFIG);
  });

  it('부분 설정은 기본값과 병합', () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness/config.yaml'), 'remote_control: false\n');
    const c = loadConfig(root);
    expect(c.remote_control).toBe(false);
    expect(c.profile).toBe('generic');
  });
});
```

- [ ] **Step 3: 테스트 실행 → 통과 확인** (구현을 먼저 썼으므로 그린이어야 함; 레드면 구현 수정)

```bash
npx vitest run core/test/config.test.ts
```
Expected: 2 passed

- [ ] **Step 4: Commit**

```bash
git add core/ && git commit -m "feat(core): 타입·경로·config 로더"
```

---

### Task 3: 상태 저장소 (원자적 쓰기)

**Files:**
- Create: `core/src/state.ts`
- Test: `core/test/state.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`core/test/state.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultState, readState, writeState, initHarness, isInitialized } from '../src/state';
import { statePath, wavesDir, runtimeDir, ledgerPath } from '../src/paths';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));

describe('state', () => {
  it('initHarness가 디렉토리 트리와 기본 state를 만든다', () => {
    const root = tmp();
    initHarness(root);
    expect(isInitialized(root)).toBe(true);
    expect(fs.existsSync(wavesDir(root))).toBe(true);
    expect(fs.existsSync(ledgerPath(root))).toBe(true);
    const s = readState(root);
    expect(s.phase).toBe('P0');
    expect(s.activeWave).toBeNull();
  });

  it('initHarness는 이미 초기화된 곳에서 에러', () => {
    const root = tmp();
    initHarness(root);
    expect(() => initHarness(root)).toThrow(/이미 초기화/);
  });

  it('writeState는 임시파일+rename 원자적 쓰기 (잔여 tmp 없음)', () => {
    const root = tmp();
    initHarness(root);
    const s = readState(root);
    writeState(root, { ...s, phase: 'P7' });
    expect(readState(root).phase).toBe('P7');
    const leftovers = fs.readdirSync(path.dirname(statePath(root))).filter(f => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('writeState는 updatedAt을 갱신한다', () => {
    const root = tmp();
    initHarness(root);
    const before = readState(root);
    writeState(root, { ...before, phase: 'P1' });
    expect(readState(root).updatedAt >= before.updatedAt).toBe(true);
  });

  it('.runtime은 gitignore 처리된다', () => {
    const root = tmp();
    initHarness(root);
    const gi = fs.readFileSync(path.join(runtimeDir(root), '.gitignore'), 'utf8');
    expect(gi.trim()).toBe('*');
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run core/test/state.test.ts
```
Expected: FAIL — `Cannot find module '../src/state'`

- [ ] **Step 3: 구현**

`core/src/state.ts`:
```ts
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
  fs.renameSync(tmp, target); // 같은 디렉토리 내 rename = POSIX 원자적
}

export function initHarness(root: string): void {
  if (isInitialized(root)) throw new Error(`.harness/ 가 이미 초기화되어 있다: ${harnessDir(root)}`);
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
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
npx vitest run core/test/state.test.ts
```
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add core/ && git commit -m "feat(core): 상태 저장소 — init + 원자적 쓰기"
```

---

### Task 4: 이벤트 저널 (append / replay)

**Files:**
- Create: `core/src/events.ts`
- Test: `core/test/events.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`core/test/events.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { appendEvent, readEvents, replayState } from '../src/events';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

describe('events', () => {
  it('append 후 read하면 순서대로 나온다', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P1' });
    appendEvent(root, 'wave-activated', { id: 'wave-001' });
    const ev = readEvents(root);
    expect(ev.map(e => e.type)).toEqual(['phase-set', 'wave-activated']);
    expect(ev[0].ts <= ev[1].ts).toBe(true);
  });

  it('replayState가 이벤트만으로 상태를 재구성한다', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P7' });
    appendEvent(root, 'wave-activated', { id: 'wave-003' });
    appendEvent(root, 'gate-approved', { phase: 'P0', artifactHash: 'abc' });
    appendEvent(root, 'backtrack-started', { to: 'P3', reason: '스키마 결함' });
    appendEvent(root, 'backtrack-cleared', {});
    appendEvent(root, 'wave-completed', { id: 'wave-003' });
    const s = replayState(readEvents(root));
    expect(s.phase).toBe('P7');
    expect(s.activeWave).toBeNull();
    expect(s.gates.P0?.status).toBe('approved');
    expect(s.backtrack).toBeNull();
  });

  it('알 수 없는 이벤트 타입은 무시하고 진행 (전방 호환)', () => {
    const root = setup();
    appendEvent(root, 'future-event', { x: 1 });
    appendEvent(root, 'phase-set', { phase: 'P2' });
    expect(replayState(readEvents(root)).phase).toBe('P2');
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run core/test/events.test.ts
```
Expected: FAIL — `Cannot find module '../src/events'`

- [ ] **Step 3: 구현**

`core/src/events.ts`:
```ts
import * as fs from 'node:fs';
import { eventsPath } from './paths';
import { defaultState } from './state';
import type { HarnessEvent, HarnessState, Phase, GateRecord } from './types';

export function appendEvent(
  root: string, type: string, data: Record<string, unknown>,
): HarnessEvent {
  const ev: HarnessEvent = { ts: new Date().toISOString(), type, data };
  fs.appendFileSync(eventsPath(root), JSON.stringify(ev) + '\n');
  return ev;
}

export function readEvents(root: string): HarnessEvent[] {
  if (!fs.existsSync(eventsPath(root))) return [];
  return fs.readFileSync(eventsPath(root), 'utf8')
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => JSON.parse(l) as HarnessEvent);
}

/** 이벤트가 진실. state.json은 파생 캐시 — 이 함수가 복구의 근거다. */
export function replayState(events: HarnessEvent[]): HarnessState {
  const s = defaultState();
  for (const ev of events) {
    const d = ev.data as Record<string, any>;
    switch (ev.type) {
      case 'phase-set': s.phase = d.phase as Phase; break;
      case 'wave-activated': s.activeWave = d.id as string; break;
      case 'wave-completed': if (s.activeWave === d.id) s.activeWave = null; break;
      case 'gate-submitted':
        s.gates[d.phase as Phase] = { status: 'submitted', artifactHash: d.artifactHash } as GateRecord;
        break;
      case 'gate-approved':
        s.gates[d.phase as Phase] = {
          status: 'approved', artifactHash: d.artifactHash, approvedAt: ev.ts,
        };
        break;
      case 'backtrack-started': s.backtrack = { to: d.to as Phase, reason: d.reason as string }; break;
      case 'backtrack-cleared': s.backtrack = null; break;
      default: break; // 전방 호환: 미래 이벤트는 무시
    }
  }
  return s;
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
npx vitest run core/test/events.test.ts
```
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add core/ && git commit -m "feat(core): 이벤트 저널 append/replay — 이벤트가 진실"
```

---

### Task 5: 설계 원장 (CRUD + bump/STALE 스캔)

**Files:**
- Create: `core/src/ledger.ts`
- Test: `core/test/ledger.test.ts`

STALE 전파는 웨이브 모듈(Task 6)과 상호 의존 — v0에서는 원장이 "영향받는 웨이브 id 목록"만 계산해 돌려주고, 실제 마킹은 CLI 계층(Task 12)에서 wave.markStale로 수행한다. 순환 import 방지.

- [ ] **Step 1: 실패하는 테스트 작성**

`core/test/ledger.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { loadLedger, upsertNode, getNode, bumpNode } from '../src/ledger';
import { wavesDir } from '../src/paths';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

describe('ledger', () => {
  it('빈 원장에서 upsert → get', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'draft' });
    expect(getNode(root, 'F-1')?.title).toBe('로그인');
    expect(loadLedger(root)).toHaveLength(1);
  });

  it('같은 id upsert는 교체', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'draft' });
    upsertNode(root, { id: 'F-1', title: '로그인 v2', version: 1, status: 'approved' });
    expect(loadLedger(root)).toHaveLength(1);
    expect(getNode(root, 'F-1')?.status).toBe('approved');
  });

  it('bumpNode: version++ , status→stale, 참조 웨이브 id 반환', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'approved' });
    fs.writeFileSync(path.join(wavesDir(root), 'wave-001.md'), [
      '---',
      'id: wave-001', 'milestone: M1', 'design_refs: [F-1]',
      'status: done', 'acceptance: []', '---', '## 턴 로그', '',
    ].join('\n'));
    fs.writeFileSync(path.join(wavesDir(root), 'wave-002.md'), [
      '---',
      'id: wave-002', 'milestone: M1', 'design_refs: [F-2]',
      'status: pending', 'acceptance: []', '---', '## 턴 로그', '',
    ].join('\n'));
    const r = bumpNode(root, 'F-1');
    expect(r.node.version).toBe(2);
    expect(r.node.status).toBe('stale');
    expect(r.affectedWaves).toEqual(['wave-001']);
  });

  it('없는 노드 bump는 에러', () => {
    expect(() => bumpNode(setup(), 'F-99')).toThrow(/원장에 없다/);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run core/test/ledger.test.ts
```
Expected: FAIL — `Cannot find module '../src/ledger'`

- [ ] **Step 3: 구현**

`core/src/ledger.ts`:
```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { ledgerPath, wavesDir } from './paths';
import type { LedgerNode } from './types';

export function loadLedger(root: string): LedgerNode[] {
  if (!fs.existsSync(ledgerPath(root))) return [];
  const doc = YAML.parse(fs.readFileSync(ledgerPath(root), 'utf8')) as { nodes?: LedgerNode[] } | null;
  return doc?.nodes ?? [];
}

export function saveLedger(root: string, nodes: LedgerNode[]): void {
  fs.writeFileSync(ledgerPath(root), YAML.stringify({ nodes }));
}

export function getNode(root: string, id: string): LedgerNode | undefined {
  return loadLedger(root).find(n => n.id === id);
}

export function upsertNode(root: string, node: LedgerNode): void {
  const nodes = loadLedger(root).filter(n => n.id !== node.id);
  nodes.push(node);
  saveLedger(root, nodes);
}

/**
 * 설계 개정: version++ + stale 마킹.
 * 반환된 affectedWaves(해당 노드를 design_refs로 참조하며 status가 stale이 아닌 웨이브)는
 * 호출측(CLI)이 wave.markStale로 마킹한다 — 순환 의존 방지를 위한 분리.
 */
export function bumpNode(root: string, id: string): { node: LedgerNode; affectedWaves: string[] } {
  const nodes = loadLedger(root);
  const node = nodes.find(n => n.id === id);
  if (!node) throw new Error(`노드 ${id} 가 원장에 없다`);
  node.version += 1;
  node.status = 'stale';
  saveLedger(root, nodes);

  const affectedWaves: string[] = [];
  if (fs.existsSync(wavesDir(root))) {
    for (const f of fs.readdirSync(wavesDir(root)).filter(f => f.endsWith('.md')).sort()) {
      const txt = fs.readFileSync(path.join(wavesDir(root), f), 'utf8');
      const m = /^---\n([\s\S]*?)\n---/.exec(txt);
      if (!m) continue;
      const meta = YAML.parse(m[1]) as { id: string; design_refs?: string[]; status?: string };
      if (meta.design_refs?.includes(id) && meta.status !== 'stale') affectedWaves.push(meta.id);
    }
  }
  return { node, affectedWaves };
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
npx vitest run core/test/ledger.test.ts
```
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add core/ && git commit -m "feat(core): 설계 원장 CRUD + bump/STALE 영향 스캔"
```

---

### Task 6: 웨이브 지시서 수명주기

**Files:**
- Create: `core/src/wave.ts`
- Test: `core/test/wave.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`core/test/wave.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState } from '../src/state';
import {
  createWave, activateWave, logTurn, completeWave, markStale, readWave, listWaves,
} from '../src/wave';
import { evidenceDir } from '../src/paths';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

describe('wave', () => {
  it('createWave: 번호 자동 증가, pending으로 생성', () => {
    const root = setup();
    const w1 = createWave(root, { milestone: 'M1', design_refs: ['F-1'], acceptance: ['테스트 그린'], goal: '로그인' });
    const w2 = createWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: '2번' });
    expect(w1.id).toBe('wave-001');
    expect(w2.id).toBe('wave-002');
    expect(readWave(root, 'wave-001').meta.status).toBe('pending');
    expect(listWaves(root)).toHaveLength(2);
  });

  it('activate: 하나만 활성 가능, state.activeWave 갱신', () => {
    const root = setup();
    createWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    createWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'b' });
    activateWave(root, 'wave-001');
    expect(readState(root).activeWave).toBe('wave-001');
    expect(() => activateWave(root, 'wave-002')).toThrow(/이미 활성/);
  });

  it('logTurn: 활성 웨이브의 턴 로그에 추가', () => {
    const root = setup();
    createWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    activateWave(root, 'wave-001');
    logTurn(root, '골격 생성, 다음: 핸들러');
    expect(readWave(root, 'wave-001').body).toMatch(/골격 생성, 다음: 핸들러/);
  });

  it('logTurn: 활성 웨이브 없으면 에러', () => {
    expect(() => logTurn(setup(), 'x')).toThrow(/활성 웨이브가 없다/);
  });

  it('complete: UX 참조 웨이브는 증적 없으면 거부, 있으면 done', () => {
    const root = setup();
    createWave(root, { milestone: 'M1', design_refs: ['UX-7'], acceptance: [], goal: 'ui' });
    activateWave(root, 'wave-001');
    expect(() => completeWave(root)).toThrow(/시각 증적/);
    fs.mkdirSync(evidenceDir(root, 'wave-001'), { recursive: true });
    fs.writeFileSync(path.join(evidenceDir(root, 'wave-001'), 'shot.png'), 'fake');
    completeWave(root);
    expect(readWave(root, 'wave-001').meta.status).toBe('done');
    expect(readState(root).activeWave).toBeNull();
  });

  it('markStale: status를 stale로', () => {
    const root = setup();
    createWave(root, { milestone: 'M1', design_refs: ['F-1'], acceptance: [], goal: 'a' });
    markStale(root, 'wave-001');
    expect(readWave(root, 'wave-001').meta.status).toBe('stale');
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run core/test/wave.test.ts
```
Expected: FAIL — `Cannot find module '../src/wave'`

- [ ] **Step 3: 구현**

`core/src/wave.ts`:
```ts
import * as fs from 'node:fs';
import * as YAML from 'yaml';
import { wavesDir, wavePath, evidenceDir } from './paths';
import { readState, writeState } from './state';
import { appendEvent } from './events';
import { noteTurnLogged } from './runtime';
import type { WaveMeta } from './types';

export function parseWave(txt: string): { meta: WaveMeta; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(txt);
  if (!m) throw new Error('웨이브 파일 형식 오류: frontmatter가 없다');
  return { meta: YAML.parse(m[1]) as WaveMeta, body: m[2] };
}

export function serializeWave(meta: WaveMeta, body: string): string {
  return `---\n${YAML.stringify(meta).trimEnd()}\n---\n${body}`;
}

export function readWave(root: string, id: string): { meta: WaveMeta; body: string } {
  return parseWave(fs.readFileSync(wavePath(root, id), 'utf8'));
}

export function listWaves(root: string): WaveMeta[] {
  if (!fs.existsSync(wavesDir(root))) return [];
  return fs.readdirSync(wavesDir(root)).filter(f => /^wave-\d+\.md$/.test(f)).sort()
    .map(f => parseWave(fs.readFileSync(`${wavesDir(root)}/${f}`, 'utf8')).meta);
}

function writeWave(root: string, meta: WaveMeta, body: string): void {
  fs.writeFileSync(wavePath(root, meta.id), serializeWave(meta, body));
}

export function createWave(
  root: string,
  opts: { milestone: string; design_refs: string[]; acceptance: string[]; goal: string },
): WaveMeta {
  const nums = listWaves(root).map(w => parseInt(w.id.replace('wave-', ''), 10));
  const id = `wave-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
  const meta: WaveMeta = { id, milestone: opts.milestone, design_refs: opts.design_refs, status: 'pending', acceptance: opts.acceptance };
  const body = [
    `## 목표`, opts.goal, '',
    `## 완료 기준`, ...opts.acceptance.map(a => `- ${a}`), '',
    `## 턴 로그`, '',
  ].join('\n');
  writeWave(root, meta, body);
  appendEvent(root, 'wave-created', { id, milestone: opts.milestone, design_refs: opts.design_refs });
  return meta;
}

export function activateWave(root: string, id: string): void {
  const state = readState(root);
  if (state.activeWave && state.activeWave !== id) {
    throw new Error(`이미 활성 웨이브가 있다: ${state.activeWave}. 먼저 complete 하라.`);
  }
  const { meta, body } = readWave(root, id);
  if (meta.status === 'done') throw new Error(`${id} 는 이미 done 이다`);
  meta.status = 'active';
  writeWave(root, meta, body);
  writeState(root, { ...state, activeWave: id });
  appendEvent(root, 'wave-activated', { id });
}

export function logTurn(root: string, text: string): void {
  const state = readState(root);
  if (!state.activeWave) throw new Error('활성 웨이브가 없다');
  const { meta, body } = readWave(root, state.activeWave);
  const entry = `- [${new Date().toISOString()}] ${text}`;
  writeWave(root, meta, body.trimEnd() + '\n' + entry + '\n');
  noteTurnLogged(root);
  appendEvent(root, 'wave-turn-logged', { id: meta.id });
}

export function completeWave(root: string): void {
  const state = readState(root);
  if (!state.activeWave) throw new Error('활성 웨이브가 없다');
  const { meta, body } = readWave(root, state.activeWave);
  if (meta.design_refs.some(r => r.startsWith('UX-'))) {
    const dir = evidenceDir(root, meta.id);
    const has = fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
    if (!has) {
      throw new Error(
        `UX 노드(${meta.design_refs.filter(r => r.startsWith('UX-')).join(', ')})를 참조하는 웨이브는 ` +
        `시각 증적 없이 완료할 수 없다. ${dir} 에 스크린샷을 넣어라.`,
      );
    }
  }
  meta.status = 'done';
  writeWave(root, meta, body);
  writeState(root, { ...state, activeWave: null });
  appendEvent(root, 'wave-completed', { id: meta.id });
}

export function markStale(root: string, id: string): void {
  const { meta, body } = readWave(root, id);
  meta.status = 'stale';
  writeWave(root, meta, body);
  appendEvent(root, 'wave-stale', { id });
}
```

`core/src/runtime.ts` 가 아직 없으므로 이 태스크에서 최소 스텁을 함께 만든다 (Task 7에서 테스트로 완성):
```ts
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
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
npx vitest run core/test/wave.test.ts
```
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add core/ && git commit -m "feat(core): 웨이브 지시서 수명주기 + UX 증적 완료 가드"
```

---

### Task 7: runtime 스크래치 테스트 보강

**Files:**
- Modify: `core/src/runtime.ts` (Task 6에서 생성 완료 — 변경 없으면 그대로)
- Test: `core/test/runtime.test.ts`

- [ ] **Step 1: 테스트 작성**

`core/test/runtime.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { noteActivity, noteTurnLogged, readRuntime } from '../src/runtime';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

describe('runtime', () => {
  it('기록 전에는 undefined', () => {
    expect(readRuntime(setup())).toEqual({ lastActivityAt: undefined, lastTurnAt: undefined });
  });

  it('noteActivity/noteTurnLogged 후 ISO 타임스탬프 반환', () => {
    const root = setup();
    noteActivity(root);
    noteTurnLogged(root);
    const r = readRuntime(root);
    expect(r.lastActivityAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.lastTurnAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 통과 확인**

```bash
npx vitest run core/test/runtime.test.ts
```
Expected: 2 passed

- [ ] **Step 3: Commit**

```bash
git add core/ && git commit -m "test(core): runtime 스크래치 커버"
```

---

### Task 8: 훅 판정기 — session-start 주입

**Files:**
- Create: `core/src/hook.ts`
- Test: `core/test/hook-session-start.test.ts`

판정기는 순수 함수 `handleHook(root, event, input)` — stdout 출력·stdin 파싱은 CLI(Task 12)가 담당. `.harness/` 없으면 `null` 반환(침묵) — **비간섭 원칙의 구현점**.

- [ ] **Step 1: 실패하는 테스트 작성**

`core/test/hook-session-start.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { createWave, activateWave, logTurn } from '../src/wave';
import { handleHook } from '../src/hook';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));

describe('hook: session-start', () => {
  it('.harness 없으면 null (침묵)', () => {
    expect(handleHook(tmp(), 'session-start', {})).toBeNull();
  });

  it('페이즈·활성 웨이브·remote-control 지시를 주입한다', () => {
    const root = tmp();
    initHarness(root);
    createWave(root, { milestone: 'M1', design_refs: ['F-1'], acceptance: ['그린'], goal: '로그인' });
    activateWave(root, 'wave-001');
    logTurn(root, '골격 완료, 다음: 핸들러');
    const out = handleHook(root, 'session-start', { source: 'startup' }) as any;
    const ctx: string = out.hookSpecificOutput.additionalContext;
    expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(ctx).toContain('P0');
    expect(ctx).toContain('wave-001');
    expect(ctx).toContain('골격 완료, 다음: 핸들러');
    expect(ctx).toContain('/remote-control');
  });

  it('remote_control=false면 지시 생략', () => {
    const root = tmp();
    initHarness(root);
    fs.writeFileSync(path.join(root, '.harness/config.yaml'), 'remote_control: false\n');
    const out = handleHook(root, 'session-start', {}) as any;
    expect(out.hookSpecificOutput.additionalContext).not.toContain('/remote-control');
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run core/test/hook-session-start.test.ts
```
Expected: FAIL — `Cannot find module '../src/hook'`

- [ ] **Step 3: 구현** (pre-tool/stop 분기는 다음 태스크에서 채움 — 여기서는 구조와 session-start만)

`core/src/hook.ts`:
```ts
import { isInitialized, readState } from './state';
import { loadConfig } from './config';
import { readWave } from './wave';
import { readRuntime, noteActivity } from './runtime';
import { DESIGN_PHASES } from './types';
import type { HarnessConfig, HarnessState } from './types';

export interface HookInput {
  hook_event_name?: string;
  source?: string;
  tool_name?: string;
  tool_input?: Record<string, any>;
  stop_hook_active?: boolean;
}

export type HookEvent = 'session-start' | 'pre-tool' | 'post-tool' | 'stop';

export function handleHook(root: string, event: HookEvent, input: HookInput): object | null {
  if (!isInitialized(root)) return null; // 비간섭: 하네스 미사용 프로젝트에서는 완전 침묵
  const state = readState(root);
  const config = loadConfig(root);
  switch (event) {
    case 'session-start': return sessionStart(root, state, config);
    case 'pre-tool': return preTool(root, state, config, input);
    case 'post-tool': noteActivity(root); return null;
    case 'stop': return stopGuard(root, state, input);
  }
}

function sessionStart(root: string, state: HarnessState, config: HarnessConfig): object {
  const lines: string[] = [
    `[king-wjang-harness] 페이즈: ${state.phase} | 활성 웨이브: ${state.activeWave ?? '없음'}`,
  ];
  if (config.remote_control) {
    lines.push('지시(1): 첫 행동으로 /remote-control 을 실행해 모바일 관제를 활성화하라.');
  }
  if (state.activeWave) {
    const { meta, body } = readWave(root, state.activeWave);
    const turnLog = body.split('## 턴 로그')[1]?.trim().split('\n').slice(-5).join('\n') ?? '(없음)';
    lines.push(
      `지시(2): 활성 웨이브 지시서 .harness/waves/${meta.id}.md 를 읽고 이어서 작업하라.`,
      `  마일스톤: ${meta.milestone} | 설계 참조: ${meta.design_refs.join(', ') || '없음'}`,
      `  최근 턴 로그:\n${turnLog}`,
      '지시(3): 작업트리에 턴 로그에 없는 변경이 있으면 로그 정산부터 하라.',
    );
  } else {
    lines.push('활성 웨이브 없음 — harness status 로 상태를 확인하고 다음 단계를 진행하라.');
  }
  if (state.backtrack) {
    lines.push(`⚠ 역행 진행 중 → ${state.backtrack.to} (사유: ${state.backtrack.reason})`);
  }
  return {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') },
  };
}

// ---- pre-tool (Task 9에서 테스트 주도로 완성) ----
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

function deny(reason: string): object {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function relPath(root: string, p: string): string {
  return p.startsWith(root) ? p.slice(root.length).replace(/^\//, '') : p;
}

function preTool(
  root: string, state: HarnessState, config: HarnessConfig, input: HookInput,
): object | null {
  const tool = input.tool_name ?? '';
  const inDesign = (DESIGN_PHASES as readonly string[]).includes(state.phase);

  if (inDesign && WRITE_TOOLS.includes(tool)) {
    const p = relPath(root, String(input.tool_input?.file_path ?? ''));
    const allowed =
      config.design_allowed_prefixes.some(pre => p.startsWith(pre)) || /^[^/]+\.md$/.test(p);
    if (!allowed) {
      return deny(
        `설계 트랙(${state.phase})에서는 소스 코드를 쓸 수 없다 (P6 설계 승인 전 구현 금지). ` +
        `허용: ${config.design_allowed_prefixes.join(', ')}, 루트 *.md. 설계 산출물을 먼저 완성하라.`,
      );
    }
  }

  if (inDesign && tool === 'Bash') {
    const cmd = String(input.tool_input?.command ?? '');
    const hit = config.design_blocked_bash.find(b => cmd.includes(b));
    if (hit) return deny(`설계 트랙에서는 배포성 명령(${hit})을 실행할 수 없다.`);
  }

  if (!inDesign && WRITE_TOOLS.includes(tool)) {
    const p = relPath(root, String(input.tool_input?.file_path ?? ''));
    if (p.startsWith('.harness/design/') && !state.backtrack) {
      return deny(
        '구축·출하 트랙에서 설계 문서를 직접 수정할 수 없다. ' +
        '설계 변경이 필요하면 `harness backtrack <페이즈> --reason "<사유>"` 로 공식 역행하라.',
      );
    }
  }
  return null;
}

// ---- stop (Task 10에서 테스트 주도로 완성) ----
function stopGuard(root: string, state: HarnessState, input: HookInput): object | null {
  if (input.stop_hook_active) return null; // 턴당 1회만 차단 (루프 가드)
  if (!state.activeWave) return null;
  const rt = readRuntime(root);
  if (!rt.lastActivityAt) return null; // 이 세션에서 도구 활동 없음 → 조용히 통과
  if (!rt.lastTurnAt || rt.lastTurnAt < rt.lastActivityAt) {
    return {
      decision: 'block',
      reason:
        `활성 웨이브 ${state.activeWave} 의 턴 로그가 마지막 작업 이후 갱신되지 않았다. ` +
        `\`harness wave update "<한 일, 다음 할 일>"\` 로 지시서를 갱신한 뒤 종료하라. ` +
        `(정말 로그가 불필요한 사소한 턴이었다면 그 사유를 한 줄 보고하고 종료해도 된다)`,
    };
  }
  return null;
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
npx vitest run core/test/hook-session-start.test.ts
```
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add core/ && git commit -m "feat(core): 훅 판정기 골격 + session-start 주입"
```

---

### Task 9: 훅 판정기 — pre-tool 차단 매트릭스 테스트

**Files:**
- Modify: `core/src/hook.ts` (Task 8 구현이 테스트를 통과하지 못하면 수정)
- Test: `core/test/hook-pre-tool.test.ts`

- [ ] **Step 1: 테스트 작성**

`core/test/hook-pre-tool.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState, writeState } from '../src/state';
import { handleHook } from '../src/hook';

const setup = (phase?: string) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  if (phase) writeState(root, { ...readState(root), phase: phase as any });
  return root;
};

const write = (root: string, p: string) => handleHook(root, 'pre-tool', {
  tool_name: 'Write', tool_input: { file_path: path.join(root, p) },
}) as any;

describe('hook: pre-tool 차단 매트릭스', () => {
  it('설계 페이즈: 소스 쓰기 차단', () => {
    const out = write(setup('P3'), 'src/index.ts');
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/설계 승인 전 구현 금지/);
  });

  it('설계 페이즈: .harness/·docs/·루트 md는 허용', () => {
    const root = setup('P3');
    expect(write(root, '.harness/design/00-concept.md')).toBeNull();
    expect(write(root, 'docs/노트.md')).toBeNull();
    expect(write(root, 'progress.md')).toBeNull();
  });

  it('설계 페이즈: 배포성 Bash 차단', () => {
    const out = handleHook(setup('P0'), 'pre-tool', {
      tool_name: 'Bash', tool_input: { command: 'docker push registry/app:1' },
    }) as any;
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('구축 페이즈: 소스 쓰기 허용, 설계 문서 직접 수정은 차단', () => {
    const root = setup('P8');
    expect(write(root, 'src/index.ts')).toBeNull();
    const out = write(root, '.harness/design/03-feature.md');
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/backtrack/);
  });

  it('구축 페이즈 + backtrack 중이면 설계 문서 수정 허용', () => {
    const root = setup('P8');
    writeState(root, { ...readState(root), backtrack: { to: 'P3', reason: '스키마 결함' } });
    expect(write(root, '.harness/design/03-feature.md')).toBeNull();
  });

  it('읽기 도구(Read 등)는 어느 페이즈든 무간섭', () => {
    expect(handleHook(setup('P0'), 'pre-tool', {
      tool_name: 'Read', tool_input: { file_path: '/x/src/a.ts' },
    })).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 통과 확인** (실패 시 Task 8의 preTool 구현을 수정)

```bash
npx vitest run core/test/hook-pre-tool.test.ts
```
Expected: 6 passed

- [ ] **Step 3: Commit**

```bash
git add core/ && git commit -m "test(core): pre-tool 차단 매트릭스 커버 — 설계 중 구현 금지·역행 경로 안내"
```

---

### Task 10: 훅 판정기 — stop 가드 테스트

**Files:**
- Modify: `core/src/hook.ts` (필요 시)
- Test: `core/test/hook-stop.test.ts`

- [ ] **Step 1: 테스트 작성**

`core/test/hook-stop.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { createWave, activateWave, logTurn } from '../src/wave';
import { noteActivity } from '../src/runtime';
import { handleHook } from '../src/hook';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  createWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
  activateWave(root, 'wave-001');
  return root;
};

describe('hook: stop 가드', () => {
  it('작업 후 턴 로그 미갱신 → 차단', () => {
    const root = setup();
    noteActivity(root); // 도구 활동 발생
    const out = handleHook(root, 'stop', {}) as any;
    expect(out.decision).toBe('block');
    expect(out.reason).toMatch(/harness wave update/);
  });

  it('로그 갱신이 활동보다 나중이면 통과', async () => {
    const root = setup();
    noteActivity(root);
    await new Promise(r => setTimeout(r, 5));
    logTurn(root, '정리 완료');
    expect(handleHook(root, 'stop', {})).toBeNull();
  });

  it('stop_hook_active=true면 무조건 통과 (루프 가드)', () => {
    const root = setup();
    noteActivity(root);
    expect(handleHook(root, 'stop', { stop_hook_active: true })).toBeNull();
  });

  it('활성 웨이브 없으면 통과', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
    initHarness(root);
    noteActivity(root);
    expect(handleHook(root, 'stop', {})).toBeNull();
  });

  it('이 세션 도구 활동이 없으면 통과', () => {
    expect(handleHook(setup(), 'stop', {})).toBeNull();
  });

  it('post-tool이 activity를 기록한다 (배선 확인)', () => {
    const root = setup();
    handleHook(root, 'post-tool', { tool_name: 'Bash' });
    const out = handleHook(root, 'stop', {}) as any;
    expect(out.decision).toBe('block');
  });
});
```

- [ ] **Step 2: 테스트 실행 → 통과 확인** (실패 시 stopGuard 수정)

```bash
npx vitest run core/test/hook-stop.test.ts
```
Expected: 6 passed

- [ ] **Step 3: Commit**

```bash
git add core/ && git commit -m "test(core): stop 가드 — 턴 로그 신선도 차단 + 루프 가드"
```

---

### Task 11: doctor — 무결성 검사·재생 복구

**Files:**
- Create: `core/src/doctor.ts`
- Test: `core/test/doctor.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`core/test/doctor.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState } from '../src/state';
import { appendEvent } from '../src/events';
import { statePath } from '../src/paths';
import { runDoctor } from '../src/doctor';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

describe('doctor', () => {
  it('정합 상태면 ok', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P1' });
    const s = readState(root);
    fs.writeFileSync(statePath(root), JSON.stringify({ ...s, phase: 'P1' }, null, 2));
    expect(runDoctor(root).ok).toBe(true);
  });

  it('state 손상(파싱 불가) → repair가 이벤트 재생으로 복구', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P7' });
    appendEvent(root, 'wave-activated', { id: 'wave-001' });
    fs.writeFileSync(statePath(root), '{corrupted');
    const r = runDoctor(root, { repair: true });
    expect(r.repaired).toBe(true);
    expect(readState(root).phase).toBe('P7');
    expect(readState(root).activeWave).toBe('wave-001');
  });

  it('state-이벤트 불일치를 보고한다 (repair 없이는 수정 안 함)', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P2' });
    const r = runDoctor(root); // state.json은 여전히 P0
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/phase/);
    expect(readState(root).phase).toBe('P0');
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run core/test/doctor.test.ts
```
Expected: FAIL — `Cannot find module '../src/doctor'`

- [ ] **Step 3: 구현**

`core/src/doctor.ts`:
```ts
import * as fs from 'node:fs';
import { statePath } from './paths';
import { readEvents, replayState } from './events';
import { writeState, readState } from './state';
import type { HarnessState } from './types';

export interface DoctorReport {
  ok: boolean;
  repaired: boolean;
  issues: string[];
}

export function runDoctor(root: string, opts: { repair?: boolean } = {}): DoctorReport {
  const issues: string[] = [];
  const replayed = replayState(readEvents(root));

  let current: HarnessState | null = null;
  try {
    current = readState(root);
  } catch {
    issues.push('state.json 을 파싱할 수 없다 (손상)');
  }

  if (current) {
    if (current.phase !== replayed.phase) {
      issues.push(`phase 불일치: state=${current.phase}, 이벤트 재생=${replayed.phase}`);
    }
    if (current.activeWave !== replayed.activeWave) {
      issues.push(`activeWave 불일치: state=${current.activeWave}, 이벤트 재생=${replayed.activeWave}`);
    }
  }

  let repaired = false;
  if (issues.length > 0 && opts.repair) {
    // 이벤트가 진실 — 재생 결과로 state를 재작성
    if (!fs.existsSync(statePath(root))) fs.writeFileSync(statePath(root), '{}');
    writeState(root, replayed);
    repaired = true;
  }

  return { ok: issues.length === 0, repaired, issues };
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
npx vitest run core/test/doctor.test.ts
```
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add core/ && git commit -m "feat(core): doctor — 이벤트 재생 기반 무결성 검사·복구"
```

---

### Task 12: CLI 디스패치

**Files:**
- Modify: `core/src/cli.ts` (Task 1 스텁 교체)
- Test: `core/test/cli.test.ts`

명령 표면 (v0):
```
harness init | status | doctor [--repair]
harness phase set <P0..P12>            # v0 임시 — 로드맵 2에서 게이트로 대체
harness wave create --milestone <m> --goal <g> [--refs F-1,UX-2] [--accept "a","b"]
harness wave activate <id> | update "<로그>" | complete | list
harness node upsert --id <id> --title <t> [--parent] [--anchor] [--status]
harness node bump <id>                 # version++ → 영향 웨이브 자동 STALE 마킹
harness backtrack <phase> --reason "<r>" | backtrack clear
harness hook <session-start|pre-tool|post-tool|stop>   # stdin JSON → stdout JSON
```

- [ ] **Step 1: 실패하는 테스트 작성** (CLI는 함수 직접 호출로 테스트 — 프로세스 spawn 불필요)

`core/test/cli.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';
import { readState } from '../src/state';
import { readWave, listWaves } from '../src/wave';
import { getNode } from '../src/ledger';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));

describe('cli', () => {
  it('init → status', () => {
    const root = tmp();
    expect(run(['init'], root)).toBe(0);
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation(m => { logs.push(String(m)); });
    expect(run(['status'], root)).toBe(0);
    spy.mockRestore();
    expect(logs.join('\n')).toContain('P0');
  });

  it('phase set + wave 수명주기', () => {
    const root = tmp();
    run(['init'], root);
    run(['phase', 'set', 'P8'], root);
    expect(readState(root).phase).toBe('P8');
    run(['wave', 'create', '--milestone', 'M1', '--goal', '로그인', '--refs', 'F-1'], root);
    run(['wave', 'activate', 'wave-001'], root);
    run(['wave', 'update', '골격 완료'], root);
    run(['wave', 'complete'], root);
    expect(readWave(root, 'wave-001').meta.status).toBe('done');
  });

  it('node upsert + bump → 참조 웨이브 STALE', () => {
    const root = tmp();
    run(['init'], root);
    run(['node', 'upsert', '--id', 'F-1', '--title', '로그인'], root);
    run(['wave', 'create', '--milestone', 'M1', '--goal', 'a', '--refs', 'F-1'], root);
    run(['node', 'bump', 'F-1'], root);
    expect(getNode(root, 'F-1')?.version).toBe(2);
    expect(listWaves(root)[0].status).toBe('stale');
  });

  it('backtrack set/clear', () => {
    const root = tmp();
    run(['init'], root);
    run(['backtrack', 'P3', '--reason', '스키마 결함'], root);
    expect(readState(root).backtrack?.to).toBe('P3');
    run(['backtrack', 'clear'], root);
    expect(readState(root).backtrack).toBeNull();
  });

  it('잘못된 명령은 exit 1 + 에러 메시지', () => {
    expect(run(['없는명령'], tmp())).toBe(1);
  });

  it('에러(활성 웨이브 없이 complete)는 exit 1', () => {
    const root = tmp();
    run(['init'], root);
    expect(run(['wave', 'complete'], root)).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run core/test/cli.test.ts
```
Expected: FAIL — `run` export 없음

- [ ] **Step 3: 구현**

`core/src/cli.ts` (전체 교체):
```ts
import { initHarness, readState, writeState } from './state';
import { appendEvent } from './events';
import { createWave, activateWave, logTurn, completeWave, listWaves, markStale } from './wave';
import { upsertNode, bumpNode } from './ledger';
import { runDoctor } from './doctor';
import { handleHook, HookEvent, HookInput } from './hook';
import { PHASES } from './types';
import type { Phase } from './types';

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** exit code를 반환 — 테스트에서 직접 호출 가능 */
export function run(argv: string[], root: string): number {
  try {
    const [cmd, sub, ...rest] = argv;
    switch (cmd) {
      case 'init':
        initHarness(root);
        appendEvent(root, 'init', {});
        console.log('.harness/ 초기화 완료');
        return 0;

      case 'status': {
        const s = readState(root);
        console.log(JSON.stringify(s, null, 2));
        return 0;
      }

      case 'doctor': {
        const r = runDoctor(root, { repair: argv.includes('--repair') });
        console.log(JSON.stringify(r, null, 2));
        return r.ok || r.repaired ? 0 : 1;
      }

      case 'phase': {
        if (sub !== 'set') throw new Error('사용법: harness phase set <P0..P12>');
        const phase = rest[0] as Phase;
        if (!PHASES.includes(phase)) throw new Error(`유효하지 않은 페이즈: ${rest[0]}`);
        writeState(root, { ...readState(root), phase });
        appendEvent(root, 'phase-set', { phase });
        console.log(`페이즈 → ${phase} (v0 임시 명령 — 게이트 구현 후 대체 예정)`);
        return 0;
      }

      case 'wave': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'create': {
            const meta = createWave(root, {
              milestone: flag(args, 'milestone') ?? '(미지정)',
              goal: flag(args, 'goal') ?? '(미지정)',
              design_refs: (flag(args, 'refs') ?? '').split(',').filter(Boolean),
              acceptance: (flag(args, 'accept') ?? '').split(',').filter(Boolean),
            });
            console.log(meta.id);
            return 0;
          }
          case 'activate': activateWave(root, rest[0]); console.log(`활성: ${rest[0]}`); return 0;
          case 'update': logTurn(root, rest.join(' ')); console.log('턴 로그 기록'); return 0;
          case 'complete': completeWave(root); console.log('웨이브 완료'); return 0;
          case 'list': console.log(JSON.stringify(listWaves(root), null, 2)); return 0;
          default: throw new Error(`알 수 없는 wave 하위 명령: ${sub}`);
        }
      }

      case 'node': {
        const args = [sub, ...rest];
        if (sub === 'upsert') {
          const id = flag(args, 'id');
          const title = flag(args, 'title');
          if (!id || !title) throw new Error('사용법: harness node upsert --id <id> --title <제목>');
          upsertNode(root, {
            id, title,
            parent: flag(args, 'parent'),
            doc_anchor: flag(args, 'anchor'),
            version: 1,
            status: (flag(args, 'status') as any) ?? 'draft',
          });
          appendEvent(root, 'node-upserted', { id });
          console.log(id);
          return 0;
        }
        if (sub === 'bump') {
          const { node, affectedWaves } = bumpNode(root, rest[0]);
          for (const w of affectedWaves) markStale(root, w);
          appendEvent(root, 'node-bumped', { id: node.id, version: node.version, staleWaves: affectedWaves });
          console.log(`${node.id} v${node.version} — STALE 웨이브: ${affectedWaves.join(', ') || '없음'}`);
          return 0;
        }
        throw new Error(`알 수 없는 node 하위 명령: ${sub}`);
      }

      case 'backtrack': {
        if (sub === 'clear') {
          writeState(root, { ...readState(root), backtrack: null });
          appendEvent(root, 'backtrack-cleared', {});
          console.log('역행 종료');
          return 0;
        }
        const to = sub as Phase;
        if (!PHASES.includes(to)) throw new Error(`유효하지 않은 페이즈: ${sub}`);
        const reason = flag(rest, 'reason') ?? '(미기재)';
        writeState(root, { ...readState(root), backtrack: { to, reason } });
        appendEvent(root, 'backtrack-started', { to, reason });
        console.log(`역행 시작 → ${to}: ${reason}`);
        return 0;
      }

      case 'hook': {
        const event = sub as HookEvent;
        let input: HookInput = {};
        try {
          const raw = require('node:fs').readFileSync(0, 'utf8');
          if (raw.trim()) input = JSON.parse(raw);
        } catch { /* stdin 없음/비JSON → 빈 입력으로 진행 */ }
        const out = handleHook(root, event, input);
        if (out) console.log(JSON.stringify(out));
        return 0; // 훅은 어떤 경우에도 세션을 깨지 않는다
      }

      case '--version':
        console.log('king-wjang-harness core v0');
        return 0;

      default:
        console.error(`알 수 없는 명령: ${argv.join(' ') || '(없음)'}`);
        return 1;
    }
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    return 1;
  }
}

export function main(argv: string[]): void {
  process.exitCode = run(argv, process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
}

if (require.main === module) main(process.argv.slice(2));
```

- [ ] **Step 4: 테스트 전체 실행 → 통과 확인**

```bash
npx vitest run
```
Expected: 모든 테스트 passed (config 2, state 5, events 3, ledger 4, wave 6, runtime 2, hook-session 3, hook-pre 6, hook-stop 6, doctor 3, cli 6)

- [ ] **Step 5: Commit**

```bash
git add core/ && git commit -m "feat(core): CLI 디스패치 — init/status/phase/wave/node/backtrack/hook/doctor"
```

---

### Task 13: 훅 배선 + 실전 스모크

**Files:**
- Create: `hooks/hooks.json`
- Modify: `.gitignore` (없으면 유지)

- [ ] **Step 1: hooks.json 작성** (플러그인 훅 배선 — `${CLAUDE_PLUGIN_ROOT}`는 플러그인 설치 경로로 치환됨)

`hooks/hooks.json`:
```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}/bin/harness\" hook session-start", "timeout": 10 } ] }
    ],
    "PreToolUse": [
      { "matcher": "Write|Edit|MultiEdit|NotebookEdit|Bash",
        "hooks": [ { "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}/bin/harness\" hook pre-tool", "timeout": 10 } ] }
    ],
    "PostToolUse": [
      { "matcher": "*",
        "hooks": [ { "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}/bin/harness\" hook post-tool", "timeout": 10 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "\"${CLAUDE_PLUGIN_ROOT}/bin/harness\" hook stop", "timeout": 10 } ] }
    ]
  }
}
```

참고: 훅 JSON 스키마가 현재 Claude Code 버전과 맞는지 https://docs.claude.com/en/docs/claude-code/hooks 로 확인하고, 다르면 이 파일만 조정한다 (판정기 출력 계약은 hook.ts 한 곳에 있음).

- [ ] **Step 2: 빌드 후 CLI 스모크 (임시 디렉토리에서 실전 시나리오)**

```bash
npm run build && cd "$(mktemp -d)" && \
"$OLDPWD/bin/harness" init && \
"$OLDPWD/bin/harness" phase set P8 && \
"$OLDPWD/bin/harness" wave create --milestone M1 --goal 스모크 --refs F-1 && \
"$OLDPWD/bin/harness" wave activate wave-001 && \
echo '{"tool_name":"Write","tool_input":{"file_path":"src/a.ts"}}' | "$OLDPWD/bin/harness" hook pre-tool && \
"$OLDPWD/bin/harness" wave update "스모크 로그" && \
"$OLDPWD/bin/harness" wave complete && \
"$OLDPWD/bin/harness" doctor && cd "$OLDPWD"
```
Expected: 전 명령 성공, pre-tool은 P8이므로 출력 없음(허용), doctor `"ok": true`

- [ ] **Step 3: 설계 페이즈 차단 스모크**

```bash
cd "$(mktemp -d)" && "$OLDPWD/bin/harness" init && \
echo '{"tool_name":"Write","tool_input":{"file_path":"src/a.ts"}}' | "$OLDPWD/bin/harness" hook pre-tool && cd "$OLDPWD"
```
Expected: `permissionDecision":"deny"` 를 포함한 JSON 한 줄 (P0에서 소스 쓰기 차단)

- [ ] **Step 4: Commit**

```bash
git add hooks/ && git commit -m "feat: 훅 배선 hooks.json — 전 이벤트 harness hook 한 줄"
```

---

### Task 14: 마무리 — 타입체크·전체 테스트·핸드오프

- [ ] **Step 1: 전체 검증**

```bash
npm run check && npm run test && npm run build
```
Expected: 타입 에러 0, 전 테스트 passed, 빌드 성공

- [ ] **Step 2: progress.md 갱신** — 완료(코어 엔진 v0), 다음(로드맵 2: 게이트·리뷰 패킷·아티팩트 발행 강제), 함정(훅 JSON 스키마는 Claude Code 버전 종속 — hook.ts 한 곳에서 관리) 기록

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: 코어 엔진 v0 완료 — 핸드오프 갱신"
```

---

## Self-Review 결과

- **스펙 커버리지**: §1 코어+훅 어댑터(Task 1~13), §3-1 저장소(T3), §3-2 원장(T5), §3-3 웨이브(T6), §3-6 연속성 중 원자적 쓰기·재생 복구·doctor(T3/T4/T11), §3-6a remote-control 주입(T8), §4-1 배선(T13), §4-2 차단 매트릭스(T9), 스펙 §13-1 범위 일치. 게이트(§4-3)·티어(§4-4 일부)·MCP 어댑터는 의도적 제외(로드맵 2·7) — v0 임시 `phase set`으로 대체함을 T12에 명시.
- **플레이스홀더**: 없음 — 전 태스크 실코드·실명령·기대 출력 포함.
- **타입 일관성**: `HarnessState`·`WaveMeta`·`LedgerNode` 시그니처를 Task 2에서 고정, 이후 태스크가 동일 시그니처 사용 확인. `run(argv, root)` 시그니처 T12 테스트·구현 일치.
