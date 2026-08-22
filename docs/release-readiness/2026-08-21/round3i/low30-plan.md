# LOW 30건 — 처방 묶음 (감정 종료 후 착수)

한 건씩 고치면 30번 왕복이다. **같은 뿌리끼리 묶어 8배치**로 간다.
배치마다 테스트 먼저 → 고침 → 과차단 짝 측정.

## A. 인자 검증 한 벌 (3건) — UX-A7 · QUAL-D · UX-A8
뿌리 하나: **인자를 안 줬는데 `undefined` 가 값으로 흘러간다.**
- `backtrack` · `gate submit` (`Invalid phase: undefined`) · `node bump` · `gate feedback`
- 대소문자 비정규화(`p1`·`BLOCKER` 거부, 제안 없음) · `loop critical bogus` → 「No pending escalation」 오답
→ 처방: `req()` 를 이 경로들에 확대 + 페이즈·심각도 입력 정규화 한 곳.
  **테스트는 부류로**: 「모든 명령군에 인자 없이 호출 → 출력에 `undefined` 없음 + 사용법 제시」.

## B. 성공·실패 출력이 다음 수를 준다 (5건) — UX-120 · UX-121 · UX-122 · UX-123 · UX-124
뿌리 하나: **무슨 일이 났는지, 다음에 무엇을 하는지 안 말한다.**
- bare id 출력(생성/갱신 구분 불가) · `doctor --repair` 가 수리 **전** 이슈 나열 ·
  `backtrack` 이 마커만 설정됨을 안 말함 · MCP 오류가 CLI 명령을 처방 · `doc submit` 처방에 명령 없음
→ 처방: 각 성공 문구에 「무엇이 바뀌었나 + 다음 수」. MCP 는 MCP 도구명으로 처방.

## C. 열화 상태 (3건) — COST-B · COST-129 · COST-131
뿌리 하나: **저널 재생 비용을 무기한 재지불하고, 그 사실을 조용히 문다.**
→ 처방: 훅 1회당 config 로드 1회로 줄이고(현재 3회), 허용 경로에도 열화 고지,
  자가회복은 **하지 않는다**(설계 판단 — `doctor --repair` 몫). 대신 고지를 확실히.

## D. 표면 계약 (3건) — UTIL-A3 · UTIL-A4 · QUAL-133
- `hook --help` 무출력 exit 0 → 짧은 안내(내부 명령임을 밝히고 `--help` 로 유도)
- `loop critical raise` exit 2 **문서화**(도움말에 「소환 시 exit 2」)
- `gate status` 가 재생된 게이트를 `[]` 로 — 강제 경로와 같은 상태를 보게

## E. 판정 정합 (3건) — COST-130 · EFF-132 · VAL-134
- `.harness` 가 파일일 때 sh 게이트/코어 갈림 → sh 게이트도 같은 판정
- `git push` 를 generic 프로파일 deploy 목록에
- 심링크 루트에서 `gate submit` 오진 → realpath 로 안팎 판정

## F. 문서 (6건) — UTIL-119 · PROD-B3 · PROD-B4 · PROD-127 · UTIL-A5 · PROD-B6
- `wave create [--goal g]` 오표기(실제 필수) · `lang: ko`/`HARNESS_LANG` 미기재 ·
  **MCP 도구 16종 미기재**(숨은 가치) · `tokens gen` 기본 출력 위치 ·
  동봉 스펙 문서가 없는 명령 광고 · 구판 감사 잔존
→ **PROD-125(계량 낡음)는 라운드 3-H 에서 이미 고쳤다** — 재확인 후 닫는다.

## G. 테스트 커버리지 (2건) — ENG-F · QUAL-E
- `mcp/server.js` 전송층 테스트 0(어떤 뮤테이션도 생존) → 루트 해석·알림 억제·isError 매핑·stdout 위생
- 과차단 표본이 co-located 테스트를 안 봤다 → 표본에 넣어 재측정

## H. 나머지 (2건) — UX-A6 · PROD-B5+PROD-126 · PROD-128
- `tokens swap` 이 `--out` 없이 「changed」 주장(드라이런 미표기)
- 버전 표면(`--version` 이 0.0.1 미표기 · CHANGELOG 없음 · tag 0) — **B5 와 126 은 같은 것**
- 코어·스크립트 주석 한국어 전용

## 주의
- 감정 6축이 도는 동안 **리포를 건드리지 않는다**(축끼리 다른 커밋을 재면 비교가 깨진다).
- 가성비 축은 나머지 끝난 뒤 단독 — 그전에 무거운 명령 금지.
