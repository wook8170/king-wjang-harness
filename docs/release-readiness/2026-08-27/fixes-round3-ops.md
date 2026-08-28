# 수정 라운드 3 — open HIGH 2건 (OPS-08 · API-03)

**담당** 수정 라운드 3 서브에이전트 · **작업일** 2026-08-28 · **기준** 커밋 `bacb4bc` + 라운드 1·2 미커밋 작업트리
**대상** [OPS-08] HIGH(저널 비밀 평문 보존) · [API-03] HIGH(config 키 오타 침묵 무시)

작업 파일 경계: `core/src/events.ts` · `core/src/config.ts` · `core/src/doctor.ts` ·
`core/src/loop.ts` · `core/test/ops-round3-2026-08-27.test.ts`(신규).
`hook.ts`(오케스트레이터가 동시 작업 중) · `cli.ts` · README · 기존 테스트는 건드리지 않았다.

## 1. 재현 확인 (고치기 전, 샌드박스 실측)

샌드박스: `scratchpad/sandbox1`·`sandbox2`(`node bin/harness init`).

| 결함 | 판정 | 실측 |
| --- | --- | --- |
| OPS-08 | **재현됨** | `harness loop critical raise --reason external-blocker --detail "blocked by API key sk-FAKE-SECRET-abc123XYZ and Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"` → `.harness/events.jsonl` 에 그 문자열이 **바이트 그대로** 저장됨(`grep` 1건 일치). |
| API-03 | **재현됨** | `design_bloked_bash`(오타) 를 적은 config 로 `hook pre-tool`(`my-secret-deploy now`) → 빈 출력 = ALLOW. 같은 상태에서 `harness doctor --json` → `"ok": true`, `issues: []`, 유일한 신호는 「정책 파일이 베이스라인과 다르다 … 정당한 변경일 수 있다」 경고 한 줄. |

두 건 다 감사 원문의 재현 절차와 동일한 결과 — stale 아님.

## 2. 고친 것

### [OPS-08] 저널 쓰기 지점 **한 곳**에서 마스킹 (`core/src/events.ts`)

`appendEvent` 가 `data` 를 **복제하면서** 문자열 값에만 마스킹을 적용한다(`maskSecrets` /
`maskDeep`). 저널로 들어가는 문은 이 함수 하나뿐이므로, 새 이벤트 타입이 생겨도 자동으로 덮인다.

- **키 이름 목록으로 고르지 않았다.** `--detail`·`--rationale` 같은 자유 텍스트 **키 이름**의
  화이트리스트는 새 필드가 생기는 순간 낡는다(이 저장소가 반복해 물린 「두 벌 중 느슨한 쪽이
  정본」). 대신 **값의 모양**으로 판단한다.
- **그래서 패턴은 오탐이 0 에 가까운 것만 골랐다** — 발급자 접두형(`sk-`, `ghp_`/`gho_`/…,
  `github_pat_`, `xox[baprs]-`, `AKIA`/`ASIA`), `Bearer <12자+>`, PEM 개인키 블록,
  그리고 **문맥이 붙은 대입형**(`api_key=`·`aws_secret_access_key=`·`password:` … + 12자 이상 값).
- **「긴 hex/base64」 단독 패턴은 일부러 넣지 않았다.** 이 저널의 `artifactHash`(sha256)·
  `policyHash` 가 정확히 그 모양이다 — 넣는 순간 구조화된 필드를 스스로 파괴한다. 사유는 주석에.
- **맨 `token` 은 `=` 일 때만** 본다(`vercel deploy --token=…` 가 `deployment-recorded` 로
  들어오기 때문). `token:` 을 제외한 이유는 이 제품이 디자인 **토큰**을 온종일 말하기 때문 —
  `token: color-bg-primary` 를 뭉개면 그게 바로 오탐이다.
- 마스킹은 **무엇이 가려졌는지 남긴다**: `sk-***MASKED***`, `Bearer ***MASKED***`,
  `AKIA***MASKED***`, PEM 은 BEGIN/END 헤더를 남기고 본문만. 문장의 나머지는 그대로다
  (감사 기록으로서의 가치를 지키는 것이 이 수정의 절반이다).
- 호출부 객체는 **변형하지 않는다**(복제). 부작용으로 남의 객체를 바꾸면 추적할 방법이 없다.
- 의도한 절충(주석에 명시): `password: hunter2` 처럼 **짧고 문맥이 약한** 값은 놓친다.
  오탐을 내느니 놓치는 쪽을 골랐다.

곁들여 `core/src/loop.ts` 한 줄: `raiseCritical` 이 돌려주는 값을 `data` 가 아니라 `ev.data`
(= 저널에 실제로 남은 것)로 바꿨다. 「저장된 것」과 「보고된 것」이 갈리면 원문이 다른 싱크로
다시 흘러 들어갈 길이 열린다. (CLI 의 소환 읽기(`loop critical status`)는 원래 저널을 읽으므로
이미 마스킹된 값을 보여 준다 — 실측 확인.)

### [API-03] 미지 config 키를 탐지하고 **판정에 반영** (`core/src/config.ts` · `core/src/doctor.ts`)

- `config.ts`: `KNOWN_CONFIG_KEYS` 를 **`DEFAULT_CONFIG` 에서 파생**한다(손으로 적은 두 번째
  목록을 두면 키가 하나 늘 때 진단이 멀쩡한 키를 오타라고 우긴다). `inspectConfig` 가
  `{ problems, unknownKeys, path }` 를 돌려준다 — **문자열이 아니라 목록으로** 주는 이유는
  부르는 쪽이 판정까지 정해야 하는데, 문자열을 되파싱하게 하면 그 판정이 문구 변경으로
  조용히 깨지기 때문이다.
- `doctor.ts`: 미지 키를 **issue(= `ok:false`)** 로 올린다.

**왜 warning 이 아니라 issue 인가 (주석에 동일 사유 기재).** 이 파일 머리말의 분류는
「issues = 재생 복구 대상」이고 미지 키는 재생으로 못 고친다. 그럼에도 issue 로 올리는 근거는
**OPS-04(쓰기 불능)에서 이미 채택한 것과 같다**: *정당할 수 있는 상태가 아니다.*

- 정책 드리프트는 사람이 의도적으로 바꾼 결과일 수 있어 영구 red 가 경보를 죽인다. 미지 키는
  오타이거나 다른 버전의 잔재이며, **두 경우 다 「이 파일에 효과 0 인 줄이 있다」로 똑같이 참**이다.
- 그리고 `config.yaml` 은 **훅이 무엇을 막을지 정하는 판정의 입력**이다. 바로 그 상태에서
  초록불을 내는 것이 API-03 결함 자체였다.
- 영구 red 우려는 여기선 약하다 — 사용자가 한 줄 고치면 즉시 풀린다(정책 드리프트처럼
  재고정 의식이 필요 없다). 버전 스큐(신 버전이 쓴 키를 구 빌드가 읽는 경우)도 「그 키는 이
  빌드에서 효과가 없다」가 참이므로 보고가 옳고, 문구가 그 선택지(철자 수정·삭제)를 준다.
- **복구는 하지 않는다.** doctor 가 사용자의 config 를 고쳐 쓰면 SEC-69 가 남긴 「사람의
  탈출구」를 도로 뺏는다. 문구에 `doctor cannot repair this — the config file is yours to edit` 명시.

메시지(en/ko 2언어, 기존 `tr(root, {en, ko})` 패턴): **무엇이 무시되는지 + 그래서 강제가
걸려 있지 않다는 사실 + 다음 행동(철자 수정 또는 삭제) + 이 빌드가 읽는 키 목록 + 고칠 파일 경로.**

## 3. 수정 후 실측 (E2E, 샌드박스)

```
$ harness loop critical raise --reason external-blocker \
    --detail "blocked by API key sk-FAKE-SECRET-abc123XYZ, header Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature99"
$ tail -1 .harness/events.jsonl
{"ts":"…","type":"critical-raised","data":{"reason":"external-blocker",
 "detail":"blocked by API key sk-***MASKED***, header Bearer ***MASKED***"}}
$ grep -c "sk-FAKE-SECRET-abc123XYZ" .harness/events.jsonl   # → 0
```

```
$ harness doctor --json          # init 직후 기본 config
{"ok": true, "issues": [], "warnings": [], …}      ← 과보고 0

$ harness doctor --json          # design_bloked_bash(오타) 를 적은 뒤
{"ok": false, "issues": ["… .harness/config.yaml has 1 key(s) this build does not read:
  \"design_bloked_bash\" — they are ignored, so the default is in effect and whatever you
  meant to enforce with them is not enforced. Fix the spelling or delete the key(s); the
  keys this build reads are: block_raw_values, design_allowed_prefixes, design_blocked_bash,
  design_system_frozen_roots, lang, profile, remote_control, terse. (doctor cannot repair
  this — the config file is yours to edit.)"], …}
```

## 4. 변이 검증 (고친 곳을 되돌리면 실제로 red 인가)

네 개의 변이를 넣고 각각 확인한 뒤 **전부 원복**했다(원복 후 tsc 0 · 14/14 green 재확인).

| # | 변이 | 결과 |
| --- | --- | --- |
| A | `appendEvent` 가 `maskDeep` 을 거치지 않고 원본 `data` 를 쓰게 | **2 red** (저널 경로 2건: 감사 재현·중첩 객체) |
| B | `inspectConfig` 의 미지 키 필터를 `() => false` 로 | **3 red** (doctor 판정·`inspectConfig` 계약·영문 메시지) |
| C | doctor 의 미지 키를 `issues` → `warnings` 로 강등 | **2 red** (`ok:false` 를 단언하는 2건 — **판정 선택 자체가 테스트로 고정**됨) |
| D | `maskSecrets` 가 입력을 그대로 반환하게 | **4 red** (패턴 계층 전부) |

## 5. 테스트

신규 파일 `core/test/ops-round3-2026-08-27.test.ts` — **14건**(OPS-08 7 · API-03 7).
기존 테스트 파일은 **한 줄도 고치지 않았다.**

과보고 방지용으로 고정한 것(전부 green):

- 구조화된 값(sha256 `artifactHash`·12자 `policyHash`·경로·페이즈 `P5`·웨이브 id·아티팩트 URL)과
  평범한 산문(`the token: color-bg-primary`, `Bearer of bad news`, `the secret is out`,
  `password required`, `ask-me-anything-about-this`, `sk-short`)이 **한 바이트도 안 바뀐다.**
- `init` 이 만든 기본 config · 빈 파일 · 주석만 있는 파일 · 값이 `null` 인 키 → 새 경고 0, `ok:true`.
- `DEFAULT_CONFIG` 의 **모든** 키를 적은 config → 미지 키 0 (목록이 두 벌로 갈리면 이 테스트가 깨진다).
- 깨진 YAML·「매핑 아님」은 **종전대로 warning** 이고 `ok` 를 내리지 않는다(UX-151 계약 유지).

## 6. 회귀 (기존 테스트를 깨뜨린 것: **없음**)

`npm run check`(tsc) → **0 에러**.

지시받은 인접 스위트: `events`(14) · `config`(9) · `doctor`(23) · `loop`(38) ·
`cli-contract`(52) · `policy`(25) → **전부 green**.

추가로, `runDoctor`/`appendEvent` 를 만지는 나머지 스위트도 돌려 회귀 없음을 확인했다:
`bashwrite`(59) · `eng-3i-residuals`(15) · `low-3i-guidance`(18) · `ops-round2`(13) ·
`ux-3i-next-move`(6) · `state`(6) · `cli` · `wave` · `fixes-round2`(37) · `observability`(8) ·
`med-3j-residuals`(38) · `i18n-en-default` · `gate` · `adr` · `registry` · `ship` → 전부 green.

지시대로 `npm test` 전체는 돌리지 않았다(측정 위생 — 오케스트레이터 중앙 실행).

## 7. 못 고친 것 · 넘기는 것

- **OPS-08 의 나머지 절반(`.harness/` gitignore 고지)** — 감사 원문은 마스킹 외에
  「`harness init` 이 최상위 `.gitignore` 안내를 하지 않는다」도 함께 지적한다. 그 배선은
  `core/src/cli.ts`(init) 이라 **내 파일 경계 밖**이다. 손대지 않았다. 마스킹이 들어갔으므로
  「커밋되면 유출」의 심각도는 내려가지만, 저널이 git 에 들어간다는 사실 자체는 그대로다.
- **짧은 비밀은 놓친다** — `password: hunter2` 같은 12자 미만·문맥 약한 값. 오탐(감사 기록
  훼손)보다 미탐을 택한 의도적 절충이며 주석에 남겼다.
- **`core/dist` 를 재빌드했다.** E2E 재현·검증에 번들이 필요했다(`bin/harness` → `core/dist/cli.js`).
  이 산출물은 커밋 대상이고 지금 작업트리에는 다른 에이전트의 진행 중 `hook.ts` 변경도 함께
  들어가 있으므로, **오케스트레이터가 최종 통합 후 `npm run build` 를 다시 돌려야 한다.**
