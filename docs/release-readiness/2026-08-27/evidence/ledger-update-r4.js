// 라운드 3(OPS-06 · OPS-08 · API-03) 결과를 대장에 반영한다.
const fs = require('fs');
const LEDGER = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness/docs/release-readiness/2026-08-27/ledger.md';
const R2 = 'docs/release-readiness/2026-08-27/fixes-round2.md';
const R3 = 'docs/release-readiness/2026-08-27/fixes-round3-ops.md';
const T2 = 'core/test/fixes-round2-2026-08-27.test.ts';
const T3 = 'core/test/ops-round3-2026-08-27.test.ts';

const CLOSED = {
  'OPS-06': ['verified', `\`${R2}\` · 재생 전 크기 확인, 상한 **128MB**(실측 43MB/s 에서 역산) 초과 시 **재생을 포기하되 통과시키지 않는다** — 페이즈 미상이므로 가장 제한적 상태, 읽기·harness 명령은 열어 둬 \`doctor --repair\` 로 탈출 가능. 회귀 \`${T2}\`(희소 파일로 600MB 검사) · 변이검증 red 확인`],
  'OPS-08': ['verified', `\`${R3}\` · \`appendEvent\` 한 곳에서 자유 텍스트 마스킹(sk-·Bearer·AWS·ghp_·PEM·slack 등) + \`init\` 이 「\`.harness/\` 는 gitignore 되지 않는다」를 1회 고지 · 회귀 \`${T3}\` 7건 · 변이검증 A·D red 확인 · 구조화 값·평범한 산문 과보고 0 고정`],
  'API-03': ['verified', `\`${R3}\` · \`inspectConfig\` 가 미지 키를 탐지하고 \`doctor\` 가 **issue** 로 올린다(판정의 입력이 되는 파일이라 warning 으로는 부족) · 회귀 \`${T3}\` 7건 · 변이검증 B·C red 확인`],
};

const NEW_ROWS = [
  `| OPS-18 | — | 11 | \`harness init\` 이 저널의 git 노출을 1회 고지 — 마스킹은 미탐을 남기는 절충이므로 사용자가 알고 시작해야 한다 | verified | code | \`core/src/cli.ts:672\` | \`${R2}\` · OPS-08 의 나머지 절반 |`,
  `| PERF-07 | — | 05 | G7 훅 지연 **유휴 창 실측 통과** — 벤치의 busy 기준(\`load > 코어수×0.5\`)을 코드에서 확인하고 부하가 내려가길 기다려 측정 | verified | measured | \`scripts/bench-hook-latency.mjs:137\` | 「측정 불가」로 네 세션 미결이던 것이 기다리면 되는 것이었다 |`,
];

const src = fs.readFileSync(LEDGER, 'utf8');
const lines = src.split('\n');
let n = 0;
for (let i = 0; i < lines.length; i++) {
  const m = /^\| ([A-Z]+-\d+) \|/.exec(lines[i]);
  if (!m || !CLOSED[m[1]]) continue;
  const c = lines[i].split('|');
  c[5] = ` ${CLOSED[m[1]][0]} `;
  c[8] = ` ${CLOSED[m[1]][1]} `;
  lines[i] = c.join('|');
  n++;
}
fs.writeFileSync(LEDGER, lines.join('\n').replace(/\n+$/, '\n') + NEW_ROWS.join('\n') + '\n');
console.log(`갱신 ${n}행 · 신규 ${NEW_ROWS.length}행`);
