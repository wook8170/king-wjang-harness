# [3] 엔지니어링 품질 감정 — 3.5/5

**점수** 3.5 · **4.8 충족** ✗ (하드 조건 「중복 규칙 0」 미충족 — 정본에서 파생 안 된 셸 목록
사본이 **살아 있고**, 그 드리프트가 설계 트랙 소스 쓰기 우회를 실제로 연다) · **감정 시각**
2026-08-23 · **대상** d8ebde4 (실측은 이 커밋의 `git archive`·클론에서. 감정 도중 리포 HEAD 가
540c186 으로 전진했으나 그것은 **문서만** 커밋이고 `core/src/bashwrite.ts`·`hook.ts` 는
d8ebde4 와 바이트 동일 — 발견한 결함은 현재 HEAD 에도 그대로 산다) · **도구** node v22.22.2 ·
tsc 5.9.3 · vitest 2.1.9 · tsup 8.5.1

**한 줄**: 테스트 결정성·tsc·빌드 바이트 재현은 모두 통과지만, 이 라운드의 핵심 주장(「중복
규칙을 정본에서 파생시켜 드리프트를 구조로 막았다」)이 실측으로 **반증**된다 — `scanBashWrites`
switch 의 셸 목록이 정본 `SHELLS_TAKING_C` 에서 갈려(`fish`·`ash`·`busybox` 누락) 있고, 그
드리프트로 `fish -c "cp /tmp/x app.ts"` 가 설계 트랙에서 **ALLOW** 된다(같은 `sh -c` 는 DENY).

---

## 조건별 실측 (테스트 ×3 / tsc / 빌드 재현 / 중복 규칙)

| 조건 | 결과 | 근거(measured) |
|---|---|---|
| 테스트 전건 green ×3 동일 | ✓ | `git archive` 샌드박스에서 3회 연속 `Test Files 52 passed \| 1 skipped (53)` · `Tests 1252 passed \| 16 skipped (1268)` — 3벌 동일. 전체 클론(.git+docs)에서는 `53 passed / 1268 passed`(조건부 16건까지 실행, 전건 green). |
| tsc --noEmit | ✓ | exit 0, 출력 없음. |
| 빌드 바이트 재현 | ✓ | 독립 클론 2벌 빌드 → `cli.js`/`mcp.js` SHA-256 **동일**, 그리고 **커밋된 `core/dist` 와도 동일**(`f2acdb…`/`6f284b…`). dist 가 HEAD 소스의 빌드와 일치. |
| **중복 규칙 0** | **✗** | 정본 `SHELLS_TAKING_C`(sh·bash·zsh·dash·ksh·fish·ash·busybox) 에서 **파생되지 않은** 셸 목록 사본이 최소 3곳 남아 있고(§중복표), 그중 `scanBashWrites` switch 의 드리프트가 **실측 우회**를 연다. 하드 조건이므로 잔여 감점이 아니라 **조건 미충족**으로 판정. |

16건 skip 은 환경 조건부다(`skipIf(!HAS_DOCS)` 13건 · `skipIf(!IN_REPO)` 3건). 배포 아카이브
(docs export-ignore)에서는 지킬 대상이 없어 건너뛰고, 리포에서는 `PROD-141`·`PROD-B6` 가드가
「조용히 사라지지 않게」 못 박아 전건 실행된다 — 정상. 침묵 비활성화는 아니다.

## 중복 규칙 대조표 (규칙 → 구현 위치들 → 판정)

정본: `SHELLS_TAKING_C = [sh, bash, zsh, dash, ksh, fish, ash, busybox]` (`bashwrite.ts:281`).
ENG-199·ENG-217 이 「셸 목록을 한 벌로 모았다」고 주장(consolidated: `INTERPRETERS`·
`commandLines`·`SCRIPT_RUNNERS`·`invokedScriptBodies` 러너 정규식). **모은 것만 말하고, 안 모은
것이 남아 있다:**

| 규칙(같은 질문) | 위치 | 목록 | 정본 파생? | 판정 |
|---|---|---|---|---|
| "어느 셸이 `-c` 프로그램을 받나 → 안쪽 쓰기 대상 추출" | `bashwrite.ts:680` switch `case 'sh'..'ksh'` | sh·bash·zsh·dash·ksh (**fish·ash·busybox 누락**) | ✗ 하드코딩 | **두 벌·드리프트·load-bearing** (실측 우회, 아래) |
| "어느 셸이 `<()` 로 프로그램을 받나 → opaqueExec" | `bashwrite.ts:307` proc 정규식 `sh\|bash\|zsh\|dash\|ksh\|fish\|source\|.` | **ash·busybox 누락** | ✗ 하드코딩 | 두 벌·드리프트 (ash/busybox 의 `<()` 가 opaque 로 안 잡힘 — §뮤테이션 확인) |
| "직접 실행(`./x`)이 셸 스크립트인가 → 본문 판독" | `hook.ts:751` 정규식 `\.(sh\|bash\|zsh\|ksh)$` | **fish·ash·dash·busybox 누락** | ✗ 하드코딩 | 두 벌·드리프트(저위험) |
| "인터프리터로 하네스 프로그램 직접 호출 인정" | `hook.ts:943` `INTERPRETER_HEADS` | node·nodejs·deno·bun+8셸 | ✗ 하드코딩(별 목적) | 사본이지만 실질 위험 미확인 |

`INTERPRETERS`(`bashwrite.ts:286`)·`SCRIPT_RUNNERS`(`hook.ts:245`)·`commandLines`·
`invokedScriptBodies` 러너 정규식은 정본에서 올바로 파생됨(그 부분의 주장은 참).
**핵심**: 「모았다」의 반례가 3곳 더 있고, switch 의 것은 정본과 갈린 채 실제로 뚫린다.

## 뮤테이션 결과 (위치 · 입력 · 검출/생존)

전체 스위트(1268) 기준. 각 절을 고의로 무력화 후 전건 재실행:

| # | 절 | 위치 | 뮤테이션 | 결과 |
|---|---|---|---|---|
| M1 | `targetLost` (SEC-207) | `hook.ts:1024` `return base`→`continue` | 항상 undefined | **검출** — `blocker-3j SEC-207` 1건 fail |
| M2 | `blindTargets` (SEC-216) | `bashwrite.ts:796` filter→`[]` | 항상 빈 | **검출** — 1건 fail |
| M3 | `OWNED_DIRS` (SEC-213) | `hook.ts:1503` `.has(dir)`→`false` | 항상 false | **생존** — 전건 green (아래 상술) |
| M4 | `copiesHarnessProgram` (SEC-195/208) | `hook.ts:1447` →undefined | 무력화 | **검출** — 2건 fail |
| M5 | 루트 밖 스크립트 (SEC-219) | `hook.ts:1313` `scripts.outside`→`slice(0,0)` | 순회 제거 | **검출** — `SEC-219` 1건 fail |

**M3 생존이 핵심 발견이다.** OWNED_DIRS 절은 **런타임에서 살아 있다**(실측: `echo FORGED >>
.harness/$(echo events).jsonl` 를 이 절이 DENY 한다 — 사유문이 "`.harness/` 는 쓰기가 제한된
자리"). 그런데 전용 테스트 `[SEC-213] …조립한 이름이 보호 자리에 떨어지면 거부된다` 의 입력
5건은 **전부 정적 변수 대입**(`a=events; b=.jsonl; … >> .harness/$a$b`)이라, 나중에 추가된
`expandStaticVars`(SEC-216)가 리터럴로 펴서 **STATE_FILES/POLICY 절이 먼저 잡는다**(사유문이
`.harness/events.jsonl` 을 지목 — OWNED_DIRS 가 아님). 그래서 OWNED_DIRS 를 `false` 로
꺼도 SEC-213 테스트를 포함해 1268 전건이 green 이다. 뮤테이션 후 프로브로 **실제 구멍이
열림**을 확인: `echo FORGED >> .harness/$(echo events).jsonl` → 무뮤 DENY / 뮤 후 **ALLOW**.
→ 이 절의 회귀 테스트는 **규칙이 아니라 다른 절이 잡는 우연을 고정**하고 있다(rubric §4 의
바로 그 패턴).

## 넓어진 방어의 구조 품질 (복잡도 · 유지 가능성 · 조용한 실패)

- **복잡도**: `hook.ts` 1815줄 · `bashwrite.ts` 924줄. 판정 경로가 한 벌(`judgeWritePath`)로
  모인 것, 리다이렉트/래퍼/패치/스크립트를 **같은 스캐너로 재귀 판정**하는 설계는 좋다.
  단 `scanBashWrites` 의 20+ `case` switch 와 `preTool` 의 다층 안전망(blindTargets →
  OWNED_DIRS → targetLost → OWNED_BASENAMES → mentionsPath)이 **서로 겹쳐서** 어느 입력이
  어느 절로 잡히는지 추적이 어렵다 — M3 처럼 «다른 절이 먼저 잡아» 테스트가 실제 절을 안
  건드리는 사각이 구조적으로 생긴다. 이건 라운드가 갈수록 커진 비용이다.
- **유지 가능성**: SSOT 규율은 대체로 훌륭하다(`SHELLS_TAKING_C`·`CORE_FILES`←`STATE_FILES+
  POLICY_FILES`·`OWNED_DIRS`←`CORE_FILES`·`LEDGER_STATUSES`·병합 의미론). `surface-parity`·
  `blocker-3j` 가 교차 고정. **그러나** 셸 목록만은 switch·정규식 리터럴에 하드코딩 사본이
  3곳 더 남아, "정본에서 파생" 규율이 **부분적으로만** 지켜졌다.
- **조용한 실패**: `handleHook` 이 예외를 전부 null(fail-open)로 흡수하되 `hook-errors.log` 에
  흔적을 남기는 것 — 관측 가능하게 설계됨(좋음). `invokedScriptBodies`·`readPatchTargets` 의
  빈 catch 는 "없는 파일 = 셸이 실패시킴"으로 정당. degraded(저널 재생) 경로도 사용자에게
  degradedNote 로 노출. 관측성은 이 축에서 합격점.

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

### [ENG-M1] (HIGH) `fish -c`/`ash -c` 래퍼 + no-slash 대상으로 설계 트랙 소스 쓰기 우회 — 중복 규칙 드리프트
- **원인**: `bashwrite.ts:680` switch 의 셸 목록(sh·bash·zsh·dash·ksh)이 정본
  `SHELLS_TAKING_C`(fish·ash·busybox 포함)에서 갈렸다. switch 는 `sh -c "…"` 안쪽 쓰기 대상을
  꺼내지만, `fish`/`ash` 는 case 에 없어 안쪽이 추출되지 않는다. 슬래시 있는 경로는
  `pathLikeMentions` 안전망이 우연히 덮어 왔지만, **슬래시 없는 대상**(루트 파일·목적지
  디렉토리)은 그 안전망도 못 봐서 통과한다.
- **재현(샌드박스, 배포 dist + `bin/harness-hook` 래퍼, 설계 트랙 P0)**:
  ```
  sh   -c "cp /tmp/x app.ts"        => DENY
  fish -c "cp /tmp/x app.ts"        => ALLOW   ← 우회
  ash  -c "touch engine.go"         => ALLOW   ← 우회
  fish -c "cp -r /tmp/pkg src"      => ALLOW   ← src/ 통째 구현 투입
  cp -r /tmp/pkg src                => DENY    (래퍼 없으면 막힘)
  ```
- **영향**: 요구 2(P6 승인 전 구현 금지)를 직접 깬다 — 에이전트가 설계 트랙에서
  `fish -c`/`ash -c` 로 소스 파일·디렉토리를 만들 수 있다. 코어·정책 파일(전부 슬래시 보유)은
  `pathLikeMentions` 가 여전히 잡아 영향 없음. 우회는 **설계 트랙 소스 보호**에 한정.
- **근본 수정 확인**: switch 에 `case 'fish'`·`case 'ash'` 추가 시 세 입력 모두 DENY 로 전환됨
  (측정). 정본 파생(`SHELLS_TAKING_C.includes(name)` 분기)이 옳은 처방.
- **위치**: `core/src/bashwrite.ts:680-710`.

### [ENG-M2] (MEDIUM) SEC-213 회귀 테스트가 규칙이 아니라 다른 절을 고정 — OWNED_DIRS 뮤테이션 생존
- 위 §뮤테이션 M3 참조. `OWNED_DIRS.has(dir)`→`false` 로 꺼도 전건 green.
- **영향**: OWNED_DIRS 절(런타임 load-bearing)이 리팩터로 깨져도 초록으로 배포된다. 실제
  구멍(`echo FORGED >> .harness/$(echo events).jsonl` ALLOW)이 회귀 감시 밖.
- **처방**: SEC-213 테스트에 **정적 변수가 아닌** 동적 조립 입력(명령치환·비정적 접미)을
  추가해 OWNED_DIRS 절을 실제로 발화시켜야 한다.
- **위치**: 규칙 `core/src/hook.ts:1497-1512` · 테스트 `core/test/blocker-3j.test.ts:341-353`.

### [ENG-M3] (LOW) opaqueExec 프로세스치환 감지 셸 목록 드리프트
- `bashwrite.ts:307` proc 정규식이 ash·busybox 를 빠뜨려 `ash <(…)`·`busybox <(…)` 가
  opaqueExec 로 안 잡힌다(측정: bash/sh/fish/dash/ksh 는 잡히고 ash/busybox 는 MISS).
  `<()` 가 POSIX ash 문법이 아니라 실전 익스플로잇 가능성은 불확실 — 그래서 LOW.
- **위치**: `core/src/bashwrite.ts:307` · 동류 `hook.ts:751` 직접실행 확장자 정규식.

## 못 잰 것 (정직 고지)

- **뮤테이션은 지정된 5절 + 셸 목록 사본만** 했다. 다른 절도 M3 처럼 「테스트가 다른 절을
  고정」하는 illusory 회귀가 더 있을 수 있다 — 전수 뮤테이션은 안 했다.
- ENG-M3(#3 ash/busybox opaque)·#7(직접실행 확장자)은 **드리프트는 확인**했으나 완전한
  E2E 익스플로잇은 구성하지 못했다(`<()`·`./x.fish` 의 실제 셸 실행 가능성 불확실).
- 우회는 **훅·CLI 표면**에서만 실측했다. MCP 표면(`callTool`)에서 같은 우회가 되는지는 안 쟀다.
- 빌드 재현은 **한 머신·node v22·tsup 8.5.1** 에서만 확인. 다른 node/tsup 버전 간 바이트
  재현(툴체인 결정성)은 안 쟀다 — tsup 출력은 버전에 따라 달라질 수 있다.
- 조건부 skip 16건은 전체 클론에서 실행·통과를 확인했으나, 아카이브 형태에서 그 16건의
  **로직**은 이번에 직접 검증하지 못했다(설계상 skip).
- 넓어진 로직의 **훅 지연(p95)** 은 이 축 밖이라 안 쟀다 — 복잡도가 성능에 미친 영향은 미측정.

## 점수 산출 근거

- 통과(측정): 테스트 ×3 결정적 동일 · tsc 0 · **빌드 바이트 재현(2벌 동일 + dist==소스)** ·
  광범위한 SSOT 규율과 교차 고정 테스트 · 관측 가능한 fail-open. 여기까지는 5.0 급이다.
- **하드 조건 「중복 규칙 0」 미충족(✗)**: 정본에서 파생되지 않은 셸 목록 사본이 살아 있고,
  그 드리프트가 **실측 우회**(ENG-M1, HIGH — 배포 dist·프로덕션 래퍼에서 재현)를 연다.
  rubric: "잔여로 깎지 말고 조건 미충족으로 판정" → 이 항목은 **4.8 미만 확정**.
- 추가로 **회귀 테스트 하나가 illusory**(ENG-M2 — OWNED_DIRS 뮤테이션 생존)로, 이 라운드가
  내세운 "드리프트를 구조로 막는 테스트" 주장이 두 번째로 반증됐다.
- 그러나 다른 모든 엔지니어링 지표가 견고하고 중복 규칙 표면의 **대부분은 실제로 정본화**돼
  있으므로 바닥으로 내리지 않는다. 자기 채점 5.0 → **3.5** 로 조정: 「높은 엔지니어링 규율,
  단 이 라운드의 중심 주장이 measured 로 반증되고 그 뒤에 실제 구멍이 있다」.
