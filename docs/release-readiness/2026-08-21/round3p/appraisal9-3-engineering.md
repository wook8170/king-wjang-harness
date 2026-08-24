# [3] 엔지니어링 품질 감정 — 3.9/5

**점수** 3.9 · **4.8 충족** ✗ (하드 조건 「중복 규칙 0」이 **다섯 라운드 연속** 미충족 —
이번 열 번째 사본은 「이 도구가 작업을 한 쓰기인가」 판정이 **preTool 과 postTool 두 곳으로
갈린 것**이다: [SEC-265] 가 preTool 의 `isWrite` 에 `|| isMcpWrite` 를 더하면서 **거울 자리인
postTool 의 활동 집계는 그대로 뒀다**. 그 결과 한 턴의 작업을 전부 MCP 파일시스템 쓰기 도구로
하면 stop 가드의 「턴 로그를 남겨라」 회계가 **조용히 꺼진다** — 실측으로 재현) · **감정 시각**
2026-08-24 · **대상 HEAD** `d3e2a0a` (모든 실측은 이 커밋의 샌드박스 클론 3벌에서. 감정 도중
리포 HEAD 가 `36226be` 로 전진했으나 그것은 `progress.md` 만 바꾼 `docs:` 핸드오프 커밋이고,
작업트리의 미커밋 변경(`bashwrite.ts`·`cli.js`·`blocker-3n.test.ts`)은 병행 세션의
`[SEC-268]`(명령내 별칭 추적, **축 2**) 작업이다 — **내 발견 결함은 `hook.ts` 에 있고 그 파일은
안 건드려졌다.** `git merge-base --is-ancestor d3e2a0a HEAD` = YES, 대상은 history 에 온전) ·
**도구** node v22.22.2 · tsc 5.9.3 · vitest 2.1.9 · tsup 8.5.1

**한 줄**: 직전 라운드의 MEDIUM([ENG-O1] 개행 dry-run → 진짜 `prisma migrate deploy` 통과)과
LOW([ENG-O2] `nodejs` 자기해제)는 **정본 파생 + 전수 테스트로 진짜 닫혔다**(뮤테이션으로
검증 — 3-O 가 「무테스트」라 고지한 자리에 이번엔 못 박는 테스트가 붙었다). 그러나 하드 조건은
또 반증된다 — 이번엔 배포 우회가 아니라 **회계 게이트(stop 가드) 우회**로, 「쓰기 도구」 정의가
preTool·postTool 두 벌로 갈린 채 MCP 쓰기에서 답이 달라진다(무백스톱은 아니나 무테스트·조용).
잔여 최악이 3-O 의 「진짜 배포 통과(MEDIUM)」에서 「턴 로그 넛지 회피(LOW~MEDIUM)」로 **실측
하락**했고, 닫힌 결함이 처음으로 테스트로 고정됐다 — 근거 있는 만큼만 **3.8 → 3.9**. 하드 조건이
살아 있으므로 4.8 미만은 확정.

---

## 조건별 실측

| 조건 | 결과 | 근거(measured, 샌드박스 클론) |
|---|---|---|
| 테스트 전건 green ×3 동일 | ✓ | `npx vitest run </dev/null` **3회 연속** → 매번 `Test Files 54 passed (54)` · `Tests 1311 passed (1311)`. 3벌 동일, 실패·skip 0. (3-O 대비 +10 테스트: 1301→1311.) |
| tsc --noEmit | ✓ | 클론 루트 `npx tsc --noEmit </dev/null` → **exit 0, 출력 없음**. |
| 빌드 바이트 재현 | ✓ | 독립 클론 **2벌**에서 `core/dist` 삭제 후 `npm run build` → `cli.js` SHA-256 = `e9d1dcf5743c19ad8222c430fc1ad5c51341db603a399b92a5b8cfbdf4841419`, `mcp.js` = `131e7b454a840ad9335a9d8482ec67e4ce9f37b6cec2ef2a4e62757fbb87a51c`. **커밋된 dist(`git show d3e2a0a:core/dist/cli.js`)와 바이트 동일**, 두 클론 상호 동일. |
| **중복 규칙 0** | **✗** | 「이 도구가 작업한 쓰기인가」 판정이 **preTool(`isWrite`)과 postTool(`noteActivity`) 두 벌**로 갈렸다 → MCP 쓰기 도구에서 답이 달라져 stop 가드 회계 우회(§발견결함 **ENG-P1**, 실측). 하드 조건이므로 잔여 감점이 아니라 **조건 미충족**으로 판정. |

실측 요지:
```
Tests  1311 passed (1311)   # RUN 1
Tests  1311 passed (1311)   # RUN 2
Tests  1311 passed (1311)   # RUN 3
tsc exit=0  (출력 없음)
e9d1dcf5…  core/dist/cli.js   (커밋본과 동일 · 독립 2클론 재현)
131e7b45…  core/dist/mcp.js   (커밋본과 동일 · 독립 2클론 재현)
```

## 중복 규칙 전수 조사 (규칙 **및 적용 순서**)

**뽑은 방법**: 판정에 쓰이는 상수·정규식·리스트·**적용 순서**를 `grep -rnE` 로 전수 추출한 뒤,
「같은 질문에 답하는 코드가 두 군데 이상인가 · 같은 정본을 쓰는가 · **같은 순서로 쓰는가**」를
질문별로 묶어 대조했다. 새로 들어온 `judgeableLines`·`flagValues`(묶음)·`MCP_WRITE_MATCHER`·
`NON_SHELL_INTERPRETERS`(재파생)·하드링크 inode 검사를 전부 포함했다.

### 정본으로 수렴한 것 (전부 뮤테이션으로 load-bearing 확인 — §뮤테이션)

| 질문 | 정본 | 사용처(파생) | 판정 |
|---|---|---|---|
| 어느 셸/해석기가 -c·러너·직접실행인가 | `SHELLS_TAKING_C` | `INTERPRETERS`·`SCRIPT_RUNNERS`·`DIRECT_SCRIPT_EXT`·`INTERPRETER_HEADS` 전부 파생 | 정본화(3-O에서 완결, 유지) |
| dry-run 예외 — **나누기/거르기 순서** | **`judgeableLines`**(신규, bashwrite:1084) | hook:1893 `judgeableLines(cmd)` · profile:520 `judgeableLines(...).map(normCmd)` | **닫힘 — §ENG-O1 검증** |
| 무엇이 코어를 실행/자기해제하나 | **`NON_SHELL_INTERPRETERS`**(재배치) | `CORE_INVOKE_RE`(신규 파생 + 러너 `npx·bunx·pnpx`) · `INTERPRETER_HEADS` | **닫힘 — §ENG-O2 검증** |
| MCP 쓰기 도구 이름 규칙 | **`MCP_WRITE_MATCHER`**(신규, hook:60) | `hooks/hooks.json` 매처 · `isMcpWrite` 판정 | 정본화(surface-parity 가 `endsWith` 로 고정) |
| 플래그-값 경로(묶음 포함) | `flagValues`(묶음 파싱 추가) | `targetDirectory`·`tar -C`·`rsync --backup-dir`·`git --separate-git-dir` | 정본화 |
| 경로처럼 생겼나 | `looksLikePath`(export) | bashwrite 후보 필터 · hook MCP 필드 추출 | 정본화(한 함수 공유) |
| 보호 파일 목록 | `CORE_FILES = [...STATE_FILES, ...POLICY_FILES]` | 하드링크 inode 검사·경로 매치·`OWNED_BASENAMES` 전부 파생 | 정본화 |

- **dry-run 순서(핵심)**: 3-O 는 `profile.ts` 가 `normCmd`(개행→공백)를 **나누기 앞**에 둬
  개행에서 갈렸다. 이번엔 `judgeableLines` 가 **`commandLines` → `!isDryRun` 순서까지** 정본에
  담고, 두 사용처가 이걸 부른 뒤 각자 고유 정규화(`profile` 만 `.map(normCmd)`)를 **나눈 뒤에**
  붙인다. 순서 정본화 확인.
- **`config.design_blocked_bash`(20) vs `GENERIC_FLOOR.deployCommands`(20)**: 관리된 중복 —
  `profile.test.ts` 파리티 테스트로 고정. 두 배포 판정 경로(config 는 `===`/`startsWith` 대소문자
  민감, profile 은 `normCmd`+`runsCommand`)의 강도 차는 실재하나 **profile 경로가 항상 도는
  strict 상위**다(`loadProfile` 은 절대 throw 안 함 → 최악이 `GENERIC_FLOOR`, 실측 확인). 그래서
  약한 config 경로가 뚫려도 강한 profile 경로가 백스톱 → **잘못된 통과로 이어지지 않음**. 결함 아님.

### 열 번째 사본 — postTool 이 preTool 을 안 따라갔다 (§ENG-P1)

| 위치 | 「쓰기(작업)인가」 판정 | MCP 쓰기 도구 | 판정 |
|---|---|---|---|
| `hook.ts:1420` preTool `isWrite` | `WRITE_TOOLS.includes(tool) **|| isMcpWrite**` | **쓰기로 봄**(판정·차단 대상) | [SEC-265]가 갱신 |
| `hook.ts:1998` postTool `noteActivity` 조건 | `WRITE_TOOLS.includes(tool) || (Bash && …)` — **`isMcpWrite` 없음** | **활동 아님**(회계 제외) | **드리프트(ENG-P1)** |

같은 규칙(「이 도구가 작업트리를 바꾼 쓰기인가」)의 두 구현이 **MCP 쓰기에서 답이 갈린다.**
preTool 은 MCP 쓰기를 쓰기로 판정(그래서 차단 로직이 돌지만), postTool 은 활동으로 안 세서
stop 가드의 「턴 로그를 남겨라」가 안 뜬다. `git log -S` 로 확인: postTool 조건은 **원 코어
(6305fc7) 이래 불변**이고 [SEC-265](6703ed8)가 preTool 만 고쳤다 — 「한 곳 고치고 거울을 놓친다」의
정확한 재발.

## 새 정본들의 파생 검증 (뮤테이션)

전건(1311) 기준으로 새 정본·판정 절을 무력화/역전해 **어떤 테스트도 안 깨지는 절**이 있는지
봤다. 3-O 가 「지정 절 중심」이라 고지한 것을 새 코드 전수 + 비지정 절로 넓혔다.

| # | 뮤테이션 | 결과 | 해석 |
|---|---|---|---|
| M1 | `profile.ts` 를 **normCmd-먼저-나누기**(3-O 깨진 순서)로 되돌림 | **검출** — blocker-3n 1 fail | **ENG-O1 이 이번엔 테스트로 고정됐다.** 3-O 의 MUT-O1 은 무검출이었는데, 개행 4구분자 테스트(`[ENG-O1]`)가 이제 잡는다. |
| M2 | `NON_SHELL_INTERPRETERS` 에서 `nodejs` 제거 | **검출** — blocker-3n 1 fail | ENG-O2 파생이 load-bearing. `nodejs` 회귀 테스트 존재. |
| M3 | `MCP_WRITE_MATCHER` 에서 `copy` 제거(hooks.json 불변) | **검출** — surface-parity 1 fail | `endsWith` 파리티가 배선/판정 드리프트를 잡음. |
| M4 | `flagValues` 묶음 파싱을 옛 `slice(2)` 로 되돌림 | **검출** — blocker-3n 5 fail | [SEC-264] 묶음 단축플래그가 load-bearing. |
| M5 | 하드링크 inode 검사(`aliasOfCore`)를 항상 undefined 로 | **검출** — blocker-3n 1 fail | [SEC-263] 기존-하드링크 방어가 load-bearing. |
| M6 | `judgeableLines` 에서 dry-run 필터 제거 | **검출** — 전건 3 fail | 순수 dry-run 과차단 → dry-run 예외가 load-bearing. |
| W1 | `CWD_MAX 4096 → 10` | **검출** — 1 fail | 경로 길이 상한 테스트 존재. |
| W2 | hook `value.length > 4096 → 5` | **검출** — 1 fail | MCP 필드 길이 상한도 테스트 존재. |
| W3 | `CORE_INVOKE_RE` 러너 목록에서 `npx` 제거 | **검출** — 2 fail | 패키지 러너 손목록이 테스트로 고정. |
| W4 | `isDryRun` → 항상 false | **검출** — 3 fail | dry-run 정본이 load-bearing. |
| **M7** | `isMcpWrite` 의 **조회 도구 제외 필터**(`!/(read\|list\|…)/`) 제거 | **미검출** — 전건 green | **읽기-제외 필터가 무테스트다.** 지우면 write동사+read단어 도구가 쓰기로 오판(과차단 방향)되는데 아무 테스트도 안 잡는다. LOW(과차단 방향·희귀 이름). |

- **M1 이 이번 라운드의 핵심 진전이다.** 3-O 가 「dry-run 순서가 양방향 무테스트」라 고지한
  자리에 이제 못 박는 테스트가 붙었고(M1 검출), 실측으로도 4구분자·혼합·서브셸 전부 닫혔다.
- **M7 이 잔여 illusory 커버리지다.** 읽기-제외 필터를 아무 테스트도 고정하지 않는다(과차단 방향).

### ENG-O1·ENG-O2 실측(출하 dist·실 프로파일)

**ENG-O1 닫힘** — 실 번들 `nextjs-prisma` 프로파일 + 출하 dist(`e9d1dcf5…`) + 실제 훅 바이너리로:
```
prisma migrate deploy                                => deny   (정상 차단)
prisma migrate deploy --dry-run                      => allow  (dry-run 면제 · 과차단 아님)
prisma migrate deploy --dry-run␤prisma migrate deploy => deny   ← 3-O 우회가 닫혔다
prisma migrate deploy --dry-run && prisma migrate deploy => deny
```
`isDeployCommand` 직접 호출로 `&&`·`;`·`||`·`␤`·`␤␤`·`&&␤`·`|tee;`·`(…)␤` 8케이스 전부 정답,
순수 dry-run 2케이스는 false(과차단 없음). **ENG-O2 닫힘** — `node·nodejs·deno·bun·npx·bunx·pnpx`
7런타임 전부 `cli.js … --force` 에서 DENY(3-O 의 `nodejs` 갭 사라짐).

## 캐시 정확성 검증 ([COST-260] `realCache`)

`realCache` 수명은 3-O 와 동일하게 `handleHook` 진입 `new Map()`(hook:269) → `finally` `null`
(hook:316) = **판정 1회**. 신규 하드링크 inode 검사는 `realCache` 를 안 거치고 `fs.statSync` 를
**매번 신선 조회**한다. **판정 사이** fs 변경을 동일 프로세스 연속 판정으로 직접 쟀다:

- **심링크 교체**: `lnk→safe`(ALLOW) → 판정 사이 `lnk→.harness/config.yaml` 로 교체 → **DENY** →
  다시 `lnk→safe` → **ALLOW**. `[false, true, false]` — 낡은 답 0.
- **하드링크 신규 생성**: `alias`(없음, ALLOW) → 판정 사이 `ln .harness/config.yaml alias` → 재판정
  **DENY**. 갓 만든 하드링크를 신선 `stat` 으로 즉시 잡음.
- **실 심링크→state.json**: DENY.

캐시는 정확성을 해치지 않는다. 판정 **도중** fs 불변 가정만 쓰는데(읽기 전용 판정) 성립한다.

## 벤치 게이트 재검증 ([COST-262])

일부러 O(R²) 를 되살려 게이트가 FAIL 을 내는지 재검증(샌드박스 재빌드):
- **뮤테이션**: `realOrSelf` 를 캐시 우회(`return realOrSelfUncached(p)`)로 되돌림 → dist 재빌드.
- **측정**(`cd-redirect` 1000세그먼트, `CMD_GATE_MS=1000`):
  ```
  BASELINE (캐시 on) : cd-redirect p95 =   330.9ms → PASS  (exit 0)
  MUTATED  (캐시 off): cd-redirect p95 = 23673.7ms → FAIL  → "real regression" 출력
  ```
  23.7s 는 훅 타임아웃 10초도 넘어 **fail-open** 이 되는 부류다. `failed>0 → process.exitCode=1`
  이 발화한다. 게이트가 회귀를 실제로 잡는다(재확인). BUSY 게이팅도 정직(부하 중 초과는 실패로
  안 세고 사실만 표기).

## 발견 결함

### [ENG-P1] (MEDIUM) 「쓰기 도구」 정의가 preTool·postTool 두 벌로 갈려 MCP 쓰기 턴이 stop 가드 회계를 우회
- **원인**: [SEC-265](6703ed8)가 preTool `isWrite = WRITE_TOOLS.includes(tool) **|| isMcpWrite**`
  로 넓혔으나, **거울 자리인 postTool 활동 집계**(`hook.ts:1998`)는 `WRITE_TOOLS.includes(tool)`
  그대로다 — MCP 쓰기 도구가 여기 안 들어간다. `noteActivity` 의 유일한 소비자는 stop 가드
  (`hook.ts:2028`: `if (!rt.lastActivityAt) return null`)라, 활동이 안 찍히면 「턴 로그를 남겨라」
  넛지가 **안 뜬다**.
- **결정적 관측(P7 빌드 트랙, 같은 소스 편집 `src/app.ts`)**:
  ```
  Write 도구            : pre-denied=false(허용) · post 활동집계=true
  mcp__filesystem__write_file : pre-denied=false(허용) · post 활동집계=false   ← 갈림
  ```
- **재현(활성 웨이브 + 턴 로그 미갱신, stop 훅)**:
  ```
  Write 도구로 한 턴 → stop  => block  ("harness wave update 로 지시서를 갱신하라")
  MCP 쓰기로 한 턴  → stop  => 침묵(null)                                    ← 우회
  ```
  즉 한 턴의 작업을 전부 MCP 파일시스템 쓰기 도구로 하면, 그 턴은 **활동으로 집계되지 않아**
  stop 가드의 회계 요구를 조용히 빠져나간다.
- **근본원인 확인**: `git log -S "noteActivity(root)"` → postTool 조건은 원 코어(6305fc7) 이래
  불변. `git show 6703ed8` → preTool 만 `|| isMcpWrite` 추가. **한 곳 고치고 거울을 놓친** 드리프트.
  뮤테이션: postTool 을 `mcp__*` 쓰기로 구동하는 테스트가 **0건**이라 무테스트(§뮤테이션 표 밖에서
  확인 — 전건 green 상태로 이 갈림이 산다).
- **영향/무게**: **잘못된 통과이되 상한이 있다.** 보호 파일 쓰기는 preTool 이 여전히 막으므로
  (실측) **차단 우회는 아니다.** 뚫리는 것은 이 하네스의 핵심 규율 장치인 **턴 로그/정산 넛지**다 —
  「에이전트가 제 작업을 회계하게 한다」가 제품 명제인데, 도구를 MCP 파일시스템 쓰기로 바꾸는
  것만으로 그 넛지가 조용히 꺼진다. 다만 stop 가드는 **탈출구가 있는 넛지**(「사소한 턴이면 한 줄
  사유 대고 종료」)이고, 게이트 제출(`gate submit --evidence`)의 하드 회계는 별개라 **하드 게이트는
  안 뚫린다**. 그래서 3-O 의 「진짜 배포 통과(MEDIUM)」보다 **가볍다** — MEDIUM 하단.
- **처방**: postTool 도 preTool 과 **같은 정본**을 쓰게 한다 — `isWrite`(=`WRITE_TOOLS || isMcpWrite`)
  계산을 두 경로가 공유하는 헬퍼로 뽑거나, 최소한 `noteActivity` 조건에 `isMcpWrite` 를 더한다.
  그리고 `mcp__*` 쓰기로 postTool→stop 을 구동하는 회귀 테스트를 붙인다(현재 0건).
- **위치**: `core/src/hook.ts:1420`(넓힌 쪽) · `core/src/hook.ts:1998`(안 따라간 쪽).

### [ENG-P2] (LOW) `isMcpWrite` 의 조회-제외 필터가 무테스트 (과차단 방향)
- **관측**: M7 뮤테이션 — `&& !/(read|list|search|grep|find|get|stat|info)/i.test(tool)` 를 지워도
  전건 green. 이 필터는 write동사+read단어 도구(`mcp__x__get_or_create` 류)를 쓰기에서 빼 과차단을
  막는데, 그 동작을 고정하는 테스트가 없다. 과차단 방향·희귀 이름이라 **LOW**.
- **처방**: 조회-제외를 고정하는 테스트 1건(현재 `★ 조회 도구` 케이스는 write동사가 없어 이 필터를
  안 건드린다).

### [ENG-P3] (LOW) 같은 개념(PATH_MAX)의 매직넘버 `4096` 이 두 리터럴 — 다만 양쪽 테스트-고정
- `CWD_MAX = 4096`(bashwrite:121)과 hook:1445 `value.length > 4096` 이 같은 실세계 한계(경로 최대
  길이)를 **두 리터럴**로 적었다. 다른 판정 경로라 같은 입력에 다른 답을 내지는 않고, **양쪽 다
  테스트로 4096 에 고정**(W1·W2)이라 조용히 갈릴 수 없다. 규칙 드리프트가 아니라 DRY 코드-냄새 →
  **LOW**(하드 조건 판정에는 안 셈, 정직 고지).

## 직전 라운드 대비 (3-O 3.8 → 3-P 3.9) — 근거

- **닫힌 것(뮤테이션으로 재확인)**:
  - **[ENG-O1](MEDIUM) 닫힘** — dry-run 나누기/거르기 순서가 `judgeableLines` 정본에 담겼고, 실
    번들 프로파일·출하 dist 로 개행 우회가 DENY 로 복귀. **처음으로 순서-드리프트 결함이 테스트로
    고정**됐다(M1 검출). 3-O 의 진짜 배포 통과(운영 DB 마이그레이션)가 실제로 사라졌다.
  - **[ENG-O2](LOW) 닫힘** — `CORE_INVOKE_RE` 가 `NON_SHELL_INTERPRETERS` 파생, `nodejs` 포함,
    회귀 테스트 존재(M2 검출).
  - **[SEC-263/264/265] 새 정본들**(하드링크 inode·묶음 플래그·MCP 매처)이 전부 load-bearing +
    테스트-고정(M3·M4·M5). 셸 목록 정본화의 규율이 새 표면으로 확장됨.
- **나빠진/그대로**:
  - **하드 조건 「중복 규칙 0」 다섯 라운드 연속 ✗** — 이번 사본은 **정본화 작업(SEC-265) 자체가
    연 것**이다(preTool 만 넓히고 postTool 거울을 놓침). 「한 곳 고치고 거울을 놓친다」 구조적
    whack-a-mole 이 계속된다.
  - illusory 커버리지 하나 더 노출(ENG-P2, 무테스트 읽기-제외 필터).
- **불변(견고)**: 테스트 결정성(3×1311 동일)·tsc 0·빌드 바이트 재현(독립 2클론=커밋본)·다수 SSOT
  규율·교차 파리티 테스트·정직한 벤치 게이트(회귀 실측 검출)·캐시 정확성(fs 변경 사이 낡은 답 0).
  여기까지는 5.0 급 그대로다.

**점수 근거**: 엔지니어링 기초는 5.0 급이고, 이번엔 직전 MEDIUM([ENG-O1])과 LOW([ENG-O2])를
**정본 파생 + 못 박는 테스트로 실제로 닫았다**(M1·M2 로 검증) — 순서-드리프트가 처음으로
테스트-고정된 것은 실질 진전이다. 그러나 하드 조건 「중복 규칙 0」이 또 ✗(열 번째 사본:
preTool·postTool 쓰기 정의 갈림, 무테스트·실측 우회)이라 4.8 미만은 확정. rubric: "잔여로 깎지
말고 조건 미충족으로 판정" 준수. 다만 **잔여 최악의 무게가 실측 하락**했고(3-O: 무백스톱 진짜 배포
통과 MEDIUM → 3-P: 탈출구 있는 회계 넛지 회피 LOW~MEDIUM, 하드 게이트는 온전), 닫힌 결함이
처음으로 테스트로 고정됐다 — 근거 있는 만큼만 **3.8 → 3.9**. 성격은 여전히 「높은 규율, 단
정본화가 한 축을 모으는 순간 거울 자리에서 새 사본이 열린다」이나, 그 사본의 무게가 가벼워졌고
닫힘의 질(테스트 고정)이 올라갔다.

## 못 잰 것 / 축 밖 발견 (정직 고지)

- **뮤테이션은 새 정본 + dry-run/셸/런타임/캐시 사본 + 비지정 절 일부(4096·isDryRun·CORE_INVOKE
  러너)** 로 했다(M1–M7·W1–W4 + 캐시·벤치). 리다이렉트 `>|`·xargs·scriptFiles·CONDITIONAL_WRITERS
  전수 뮤테이션은 안 했다 — illusory 회귀가 더 있을 수 있다.
- **축 2(실효성) 영역 발견 — 내 축 밖이라 결함으로 세지 않고 고지만**:
  - **MCP `copy`/`move` 는 `extraTargets[0]` 만 판정**한다. `mcp__fs__copy {source: benign.txt,
    destination: .harness/config.yaml}` 는 source 가 먼저 수집돼 raw=source(무해) → **ALLOW**
    (실측). destination(코어 파일)이 판정에 안 올라간다. MCP 쓰기 표면(SEC-265)의 구멍 — 축 2.
  - **MCP 쓰기 동사 열거가 흔한 것을 놓친다**: `update·set·upload·sync·rename·truncate·chmod·
    symlink·store·insert` 는 `MCP_WRITE_MATCHER` 대안에 없어 **판정 대상 자체가 아니다**(실측 전부
    ALLOW). 구현자도 「임의 MCP 스키마를 다 알 수는 없다」고 고지한 열거 한계 — 축 2, README 「알려진
    한계」 대상.
  - `CORE_INVOKE_RE` 러너 목록에 **`pnpm`** 없음(`pnpm … cli.js --force` 는 탐지 밖). `pnpm` 이
    .js 를 직접 실행하는 건 드물고 env 게이트 백스톱이 있어 marginal — 축 2/경계.
- **빌드 재현은 한 머신·node v22.22.2·tsup 8.5.1** 에서만. 같은 툴체인 결정성은 확인(독립 2클론
  재빌드 == 커밋본 sha). **다른 node/tsup 버전 간** 바이트 재현은 이 감정에서도 안 쟀다(3-N·3-O
  동일 한계).
- **ENG-P1 의 상류 소비자 전수**: `noteActivity`/`lastActivityAt` 의 유일 소비자가 stop 가드임은
  코드로 확인(grep). 다른 소비자가 없으므로 영향은 stop 가드 회계로 한정된다.

## 마감 확인

- **나는 리포를 수정하지 않았다.** 내 편집·빌드·테스트·뮤테이션은 전부 샌드박스 클론
  (`…/scratchpad/clone1·2·3`)에서만 했고, 감정 후 그 클론의 프로브 파일은 지웠다. 리포에는 이
  보고서(`docs/release-readiness/2026-08-21/round3p/appraisal9-3-engineering.md`, 쓰기 허용 산출물)
  만 새로 추가했다. 추적 파일 스테이징·커밋 **0**.
- **대상 무결**: `git merge-base --is-ancestor d3e2a0a HEAD` = YES. 감정 중 리포 HEAD 가
  `36226be`(`docs:` 핸드오프)로 전진했으나 `git diff d3e2a0a..36226be -- core/src core/dist hooks
  profiles` 는 코드 무변경(핸드오프 커밋). `git show d3e2a0a:core/dist/cli.js` SHA-256 =
  `e9d1dcf5…` — 샌드박스 재빌드와 동일. 발견 결함(ENG-P1)은 `hook.ts` 에 있고 현재 작업트리에도 그대로 산다.
- **정직 고지 — 작업트리에 병행 세션의 미커밋 변경이 있음**: 감정 종료 시점 `git status
  --porcelain` 이 `M core/src/bashwrite.ts`·`M core/dist/cli.js`·`M core/test/blocker-3n.test.ts` 를
  보였다. 이는 **내 것이 아니다** — 병행 구현자 세션의 `[SEC-268]`(명령내 별칭 추적, **축 2**)
  작업이다. **되돌리지 않았다**(남의 미커밋 작업을 지우는 파괴적 행위). 확인: 그 미커밋 diff 는
  **`hook.ts` 를 건드리지 않는다** — 내 ENG-P1 은 병행 작업과 무관하게 `d3e2a0a` 와 현재 작업트리
  양쪽에 그대로 존재한다. 또 `round3p/appraisal9-2-effectiveness.md`(병행 축 2 세션 산출물)가 이미
  있으나 **내 대상 밖**이라 그 내용에 의존하지 않았다.
