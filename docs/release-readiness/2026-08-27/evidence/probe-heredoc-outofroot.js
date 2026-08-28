// 「루트 밖 쓰기」가 Write 와 Bash(특히 **heredoc**)에서 갈리는가 — 그리고 그 비대칭이
// 의도된 것인가 결함인가.
//
// 오늘 `maskNonCommandText` 가 heredoc **본문**을 마스킹하도록 바뀌었으므로, 그 변경이
// 리다이렉트 **대상** 추출까지 망가뜨리지 않았는지 함께 확인한다(그게 진짜 위험이다).
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness';
const HOOK = path.join(REPO, 'bin/harness-hook');

// 샌드박스 프로젝트 — 실제 워킹트리는 건드리지 않는다.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-oor-'));
execFileSync(process.execPath, [path.join(REPO, 'bin/harness'), 'init'], { cwd: root, stdio: 'ignore' });
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });

const OUT = path.join(os.tmpdir(), 'kwh-oor-target', 'fdtest.sh');   // 루트 밖 절대경로
const NL = String.fromCharCode(10);
const GT = String.fromCharCode(62);

const ask = (tool, input) => {
  let out = '';
  try {
    out = execFileSync(HOOK, ['pre-tool'], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input }),
      cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', stdio: 'pipe',
    });
  } catch (e) { out = String(e.stdout ?? ''); }
  if (!out.trim()) return ['allow', ''];
  try {
    const j = JSON.parse(out); const h = j.hookSpecificOutput || {};
    return [h.permissionDecision || 'allow', (h.permissionDecisionReason || '').slice(0, 80).replace(/\n/g, ' ')];
  } catch (e) { return ['nonjson', out.slice(0, 60)]; }
};

const heredoc = (target) => 'cat ' + GT + ' ' + target + " << 'SCRIPT'" + NL + '#!/bin/sh' + NL + 'echo hi' + NL + 'SCRIPT';

const cases = [
  // ── 사용자가 관찰한 그대로: 루트 «밖» ────────────────────────────────────
  ['루트 밖', 'Write 도구', () => ask('Write', { file_path: OUT, content: 'x' })],
  ['루트 밖', 'Bash heredoc', () => ask('Bash', { command: heredoc(OUT) })],
  ['루트 밖', 'Bash 단순 리다이렉트', () => ask('Bash', { command: `echo x ${GT} ${OUT}` })],
  ['루트 밖', 'Bash tee', () => ask('Bash', { command: `echo x | tee ${OUT}` })],

  // ── 회귀 확인: 루트 «안» 소스는 heredoc 으로도 막혀야 한다 ────────────────
  ['루트 안 소스', 'Write 도구', () => ask('Write', { file_path: 'src/app.ts', content: 'x' })],
  ['루트 안 소스', 'Bash heredoc', () => ask('Bash', { command: heredoc('src/app.ts') })],
  ['루트 안 소스', 'Bash heredoc(절대경로)', () => ask('Bash', { command: heredoc(path.join(root, 'src/app.ts')) })],
  ['루트 안 코어', 'Bash heredoc(저널)', () => ask('Bash', { command: heredoc('.har' + 'ness/ev' + 'ents.jsonl') })],

  // ── 대조군: 루트 안 문서는 heredoc 으로 허용되어야 한다 ───────────────────
  ['루트 안 문서', 'Bash heredoc', () => ask('Bash', { command: heredoc('docs/note.md') })],
];

console.log('| 대상 | 표면 | 판정 | 사유(발췌) |');
console.log('|---|---|---|---|');
const rows = [];
for (const [where, surface, f] of cases) {
  const [d, why] = f();
  rows.push({ where, surface, d });
  console.log(`| ${where} | ${surface} | **${d}** | ${why} |`);
}

const g = (w, s) => (rows.find(r => r.where === w && r.surface === s) || {}).d;
console.log('');
console.log('— 판정 —');
console.log(`루트 밖: Write=${g('루트 밖', 'Write 도구')} · Bash heredoc=${g('루트 밖', 'Bash heredoc')} · Bash 리다이렉트=${g('루트 밖', 'Bash 단순 리다이렉트')}`);
const inRootLeak = rows.filter(r => r.where.startsWith('루트 안 소스') || r.where === '루트 안 코어').filter(r => r.d !== 'deny');
console.log(`루트 «안» 보호 관통: ${inRootLeak.length}건` + (inRootLeak.length ? ` — ${inRootLeak.map(r => r.surface).join(', ')}` : ' (전건 차단)'));
console.log(`루트 안 문서(허용되어야 함): ${g('루트 안 문서', 'Bash heredoc')}`);
process.exit(inRootLeak.length === 0 ? 0 : 1);
