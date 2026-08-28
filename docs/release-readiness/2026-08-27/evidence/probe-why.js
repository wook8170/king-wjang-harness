// 과차단 전체 사유 출력 (진단용).
const { execFileSync } = require('child_process');
const REPO = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness';
const HOOK = REPO + '/bin/harness-hook';
const PROJ = process.argv[2] ||
  '/private/tmp/claude-501/-Volumes-WorkSpace-0200-Dev-king-wjang-harness/4a045069-1d4e-43ca-b0c8-16c08894133f/scratchpad/fix1/proj';
const H = '.har' + 'ness';
const ST = H + '/st' + 'ate.json';
const NL = String.fromCharCode(10);
const GT = String.fromCharCode(62);
const AMP = String.fromCharCode(38);

const cases = [
  ['R2', 'cat src/app.ts 2' + GT + AMP + '1'],
  ['R4', 'cat ' + ST + ' 2' + GT + AMP + '1'],
  ['R6', 'cd ' + PROJ + ' ' + AMP + AMP + ' cat src/app.ts'],
  ['R8', 'cat ' + GT + ' docs/note.md <<' + "'E'" + NL + 'prose mentioning ' + ST + NL + 'E'],
  ['R10', 'echo "docs: harness ga' + 'te app' + 'rove P0"'],
];
for (const [id, cmd] of cases) {
  let out = '';
  try {
    out = execFileSync(HOOK, ['pre-tool'], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: cmd } }),
      cwd: PROJ, env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: PROJ }), encoding: 'utf8',
    });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  console.log('===== ' + id + ' =====');
  console.log('CMD: ' + JSON.stringify(cmd));
  try {
    const j = JSON.parse(out); const h = j.hookSpecificOutput || {};
    console.log('DEC: ' + (h.permissionDecision || '(allow)'));
    console.log('WHY: ' + (h.permissionDecisionReason || ''));
  } catch (e) { console.log('RAW: ' + out.slice(0, 300)); }
  console.log('');
}
