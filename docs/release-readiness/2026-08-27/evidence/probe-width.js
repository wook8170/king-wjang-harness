// [UX-01] 도움말이 주어진 폭 안에 들어오는지 **표시 폭**으로 잰다(바이트·글자 수 아님).
// 한글은 한 글자가 두 칸이라 `awk length` 로 재면 한국어 출력이 통과처럼 보인다.
const { execFileSync } = require('child_process');
const REPO = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness';

function dw(s) {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const wide = (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf)
      || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
      || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60)
      || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1f9ff);
    w += wide ? 2 : 1;
  }
  return w;
}

const GROUPS = ['', 'gate', 'wave', 'node', 'tokens', 'design', 'ship', 'doc', 'adr',
  'evidence', 'loop', 'profile', 'usage', 'report', 'trace', 'phase', 'backtrack', 'migrate'];
const WIDTHS = [80, 100];
const LANGS = ['en', 'ko'];

let bad = [];
let checked = 0;
for (const lang of LANGS) {
  for (const w of WIDTHS) {
    for (const g of GROUPS) {
      const args = g ? [g, '--help'] : ['--help'];
      let out = '';
      try {
        out = execFileSync(process.execPath, [REPO + '/bin/harness', ...args], {
          env: { ...process.env, COLUMNS: String(w), HARNESS_LANG: lang },
          encoding: 'utf8',
        });
      } catch (e) { out = (e.stdout || ''); }
      for (const line of out.split('\n')) {
        // 표 행만 본다(두 칸 들여쓴 줄). 산문·코드 예시는 자연 줄바꿈이 정상이다.
        if (!/^ {2}\S/.test(line) && !/^ {2,}\S/.test(line)) continue;
        checked++;
        if (dw(line) > w) bad.push(`${lang} w=${w} [${g || 'root'}] ${dw(line)}칸: ${line.slice(0, 60)}`);
      }
    }
  }
}
console.log(`검사한 표 행 ${checked}개 · 폭 초과 ${bad.length}개`);
for (const b of bad.slice(0, 12)) console.log('  ! ' + b);
process.exit(bad.length === 0 ? 0 : 1);
