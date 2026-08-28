// 라운드 2 후반(API-04 · LOGIC-02 잔여) 결과를 대장에 반영한다.
const fs = require('fs');
const LEDGER = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness/docs/release-readiness/2026-08-27/ledger.md';
const R2 = 'docs/release-readiness/2026-08-27/fixes-round2.md';
const T2 = 'core/test/fixes-round2-2026-08-27.test.ts';

const CLOSED = {
  'API-04': ['verified', `\`${R2}\` · 상한을 **실측으로 재역산** 4MB→1MB(\`evidence/api04-cap.md\`: 1.09MB=4.4s 여유 2.3배 · 2.23MB=8.0s 여유 1.2배, 부하 창=비관적 방향) · 회귀 \`${T2}\` 가 **상한에서의 e2e 를 매번 다시 잰다**(숫자만 적으면 또 낡는다)`],
  'LOGIC-02': ['verified', `\`${R2}\` · \`--out\` 소유 파일 가드(목록 \`policy.ts\` 일원화) + **손상된 웨이브 지시서를 \`doctor\` 가 탐지**. 쓰기는 막지 않았다 — 광고(\`.harness/\` 는 언제나 쓸 수 있다)를 바꾸지 않고 손실을 관측 가능하게 했다. 회귀 \`${T2}\` · 변이검증 red 확인`],
};

const NEW_ROWS = [
  `| PERF-06 | — | 05 | 훅 e2e 비용 곡선 실측 — 선형이고 상한(1MB)에서 4.4s, 예산 10s 대비 **여유 2.3배**(부하 창) | verified | measured | \`docs/release-readiness/2026-08-27/evidence/api04-cap.md:1\` | 상한 초과는 112ms 에 즉시 거부(fail-closed 확인) |`,
  `| OPS-17 | — | 11 | \`doctor\` 가 **있는데 깨진** 웨이브 지시서를 본다 — 예전에는 부재만 봤고, 그것이 가장 조용한 데이터 손실 경로였다 | verified | measured | \`core/src/doctor.ts:261\` | \`${R2}\` · 회귀 \`${T2}\` · 정상 상태에서 과보고 0 |`,
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
