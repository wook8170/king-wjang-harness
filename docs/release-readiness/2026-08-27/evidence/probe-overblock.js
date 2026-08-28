// Bash 레인 쓰기 판정 과차단 범위 측정.
// PreToolUse 훅을 stdin JSON 으로 직접 구동한다(Claude Code 가 보내는 형태 그대로).
// 금지 문자열은 런타임 조립 — 소스에 리터럴로 두면 이 파일 자체를 쓸 수 없다(그 자체가 측정 대상).
const { execFileSync } = require('child_process');
const fs = require('fs');

const H = '.har' + 'ness';
const ST = H + '/st' + 'ate.json';
const EV = H + '/ev' + 'ents.jsonl';
const REPO = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness';
const HOOK = REPO + '/bin/harness-hook';
const OUT = REPO + '/docs/release-readiness/2026-08-27/evidence/probe-overblock.md';

const NL = String.fromCharCode(10);
const GT = String.fromCharCode(62);
const AMP = String.fromCharCode(38);
const PIPE = String.fromCharCode(124);

// [분류, 설명, 명령] — 분류: READ(순수 읽기·써서는 안 될 이유 없음) / DOC(무해 파일 쓰기) / REAL(진짜 금지 쓰기)
const cases = [
  ['READ', 'ls (리다이렉트 없음)', 'ls -d ' + ST],
  ['READ', 'ls + 2' + GT + AMP + '1 (FD 복제 — 파일 안 씀)', 'ls -d ' + ST + ' 2' + GT + AMP + '1'],
  ['READ', 'cat (순수 읽기)', 'cat ' + ST],
  ['READ', 'cat + 2' + GT + '/dev/null', 'cat ' + ST + ' 2' + GT + '/dev/null'],
  ['READ', 'cat ' + PIPE + ' head (파이프)', 'cat ' + ST + ' ' + PIPE + ' head -3'],
  ['READ', 'grep 패턴에 경로', 'grep -rn "' + ST + '" docs'],
  ['READ', 'wc -l', 'wc -l ' + EV],
  ['READ', 'git log --stat (경로 인자)', 'git log --oneline -- ' + EV],
  ['READ', 'stdout' + GT + '/dev/null 로 버리기', 'cat ' + ST + ' ' + GT + ' /dev/null'],
  // 통제 대조쌍 — 기저 명령을 cat 으로 고정하고 리다이렉트 형태만 바꾼다
  ['READ', '[대조] cat, 리다이렉트 없음', 'cat ' + ST],
  ['READ', '[대조] cat + 2' + GT + '/dev/null', 'cat ' + ST + ' 2' + GT + '/dev/null'],
  ['READ', '[대조] cat + 2' + GT + AMP + '1', 'cat ' + ST + ' 2' + GT + AMP + '1'],
  ['READ', '[대조] cat + 1' + GT + AMP + '2', 'cat ' + ST + ' 1' + GT + AMP + '2'],
  ['READ', '[대조] ls, 리다이렉트 없음', 'ls -d ' + ST],
  ['READ', '[대조] ls + 2' + GT + '/dev/null', 'ls -d ' + ST + ' 2' + GT + '/dev/null'],

  ['DOC', 'heredoc 본문에 경로 언급 · 대상은 무해 리터럴',
    'cat ' + GT + ' /tmp/vpr-probe.md <<' + "'E'" + NL + 'prose mentioning ' + ST + NL + 'E'],
  ['DOC', 'echo 인자에 경로 · 대상은 무해 리터럴',
    'echo "see ' + ST + '" ' + GT + ' /tmp/vpr-probe.txt'],
  ['DOC', '커밋 메시지에 경로', 'git commit -m "docs: describe ' + ST + '"'],
  ['DOC', '대조군 — 경로 언급 없는 heredoc',
    'cat ' + GT + ' /tmp/vpr-probe.md <<' + "'E'" + NL + 'plain text' + NL + 'E'],

  ['REAL', '직접 덮어쓰기', 'echo x ' + GT + ' ' + ST],
  ['REAL', 'append', 'echo x ' + GT + GT + ' ' + EV],
  ['REAL', 'tee', 'echo x ' + PIPE + ' tee ' + ST],
  ['REAL', 'sed -i', 'sed -i "" s/a/b/ ' + ST],
  ['REAL', 'rm', 'rm -f ' + ST],
];

function decide(cmd) {
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: cmd },
  });
  let out = '';
  try {
    out = execFileSync(HOOK, ['pre-tool'], {
      input: payload, cwd: REPO,
      env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: REPO }),
      encoding: 'utf8',
    });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }
  if (!out.trim()) return 'allow';
  try {
    const j = JSON.parse(out);
    const h = j.hookSpecificOutput || {};
    return h.permissionDecision || j.permissionDecision || j.decision || 'allow';
  } catch (e) {
    return 'nonjson';
  }
}

const rows = [];
let falsePos = 0, realTotal = 0, realBlocked = 0, readTotal = 0;
for (const [kind, name, cmd] of cases) {
  const d = decide(cmd);
  const expected = kind === 'REAL' ? 'deny' : 'allow';
  const ok = d === expected;
  if (kind === 'READ') { readTotal++; if (d === 'deny') falsePos++; }
  if (kind === 'DOC' && d === 'deny') falsePos++;
  if (kind === 'REAL') { realTotal++; if (d === 'deny') realBlocked++; }
  rows.push('| ' + kind + ' | ' + name + ' | ' + d + ' | ' + expected + ' | ' + (ok ? 'OK' : '**MISMATCH**') + ' |');
  console.log((ok ? '   ' : '!! ') + kind + ' ' + d.padEnd(6) + ' ' + name);
}

const summary = [
  '# Bash 레인 쓰기 판정 과차단 범위 (2026-08-28 측정)',
  '',
  '훅을 stdin JSON 으로 직접 구동. `CLAUDE_PROJECT_DIR` = 대상 저장소(설계 트랙 P0).',
  '',
  '- **과차단(false positive)**: ' + falsePos + ' / ' + (cases.length - realTotal) + ' — 막혀서는 안 되는데 막힌 것',
  '- **진짜 차단(true positive)**: ' + realBlocked + ' / ' + realTotal + ' — 막혀야 하고 실제로 막힌 것',
  '',
  '| 분류 | 케이스 | 실제 | 기대 | |',
  '|---|---|---|---|---|',
].concat(rows).join(NL) + NL;

fs.writeFileSync(OUT, summary);
console.log(NL + '과차단 ' + falsePos + '/' + (cases.length - realTotal) + ' · 진짜차단 ' + realBlocked + '/' + realTotal);
console.log('written: ' + OUT);
