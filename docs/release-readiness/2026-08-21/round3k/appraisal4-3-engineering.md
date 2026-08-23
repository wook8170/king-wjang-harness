# [3] 엔지니어링 품질 감정 — 4.3/5

**점수** 4.3 · **4.8 충족** ✗ (하드 조건 「중복 규칙 0」 미충족 — 셸 unwrap 목록이 ≥3벌이고 고정 장치가 없으며, fish/ash 에서 이미 드리프트가 실측됨. 부수적으로 생존 뮤테이션 2건)
**감정 시각** 2026-08-23 01:50–02:05 KST · **대상** HEAD `80b633cb77d2567bd82405bb4ac42d273a1f1eeb` (감정 도중 리포 HEAD 가 `92a6a1c` 로 전진했으나 diff 는 progress.md 한 파일뿐 — 모든 실측·인용은 80b633c 고정 샌드박스에서 수행, 코드 인용 유효성 `git diff 80b633c 92a6a1c -- core scripts bin hooks` = 0 파일로 확인) · 도구: node v22.22.2 · npm 10.9.7 · tsc 5.9.3 · vitest 2.1.9 · macOS 26.5.2 arm64 10-core
**한 줄**: 테스트·타입·빌드 재현성은 흠잡을 데 없고 알려진 두-벌 규칙들은 전부 교차 고정이 실제로 발화하지만(뮤테이션으로 확인), 셸 unwrap 규칙 하나가 고정 없는 3벌로 갈라져 이미 드리프트했고(fish/ash 로 설계 트랙 배포 차단 우회), G9 게이트는 아직 「사람이 표를 읽는」 형태라 자동 검사가 불가능하며 그 델타 추정기는 문턱(50ms)보다 노이즈가 크다.

## 조건별 실측 (테스트 ×3 / tsc / 빌드 재현 / 중복 규칙)

측정 환경: `git archive HEAD` 샌드박스(배포본 형태) + `git clone` 샌드박스 2벌(리포 형태, 80b633c checkout). 리포 워킹트리에는 아무 쓰기도 하지 않음. 시작 시 `git status --porcelain` 0줄; **종료 시 2줄**(`docs/release-readiness/2026-08-21/00-summary.md`·`ledger.md` 수정) — 동시 진행 중인 다른 3-K 세션의 것으로, 같은 기간 HEAD 도 progress.md 커밋(`92a6a1c`)으로 전진했다. 내 명령 이력에 리포 쓰기는 없다.

| 조건 | 결과 | 실측 |
|---|---|---|
| 테스트 ×3 동일 | ✅ | 배포본 샌드박스: **1217 pass / 16 skip** ×3 동일 · 리포 형태 클론: **1233 pass / 0 skip / 0 fail** ×3 동일 |
| tsc --noEmit | ✅ | exit 0 |
| 빌드 바이트 재현 | ✅ | 독립 클론 2벌 `npm run build` → `core/dist/cli.js` `5d0c50fc…`, `mcp.js` `a0c9ef21…` — 두 클론 동일 **그리고 커밋된 dist 와 바이트 동일**(dist 신선함, 정규화 불필요) |
| 중복 규칙 0 | ❌ | 아래 대조표 #8 — 고정 장치 없는 두 벌(+드리프트 실측). 뮤테이션 M15 생존이 증거 |

skip 16건의 성격: 전부 `describe.skipIf(!HAS_DOCS / !IN_REPO)` — `docs/release-readiness`(export-ignore)와 `.git` 이 없는 배포본에서 「지킬 대상이 없음」으로 건너뛰는 적용성 가드다. 리포 안에서는 [PROD-141] sanity 검사가 「조용한 skip」을 빨강으로 만들게 배선돼 있고, 리포 형태 클론에서 실제로 skip 0 을 확인했다. G1 의 「skip 0」은 리포 표면에서 충족.

## 중복 규칙 대조표 (규칙 → 구현 위치들 → 판정)

내가 소스에서 직접 뽑은 판정 규칙의 다중 구현 목록. 「허용」= 구조적으로 불가피한 두 벌이며 교차 고정 테스트가 실재하고, 그 테스트가 실제로 발화함을 뮤테이션으로 확인한 것.

| # | 규칙 | 구현 위치들 | 고정 장치 | 판정 |
|---|---|---|---|---|
| 1 | 훅 대상 도구 집합 | `core/src/hook.ts:48` WRITE_TOOLS ↔ `hooks/hooks.json` matcher ×2 | ENG-A 테스트 3건 — M4 뮤테이션으로 발화 확인(3 fail) | 허용 |
| 2 | 비간섭 게이트(.harness **존재**) | `bin/harness-hook` sh ↔ `core/src/hook.ts:250` | COST-130 테스트(문자열+행위) — M5 로 발화 확인(1 fail) | 허용 |
| 3 | 재생 대상 이벤트 타입 | `core/src/events.ts:92` REPLAY_TYPES ↔ `:190` replayState switch | 두 경로 동치 테스트 + DET-54 — M3 으로 발화 확인(1 fail) | 허용 |
| 4 | 턴 로그 헤딩 앵커 | `core/src/hook.ts:201` ↔ `core/src/wave.ts:181` | hook-session-start.test 양언어 행위 테스트(:250–266) | 허용 |
| 5 | 이벤트 타입 전수 목록 | `events.ts:25` EVENT_TYPES → KNOWN_EVENT_TYPES **파생** | 타입 강제(컴파일 에러) | 한 벌 |
| 6 | 정책 파일 목록 | `policy.ts:45,48` → `hook.ts:180` CORE_FILES **파생** | import | 한 벌 |
| 7 | 해시 규율(경로·길이·내용 구분자) | `hash.ts:20` ← gate.ts:524·policy.ts:104 공용 | [ENG-186] | 한 벌 |
| 8 | **셸/해석기 unwrap 집합** | `bashwrite.ts:597–602` scanBashWrites case(sh,bash,zsh,dash,ksh,eval) ↔ `:733` commandLines(sh,bash,zsh,dash,ksh) ↔ `:254–258` INTERPRETERS(+fish,ash…) 및 `:275` proc-subst(+fish,source) ↔ `hook.ts:677` SCRIPT_RUNNERS(+source,.) | **없음** — M15(commandLines 에서 zsh 삭제) 전건 초록 생존 | **위반** |
| 9 | 런타임 마커 경로 | `hook.ts:159–160` 리터럴 `.harness/.runtime/last-activity` ↔ `runtime.ts` `runtimeDir()+이름` 합성 | 직접 고정 없음(현재 일치) | LOW 주의 |
| 10 | 접두 명령 목록 | `bashwrite.ts:167` PREFIX_COMMANDS → `hook.ts:71` PREFIX_SET **파생**(+xargs) | LOGIC-94 테스트 | 한 벌 |
| 11 | 자기호출 인식 ↔ 하네스-실행 인식 | `hook.ts:81` isSelfCall ↔ `:135` invokesHarness | 의도적 분리(오류 안전 방향이 반대, 주석으로 계약 명시) | 중복 아님 |

#8 이 하드 조건을 깬다. 단순한 목록 불일치가 아니라 **규칙의 소유권 분열**이다: `opaqueExecOf` 는 리터럴 `-c` 프로그램을 「재귀 스캔이 본다」는 이유로 면제하는데(`bashwrite.ts:295` 주석), 그 재귀 스캔(unwrap)은 fish/ash 를 모른다 — 두 반쪽이 서로에게 미루는 사이 아무도 판정하지 않는다. 실측(결함 2 참조): `fish -c "npm publish"` ALLOW.

## 뮤테이션 결과 (위치 · 입력 · 검출/생존)

샌드박스 클론(80b633c)에서 규칙 구현부 13곳에 결함 주입, 매회 전체 스위트(1233) 실행 후 원복. **생존 2 / 검출 11.**

| ID | 위치 | 주입 | 그 절만 발화하는 입력 | 결과 |
|---|---|---|---|---|
| M1 | hook.ts:1199 `HARNESS_ALLOW_FORCE` 리터럴 절 → false | env 백스톱 제거 | `HARNESS_ALLOW_FORCE=1 make escalate` (HEAD: DENY → 변이: ALLOW, 프로브로 확인) | **생존** — 1233 전건 초록 |
| M1b | hook.ts:1230 `HARNESS_APPROVE_NO_TTY` 절 → false | 〃 | `export HARNESS_APPROVE_NO_TTY=1` | 검출 (2 fail) |
| M1c | hook.ts:1257 `HARNESS_ACCEPT_POLICY` 절 → false | 〃 | `HARNESS_ACCEPT_POLICY=1 make x` | 검출 (1 fail) |
| M2 | hook.ts:132 CORE_INVOKE_RE 무력화 | `core→coreZZ` | `node …/core/dist/cli.js doctor --accept-policy` | 검출 (2 fail, SEC-96) |
| M3 | events.ts:94 REPLAY_TYPES 에서 `gate-invalidated` 삭제 | 빠른 경로가 무효화 누락 | 무효화 이벤트 재생 | 검출 (1 fail, DET-54) |
| M4 | hooks.json PreToolUse matcher 에서 NotebookEdit 삭제 | 배선 누락 | — | 검출 (3 fail, ENG-A) |
| M5 | bin/harness-hook `-e` → `-d` | fail-open 재도입 | `.harness` 가 일반 파일 | 검출 (1 fail, COST-130) |
| M6 | bashwrite.ts:493 mv 원본 대상 제거 | SEC-101 되돌림 | `mv .harness /tmp/x` | 검출 (3 fail) |
| M7 | hook.ts:1431 `!rt.lastTurnAt \|\|` 제거 | 첫 턴 정산 강제 해제 | 활동 후 미정산 stop | 검출 (4 fail) |
| M8 | hook.ts:824 coversPath 접두 매치 제거 | SEC-91 되돌림 | `cp -r /tmp/x .harness` | 검출 (4 fail) |
| M9 | events.ts:167 `if (!t){corrupt++;continue}` 제거 | **COST-177 회귀 재현**(행위 동일·성능만 열화) | 100k 전줄 손상 저널 | 검출 (1 fail — `med-3j-residuals.test.ts:162` 전용 성능 테스트, 인프로세스 표면·문턱 200ms·실측 2558ms) |
| M13 | hook.ts:899 `isNew` → false | 출하 트랙 신규 파일 금지 해제 | P10+ 에서 새 소스 파일 | 검출 (2 fail) |
| M15 | bashwrite.ts:733 commandLines 목록에서 zsh 삭제 | 중복 목록 한쪽만 훼손 | `zsh -lc "npm publish"` (HEAD 에서 DENY 확인됨) | **생존** — 1233 전건 초록 |

생존 2건의 의미: M1 은 보안 관련 3형제 절 중 **한 절만** 커버리지가 없다(형제 둘은 각각 2·1건이 잡는다) — 초록이 그 절의 옳음을 보증하지 않는 정확한 사례. M15 는 대조표 #8 의 두 벌이 실제로 아무 테스트에도 물리지 않음을 보인다.

## G9 게이트의 실행 가능성·회귀 탐지력 검증 (★ 필수 항목)

**(a) 재현되는가 — 예.** `npm run bench:hook` 이 배포본 샌드박스에서 빌드·추가 의존성 없이 돌았다. 표본 수(n=30)·워밍업(3)·백분위(p95)·측정 표면(프로세스 wall-time)·node 기동 바닥값·머신 정보(load 포함)를 전부 출력한다 — [PROD-180] 의 「제3자가 다시 잴 수 있어야 한다」는 그 자체로는 이행됐다.

**(b) 델타의 분산 — 문턱보다 크다.** 같은 샌드박스·같은 빌드로 5회 연속 실행(주변 load 8–17/10코어, 아래 「못 잰 것」 참조):

| run | realistic Δp95 | corrupt Δp95 | all-state Δp95 |
|---|---|---|---|
| 1 | +39.0 | **+1.3** | +77.6 |
| 2 | +31.9 | **+147.8** | +31.9 |
| 3 | +33.4 | +21.9 | +73.8 |
| 4 | +22.6 | +27.2 | +83.2 |
| 5 | +45.2 | +31.5 | +45.5 |

- **문턱 적용 부류(corrupt)가 같은 빌드에서 PASS(+1.3)와 FAIL(+147.8)을 오간다** — 범위 146.5ms, 표본표준편차 ≈58ms. 문턱 50ms 는 단일 실행 노이즈 밴드 안에 있다. realistic 도 +22.6~+45.2 로 문턱의 절반을 오간다(run 5 는 5ms 차).
- 원인은 추정기 설계다: 델타 = 순차(비교차) 측정한 두 p95 의 차 · p95 는 30표본의 **2등 최악값**이라 outlier 하나가 곧 판정 · 반복·산포 출력 없음. **탐지 하한**: 이 추정기로는 이 환경에서 ±60~70ms 미만의 회귀를 한 번의 실행으로 판별할 수 없다 — 즉 50ms 문턱의 회귀를 신뢰 있게 잡지 못하고, 건강한 빌드를 거짓 빨강으로 만들 수도 있다(run 2).
- 대비: 같은 회귀 부류(COST-177, 줄당 예외)를 잡는 **테스트 쪽** 장치는 건강하다 — `med-3j-residuals.test.ts:162` 가 인프로세스 표면·10배 여유 문턱(200ms vs 회귀 시 2558ms)으로 부류를 고정하고, M9 뮤테이션을 실제로 잡았다. 즉 「이미 아는 회귀」는 CI 가 잡지만, **G9 게이트 자체(50ms 문턱)** 는 그렇지 않다.

**(c) 적대적 부류 무문턱 구분 — 사유는 정당하나 산문에만 있다.** 「저널은 harness 명령으로만 늘어난다」는 전제를 검증했다: 저널 쓰기는 `appendEvent` 뿐이고 에이전트의 직접 쓰기는 훅이 전방위로 deny(STATE_FILES + 이름 안전망 + 패치·스크립트 재귀), 사람 경로는 개정 1 로 범위 밖 — 10만 상태전이 저널은 실제 도달 불가라는 판단은 합리적이다. 실측도 뒷받침한다(all-state Δ +31.9~+83.2, 문턱을 걸었다면 5회 중 3회 FAIL — 기록만 하는 선택이 옳았다). 그러나 이 구분은 **`gates.md` 산문과 벤치의 `console.log` 꼬리문**에만 있다. 판정 코드·assert·부류 메타데이터 어디에도 박혀 있지 않다.

**(d) CI 자동 검사 가능한 형태인가 — 아니다.** 벤치는 항상 exit 0 이다(문턱 초과 run 2 도, 소규모 재현으로 별도 확인한 실행도 exit 0). 문턱 비교·부류 구분·판정 전부 사람이 표를 읽어야 한다. JSON 출력도 없다. `doc-claims.test.ts:59` 는 스크립트의 **존재**만 고정한다. 또한 G9 의 「세는 방법」은 「**두 표면**(인프로세스·프로세스 wall-time) 모두 계측」을 요구하는데, 패키지에 실린 벤치는 wall-time 한 표면만 잰다 — 인프로세스 쪽은 export-ignore 된 `docs/…/evidence/cost-177-bench.ts` 에만 있고 npm script 로 배선돼 있지 않다. gates.md 표의 「50% 손상」 부류도 벤치 SHAPES 에는 없다(100% 손상만).

**소결**: 라운드 3-J 의 (a) 부류별 측정 확대와 (b) 벤치 동봉은 방향이 옳고 재현도 된다. 그러나 「실행 가능한 형태」 기준으로는 미달 — 게이트는 여전히 수동 판독이고, 문턱이 추정기의 노이즈 안에 있어 단일 실행으로는 회귀 탐지력이 없다. 처방 방향(참고): 교차(interleaved)·짝지은 표본의 델타 중앙값, n 상향 또는 반복-중앙값, 산포 출력, exit code + 부류별 임계 내장(적대 부류는 record-only 플래그로 코드에 박기), 인프로세스 표면 동봉.

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

1. **[MED] `HARNESS_ALLOW_FORCE` env-리터럴 백스톱 절 무커버리지 (생존 뮤테이션)** — `core/src/hook.ts:1199`. 재현: 그 절을 `false` 로 바꿔도 1233 전건 초록. 의미 확인: `HARNESS_ALLOW_FORCE=1 make escalate` 가 HEAD 에서 DENY, 변이 후 ALLOW(Makefile 간접 실행은 훅이 못 보는 문서화된 한계라 이 절이 유일한 방어다). 형제 절(`hook.ts:1230`, `:1257`)은 각각 2·1건의 테스트가 잡는다 — 비대칭 커버리지.
2. **[MED] 셸 unwrap 목록 드리프트 — `fish -c`/`ash -c`/`busybox sh -c` 로 설계 트랙 배포 차단 우회** — `core/src/bashwrite.ts:254(INTERPRETERS) vs :597·:733(unwrap 목록)`, 거짓 전제 주석 `:295`. 재현(80b633c 샌드박스, P0): `handleHook(pre-tool, Bash, 'fish -c "npm publish"')` → **ALLOW** (sh/bash/zsh/ksh 는 DENY). `runsCommand('fish -c "npm publish"', 'npm publish')` = false. 하드 조건 「중복 규칙 0」 위반의 실측 증거이자 [ENG-172] 「명령 실행 판정은 한 벌」 계약의 잔존 구멍.
3. **[MED] `commandLines` 셸 목록이 두 벌인데 고정 장치가 없다 (생존 뮤테이션 M15)** — `core/src/bashwrite.ts:733`. 재현: 목록에서 `'zsh'` 삭제 → 1233 전건 초록. 그 상태에서 `zsh -lc "npm publish"` (HEAD 에서 DENY 확인) 가 ALLOW 로 뒤집힌다.
4. **[MED] G9 게이트가 자동 검사 불가능한 형태** — `scripts/bench-hook-latency.mjs` 전체(assert·exit code·JSON 없음, 항상 exit 0), 적대 부류 면제는 `:99–100` 출력문과 `docs/release-readiness/2026-08-21/gates.md` 산문뿐. 재현: 문턱 초과가 나온 실행(아래 5회 중 run 2)도 exit 0.
5. **[MED] G9 델타 추정기가 노이즈 지배 — 같은 빌드가 PASS/FAIL 을 오감** — `scripts/bench-hook-latency.mjs:44–54(비교차 순차 30표본 p95), :91(두 p95 의 차)`. 재현: 5회 연속 실행, corrupt Δ = +1.3/+147.8/+21.9/+27.2/+31.5ms (문턱 50ms). 측정 표면: 프로세스 wall-time(sh 래퍼+node 기동 포함), arm64 10코어, 주변 load 8–17.
6. **[LOW] 벤치 음수 델타 표기 오류 `**+-13.8ms**`** — `scripts/bench-hook-latency.mjs:92` 무조건 `+` 접두. 재현: `BENCH_LINES=2000 BENCH_N=5 npm run bench:hook` 에서 관측(열화가 정상보다 빨라진 노이즈 케이스).
7. **[LOW] 패키지 벤치가 G9 「세는 방법」의 두 표면 중 하나만 잰다** — 인프로세스 표면은 `docs/…/evidence/cost-177-bench.ts`(export-ignore, npm script 미배선)에만. gates.md 의 50% 손상 부류도 SHAPES 에 없음 — `scripts/bench-hook-latency.mjs:36–42`.
8. **[LOW] 낡은 주석: 재생 대상 타입 「8개뿐」** — `core/src/events.ts:138` (실제 REPLAY_TYPES 는 9개, `:92–96`). 두 벌 목록에 붙은 수가 틀리면 대조하는 사람이 헛짚는다.
9. **[LOW] 런타임 마커 경로가 리터럴 두 벌** — `core/src/hook.ts:159–160` vs `core/src/runtime.ts`(runtimeDir 합성). 현재 일치하나 개명 시 보호 목록만 낡는다. 직접 고정 테스트 없음.

## 못 잰 것 (정직 고지)

- **유휴 머신에서의 벤치 분산** — 감정 내내 같은 머신에서 다른 작업(load 8–17/10코어)이 돌았다. 벤치가 load 를 출력해 주어 기록은 남지만, 노이즈의 몇 %가 주변 부하 몫인지 분리하지 못했다. 유휴 환경에서 corrupt Δ 분산이 문턱 아래로 내려올 가능성은 남는다(다만 run 1↔3↔4↔5 의 20~30ms 산포와 p95-of-30 구조상, 50ms 문턱의 여유가 충분해질 것으로 보긴 어렵다).
- **인프로세스 표면의 델타 재측정** — evidence 벤치를 직접 이식해 돌리지 않았다(M9 검출 테스트의 인프로세스 실측 200ms/2558ms 로 갈음).
- **뮤테이션의 전수성** — 13곳 수작업 선정이지 mutation-testing 도구의 전수 스윕이 아니다. 생존 2건은 하한이다.
- **실제 Claude Code 런타임 통합** — hooks.json 이 실제 클라이언트에서 그 payload(`notebook_path` 등)로 불리는지는 정적 확인만 했다(다른 축의 E2E 영역).
- **fish/ash/busybox 우회의 실전 발생 확률** — 모델이 자연히 그 표현을 쓰는지는 재지 않았다. 엔지니어링 축에서는 「한 벌 계약의 갈라짐」으로 평가했고, 실효성 축 판정은 그쪽 감정자 몫.
- **npm ci 공급망** — lockfile 을 신뢰하고 받았다(G8 은 이 축 범위 밖).

## 점수 산출 근거

- 조건 4개 중 3개 충족(테스트 ×3 동일 — 배포본·리포 두 형태 모두, tsc 0, 빌드 바이트 재현 — 커밋 dist 신선까지). **하드 조건 「중복 규칙 0」 미충족** → 규정상 4.8 불가.
- 가점 요소: 알려진 두-벌 규칙 전부에 교차 고정이 실재하고 **뮤테이션으로 발화를 확인**(M2~M8·M13 검출 11건, 그중 성능 회귀 부류까지 전용 테스트로 고정된 M9 는 드묾) · 빌드가 정규화 없이 바이트 동일 · 조용한 실패 경로에 관측 장치(hook-errors.log `hook.ts:296`, doctor 의 corrupt 보고 `doctor.ts:136`, inspectConfig `config.ts:104`) 실재.
- 감점 요소: 하드 조건 위반(결함 2·3, MED×2) + 보안 절 커버리지 비대칭(결함 1, MED) + 이번 라운드 필수 검증 대상인 G9 가 「실행 가능한 형태」 미달(결함 4·5, MED×2) + LOW 4건.
- 산출: 기저 5.0 에서 하드 조건 위반으로 4.8 상한 해제 후, MED 5건(각 -0.1 상당, G9 두 건은 게이트 자체 결함이라 중복 감점하지 않고 합산 -0.5)·LOW 4건(합산 -0.2) → **4.3**. 결과를 보고 기준을 낮추지 않았다 — 근거는 전부 위 실측이다.
