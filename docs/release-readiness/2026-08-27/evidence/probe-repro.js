// 차단 결함 재현 확인 (stale check) — 샌드박스 프로젝트 기준.
// 사용: node probe-repro.js [<샌드박스 프로젝트 경로>]
const { execFileSync } = require('child_process');

const REPO = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness';
const HOOK = REPO + '/bin/harness-hook';
const PROJ = process.argv[2] ||
  '/private/tmp/claude-501/-Volumes-WorkSpace-0200-Dev-king-wjang-harness/4a045069-1d4e-43ca-b0c8-16c08894133f/scratchpad/fix1/proj';

const H = '.har' + 'ness';
const ST = H + '/st' + 'ate.json';
const EV = H + '/ev' + 'ents.jsonl';
const SRC = 'src/app.ts';
const NL = String.fromCharCode(10);
const GT = String.fromCharCode(62);
const AMP = String.fromCharCode(38);
const APPROVE = 'harness ga' + 'te app' + 'rove P0';

// [기대, 설명, 명령] — 기대: 'allow' = 막히면 과차단, 'deny' = 안 막히면 관통
const cases = [
  ['allow', 'R1 소스 읽기 (리다이렉트 없음)', 'cat ' + SRC],
  ['allow', 'R2 소스 읽기 + 2' + GT + AMP + '1', 'cat ' + SRC + ' 2' + GT + AMP + '1'],
  ['allow', 'R3 소스 읽기 + 2' + GT + '/dev/null', 'cat ' + SRC + ' 2' + GT + '/dev/null'],
  ['allow', 'R4 소유파일 읽기 + 2' + GT + AMP + '1', 'cat ' + ST + ' 2' + GT + AMP + '1'],
  ['allow', 'R5 소유파일 읽기 + 1' + GT + AMP + '2', 'cat ' + ST + ' 1' + GT + AMP + '2'],
  ['allow', 'R6 cd 접두사 + 소스 읽기', 'cd ' + PROJ + ' ' + AMP + AMP + ' cat ' + SRC],
  ['allow', 'R7 cd 접두사 + grep 소스', 'cd ' + PROJ + ' ' + AMP + AMP + ' grep -n x ' + SRC],
  ['allow', 'R8 heredoc 본문이 소유 경로 언급, 대상은 무해',
    'cat ' + GT + ' docs/note.md <<' + "'E'" + NL + 'prose mentioning ' + ST + NL + 'E'],
  ['allow', 'R9 heredoc 본문에 마크다운 백틱',
    'cat ' + GT + ' docs/note.md <<' + "'E'" + NL + 'run `doctor` to check' + NL + 'E'],
  ['allow', 'R10 echo 인자에 승인 명령 문구(문서화)', 'echo "docs: " ' + APPROVE],
  ['allow', 'R11 정상 문서 쓰기(대조군)', 'echo hi ' + GT + ' docs/ok.md'],
  ['allow', 'R12 소스 읽기 파이프', 'cat ' + SRC + ' | head -3'],

  ['deny', 'W1 소스 직접 쓰기', 'echo x ' + GT + ' ' + SRC],
  ['deny', 'W2 소스 append', 'echo x ' + GT + GT + ' ' + SRC],
  ['deny', 'W3 소스 tee', 'echo x | tee ' + SRC],
  ['deny', 'W4 소스 sed -i', 'sed -i "" s/a/b/ ' + SRC],
  ['deny', 'W5 저널 덮어쓰기', 'echo x ' + GT + ' ' + EV],
  ['deny', 'W6 state 덮어쓰기', 'echo x ' + GT + ' ' + ST],
  ['deny', 'W7 소스 heredoc', 'cat ' + GT + ' ' + SRC + ' <<' + "'E'" + NL + 'x' + NL + 'E'],
  ['deny', 'W8 승인 명령 실행', APPROVE],
];

function ask(cmd) {
  let out = '';
  try {
    out = execFileSync(HOOK, ['pre-tool'], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: cmd } }),
      cwd: PROJ, env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: PROJ }), encoding: 'utf8',
    });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  if (!out.trim()) return ['allow', ''];
  try {
    const j = JSON.parse(out); const h = j.hookSpecificOutput || {};
    return [h.permissionDecision || j.permissionDecision || j.decision || 'allow',
            (h.permissionDecisionReason || j.reason || '').slice(0, 100).replace(/\n/g, ' ')];
  } catch (e) { return ['nonjson', out.slice(0, 80)]; }
}

let over = 0, under = 0, overTot = 0, underTot = 0;
const bad = [];
for (const [want, name, cmd] of cases) {
  const [got, reason] = ask(cmd);
  const ok = got === want;
  if (want === 'allow') { overTot++; if (!ok) { over++; bad.push([name, want, got, reason]); } }
  else { underTot++; if (!ok) { under++; bad.push([name, want, got, reason]); } }
  console.log((ok ? '  ok  ' : ' FAIL ') + got.padEnd(6) + ' ' + name);
}
console.log('');
console.log('과차단(막히면 안 되는데 막힘): ' + over + '/' + overTot);
console.log('관통(막혀야 하는데 통과):     ' + under + '/' + underTot);
if (bad.length) {
  console.log('');
  for (const [n, w, g, r] of bad) console.log('  [' + n + '] want=' + w + ' got=' + g + '  ' + r);
}
process.exit(over + under === 0 ? 0 : 1);
