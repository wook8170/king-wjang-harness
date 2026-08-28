// [FEAT-01] 영문 「Known limits」에만 있던 인터프리터 우회 한계 고지를 ko/ja/zh 에 넣는다.
// 이 항목은 **제품이 스스로 밝힌 보안 경계의 구멍**이라, 영어권 사용자만 알고 방어적으로 쓰는
// 상태를 그대로 두면 안 된다. 위치는 영문과 같다 — 저널 압축 불릿 **앞**.
const fs = require('fs');
const path = require('path');
const REPO = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness';

const BULLET = {
  'README.ko.md': '- **인터프리터에 «파일»로 넘긴 프로그램도 셸 스크립트와 같은 방식으로 읽는다** — '
    + '`sed -f prog.sed`·`awk -f prog.awk`·`perl x.pl`·`python3 x.py`·`node x.js`·`bun`·`deno run`·'
    + '`ruby`·`php`·`tclsh`·`lua`·`Rscript` 처럼 프로그램을 파일로 건네면, 훅이 그 파일을 읽어 '
    + '하네스 소유 경로에 쓰면 거부한다. **한계 셋은 의도적이다**: ① 프로그램 파일이 '
    + '**64 KB 를 넘으면 거부가 아니라 건너뛴다**(실제 번들은 크고 손으로 쓴 위조본은 작다 — '
    + '64 KB 넘는 위조본은 `node dist/cli.js` 를 막지 않기 위해 공시하고 치르는 값이다). '
    + '② **훅이 모르는 인터프리터**(`julia`·`groovy`·`raku` 같은 이색 런타임)는 열거 밖이다. '
    + '③ **경로를 리터럴로 쓰지 않고 언어 안에서 조립하는 프로그램** — 문자열 이어붙이기'
    + '(`".har" + "ness/…"`)·`chr()`/`String.fromCharCode`·base64 — 은 리터럴 경로 검사에 안 걸린다'
    + '(보호 디렉토리로 들어가는 상대 `chdir(".harness")` 는 걸린다). 인터프리터 롱테일과 '
    + '언어 내부 난독화를 완전히 닫으려면 훅이 본문을 읽는 것이 아니라 **파일시스템 계층의 강제**가 '
    + '필요하고, 그건 훅의 범위 밖이다.',

  'README.ja.md': '- **インタプリタに«ファイル»として渡されたプログラムも、シェルスクリプトと同じように読む** — '
    + '`sed -f prog.sed`・`awk -f prog.awk`・`perl x.pl`・`python3 x.py`・`node x.js`・`bun`・`deno run`・'
    + '`ruby`・`php`・`tclsh`・`lua`・`Rscript` のようにプログラムをファイルで渡すと、フックはその'
    + 'ファイルを読み、ハーネス管理下のパスに書き込むなら拒否する。**3つの限界は意図的だ**: '
    + '① プログラムファイルが **64 KB を超えると拒否ではなくスキップされる**（実際のバンドルは'
    + '大きく、手書きの偽造は小さい —— 64 KB 超の偽造は `node dist/cli.js` を塞がないために'
    + '開示して支払うコストだ）。② **フックが知らないインタプリタ**（`julia`・`groovy`・`raku` の'
    + 'ような特殊ランタイム）は列挙の外にある。③ **パスをリテラルで書かず言語内で組み立てる'
    + 'プログラム** —— 文字列連結（`".har" + "ness/…"`）・`chr()`/`String.fromCharCode`・base64 —— は'
    + 'リテラルパス検査に掛からない（保護ディレクトリへ入る相対 `chdir(".harness")` は掛かる）。'
    + 'インタプリタのロングテールと言語内難読化を完全に閉じるには、フックが本文を読むのではなく'
    + '**ファイルシステム層での強制**が必要で、それはフックの範囲外だ。',

  'README.zh.md': '- **以«文件»形式交给解释器的程序，读取方式与 shell 脚本相同** —— 当程序作为文件传给解释器时'
    + '（`sed -f prog.sed`、`awk -f prog.awk`、`perl x.pl`、`python3 x.py`、`node x.js`、`bun`、'
    + '`deno run`、`ruby`、`php`、`tclsh`、`lua`、`Rscript`），钩子会读取该文件，若它写入 harness '
    + '管辖的路径就拒绝。**三个边界是有意为之的**：① 程序文件**超过 64 KB 时是跳过而非拒绝**'
    + '（真实的打包产物很大，而手写的伪造文件很小 —— 超过 64 KB 的伪造文件，是为了不阻塞 '
    + '`node dist/cli.js` 而公开承担的代价）；② **钩子不认识的解释器**（如 `julia`、`groovy`、'
    + '`raku` 等冷门运行时）不在枚举范围内；③ **不把路径写成字面量、而在语言内部拼装的程序** —— '
    + '字符串拼接（`".har" + "ness/…"`）、`chr()`/`String.fromCharCode` 或 base64 —— 不会被字面量'
    + '路径检查捕获（进入受保护目录的相对 `chdir(".harness")` 会被捕获）。要完全关闭解释器长尾与'
    + '语言内混淆，需要的是**文件系统层的强制**，而不是钩子读取程序体；那超出了钩子的范围。',
};

// 저널 압축 불릿의 각 언어 시작 문구 — 그 «앞»에 넣는다(영문과 같은 순서).
const ANCHOR = {
  'README.ko.md': '- **저널 압축 명령은 의도적으로 두지 않는다.**',
  'README.ja.md': '- **ジャーナルの圧縮コマンドは意図的に置かない。**',
  'README.zh.md': '- **有意不提供日志压缩命令。**',
};

let ok = 0;
for (const [file, bullet] of Object.entries(BULLET)) {
  const p = path.join(REPO, file);
  const src = fs.readFileSync(p, 'utf8');
  const anchor = ANCHOR[file];
  const at = src.indexOf(anchor);
  if (at === -1) { console.log(`! ${file}: 앵커를 못 찾음 → ${anchor.slice(0, 30)}`); continue; }
  if (src.includes('64 KB') || src.includes('64 KB')) { console.log(`= ${file}: 이미 있음`); continue; }
  fs.writeFileSync(p, src.slice(0, at) + bullet + '\n' + src.slice(at));
  console.log(`+ ${file}`);
  ok++;
}
console.log(`삽입 ${ok}건`);
