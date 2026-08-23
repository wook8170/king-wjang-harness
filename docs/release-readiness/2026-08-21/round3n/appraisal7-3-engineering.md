# [3] 엔지니어링 품질 감정 — 3.5/5

**점수** 3.5 · **4.8 충족** ✗ (하드 조건 「중복 규칙 0」 미충족 — 정본에서 파생되지 않은 셸
목록의 **일곱 번째 사본**이 살아 있고 그것이 **실측 우회**를 열며, 이번 라운드가 새로 넣은
`--dry-run` 예외 규칙이 **두 벌로 갈려** 배포 차단을 뚫는다) · **감정 시각** 2026-08-23 ·
**대상** `a08ec18` (모든 실측은 이 커밋의 샌드박스 클론에서. 감정 도중 리포 HEAD 가
`6091a30` 으로 전진했으나 그것은 **`progress.md` 만** 바뀐 커밋이고 `core/src/*`·`core/dist`
는 `a08ec18` 과 바이트 동일 — 발견 결함은 현재 HEAD 에도 그대로 산다) · **도구** node
v22.22.2 · tsc 5.9.3 · vitest 2.1.9 · tsup 8.5.1

**한 줄**: 테스트 결정성·tsc·빌드 바이트 재현·SSOT 규율은 전보다 더 튼튼해졌고(직전 HIGH 인
셸 switch 드리프트는 정본화로 닫혔다), 그러나 「같은 규칙 두 벌 금지」는 이번에도 실측으로
반증된다 — 직접실행 확장자 정규식(`hook.ts:741`)이 정본에서 갈린 채 `/tmp/x.fish` 한 줄로
SEC-219 저널 위조 방어를 통째로 우회시키고(HIGH), 이번 라운드가 추가한 `--dry-run` 예외가
`profile.ts`·`hook.ts` 두 벌로 갈려 출하 전 배포 차단을 뚫는다(MEDIUM).

---

## 조건별 실측

| 조건 | 결과 | 근거(measured) |
|---|---|---|
| 테스트 전건 green ×3 동일 | ✓ | 샌드박스 클론에서 `npx vitest run` **3회 연속** → 매번 `Test Files 53 passed (53)` · `Tests 1284 passed (1284)`. 3벌 동일, 실패·skip 0. (풀 클론이라 `skipIf(!HAS_DOCS)`·`skipIf(!IN_REPO)` 가 발화하지 않아 전건 실행됨. 3-M 대비 +16 테스트.) |
| tsc --noEmit | ✓ | `cd core && npx tsc --noEmit` → **exit 0, 출력 없음**. |
| 빌드 바이트 재현 | ✓ | 독립 클론에서 `npm run build` → `core/dist/cli.js` SHA-256 = `d9c601d56631bffdfdea290ac61a8dcbbd92a6ae195d6a918d40de36d1c60249`, `mcp.js` = `6f284b44…`. **커밋된 dist 와 바이트 동일.** 소스 복원 후 재빌드에도 같은 sha 재현(2벌 동일). |
| **중복 규칙 0** | **✗** | 셸 목록의 **일곱 번째 사본**(`hook.ts:741`)이 정본에서 파생되지 않고 드리프트 → **HIGH 우회 실증**(§발견결함 ENG-N1). 추가로 이번 라운드가 넣은 `--dry-run` 예외가 **두 벌**(`profile.ts:514` 전체-명령 · `hook.ts:1669` 줄-단위)로 갈려 **MEDIUM 우회 실증**(ENG-N2). 하드 조건이므로 잔여 감점이 아니라 **조건 미충족**으로 판정. |

실측 명령 요지:
```
# tests ×3 (동일)
Tests  1284 passed (1284)   # RUN 1
Tests  1284 passed (1284)   # RUN 2
Tests  1284 passed (1284)   # RUN 3
# tsc
tsc exit=0   (출력 없음)
# build 재현
d9c601d5…  core/dist/cli.js   (커밋본과 동일)
6f284b44…  core/dist/mcp.js   (커밋본과 동일)
```

## 중복 규칙 전수 조사

**뽑은 방법**: 판정에 쓰이는 상수·정규식·리스트를 `grep -rnE` 로 전수 추출한 뒤, **같은
질문에 답하는 코드가 두 군데 이상인지** 질문별로 묶어 대조. 질문 세 부류를 봤다.

### 질문 A — 「어느 셸/해석기를 -c·스크립트 러너로 인정하나」

정본: `SHELLS_TAKING_C = [sh, bash, zsh, dash, ksh, fish, ash, busybox]`(`bashwrite.ts:296`).

| 위치 | 형태 | 정본 파생? | 판정 |
|---|---|---|---|
| `bashwrite.ts:300` `INTERPRETERS` | Set | ✓ `...SHELLS_TAKING_C` | 정본화 |
| `bashwrite.ts:323` opaqueExec 러너 | 정규식 | ✓ `[...SHELLS_TAKING_C,'source','.']` (ENG-230, **직전의 6번째 사본을 이번에 닫음**) | 정본화 |
| `bashwrite.ts:755-762` switch `case` | 라벨 | 하드코딩이나 **ENG-226 전수 테스트가 정본으로 고정**(아래) | 허용 |
| `bashwrite.ts:909` `commandLines` | includes | ✓ `SHELLS_TAKING_C` | 정본화 |
| `hook.ts:684` `SCRIPT_RUNNERS` | Set | ✓ `...SHELLS_TAKING_C` | 정본화 |
| `hook.ts:730` invokedScript 러너 | 정규식 | ✓ `...SCRIPT_RUNNERS` | 정본화 |
| **`hook.ts:741` 직접실행 확장자** | `/\.(sh\|bash\|zsh\|ksh)$/` | ✗ **하드코딩, dash·fish·ash·busybox 누락** | **일곱 번째 사본 · 드리프트 · load-bearing (ENG-N1, HIGH)** |
| `hook.ts:933` `INTERPRETER_HEADS` | `/^(node\|…\|sh\|bash\|zsh\|dash\|ksh\|fish\|ash\|busybox)$/` | ✗ 하드코딩(8셸 전부 있음 — 현재 드리프트 없음) | **여덟 번째 사본 · 잠재 드리프트 (ENG-N3, LOW)** |

**결론**: 「모았다」는 주장(ENG-199·ENG-217·ENG-230)은 이번에 **6곳까지 실제로 정본화**됐다
— 직전 라운드의 6번째 사본(opaqueExec)과 switch 드리프트가 닫힌 것은 진짜 진전이다. 그러나
`hook.ts:741` 은 바로 위 `hook.ts:730` 이 정본에서 만든 러너 정규식과 **형제인데 손으로 적혀**
갈려 있고, 그 갈림이 실제로 뚫린다(ENG-N1). `INTERPRETER_HEADS` 는 지금은 완전하나 정본에서
안 왔다.

### 질문 B — 「이 줄은 `--dry-run` 이라 배포 차단에서 빼야 하나」 (이번 라운드 신규)

EFF-231 이 **같은 정규식** `/(?:^|\s)--dry[-_]?run(?:[=\s]|$)/` 을 **두 곳**에 넣었다:

| 위치 | 적용 범위 | 판정 |
|---|---|---|
| `hook.ts:1669` (config `design_blocked_bash` 경로) | **줄 단위** — `commandLines(cmd).filter(l => !isDryRun(l))` | 안전(주석이 "명령 전체에 한 번 걸면 `… --dry-run; …publish` 로 차단이 통째로 꺼진다"고 경고) |
| `profile.ts:514` (`isDeployCommand`, 프로파일 배포 경로) | **명령 전체** — `if (/…/.test(cmd)) return false` | **드리프트** — 위 주석이 경고한 바로 그 형태로 뚫린다(ENG-N2, MEDIUM) |

두 벌은 같은 규칙(「dry-run 은 배포가 아니다」)의 두 구현이고 **행동이 갈린다** — 같은 입력에
서로 다른 판정을 낸다(§ENG-N2 실측). 이것이 이번 라운드가 새로 만든 중복 규칙이다.

### 질문 C — 「무엇이 배포 명령인가」 (참고 — 이건 정상)

`config.ts:16 DEFAULT_CONFIG.design_blocked_bash` 와 `profile.ts:110 deployCommands`(generic
floor)가 같은 21개 목록을 갖는다 — **두 벌이지만 `profile.test.ts:76`
(`expect(loadProfile(...).deployCommands).toEqual(DEFAULT_CONFIG.design_blocked_bash)`)가 파리티를
테스트로 못 박아** 드리프트가 불가능하다. 이건 관리된 중복이라 결함으로 세지 않는다.
(문제는 목록이 아니라 위 질문 B 의 **예외 규칙**이 안 걸린 것이다.)

## 뮤테이션 관점

| # | 절 | 뮤테이션 | 결과 |
|---|---|---|---|
| M-A | `hook.ts:741` 확장자 정규식 | **드리프트를 고침**(dash·fish·ash·busybox 추가) | **1284 전건 여전히 green** — 어떤 테스트도 갈라내지 못한다 |
| M-B | `bashwrite.ts:755` switch `case 'fish'` 제거 | 라벨 제거 | **검출** — ENG-226 전수 테스트가 즉시 fail(정본 파생 테스트라 옳게 잡는다) |
| M-C | (3-M M3) `OWNED_DIRS` 절 | 이번 라운드에 **삭제됨**(QUAL-229) | §직전 대비 참조 — 삭제가 행동 보존임을 실측 |

- **M-A 가 핵심이다.** `hook.ts:741` 의 셸 목록을 **정본과 일치하게 고쳐도** 전건이 green 이다.
  즉 이 정규식의 **멤버십이 테스트로 전혀 고정돼 있지 않다** — `.fish`·`.dash`·`.ash` 직접실행을
  거는 테스트가 리포에 **하나도 없다**(`grep -rn '\.fish\|\.dash' core/test/` → 0건). 이것이
  드리프트가 살아남은 이유다(rubric §4 「테스트가 규칙이 아니라 우연을 고정」의 정확한 사례 —
  이 경우엔 규칙 자체를 아예 안 재고 있다). 바로 옆 switch 는 ENG-226 이 정본으로 전수
  고정하는데, 형제인 이 확장자 정규식만 무방비다.
- **M-B**: switch 라벨은 반대로 잘 고정돼 있다. 정본의 8셸을 도는 `[ENG-226]` 테스트가
  라벨 하나만 빠져도 먼저 깨진다. 직전 라운드 HIGH(ENG-M1)의 옳은 처방이다.

## 발견 결함

### [ENG-N1] (HIGH) 일곱 번째 셸 목록 사본 — `.fish`/`.dash`/`.ash` 직접실행으로 SEC-219 저널 위조 방어 우회
- **원인**: `hook.ts:741` `/\.(sh|bash|zsh|ksh)$/` 이 정본 `SHELLS_TAKING_C` 에서 갈렸다
  (`dash`·`fish`·`ash`·`busybox` 누락). 이 절은 **직접 실행되는 스크립트**(`./x`·`/tmp/x`)의
  본문을 읽어 같은 규칙으로 판정할지(= SEC-219 루트 밖 스크립트 본문 검사)를 확장자로 가른다.
  러너 형태(`sh /tmp/x.fish`)는 `hook.ts:730` 의 **정본 파생** 러너 정규식이 확장자 무관하게
  본문을 읽지만, **직접실행** 형태는 이 갈린 확장자 목록에 걸려 세 확장자를 건너뛴다.
- **결정적 관측**: 확장자는 **파일 이름일 뿐**이라 실제 인터프리터는 shebang 이 정한다.
  `#!/bin/sh` 본문을 `x.fish` 로 이름 붙이면 OS 는 `/bin/sh` 로 실행하지만, 훅은 **`.fish`
  라는 이유로 본문을 안 읽는다.** 즉 fish 설치조차 필요 없다(3-M #7 이 LOW 로 유보했던
  「실전 실행 가능성 불확실」이 사라진다).
- **재현(샌드박스, 배포 dist `d9c601d5…`, 설계 트랙 P0)**:
  ```
  # 스크립트를 루트 밖(/tmp)에 쓴다 — 하네스 소관 밖이라 항상 허용
  echo forge > /tmp/x.fish            => ALLOW
  # 같은 본문(#!/bin/sh, 저널에 phase-set P7 append)을 확장자만 바꿔 직접 실행
  /tmp/x.sh                           => DENY   (SEC-219 가 본문을 읽어 위조 포착)
  /tmp/x.fish                         => ALLOW  ← 우회 (본문 미검사)
  /tmp/x.dash                         => ALLOW  ← 우회
  /tmp/x.ash                          => ALLOW  ← 우회
  sh /tmp/x.fish                      => DENY   (러너 형태는 확장자 무관 — 정상)
  ```
- **끝단까지 관측(OPS-74 #5)**: 허용된 `/tmp/x.fish` 본문이 하는 저널 위조를 재현 →
  `echo '{"type":"phase-set","data":{"phase":"P7"}}' >> .harness/events.jsonl` 후, 하네스가
  **스스로 권하는 복구 명령** `harness doctor --repair`(저널 재생) 실행 → `state.json` 이
  **P0 → P7** 로 전진(실측). 설계 트랙의 「P6 승인 전 구현 금지」가 통째로 열린다.
- **왜 결함인가**: SEC-219 는 「루트 밖에 스크립트를 쓰고 실행해 저널을 위조」하는 부류를
  닫으려고 만든 **보안 등급** 방어다. 이 우회는 그 부류를 세 확장자에서 그대로 되살린다 —
  저널은 게이트 승인을 정하는 상태이므로 영향이 코어에 닿는다. (정직 고지: 위조가 즉효하려면
  뒤에 `doctor --repair`(또는 state.json 무효화)가 와야 한다. state.json 직접 삭제는 DENY 라
  경로는 `doctor --repair` 이고, 그건 하네스가 desync 때 **직접 안내하는** 무해해 보이는
  명령이다. 그래서 사슬은 하네스-승인 명령만으로 완결된다.)
- **근본 수정**: `hook.ts:741` 을 `hook.ts:730` 과 같이 **정본에서 파생**시킨다 — 예:
  `` new RegExp(`\\.(${[...SHELLS_TAKING_C].join('|')})$`) ``. 뮤테이션 M-A 로 이 형태가 세
  입력을 전부 DENY 로 돌림을 확인. 그리고 정본 8셸을 도는 전수 테스트(ENG-226 형태)를
  직접실행 확장자에도 붙여 드리프트를 못 박아야 한다(지금은 0건).
- **위치**: `core/src/hook.ts:741`.

### [ENG-N2] (MEDIUM) `--dry-run` 예외 규칙 두 벌 드리프트 — 프로파일 배포 명령의 출하 전 차단 우회
- **원인**: EFF-231 이 dry-run 예외를 두 곳에 구현했는데 **적용 범위가 갈렸다**.
  `hook.ts:1669` 은 **줄 단위**(`commandLines().filter(!isDryRun)`)라 `A --dry-run && A` 에서
  둘째 줄의 진짜 배포를 본다. `profile.ts:514` 은 **명령 전체**(`if (/…/.test(cmd)) return false`)라
  `--dry-run` 이 **어디든** 있으면 전체를 배포 아님으로 사면한다. `hook.ts:1666` 주석이 바로 이
  형태를 "차단이 통째로 꺼진다"고 경고하는데, 형제 구현엔 그 처방이 안 들어갔다.
- **도달 조건**: `isDeployCommand`(profile 경로)는 **프로파일 `deploy_commands`** 로 판정한다.
  config `design_blocked_bash`(줄-단위 경로)에 **없고** 프로파일에만 있는 배포 명령이 표적이다.
  **출하된 `nextjs-prisma` 프로파일**의 `prisma migrate deploy` 가 정확히 그 경우다(config 목록에 없음).
- **재현(샌드박스, `nextjs-prisma` 프로파일, 설계 트랙 P0)**:
  ```
  prisma migrate deploy                             => DENY  (정상 차단)
  prisma migrate deploy --dry-run                   => ALLOW (dry-run 면제 — 정상)
  prisma migrate deploy --dry-run && prisma migrate deploy   => ALLOW  ← 우회 (진짜 마이그레이션이 돈다)
  vercel deploy --dry-run && vercel deploy          => DENY   (config 목록 → 줄-단위 경로가 잡음)
  ```
  `; `·`||`·개행 구분자 모두 동일하게 ALLOW(단 `--dry-run;` 처럼 뒤에 공백이 없으면 정규식이
  안 물어 DENY — 즉 `--dry-run ` 뒤 공백을 남기는 구분자에서 뚫린다).
- **영향**: §4-2 「배포는 출하 트랙 승인 후에만」을 프로파일 정의 배포 명령에 대해 깬다. 표적이
  `prisma migrate deploy`(운영 DB 마이그레이션) 같은 파괴적 명령이면 무게가 크다. MEDIUM 으로
  두는 이유: `--dry-run &&` 라는 다소 인위적 결합이 필요하고 프로파일-전용 명령에 한정된다.
- **처방**: dry-run 예외를 **한 벌**로 만든다 — `isDeployCommand` 도 `hook.ts:1669` 처럼
  `commandLines` 를 돌며 줄 단위로 dry-run 을 거른 뒤 매칭한다. 두 경로가 같은 답을 내는지
  회귀 테스트로 고정.
- **위치**: `core/src/profile.ts:514` (드리프트 사본) · `core/src/hook.ts:1669` (안전 사본).

### [ENG-N3] (LOW) `INTERPRETER_HEADS` 는 여덟 번째 셸 목록 사본
- `hook.ts:933` `/^(node|nodejs|deno|bun|sh|bash|zsh|dash|ksh|fish|ash|busybox)$/` 은 8셸을
  전부 담아 **지금은 드리프트가 없다.** 그러나 정본에서 파생되지 않은 손 목록이라, 정본에
  셸이 추가되면 여기만 낡는 잠재 사본이다(ENG-N1 이 바로 그렇게 생겼다). 정본 파생 권고.
- **위치**: `core/src/hook.ts:933`.

## 직전 라운드 대비 (3-M 3.5 → 3-N 3.5)

- **닫힌 것(진짜 진전)**:
  - **ENG-M1(HIGH) 닫힘** — `fish -c`/`ash -c` switch 드리프트. 이번에 `case 'fish'`·`'ash'`·
    `'busybox'` 추가 + **정본 8셸 전수 테스트**(`blocker-3j` [ENG-226])로 못 박음. 뮤테이션 M-B
    로 라벨 제거가 즉시 검출됨을 확인.
  - **ENG-M3(LOW) 절반 닫힘** — opaqueExec 프로세스치환 셸 목록(`bashwrite.ts:307`)이
    ENG-230 으로 정본 파생. `ash <(…)`·`busybox <(…)` 이제 잡힘.
  - **ENG-M2(MEDIUM) 해소** — `OWNED_DIRS` 절을 **삭제**(QUAL-229). 삭제가 **행동 보존**임을
    실측 검증: `.harness/$(echo events).jsonl`·`.harness/design/$(echo ledger).yaml` 등 이름-조립
    저널/정책 위조가 **여전히 전건 DENY**, 쓰기 가능 산출 디렉토리(`.harness/waves/`·
    `evidence/`)는 **여전히 ALLOW**(과차단 없음). 실제 포착자는 `pathLikeMentions` 가 내는
    `.harness/`(COST-228 재작성 이후 슬래시-종단 접두를 뽑게 됨) + `judgeWritePath` 의
    `coversPath` + `OWNED_BASENAMES` blind 검사다. **QUAL-229 의 「그 절만 막는 입력을 못
    찾았다 = 이미 중복」 판단이 옳다.** (덧: 3-M 의 M3 「뮤 후 ALLOW」는 d8ebde4 기준에선
    맞았다 — 그때 옛 `pathLikeMentions` 정규식은 `.harness/$…` 에서 접두를 못 뽑아 OWNED_DIRS 가
    유일 포착자였다. COST-228 정규식 변경이 부수적으로 새 포착자를 만들어 이번 삭제를 안전하게
    했다. 결과적으로 옳은 삭제다.) 테스트 주석도 「고정했다」고 과장하지 않고 QUAL-229 로 열어
    둔 정직성이 좋다.

- **그대로거나 나빠진 것**:
  - **하드 조건 「중복 규칙 0」 여전히 ✗**. 직전엔 switch 사본이 HIGH 였고, 이번엔 그것을 닫는
    대신 **직접실행 확장자 사본**(직전엔 #7 LOW 로 유보)이 그 자리를 물려받았다 — 게다가
    「확장자는 파일 이름일 뿐」을 보면 **HIGH 로 격상**된다(fish 불필요). 드리프트 whack-a-mole
    이 이어진다: 매 라운드 지목된 사본은 닫히고, 유보·간과된 사본이 같은 하드 조건 실패를 진다.
  - **새 회귀 유입** — 이번 라운드의 EFF-231 이 dry-run 예외를 두 벌로 넣으며 ENG-N2(MEDIUM)를
    만들었다. 방어를 넓히는 변경이 스스로 새 드리프트를 낳은 것.
- **불변(견고)**: 테스트 결정성(3×1284 동일)·tsc 0·빌드 바이트 재현·다수 SSOT 규율·교차 고정
  테스트·관측 가능한 fail-open(`hook-errors.log`). 여기까지는 5.0 급 그대로다.

**점수 근거**: 엔지니어링 기초는 5.0 급이고 직전 HIGH 를 정본화로 닫은 것은 실제 진전이다.
그러나 하드 조건 「중복 규칙 0」이 다시 ✗ 이고(정본 미파생 사본이 **HIGH 우회**를 연다),
게다가 이번 라운드 변경이 **새 중복 규칙(ENG-N2, MEDIUM)**을 유입시켰다. rubric: "잔여로 깎지
말고 조건 미충족으로 판정" → **4.8 미만 확정.** 진전(닫은 HIGH·정직한 삭제)과 후퇴(격상된
사본 HIGH·새 MEDIUM)가 상쇄돼 직전과 같은 **3.5** 로 둔다 — 「높은 규율, 단 중복-규칙 드리프트가
구조적으로 재발하며 그 뒤에 실측 우회가 있다」는 성격이 3-M 과 동일하다.

## 못 잰 것 (정직 고지)

- **뮤테이션은 지정된 절 + 셸/드라이런 사본 중심**으로 했다(M-A·M-B + 삭제된 OWNED_DIRS 검증).
  다른 판정 절의 전수 뮤테이션은 안 했다 — illusory 회귀가 더 있을 수 있다.
- ENG-N1 저널 위조 사슬은 **훅·CLI 표면**에서 실측했다. MCP 표면(`callTool`)에서 같은 확장자
  드리프트가 재현되는지는 안 쟀다.
- ENG-N1 의 `doctor --repair` 의존을 실측했으나, 위조 이벤트가 **재생 전에도** 어떤 조회
  표면을 오염시키는지(예: degraded 경로가 즉시 P7 로 답하는지)는 별도로 안 쟀다.
- ENG-N2 는 `nextjs-prisma` 프로파일 + 사용자 커스텀 `.harness/profile/` 두 경우로 실측.
  다른 출하 프로파일 전수는 안 봤다.
- 빌드 재현은 **한 머신·node v22.22.2·tsup 8.5.1** 에서만. 다른 툴체인 버전 간 바이트 재현은
  안 쟀다.
- `INPROC_CHILD`(bench-hook-latency)의 정당성은 검토·실행했다(§아래) — 이 축의 결함은 아님.

## 부수 관측 — `scripts/bench-hook-latency.mjs` 의 `INPROC_CHILD` (정당함)

이번 라운드에 추가된 인프로세스 측정 자식 스크립트를 실행·검토했다. `fs.readFileSync` 를
**fd 0(stdin) 분기에서만** 가로채 페이로드를 돌려주고 다른 경로는 원본 그대로다 — fd 0 은 한
번 읽으면 EOF 라 N 회 반복 측정이 불가능한데, 그 한 지점만 대체하는 것은 **정당한 계측**이다
(모듈 캐시·상태 오염을 피하려 별도 자식에서 돌리는 설계도 옳다). 실행 결과 인프로세스 p95 는
정상 1.0–1.4ms / 열화 6.6–16.9ms 로 wall-time(70–97ms, 대부분 `node` 기동)과 분리돼 나온다.
측정 왜곡 없음. PROD-212 로 「부하」표기를 충족·초과 **양쪽에** 붙인 것도 정직하다. 이 축의
결함으로 세지 않는다.

## 마감 확인

- **나는 리포를 수정하지 않았다.** 내 편집·빌드·테스트는 전부 샌드박스 클론
  (`/private/tmp/.../scratchpad/clone1`)에서만 했다. 리포에는 이 보고서 디렉토리
  (`docs/release-readiness/2026-08-21/round3n/`, 쓰기 허용된 산출물)만 새로 추가했다.
  추적 파일 스테이징·커밋 **0**.
- **커밋 상태(내 감정 대상)는 불변**: HEAD `6091a30`(감정 착수 시 `a08ec18` → 감정 중
  `progress.md` 만 바뀐 이 커밋으로 전진; `git diff a08ec18..6091a30 -- core/src core/dist` = 빈 diff).
  `git show HEAD:core/dist/cli.js` 및 `git show a08ec18:core/dist/cli.js` SHA-256 **둘 다**
  `d9c601d56631bffdfdea290ac61a8dcbbd92a6ae195d6a918d40de36d1c60249` — 착수 시점과 동일. 발견
  결함은 현재 HEAD 커밋에 그대로 존재.
- **정직 고지 — 작업트리에 병행 세션의 미커밋 변경이 유입됨**: 감정 종료 직전 `git status
  --porcelain` 이 `M core/src/bashwrite.ts` · `M core/src/cli.ts` · `M core/dist/cli.js` 를 보였다
  (작업트리 dist sha `01f000be…`). 이는 **내 것이 아니다** — 파일 mtime 12:30–12:31 로 내 감정
  중에, **동시 구현자 세션**이 새 수정 `[SEC-232]`(`cp -t DIR`/`--target-directory` 목적지
  추출)를 작업트리에 얹은 것이다(`.claude/worktrees/wf_…` 병행 워크플로 존재, SEC-232 는
  a08ec18 이후의 신규 대장 항목). **되돌리지 않았다** — 남의 미커밋 작업을 지우는 파괴적
  행위라 손대지 않는 것이 옳다. HEAD 커밋과 나의 대상(a08ec18)은 위와 같이 완전히 온전하며,
  모든 빌드 바이트 재현은 그 커밋본에 대해 검증됐다(샌드박스에서 `d9c601d5…` 재현).
