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
 * [PROD-211] **광고한 두 표면을 둘 다 싣는다.**
 *
 * 게이트(G9)는 「인프로세스·프로세스 wall-time **두 표면 모두**」로 적혀 있는데, 이 벤치는
 * wall-time 만 실어 보냈다. 그래서 README 가 「p95 2.6ms 인프로세스」라고 광고한 수치를
 * **받는 사람이 다시 잴 수 없었다** — 재현 절차가 없는 수치는 [PROD-180] 이 지운 것과 같은
 * 부류의 주장이다. 두 표면이 필요한 이유는 서로 다른 것을 재기 때문이다:
 *
 * - **wall-time** = 도구 호출마다 실제로 기다리는 값(대부분이 `node` 기동 + 번들 로드).
 * - **인프로세스** = 번들이 이미 메모리에 있을 때 **판정 자체**가 쓰는 시간.
 *
 * 인프로세스는 별도 자식 프로세스에서 잰다 — 이 프로세스가 번들을 `require` 하면 벤치가
 * 자기 자신을 오염시키고(모듈 캐시·GC), 저널 부류마다 상태가 섞인다.
 *
 * 자식은 CLI 의 stdin 계약(「fd 0 을 읽는다」)을 그대로 만족시킬 방법이 없다 — fd 0 은
 * 한 번 읽으면 위치가 EOF 라 두 번째 반복이 빈 입력을 받는다. 그래서 `fs.readFileSync` 의
 * **fd 0 분기만** 가로챈다. 다른 경로는 원본 그대로다.
 */
const INPROC_CHILD = `
const fs = require('node:fs');
const [bundle, root, payload, n, warm] = process.argv.slice(1);
const orig = fs.readFileSync;
fs.readFileSync = function (p, ...a) { return p === 0 ? payload : orig.call(this, p, ...a); };
const { run } = require(bundle);
const say = console.log;
console.log = () => {};                       // 훅 stdout 이 계측·출력에 섞이지 않게
const once = () => run(['hook', 'pre-tool'], root);
for (let i = 0; i < Number(warm); i++) once();
const xs = [];
for (let i = 0; i < Number(n); i++) {
  const t0 = process.hrtime.bigint();
  once();
  xs.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
console.log = say;
xs.sort((a, b) => a - b);
const pct = p => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))];
console.log(JSON.stringify({ p50: pct(0.5), p95: pct(0.95) }));
`;

const bundle = path.join(repo, 'core', 'dist', 'cli.js');

function inProcess(root) {
  const out = execFileSync(process.execPath,
    ['-e', INPROC_CHILD, '--', bundle, root, PAYLOAD, String(N), String(WARMUP)],
    { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out.trim().split('\n').pop());
}

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

console.log(L('# Hook latency — two surfaces: in-process (the judgement itself) and process wall-time',
              '# 훅 지연 — 두 표면: 인프로세스(판정 자체)와 프로세스 wall-time'));
console.log(L('#   wall-time is what you wait for on every tool call; in-process is what this tool costs',
              '#   wall-time 은 도구 호출마다 기다리는 값이고, 인프로세스는 `node` 기동·번들 로드를'));
console.log(L('#   once `node` startup and bundle loading are excluded. The gate applies to both.',
              '#   뺀 뒤 이 도구가 쓰는 값이다. 게이트는 **둘 다** 에 걸린다.'));
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
  console.log(L('#    Every verdict below is marked "machine busy" — passes included. Load moves the delta',
                '#    아래 판정은 **충족도 포함해** 전부 「머신 부하」로 표기된다. 부하는 델타를 양쪽으로'));
  console.log(L('#    both ways, so a pass measured here is not a pass either.',
                '#    움직이므로, 여기서 나온 충족도 충족이 아니다.'));
}
console.log();
console.log(L('| Journal shape | Surface | Normal p95 | Degraded (fallback) p95 | Fallback adds | Gate |',
              '| 저널 부류 | 표면 | 정상 p95 | 열화(폴백) p95 | 폴백이 더하는 값 | 게이트 |'));
console.log('|---|---|---|---|---|---|');

const GATED = new Set(['realistic', 'corrupt']);
let failed = 0;
for (const shape of Object.keys(SHAPES)) {
  const root = makeProject(shape);
  const run = runHook(root);
  const state = path.join(root, '.harness', 'state.json');
  const keep = fs.readFileSync(state);
  // 인프로세스를 먼저 잰다 — 뒤에 오는 wall-time 측정이 파일 캐시를 데워 놓으면 두 표면이
  // 같은 조건에서 재지지 않는다.
  const inNormal = inProcess(root);
  fs.rmSync(state);                                       // 열화 = 캐시 없음 → 저널 재생
  const inDegraded = inProcess(root);
  fs.writeFileSync(state, keep);
  const normal = timeIt(run);
  fs.rmSync(state);
  const degraded = timeIt(run);
  for (const [surface, a, b] of [
    [L('in-process', '인프로세스'), inNormal, inDegraded],
    [L('wall-time', 'wall-time'), normal, degraded],
  ]) {
  const delta = b.p95 - a.p95;
  const sign = delta >= 0 ? '+' : '';                     // [PROD-192] 음수를 `+-` 로 찍지 않는다
  let verdict;
  if (!GATED.has(shape)) {
    verdict = L('recorded only', '기록만');
  } else if (delta < GATE_MS) {
    /**
     * [PROD-212] **부하 표시는 양쪽에 똑같이 붙인다.**
     *
     * 예전에는 초과만 「머신 부하」로 유보하고 충족은 그냥 `PASS` 로 찍었다 — 같은 신뢰도의
     * 측정에 한쪽만 별표를 다는 것이라, 바쁜 머신에서 돌린 사람이 **통과만 확정으로 읽었다.**
     * 부하는 델타를 부풀리기도 하고(정상 p95 가 함께 뛰면) 줄이기도 한다. 신뢰할 수 없는 것은
     * 판정 자체이지 판정의 한쪽 방향이 아니다.
     */
    verdict = BUSY ? L('pass — machine busy', '충족 — 머신 부하') : L('PASS', '충족');
  } else {
    verdict = BUSY ? L('over — machine busy', '초과 — 머신 부하') : L('**FAIL**', '**미충족**');
    if (!BUSY) failed++;
  }
  console.log(`| ${shape} | ${surface} | ${a.p95.toFixed(1)}ms | ${b.p95.toFixed(1)}ms | `
    + `**${sign}${delta.toFixed(1)}ms** | ${verdict} |`);
  }
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
console.log(L('journal only grows through harness commands, so reaching 100,000 transitions means running',
              '저널은 harness 명령으로만 늘어나므로 10만 번의 상태 전이를 쌓으려면 명령을 10만 번'));
console.log(L('100,000 of them — hard to reach in practice, though nothing caps it.',
              '불러야 한다 — 현실적으로 도달하기 어렵지만, 상한이 있는 것은 아니다.'));
/**
 * [ENG-201] **게이트는 자동으로 검사할 수 있는 형태여야 한다.**
 *
 * 이 스크립트는 늘 exit 0 이었다 — 사람이 표를 읽고 직접 채점해야 했고, CI 에 걸 수 없었다.
 * 게이트를 「문서에만 있는 기준」으로 두면 회귀는 사람이 안 볼 때 지나간다.
 * 부하 중 초과는 실패로 세지 않는다(측정 머신을 재는 것이므로) — 대신 그 사실을 위에서 말한다.
 */
if (failed > 0) {
  console.log();
  console.log(L(`${failed} gated shape(s) exceeded the threshold on an idle machine — that is a real regression.`,
                `유휴 상태에서 ${failed}개 부류가 문턱을 넘었다 — 이것은 진짜 회귀다.`));
  process.exitCode = 1;
}
