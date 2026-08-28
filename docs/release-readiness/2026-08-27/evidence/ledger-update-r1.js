// 수정 라운드 1 결과를 정본 대장에 반영한다. 행을 통째로 다시 쓰지 않고 상태·근거등급·닫은
// 증거 칸만 바꾼다 — 한 줄 설명과 근거 인용은 감사 시점의 사실이라 그대로 둔다.
const fs = require('fs');
const LEDGER = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness/docs/release-readiness/2026-08-27/ledger.md';

// ID → [새 상태, 닫은 증거]
const CLOSED = {
  'API-01':  ['verified', '`fixes-round1.md` §API-01 · 회귀 `core/test/overblock-2026-08-27.test.ts` · 재측정 과차단 7/12→**0/12**, 관통 0/8 유지 · 변이검증 red 확인'],
  'ORCH-01': ['verified', 'API-01 과 동일 뿌리 — 같은 수정으로 닫힘. heredoc 본문 마스킹'],
  'ORCH-05': ['verified', 'API-01 과 동일 결함(독립 재발견) — 같은 수정으로 닫힘'],
  'ORCH-07': ['verified', 'API-01 과 동일 뿌리 — `cd`·`pushd` 를 READ_ONLY_HEADS 에 추가'],
  'ORCH-08': ['verified', 'API-01 과 동일 뿌리 — 자기해제 가드를 줄 기반으로'],
  'ORCH-10': ['verified', 'API-01 과 동일 뿌리 — heredoc 본문 마스킹'],
  'OPS-01':  ['verified', '`fixes-round1.md` §OPS-01 · 회귀 `core/test/observability-2026-08-27.test.ts` · 변이검증 red 확인'],
  'OPS-02':  ['verified', '`fixes-round1.md` §OPS-02 · 회귀 동 파일 §OPS-02 · 변이검증 red 확인'],
  'SHIP-03': ['verified', 'OPS-02 와 동일 결함 — 같은 수정으로 닫힘'],
};

const NEW_ROWS = [
  '| API-28 | LOW | 02 | 자기해제 가드의 env 리터럴 절은 여전히 명령 전체를 훑는다 — 그 환경변수 이름을 **문서에 적는 것**은 아직 막힌다 | open | measured | `docs/release-readiness/2026-08-27/fixes-round1.md:1` | — |',
  '| SHIP-23 | LOW | 10 | README 배포본 테스트 수(1384)는 기계 검증이 없다 — 총계·파일 수만 `doc-claims.test.ts` 가 잡고 배포본 수치는 산술로만 맞춘다 | open | code | `core/test/doc-claims.test.ts:104` | — |',
];

const src = fs.readFileSync(LEDGER, 'utf8');
const lines = src.split('\n');
let touched = 0;
for (let i = 0; i < lines.length; i++) {
  const m = /^\| ([A-Z]+-\d+) \|/.exec(lines[i]);
  if (!m || !CLOSED[m[1]]) continue;
  const cells = lines[i].split('|');
  // | ID | 심각도 | 축 | 한 줄 | 상태 | 근거등급 | 근거 | 닫은 증거 |
  cells[5] = ` ${CLOSED[m[1]][0]} `;
  cells[8] = ` ${CLOSED[m[1]][1]} `;
  lines[i] = cells.join('|');
  touched++;
}
const out = lines.join('\n').replace(/\n+$/, '\n') + NEW_ROWS.join('\n') + '\n';
fs.writeFileSync(LEDGER, out);
console.log(`상태 갱신 ${touched}행 · 신규 ${NEW_ROWS.length}행`);
