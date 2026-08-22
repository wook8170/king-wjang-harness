# [4] 가치/품질(출하) 감정 — 3.0/5

**점수** 3.0 · **4.8 충족** ✗ (하드 조건 「open BLOCKER 0」이 **ground truth 가 아니다** — 목록 밖에서 아홉 번째 표기 BLOCKER 를 재현했다) · **감정 시각** 2026-08-23 05:2x KST · **대상** HEAD `d8ebde4` (워킹트리 clean, 커밋 `git rev-parse HEAD` = d8ebde40b7c47272014a3e94cae2d8a6943a50af)
**한 줄**: 대장의 산술·판정·버전·저장소 표기는 정직하고 게이트 G1/G2/G8/G10 은 깨끗하게 재측정됐지만, `cp -t`/`install -t`/`--target-directory=` 한 줄로 저널·정책 파일을 덮어 **사람 승인 없이 게이트가 열린다** — 「출하 가능 조건 충족」은 ground truth 에서 거짓이다.

---

## 대장은 정직한가 (재집계 · lint 범위 · 표본 재현)

**재집계 — 헤더와 일치(정직).** 대장 표를 글자접미 ID(`SEC-A`·`UX-A1`·`PROD-B1` 등)까지 포함해 다시 세었다:

| 상태 | 재집계 | 헤더 주장 | progress.md |
|---|---|---|---|
| verified | 229 | 229 | 229 |
| open | 6 (MED 3·LOW 3) | 6 (MED 3·LOW 3) | 6 |
| deferred | 5 | 5 | 5 |
| rejected | 3 | 3 | 3 |
| **합계 행** | **243** | — | 243 |

`open BLOCKER 0 · open HIGH 0` 은 **표 안에서는 사실**이다. open 6건은 `QUAL-197`(MED)·`EFF-209`(MED)·`QUAL-210`(MED)·`PROD-211`(LOW)·`PROD-212`(LOW)·`COST-220`(LOW) 로 전부 LOW/MED. 대장의 **자기 산술은 정직**하다.

- **주의**: 내 첫 정규식 `^\| [A-Z]+-[A-Z0-9]+` 은 `I18N-62`·`I18N-72`(본문이 매우 긴 두 행)를 놓쳐 227 로 셌다. 느슨한 패턴으로 229 확정 — 대장 lint 자신도 과거 이 부류(글자접미 ID)를 놓쳤다가 `QUAL-115`/`QUAL-179` 로 교정한 이력이 있다.

**deferred/rejected 표본 재현 — 회피가 아니라 판정(정직).**
- `SEC-196` (deferred): 「`npm i` 로 받은 다른 사본은 이름·경로가 달라 이름 기반 인식이 못 막는다 — 최종 방어는 호스트 권한 대화상자」. 막을 수 있는 척하지 않는 정직한 한계 기록.
- `COST-178` (deferred): 100% 상태전이 저널 폴백 p95 49.4ms(문턱 50ms 코앞). 「저널은 하네스 명령으로만 늘어 도달 불가」로 문턱 미적용·기록. **스스로 「이 구분 자체를 다음 감정에서 재검증받는다」**([OPS-74]) 라 적음 — 자기인지적.
- `EFF-132` (rejected): 브랜치 push 차단은 과차단이고 `hook-pre-tool.test.ts:217` 이 그렇게 못 박아 둠 → 되돌림. 판정.
- `QUAL-179` (rejected): 감정자 「외부 lint 가 글자접미 ID 39행을 조용히 건너뛴다」 주장이 **재현 실패**(실제 스크립트 `[A-Z]*-[A-Za-z0-9]*` 로 이미 검사) → 반증으로 기각. 정직.

→ 세 부류(deferred 5·rejected 3·open 6) 모두 **회피가 아니라 판정**임을 표본에서 확인.

**정직성 흠집(경미, staleness):**
1. `QUAL-179` 는 대장에서 **rejected** 인데 `00-summary.md` 는 「deferred 5건 … [QUAL-179] 외부 lint 사각」으로 **deferred 로 표기** — 요약과 대장 불일치.
2. `00-summary.md` 최상단 판정 블록은 「**1041** tests green」(라운드 3-I 산문)인데 같은 파일 하단 게이트표는 「**1268** passed ×3」(3-J) — 한 파일 안에서 테스트 수가 어긋난다. 실측 정본은 1268(아래).
3. 요약 G10 은 「gitleaks **177** 커밋」인데 실제 이력은 188 커밋(재측정, 아래).

이 셋은 낡음이지 조작이 아니다 — 그래도 「출하 리포트」가 자기 숫자를 최신으로 못 맞춘 자국이다.

---

## 대장은 완전한가 (목록 밖에서 내가 찾은 것 · 아홉 번째 표기 시도)

**아니다. 아홉 번째 표기를 목록 밖에서 재현했다 — 여섯 라운드 연속 패턴의 일곱 번째다.**

CHANGELOG `[0.1.0]` 은 「같은 급소, 여덟 표기」가 닫혔고 훅이 이제 **「표기를 열거하는 대신 대상 추출의 실패를 탐지」**한다고 적는다. 그러나 `cp`/`install`/`rsync` 계열은 **「목적지 = 마지막 피연산자」** 를 가정한다(`bashwrite.ts:564-577`). GNU coreutils 의 `-t DIR`·`--target-directory=DIR` 는 목적지를 **앞**에 두므로, 추출기는 마지막 **소스**를 목적지로 오인하고 진짜 목적지 디렉토리(`.harness`)는 소스로 취급해 **판정조차 되지 않는다.** 이것은 「추출 실패」가 아니라 **「그럴듯한 오(誤)추출」** 이라, 새로 도입한 실패-탐지 방어가 발화하지 않는다. 게다가 대상이 하나 뽑히면(`events.jsonl`) `scan.targets.length===0` 로 게이트된 안전망(`mentionsPath`·`pathLikeMentions`, `hook.ts:1440·1551`)도 통째로 꺼진다.

`-t`·`--target-directory`·`install` 은 `bashwrite.ts`·`ledger.md`·`00-summary.md`·`CHANGELOG.md` **어디에도 없다**(grep 0건). dist(`core/dist/cli.js`)도 처리하지 않는다 — 커밋된 dist 로 실측했다.

---

## 게이트 재측정

`mktemp` 샌드박스, 커밋된 `core/dist` 로 실측(빌드 미실행).

| 게이트 | 요약표 주장 | 내 재측정 | 판정 |
|---|---|---|---|
| G1 테스트 ×3 | 1268 ×3 · 53파일 | **1268 passed ×3, 53 files** (10.1s) | ✅ 일치 |
| G2 tsc | 0 | `tsc --noEmit` exit 0 | ✅ |
| G8 공급망 | `npm audit --omit=dev` 0 | **found 0 vulnerabilities** | ✅ |
| G10 이력 비밀 | gitleaks 177커밋 0 | **188 commits scanned, no leaks** (수치는 낡음, 결과 동일) | ✅ (수치 stale) |
| G9 훅 지연(폴백 델타 <50ms) | 현실 14.6ms·손상 8/11.6ms | **재측정 불가 — 머신 부하** | ⚠ 미확정 |

**G9 정직 고지**: `npm run bench:hook` 를 두 번 돌렸으나 머신 1분 load 가 **47→33**(10코어)로 계속 높아, 벤치가 스스로 `over — machine busy` 로 **판정을 보류**했다. 두 실행에서 델타가 realistic +17.8ms→+81.8ms, corrupt +106.6ms→+21.0ms 로 **부하에 따라 요동**쳤다 — 이는 열린 `COST-178`·`PROD-211`·`PROD-212`(델타 측정의 부하 민감성·재현 불가 광고 수치)가 지적한 바를 실측으로 확인한 것이다. 벤치가 부하를 **정직하게 표기하고 통과로 위조하지 않는** 점은 강점. 요약표의 G9 절대 수치(14.6ms 등)는 유휴 머신 측정이라 여기서 **확증도 반증도 못 했다**.

R1–R7 lint(대장 칸수·어휘·인용·집계)는 리포 밖 스킬 소관이라 직접 못 돌렸다(progress.md: R1–R13 통과 주장, 재현 불가).

---

## 0.1.0 릴리스 자체에 대한 판정 (버전·CHANGELOG·저장소 표기)

**버전 확정 — 정직.** `0.1.0` 이 모든 표면에 일치:
- `package.json` 0.1.0 · `.claude-plugin/plugin.json` 0.1.0 · `.claude-plugin/marketplace.json` 0.1.0(×2) · README ×4 상태줄 「v0.1.0」.
- **`node bin/harness --version` → `king-wjang-harness v0.1.0`** (커밋된 dist 실측). 라운드 3-I 전·후 배포본이 같은 `v0.0.1` 을 말하던 `PROD-174` 는 실제로 닫혔다.

**저장소/버그 표기 — 정직.** `repository`·`bugs`·`homepage` 모두 `github.com/wook8170/king-wjang-harness`(비공개). README ko/en/ja/zh **4종 모두** 「저장소가 **비공개**다 — 접근 권한이 없으면 받은 경로로 신고하라」고 명시. **없는 공개 트래커를 광고하지 않는다.** (`package.json` 의 `bugs.url` 은 비공개 리포 issues 라 외부인이 열면 404 지만, README 본문이 그 사실을 교정한다 — 허용 가능.)

**CHANGELOG `[0.1.0]` — 대체로 정직하나 접근법 서술은 과장.**
- 「Known limits」가 **「강제는 에이전트-레인 규율이지 보안 경계가 아니다」·「판정은 여전히 not-ready」** 를 명시 — 이 정직성이 감점을 크게 눌러 준다.
- 그러나 「the hook now **detects that target extraction failed** rather than enumerating spellings」는 **과장**이다. `cp -t` 는 추출을 실패시키지 않고 **틀린 대상을 성공적으로 뽑아** 그 탐지를 우회한다. 「부류를 잡았다」는 서술이 이 계열에는 해당하지 않는다.

---

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

### ⛔ BLOCKER (open · 목록 밖) — `cp -t`/`install -t`/`--target-directory=` 로 하네스 소유 파일 덮어쓰기 → 사람 승인 없이 게이트 개통

**뿌리**: `core/src/bashwrite.ts:564-568`(`cp`/`install` case)·`624-628`(`rsync`/`scp`) 는 목적지를 **마지막 피연산자**로 가정한다. GNU `-t DIR`/`--target-directory=DIR` 는 목적지를 앞(또는 플래그 값)에 두므로 마지막 **소스**가 목적지로 오인되고, 진짜 목적지 `.harness` 는 판정되지 않는다. 오추출된 대상이 non-empty 라 `hook.ts:1440·1551` 의 이름 기반 안전망도 꺼진다.

**재현 (커밋된 dist, mktemp 샌드박스, `CLAUDE_PROJECT_DIR` 지정):**
```
# 1) 루트에 위조 저널 작성 — 훅 ALLOW (하네스 소유 경로가 아니다)
echo '{"tool_name":"Bash","tool_input":{"command":"echo x > events.jsonl"}}' | harness hook pre-tool   # → ALLOW
#    (실제 위조: 진짜 저널 복사 + gate-approved 라인 append)
# 2) 저널 덮어쓰기 — 훅 ALLOW
echo '{"tool_name":"Bash","tool_input":{"command":"cp -t .harness events.jsonl"}}' | harness hook pre-tool   # → ALLOW
#    리눅스/GNU 에서 cp -t 는 events.jsonl 을 .harness/ 안으로 복사 = 저널 덮어쓰기
# 3) 상태 반영 — 훅 ALLOW
harness doctor --repair   # repaired:true, ok:true
# 4) 관측: harness gate status → {"P6":{"status":"approved",...}}  ← 사람 승인 0
```
macOS BSD `cp` 는 `-t` 미지원이라 이 머신에선 2)의 파일 효과가 나지 않으나, **훅 판정은 전 플랫폼 ALLOW**(훅은 어느 cp 가 실행될지 모른다). GNU coreutils 로 실제 효과를 재현: `gcp -t .harness events.jsonl` → 저널 3→4줄, `doctor --repair` 후 **P6 approved**; `ginstall -t .harness events.jsonl` → **P3 approved**. 둘 다 끝까지(상태 변화까지) 관측 완료.

**형제 표면(전부 ALLOW, 실측):**
- `install -t .harness config.yaml` → **정책 파일 `config.yaml` 덮어쓰기 = 강제 무장해제**(`SEC-69`/`SEC-136` 급 재발).
- `cp -t .harness/design ledger.yaml`·`cp --target-directory=.harness/design registry.yaml` → 설계 원장/레지스트리 덮어쓰기.
- `cp --target-directory=.harness events.jsonl`(equals 형)·`ginstall -t …`·`cp -t /abs/.harness …` 모두 ALLOW.

**심각도 근거**: 대장이 **BLOCKER** 로 매긴 `SEC-100`(저널 위조→게이트 개통)·`SEC-101`·`SEC-136`(config 덮어→무장해제)과 **정확히 같은 결과**를 한 표기로 낸다. 위협 모델(rubric 개정1: 에이전트 도구 호출이 급소에 도달하는가)에 정면으로 해당 — 사람 터미널이 아니라 **에이전트 Bash 호출**이 훅을 통과한다.

**도달성(정직 고지)**: 파일-복사 단계는 GNU coreutils `cp`/`install` 를 필요로 한다. 리눅스 에이전트 호스트(Codespaces·devcontainer·CI·클라우드 샌드박스 — 다수)의 기본 `cp` 가 이것이다. BSD-only macOS 에선 `cp -t` 가 에러(단 Homebrew coreutils 의 `gcp`/`ginstall` 이 있으면 성립 — 이 머신에도 있다). **훅 구멍 자체는 플랫폼 무관**이고, 익스플로잇 성립만 userland 에 의존한다.

### (참고) 열린 대장 결함 중 이 축 관련 — 전부 재현되나 LOW/MED
`PROD-211`(인프로세스 광고 수치 벤치로 재현 불가, README:118)·`PROD-212`(벤치 부하 PASS 비대칭)·`COST-220`(「비간섭 비용 0」실제 호출당 ~7ms wall) — 위 G9 재측정에서 **부하 민감성으로 실증**됨. 이들은 「출하 표면의 정직성」 흠이지 강제 구멍은 아니다.

---

## 못 잰 것 (정직 고지)

1. **G9 폴백 델타를 유휴 머신에서 못 쟀다.** 감정 내내 머신 load 33~47(10코어). 벤치가 정직하게 판정 보류 → 요약표 절대 수치(14.6ms 등)를 확증·반증 못 함.
2. **빌드 바이트 재현성**(G3/G7 일부)은 환경 규칙(`npm run build` 금지)상 미측정 — 커밋된 dist 로만 실측.
3. **lint R1–R13** 은 리포 밖 스킬 소관이라 직접 실행 불가 — progress.md 의 「통과」주장을 재현 못 함.
4. **`cp -t` 계열의 실제 파일 효과**는 이 macOS 머신의 BSD `cp` 로는 직접 못 냈다 — GNU `gcp`/`ginstall`(리눅스 `cp -t` 동일 시맨틱)로 대리 재현. 훅 판정 ALLOW 는 정확한 문자열로 확인.
5. 명령 계열 전수 퍼징은 안 했다 — `cp/install/rsync/scp` 의 `-t` 를 겨눴을 뿐, 다른 「위치 가정」 구멍이 더 있을 수 있다(형제 표면이 넓은 것으로 보아 개연성 있음).

---

## 점수 산출 근거

- **하드 조건 실패**: rubric 축4 의 4.8 조건은 「open BLOCKER 0(ground truth) · open HIGH 0 · lint R1–R7 · G1–G13 전부 ✅」. 목록 밖에서 **open BLOCKER 1건을 끝까지 재현**했으므로 하드 조건 미충족 → **4.8 불가**. 「v0.1.0 이 처음으로 출하 가능 조건을 충족했다」는 주장은 ground truth 에서 거짓.
- **감점을 누르는 요소(정직성)**: 대장 산술 정직(243행 재집계 일치)·deferred/rejected/open 전부 판정으로 확인·버전 전 표면 일치·비공개 저장소 정직 고지·CHANGELOG 가 「보안 경계 아님·not-ready」를 명시·게이트 G1/G2/G8/G10 깨끗이 재측정·벤치가 부하를 위조 없이 표기.
- **추가 감점(경미)**: 요약 내 테스트 수 불일치(1041 vs 1268)·gitleaks 수치 낡음(177 vs 188)·QUAL-179 상태 요약/대장 불일치·CHANGELOG 의 「추출 실패를 탐지한다」 접근법 과장.
- **종합 3.0/5**: 출하 검증 **장치 자체는 정직하고 품질이 높으나**, 그 장치가 내린 핵심 결론(「출하 가능 조건 충족」)이 **일곱 번째 목록 밖 BLOCKER 로 뒤집힌다**. 하드 게이트 실패가 4.8 을 원천 차단하고, 나머지 정직성이 바닥을 받쳐 3.0. (직전 라운드 이 축: 3-L 3.0 · 3-K 2.5 — 유지.)
