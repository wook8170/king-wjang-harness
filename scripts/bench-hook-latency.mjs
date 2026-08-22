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

/**
 * [PROD-190] 이 스크립트는 **영어 사용자가 읽으라고** README 가 광고하는 도구다.
 * 제품 규칙(기본 영어 · `HARNESS_LANG=ko` 로만 전환)을 여기서도 지킨다 —
 * 광고된 재현 절차가 읽히지 않으면 재현 절차가 아니다.
 */
const ko = (process.env.HARNESS_LANG ?? '') === 'ko';
const L = (en, k) => (ko ? k : en);

/** [PROD-191] 게이트 문턱(ms). 출력이 문턱만 말하고 판정을 안 하면 사람이 직접 채점하게 된다. */
const GATE_MS = 50;
/** 부하가 있으면 wall-time p95 는 제품이 아니라 경쟁 프로세스를 잰다. 그 사실을 말해 준다. */
const LOAD_1M = os.loadavg()[0];
const BUSY = LOAD_1M > os.cpus().length * 0.5;

console.log(L('# Hook latency — process wall-time (what you wait for on every tool call)',
              '# 훅 지연 — 프로세스 wall-time (도구 호출마다 실제로 기다리는 값)'));
console.log(`# node ${process.version} · ${os.arch()} · ${os.cpus().length} cores · load ${os.loadavg().map(x => x.toFixed(2)).join(' ')}`);
console.log(L(`# journal ${LINES.toLocaleString()} entries · n=${N} · ${WARMUP} warm-up runs discarded`,
              `# 저널 ${LINES.toLocaleString()}줄 · n=${N} · 워밍업 ${WARMUP}회 제외`));
console.log(L(`# \`node\` startup floor on this machine: p50 ${baseline.p50.toFixed(1)}ms · p95 ${baseline.p95.toFixed(1)}ms`,
              `# 이 머신의 \`node\` 기동 바닥값: p50 ${baseline.p50.toFixed(1)}ms · p95 ${baseline.p95.toFixed(1)}ms`));
console.log(L('#   ^ that floor belongs to your machine, not to this tool. Every absolute number below includes it.',
              '#   ↑ 이 값은 제품이 아니라 이 머신의 것이다. 아래 절대값은 전부 이 바닥을 포함한다.'));
if (BUSY) {
  console.log();
  console.log(L(`# !! This machine is busy (1-min load ${LOAD_1M.toFixed(2)} on ${os.cpus().length} cores).`,
                `# !! 이 머신은 지금 바쁘다 (1분 load ${LOAD_1M.toFixed(2)} · ${os.cpus().length} 코어).`));
  console.log(L('#    Wall-time p95 measures whatever else is running too. Re-run on an idle machine before',
                '#    wall-time p95 는 같이 도는 것들까지 잰다. 판정하기 전에 유휴 상태에서 다시 돌려라 —'));
  console.log(L('#    reading a verdict below — a busy box can inflate the delta several-fold.',
                '#    바쁜 머신에서는 델타가 몇 배로 부풀 수 있다.'));
}
console.log();
console.log(L('| Journal shape | Normal p95 | Degraded (fallback) p95 | Fallback adds | Gate |',
              '| 저널 부류 | 정상 p95 | 열화(폴백) p95 | 폴백이 더하는 값 | 게이트 |'));
console.log('|---|---|---|---|---|');

const GATED = new Set(['realistic', 'corrupt']);
let failed = 0;
for (const shape of Object.keys(SHAPES)) {
  const root = makeProject(shape);
  const run = runHook(root);
  const normal = timeIt(run);
  fs.rmSync(path.join(root, '.harness', 'state.json'));   // 열화 = 캐시 없음 → 저널 재생
  const degraded = timeIt(run);
  const delta = degraded.p95 - normal.p95;
  const sign = delta >= 0 ? '+' : '';                     // [PROD-192] 음수를 `+-` 로 찍지 않는다
  let verdict;
  if (!GATED.has(shape)) {
    verdict = L('recorded only', '기록만');
  } else if (delta < GATE_MS) {
    verdict = L('PASS', '충족');
  } else {
    verdict = BUSY ? L('over — machine busy', '초과 — 머신 부하') : L('**FAIL**', '**미충족**');
    if (!BUSY) failed++;
  }
  console.log(`| ${shape} | ${normal.p95.toFixed(1)}ms | ${degraded.p95.toFixed(1)}ms | **${sign}${delta.toFixed(1)}ms** | ${verdict} |`);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log();
console.log(L(`Gate G9 is on the last column — **the fallback must add less than ${GATE_MS}ms p95**.`,
              `게이트(G9)는 마지막 열에 걸린다 — **폴백이 더하는 p95 < ${GATE_MS}ms**.`));
console.log(L('It is a delta, not an absolute, because most of any absolute figure is the `node` startup',
              '절대값이 아니라 델타인 이유는 절대값의 큰 몫이 위의 node 기동이고,'));
console.log(L('above — a number this tool does not control.',
              '그것은 제품이 통제하는 값이 아니기 때문이다.'));
console.log(L('`all-state` (every line a state transition) is adversarial input: recorded, not gated. The',
              '`all-state`(전 줄이 상태 전이)는 적대적 입력이라 문턱을 걸지 않고 기록만 한다 —'));
console.log(L('journal only grows through harness commands, so 100,000 transitions is not reachable.',
              '저널은 harness 명령으로만 늘어나므로 10만 번의 상태 전이는 도달할 수 없다.'));
if (failed > 0) {
  console.log();
  console.log(L(`${failed} gated shape(s) exceeded the threshold on an idle machine — that is a real regression.`,
                `유휴 상태에서 ${failed}개 부류가 문턱을 넘었다 — 이것은 진짜 회귀다.`));
}
