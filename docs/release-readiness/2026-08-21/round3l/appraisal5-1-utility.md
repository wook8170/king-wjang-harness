# [1] 효용성 감정 — 4.6/5

**점수** 4.6 · **4.8 충족** ✗ (두 조건은 measured 로 충족했으나, 필수 검증인 「부류로 닫았다」주장에서 **다섯 번째 표기**로 MEDIUM 결함 1건을 실측 — 잔여 감점이 LOW 이하가 아님) · **감정 시각** 2026-08-23 (KST) · **대상** HEAD `909f8b2e03ef5413d246e01d76cdacf8d6c5f25a`, 브랜치 `feature/core-engine-v0`, `git status --porcelain` = clean
**한 줄**: 광고한 명령은 전부 실재하고 3대 실패 모드가 양방향 E2E 로 막고/되게 함이 실측되나, 「보호 파일을 어떤 표기로든 막는다」는 주장은 **미해결 변수가 보호 *디렉토리* 나 프로파일 파일을 지목할 때** 깨진다(SEC-101/SEC-154 가 닫았다던 자리가 한 표기로 재개통).

---

## 조건별 실측 (rubric 축1 = 4.5 → 4.8 조건)

측정 표면: 모든 CLI/훅 실측은 `mktemp -d` 샌드박스에서, `cd <SB>` + `CLAUDE_PROJECT_DIR=<SB>` 로 커밋된 `core/dist` 실행. 리포 무수정. 훅은 `bin/harness-hook <event>` 에 stdin JSON 주입.

### 조건 A — 「문서·스킬·에이전트가 부르는 명령 MISSING 0」 → **충족 (measured)**
- 내가 만든 명령 목록(아래 「내가 만든 목록」)의 20개 명령군 전부 `--help` exit 0 + 실 설명 출력.
- 문서·스킬·에이전트에서 **백틱으로 실제 호출된** 하위명령을 전수 추출(41종) → 전부 실 구현. 스텁·「not implemented」·「Unknown subcommand」 **0건**.
  - 대표 실측: `report hub`(# Project hub), `report rtm`, `adr decide`(정상 usage), `adr revise`, `design sync`/`design html`(No token file — 정상 전제 오류), `doc submit`, `ship deploy`/`ship verdict`(NO-GO)/`ship checklist`, `gate verify`/`sweep`/`feedback`, `tokens gen/lint/swap`, `loop next/brief`, `node bump`, `backtrack clear`, `migrate`. 전부 실 동작 또는 **행동 가능한** 인자 오류.
  - 「ship track」·「design track」은 명령이 아니라 스킬 description 산문("...of the harness design track — settling the schema...")임을 원문 확인 → MISSING 아님.
  - (주의: 중간에 「Unknown command」가 16건 뜬 배치가 있었으나, `report hub`·`tokens gen` 등 이미 통과한 것까지 균일하게 실패해 **내 테스트 셸의 인자 전개 버그**로 판명 — 명시적 argv 로 재실행 시 전부 정상. 제품 결함 아님.)

### 조건 B — 「3대 실패 모드 대응이 E2E 로 실증」 → **충족 (measured, 양방향)**
스스로 정의한 3대 실패 모드 + 각 과차단 짝을 실측:
| 실패 모드 | 차단(막아준다) | 과차단 짝(되게 해준다) |
|---|---|---|
| ① 설계 트랙 구현 코드 작성 | `Write src/app.ts`@P0 → **DENY**, 사유에 규칙·프로파일·다음 수 명시 | `Write docs/design.md` → **ALLOW(침묵)**, `Write src/app.test.ts`… (아래 결함 1 참조) |
| ② 설계 트랙 배포 명령 | `npm publish`@P0/P7 → **DENY**(어느 트랙이 여는지 안내) | `ls -la` → **ALLOW(침묵)** |
| ③ 미정산 세션 종료 | 활동 후 `Stop` → **block**("harness wave update…" 안내) | `wave update` 정산 후 `Stop` → **ALLOW(침묵)** |
- 셸 우회도 실증: `echo hacked > src/app.ts` → DENY(shell write target). 리다이렉트·tee·sed·cp·mv·python -c 등 자연 경로 다수 DENY.
- 전체 라이프사이클 되게 해준다: init → doc upsert → gate submit → (HARNESS_APPROVE_NO_TTY 로 사람 승인 모사) approve → phase set 을 **P0→P7 까지 완주**, P7 에서 `src/app.ts` Write **ALLOW** 로 전환됨을 실측(설계→구축 크로싱이 실제로 소스를 연다).

### 비간섭 → **충족 (measured)**
- `.harness/` 없는 디렉토리에서 pre-tool/stop/session-start 전부 **exit 0 · 0바이트**(완전 침묵). `bin/harness-hook` 는 `[ -e .harness ]` sh 게이트라 node 를 아예 안 띄움 → wall-time `real 0.00`×5. 「비간섭 시 비용 0」 확인.

### 거부 메시지 행동 가능성 → **충족 (measured)**
- 관측한 모든 deny 가 **그 자리에서 다음 수**를 준다: gate 미승인 → "harness gate submit <P> → 사람 approve", 코어 파일 → "harness status/gate status 로 조회", 정책 파일 → "사용자가 터미널에서 직접 편집", `--force` → "HARNESS_ALLOW_FORCE=1 … 사용자가 직접".

---

## 내가 만든 목록 / 내가 설계한 검사
대장·요약·이전 라운드 보고는 읽지 않음. 축1에서 재야 할 것을 다음으로 스스로 정함:
1. 문서/스킬/에이전트/프로파일이 부르는 명령 전수 추출 → 실행 → 스텁·MISSING 판정.
2. 도구가 내건 3대 실패 모드를 스스로 정의(①설계트랙 소스 ②설계트랙 배포 ③미정산 종료) → 차단·과차단 양방향 E2E.
3. 라이프사이클 완주 가능성(init→P7 크로싱까지 실제로 되게 해주는가).
4. 비간섭·비용 0.
5. 거부 메시지 행동 가능성.
6. **필수**: 「보호 파일을 어떤 표기로든 막는다」주장 재검증 — 다섯 번째 표기 제작.

명령군 20개: init status doctor phase gate wave node trace report doc adr design tokens evidence loop ship profile usage backtrack migrate.

---

## 반대 방향 (과차단) 측정
- 정상 작업이 걸리지 않음을 실측: `docs/*.md` Write ALLOW, `ls`·`cat` 계열 ALLOW, 정산 후 Stop 침묵, 구축 트랙 진입 후 소스 Write ALLOW.
- **의도된 과차단(설계상 트레이드오프)**: `test/helpers.ts`(이름이 테스트 아님) 는 소스 트리 안이면 DENY — 코드 주석이 「이름을 규칙에 맞추면 통과」라고 사유에 적어 행동 가능. 이건 결함이 아니라 문서화된 선택.
- **과차단 결함 1건 발견**: 거부 *문구* 가 실제 판정과 어긋남 → 아래 결함 2.

---

## 「부류로 닫았다」주장 검증  ★ 이번 라운드 핵심

**주장(3-K)**: 「표기를 세는 대신 『이 대상이 보호 파일을 *어떤 표기로든* 지목하는가』로 묻는다.」 관련 코드 `bashwrite.ts`(가상 cwd 정규화·동적값 미해결 처리)·`hook.ts`(글롭 역매치·이름 기반 net).

### 코드 구조 파악 (inferred, 독해)
보호 대상 판정은 두 길로 갈린다:
- **해결 가능한 표기**(리터럴·`cd` 리터럴·글롭·`..`): `judgeWritePath()` 한 벌로 모여 `coversPath`(디렉토리 커버) + `POLICY_PREFIXES` + `protectedByGlob` 로 판정 → 이건 **진짜 부류**다. 리터럴/글롭/`cd .harness/profile` 전부 동일 규칙으로 DENY 됨을 실측.
- **해결 불가능한 표기**(변수·치환): 경로를 못 읽으니 `judgeWritePath` 가 무력 → **이름 기반 폴백 net** `OWNED_BASENAMES` 로 떨어진다. 그런데 `OWNED_BASENAMES = CORE_FILES.map(basename)` 이고 `CORE_FILES = STATE_FILES + POLICY_FILES` 다 — 즉 **`.harness/profile/` (POLICY_PREFIXES) 와 `.harness` 디렉토리 이름 자체가 이 집합에 없다.**

### 다섯 번째 표기 (measured) — 「미해결 변수가 보호 *디렉토리* / 프로파일 파일을 지목」
지난 네 표기(리터럴→`cd`접두→글롭→`$D/파일`)는 전부 **CORE_FILE 의 basename** 을 남겨 이름 net 이 잡았다. 다섯 번째는 **basename 이 CORE_FILE 이 아닌** 대상을 변수로 지목한다:

```
# 대조군 — 같은 표기, CORE_FILE (basename ∈ OWNED_BASENAMES)
P=.harness; echo x >> $P/events.jsonl     → DENY (이름 net: 'events.jsonl')
P=.harness; rm -f $P/events.jsonl          → DENY
P=.harness; echo x > $P/config.yaml        → DENY

# 다섯 번째 표기 — 같은 미해결 변수, 대상 basename 이 집합 밖
P=.harness; rm -rf $P                       → **ALLOW** (하네스 스토어 전체 삭제)
P=.harness; mv /tmp/evil $P                 → **ALLOW** (하네스 스토어 전체 교체)
P=.harness; S=profile; echo "deploy_commands: []" > $P/$S/commands.yaml
                                            → **ALLOW** (프로파일=정책 파일 위조)
a=har; b=ness; echo x > .${a}${b}/profile/commands.yaml → **ALLOW**
```
대조군은 전부 DENY, 다섯 번째는 전부 ALLOW — **표기가 아니라 대상 basename 이 CORE_FILES 목록에 있느냐로 갈린다.** 즉 이건 부류가 아니라 **여전히 목록(basename 목록)을 세고 있는 것**이고, 그 목록이 보호 「부류」의 **진부분집합**이다.

### 「어떤 표기로든」이 성립하려면 참이어야 하는 전제 → 깨졌다
전제: *해결 불가능 표기의 폴백 이름 net 이 보호 **부류 전체**의 basename 을 담아야 한다.* 실제로는 `CORE_FILES` 만 담아 (a) `.harness` 디렉토리명 (b) `POLICY_PREFIXES` 하위(`commands.yaml`·`profile.yaml`·`raw-values.yaml`)를 누락. 해결 가능 경로의 `judgeWritePath` 는 `coversPath`+`POLICY_PREFIXES` 로 부류 전체를 덮는데, **폴백만 부류보다 좁게** 잡혔다. 이것이 다섯 라운드째 같은 자리가 뚫린 것과 **정확히 같은 형태**(느슨한 쪽이 정본).

### 과차단 쪽(부류로 막을 때의 짝)
`OWNED_BASENAMES` 에 `.harness` 나 프로파일 basename 을 추가하면 과차단이 늘 수 있다(예: 무관한 `commands.yaml` 을 가진 타 프로젝트 파일). 다만 폴백 net 은 이미 `mutating` AND 조건이라 조회는 안 걸리고, 대상이 「미해결 변수 + 하네스 소유 이름」인 경우로 좁아 과차단 증가는 제한적 — 즉 부류를 제대로 덮어도 과차단 폭발은 없다(수정이 안전한 방향).

---

## 찾은 결함

### 결함 1 — [MEDIUM] 미해결 변수로 지목한 보호 *디렉토리* 는 폴백 net 을 빠져나간다 (SEC-101 재개통)
- **재현**(측정 표면: 인프로세스 훅 판정, `bin/harness-hook pre-tool`):
  - `{"tool_name":"Bash","tool_input":{"command":"P=.harness; rm -rf $P"}}` → **ALLOW(침묵)**. 리터럴 `rm -rf .harness` 는 DENY, `mv .harness /tmp/x`(SEC-101 이 닫았다는 것)도 DENY.
  - `P=.harness; mv /tmp/evil $P` → **ALLOW**. 스토어 전체를 교체/삭제해 이후 모든 훅이 침묵(비간섭)으로 떨어져 **강제가 통째로 꺼진다.**
- **원인**(inferred): `hook.ts:192` `OWNED_BASENAMES = new Set(CORE_FILES.map(f => basename))`; `bashwrite.ts` 말미 루프가 명령 대상을 `resolveIn` 에 넣어 `$` 포함 시 `unresolvedTargets` 로 올림 → `hook.ts:1305` `blind = unresolvedTargets.find(t => OWNED_BASENAMES.has(basename(t)))`. `$P` 의 basename `'$P'` 은 집합 밖이라 통과. `.harness` 디렉토리명이 `OWNED_BASENAMES` 에도 `coversPath` 도달 경로에도 없음.
- **파일:줄**: `core/src/hook.ts:180`(CORE_FILES), `:192`(OWNED_BASENAMES), `:1305`(blind net); `core/src/bashwrite.ts:711-715`(미해결 승격).
- **경중 근거**: SEC-101 이 「`rm -rf .harness` 는 막는데 `mv .harness` 는 통과했다」를 명시적으로 닫았다고 코드 주석에 적음 — 그 계약이 한 표기로 재개통. 단, 제품 자칭 계약이 「보안 경계가 아니라 사고 방지」이고, `P=.harness; rm -rf $P` 는 사고로 나오기 어려운 적대적 구성이며, 스토어 삭제는 은밀하지 않은 blunt 행위 → HIGH 아닌 MEDIUM.

### 결함 2 — [LOW] 미해결 변수로 지목한 프로파일(정책) 파일이 폴백 net 을 빠져나간다 (SEC-154/SEC-69 부분 재개통)
- **재현**: `P=.harness; S=profile; echo "deploy_commands: []" > $P/$S/commands.yaml` → **ALLOW**. 리터럴 `.harness/profile/commands.yaml`·`cd .harness/profile && …`·글롭·`$D/commands.yaml`(D 에 리터럴 포함) 은 전부 DENY.
- **원인**(inferred): 위와 동일 — `OWNED_BASENAMES`/`mentionsPath(CORE_FILES)` 에 `POLICY_PREFIXES` 부재. `judgeWritePath` 는 프로파일을 덮지만 미해결 변수는 거기 도달 못 함.
- **파일:줄**: `core/src/hook.ts:180`,`:192`,`:1316`(mentionsPath), `:988-991`(judgeWritePath 의 POLICY_PREFIXES 처리는 해결 경로 전용).
- **경중 근거 = LOW (measured 방어심층)**: 프로파일 위조가 성공해도 실 disarm 이 안 됨 —
  - `src/app.ts` 여전히 DENY(`SOURCE_EXTS` 확장자 백스톱, 프로파일 무관).
  - `npm publish` 여전히 DENY(`config.design_blocked_bash` 를 프로파일보다 **먼저** 검사).
  - 빈 `source_globs`/`deploy_commands` 는 generic floor 로 메워짐(profile.ts:296-299).
  - **`harness doctor` 가 정책 드리프트를 탐지**: "the policy files differ from the pinned baseline … [added: .harness/profile/commands.yaml, profile.yaml] … re-pin needs HARNESS_ACCEPT_POLICY=1"(실측). → 위조가 사후 관측됨.

### 결함 3 — [LOW/과차단] 설계 트랙 소스 거부 문구가 실제 판정과 어긋난다
- **재현**: `Write src/app.test.ts`@P0 → **DENY**. 그런데 같은 응답의 사유는 "Writable: … files **named** as tests (`*.test.*`, …)" 라고 적어 **바로 그 이름의 파일이 허용이라고 말한다.**
- **원인**(inferred): 판정 순서가 `source_globs`(src/**) 먼저 → 테스트 예외 나중이라, src 안의 `*.test.ts` 는 규칙상 DENY 가 맞다(코드 주석 hook.ts:357-371 이 의도라 밝힘). 그러나 **거부 문구에 그 우선순위 단서가 없어** 「테스트 이름이면 쓸 수 있다」는 문장이 이 경우 거짓이 된다.
- **파일:줄**: `core/src/hook.ts:1089-1095`(사유 문구), `:376`(looksLikeTestPath), 순서 계약은 `:371`.
- **경중**: LOW. 사람이 「이름을 test 로 바꿨는데 왜 막히나」로 오독 가능(문구가 엉뚱한 곳을 가리킴). SessionStart 안내문(:1091 부근)에는 "the profile's source paths win over all of these" 라는 우선순위 단서가 있으나 **거부 사유 문구에는 빠져** 두 표면이 불일치.

---

## 못 잰 것 (정직 고지)
- **MCP 표면(16 tools)의 효용**: `mcp/server.js` 를 stdin JSON-RPC 로 구동해 보지 않음 — CLI 우회 경로가 CLI 와 동치인지 미검. (README 는 동치라 주장.)
- **Claude Design 네트워크 연동**: README 가 「network pull 미구현」이라 자인 — 광고-실재 불일치는 상품성(축7) 소관이라 여기선 미측.
- **실 파일시스템 실행 결과**: 훅 판정(ALLOW/DENY)만 실측했고, ALLOW 판정 뒤 실제 `rm -rf $P` 를 **집행하진 않음**(스토어를 실제로 지우지 않기 위해). ALLOW=집행 허용은 자명하나 부작용 자체는 미집행.
- **크로스 머신/`/clear` 핸드오프 효용**: 저널→상태 재생은 `doctor` 로만 간접 확인, 실제 머신 이동 시나리오 미재현.
- **결함 1 의 「모델이 자연히 가는가」**: 변수 난독화가 실제 세션에서 얼마나 발생하는지는 정성 판단(사고보다는 적대). 빈도 미측정.
- **인프로세스 vs 프로세스 wall-time**: 축1에선 비간섭 wall-time(sh 게이트 `real 0.00`)만 재고, 판정 지연 p95 는 축5 소관이라 미측.

---

## 점수 산출 근거
- 4.8 조건 두 개(**MISSING 0**, **3대 실패 모드 E2E**) 전부 **measured 충족**, 비간섭·라이프사이클 완주·행동가능 거부까지 확인 → 기본선은 4.5보다 위.
- 그러나 이번 라운드 **필수** 검증에서 다섯 번째 표기로 **MEDIUM 1건(결함1, SEC-101 재개통)** + LOW 2건 실측. rubric 의 4.8 = 「조건 전건 + 잔여 감점 LOW 이하」인데 잔여에 MEDIUM 이 있어 **4.8 미달**.
- 결함 1 은 제품 자칭 「사고 방지」 계약상 적대적·blunt 여서 HIGH 로 올리지 않고, 결함 2 는 방어심층+doctor 탐지로 LOW 로 눌림 → 감점 폭이 크지 않음.
- 종합: 광고한 효용은 광범한 자연 표기에서 실제로 막고/되게 해줌이 실측되나, 「어떤 표기로든」의 부류 주장은 폴백 net 이 부류의 진부분집합이라 다섯 번째 표기에서 깨짐 → **4.6**.
