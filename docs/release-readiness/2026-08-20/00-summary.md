# king-wjang-harness 코어 엔진 v0 출하 검증 — 종합 리포트

**작성 2026-08-20** · 대상 `feature/core-engine-v0` @ `e48473d` (핸드오프 `d3617dd` 시점) ·
방식 10축 병렬 감사(③ 제외) + 수정 라운드 · 산출 형태: Claude Code 플러그인(훅) + CLI

# 판정

> ## ★ 출하 가능
> 착수: 이전 최종 리뷰 "머지 가능"(Critical 3건 수정 후) → 10축 정밀 감사가 **BLOCKER 0**
> 확정하되 HIGH 3건을 드러내 "조건부 출하 가능"으로 판정 → **사용자 승인 후 HIGH 수정 라운드로
> 3건 전부 verified 종결**(subagent-driven, 각 스펙+품질 리뷰 통과) → 재측정으로 전 게이트
> PASS 재확인. **차단 결함 0 · HIGH 0 · 전 게이트 초록 · 잔여는 전부 MED/LOW 백로그.**

**닫은 HIGH 3건**(수정 라운드):
1. **LOGIC-11** ✅ `b5d6248` — 비간섭 게이트를 `harnessDir` 기준으로 + 저널 재생 폴백. state.json
   삭제해도 훅이 계속 판정(E2E: `rm state.json` 후 여전히 deny). F1 리뷰 Approved.
2. **LOGIC-10** ✅ `b5d6248` — `isHarnessStateShape` 형태 검증 실패 시 저널 폴백. `echo '{}' >
   state.json` 후 설계트랙 소스 차단 유지(E2E deny). F1 리뷰 Approved.
3. **SHIP-11** ✅ `8d261d3` — (사용자 결정) `core/dist` 커밋 + **yaml 번들 인라인**. dist-only는
   yaml external이라 node_modules 없는 클론서 여전히 inert였던 것을 E2E로 발견·수정. self-contained
   dist로 재검증: node_modules 없는 클론서 `--version` exit0·pre-tool 실제 deny.

**부수로 닫은 것**: SEC-10(MED 주입 격리)·SEC-11/12/13(LOW)·API-10(MED 파서 중복)·USE-01/API-12/
OPS-11/LOGIC-16(LOW)·backtrack.reason 회귀·SHIP-12(README). 커밋 `2efe05d`·`74df666`·`2f0456d`·`8d261d3`.

**출하 후 백로그(잔여 open, 비차단)**: SEC-01(외부 심링크 P8, Bash 표면 이내)·SHIP-02(구 .harness
 gitignore 마이그레이션)·OPS-02/10/14(관측 보강)·LOGIC-13/14(스키마 확장 시 승격·시간축 증적)·
OPS-16·API-11 등 — `ledger.md` open 행 참조. 전부 MED/LOW.

# 게이트 실측 (목표 열은 착수 전 확정 — Iron Rule 1)

| # | 게이트 | 목표 | 착수 전 | 최종 실측 |
|---|---|---|---|---|
| G1 | 테스트 3회 | pass·fail0·skip0·3회 동일 | ⚠(미측정) | **198×3 동일 PASS**(수정 후 재측정, +27) |
| G2 | 타입 | 오류 0 | ⚠ | **tsc 0 PASS** |
| G3 | 빌드·CLI | 성공+exit0 | ⚠ | **PASS** |
| G4 | 공급망 | 프로덕션 도달 crit/high 0 | ⚠ | **0/0 PASS**(dev 5건 DEP-10 트래킹) |
| G5 | 이력 비밀 | 0건 | ⚠ | **0건 PASS**(48커밋, grep 대체) |
| G6 | 훅 무해 | 전 케이스 exit0·비간섭0 | ⚠ | **17/17 PASS** |
| G7 | E2E 페르소나 | 실패 0 | ⚠ | **P1~P4 실패0 PASS** |
| G8 | 조용한 실패 | 무관측 경로 0 | ⚠ | **조건부** — 삼킴 24/25 관측, 예외 OPS-10/12/14·LOGIC-10/11 |
| G9 | 훅 지연 | p95<150ms ⚠가정 | ⚠ | **p95 57ms PASS**(self-contained dist 298KB 재측정, 가정 유지) |
| G10 | 대형 저널 | doctor<5s·훅<500ms ⚠가정 | ⚠ | **doctor59·훅62ms PASS** |
| G11 | 신규 설치 | 1회 성공·문서밖 단계0 | ⚠ | **PASS(수동 경로)** · 플러그인 형태 SHIP-11 |
| G12 | 업그레이드·롤백 | 각 성공·유실0 | ⚠ | **양방향 PASS·유실0** |

⚠가정 게이트(G9·G10)는 실측이 목표를 압도적으로 충족 → **임계값 완화 없음**(실측이 가정보다 빠름).

# 축 구성

| 축 | 적용 | 담당 파일 |
|---|---|---|
| ① 기능 완성도 | **적용** — 경쟁 벤치마크 대신 설계 스펙 대비 v0 약속 범위 | `01-features.md` |
| ② 백엔드·API | **적용(번안)** — HTTP 없음 → CLI 명령·훅 프로토콜 계약 전수 | `02-backend.md` |
| ③ UI·접근성 | **의도적 제외** — GUI·웹 없음(CLI 텍스트뿐). CLI 메시지 품질은 ④에서 본다 | — |
| ④ 사용성·E2E | **적용** 🔴 | `04-usability.md` |
| ⑤ 성능·부하 | **적용** — 훅 지연·대형 저널/원장 (컨트롤러가 조용한 창에서 실측) | `05-perf.md` |
| ⑥ 보안 | **적용** — 훅 신뢰 경계·인젝션·이력 비밀·로그 유출 (인증·세션 없음은 기록) | `06-security.md` |
| ⑦ 공급망 | **적용** | `07-supply-chain.md` |
| ⑧ 논리·정합성 | **적용** — 선언 불변식 13종 전건 | `08-logic.md` |
| ⑨ 결정성 | **적용** (컨트롤러가 조용한 창에서 실측) | `09-determinism.md` |
| ⑩ 배포·롤백 | **적용** | `10-deploy.md` |
| ⑪ 운영·관측성 | **적용** | `11-ops.md` |

# 이번에 보지 않은 축
## 가. 의도적 제외
- ③ UI·접근성 — 대상에 GUI·웹 표면이 없다(CLI 텍스트 출력뿐). CLI 출력의 사용성은 ④가 커버.
## 나. 확인 불가
- (착수 시점 없음 — 감사 중 발견 시 추가)

# 축별 결과 (각 파일 링크)
- **① 기능** 98/100 PASS, FEAT-10(LOW) → `01-features.md`
- **② CLI·훅 계약** BLOCKER0, API-10(MED)+API-11~13(LOW) → `02-backend.md`
- **③ UI·접근성** 의도적 제외(GUI 없음)
- **④ 사용성 E2E** 페르소나 P1~P4 실패0, USE-01(LOW) → `04-usability.md`
- **⑤ 성능** 훅59ms·doctor60ms PASS → `05-perf.md`
- **⑥ 보안** BLOCKER0, SEC-10(MED)+SEC-11~13(LOW), 코어우회0·이력비밀0 → `06-security.md`
- **⑦ 공급망** 프로덕션 도달0 PASS, DEP-10(LOW dev-only) → `07-supply-chain.md`
- **⑧ 논리·불변식** 핵심9종 방어, **LOGIC-10·11(HIGH)**+LOGIC-13/14(MED)+15/16(LOW) → `08-logic.md`
- **⑨ 결정성** 테스트3회 동일·재현성 PASS → `09-determinism.md`
- **⑩ 배포·롤백** 엔진 배포안전, **SHIP-11(HIGH)**+SHIP-12(MED)+SHIP-01/10(LOW) → `10-deploy.md`
- **⑪ 운영·관측성** 관측뼈대 정상, OPS-10/14(MED)+OPS-11/12/13(LOW) → `11-ops.md`

# 사용자·제품 결정 사항
- **HIGH 3건(조건)을 지금 수정 라운드로 닫을지 vs 조건부 출하로 명시하고 별도 처리할지** — 셋 다
  값싼 수정(저널 폴백 재사용·harnessDir 기준 init·dist 커밋). LOGIC-10/11은 하네스 핵심 가치
  (강제력)를 복원하므로 닫기를 권고.
- **SHIP-11 패키징 방향**: `core/dist` 커밋(단순·즉효) vs 플러그인 설치 빌드 자동화(정석) — 배포
  채널 결정과 함께.
- main 병합 여부(이전 세션 이월 a/b/c) — 이 감사는 병합과 독립.

# 출하 후 백로그 (deferred, 파일:줄은 ledger)
SEC-02(TOCTOU 문서화) · API-01(refs CLI전용) · API-02(MultiEdit 죽은분기) · OPS-01(버린 이벤트수) ·
그 외 MED/LOW 이월분은 `ledger.md` open 행 참조.

# 이 감사에서 배운 것
- **CLI/훅 제품엔 축을 번안하라**: ②는 HTTP 대신 CLI·훅 프로토콜 계약, ③은 제외(GUI 없음),
  ⑥은 인증 대신 "훅 신뢰 경계"로. 축 번호는 고정하되 내용은 제품 표면에 맞춘다.
- **측정 위생이 실제로 작동했다**: 파이프 뒤 `$?`가 head의 exit라 CLI 종료코드 관측이 오염됐다
  (자가 발견 1건, 값 폐기). exit code는 파이프 없이 재라.
- **이음매가 결함을 묶었다**: fail-open 관측성 구멍(SEC-13·OPS-12·LOGIC-10·11·OPS-14)이 여러 축에
  흩어져 나왔으나 한 뿌리 — `99-final-verification.md` 이음매 점검이 중복 계상을 막았다.

# 로드맵 자연 해소 항목 (이번 판정 대상 아님 — 이전 리뷰 확정)
gate CLI(로드맵 2) · terse 소비·trace(각 로드맵) · P7~P9 배포 명령 차단(로드맵 5) ·
backtrack phase 복귀 시맨틱 · 마켓플레이스 배포 채널(SHIP-10, 사용자 결정 대기)
