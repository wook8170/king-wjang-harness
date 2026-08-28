// [API-05] 종료코드 규약을 4개 README 에 적는다. 감사가 「어느 문서에도 exit code 규약이 없다」
// (전수 검색 0건)를 결함 근거로 들었다 — 규약은 문서화돼야 계약이다.
const fs = require('fs');
const path = require('path');
const REPO = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness';

const AFTER = {
  'README.md': '`harness --help` prints the command map',
  'README.ko.md': '`harness --help`가 명령 지도를',
  'README.ja.md': '`harness --help` がコマンドマップを',
  'README.zh.md': '`harness --help` 会打印命令地图',
};

const BLOCK = {
  'README.md': [
    '',
    '**Exit codes.** A release script needs to tell "the product is not ready" apart from "the command',
    'did not run at all" — the two used to share exit `1`.',
    '',
    '| Code | Meaning |',
    '|---|---|',
    '| `0` | Success — or the verdict is yes |',
    '| `1` | Usage or environment error (unknown subcommand, no `.harness/` here, missing argument) |',
    '| `2` | **The verdict is no** — `ship verdict` NO-GO · `doctor` found problems · `gate verify` drift · `evidence check` short |',
    '',
    'Anything non-zero still fails a `cmd || exit 1` script; what changed is that the two cases are now',
    'distinguishable.',
  ].join('\n'),
  'README.ko.md': [
    '',
    '**종료코드.** 릴리스 스크립트는 「제품이 준비되지 않았다」와 「명령이 아예 돌지 않았다」를',
    '구분할 수 있어야 한다 — 예전에는 둘 다 exit `1` 이었다.',
    '',
    '| 코드 | 뜻 |',
    '|---|---|',
    '| `0` | 성공 — 또는 판정이 「예」 |',
    '| `1` | 사용법·환경 오류(하위명령 오타, 여기엔 `.harness/` 가 없음, 인자 누락) |',
    '| `2` | **판정이 「아니오」** — `ship verdict` NO-GO · `doctor` 진단 실패 · `gate verify` 드리프트 · `evidence check` 미달 |',
    '',
    '0 이 아니면 여전히 `cmd || exit 1` 스크립트가 걸린다 — 바뀐 것은 **둘을 구분할 수 있게 된 것**뿐이다.',
  ].join('\n'),
  'README.ja.md': [
    '',
    '**終了コード。** リリーススクリプトは「プロダクトが準備できていない」と「コマンドがそもそも',
    '動かなかった」を区別できなければならない —— 以前はどちらも exit `1` だった。',
    '',
    '| コード | 意味 |',
    '|---|---|',
    '| `0` | 成功 —— または判定が「はい」 |',
    '| `1` | 使い方・環境のエラー（サブコマンドの誤字、ここに `.harness/` が無い、引数の欠落） |',
    '| `2` | **判定が「いいえ」** —— `ship verdict` NO-GO・`doctor` が問題を検出・`gate verify` のドリフト・`evidence check` 不足 |',
    '',
    '0 以外なら `cmd || exit 1` は今も引っかかる。変わったのは**両者を区別できるようになったこと**だけだ。',
  ].join('\n'),
  'README.zh.md': [
    '',
    '**退出码。** 发布脚本需要区分「产品尚未就绪」和「命令根本没跑起来」—— 以前两者都是 exit `1`。',
    '',
    '| 码 | 含义 |',
    '|---|---|',
    '| `0` | 成功 —— 或判定为「是」 |',
    '| `1` | 用法或环境错误（子命令拼错、此处没有 `.harness/`、缺少参数） |',
    '| `2` | **判定为「否」** —— `ship verdict` NO-GO · `doctor` 发现问题 · `gate verify` 漂移 · `evidence check` 不足 |',
    '',
    '只要非零，`cmd || exit 1` 依旧会拦住；改变的只是**两种情况现在可以区分**。',
  ].join('\n'),
};

let n = 0;
for (const [file, anchor] of Object.entries(AFTER)) {
  const p = path.join(REPO, file);
  const src = fs.readFileSync(p, 'utf8');
  if (src.includes('| `2` |')) { console.log(`= ${file}: 이미 있음`); continue; }
  const at = src.indexOf(anchor);
  if (at === -1) { console.log(`! ${file}: 앵커 없음`); continue; }
  const eol = src.indexOf('\n', at);
  fs.writeFileSync(p, src.slice(0, eol + 1) + BLOCK[file] + '\n' + src.slice(eol + 1));
  console.log(`+ ${file}`);
  n++;
}
console.log(`삽입 ${n}건`);
