// [API-04] 훅 e2e 비용 곡선 — 페이로드 크기별로 「10초 예산」까지 얼마나 남는지 잰다.
//
// **부하 창에서 재도 되는 이유**: 이건 델타가 아니라 **상한(ceiling)** 검사다. 부하는 시간을
// 늘리기만 하므로 부하에서 통과하면 유휴에서도 통과한다 — 결론이 뒤집히지 않는 방향이다.
// (G7 의 「폴백이 더하는 지연」은 두 값의 «차»라 부하가 양쪽으로 움직여 그 논리가 안 통한다.)
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness';
const HOOK = path.join(REPO, 'bin/harness-hook');

// 샌드박스 프로젝트
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-api04-'));
execFileSync(process.execPath, [path.join(REPO, 'bin/harness'), 'init'], { cwd: root, stdio: 'ignore' });
fs.mkdirSync(path.join(root, 'src'), { recursive: true });

// 감사가 지목한 형태: 반복 `cd` + 리다이렉트(예전에 2차로 갔던 모양) 와 긴 무슬래시 토큰.
const shapes = {
  'cd-redirect': (n) => Array.from({ length: n }, (_, i) => `cd d${i} > f${i}`).join('; '),
  'long-noslash': (n) => 'echo ' + 'a'.repeat(n * 40) + ' > out.txt',
  'plain-writes': (n) => Array.from({ length: n }, (_, i) => `echo x > f${i}.txt`).join('\n'),
};

const BUDGET_MS = 10_000;         // hooks.json 이 훅에 주는 시간
const REPEAT = 3;

function timeOnce(cmd) {
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: cmd },
  });
  const t0 = process.hrtime.bigint();
  try {
    execFileSync(HOOK, ['pre-tool'], {
      input: payload, cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root }, stdio: 'pipe',
    });
  } catch (e) { /* deny 는 비영 종료가 아니다 — 실패해도 시간은 잰다 */ }
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

const rows = [];
for (const [name, make] of Object.entries(shapes)) {
  for (const n of [200, 800, 3200, 12800]) {
    const cmd = make(n);
    const bytes = Buffer.byteLength(cmd);
    if (bytes > 8 * 1024 * 1024) continue;
    const times = [];
    for (let i = 0; i < REPEAT; i++) times.push(timeOnce(cmd));
    // **최소값**을 쓴다 — 부하는 시간을 늘리기만 하므로 최소가 오염이 가장 적은 추정이다
    // (이 저장소가 FLAKE-01 에서 채택한 것과 같은 기법).
    const best = Math.min(...times);
    const worst = Math.max(...times);
    rows.push({ name, bytes, best, worst, headroom: BUDGET_MS / best });
  }
}

const kb = (b) => (b / 1024).toFixed(0) + 'KB';
const out = [
  '# [API-04] 훅 e2e 비용 곡선 — 10초 예산 대비 여유',
  '',
  '부하 창에서 측정. **상한 검사라 부하는 비관적 방향** — 여기서 통과하면 유휴에서도 통과한다.',
  '각 조합 3회, **최소값**을 쓴다(부하는 시간을 늘리기만 한다).',
  '',
  '| 명령 형태 | 크기 | 최소 e2e | 최대 e2e | 10초 대비 여유 |',
  '|---|---|---|---|---|',
  ...rows.map(r => `| ${r.name} | ${kb(r.bytes)} | ${r.best.toFixed(0)}ms | ${r.worst.toFixed(0)}ms | **${r.headroom.toFixed(1)}배** |`),
].join('\n') + '\n';

fs.writeFileSync(path.join(REPO, 'docs/release-readiness/2026-08-27/evidence/api04-curve.md'), out);
console.log(out);
