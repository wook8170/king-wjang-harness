# [3] 엔지니어링 품질 감정 — 4.6/5
**점수** 4.6 · **4.8 충족** ✗ (중복 규칙 1건 + MED 잔여 감점) · **감정 시각** 2026-08-22 18:40 KST
대상: feature/core-engine-v0 · HEAD 45bde0c9f6a4 (working tree clean) · node v22.22.2 · tsc 5.9.3 · vitest 2.1.9 · tsup 8.5.1

## 조건별 실측 (테스트 ×3 / tsc / 빌드 재현 / 중복 규칙)
- 대상 확인: HEAD 45bde0c9f6a4c734fb6096bac17eb36aca6de44a, working tree clean. [measured]
- **테스트 ×3**: `npm test`(vitest run) 3회 연속 — 39 파일 / 1031 테스트 전건 passed, 3회 모두 동일 집계, exit 0. [measured]
- **tsc**: `npx tsc --noEmit` exit 0, 오류 0. [measured]
- **빌드 바이트 재현**: `git archive HEAD` 로 mktemp 클론 2벌 → 각각 `npx tsup` → cli.js/mcp.js sha256 이 두 빌드 간 **완전 동일** (cli 562721ac…, mcp 420bb2d8…). [measured]
  - 커밋된 dist 와의 대조: 재빌드본과 해시가 달랐으나, 차이는 전부 내 측정 환경(node_modules 를 심링크로 넣어 tsup 이 모듈 경로 주석을 `../../../Volumes/...` 로 새김)이 만든 경로 주석뿐. 그 문자열을 `node_modules` 로 정규화하자 **sha256 완전 일치** (cli 125e62dc… = 커밋본, mcp c3de22c2… = 커밋본), diff 0줄. 즉 커밋된 dist 는 HEAD 소스의 빌드와 바이트 동일 — dist 신선. [measured]
- **중복 규칙**: 아래 대조표 참조.

## 중복 규칙 대조표 (규칙 → 구현 위치들)

내가 직접 뽑은 판정 규칙 목록과 구현 위치. [measured] = 코드 확인 + 뮤테이션/테스트로 실측.

| 규칙 | 구현 위치들 | 판정 |
|---|---|---|
| 쓰기 경로 판정(상태·정책·설계트랙·출하 신규파일) | `hook.ts judgeWritePath` 한 곳 — Write/Edit·Bash 리다이렉트·패치 대상 전부 이 함수로 수렴 | ✅ 한 벌 [measured] |
| Bash 쓰기 대상 추출 | `bashwrite.ts scanBashWrites` 한 곳 (sh -c·xargs·find -exec 재귀) | ✅ 한 벌 |
| 정책 파일 목록 | `policy.ts POLICY_FILES/PREFIXES` 정의 → hook 이 import | ✅ 한 벌 |
| 이벤트 타입 목록 | `events.ts EVENT_TYPES` 단일, KNOWN 은 파생 | ✅ 한 벌 |
| 원장 상태 어휘·유령참조·병합 의미론 | types.ts/ledger 도메인 한 벌 (surface-parity 테스트가 사본 재발생 자체를 정적으로 금지) | ✅ 한 벌 |
| 접두 명령 목록 | `bashwrite.ts PREFIX_COMMANDS` 공유(hook 은 +xargs) | ✅ 한 벌 (테스트 고정) |
| **출하 게이트 measured-only** | **`gate.ts approveGate:645` + `ship.ts shipVerdict:586` — 같은 술어(SHIP_PHASES ∧ evidence==='measured') 두 벌** | ❌ **중복 1건** [measured: M5·M6 뮤테이션이 각각 다른 테스트로 잡힘 = 두 벌이 각자 존재]. ship.ts 헤더는 "다시 구현하지 않는다"고 적었으나 586행이 재구현. 완화: 양쪽 다 개별 테스트 고정, 판정 방향상 발산해도 fail-safe(어느 한쪽 느슨해져도 다른 쪽이 막음). 그러나 술어를 gate.ts 에서 export 해 공유하지 않은 것은 명백한 두 벌. |
| 비간섭 술어(.harness 존재) | `hook.ts:233`(inline existsSync) · `state.ts hasHarness` · `bin/harness-hook`(sh) · `mcp/server.js harnessPresent` — 4벌 | ⚠ 부기: sh/서버는 프로세스 경계상 불가피 측면. sh↔코어는 PERF-95 테스트로 동치 고정, **server.js 사본은 무고정**. 술어가 한 줄이라 위험 낮음(LOW) |
| 루트 해석(CLAUDE_PROJECT_DIR ?? cwd) | `cli.ts main` · `mcp/server.js` · `bin/harness-hook` — 3벌 | ⚠ 부기: sh↔cli 는 테스트 고정, server.js 는 무고정 (LOW) |
| 배포 명령 목록 | `config.ts DEFAULT_CONFIG` · `profile.ts GENERIC_FLOOR` · `profiles/generic/profile.yaml` — 3벌 | ⚠ 부기: profile.test 가 3벌 동일성을 **자동 대조** (실측 diff 0) — 갈리면 red. 계층 폴백 설계의 대가로 수용 가능 |
| 게이트 승인 human-only | hook(SEC-103 Bash deny) · MCP(refuseApprove) · CLI(권한 다이얼로그 의존) | ✅ 채널별 잠금(같은 불변식의 표면별 강제 — 단일화 불가능한 구조) |
| 리뷰 패킷 동반 기록(§4-3) | `cli.ts:397-399` + `mcp.ts:368-370` — 오케스트레이션 두 벌 (mcp.ts 헤더가 자인: run() 재사용 불가라 재조립) | ⚠ 부기: 판정 규칙은 아님. 양쪽 다 테스트 고정(M11 실측). submitGate 로 내리는 것이 정도(定道) |
| 죽은 두 번째 벌 | LOGIC-95 로 제거 확인(hook.ts:1201 주석) — 실물 없음 | ✅ |

**결론: 「같은 판정 규칙 두 벌」 기준 위반 1건**(measured-only). 부기 3건은 입력·경계 술어의 다중 사본으로, 2건은 자동 대조 테스트로 고정, server.js 쪽 2벌만 무고정(LOW).

## 뮤테이션 결과 (표본 12 중 검출 9 · 검출률 75%)

방법: mktemp 클론(`git archive HEAD`, node_modules 심링크)에서 규칙 절 하나씩 파괴 → 전 스위트 실행.
**함정 보정**: 클론 = 배포 아카이브라 `ledger-summary-sync.test.ts` 가 수집 단계 실패(아래 결함 1) — 이 파일-레벨 실패를 베이스라인으로 잡고 **Tests 행의 단언 실패만** 검출로 인정. 생존 3건은 「그 절만 발화하는 입력」 프로브로 살아있는 변이임을 재확인(원본 pass → 변이 fail).

| # | 변이 | 결과 | 잡은 테스트 |
|---|---|---|---|
| M1 | STATE_FILES 에서 `.harness/ship/defects.yaml` 제거 | **생존** | 없음 — 프로브로 라이브 확인(원본 deny → 변이 allow) |
| M2 | stop 가드 `!lastTurnAt` 절 제거 | 검출(4) | hook-stop 계열 |
| M3 | `mv` 원본도 대상(SEC-101) 제거 | 검출(3) | bashwrite/hook |
| M4 | `CORE_INVOKE_RE`(SEC-96) 제거 | 검출(1) | **ENG-107 「자기호출 가드가 그 절 하나로도 선다」** — 절 단위 고정 테스트 |
| M5 | approveGate measured 강제 off | 검출(1) | gate.test 「출하 트랙은 measured 아닌 근거 거부」 |
| M6 | shipVerdict measured 사전검사 off | 검출(1) | ship.test 「근거 code 면 NO-GO」 |
| M7 | replayState gate-submitted evidence 폴드 제거(LOGIC-21 회귀) | **생존** | 없음 — 프로브 확인(재생 후 evidence 소실) |
| M8 | test/ 디렉토리 접두 예외 재도입(문서화된 과거 구멍) | 검출(1) | 「테스트 디렉토리 접두사로 구현을 숨길 수 없다」 |
| M9 | 정책 해시 구분자 제거 | 검출(1) | policy.test 「없는 것과 빈 것은 다른 해시」 |
| M10 | `git commit` 을 조회로 등록 | 검출(3) | surface-parity COST-111 계열 |
| M11 | MCP gate_submit 패킷 기록 제거 | 검출(1) | mcp.test 「리뷰 패킷을 남긴다(§4-3)」 |
| M12 | allowList 의 무조건 `.harness/` 제거 | **생존** | 없음 — 프로브 확인(접두사 재정의 시 .harness/*.ts 과차단) |

생존 3건의 이유: 셋 다 **그 절을 직접 겨눈 테스트가 없다.** 특히 M1 은 결함 대장 위조 사고(ENG-B)의 직접 대책인데 회귀 가드가 0 이고, doctor 도 defects.yaml 을 저널과 대조하지 않아(COMPARED_FIELDS 는 phase·activeWave·gates·backtrack 뿐) 이 절이 조용히 사라지면 아무 장치도 못 잡는다.

## 내가 추가로 재 본 것

- **판정 입력의 품질(강제 셋 ①)**: `hooks.json` matcher ↔ WRITE_TOOLS 는 ENG-A 테스트가 집합 일치(과부족 양방향)로 고정 [measured]. config 기본값·generic 프로파일·GENERIC_FLOOR 3벌 동일성 실측 diff 0 + 테스트 고정. generic `commands.yaml` 은 전부 빈 값이 **의도**(모르는 스택의 명령을 지어내지 않음)이고 그 강제 귀결(빈 build = 빌드 차단 불가)을 파일 헤더가 정직 고지. tsconfig `strict: true`(테스트 포함), `as any` 실사용 3곳뿐(전부 좁은 형태 가드).
- **E2E 실측(계약 문서 대조)**: init → state.json Write deny(exit 0 + deny JSON) · 무판정 시 stdout 0바이트 · 손상 stdin → exit 0 + `hook-errors.log` 에 `cli corrupt-stdin` 기록 · state.json 형태 손상 → 저널 재생 + 열화 고지 + deny 에 `[state damaged …]` 태그 · 맨 클론(dist 삭제) → hook exit 0 + stderr 안내, 일반 명령 exit 1. 전부 문서/주석의 계약과 일치 [measured].
- **파생 vs 진실**: doctor 가 state↔재생을 phase·activeWave·gates·backtrack 4필드로 대조 — 게이트 발산은 잡힘. **defects.yaml·deployments.yaml 은 대조 밖**(에이전트 경로는 hook 이 막지만, 그 hook 절이 무테스트 = M1). 재생의 evidence 폴드는 구현돼 있으나(LOGIC-21) 무테스트 = M7.
- **원자성**: state/wave/ledger/registry/ship/adr/design 전부 tmp+rename [코드 확인]. appendEvent 는 appendFileSync(O_APPEND) — 단일 프로세스 CLI 전제에서 수용 가능. inferred: 훅과 CLI 동시 기동 시 저널 interleave 는 POSIX append 원자성에 기댐.
- **죽은 코드**: migrate·loop·help 전부 CLI 배선 확인. LOGIC-95 가 도달불가 두 번째 벌을 제거한 흔적 확인. 미발견.

## 발견한 결함

1. **[MED] 배포 아카이브가 자기 테스트를 못 돌린다** — `.gitattributes` 가 `docs/release-readiness` 를 export-ignore(PROD-113)하는데, 함께 배포되는 `core/test/ledger-summary-sync.test.ts` 는 그 디렉토리를 절대경로로 읽는다. `git archive HEAD` 산출물(마켓플레이스·태그 배포 경로)에서 `npm test` = **1 파일 수집 실패(ENOENT), 12 테스트 미실행** [measured: 클론에서 Test Files 1 failed | 38 passed]. PROD-113 을 고정한 doc-claims.test 는 「export-ignore 가 있는가」만 보고 「아카이브가 여전히 자급하는가」를 안 본다. 처방: 그 테스트 파일도 export-ignore 하거나, 디렉토리 부재 시 skip.
2. **[MED] 결함 대장 쓰기 차단(STATE_FILES 의 defects.yaml·deployments.yaml)이 무테스트** — M1 생존. 이 절은 「대장 위조로 사람 게이트 근거를 속인다」(ENG-B 실사고)의 유일 대책이고, doctor 의 대조 범위 밖이라 회귀 시 침묵.
3. **[MED→LOW] 출하 measured-only 규칙 두 벌** — gate.ts:645 / ship.ts:586. 발산해도 강제는 fail-safe 지만(위 표), 규칙 문언이 갈리면 verdict 와 approve 가 서로 다른 말을 한다. ship.ts 헤더의 「다시 구현하지 않는다」 선언과 코드가 어긋나는 것 자체가 이 리포가 정의한 사고 패턴.
4. **[LOW] 재생 evidence 폴드(LOGIC-21) 무테스트** — M7 생존. doctor --repair 후 근거 등급 소실 회귀를 아무 테스트도 못 잡는다(과거 실사고의 재발 가드 부재).
5. **[LOW] `.harness/` 무조건 허용 가드 무테스트** — M12 생존. 과차단 방향이라 위협모델 밖이나, 주석이 「자물쇠가 된다」고 경고한 바로 그 절이 무가드.
6. **[LOW] 낡은 헤더 주석 2곳** — gate.ts:41-43 「replayState 는 evidence·submittedAt·invalidated 를 폴드하지 않고 gate-invalidated 도 KNOWN 에 없다」, ship.ts:39-41 NOTE(배선) 「defect-added 등 미등록」 — **둘 다 현재 사실과 반대**(events.ts 에 전부 구현·등록됨, 실측). 계약 문서가 거짓이면 다음 수리자가 이미 있는 것을 다시 만든다.
7. **[LOW] mcp/server.js(JSON-RPC 전송, ~180줄) 무테스트** — 어느 테스트도 참조하지 않음. 얇지만 알림/버퍼링/감시 로직이 있다.
- (불계상) `core/src/test.html` — 외부 서비스 iframe + 키 문자열. **미추적 + .git/info/exclude 로 로컬 제외 확인** → 커밋 대상 아님, 사람이 자기 터미널에 둔 것이라 결함으로 세지 않음.

## 반대 방향 측정 (테스트가 실패를 실제로 잡는가 · 픽스처가 구멍을 고정하고 있지 않은가)

- 검출률 75%(9/12), 그리고 잡힌 것들이 **그 절을 겨눈 테스트**로 잡혔음을 실패 테스트명으로 확인(M4→ENG-107 절 단위 테스트, M5→gate 자체, M6→ship 자체, M8→접두사 구멍 고정 테스트). 「다른 규칙이 대신 잡아 초록」인 경우는 표본에서 없었다 — 생존 3건은 프로브로 별도 확증.
- 픽스처 검사: hook 테스트의 allow 기대(`npx vitest run` 허용, Read 도구 무판정, 루트 밖 Bash 쓰기 허용)는 전부 **문서화된 설계 절충**과 일치 — 구멍을 기대값으로 박은 사례는 표본에서 미발견. 오히려 리포 자체가 「그 절 하나로도 선다」류의 뮤테이션식 테스트(ENG-107)와 표면 동치 테스트(surface-parity 463줄)를 이미 갖고 있다.
- 거짓말하는 것은 픽스처가 아니라 **주석**이었다(결함 6): 초록인 테스트가 아니라 낡은 계약 문서가 반대 방향 위험.

## 못 잰 것 (정직 고지)

- 뮤테이션은 표본 12 — 전 규칙 전수(全數) 변이가 아니다. bashwrite 의 명령별 케이스(~25종)와 opaqueExec 분기 전부는 미변이.
- MCP 전송 계층(server.js)의 프로토콜 동작(개행 분할·notification 무시·크래시 루프 방지)은 코드 리뷰만 했고 실구동 JSON-RPC 왕복은 안 돌렸다.
- 동시성: 훅·CLI 동시 기동에서의 events.jsonl append 경합은 실측 안 함(POSIX append 원자성 추론, inferred).
- 훅 지연(p95) 등 성능 계약(G9 150ms)은 이 축에서 재지 않았다.
- 이전 라운드 감정과의 대조는 규칙상 불가(의도적 미제공).

## 점수 산출 근거

- 조건 1(테스트 ×3): ✅ 39파일/1031 전건 green ×3 동일 [measured]
- 조건 2(tsc 0): ✅ [measured]
- 조건 3(빌드 바이트 재현): ✅ 독립 클론 2벌 sha256 동일 + 커밋 dist 와도 동일(측정 부산물 정규화 후) [measured]
- 조건 4(중복 규칙 0): ✗ — 판정 규칙 두 벌 1건(measured-only). 부기 사본들은 테스트 고정 또는 경계 필연으로 감점 최소.
- 잔여 감점: MED 2(아카이브 테스트 파손 · 대장 보호 무가드) + LOW 4.
- 종합: 조건 3/4 충족, 테스트 체계의 질은 이 규모에서 보기 드물게 높다(절 단위 고정·표면 동치·문서 계량 검증). 그러나 4.8 의 정의(전건 충족 + 잔여 LOW 이하)에 두 항목이 걸린다. **4.6/5.**
