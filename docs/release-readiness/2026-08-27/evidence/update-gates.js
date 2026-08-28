// 라운드 2 이후 게이트 표의 「실측」·「판정」 칸을 갱신한다. **목표 칸은 건드리지 않는다**
// (Iron Rule 1 — 목표는 착수 전에 확정됐고 결과를 보고 조정하지 않는다).
const fs = require('fs');
const P = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness/docs/release-readiness/2026-08-27/00-summary.md';

const NEW = {
  G3: ['**불일치 0** — ko/ja/zh 에 인터프리터 우회 고지 번역 삽입 · 「알려진 한계」 불릿 **6/6/6/6** · `64 KB` 언급 4/4 · 구조 검사 상시화(`core/test/doc-claims.test.ts`)', '**충족**'],
  G4: ['`--help` 정확성 **충족** · 비TTY **충족** · **exit code 3구간 분리 완료**(NO-GO→2 · 오타/환경→1 · 정상→0, 실측) · **API-04(10초 예산 초과)는 미해결** — 조용한 창의 실측으로 상한을 다시 역산해야 한다', '부분'],
  G5: ['ANSI **0바이트** · NO_COLOR·FORCE_COLOR·TERM=dumb **바이트 동일** · 비ASCII **0 실패** · en/ko 키 428벌 **누락 0** · **폭 80 깨짐 0** — 표 행 502개(en/ko × 80·100열) 전수 검사, 전각 폭 계산 포함 (`evidence/probe-width.js`)', '**충족**'],
  G7: ['**미실시(보류)** — 측정 창 오염. 부하 창에서 wall 델타 **+49 → +110ms** 로 요동, corrupt 는 **−5.1ms(음수)**. **in-process 는 +18.3/+18.0ms 로 안정·문턱 아래.** 명령 파싱은 6개 형태 전부 문턱 1000ms 아래(라운드 2 중 자기 회귀를 벤치가 잡아 1310→375ms 로 고침) (`evidence/g7-bench.log:1`)', '보류'],
  G10: ['불가능 전이 **0/7** · 경계값 실질 실패 **0** · **불변식 위반 0** — 전이 시 해시 드리프트 자동 무효화(LOGIC-01) · `--out` 소유 파일 가드(LOGIC-02, 목록을 `policy.ts` 한 벌로) · **저널 파괴 경로 0**(사람 레인 포함)', '**충족**'],
  G12: ['설치 **성공**(HOME 3개, 16.0s) · 업그레이드 **2건 성공** · 롤백 **실측 성공** · **조용한 기본값 0** — 번들 부재가 로그에 남고(OPS-02) 미래 schemaVersion 을 모든 표면이 거부(SHIP-06) · **되돌아갈 안전한 버전 확보**(v0.1.2 태그, SEC-300 수정 有 실측) — 단 **push 는 사용자 몫**', '조건부'],
  G13: ['오류 메시지 **16/17 → 개선** · 활동 마커 침묵 실패 **흔적 남김**(OPS-03) · `doctor` 가 쓰기 가능 여부 **점검**(OPS-04) · raw errno 유출 **0**(OPS-05·09) · `doctor` 가 저널을 못 읽어도 **JSON 계약 유지**(USE-01) · 저널 손상이 **배너에 뜬다**(OPS-01)', '**충족**'],
};

let src = fs.readFileSync(P, 'utf8');
let n = 0;
src = src.split('\n').map(line => {
  const m = /^\| (G\d+) \| ([^|]*)\| ([^|]*)\| ([^|]*)\| ([^|]*)\|\s*$/.exec(line);
  if (!m || !NEW[m[1]]) return line;
  n++;
  return `| ${m[1]} | ${m[2].trim()} | ${m[3].trim()} | ${NEW[m[1]][0]} | ${NEW[m[1]][1]} |`;
}).join('\n');
fs.writeFileSync(P, src);
console.log(`게이트 ${n}행 갱신`);
