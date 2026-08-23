# [3] 엔지니어링 품질 감정 — 3.8/5

**점수** 3.8 · **4.8 충족** ✗ (하드 조건 「중복 규칙 0」이 **네 라운드 연속** 미충족 —
배포 판정의 dry-run 예외가 여전히 두 벌로 갈려 **아홉 번째 사본**을 만든다: 직전 라운드
[ENG-N2] 가 `&&`·`;`·`||` 세 구분자에서는 한 벌로 모았으나 **개행(`\n`) 구분자에서 다시
갈려** 프로파일 정의 배포 명령의 설계 트랙 차단을 실측 우회한다) · **감정 시각** 2026-08-23 ·
**대상 HEAD** `631f190` (모든 실측은 이 커밋의 샌드박스 클론에서. 감정 도중 리포 HEAD 가
`3056767` 로 전진했으나 그것은 **`progress.md`만** 바꾼 `docs:` 커밋이고 `git diff
631f190..3056767 -- core/src core/dist` = 빈 diff — 발견 결함은 현재 HEAD 커밋에도 그대로
산다) · **도구** node v22.22.2 · tsc 5.9.3 · vitest 2.1.9 · tsup 8.5.1

**한 줄**: 직전 라운드의 HIGH([ENG-N1] 셸 확장자 직접실행)와 LOW([ENG-N3] INTERPRETER_HEADS)
는 **정본 파생 + 전수 테스트로 진짜 닫혔고**(뮤테이션으로 확인), 캐시·벤치 게이트·flagValues
정본화도 견고하다. 그러나 「같은 규칙 두 벌 금지」는 이번에도 실측으로 반증된다 — dry-run
예외의 「형제 구현」이 **입력 정규화 순서가 달라**(`normCmd` 가 `commandLines` 앞에서 개행을
공백으로 뭉갠다) 개행 구분자에서 판정이 갈리고, 그 갈림이 `prisma migrate deploy` 를 P0 에서
통과시킨다(MEDIUM · 무백스톱). 잔여 심각도가 직전(HIGH+MEDIUM+LOW)보다 낮아져(MEDIUM+LOW)
**3.5 → 3.8** 로 올리되, 하드 조건이 살아 있으므로 4.8 미만은 확정이다.

---

## 조건별 실측

| 조건 | 결과 | 근거(measured) |
|---|---|---|
| 테스트 전건 green ×3 동일 | ✓ | 샌드박스 클론에서 `npx vitest run </dev/null` **3회 연속** → 매번 `Test Files 54 passed (54)` · `Tests 1301 passed (1301)`. 3벌 동일, 실패·skip 0. (3-N 대비 +17 테스트: 54 파일 · 1301.) |
| tsc --noEmit | ✓ | `cd core && npx tsc --noEmit </dev/null` → **exit 0, 출력 없음**. |
| 빌드 바이트 재현 | ✓ | 독립 클론에서 `npm run build` → `core/dist/cli.js` SHA-256 = `fe1aa49a6155f683f1767b95b57387c1a8e45a0bc5ede547c36a58b3ec821175`, `mcp.js` = `131e7b454a840ad9335a9d8482ec67e4ce9f37b6cec2ef2a4e62757fbb87a51c`. **커밋된 dist(`git show 631f190:core/dist/cli.js`)와 바이트 동일.** 재빌드 2벌에서도 dist diff 0(같은 sha 재현). |
| **중복 규칙 0** | **✗** | 배포 판정 dry-run 예외의 **아홉 번째 사본**(`profile.ts:518` vs `hook.ts:1774`)이 개행 구분자에서 드리프트 → **MEDIUM 우회 실증**(§발견결함 ENG-O1). 추가로 `CORE_INVOKE_RE`(`hook.ts:132`)가 정본 `NON_SHELL_INTERPRETERS` 에서 갈린 JS 런타임 목록(`nodejs` 누락) → **LOW**(ENG-O2, 백스톱 있음). 하드 조건이므로 잔여 감점이 아니라 **조건 미충족**으로 판정. |

실측 요지:
```
Tests  1301 passed (1301)   # RUN 1
Tests  1301 passed (1301)   # RUN 2
Tests  1301 passed (1301)   # RUN 3
tsc exit=0   (출력 없음)
fe1aa49a…  core/dist/cli.js   (커밋본과 동일 · 재빌드 재현)
131e7b45…  core/dist/mcp.js   (커밋본과 동일 · 재빌드 재현)
```

## 중복 규칙 전수 조사

**뽑은 방법**: 판정에 쓰이는 상수·정규식·리스트를 `grep -rnE` 로 전수 추출 → 「같은 질문에
답하는 코드가 두 군데 이상인가」를 질문별로 묶어 대조. 이번에 새로 들어온
`flagValues`·`isDryRun`·`flagsOfGroup`·`realCache`·`DIRECT_SCRIPT_EXT` 를 모두 포함해 봤다.

### 질문 A — 「어느 셸/해석기를 -c·스크립트 러너·직접실행으로 인정하나」 (정본 = `SHELLS_TAKING_C`)

| 위치 | 형태 | 정본 파생? | 판정 |
|---|---|---|---|
| `bashwrite.ts:324` `INTERPRETERS` | Set | ✓ `...SHELLS_TAKING_C` | 정본화 |
| `bashwrite.ts:347` opaqueExec 러너(ENG-230) | 정규식 | ✓ | 정본화 |
| `bashwrite.ts:1057` `commandLines` inner | includes | ✓ `SHELLS_TAKING_C` | 정본화 |
| `bashwrite.ts:889` switch `case` 라벨(ENG-226) | 라벨 | 하드코딩이나 **정본 8셸 전수 테스트가 고정** | 허용 |
| `hook.ts:725` `SCRIPT_RUNNERS` | Set | ✓ `...SHELLS_TAKING_C` | 정본화 |
| `hook.ts:777` invokedScript 러너 | 정규식 | ✓ `...SCRIPT_RUNNERS` | 정본화 |
| **`hook.ts:731` `DIRECT_SCRIPT_EXT`** | `new RegExp(\`\\.(${[...SHELLS_TAKING_C].join('\|')})$\`)` | ✓ **이번에 정본 파생(ENG-N1 닫힘)** | **닫힘 — 뮤테이션으로 검증(§뮤테이션 MUT-C)** |
| `hook.ts:990` `INTERPRETER_HEADS` | `^(${[...NON_SHELL_INTERPRETERS, ...SHELLS_TAKING_C].join('\|')})$` | ✓ **이번에 정본 파생(ENG-N3 닫힘)** | 정본화 |

**결론**: 셸 목록 계열은 이번 라운드에 **전부 정본 파생으로 수렴**했다. 직전 라운드의 HIGH
(직접실행 확장자 `hook.ts:741`)와 LOW(`INTERPRETER_HEADS`)가 둘 다 실제로 닫혔다 — 이 축의
가장 오래된 whack-a-mole(셸 목록 8사본)이 처음으로 완결됐다.

### 질문 B — 「이 명령이 배포인가 / dry-run 이라 빼야 하나」 (정본 시도 = `isDryRun` 한 벌)

`isDryRun`(`bashwrite.ts:1041`)은 한 벌이다. 그러나 **그 예외를 감싸는 「배포 판정」이 두
벌**이고, 입력 전처리가 갈려 **같은 입력에 다른 답**을 낸다:

| 위치 | 전처리 | 줄 분해 | 개행(`\n`) 구분자 | 판정 |
|---|---|---|---|---|
| `hook.ts:1774` (config `design_blocked_bash`) | 없음(`rawCmd` 그대로) | `commandLines(cmd)` → `SEGMENT_SPLIT` 이 `\n` 도 쪼갬 | **줄로 쪼갬 → 둘째 줄 진짜 배포 포착** | 안전 |
| `profile.ts:518` (`isDeployCommand`, 프로파일 배포) | **`normCmd(command)` — `\s+`→공백**(개행 포함!) | `commandLines(정규화된cmd)` | **개행이 이미 공백으로 뭉개져 한 줄 → dry-run 한 개로 전체 사면** | **드리프트(ENG-O1)** |

두 벌은 같은 규칙(「dry-run 은 배포가 아니다 · 줄 단위」)의 두 구현이고 **행동이 갈린다**.
[ENG-N2] 가 `&&`·`;`·`||` 는 한 벌로 모았지만(그 세 구분자는 `normCmd` 의 `\s+` 에 안 걸려
살아남는다), `commandLines` 가 **명시적으로 쪼개는** 개행은 `normCmd` 가 먼저 먹어 버린다.
이것이 이번 라운드의 아홉 번째 사본이다(§ENG-O1 실측·근본원인 확인).

### 질문 C — 「무엇이 하네스를 실행/자기해제하나」 (`invokesHarness`)

`CORE_INVOKE_RE`(`hook.ts:132`)가 `(?:node|npx|bun|deno)\b` 로 JS 런타임을 **손목록**한다.
정본 `NON_SHELL_INTERPRETERS = ['node','nodejs','deno','bun']`(`hook.ts:989`)이 있고
`INTERPRETER_HEADS` 는 그것에서 파생하는데, `CORE_INVOKE_RE` 만 정본을 안 쓰고 갈렸다:
`npx` 를 더하고 **`nodejs` 를 뺐다**. `node\b` 는 `nodejs` 에 안 걸리므로(경계 없음)
`nodejs …/cli.js phase set --force` 가 훅의 자기해제 탐지를 우회한다(§ENG-O2, LOW·백스톱).

### 질문 D — 「무엇이 배포 명령 목록인가」 (참고 — 관리된 중복)

`config.ts:16 DEFAULT_CONFIG.design_blocked_bash`(21개)와 `profile.ts:95 GENERIC_FLOOR.
deployCommands`(21개)가 같은 목록이나 **`profile.test.ts:76`
(`expect(loadProfile(...).deployCommands).toEqual(DEFAULT_CONFIG.design_blocked_bash)`)가 파리티를
테스트로 못 박아** 드리프트 불가. 관리된 중복이라 결함으로 세지 않는다. (문제는 목록이 아니라
질문 B 의 **예외 전처리**다.)

### 질문 E — 새 헬퍼들 (정본화 확인)

- **`flagValues`**(`bashwrite.ts:632`): `cp -t`·`tar -C/--directory`·`rsync --backup-dir` 등·
  `git clone --separate-git-dir` 의 플래그-값 경로 추출을 **한 함수로**. 도구별 사본 없음.
  뮤테이션으로 load-bearing 확인(§MUT-B, 6 테스트 fail).
- **`flagsOfGroup`**(`help.ts:280`): 미지 플래그 판정 어휘를 **도움말 `args` 문자열에서 파생**
  (광고 = 실재). 손목록 없음. 정본화.
- **`realCache`**(`hook.ts:632`): 경로 해석 캐시. 수명 = 판정 1회. 정확성 별도 검증(§캐시).

## 뮤테이션

전건(1301) 기준으로 판정 절을 무력화/역전해 **어떤 테스트도 안 깨지는 절**이 있는지 봤다.
3-N 이 「지정 절 중심」이라 고지한 것을 이번엔 새 코드 + 셸/드라이런/런타임 사본으로 넓혔다.

| # | 뮤테이션 | 결과 | 해석 |
|---|---|---|---|
| MUT-C | `DIRECT_SCRIPT_EXT` 를 정본 파생 → **하드코딩 `/\.(sh\|bash\|zsh\|ksh)$/`** 로 되돌림 | **검출** — `blocker-3n.test.ts [ENG-N1]` 1건 fail | **3-N 의 M-A 가 닫혔다.** 그때는 이 절을 고쳐도 전건 green 이었는데(무테스트), 이번엔 정본 8셸 전수 테스트가 `.dash`·`.fish`·`.ash` 를 못 읽으면 즉시 fail. |
| MUT-B | `flagValues` 를 `return []` 로 | **검출** — 6 테스트 fail | SEC-259/232 경로가 정본에 잘 고정됨. |
| **MUT-E** | `CORE_INVOKE_RE` 에 `nodejs` **추가**(정본과 일치시킴) | **미검출** — 1301 전건 green | **`nodejs` 갭이 테스트로 전혀 안 재짐** — `nodejs …/cli.js …--force` 를 거는 테스트가 0건. ENG-O2 의 근거. |
| **MUT-O1** | `profile.ts` 를 **개행-정확**하게 고침(`commandLines(원문)` 먼저, 그 뒤 줄별 `normCmd`) | **미검출** — 1301 전건 green | **개행 dry-run 이 양방향으로 무테스트다.** 고쳐도 아무것도 안 깨지고, 현재 코드는 개행에서 뚫린다(§ENG-O1). ENG-N2 테스트는 `&&`·`;`·`||` 만 도는데(`blocker-3n.test.ts:116`), 그것은 **규칙이 아니라 세 구분자의 우연을 고정**한 것(rubric §4). |

- **MUT-O1 이 핵심이다.** dry-run 예외 「한 벌·줄 단위」의 정합성은 개행에서 무너지는데,
  그것을 재는 테스트가 없다 — ENG-N2 의 「줄 단위」 주장이 세 구분자에서만 검증되고, 정작
  `commandLines` 가 쪼개도록 만든 개행에서 검증되지 않는다.
- **MUT-C 는 진전이다.** 3-N 이 rubric §4 사례로 지목했던 「규칙 자체를 안 재는」 자리(셸
  확장자 멤버십)가 정본 전수 테스트로 닫혔다.

## 캐시 정확성 검증 ([COST-260] `realCache`)

`realCache`(`hook.ts:632`)는 모듈 전역이나 **`handleHook` 진입에서 새 `Map` 으로 세팅
(`hook.ts:241`)되고 `finally` 에서 `null`(`hook.ts:288`)**된다 → 수명이 정확히 **판정 1회**다.
게다가 훅 호출은 매번 별도 node 프로세스라 판정 간 누수 자체가 구조적으로 불가능하다.
「파일 생성 후 재판정·심링크 교체」를 직접 쟀다:

- **프로세스 분리(e2e, 배포 dist)**: 심링크 `ln`→`/tmp/safe`(ALLOW) → **판정 사이에** 심링크를
  `.harness/config.yaml` 로 교체 → 재판정 **DENY**. 낡은 답 없음. `rm link` 후 직접 config
  쓰기도 DENY. 각 판정이 새 프로세스라 신선.
- **동일 프로세스 연속 판정(가장 엄격)**: 한 프로세스에서 `handleHook` 를 3회 부르며 그 **사이에**
  심링크를 교체 — j1(→safe) **ALLOW**, j2(→config) **DENY**, j3(→safe) **ALLOW**. `finally` 의
  `null` 리셋이 판정 간 캐시 누수를 막음을 실측(3벌 전부 신선). **낡은 답 = 0.**

캐시는 정확성을 해치지 않는다. 판정 **도중** 파일시스템이 안 바뀐다는 가정만 쓰는데(읽기
전용 판정이라 스스로 fs 를 안 건드림) 그 가정은 성립한다.

## 3-N 미측정 자리 보완

- **MCP 표면(`callTool`)의 확장자 드리프트**: `mcp.ts` 는 `scanBashWrites`·훅 판정 로직을
  **import 하지 않는다** — bash 명령 판정 경로가 애초에 없다(하네스 상태 명령만 노출). 그래서
  `DIRECT_SCRIPT_EXT` 류 드리프트가 **재현될 자리가 없다**(무관). `harness_gate_approve` 는
  `callTool` 진입 최상단에서 무조건 거부(`refuseApprove`). MCP 표면은 이 결함의 대상이 아님.
- **다른 출하 프로파일 전수**: 번들 프로파일은 **둘뿐**(`generic`·`nextjs-prisma`).
  `nextjs-prisma.deploy_commands` 중 config 목록에 **없는** 것은 `prisma migrate deploy` **하나**
  → 그것이 ENG-O1 의 유일한 번들 표적. 사용자 커스텀 프로파일이 프로파일-전용 배포 명령을
  더하면 표적이 늘어난다(예: 사내 배포 스크립트).
- **툴체인 버전 간 빌드 재현**: 여전히 **node v22.22.2 · tsup 8.5.1 한 머신**에서만 쟀다.
  같은 툴체인 결정성은 확인(독립 2클론 재빌드 == 커밋본 sha). **다른 node/tsup 버전 간** 바이트
  재현은 이 감정에서도 안 쟀다(3-N 과 동일 한계).
- **`degraded` 경로가 위조 이벤트에 즉시 오염되는지**: 쟀다.
  - **정상 경로(유효 state.json=P0)**: 저널에 위조 `phase-set P7` 를 넣어도 **무시** → 소스 쓰기
    DENY. state.json 이 읽히면 그것이 권위.
  - **degraded 경로(state.json 손상 → 저널 재생)**: 같은 위조 저널을 **즉시 honor** → 소스 쓰기
    **ALLOW**(`doctor --repair` 없이 다음 훅 호출에서 바로 P7 로 답한다).
  - **그러나 두 전제 조건이 에이전트에게 전부 DENY 다**: `echo x >> .harness/events.jsonl`(저널
    위조) DENY · `rm .harness/state.json`(강등 유도) DENY. 즉 degraded 즉시-오염은 **설계상
    특성**(저널 = 진실)이고, 위조 저널이 이미 존재해야 성립하므로 **에이전트 도구 표면에서
    독립적으로 도달 불가**. (참고: ENG-N1 이 닫히며 `.fish` 저널-위조 벡터도 사라졌다.) 결함으로
    세지 않되, 「degraded 폴백은 저널을 전면 신뢰한다」는 사실은 남겨 둔다 — 보안 전체가 저널
    무결성에 걸린다.

## 발견 결함

### [ENG-O1] (MEDIUM) dry-run 예외 아홉 번째 사본 — 개행 구분자로 프로파일 배포 명령의 설계 트랙 차단 우회
- **원인**: `isDeployCommand`(`profile.ts:504`)가 `const cmd = normCmd(command)` 로 **먼저**
  `\s+`(개행 포함)을 공백으로 뭉갠 뒤 `commandLines(cmd).filter(l => !isDryRun(l))` 를 돈다.
  `commandLines` 의 `SEGMENT_SPLIT`(`bashwrite.ts:23`)은 `\n` 을 쪼개도록 만들어졌는데, 그 앞에서
  `normCmd` 가 개행을 이미 없애 **한 줄**이 되고, 그 한 줄에 `--dry-run` 이 있으면 통째로
  사면된다. 형제 구현 `hook.ts:1774`(config 경로)은 `rawCmd` 를 그대로 `commandLines` 에 넣어
  개행을 쪼갠다 — 그래서 두 경로가 **같은 입력에 다른 답**을 낸다.
- **결정적 관측(함수 직접 호출)**:
  ```
  RAW commandLines        : ["prisma migrate deploy --dry-run","prisma migrate deploy"]
  RAW after dryrun filter : ["prisma migrate deploy"]          → 진짜 배포 포착 → DENY
  normCmd(cmd)            : "prisma migrate deploy --dry-run prisma migrate deploy"
  normed after filter     : []                                  → 전체 사면 → ALLOW
  ```
- **재현(샌드박스, 배포 dist `fe1aa49…`, `nextjs-prisma` 프로파일, 설계 트랙 P0)**:
  ```
  prisma migrate deploy                                          => DENY  (정상 차단)
  prisma migrate deploy --dry-run                                => ALLOW (dry-run 면제 — 정상)
  prisma migrate deploy --dry-run && prisma migrate deploy       => DENY  (ENG-N2 가 닫음)
  prisma migrate deploy --dry-run ; prisma migrate deploy        => DENY
  prisma migrate deploy --dry-run\nprisma migrate deploy         => ALLOW  ← 우회 (진짜 마이그레이션)
  prisma migrate deploy --dry-run\n\nprisma migrate deploy       => ALLOW  ← 우회
  vercel deploy --dry-run\nvercel deploy   (config 목록)          => DENY   (config 경로가 개행을 쪼갬)
  ```
  config 목록 명령(`vercel deploy`)은 개행에서도 DENY 인데 **프로파일-전용 명령**
  (`prisma migrate deploy`)만 ALLOW 라는 비대칭이 곧 두 구현의 드리프트 증거다.
- **근본원인 확인(패치)**: `profile.ts` 를 `commandLines(String(command)).map(normCmd).filter(...)`
  (원문을 먼저 줄로 쪼갠 뒤 줄별 정규화)로 고치면 개행 케이스가 전부 DENY 로 돌아온다(샌드박스
  재빌드 없이 tsx 로 `isDeployCommand` 직접 호출해 확인 — `&&`·`;`·`\n`·`\n\n` 모두 true).
- **영향**: 스펙 §4-2 「배포는 출하 트랙 승인 후에만」을 **프로파일 정의 배포 명령**에 대해 깬다.
  표적이 `prisma migrate deploy`(운영 DB 마이그레이션)라 무게가 크고, **무백스톱**이다(설계 트랙
  deploy 차단이 유일 방어인데 그것이 뚫린다). MEDIUM 인 이유: config 목록 명령엔 안 걸리고
  프로파일-전용 명령에 한정되며, 개행-분리 dry-run+real 결합이 필요하다. 다만 그 결합은
  「먼저 dry-run 으로 확인, 그다음 실제」라는 **자연스러운 다줄 블록**이라 `&&` 결합보다 오히려
  도달성이 높다.
- **처방**: dry-run 예외를 **정말 한 벌**로 만든다 — `isDeployCommand` 도 `hook.ts:1774` 처럼
  **원문을 먼저 `commandLines` 로 쪼갠 뒤** 줄별로 정규화·dry-run 필터. 그리고 ENG-N2 테스트에
  **개행 구분자를 추가**해 못 박는다(현재 `blocker-3n.test.ts:116` 은 `&&`·`;`·`||` 만 돈다).
- **위치**: `core/src/profile.ts:504-528`(드리프트 사본) · `core/src/hook.ts:1774`(안전 사본).

### [ENG-O2] (LOW) `CORE_INVOKE_RE` 가 정본 미파생 JS-런타임 목록 — `nodejs` 누락으로 자기해제 탐지 우회(백스톱 있음)
- **원인**: `CORE_INVOKE_RE`(`hook.ts:132`) `(?:node|npx|bun|deno)\b…cli\.js` 는 정본
  `NON_SHELL_INTERPRETERS`(`node,nodejs,deno,bun`)에서 파생하지 않은 손목록이고, **`nodejs` 를
  뺐다**(그리고 `npx` 를 더했다). `node\b` 는 `nodejs` 에 경계가 없어 안 걸린다.
- **재현(훅 판정, 배포 dist)**:
  ```
  node   …/cli.js phase set P7 --force        => DENY
  nodejs …/cli.js phase set P7 --force        => ALLOW  ← 탐지 우회
  npx    …/cli.js phase set P7 --force        => DENY
  bun    …/cli.js phase set P7 --force        => DENY
  nodejs …/cli.js doctor --accept-policy      => ALLOW  ← 탐지 우회
  ```
- **왜 LOW(백스톱)**: 각 탈출구는 **두 겹**이다 — 훅 탐지(우회됨) + CLI 의 env/TTY 게이트.
  `phase --force`·`doctor --accept-policy` 는 CLI 가 `HARNESS_ALLOW_FORCE=1`·
  `HARNESS_ACCEPT_POLICY=1` 을 요구하고, 그 env 리터럴은 **별도 절**(`hook.ts:1668`·`1726`,
  `invokesHarness` 무관)이 잡는다 — `HARNESS_ALLOW_FORCE=1 nodejs …--force` 는 실측 DENY.
  또 **진짜 cli.js** 를 PTY(`script`) 로 감싸 `gate approve` 를 열려 해도 [SEC-208] 이 「인터프리터
  헤드가 아닌 래퍼가 cli.js 를 언급」을 잡아 DENY(실측). 그래서 진짜 cli.js 로는 완결된 탈출을
  **못 만들었다**(사본 cli.js 로는 가능하나 `cp <cli.js>` 자체가 DENY). 무해한 자리가 아니라
  **탐지 계층 한 겹이 `nodejs` 에서 침식**된 것 — 정본 파생이면 애초에 안 생겼을 드리프트다.
- **처방**: `CORE_INVOKE_RE` 를 정본에서 만든다 — 예:
  `` new RegExp(`(?:^|[\\s;&|\`"'()])(?:${[...NON_SHELL_INTERPRETERS,'npx','bunx','pnpx'].join('|')})\\b…`) ``.
  MUT-E 로 `nodejs` 추가가 무테스트임을 확인했으니 정본 파생 + `nodejs` 회귀 테스트를 붙인다.
- **위치**: `core/src/hook.ts:132`.

## 캐시·게이트 부수 검증 — [COST-262] 벤치 게이트는 회귀를 잡는다

일부러 2차(quadratic)를 만들어 게이트가 FAIL 을 내는지 봤다(샌드박스 복사본).
- **뮤테이션**: `realOrSelf` 를 캐시 우회(`return realOrSelfUncached(p)`)로 되돌려 [COST-260]
  의 O(R²) 조상 재귀를 재도입 → 재빌드.
- **측정(cd-redirect 1000세그먼트, 단일 훅 호출, 게이트 문턱 `CMD_GATE_MS=1000`)**:
  ```
  BASELINE (cache on) : real 0.32s
  MUTATED (cache off) : real 23.61s   ← 23,610ms ≫ 1000ms 문턱 → 게이트 FAIL
  ```
  23.6s 는 훅 타임아웃 10초도 넘어 **fail-open** 이 되는 정확히 그 부류다. `bench-hook-latency.mjs`
  의 `failed++` → `process.exitCode = 1` 이 발화한다(문턱 초과 시). 게이트가 실제로 이 회귀를
  CI 에서 잡는다. (BUSY 게이팅도 정직: 부하 중 초과는 실패로 안 세고 사실만 표기.)

## 직전 라운드 대비 (3-N 3.5 → 3-O 3.8)

- **닫힌 것(진짜 진전, 뮤테이션으로 확인)**:
  - **[ENG-N1](HIGH) 닫힘** — 직접실행 확장자 목록이 `hook.ts:731` 에서 정본 파생
    (`new RegExp(...SHELLS_TAKING_C)`). `.fish`·`.dash`·`.ash` 직접실행이 이제 전부 DENY(실측).
    **게다가 정본 8셸 전수 테스트**(`blocker-3n [ENG-N1]`)로 못 박아, 3-N 이 rubric §4 사례로
    지목한 「규칙을 안 재는」 무테스트 상태가 닫혔다(MUT-C 로 검출 확인). SEC-219 저널 위조의
    확장자 벡터가 실제로 사라졌다.
  - **[ENG-N3](LOW) 닫힘** — `INTERPRETER_HEADS` 가 `NON_SHELL_INTERPRETERS + SHELLS_TAKING_C`
    정본에서 파생.
  - **[SEC-259] 정본화** — `flagValues` 한 함수가 `cp -t`·`tar --directory`·`rsync --backup-dir`·
    `git --separate-git-dir` 를 공용 처리. 도구별 사본 드리프트 부류를 선제 차단(MUT-B 로 고정 확인).
  - **[ENG-N2] 부분 닫힘** — dry-run 예외가 `&&`·`;`·`||` 세 구분자에서 한 벌로 수렴(실측 DENY).
- **그대로거나 나빠진 것**:
  - **하드 조건 「중복 규칙 0」 네 라운드 연속 ✗**. dry-run 예외의 **개행 사본**(ENG-O1)이
    ENG-N2 의 「한 벌」주장을 개행에서 반증한다 — 매 라운드 「모았다」가 한 구분자/한 셸씩
    빠진 채 재발하는 **구조적 whack-a-mole 이 계속**된다. 다만 이번 잔여는 HIGH 가 아니라
    MEDIUM 이고(무백스톱), config 경로엔 안 걸린다.
  - **정본 미파생 손목록이 하나 더 노출** — `CORE_INVOKE_RE`(ENG-O2, LOW). 셸 목록 정본화가
    완결되는 사이, JS 런타임 목록이 같은 실수를 반복했다(백스톱 있어 LOW).
- **불변(견고)**: 테스트 결정성(3×1301 동일)·tsc 0·빌드 바이트 재현·다수 SSOT 규율·교차
  파리티 테스트·관측 가능한 fail-open·정직한 벤치 게이트. 여기까지는 5.0 급 그대로다.

**점수 근거**: 엔지니어링 기초는 5.0 급이고, 이번엔 직전 HIGH([ENG-N1])와 LOW([ENG-N3])를
**정본 파생 + 전수 테스트로 실제로 닫았다**(뮤테이션으로 검증) — 3-N 이 rubric §4 로 지목한
무테스트 자리까지 메운 것은 실질 진전이다. 그러나 하드 조건 「중복 규칙 0」이 다시 ✗ 이고
(dry-run 예외의 개행 사본이 **무백스톱 MEDIUM 우회**를 연다), 정본 미파생 손목록도 하나 더
드러났다(ENG-O2, LOW). rubric: "잔여로 깎지 말고 조건 미충족으로 판정" → **4.8 미만 확정.**
그러나 잔여 심각도가 **HIGH+MEDIUM+LOW(3-N) → MEDIUM+LOW(3-O)** 로 실측 하락했고, 닫힌 결함들이
뮤테이션으로 재확인되며, 벤치 게이트가 회귀를 실제로 잡는 것까지 확인됐다 — 근거 있는 만큼만
**3.5 → 3.8** 로 올린다. 성격은 여전히 「높은 규율, 단 같은 규칙-계열이 매 라운드 한 구분자씩
드리프트하며 그 뒤에 실측 우회가 있다」이나, 그 우회의 무게가 확실히 가벼워졌다.

## 못 잰 것 (정직 고지)

- **뮤테이션은 셸/드라이런/런타임 사본 + 새 헬퍼(flagValues) 중심**으로 했다(MUT-B·C·E·O1 +
  캐시·degraded 파리티). 다른 판정 절(리다이렉트 `>|`·xargs·scriptFiles·CONDITIONAL_WRITERS)의
  전수 뮤테이션은 안 했다 — illusory 회귀가 더 있을 수 있다.
- **ENG-O1 은 `nextjs-prisma` 프로파일**로 실측했다. 사용자 커스텀 프로파일-전용 배포 명령
  전수는 안 봤다(같은 메커니즘이라 재현될 것으로 추정하나 미측정).
- **ENG-O2 의 완결 탈출**은 만들지 못했다(진짜 cli.js 는 env 리터럴 절 + SEC-208 이 막음).
  사본 cli.js 를 `git show HEAD:core/dist/cli.js > /tmp/x.js` 로 재구성해 PTY+nodejs 로 여는
  다단계 사슬은 **가설로만** 두고 끝단까지 잇지 않았다(축 2 영역이라 판단해 여기서 멈췄다).
- **빌드 재현은 한 머신·node v22.22.2·tsup 8.5.1** 에서만. 다른 툴체인 버전 간 바이트 재현은
  안 쟀다(3-N 과 동일 한계).
- **MCP `callTool` 은 bash 판정 경로가 없음을 코드로 확인**했으나, 병행 세션이 작업 중인
  `[SEC-265]`(MCP 쓰기 표면 = `mcp__*` 도구 이름) 은 **631f190 에 없다** — 내 대상 밖이라 안 쟀다.

## 마감 확인

- **나는 리포를 수정하지 않았다.** 내 편집·빌드·테스트는 전부 샌드박스 클론
  (`/private/tmp/.../scratchpad/clone1·clone2·clone3` 및 `proj*`)에서만 했다. 리포에는 이 보고서
  디렉토리(`docs/release-readiness/2026-08-21/round3o/`, 쓰기 허용된 산출물)만 새로 추가했다.
  추적 파일 스테이징·커밋 **0**.
- **커밋 상태(내 감정 대상)는 불변**: 대상 HEAD `631f190` 은 history 에 온전하며, 감정 중 리포
  HEAD 가 `3056767` 로 전진했으나 `git diff 631f190..3056767 -- core/src core/dist` = **빈 diff**
  (`docs:` 핸드오프 커밋). `git show 631f190:core/dist/cli.js` SHA-256 =
  `fe1aa49a6155f683f1767b95b57387c1a8e45a0bc5ede547c36a58b3ec821175` — 샌드박스 재빌드와 동일.
  발견 결함은 현재 HEAD 커밋에도 그대로 존재.
- **정직 고지 — 작업트리에 병행 세션의 미커밋 변경이 있음**: 감정 종료 시점 `git status
  --porcelain` 이 `M core/src/hook.ts`·`M core/src/bashwrite.ts`·`M core/dist/cli.js`·
  `M core/test/blocker-3n.test.ts`·`M README*`·`M hooks/hooks.json` 를 보였다. 이는 **내 것이
  아니다** — 병행 구현자 세션이 신규 항목 `[SEC-263]`(하드링크 앨리어싱)·`[SEC-264]`(묶음
  단축플래그)·`[SEC-265]`(MCP 쓰기 표면)을 작업트리에 얹은 것이다(전부 **축 2 실효성** 영역).
  **되돌리지 않았다**(남의 미커밋 작업을 지우는 파괴적 행위). 확인: 그 미커밋 diff 는 **`profile.ts`
  를 건드리지 않고**(내 ENG-O1) **`CORE_INVOKE_RE` 도 안 건드린다**(내 ENG-O2) — 내 두 결함은
  병행 작업과 무관하게 `631f190` 과 현재 작업트리 양쪽에 그대로 산다.
