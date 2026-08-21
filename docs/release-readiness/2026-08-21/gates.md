# 게이트 — 착수 전 확정 (Iron Rule 1)

**확정 시각** 2026-08-21, **측정 착수 전**. 대상 `e860460` (feature/core-engine-v0).
매체: **CLI 도구 + Claude Code 플러그인/라이브러리** — `media-adapters.md` 의 CLI·라이브러리 표 적용.

목표 열은 아래 표를 파일로 쓴 시점에 고정됐고, 이후 **결과를 보고 낮추지 않는다.**
낮춰야 할 사유가 생기면 `00-summary.md` 에 시각·사유와 함께 남긴다.

**라운드 2 보강 (2026-08-21)** — G11 은 **명령 수준** 계약만 셌다(`--help` exit 0 · 미지 명령 exit≠0 ·
필수 인자 누락 시 침묵 성공 0). 그래서 **플래그 수준의 광고-구현 어긋남**이 초록을 통과했다
([API-57]·[API-58]). 게이트 목표를 낮춘 것이 아니라 **세는 방법을 넓힌 것**이다 —
「`--help` 가 광고하는 플래그를 파서가 실제로 읽는가」를 전수 대조에 추가했다
(`evidence/round2-verify.log` §6, 수정 후 잔여 0건).

| 게이트 | 목표 (측정 전 확정) | 세는 방법 |
|---|---|---|
| G1 테스트 | 전건 pass · **fail 0** · skip 0 · **3회 반복 동일** | `npx vitest run` ×3, 숫자 비교 |
| G2 타입 | tsc 오류 **0** | `npx tsc --noEmit`, exit 0 |
| G3 빌드·자체완결 | tsup 성공 · **node_modules 없는 맨 클론**에서 `--version`·`init`·`status` exit 0 | 임시 clone 후 실행 |
| G4 훅 무해 | 4 이벤트 × {미초기화, 깨진 JSON, 빈 stdin, 미지 이벤트} **전부 exit 0** · 미초기화 시 stdout **0바이트** | stdin JSON 구동, exit·바이트수 |
| G5 훅 강제력 | 설계트랙 소스쓰기·코어파일 편집·경로우회·배포 Bash **deny** · 미정산 stop **block** — **전건 관측** | stdin JSON 구동, 응답 JSON |
| G6 🔴 안전 속성 | **MCP 로 게이트 승인 불가** — approve 시도 후 게이트 상태 **불변** | MCP tools/call 후 `gate show` 상태 비교 |
| G7 결정성 | 3회 동일 · 결정 경로에 `Math.random`/무주입 `Date.now` **실사용 0** · migrate **양방향 성공** | grep + 실행 |
| G8 공급망 | **프로덕션 도달 critical/high = 0** | `npm audit --omit=dev` |
| G9 훅 지연 | pre-tool **p95 < 150ms** (이전 패스 실측 기준선 승계, 완화 없음) | 30회 반복 계측 |
| G10 이력 비밀 | git **전 이력** 비밀 스캔 유출 **0** | `gitleaks detect` |
| G11 CLI 계약 | 전 서브커맨드 `--help` exit 0 · **미지 명령 exit≠0 + 명확 메시지** · 필수 인자 누락 시 **침묵 성공 0** · **광고한 플래그를 파서가 실제로 읽음(전수 대조, 잔여 0)** | 전수 실행, exit code 표 |
| G12 관측성 | **조용한 실패 경로 0**(빈 catch·삼킨 예외 중 사용자가 알 수 없는 것) · `doctor` 가 실제 상태 반영 | grep + 고의 파손 후 doctor |
| G13 패키징 | 플러그인 산출물에 **빠진 파일 0**(선언된 skills·agents·hooks·mcp 전부 존재·로드 가능) | manifest ↔ 파일 대조 |

## 축 계획

전 11축. 매체 재해석: ② → CLI/MCP/훅 계약 · ③ → CLI 출력(TTY·NO_COLOR·폭·비ASCII) ·
⑩ → 플러그인 설치·업그레이드(migrate)·롤백.

**뺀 것**: ① 의 **경쟁 벤치마크**만 제외(대조군 없음 — 자사 스펙 `docs/superpowers/specs/2026-08-20-king-harness-design.md` 대비 완성도로 대체). 축 ① 자체는 본다.
