#!/usr/bin/env node
/**
 * [PROD-180] **광고한 수치는 받는 사람이 다시 잴 수 있어야 한다.**
 *
 * README 의 「Measured」 표는 정직했지만 **제3자가 재현할 수 없었다** — 벤치 스크립트도,
 * 저널 픽스처도, 방법론(표본 수·백분위·워밍업·측정 표면)도 패키지에 실려 있지 않았다.
 * 수치가 맞는지 틀리는지 이전에, 확인할 방법이 없는 숫자는 주장일 뿐이다.
 *
 * 이 스크립트는 **설치한 그대로** 돌아간다(빌드·의존성 추가 없음):
 *
 *     node scripts/bench-hook-latency.mjs
 *
 * 재는 것은 훅의 **프로세스 wall-time** 이다 — 사용자가 도구 호출마다 실제로 기다리는 값.
 * 그리고 `node` 기동 바닥값을 **함께** 찍는다. 그 값을 빼지 않으면 이 표는 제품이 아니라
 * 측정 머신의 CPU 를 재게 된다(`docs/.../gates.md` 의 G9 절이 그 이야기다).
 *
 * 저널을 부류별로 만드는 이유: 폴백은 **손상 상태를 살아남으려고** 있는 경로다. 가장
 * 친화적인 저널 하나만 재면 그 경로가 가장 필요할 때 얼마나 드는지 알 수 없다([COST-177]).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hook = path.join(repo, 'bin', 'harness-hook');
const cli = path.join(repo, 'bin', 'harness');

const LINES = Number(process.env.BENCH_LINES ?? 100_000);
const N = Number(process.env.BENCH_N ?? 30);
const WARMUP = 3;
const PAYLOAD = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } });

/** 저널 부류. 앞의 둘은 실제로 도달 가능한 상태이고, 마지막은 적대적 입력이다. */
const SHAPES = {
  realistic: i => (i % 10 === 0
    ? { ts: 'T', type: 'phase-set', data: { phase: 'P7' } }
    : { ts: 'T', type: 'wave-turn-logged', data: { id: 'w', note: 'x'.repeat(40) } }),
  corrupt: () => null,
  'all-state': () => ({ ts: 'T', type: 'phase-set', data: { phase: 'P7' } }),
};

const pct = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

function timeIt(fn) {
  for (let i = 0; i < WARMUP; i++) fn();
  const xs = [];
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    xs.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return { p50: pct(xs, 0.5), p95: pct(xs, 0.95) };
}

function makeProject(shape) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bench-'));
  execFileSync(cli, ['init'], { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, stdio: 'ignore' });
  const mk = SHAPES[shape];
  const out = [];
  for (let i = 0; i < LINES; i++) {
    const ev = mk(i);
    out.push(ev === null ? '{broken line ' + 'x'.repeat(40) : JSON.stringify(ev));
  }
  fs.appendFileSync(path.join(root, '.harness', 'events.jsonl'), out.join('\n') + '\n');
  return root;
}

const runHook = root => () => execFileSync(hook, ['pre-tool'], {
  cwd: root, input: PAYLOAD, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, stdio: ['pipe', 'pipe', 'ignore'],
});

const baseline = timeIt(() => execFileSync(process.execPath, ['-e', ''], { stdio: 'ignore' }));

console.log(`# 훅 지연 — 프로세스 wall-time (사용자가 도구 호출마다 기다리는 값)`);
console.log(`# node ${process.version} · ${os.arch()} · ${os.cpus().length} cores · load ${os.loadavg().map(x => x.toFixed(2)).join(' ')}`);
console.log(`# 저널 ${LINES.toLocaleString()}줄 · n=${N} · 워밍업 ${WARMUP}회 제외`);
console.log(`# node 기동 바닥값: p50 ${baseline.p50.toFixed(1)}ms · p95 ${baseline.p95.toFixed(1)}ms`);
console.log(`#   ↑ 이 값은 제품이 아니라 이 머신의 것이다. 아래 절대값에서 이만큼은 제품 몫이 아니다.`);
console.log();
console.log('| 저널 부류 | 정상 p95 | 열화(폴백) p95 | 폴백이 더하는 값 |');
console.log('|---|---|---|---|');

for (const shape of Object.keys(SHAPES)) {
  const root = makeProject(shape);
  const run = runHook(root);
  const normal = timeIt(run);
  fs.rmSync(path.join(root, '.harness', 'state.json'));   // 열화 = 캐시 없음 → 저널 재생
  const degraded = timeIt(run);
  const delta = degraded.p95 - normal.p95;
  console.log(`| ${shape} | ${normal.p95.toFixed(1)}ms | ${degraded.p95.toFixed(1)}ms | **+${delta.toFixed(1)}ms** |`);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log();
console.log('게이트(G9)는 마지막 열에 걸린다 — **폴백이 더하는 p95 < 50ms**. 절대값이 아니라 델타인');
console.log('이유는 절대값의 큰 몫이 위의 node 기동이고, 그것은 제품이 통제하는 값이 아니기 때문이다.');
console.log('`all-state` 는 적대적 입력이라 문턱을 걸지 않고 기록만 한다 — 저널은 harness 명령으로만');
console.log('늘어나므로 10만 번의 상태 전이는 실제 프로젝트에서 도달할 수 없다.');
