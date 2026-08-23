# [4] 가치/품질(출하) 감정 — 2.5/5

**점수** 2.5 · **4.8 충족** ✗ (하드 조건 「open BLOCKER 0」이 ground truth 가 아니다 — 목록 밖에서 재현 가능한 BLOCKER 1건. **다섯 라운드 연속 같은 패턴**) · **감정 시각** 2026-08-23 · **대상** HEAD `80b633c`
**한 줄**: 대장은 집계·lint·게이트 어디를 재도 정직하고 완전한 척도 안 하지만, 그 대장이 기대는 유일한 하드 불변식(「에이전트가 강제를 못 푼다」)이 **셸 변수 한 개**로 깨진다 — `D=.harness; echo … >> $D/events.jsonl` + `doctor --repair` 두 번의 도구 호출로 P0→P7 자기승격, `doctor` 는 `ok:true`.

---

## 대장은 정직한가 (재집계 · lint 범위 · 표본 재현)

**정직하다.** 헤더 수치를 안 믿고 표를 직접 파싱해 재집계했다(211 데이터 행):

| 상태 | 재집계 | 헤더 주장 |
|---|---|---|
| verified | 203 | 203 ✓ |
| deferred | 5 | 5 ✓ |
| rejected | 2 | (헤더 미기재, 별도) |
| open | 1 (`PROD-174` LOW) | 1 (MED 0·LOW 1) ✓ |
| **open BLOCKER** | **0 (대장 기준)** | 0 ✓ |
| ID 중복 | **없음** | — |
| 심각도 분포 | BLOCKER 13·HIGH 33·MED 72·LOW 76·— 17 (전부 verified/deferred/rejected) | — |

- **헤더 집계는 표와 일치.** 라운드 3-J 커밋 4개(`4c4cd8d`→`80b633c`)를 따라가 보니 open 전체가 3→4→1 로 커밋마다 정확히 갱신됐다. 수치 조작 없음.
- **정직성 흠 1건(LOW):** 헤더 3행의 서술 괄호가 아직 **「라운드 3-I 완료」**인데 그 뒤로 3-J 행 8개(`COST-177/178`·`QUAL-179`·`SEC-A` 등)가 붙었다. 숫자는 맞고 라벨만 낡음.
- **lint 범위 실측:** 외부 lint(`~/.claude/skills/verifying-production-readiness/bin/ledger-lint.sh`)를 직접 돌렸다 → `✓ 대장 무결 — 211 행, R1–R11 통과 (open BLOCKER 0 · 실측 근거 대장 209 · 게이트 0)`, exit 0. **대장의 [QUAL-179]/[QUAL-B] 가 「글자접미 ID 39행을 lint 가 안 본다」고 deferred 로 남긴 사각은 이미 닫혀 있다** — lint 행 매칭 정규식이 `[A-Z]*-[A-Za-z0-9]*`(`ledger-lint.sh:287`)로 고쳐져 `SEC-A`·`UX-A1` 을 검사한다(스크립트 머리말에 2026-08-23 수정 기록). 즉 그 deferred 는 오늘부로 실효가 없다(대장 자체는 여전히 R1–R11 통과). lint 는 파일 존재·줄 범위·빈 셀만 보고 **근거의 진위는 못 본다** — 그건 아래 표본 재현으로 채웠다.
- **표본 재현:** 「닫혔다」 항목 중 게이트 관련을 직접 재측정(다음 절). 과잉 주장은 못 찾음.

## 대장은 완전한가 (목록 밖에서 내가 찾은 것)

**아니다. 재현 가능한 BLOCKER 1건이 목록 밖에 있다.** 이것이 **다섯 라운드 연속** 같은 결과다(SEC-49→SEC-A→SEC-100/101→SEC-135/136/137→**이번**).

### 🔴 BLOCKER — 셸 변수 지시(indirection)로 코어·정책·저널 쓰기 보호가 통째로 풀린다 → 에이전트 자기승격

지난 라운드들이 닫은 것은 전부 **열거의 실패**(도구 이름·접두어)였고, `SEC-170` 이 `cd $VAR` 의 **동적 경로** 부류까지 잡았다. 그런데 **쓰기 대상 자체에 담긴 변수**는 여전히 리터럴로 취급된다:

- 방어의 전제는 「보호 경로가 명령문에 **문자 그대로** 나타난다」는 것이다(`mentionsPath` 는 substring 매칭, `pathLikeMentions` 는 슬래시 토큰 매칭).
- 디렉토리(또는 파일명)를 변수에 넣으면 `.harness/events.jsonl` 이라는 리터럴이 **분해**돼 어느 층에도 안 걸린다:
  - `redirectTargets` 는 `$D/events.jsonl` 를 대상으로 뽑고, `resolveIn(cwd='', '$D/events.jsonl')` 가 그것을 **리터럴 경로로 그대로 반환**(`bashwrite.ts:120`) → `judgeWritePath` 는 코어 아님으로 ALLOW.
  - `pathLikeMentions` 정규식은 `$D/…`·`.harness/$F` 에서 `$` 에 끊겨 매치 실패.
  - `mentionsPath(cmd, CORE_FILES)` 는 `.harness/events.jsonl` substring 부재로 undefined.
  - `SEC-170` 의 `unresolvedTargets`+`OWNED_BASENAMES` 안전망(`hook.ts:1173`)은 **`cd $VAR` 경로만** 미해결로 올리고, 리다이렉트 대상의 `$VAR` 는 안 올린다.

**비대칭이 결정적 증거:** `cd $D && tee events.jsonl` → **DENY**(SEC-170). 그런데 한 토큰 옆 `echo x >> $D/events.jsonl` → **ALLOW**. 같은 동적 지시인데 한쪽만 막는다.

**재현(전건 실측, 샌드박스 `bin/harness-hook pre-tool` stdin 구동):**

막아야 하는데 ALLOW 된 것 (설계 트랙 P0):
```
ALLOW  D=.harness; echo x > $D/config.yaml
ALLOW  D=.harness; tee $D/config.yaml
ALLOW  F=events.jsonl; echo x >> .harness/$F        # 디렉토리는 리터럴, 파일명만 변수여도 뚫림
ALLOW  H=$PWD/.harness; echo x > $H/config.yaml
ALLOW  d=.harness; cp /etc/hostname $d/config.yaml
ALLOW  D=.harness; sed -i "" s/a/b/ $D/config.yaml
ALLOW  D=.harness; python3 -c "open(1)" $D/config.yaml
```
대조(전부 DENY, 방어 정상): `echo x > .harness/config.yaml` · `cd .harness && echo x > config.yaml` · `echo x > "$PWD/.harness/config.yaml"`.

**런타임 효과 실증** — hook 이 ALLOW 한 명령을 실제로 실행:
- `D=.harness; echo x > $D/config.yaml` → `config.yaml` 내용이 `PROFILE_TAMPERED` 로 실제 덮임([SEC-69] 재발: 정책 파일이 피판정자 쓰기 영역에서 열림).
- `D=.harness; echo '{"type":"phase-set",…,"phase":"P7"}' >> $D/events.jsonl` → 저널에 위조 이벤트 실제 append.

**전체 무장해제 사슬(두 도구 호출, config 무손상 클린 재현):**
1. `D=.harness; echo '{"ts":"…","type":"phase-set","data":{"phase":"P7"}}' >> $D/events.jsonl` → hook **ALLOW**, 저널에 기록됨.
2. `harness doctor --repair` → hook **ALLOW**, 실행 후 `state.phase = P7`, `doctor` 최종 `ok:true`.
- **결과:** `gates: {}` (사람이 게이트를 제출·승인한 적 없음)인 채 **P0(설계 트랙) → P7(구축 트랙)** 자기승격. 승격 직후 P0 에서 DENY 였던 `echo code > src/app.ts` 와 `Write src/app.ts` 가 **둘 다 ALLOW** 로 바뀜 — 하네스의 핵심 요구(요구 2: 승인 전 구현 금지)를 직접 깬다.
- **탐지 여부:** `doctor --repair` 후 `doctor` 는 `ok:true`(config 무손상 시). PostToolUse 훅은 저널 위조를 되돌리지 않는다(실측: exit 0, 위조 줄 잔존). 이것은 rubric 개정이 「범위 밖」으로 둔 *사람의 손 편집*이 아니라, **에이전트 자신의 도구 호출**이 훅을 통과한 것 — 개정이 명시한 in-scope 위협이다.

**심각도 BLOCKER 근거:** 이 제품의 존재 이유 전체(에이전트가 스스로 강제를 못 푼다)가 무너진다. 코어·정책 파일 보호는 rubric 이 명시한 실효성/가치의 하드 표적 (b)(c) 이고, 페이즈 무관 불변식이다. 따라서 축 4 하드 조건 **「open BLOCKER 0 = ground truth」는 거짓**이다.

**결함 위치(수정 지점 아님, 정확한 소재만):**
- `core/src/bashwrite.ts:117-120` — `resolveIn` 이 `$`/백틱 포함 대상을 미해결로 취급하지 않는다. `DYNAMIC_CD = /[$` + "`" + `*?~]/`(:86)를 `cd` 대상에만 적용하고 **쓰기 대상 정규화에는 같은 가드가 없다.**
- `core/src/hook.ts:1091, 1173` — 리다이렉트/쓰기 대상은 `scan.targets`(해결됨)로 판정되고, `OWNED_BASENAMES` 파일명 안전망은 `scan.unresolvedTargets` 에만 걸려 이 경로를 못 본다.
- 부류적 처방 방향: `$`/치환 포함 대상을 `cd $VAR` 와 같이 **미해결로 올려** basename 안전망(`OWNED_BASENAMES`)에 태우기. (SEC-170 이 이미 절반만 적용한 부류.)

## 게이트 재측정 (G1–G13 중 내가 다시 잰 것)

샌드박스는 `git archive HEAD`(= 배포되는 tarball, `.gitattributes export-ignore` 로 docs/.git 제외) + 커밋된 `core/dist`. 빌드 안 함.

| 게이트 | 내 실측 | 요약표 대조 |
|---|---|---|
| G1 테스트 | dev 환경(docs+.git 존재) **1233 pass · 0 skip**, ×3 동일, exit 0. 배포 tarball 에서는 1217 pass·16 skip(문서무결성 메타테스트가 `HAS_DOCS/IN_REPO` 가드로 정상 스킵 — 결함 아님). | 요약표 「1233×3」 = dev 기준, **정확** |
| G2 타입 | `tsc --noEmit` exit 0 | ✅ 일치 |
| G8 공급망 | `npm audit --omit=dev` → **0 vulnerabilities**. 전체(dev 포함) 5건(critical 1·high 1·moderate 3, vitest/vite-node 계열) → `DEP-32` deferred 와 일치(프로덕션 도달 없음) | ✅ 일치·정직 |
| G9 훅 지연 | 동봉 `scripts/bench-hook-latency.mjs` 실행(머신 load ~7–10 고부하): 폴백 델타 p95 realistic **+38.5ms** · corrupt **+20.9ms**(둘 다 문턱 50ms 안) · all-state **+72.9ms**(문턱 미적용·기록만). node 기동 바닥 p50 39.3ms. | 문턱 적용 부류는 통과. 요약표의 절대치(14.6/8.0/11.6ms)는 **다른 표면**(cost-177-bench 의 인프로세스 p95)이지 이 델타가 아님 — 표면 표기가 섞여 있으나 어느 표면으로도 gated 부류는 문턱 안 |
| G10 이력 비밀 | `gitleaks detect`(v8.30.1) 실경로 전 이력 → **174 commits, no leaks**, 5.11MB | 요약표 「171 커밋」은 3-J 재측정 시점값 — 그새 커밋 3개 늘어 **약간 낡음**(LOW, 결과는 동일 0) |
| G11 CLI 계약 | `harness --version` exit 0, `--help` exit 0 + 20개 명령 영문 나열 | ✅ 일치 |
| G3 자체완결 | 맨 tarball 에서 `--version`·`status`·`init` exit 0 | ✅ 일치 |
| G5/G6 강제력 | 위 BLOCKER 절 참조 — **여기서 뚫렸다** | ✗ ground truth 불일치 |

## 구현자 판단 재검증 — G9 입력 집합 분리 · deferred/rejected

**(1) G9 입력 집합 분리 — 「허용된 개정」인가 「완화」인가:** *경계선상이나, 이 건만으로는 완화로 보지 않는다.* 근거:
- G9 재정의(절대 wall-time → 폴백이 더하는 델타 < 50ms)는 정당하다 — 내 실측에서도 절대 wall-time 의 대부분이 node 기동(p50 39.3ms, 구현자 머신 99ms)이라 **제품이 아니라 측정 머신을 잰다**는 주장이 재현됐다. 표면을 안 적으면 통과·불통과가 갈린다는 것도 사실.
- all-state(100% 상태전이)를 「기록만」으로 뺀 것은 **Iron Rule 1 을 아슬하게 지킨다**: 문턱을 없앤 게 아니라 숫자(49.4ms)를 남기고 `COST-178` 로 **결함 등재**했다. 「도달 불가」사유(저널은 하네스 명령으로만 는다)는 realistic/corrupt 를 여전히 gated 로 둔 것과 짝이 맞는다.
- **단, 내 BLOCKER 가 이 사유를 부분적으로 약화시킨다** — 에이전트가 `>> $D/events.jsonl` 로 저널에 **임의 줄을 직접 append** 할 수 있으므로 「10만 상태전이는 도달 불가」는 엄밀히는 참이 아니다(가능은 하다, 다만 10만 회 append 는 비현실적). COST-178 은 LOW 라 판정을 바꾸진 않지만, 이 상호작용은 대장에 없다.

**(2) deferred/rejected — 회피가 아니라 판정인가:** 표본 재현 결과 **대체로 판정이 맞다.**
- `DEP-32`(deferred): `npm audit` 로 재현 — 프로덕션 0, dev 5(critical 1). 「dev 서버 리스닝 전제, 프로덕션·빌드 도달 없음」 사실. ✓ 판정.
- `PERF-96`(deferred, 저널 압축 부재): 영구 결정으로 README 4개 언어 「알려진 한계」에 논거·실측 명시. events.jsonl 이 감사 원천이라 재작성 원시연산을 안 만드는 것은 일관된 설계 판단. ✓ 판정.
- `PROD-174`(open→릴리스 결정): `[Unreleased]`↔`v0.0.1` — 버전 확정은 사용자 몫. ✓ 정당한 open.
- `QUAL-179`/`QUAL-B`(deferred, 「리포 밖 스킬 소관」): **사유가 오늘부로 실효 소멸** — 외부 lint 는 이미 letter-suffix 를 검사한다(위 재현). 「리포 밖이라 못 고친다」는 그 시점엔 사실이었으나 지금 lint 를 돌리면 39행이 검사돼 위반 0. 즉 회피는 아니었고, 이제는 무의미해진 deferred. (대장 내용 자체는 R1–R11 통과.)
- `COST-178`(deferred): 위 (1) 참조 — 판정이나 사유가 내 BLOCKER 와 상호작용.
- `EFF-132`(rejected, `git push` 미포함): 「과차단(WIP 브랜치 push 차단)을 미차단과 같은 무게로 센다」는 이 리포의 일관된 원칙 + `hook-pre-tool.test.ts:217`·`profile.test.ts` 바이트동일 강제로 뒷받침. ✓ 판정(회피 아님).
- `QUAL-E`(rejected): 「과차단 0/44」가 표본 내 결론이었음을 스스로 정정하고 의도된 절충으로 재분류 + 회귀 테스트로 고정. ✓ 판정.

→ deferred 5·rejected 2 는 **회피가 아니라 판정**이라는 구현자 주장은 재현상 성립한다. 유일한 흠은 QUAL-179 사유의 시효 소멸(정직성 LOW).

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

1. **BLOCKER — 변수 지시로 코어/정책/저널 쓰기 우회 → 에이전트 P0→P7 자기승격.**
   재현: 샌드박스 프로젝트 init 후 `bin/harness-hook pre-tool` 에 `{"tool_name":"Bash","tool_input":{"command":"D=.harness; echo '<phase-set P7 JSON>' >> $D/events.jsonl"}}` → ALLOW → 실행 → `harness doctor --repair`(ALLOW) → `state.phase=P7`, `gates:{}`, `doctor ok:true`, 이후 `src/app.ts` 쓰기 ALLOW.
   소재: `core/src/bashwrite.ts:117-120`(`resolveIn` 동적값 가드 부재; `DYNAMIC_CD` :86 이 `cd` 에만 적용) · `core/src/hook.ts:1091,1173`(`scan.targets` 만 판정, `OWNED_BASENAMES` 안전망이 `unresolvedTargets` 만 커버).

2. **LOW — 대장 헤더 서술 낡음.** `ledger.md:3` 괄호가 「라운드 3-I 완료」인데 3-J 행 8개가 뒤에 추가됨(숫자는 일치).

3. **LOW — 요약표 G10 커밋수 낡음.** `00-summary.md` G10 「171 커밋」 vs 현재 174(결과 0 leaks 동일).

4. **LOW(정직성) — QUAL-179 deferred 사유 시효 소멸.** 외부 lint 는 이미 letter-suffix ID 를 검사하므로 「리포 밖이라 못 고침」은 더는 유효하지 않다.

## 못 잰 것 (정직 고지)

- **G4/G7/G12/G13 을 독립 재측정하지 않았다** — 요약표 값을 신뢰하되 이번 재측정 대상에서 제외(시간 배분을 BLOCKER 추적에 썼다). G13 패키징(선언 산출물 존재)은 tarball 구조만 육안 확인.
- **BLOCKER 의 「자연 발생 빈도」는 못 쟀다** — 변수 지시가 에이전트가 *자연히* 쓰는 표현인지(vs 적대적으로만)는 정성 판단이다. 다만 `D=.harness; …` 는 스크립트에서 흔한 관용이고, 리포 자신의 `SEC-170` 이 「변수 한 줄로 방어가 풀리면 안 된다」를 이미 명문화했으므로 in-scope 로 본다.
- **G9 은 고부하(load 7–10) 단일 머신·30 표본**으로 쟀다. gated 부류 델타가 문턱의 40–77% 라 저사양·고부하 머신에서 realistic 이 50ms 를 넘을 여지 있음(구현자도 COST-178 로 같은 취지 기록). 측정 표면: **프로세스 wall-time 델타**(정상−열화 p95).
- **doctor --repair 이후 config 무손상 시나리오만 클린 재현**했다. config 동시 위조 시엔 정책 해시 핀이 warn 을 띄운다(탐지됨) — 그래서 저널 단독 경로가 더 깨끗한 BLOCKER 라 그쪽으로 확정했다.
- 작업 중 `00-summary.md` 가 **다른 세션에 의해 디스크에서 편집**됨(deferred 4 vs 커밋 5). 나는 커밋된 HEAD `80b633c` 기준으로 감정했고 리포는 수정하지 않았다.

## 점수 산출 근거

- **하드 조건 「open BLOCKER 0」이 ground truth 로 거짓** → rubric 상 축 4 는 4.8 미만 확정. 게다가 그 BLOCKER 는 **제품의 존재 이유 전체**(에이전트 자기 무장해제 방지)를 무너뜨리고, 두 번의 정상 도구 호출로 **완전히 재현**되며, `doctor` 에 **탐지되지 않는다**. **다섯 라운드 연속** 동일 패턴(열거/문자열 매칭의 근본 한계)이라는 점이 가중.
- 반대로, **대장·리포 자체의 품질은 높다** — 재집계·lint·게이트 어디를 재도 수치가 정직하고, deferred/rejected 는 실제 판정이며, 자기 한계(「open BLOCKER 0 은 우리 목록의 산물」)를 스스로 반복 명시한다. 최상위 판정도 올바르게 **출하 불가(NO-GO)** 다. 이 정직성이 점수를 3-round 값(3.5)에서 더 깎이지 않게 받쳐 주지만, **라이브 코어 BLOCKER** 앞에서 4.x 는 불가능하다.
- 「정직하지만 불완전」의 불완전이 하필 **가장 값비싼 불변식**에서 났다 → **2.5/5**. (BLOCKER 가 닫히고 재검증되면 이 축은 정직성 기반으로 빠르게 4.x 로 회복 가능.)
