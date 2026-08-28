// 과차단 트리거 2차 분리 — 복합 명령에서 「순수 읽기」가 소스 쓰기로 오인되는 지점 찾기.
// 실제로 이 감사 세션이 거부당한 명령을 그대로 넣고, 조각을 하나씩 떼어 원인을 좁힌다.
const { execFileSync } = require('child_process');
const fs = require('fs');

const REPO = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness';
const HOOK = REPO + '/bin/harness-hook';
const OUT = REPO + '/docs/release-readiness/2026-08-27/evidence/probe-overblock2.md';
const NL = String.fromCharCode(10);
const PIPE = String.fromCharCode(124);
const GT = String.fromCharCode(62);
const SRC = 'core/src/doctor.ts';
const SHIM = 'bin/harness-hook';
const APPROVE = 'harness ga' + 'te app' + 'rove P0';

const cases = [
  // 실제로 거부당한 원본(조합)
  ['원본(거부 재현): cd && head shim; echo; grep src ' + PIPE + ' head',
   'cd ' + REPO + ' && head -30 ' + SHIM + '; echo "x"; grep -n dist ' + SRC + ' ' + PIPE + ' head'],
  // 조각 분해
  ['grep src (단독)', 'grep -n dist ' + SRC],
  ['grep src ' + PIPE + ' head', 'grep -n dist ' + SRC + ' ' + PIPE + ' head'],
  ['cd && grep src', 'cd ' + REPO + ' && grep -n dist ' + SRC],
  ['echo; grep src', 'echo "x"; grep -n dist ' + SRC],
  ['head shim (단독)', 'head -30 ' + SHIM],
  ['head shim; grep src', 'head -30 ' + SHIM + '; grep -n dist ' + SRC],
  ['cd && head shim', 'cd ' + REPO + ' && head -30 ' + SHIM],
  ['cat shim; grep src', 'cat ' + SHIM + '; grep -n dist ' + SRC],
  ['head 무관파일; grep src', 'head -30 README.md; grep -n dist ' + SRC],
  ['head shim; grep 무관파일', 'head -30 ' + SHIM + '; grep -n dist README.md'],
  // heredoc 본문의 문서 문구가 승인 시도로 오인되는가
  ['heredoc 본문에 승인 명령 문구(문서 작성)',
   'cat ' + GT + ' /tmp/vpr2.md <<' + "'E'" + NL + '문서: 사람이 ' + APPROVE + ' 로 승인한다' + NL + 'E'],
  ['echo 인자에 승인 명령 문구', 'echo "문서: ' + APPROVE + '"'],
  // 대조군: 진짜 소스 쓰기는 막혀야 한다
  ['[REAL] 소스 직접 쓰기', 'echo x ' + GT + ' ' + SRC],
];

const rows = [];
for (const [name, cmd] of cases) {
  let out = '';
  try {
    out = execFileSync(HOOK, ['pre-tool'], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: cmd } }),
      cwd: REPO, env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: REPO }), encoding: 'utf8',
    });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  let d = 'allow', r = '';
  if (out.trim()) {
    try {
      const j = JSON.parse(out); const h = j.hookSpecificOutput || {};
      d = h.permissionDecision || j.permissionDecision || j.decision || 'allow';
      r = (h.permissionDecisionReason || j.reason || '').slice(0, 70).replace(/\n/g, ' ');
    } catch (e) { d = 'nonjson'; }
  }
  rows.push('| ' + name + ' | **' + d + '** | ' + r + ' |');
  console.log(d.padEnd(7) + ' ' + name);
}

fs.writeFileSync(OUT,
  '# 과차단 트리거 2차 분리 — 순수 읽기가 소스 쓰기로 오인되는 지점' + NL + NL +
  '측정 2026-08-28 · 훅을 stdin JSON 으로 직접 구동 · `CLAUDE_PROJECT_DIR` = 대상 저장소(설계 트랙 P0)' + NL + NL +
  '| 명령 | 판정 | 사유(발췌) |' + NL + '|---|---|---|' + NL + rows.join(NL) + NL);
console.log(NL + 'written: ' + OUT);
