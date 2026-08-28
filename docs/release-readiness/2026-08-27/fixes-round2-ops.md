# 수정 라운드 2 — 관측성(G13) 잔여 4건 + USE-01

**담당** 수정 라운드 2 서브에이전트 · **작업일** 2026-08-28 · **기준 커밋** `bacb4bc`
**대상** OPS-03(HIGH) · OPS-04(MED) · OPS-05(MED) · OPS-09(MED) · USE-01(MED)

작업 파일 경계: `core/src/doctor.ts` · `core/src/design.ts` · `core/src/runtime.ts` ·
`core/src/state.ts` · `core/src/events.ts` · `core/test/ops-round2-2026-08-27.test.ts`.
`hook.ts`·`gate.ts`·`cli.ts`·`bashwrite.ts`·`help.ts`·README·기존 테스트는 건드리지 않았다.

## 1. 재현 확인 (고치기 전, 샌드박스 실측)

샌드박스: `scratchpad/proj1`(`node bin/harness init`), 커밋 `bacb4bc` 빌드.

| 결함 | 판정 | 실측 |
| --- | --- | --- |
| OPS-03 | **재현됨(부분 stale)** | `.harness/` 전체 `chmod -R 555` → `hook post-tool`(Write) 는 exit 0, `last-activity` 미생성, `hook-errors.log` 도 미생성 = 완전 침묵. **다만** 마커 **파일만** 쓰기 불가(디렉토리는 쓰기 가능)인 경우에는 `handleHook` 의 포괄 catch → `logHookError` 가 이미 1건을 남기고 있었다 — 「흔적이 0」은 전면 읽기전용에서만 참이다. |
| OPS-04 | **재현됨** | `chmod -R 555 .harness` 상태에서 `harness doctor` → `{"ok":true,"issues":[],"warnings":[]}` |
| OPS-05 | **재현됨** | 같은 상태 + state 발산 → `doctor --repair` → `EACCES: permission denied, open '<...>/.harness/state.json.tmp-56844'`, exit 1 |
| OPS-09 | **재현됨** | `harness design inventory --from nope.html` → `ENOENT: no such file or directory, open '<...>/nope.html'`, exit 1 |
| USE-01 | **재현됨** | `chmod 000 .harness/events.jsonl` → `harness doctor` → stdout 0바이트, stderr raw EACCES, exit 1(JSON 계약 파손) |

부수 확인: OPS-01(저널 손상 고지)은 이미 `hook.ts` 의 `degradedNote` 에 배선돼 있었다 —
내 범위 밖이라 손대지 않았다.

## 2. 고친 것

### [OPS-03] 활동 마커 — 조용히 실패하되 흔적을 남긴다 (`core/src/runtime.ts`)

`noteActivity` 를 try/catch 로 감싸고, 실패를 **이미 있는 통로**(`.runtime/hook-errors.log`,
`doctor` 의 `countHookErrors` 가 세는 곳)에 `activity-marker last-activity <err>` 로 남긴다.
새 통로는 만들지 않았다.

- 무해 계약: 마커 실패가 훅 판정을 예외로 끊지 않는다(이전에는 던져서 `handleHook` 의
  포괄 catch 로 떨어졌다).
- 과보고 없음: 이전에 포괄 catch 가 남기던 1건을 여기서 대신 남기므로 **건수는 그대로**이고,
  대신 「무엇이 실패했는지」가 문구에 들어간다.
- **남는 사각을 숨기지 않는다**: `.harness/` 전면 읽기전용이면 그 로그도 같은 디렉토리라
  함께 실패한다. 그 상태는 아래 OPS-04 의 쓰기 프로브가 잡는다 — 두 수정이 한 쌍이다.

`noteTurnLogged` 는 손대지 않았다(CLI 경로라 크게 실패하는 것이 옳다).

### [OPS-04] doctor 쓰기 프로브 (`core/src/doctor.ts`)

`runDoctor` 0단계에 `.harness/`·`.harness/.runtime/` 실제 쓰기 프로브(임시 파일 생성 후 즉시
삭제)를 추가하고, 실패를 **issue** 로 올린다.

- **warning 이 아니라 issue 인 이유**: warnings 는 `ok` 를 내리지 않는데, 「읽기전용 상태에서
  초록불」이 결함 자체였다. 정책 드리프트처럼 정당할 수 있는 상태와 달리 쓰기 불능은 정상이
  아니다. 파일 머리말의 분류(issues = 복구 대상)와의 어긋남은 주석에 사유를 적었다.
- 비간섭: `.harness/` 가 없으면 아무것도 하지 않는다. **없는 디렉토리는 만들지 않는다**
  (`doctor` 는 아무것도 바꾸지 않는 진단이고, 신규 클론의 `.runtime/` 부재는 정상이다).
- 잔해 없음: 프로브 파일 이름은 기존 `sweepOrphanTmp` 규칙(`.tmp-<pid>`)을 따른다.
- 실측(수정 후): 읽기전용 → `ok:false` + 「무엇이·왜·무엇을 하면 되는지(`chmod u+w`)」가
  한 문장에 있는 issue. 정상 프로젝트 → `{"ok":true,"issues":[],"warnings":[]}` 그대로.

### [OPS-05] 쓰기 실패는 raw errno 로 새지 않는다 (`core/src/state.ts` · `core/src/events.ts`)

`state.ts` 에 `rethrowWriteFailure(root, e, target)` 를 두고 `writeState` 와 `appendEvent`
양쪽에서 쓴다. `EACCES`·`EPERM`·`EROFS` 만 재작성하고 **다른 errno 는 그대로 던진다**
(원인이 다른 실패를 권한 문구로 덮으면 사람을 엉뚱한 곳으로 보낸다 — 회귀 테스트로 고정했다).
문구는 en/ko `tr(root, {en, ko})` 패턴, 원본 errno 문자열도 뒤에 보존한다.

실측(수정 후): 읽기전용 `doctor --repair` →
`Cannot write to <...>/.harness (EACCES) — ... Check the directory permissions (chmod u+w <...>) ...
Original error: EACCES: ...`

### [USE-01] doctor 는 저널을 못 읽어도 진단을 낸다 (`core/src/doctor.ts`)

`readJournal(root)` 를 try/catch 로 감싸(바로 아래 state.json 처리와 같은 모양) 「events.jsonl 을
읽을 수 없다 + `chmod u+r` 」를 issue 로 보고하고, 재생 신뢰도(`trustworthy`)를 내린다 —
빈 재생으로 `--repair` 가 state 를 지우는 것을 막는다.

**가드가 한 곳으로는 부족했다.** `policy.ts` 의 `pinnedPolicy` 가 베이스라인을 **저널에서**
읽으므로(`readEvents`), 1단계만 막아도 정책 절에서 다시 죽었다. `policy.ts` 는 내 작업 파일이
아니라 **doctor 쪽 호출 절 전체를 try/catch 로 감싸** 「정책 베이스라인을 확인할 수 없었다」를
warning 으로 남기고 나머지 진단은 그대로 낸다.

실측(수정 후): `chmod 000 events.jsonl` → 유효한 JSON(`ok:false` + issue 1 + warning 1),
`--repair` → `refused: true`, `state.json` 의 phase 보존.

### [OPS-09] 캔버스 내용 파일 읽기 — **미완결(cli.ts 필요)**

`core/src/design.ts` 에 `readCanvasContent(root, from)` 를 추가했다(raw ENOENT 대신 「이 명령은
캔버스를 직접 받아오지 않는다 — WebFetch 로 받아 파일로 저장한 뒤 `--from` 에 주라」).
**그러나 실제 유출 지점은 `core/src/cli.ts:1202` 이고 그 파일은 내 수정 금지 대상이다.**

오케스트레이터가 적용할 1줄:

```diff
-            const inv = extractInventory(fs.readFileSync(path.resolve(root, from), 'utf8'));
+            const inv = extractInventory(readCanvasContent(root, from));
```

`cli.ts` 상단 `./design` import 목록에 `readCanvasContent` 를 추가하면 된다. 이 한 줄 전까지
**CLI 표면의 OPS-09 는 열려 있다**(실측: 수정 후에도 `design inventory --from nope.html` 은
여전히 raw ENOENT).

## 3. 변이 검증 (고친 곳을 되돌려 red 가 뜨는지)

전부 `npx vitest run core/test/ops-round2-2026-08-27.test.ts` 기준. 각 변이 후 원복 확인.

| # | 되돌린 것 | 결과 |
| --- | --- | --- |
| M1 | `noteActivity` 의 try/catch 제거 | **2 failed** / 11 passed |
| M2 | `noteMarkerFailure` 호출만 제거(흔적 없애기) | **1 failed** / 12 passed |
| M3 | `unwritableDirs` 를 항상 `[]` 반환으로 | **1 failed** / 12 passed |
| M4 | doctor 1단계 저널 읽기 가드 제거 | **2 failed** / 11 passed |
| M5 | `rethrowWriteFailure` 를 raw 재던지기로 | **2 failed** / 11 passed |
| M6 | `readCanvasContent` 를 raw `readFileSync` 로 | **1 failed** / 12 passed |
| M7 | doctor 정책 절 try/catch 제거 | **2 failed** / 11 passed |

원복 후 매번 13/13 green 재확인.

## 4. 검증

- `npm run check` (tsc --noEmit) → **0**
- `npx vitest run core/test/ops-round2-2026-08-27.test.ts` → **13 passed**
- 인접 스위트(측정 위생상 전체 `npm test` 는 돌리지 않음, 중앙에서 수행):
  `doctor` `state` `events` `runtime` `design` `policy` `cli-contract` `hook-stop` `hook-misc`
  `observability-2026-08-27` `med-3g-enforcement` `blocker-3j` `wave` `gate` `surface-parity`
  `guidance-commands-exist` `cli` `ledger` `report` `mcp` `migrate` `loop` → **전부 green**
  (610 tests). **깨진 기존 테스트 없음.**
- `npm run build` 로 `core/dist` 재생성(공용 산출물이라 오케스트레이터의 최종 빌드가 정본).

## 5. 남은 것 / 보고만 한 것

1. **OPS-09 는 `core/src/cli.ts:1202` 한 줄 전까지 열려 있다** — 위 diff 참조. 그 전까지
   `design.ts` 의 `readCanvasContent` 는 테스트만 붙은 미배선 export 다.
2. **`core/src/policy.ts` 의 `pinnedPolicy` 가 저널 읽기 실패에 무방비다**(내 작업 파일 아님).
   doctor 쪽에서 감쌌으므로 진단은 살지만, `policy` 를 부르는 다른 경로(예: `init` 이후의
   재고정)는 여전히 raw errno 를 낼 수 있다.
3. **`bin/harness` 의 exit code 관측** — `doctor` 가 `ok:false` 일 때 셸에서 관측되는 종료
   코드는 1 이 아니라 2 였다. 이번 수정 **이전의 일반 발산 사례에서도 동일**하므로 내 변경과
   무관한 기존 동작이다(계약 변화 없음). 문서화 여부는 오케스트레이터 판단.
4. OPS-03 의 「전면 읽기전용에서 마커 실패 흔적 0」은 **원리상 `.harness/` 안에서는 못 남긴다**
   (로그도 같은 디렉토리). 이번 라운드의 답은 OPS-04 의 doctor 쓰기 프로브다. 새 통로
   (`/tmp` 등)를 만드는 안은 「새 통로를 만들지 말라」는 규율에 따라 채택하지 않았다.
