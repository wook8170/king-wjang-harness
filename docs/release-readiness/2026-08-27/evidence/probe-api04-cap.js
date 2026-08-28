// [API-04] 현 상한(4MB) 근처를 직접 잰다 — 상한을 «실측»으로 역산하기 위해서다.
// 감사가 지적한 것이 정확히 「상한이 낡은 실측(1MB 당 1초)에서 나왔다」는 것이므로,
// 새 값도 추측이 아니라 측정에서 나와야 한다.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness';
const HOOK = path.join(REPO, 'bin/harness-hook');
const BUDGET_MS = 10_000;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-cap-'));
execFileSync(process.execPath, [path.join(REPO, 'bin/harness'), 'init'], { cwd: root, stdio: 'ignore' });

// 가장 비싼 형태(위 곡선에서 cd-redirect 가 KB 당 비용 최고)로 상한을 정한다.
const make = (kb) => {
  const unit = 'cd dXXXX > fXXXX; ';
  const n = Math.ceil((kb * 1024) / unit.length);
  return Array.from({ length: n }, (_, i) => `cd d${i} > f${i}`).join('; ');
};

const timeOnce = (cmd) => {
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: cmd },
  });
  const t0 = process.hrtime.bigint();
  try {
    execFileSync(HOOK, ['pre-tool'], {
      input: payload, cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      stdio: 'pipe', maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) { /* deny 여도 시간은 잰다 */ }
  return Number(process.hrtime.bigint() - t0) / 1e6;
};

const rows = [];
for (const kb of [256, 512, 1024, 2048, 4096]) {
  const cmd = make(kb);
  const bytes = Buffer.byteLength(cmd);
  const times = [timeOnce(cmd), timeOnce(cmd), timeOnce(cmd)];
  const best = Math.min(...times);
  rows.push({ kb, bytes, best, worst: Math.max(...times), headroom: BUDGET_MS / best });
  console.log(`${kb}KB (${(bytes / 1024 / 1024).toFixed(2)}MB): best ${best.toFixed(0)}ms · worst ${Math.max(...times).toFixed(0)}ms · 여유 ${(BUDGET_MS / best).toFixed(1)}배`);
}

const out = [
  '# [API-04] 상한 근처 실측 — `MAX_BYTES` 를 실측으로 역산한다',
  '',
  '부하 창(`load ~5.6`)에서 측정. **상한 검사는 부하가 비관적 방향**이라 여기서 통과하면 유휴에서도 통과한다.',
  '가장 비싼 명령 형태(`cd … > …` 반복)로 잰다. 각 3회, **최소값** 사용.',
  '훅 예산은 `hooks.json` 이 주는 **10초**이고, 초과하면 훅이 죽어 **판정 없이 통과**한다.',
  '',
  '| 페이로드 | 최소 e2e | 최대 e2e | 10초 대비 여유 |',
  '|---|---|---|---|',
  ...rows.map(r => `| ${(r.bytes / 1024 / 1024).toFixed(2)}MB | ${r.best.toFixed(0)}ms | ${r.worst.toFixed(0)}ms | **${r.headroom.toFixed(1)}배** |`),
].join('\n') + '\n';
fs.writeFileSync(path.join(REPO, 'docs/release-readiness/2026-08-27/evidence/api04-cap.md'), out);
console.log('\nwritten: evidence/api04-cap.md');
