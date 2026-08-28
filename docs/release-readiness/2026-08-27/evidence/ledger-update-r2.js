// 수정 라운드 2 결과를 정본 대장에 반영한다.
const fs = require('fs');
const LEDGER = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness/docs/release-readiness/2026-08-27/ledger.md';

const R2 = 'docs/release-readiness/2026-08-27/fixes-round2.md';
const ROPS = 'docs/release-readiness/2026-08-27/fixes-round2-ops.md';
const T2 = 'core/test/fixes-round2-2026-08-27.test.ts';
const TOPS = 'core/test/ops-round2-2026-08-27.test.ts';

// ID → [새 상태, 닫은 증거]
const CLOSED = {
  'FEAT-01': ['verified', `\`${R2}\` §G3 · ko/ja/zh 번역 삽입 · 불릿 6/6/6/6 실측 · 재발 방지 구조 검사 \`core/test/doc-claims.test.ts\``],
  'UX-01':   ['verified', `\`${R2}\` §G5 · 회귀 \`${T2}\` · 재측정 표 행 502→**폭 초과 0** (en/ko × 80·100열)`],
  'LOGIC-01': ['verified', `\`${R2}\` §G10 · 회귀 \`${T2}\` · 변이검증 red 확인 · 역행은 막지 않는다(UTIL-189 회귀가 잡음)`],
  'API-05':  ['verified', `\`${R2}\` §G4 · 회귀 \`${T2}\` · 실측 NO-GO→2 · 오타→1 · 정상→0 · 규약을 --help 와 4개 README 에 기재`],
  'SHIP-06': ['verified', `\`${R2}\` · 회귀 \`${T2}\` · 변이검증 red 확인 · 모든 표면이 함께 닫힌다(CLI 종료 · 훅은 열화 배너)`],
  'SHIP-01': ['fixed',    `\`${R2}\` §G12 · \`v0.1.1\`·\`v0.1.2\` 주석 태그 생성 · 실측 v0.1.2 에 SEC-300 수정 有, v0.1.0 에 無. **\`git push --tags\` 는 사용자 몫** — 그때 verified 로 올린다`],
  'OPS-03':  ['verified', `\`${ROPS}\` · 회귀 \`${TOPS}\` · 변이검증 M1·M2 red 확인`],
  'OPS-04':  ['verified', `\`${ROPS}\` · 회귀 \`${TOPS}\` · 변이검증 M3 red 확인`],
  'OPS-05':  ['verified', `\`${ROPS}\` · 회귀 \`${TOPS}\` · 변이검증 M5 red 확인`],
  'OPS-09':  ['verified', `\`${ROPS}\` + 오케스트레이터가 \`core/src/cli.ts\` 배선 · 실측 raw ENOENT → 처방 있는 문구`],
  'USE-01':  ['verified', `\`${ROPS}\` · 회귀 \`${TOPS}\` · 변이검증 M4 red 확인 · doctor 가 저널을 못 읽어도 JSON 계약 유지`],
};

// 한 줄 설명을 갱신해야 하는 행 (부분만 닫힌 것)
const RETITLE = {
  'LOGIC-02': '소유·append-only 파일 보호 — `--out` 경로는 닫혔다(policy.ts 로 목록 일원화). **남은 것: 에이전트가 `Write` 로 활성 웨이브 지시서를 덮는 경로** (README 의 「`.harness/` 는 언제나 쓸 수 있다」와 충돌 — 사용자 결정)',
};

const NEW_ROWS = [
  `| LOGIC-14 | — | 08 | \`harness … --out\` 이 소유 파일을 덮던 구멍이 닫혔다 — 정의를 \`policy.ts\` 한 벌로 올려 훅과 CLI 가 같은 목록을 본다 | verified | measured | \`core/src/policy.ts:45\` | \`${R2}\` · 회귀 \`${T2}\` · 변이검증 red 확인 · 빌드 트랙에서도 안 풀린다 |`,
  `| UX-14 | — | 03 | 전각 폭 계산이 실제 호출 경로를 얻었다 — 접기를 넣으며 [UX-12] 의 잠재 결함을 함께 닫았다(한글 요약이 80열을 넘지 않는다) | verified | measured | \`core/src/help.ts:230\` | \`${R2}\` §G5 · ko 표 행 폭 초과 0 |`,
  `| ENG-01 | — | 02 | 보호 목록 테스트가 소스를 긁던 것을 정본 import 로 바꿨다 — 정의가 움직여도 침묵으로 깨지지 않는다 | verified | measured | \`core/test/eng-142-core-file-guards.test.ts:34\` | 정의 이동 시 실제로 빈 목록이 됐고 그 검사만이 잡았다 |`,
];

const src = fs.readFileSync(LEDGER, 'utf8');
const lines = src.split('\n');
let touched = 0;
for (let i = 0; i < lines.length; i++) {
  const m = /^\| ([A-Z]+-\d+) \|/.exec(lines[i]);
  if (!m) continue;
  const id = m[1];
  const cells = lines[i].split('|');
  let hit = false;
  if (CLOSED[id]) { cells[5] = ` ${CLOSED[id][0]} `; cells[8] = ` ${CLOSED[id][1]} `; hit = true; }
  if (RETITLE[id]) { cells[4] = ` ${RETITLE[id]} `; hit = true; }
  if (hit) { lines[i] = cells.join('|'); touched++; }
}
const out = lines.join('\n').replace(/\n+$/, '\n') + NEW_ROWS.join('\n') + '\n';
fs.writeFileSync(LEDGER, out);
console.log(`갱신 ${touched}행 · 신규 ${NEW_ROWS.length}행`);
