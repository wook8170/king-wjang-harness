# [4] 품질(출하) 감정 — 3.0/5

**점수** 3.0 · **4.8 충족** ✗ — 하드 조건 「open BLOCKER 0(ground truth)」이 **거짓**이다. 직전 라운드(3-M) 가치 축이 스스로 찾아 3.0 을 매긴 `cp -t`/`install -t`/`--target-directory=` BLOCKER 가 **이 HEAD 에서 그대로 재현**됐고, 대장·테스트·`progress.md` 어디에도 없다. · **감정 시각** 2026-08-23 12:2x KST · **대상 HEAD** `a08ec18` (코드 정본; 감정 중 자동 핸드오프가 `progress.md`만 바꾼 `6091a30` 을 커밋했으나 **코드 트리·dist 는 `a08ec18` 과 바이트 동일** — 마감 확인 참조).

**한 줄**: 게이트 13개는 개별로 재면 거의 다 초록이고 닫힌 행 표본 10건은 전부 참이며 lint·버전·저장소·CHANGELOG 는 정직하다 — 그러나 그 **초록 자체가 요점을 비껴간다**: 「잔여 전건 소진 · open BLOCKER 0」이라 선언한 라운드가 **자기 가치 축이 지난 라운드 찾아 놓은 BLOCKER 를 등재하지 않고 떨어뜨렸고**, 한 줄(`cp -t .harness events.jsonl`)로 사람 승인 없이 게이트가 approved 가 된다.

---

## 게이트 G1–G13 재측정

`mktemp` 샌드박스 + `git archive` 사본에 `npm install`(리포 미오염), 커밋된 `core/dist` 로 실측.

| 게이트 | 정의된 판정법 | 내가 실제로 돌린 것 | 관측 | 판정 |
|---|---|---|---|---|
| G1 테스트 | 전건 pass·fail 0·skip 0·3회 동일 | 사본에서 `npx vitest run` ×3 | **1268 passed · 16 skipped · 52 files+1 skipped ×3 완전 동일** | ✅* |
| G2 타입 | `tsc --noEmit` exit 0 | 사본에서 `npx tsc --noEmit` | exit 0 | ✅ |
| G3 빌드·자체완결 | node_modules 없는 맨 클론 `--version`·`init`·`status` exit 0 | `git archive HEAD`→`rm -rf node_modules`→bin/harness | `--version`=v0.1.0·init·status·doctor·hook **전부 exit 0** | ✅ |
| G4 훅 무해 | 4이벤트×{미초기화,깨진JSON,빈,미지} 전부 exit 0·미초기화 stdout 0바이트 | stdin 16조합 구동 | **16/16 exit 0 · 전부 0바이트** | ✅ |
| G5 훅 강제력 | 소스쓰기·코어·경로우회·배포 Bash deny·과차단 0 | pre-tool 판정 매트릭스 | `echo>src/app.ts`·`Edit .harness/state.json`·`sed -i config.yaml`·`phase set --force`·`npm publish`·`docker push` **DENY**; docs 쓰기·`sed -n`·`cat` **ALLOW** | ✅ |
| G6 🔴 안전 속성 | MCP approve 후 게이트 상태 불변 | `mcp/server.js` `harness_gate_approve{P6}` | **isError:true** · gate status `{}`→`{}` 불변 | ✅ |
| G7 결정성 | 3회 동일·결정 경로 `Math.random`/`Date.now` 실사용 0·migrate 존재 | grep + G1 3회 | 소스 실사용 0(주석뿐)·`migrate` 명령 존재·G1 ×3 동일 | ✅ |
| G8 공급망 | `npm audit --omit=dev` critical/high 0 | 사본에서 `npm audit --omit=dev` | **found 0 vulnerabilities** | ✅ |
| G9 훅 지연 | 폴백이 더하는 p95 < 50ms — **두 표면(인프로세스·프로세스 wall-time) 모두**, 저널 부류마다 | `npm run bench:hook` (동봉) | **두 표면 다 인쇄됨**(PROD-211 참). load 8.3/10코어라 벤치가 **정직하게 판정 보류**. 인프로세스: realistic **+16.5ms**·corrupt **+5.2ms**(둘 다 <50). wall: realistic **+55.2ms**(초과, 부하 팽창)·corrupt +10.7ms | ⚠ |
| G10 이력 비밀 | `gitleaks detect` 전 이력 0 | `gitleaks 8.30.1 detect` | **198 commits · no leaks found** | ✅ |
| G11 CLI 계약 | 전 서브커맨드 `--help` exit 0·미지 명령 exit≠0·침묵 성공 0 | 20 명령군+미지+최상위 | **20/20 --help exit 0** · `frobnicate` exit 1 · 최상위 `--help` exit 0 | ✅ |
| G12 관측성 | 조용한 실패 0·doctor 가 실제 상태 반영 | 저널 고의 손상 + state.json 삭제 후 doctor/hook | doctor **warnings:1**(손상 표면화) · state 삭제 후 hook **exit 0** | ✅ |
| G13 패키징 | manifest↔파일 누락 0·로드 가능 | plugin.json/hooks.json/skills/agents 대조 | 훅 4(SessionStart·PreToolUse·PostToolUse·Stop)·스킬 11·에이전트 5·`mcp/server.js`+dist 2 **전부 실재** | ✅ |

**G1 별표(✅\*)**: 16 skipped 는 `describe.skipIf(!IN_REPO)` / `skipIf(!HAS_DOCS)` 메타 테스트다(사본에 `.git` 이 없어 건너뜀). 제품 테스트를 끈 것이 아니라 **환경 조건부**라, 리포 안에서 돌리면 실행된다. 다만 게이트 텍스트의 문자 그대로 「skip 0」은 **아니다** — 요약표는 이 16을 「배포본 1268 + 리포 전용 16」으로 정직하게 적어 두었으므로 위조는 아니고, 게이트 문구와 관측의 경미한 긴장으로만 남긴다.

**G9 판정(⚠)의 뜻**: 이번 라운드가 주장한 **메커니즘은 참**이다 — 벤치가 인프로세스·wall-time **두 표면을 다 잰다**(소스 `scripts/bench-hook-latency.mjs:87-136` + 실행 출력 확인). 인프로세스 델타는 부하에 강건해 **문턱 안**(realistic +16.5·corrupt +5.2ms)이 관측됐다. 그러나 **wall-time 표면은 이 머신에서 확증 불가**다(감정 내내 1분 load 7.7~38.9). 벤치는 그 사실을 위조하지 않고 「pass/over — machine busy」로 **판정을 보류**했다 — 이는 G9 재정의(문턱을 델타에, wall-time 절대값은 기록으로)와 PROD-212(부하 대칭 표기) 가 의도한 그대로다. 게이트 **위반의 증거는 없고**, wall-time 표면의 **확증도 없다**. → 메커니즘·인프로세스 ✅ · wall-time 미확정.

**개별 게이트로는 12 초록 + G9 미확정. 그런데도 4.8 은 불가하다** — 4.8 조건은 「게이트 전부 ✅」에 더해 **「open BLOCKER 0(ground truth)」**을 요구하고, 그 하드 조건이 아래에서 깨진다. 이 축의 핵심이 바로 이것이다: **게이트가 전부 초록이어도 대장이 사실이 아닐 수 있다.**

---

## 대장 lint 와 그 사각

**lint 결과 — 통과.**
```
$ bash ~/.claude/skills/verifying-production-readiness/bin/ledger-lint.sh docs/release-readiness/2026-08-21
✓ 대장 무결 — 254 행, R1–R13 통과 (open BLOCKER 0 · 실측 근거 대장 251 · 게이트 0)
```
R1–R13(칸수·어휘·인용 실재·집계 정합)은 **깨끗**하다. 재집계로 헤더와 대조: verified 243 · open 3 · deferred 5 · rejected 3 = **254 행**(글자접미 ID 포함). 헤더 주장과 일치한다. 대장의 **자기 산술은 정직**하다.

**lint 가 검사하지 않는 것(사각) — 그리고 그 사각에 BLOCKER 가 있다.**

lint 는 **대장 안의 정합성**만 본다: 칸이 맞는가, 인용이 실재하는가, 상태별 합이 헤더와 같은가. lint 가 **원리적으로 못 보는 것**은 **「대장이 완전한가」** — 즉 세상의 결함이 전부 행이 되어 있는가다. 「open BLOCKER 0」은 lint 가 **대장에 적힌 BLOCKER 행의 상태를 센 값**이지, 코드에 BLOCKER 가 없다는 뜻이 아니다. 등재되지 않은 결함은 lint 의 시야 밖이다.

이 사각은 추상적 우려가 아니다. **아래에서 재현한 BLOCKER 는 대장에 행이 없어 lint 가 「open BLOCKER 0」을 초록으로 찍는다.** lint 가 통과했다는 사실과 「출하 가능」은 서로 독립이다 — 이 축이 6라운드 연속 확인해 온 명제다.

---

## 닫힌 행 표본 재검증

`verified` 로 닫힌 행 **10건**을 제품 표면에서 재현했다(필수 6건 + 무작위 4건). **전건 참.**

| 행 | 어떻게 쟀나 | 결과 |
|---|---|---|
| **PROD-211** (필수) | 벤치 소스 정독 + `npm run bench:hook` 실행 | **참** — 벤치가 인프로세스(자식이 번들 `run(['hook','pre-tool'])` 직접 호출·fd0 가로채기)와 wall-time 두 표면을 **둘 다** 인쇄. 게이트에 적힌 「두 표면 모두」를 실제로 잰다 |
| **PROD-212** (필수) | load 8.3 에서 벤치 실행 | **참** — realistic in-proc(충족)까지 포함해 **전 행이 `pass/over — machine busy`**. 충족만 확정으로 못 읽게 대칭 표기 |
| **EFF-209** (필수) | 설계 트랙 P0 에서 sed/awk/perl 조회 vs 변형 | **참** — `sed -n`·`awk '{print}'`·`perl -ne print` **ALLOW**; `sed -i`·`perl -i -pe`·리다이렉트 **DENY** |
| **QUAL-229** (필수) | `OWNED_DIRS` 잔존 여부 + SEC-213 벡터 재측정 | **참** — `OWNED_DIRS` 전 소스에서 **0건**(삭제 완료). 삭제 후에도 `a=events;b=.jsonl;…$a$b`·base64 은닉 쓰기 **DENY**(다른 절이 먼저 잡음, 중복이 맞았다) |
| **PROD-225** (필수) | `lang: ko`+`HARNESS_LANG=ko` 로 MCP 구동 | **참** — `harness_gate_approve` 설명·거절문 **영어 유지**. 「번들에 ko 없음」 오부연은 README 4종에서 제거됨 |
| **COST-220** (필수) | README 4종 line 107 | **참** — 「every hook returns silence … What it does cost is time: a shell gate exits in ~4 ms p95 before Node ever starts」로 교체됨(0 이 아니라 시간) |
| SEC-221 (무작위) | yq/grep 쓰기 vs 조회 | **참** — `yq -i … config.yaml` DENY · `yq .x` ALLOW · `grep -o` ALLOW |
| ENG-226 (무작위) | 따옴표 안 `&&` 래퍼 | **참** — `sh -c 'cd src && echo x > app.ts'` DENY · `echo 'a && b; c'` 과차단 0 |
| EFF-231 (무작위) | npm publish dry-run | **참** — `npm publish --dry-run` ALLOW · `--dry-run; npm publish` **DENY**(줄 단위, 사면 불가) |
| ENG-230 (무작위) | ash 프로세스치환 | **참** — `ash <(echo x > .harness/events.jsonl)` DENY |

닫힌 행의 **인용 근거는 실재하고 주장은 참**이다. 대장의 닫는 작업 자체는 품질이 높다.

---

## open 3건 판정

| 행 | 성격 | 판정 |
|---|---|---|
| **QUAL-197** (MED) | 3-K 잔여 목록 — 「대장이 완전한 척하지 않게 열어 둠」 | **정당하게 열려 있음** — 미검 항목을 명시하는 메타 행. 다만 본문의 「남은 것은 전부 LOW 이거나 측정 개선이고 **강제·판정에 닿지 않는다**」는 **아래 BLOCKER 로 반증**된다(강제에 닿는 것이 목록 밖에 있었다) |
| **QUAL-210** (MED) | 3-L 한도 중단 4축 — 3-N 이 대체 | **정당하게 열려 있음** — 프로세스 추적 메타 행. 결함을 미루는 것이 아니라 라운드 미완을 정직하게 기록 |
| **PROD-224** (MED) | v0.1.0 미태그·`main` 미머지 | **정당하게 열려 있음** — 푸시·태그·머지는 **사용자 결정**. 원격은 PRIVATE 로 만들어 두고 임의 실행 안 함. 미루는 것이 아니라 권한상 열어 둔 것 |

세 open 은 전부 **결함이 아니라 메타/사용자-결정 행**이고, 닫아야 할 것을 미룬 것은 없다. 그러나 QUAL-197·QUAL-210 이 「미검분은 전부 LOW · 강제 무관」이라 **자기 안심하는 프레이밍**은, 실제로 강제를 무너뜨리는 BLOCKER 가 목록 밖에 있었다는 점에서 **틀렸다** — 그 프레이밍이 바로 6라운드 반복된 실패의 문장이다.

---

## 발견 결함

### ⛔ BLOCKER (open · 목록 밖 · 직전 라운드 발견분 미승계) — `cp -t`/`install -t`/`--target-directory=` 로 하네스 소유 파일 덮어쓰기 → 사람 승인 없이 게이트 개통

**심각도**: BLOCKER. **상태**: open(대장·테스트·`progress.md` 어디에도 없음). **위협 모델 해당**: rubric 개정1 — 에이전트 Bash 도구 호출이 (b)코어·정책 파일 / `--force` 잠금에 도달. 사람 터미널이 아니라 **에이전트 훅 판정**이 통과한다.

**뿌리**(`core/src/bashwrite.ts:633-637`):
```
case 'cp':
case 'install':
  if (operands.length >= 1) targets.push(operands[operands.length - 1]);  // 목적지 = 마지막 피연산자 가정
```
GNU coreutils 의 `-t DIR` / `--target-directory=DIR` 는 목적지를 **앞**(또는 플래그 값)에 둔다. 그래서 추출기는 마지막 **소스**(`events.jsonl`)를 목적지로 오인해 판정하고, 진짜 목적지 `.harness` 는 **판정조차 되지 않는다**. `--target-directory=`(equals)·`install -t`·`rsync`/`scp` 계열도 같은 가정을 쓴다. `-t`·`--target-directory` 문자열은 `bashwrite.ts`·`ledger.md`·`CHANGELOG.md`·`core/dist` **어디에도 없다**(grep 0). 테스트도 없다.

**훅 판정 재현(플랫폼 무관 · 커밋 dist · mktemp 샌드박스):**
```
cp src .harness/config.yaml           → DENY   (목적지 마지막 = 정상 탐지, 대조군)
cp -t .harness config.yaml            → ALLOW  ✗
install -t .harness config.yaml       → ALLOW  ✗
cp --target-directory=.harness config.yaml → ALLOW ✗
mv -t .harness config.yaml            → DENY   (mv 는 원본도 대상 → 우연히 잡힘)
rsync -a foo .harness/config.yaml     → DENY   (목적지 마지막)
```

**끝까지(상태 변화까지) 재현 — 저널 경로(가장 깨끗한 BLOCKER):**
```
# 프로젝트 루트에 위조 저널 작성(루트 쓰기는 정당히 ALLOW)
cp .harness/events.jsonl ./events.jsonl
printf '{"ts":"...","type":"gate-approved","data":{"phase":"P6"}}\n' >> ./events.jsonl
# 훅: cp -t .harness events.jsonl → ALLOW (마지막 피연산자 events.jsonl 을 루트 경로로 오인)
echo '{"tool_name":"Bash","tool_input":{"command":"cp -t .harness events.jsonl"}}' | harness hook pre-tool   # (빈 출력=ALLOW)
gcp -t .harness events.jsonl          # 실제 파일 효과(GNU cp = 리눅스 cp -t)
harness doctor --repair               # ok:true repaired:true (경고 없음 — 저널은 hash-pin 대상 아님)
harness gate status                   # → {"P6":{"status":"approved",...}}   사람 승인 0
```
`gate-approved` 리듀서(`core/src/events.ts:211`)가 위조 줄을 approved 로 폴드한다. **doctor 는 경고조차 안 낸다**(저널은 해시 고정 대상이 아니므로). 이는 대장이 **BLOCKER** 로 매긴 `SEC-49`/`SEC-100`/`SEC-136` 과 **정확히 같은 결과**를 한 표기로 낸다.

**형제 표면 — 정책 파일 덮어쓰기(부분 방어 존재):**
```
ginstall -t .harness config.yaml  (design_blocked_bash:[] · design_allowed_prefixes:[''] 로 위조)
  → 훅 ALLOW · 파일 덮어써짐 · echo x > src/app.ts 가 DENY→ALLOW 로 열림(소스쓰기 강제 무력화)
  → 단, doctor 가 warnings:1 「policy files differ from the pinned baseline」로 **탐지**(ok:true)
```
정책 경로는 hash-pin 백스톱이 **경고**를 낸다(무력화 자체는 이미 일어난 뒤). **저널 경로는 백스톱이 없어** 깨끗한 BLOCKER 다.

**왜 결함인가 — 그리고 왜 이번이 더 나쁜가**: 이 BLOCKER 는 **직전 라운드(3-M)의 가치 축 감정자가 이미 찾아** `round3m/appraisal6-4-value.md` 에 상세 재현과 함께 적고 그 사유로 축을 3.0 으로 매겼다. 그런데 3-M 마감 핸드오프(`progress.md` 최상단)는 **「라운드 3-M 잔여 전건 소진 · open BLOCKER 0 · HIGH 0 · LOW 0」**이라 선언하며, 3-M 이 닫은 6건으로 **EFF-209·PROD-211·PROD-212·QUAL-229·PROD-225·COST-220**(전부 LOW/MED)만 열거한다. `a08ec18` 이후 `bashwrite.ts` 를 건드린 커밋 4개(SEC-221·ENG-226/EFF-227·COST-228·ENG-230/EFF-231) **어느 것도** 이 BLOCKER 를 다루지 않는다. 즉 **못 본 것이 아니라, 본 것을 승계하지 않았다.** 「열거는 언제나 빠진 이름을 남긴다」는 대장의 자기 고백이, 이번엔 **남의 열거(감정자 보고)를 옮기다 BLOCKER 를 떨어뜨리는** 형태로 반복됐다.

**제안 처방**:
1. `cp`/`install`/`mv`/`rsync`/`scp` 추출을 **`-t DIR`·`--target-directory[=DIR]` 인지**로 바꾼다 — 플래그가 목적지를 명시하면 그 디렉토리를, 아니면 마지막 피연산자를. `tar -C`/`unzip -d` 가 이미 쓰는 「플래그가 디렉토리를 말한다」 패턴과 같은 선.
2. **부류로 못을 박는다**: 「목적지를 앞에 두는 플래그」를 정본에서 파생해 테스트로 전수 고정(`cp/install/mv/rsync/scp` × `-t`/`--target-directory`/equals). 손 열거는 또 하나를 빠뜨린다.
3. 등재: 대장에 open BLOCKER 로 올리고 `progress.md`·`00-summary.md` 의 「open BLOCKER 0」을 정정. lint 통과가 완전성의 증거가 아님을 요약에 한 줄 남긴다.

### (경미) 요약 staleness — 3-M 이 지적했으나 미수정
- `00-summary.md:15` 판정 블록 「**1041** tests green」(3-I 산문) vs 같은 파일 `:338` 게이트표 「**1284** passed ×3」 — 한 파일 안에서 어긋남. 실측 정본 1268+16skip=1284.
- `00-summary.md:347` G10 「gitleaks **177** 커밋」 vs 실측 **198** 커밋. 결과(no leaks)는 동일하나 수치 낡음.
- `ledger.md` 헤더 배너 「갱신 2026-08-22 (라운드 3-**K** 진행)」 — 카운트는 3-M 반영(verified 243)인데 라운드 라벨이 낡음.
- 셋 다 조작이 아니라 낡음이지만, 「출하 리포트」가 자기 숫자를 최신으로 못 맞춘 자국이다(3-M 이 같은 지적을 했고 이번 라운드도 안 고쳤다).

---

## 직전 라운드 대비 (3-M 3.0 → 3-N 3.0)

**바뀐 것(개선, 실측 확인):**
- **PROD-211 참으로 닫힘** — 3-M 때 「벤치가 wall-time 한 표면만 잰다」던 것이, 이번엔 **두 표면을 다 인쇄**한다(소스+실행 확인). G9 정의의 「두 표면 모두」를 받는 사람이 재현할 수 있게 됐다. 이 축 3라운드의 실질 진전.
- **EFF-209·PROD-212·QUAL-229·PROD-225·COST-220** 전부 실측 참 — 닫는 품질 높음.
- 게이트 G1/G2/G3/G8/G10/G11/G12/G13 이 3-M(부하로 일부 미측정)보다 넓게 깨끗이 재측정됨.

**안 바뀐 것(그래서 점수도 안 오름):**
- **같은 BLOCKER 가 그대로 open** — 3-M 가치 축이 찾은 `cp -t` 계열이 이 HEAD 에서 동일하게 재현. 3-M 은 이 BLOCKER 로 3.0 을 매겼고, 3-N 은 그 BLOCKER **가 승계조차 안 된 채** 「잔여 전건 소진」이 선언된 것을 확인했다. 개선(PROD-211 등)이 참이라 **아래로 내리지 않되**, 하드 게이트가 4.8 을 원천 차단하고 BLOCKER 미승계가 상승도 막는다 → **3.0 유지**.
- 요약 staleness 3건도 3-M 지적분 그대로.

**점수 산출**: 4.8 조건 「open BLOCKER 0(ground truth)」 **불충족**(목록 밖 BLOCKER 끝까지 재현) → 4.8 원천 불가. 바닥을 받치는 정직성: 닫힌 행 10/10 참·lint R1–R13 통과·게이트 12 초록·버전 전 표면 v0.1.0 일치·저장소 PRIVATE 정직 고지·CHANGELOG 「보안 경계 아님·not-ready」 명시·벤치가 부하를 위조 없이 표기. **종합 3.0/5** — 출하 검증 장치 자체는 정직하고 품질이 높으나, 그 장치의 핵심 결론(「open BLOCKER 0 · 잔여 전건 소진 · 출하 가능 조건 충족」)이 **일곱 번째 목록 밖 BLOCKER — 그것도 직전 감정자가 이미 건네준 것 — 로 뒤집힌다.** (직전 이 축: 3-M 3.0 · 3-L 3.0 · 3-K 2.5.)

---

## 마감 확인

- **`git status --porcelain`**: **빈 출력**(워킹트리 clean). 나는 리포의 추적 파일을 **편집·스테이징·커밋하지 않았다** — 모든 재현은 `mktemp` 샌드박스와 `git archive` 사본에서 했고, 이 보고서 파일 하나만 새로 썼다.
- **dist sha256**: `core/dist/cli.js` = `d9c601d56631bffdfdea290ac61a8dcbbd92a6ae195d6a918d40de36d1c60249` — 지시된 `d9c601d5…` 와 **일치**.
- **HEAD 이동 고지(정직)**: 감정 시작 시 `git rev-parse HEAD` = `a08ec18`(대상). 감정 도중 HEAD 가 `6091a30`(「docs: 3-M 잔여 소진 핸드오프」)로 **한 커밋 전진**했다 — 이는 내 손이 아니라 **환경의 자동 핸드오프 메커니즘**(SessionStart/Stop 훅 계열)이 `progress.md` 만 커밋한 것이다. 검증: `git diff --stat a08ec18 6091a30 -- ':!progress.md'` = **빈 출력**(코드 무변경), `git diff a08ec18 6091a30 -- core/dist/cli.js core/src/bashwrite.ts` = **빈 출력**. 즉 **코드 트리·dist 는 `a08ec18` 과 바이트 동일**하며, 이 감정의 모든 코드 측정은 대상 코드에 대해 유효하다. 변경분은 문서(`progress.md`) 68행 추가뿐이고 나는 그것을 만들지 않았다.
