# [4] 품질(출하) 감정 — 3.0/5

**점수** 3.0 · **4.8 충족** ✗ — 하드 조건 「open BLOCKER 0(ground truth)」이 **또 거짓**이다. 이번엔 3-N 처럼 떨어뜨린 결함이 아니라, **직전 라운드가 고쳤다고 선언한 바로 그 부류(SEC-232·SEC-259)의 아홉 번째 변종**이다: 번들 단축플래그 `cp -rt .harness`·`cp -ft .harness`·`install -Dt .harness`·`ln -st .harness` 가 목적지 추출을 통째로 비껴가 훅이 **ALLOW** 하고, 끝단에서 사람 승인 없이 게이트가 approved 로 위조된다(GNU cp 로 파일 효과까지 실증). · **감정 시각** 2026-08-23 20:1x KST · **대상 HEAD** `631f190`(감정 중 환경 자동 핸드오프가 `progress.md` 만 바꾼 `3056767` 로 전진 — 코드·dist 는 `631f190` 과 **바이트 동일**, 마감 확인 참조).

**한 줄**: 게이트 13개는 개별로 재면 **전부 초록**이고(3-N 이 부하로 미확정이던 G9 wall-time 까지 이번엔 두 표면 다 PASS), 닫힌 행 표본 10건 전건 참, QUAL-234 기계 가드는 **실제로 동작**하며(보고서 하나 숨기니 테스트가 깨졌다), 판정 「출하 불가」는 README 4종·CHANGELOG·태그·머지 커밋·요약에서 **일관되게** 설명된다 — 그런데 그 모든 초록과 정직함 위에 얹힌 「open BLOCKER 0」이 **한 줄(`cp -ft .harness events.jsonl`)로 다시 거짓**이 된다. 3-N 이 잡은 「보고서를 떨어뜨리는」 절차 실패는 이번에 실제로 고쳐졌으나, 이 축이 여섯 라운드 물어 온 「열거 기반 방어의 다음 사본」은 그대로 남았다.

---

## 게이트 G1–G13 재측정

`mktemp` 샌드박스 + `git archive HEAD` 사본에 `npm install`(리포 미오염), 커밋된 `core/dist` 로 실측. 부하는 감정 내내 3.4~5.0(3-N 의 7.7~38.9 보다 안정).

| 게이트 | 정의된 판정법 | 내가 실제로 돌린 것 | 관측 | 판정 |
|---|---|---|---|---|
| G1 테스트 | 전건 pass·fail 0·skip 0·3회 동일 | 사본에서 `npx vitest run </dev/null` ×3 | **1284 passed · 17 skipped · 53 files+1 skip ×3 완전 동일** | ✅* |
| G2 타입 | `tsc --noEmit` exit 0 | 사본에서 실행 | exit 0 | ✅ |
| G3 빌드·자체완결 | node_modules 없는 맨 아카이브 `--version`·`init`·`status` exit 0 | `git archive HEAD`(node_modules 없음)→`bin/harness` | version=v0.1.0·init·status **전부 exit 0** | ✅ |
| G4 훅 무해 | 4이벤트×{미초기화,깨진JSON,빈} 전부 exit 0·미초기화 0바이트 + 미지이벤트 | stdin 16조합 구동 | **16/16 exit 0 · 전부 0바이트** · 미지 이벤트는 stderr 안내 only | ✅ |
| G5 훅 강제력 | 소스쓰기·코어·경로우회·배포 Bash deny·과차단 0 | pre-tool 판정 매트릭스(SEC-259 벡터 포함) | 21벡터 — DENY 14 / ALLOW 7 전부 기대대로 (`tar --directory=.harness`·`rsync --backup-dir=.harness`·`git clone --separate-git-dir=.harness` **DENY**; `rsync -t`·`cp -t /tmp/bak`·`npm publish --dry-run` **ALLOW**) | ✅※ |
| G6 🔴 안전 속성 | MCP approve 후 게이트 상태 불변 | `mcp/server.js` `harness_gate_approve{P6}` tools/call | **isError:true** · gate `{}`→`{}` 불변 | ✅ |
| G7 결정성 | 3회 동일·결정 경로 `Math.random`/`Date.now` 실사용 0 | grep + G1 ×3 | 소스 실사용 **0**(두 매치 다 「이 파일엔 없다」는 주석) · ×3 동일 | ✅ |
| G8 공급망 | `npm audit --omit=dev` critical/high 0 | 사본에서 실행 | **found 0 vulnerabilities** | ✅ |
| G9 훅 지연 | 폴백이 더하는 p95 < 50ms — **두 표면·저널 부류마다** | `npm run bench:hook`(동봉, 100k줄, n=30) | **두 표면 다 인쇄·둘 다 문턱 안**: realistic in-proc **+16.0**·wall **+26.7** · corrupt in-proc **+6.9**·wall **-7.1** · all-state 기록만(+47.9/+37.6). 명령 파싱 게이트도 신설·PASS(plain 69·long-noslash 234·cd-redirect 358·quoted 155ms < 1000) | ✅ |
| G10 이력 비밀 | `gitleaks detect` 전 이력 0 | `gitleaks 8.30.1` | **204 commits · no leaks found** | ✅ |
| G11 CLI 계약 | 전 명령군 `--help` exit 0·미지 명령 exit≠0+명확 메시지 | 20 실제 명령군+미지+최상위 | **20/20 --help exit 0** · `config`/`frobnicate` 미지 → exit 1 + 「Unknown command … Expected one of …」 · 최상위 exit 0 | ✅ |
| G12 관측성 | 조용한 실패 0·doctor 가 실제 상태 반영 | 저널 고의 손상 + state.json 삭제 후 doctor/hook | doctor **warnings:1**(손상 표면화, ok:true) · state 삭제 후 hook **exit 0·0바이트** · `catch {}` 빈 삼킴 grep **0** | ✅ |
| G13 패키징 | manifest↔파일 누락 0 | plugin.json/hooks.json/skills/agents 대조 | 매니페스트·hooks.json·**스킬 11·에이전트 5**·`mcp/server.js`·`core/dist/cli.js` **전부 실재** | ✅ |

**G1 별표(✅\*)**: 17 skipped 는 `describe.skipIf(!IN_REPO/!HAS_DOCS)` 메타 테스트(사본에 `.git`·docs 트리 없어 건너뜀). 제품 테스트를 끈 것이 아니라 환경 조건부다 — 게이트 문구의 「skip 0」과 문자 그대로는 다르나, 위조가 아니라 환경 특성이다.

**G5 별표(✅※)**: **G5 의 정의된 벡터 목록으로는 전건 통과**다. 그러나 목록은 열거이고, **목록 밖에서 같은 강제가 뚫린다** — 아래 「open 0 검증」의 BLOCKER 가 정확히 그 자리다. G5 가 초록인 것과 강제가 실제로 서 있는 것은 **이 축이 여섯 라운드 확인한 대로 서로 독립**이다.

**개별 게이트 13/13 초록. 그런데도 4.8 은 원천 불가** — 4.8 조건은 「G1–G13 전부 ✅」에 더해 **「open BLOCKER 0(ground truth)」**을 요구하고, 그 하드 조건이 아래에서 깨진다. **이 축의 핵심이 바로 이것이다: 게이트가 전부 초록이어도 대장이 사실이 아닐 수 있다.**

---

## 「open 0」 검증

### 대장 lint — 통과, 그러나 사각은 그대로

```
$ bash ~/.claude/skills/verifying-production-readiness/bin/ledger-lint.sh docs/release-readiness/2026-08-21
✓ 대장 무결 — 285 행, R1–R13 통과 (open BLOCKER 0 · 실측 근거 대장 282 · 게이트 0)
```
재집계로 헤더와 대조: **verified 277 · deferred 5 · rejected 3 · open 0 = 285 행**. 대장의 자기 산술은 정직하다. 하지만 lint 는 **대장 안의 정합성**만 본다 — 「대장이 완전한가(세상의 결함이 전부 행이 됐는가)」는 **원리적으로 못 본다**. 「open BLOCKER 0」은 lint 가 **적힌 BLOCKER 행의 상태를 센 값**이지 코드에 BLOCKER 가 없다는 뜻이 아니다.

### 전 라운드 보고서 ↔ 대장 인용 대조 (3-I~3-N, 42장 전수)

3-N 이 거짓을 찾은 방법을 그대로 반복했다 — 모든 라운드 보고서가 대장에 인용됐는지 전수 대조.

| 라운드 | 보고서 | 인용 0건? |
|---|---|---|
| 3-I(7) · 3-J(7) · 3-K(6) · 3-L(7) · 3-M(7) · 3-N(7) | **42장 전수** | **0장 — 전건 최소 1회 이상 인용** |

3-N 이 지목한 **인용 0건 세 장**(`round3l/appraisal5-6-usability`·`round3m/appraisal6-4-value`·`round3m/appraisal6-6-usability`)은 이번에 각각 1·1·8회 인용됐다. **3-N 이 진단한 절차 실패(보고서를 통째로 떨어뜨림)는 실제로 닫혔다.**

### [QUAL-234] 기계 가드 — 실제로 동작한다 (실증)

`core/test/ledger-summary-sync.test.ts:259` 의 가드를 **깨 봤다**. 클론(리포 아님)에 인용 0건 보고서 한 장(`round3l/appraisal5-99-phantom.md`)을 심자:
```
× QUAL-234 … 모든 라운드 보고서가 대장에 최소 한 번 인용된다
  → 대장에 인용 0건인 감정 보고서 — 트리아지에서 빠졌다:
     expected [ 'round3l/appraisal5-99-phantom.md' ] to deeply equal []
```
**보고서 한 장을 숨기면 테스트가 깨진다.** 3-N 이 요구한 재발 방지 장치가 광고대로 작동한다. (한계: 가드는 **보고서 파일명이 대장에 등장하는지**만 본다 — 그 보고서 안 결함이 **전건** 트리아지됐는지는 못 센다. 대장 스스로 그렇게 고지한다. 그래서 **한 보고서가 한 번 인용되고 그 안 다른 결함이 떨어지는 것**, 또는 **어떤 보고서에도 없는 새 벡터**는 이 가드로 못 잡는다 — 아래 BLOCKER 가 후자다.)

### ⛔ BLOCKER (open · 목록 밖 · 신규 벡터) — 번들 단축플래그 `-t` 가 목적지 추출을 비껴간다 → 사람 승인 없이 게이트 위조

**심각도** BLOCKER. **상태** open(대장·테스트·`progress.md` 어디에도 없음 — grep 0). **위협 모델 해당** rubric 개정1: 에이전트 Bash 도구 호출이 (b)코어·정책 파일 / `--force` 잠금에 도달. 사람 터미널이 아니라 **훅 판정**이 통과한다.

**뿌리**(`core/src/bashwrite.ts:632-650`): [SEC-259] 가 도입한 `flagValues` 는 단축플래그를 **단독**(`-t`) 또는 **값 붙임**(`-tDIR`) 두 형태만 안다:
```ts
if (a === `-${nm}`) { … args[i+1] … }                       // -t DIR
else if (!a.startsWith('--') && a.startsWith(`-${nm}`) && a.length > 2) out.push(a.slice(2));  // -tDIR
```
그런데 GNU getopt 는 단축플래그를 **번들**한다 — `cp -rt DIR SRC` = `cp -r -t DIR SRC`, `install -Dt DIR SRC` = `-D -t DIR`. 이때 `args[i]` 는 `-rt`·`-Dt` 라 `=== '-t'` 도 `.startsWith('-t')` 도 **거짓**이다(`-rt` 는 `-t` 로 시작하지 않는다). 그래서 `targetDirectory` 가 **null** 을 반환하고, cp/install 분기가 기본 경로(마지막 피연산자 = **소스**)로 떨어져 **진짜 목적지 `.harness` 는 판정조차 되지 않는다.** [SEC-232] 가 고친 `-t` 와 **동일한 붕괴**가, 플래그를 하나 앞에 붙인 것만으로 되살아난다.

**훅 판정 재현(커밋 dist · mktemp 샌드박스 · 플랫폼 무관):**
```
cp  -t   .harness config.yaml   → DENY   (대조군 — 고쳐진 형태)
cp  -rt  .harness config.yaml   → ALLOW  ✗
cp  -ft  .harness config.yaml   → ALLOW  ✗
cp  -vt  .harness config.yaml   → ALLOW  ✗
cp  -at  .harness config.yaml   → ALLOW  ✗
install -Dt  .harness config.yaml → ALLOW ✗
install -vt  .harness config.yaml → ALLOW ✗
install -Dvt .harness config.yaml → ALLOW ✗
ln  -st  .harness /tmp/x        → ALLOW  ✗
(mv -ft/-vt 는 DENY — mv 는 원본도 대상으로 올려 .harness 가 우연히 잡힌다)
대조: cp -rt /tmp/bak srcdir · install -Dt /tmp/bak config.yaml → ALLOW (밖으로 나가는 정상 백업, 과차단 아님)
```

**끝까지(상태 변화까지) 재현 — 저널 경로(가장 깨끗한 BLOCKER, 백스톱 0):** GNU cp(=리눅스 cp)로 파일 효과까지 실행:
```
cp .harness/events.jsonl ./events.jsonl                                # 루트 쓰기 = 정당 ALLOW
printf '{"ts":"…","type":"gate-approved","data":{"phase":"P6"}}\n' >> ./events.jsonl
echo '{…"command":"cp -ft .harness events.jsonl"}' | harness hook pre-tool   # → ALLOW (빈 출력)
gcp -ft .harness events.jsonl                                          # 실제 파일 효과
harness doctor --repair                                                # 저널 재생
harness gate status   # → {"P6":{"status":"approved","approvedAt":"…"}}   사람 승인 0
harness doctor        # → ok=true · warnings=[] · issues=[]   경고조차 없음
```
`gate-approved` 리듀서가 위조 줄을 approved 로 폴드한다. **저널은 해시 고정 대상이 아니라 doctor 가 아무 경고도 안 낸다.** 이는 대장이 BLOCKER 로 매긴 `SEC-49`·`SEC-136`·`SEC-232` 와 **한 표기로 같은 결과**를 낸다.

**형제 표면 — 정책 파일 덮어쓰기(부분 백스톱 존재):** `cp -ft .harness config.yaml` 로 `design_allowed_prefixes:['']` 를 덮으면 훅 ALLOW·파일 덮어써짐·`echo x > src/app.ts` 가 **DENY→ALLOW** 로 열린다(소스쓰기 강제 무력화). 단 doctor 가 `warnings:1 「the policy files differ from the pinned baseline」`(ok:true)로 **탐지**는 한다(무력화 자체는 이미 일어난 뒤). **저널 경로는 백스톱이 없어** 더 깨끗하다.

**왜 이번 BLOCKER 인가 — 3-N 과 어떻게 다른가**: 3-N 의 BLOCKER 는 **직전 감정자가 이미 찾아 건넨 것을 승계 안 한** 절차 실패였다(더 나빴다). 이번 것은 **어떤 보고서에도 없는 신규 벡터**로, 구현자가 SEC-232·SEC-259 를 **성실히 고친** 뒤 남은 자리다. SEC-259 노트는 스스로 「네 표기(`-x V`·`-xV`·`--n V`·`--n=V`)를 아는 헬퍼 하나」라 적었지만, **다섯 번째 표기 — 다른 단축플래그와 번들된 `-t`** 는 그 헬퍼가 못 본다. 대장 스스로 「사본 드리프트로 여덟 번 뚫렸다」고 적은 그 **아홉 번째**다. 이것이 열거·부분 정규화 기반 방어의 구조적 한계이며, 이 축이 여섯 라운드 물어 온 바로 그 문장이다.

**제안 처방**:
1. `flagValues` 의 단축플래그 매칭을 **번들 인지**로 바꾼다 — 인자가 `-` 로 시작하고 `--` 가 아니면 문자 집합에 `nm` 이 있는지 보고, 값을 받는 플래그가 **번들의 마지막 문자**면 다음 토큰(또는 그 문자 뒤 나머지)을 값으로 취한다. GNU getopt 규칙 그대로.
2. **부류로 못 박는다**: `{cp,install,ln,mv}` × `{-t, 번들 -Xt, --target-directory, =형}` 을 정본에서 파생해 전수 테스트. 손 열거는 열 번째를 빠뜨린다.
3. 등재: 대장에 open BLOCKER 로 올리고 `progress.md`·`00-summary.md`·(가능하면 릴리스 노트)의 「open BLOCKER 0」을 정정. **태그 `v0.1.0` 메시지에 박힌 「open BLOCKER 0」은 불변이라 정정 불가 — 다음 태그에서 바로잡는다.**

---

## 닫힌 행 표본 재검증

`verified` 로 닫힌 행을 제품 표면(커밋 dist)에서 재현. **필수 4건 + 무작위 10건 = 전건 참.**

| 행 | 어떻게 쟀나 | 결과 |
|---|---|---|
| **SEC-259** (필수) | tar/rsync/git-clone 플래그형 목적지 판정 | **참** — `tar --directory=.harness`·`rsync --backup-dir=.harness`·`git clone --separate-git-dir=.harness` **DENY** · `rsync -t`(=`--times`)·밖으로 나가는 형태 과차단 0. *단 같은 함수의 번들 단축플래그 사각은 위 BLOCKER* |
| **COST-260** (필수) | 800세그 `cd x > f && … && cd .harness && tee` 를 훅에 구동, 벽시계 계측 | **참** — **334ms**(옛 15초 대비). O(R²)→캐시로 fail-open 사라짐. 타이밍이 주장의 핵심이고 그대로 성립 |
| **COST-261** (필수) | 8MB stdin 페이로드 | **참** — **800ms 에 DENY(거부)**. 상한 초과가 통과가 아니라 거부. fail-open 구간 사라짐 |
| **COST-262** (필수) | `npm run bench:hook` 소스+실행 | **참** — 벤치에 **명령 부류 축(plain·long-noslash·cd-redirect·quoted) + 1000ms 게이트** 실재. 2차가 살아나면 걸린다. 3-M 이 지적하고 무변경이던 것이 닫힘 |
| SEC-135 (무작위) | 위치인자 쓰기 프리미티브 | **참** — `xxd -r a.hex src/app.ts`·`openssl enc -out .harness/config.yaml` **DENY** |
| SEC-170 (무작위) | `cd` 정규화 | **참** — `cd .harness && tee events.jsonl`·`cd .harness && xxd -r p.hex state.json` **DENY** |
| SEC-208 (무작위) | 인터프리터 CLI 복사 | **참** — `python3 -c open(cli.js)`·`ruby -e IO.write(cli.js)` **DENY** · 무관 파일 쓰기 과차단 0 |
| SEC-233 (무작위) | 66KB 주석 페이로드 + 코어파일 쓰기 | **참** — **DENY**(fail-open 안 됨). `.harness` 프로젝트에서 거부 |
| ENG-235 (무작위) | `x.fish` 이름 `#!/bin/sh` 본문이 저널 쓰기 | **참** — 직접 실행 **DENY**(확장자 정본 파생) |
| ENG-236 (무작위) | dry-run-then-real 배포 | **참** — `blocker-3n.test.ts` [ENG-N2] 16/16 green(`--dry-run && 진짜` 를 배포로 인식) |
| USE-246 (무작위) | `rm -rf .harness` 거부문 | **참** — 편집이 아니라 해제로 갈라 안내(거부는 유지) |
| UTIL-238 (무작위) | `src/app.test.ts` vs `test/app.test.ts` | **참** — 전자 **DENY**(프로파일 소스 우선) · 후자 **ALLOW** |
| G1/G9 벤치(PROD-211/212 계열) | 두 표면 인쇄·게이트 열 | **참** — 위 G9 |
| QUAL-234 가드 | 보고서 숨기고 테스트 구동 | **참** — 위 실증(테스트 깨짐) |

닫힌 행의 인용 근거는 실재하고 주장은 참이다. **닫는 작업 자체의 품질은 높다** — 문제는 닫힌 것이 아니라 **목록 밖에 남은 것**이다.

---

## 판정의 정직성 (open 0 · 머지 · 태그 vs 「출하 불가」)

**방향은 전 표면에서 일관된다.** 「main 에 제품이 올라가고 태그가 찍혀도 판정은 출하 불가」라는 조합이 서로 모순 없이 설명된다:

| 표면 | 판정 문구 |
|---|---|
| README.md:239 | release-readiness … still **not-ready** |
| README.ko.md:238 | 아직 **출하 불가** |
| README.ja.md:238 | 依然 **出荷不可** |
| README.zh.md:236 | 仍为 **不可出货** |
| CHANGELOG.md:76·80 | agent-lane discipline, **not a security boundary** · verdict still **not-ready** |
| 00-summary 판정 블록 | **출하 불가 (판정 유지)** — 가성비 축 미착수 사유 명시 |
| 태그 `v0.1.0` 메시지 | 「이 태그가 고정하는 것: 코드·검증 결과. **고정하지 않는 것: 출하 판정** — 여전히 출하 불가」 |
| 머지 커밋 `edc224c` | **판정은 「출하 불가」 유지** — main 에 오르는 것과 출하는 다른 말 |

「코드·검증은 고정하되 출하 판정은 고정하지 않는다」는 태그의 분리는 **정직하고 방어 가능한 서술**이다. **여기까지는 이 리포의 큰 강점이다.**

**그러나 같은 표면들이 「open BLOCKER 0 · HIGH 0」을 함께 단언한다** — 태그 메시지(「대장 … open BLOCKER 0 · HIGH 0」), 머지 커밋(「open BLOCKER 0 · HIGH 0」), 요약, 대장 헤더가 모두. 위 BLOCKER 는 이 **부속 사실**을 동시에 거짓으로 만든다. 판정 결론(not-ready)은 **다른 이유로(가성비 축 미재감정)** 우연히 옳지만, 그 결론을 떠받치는 **관측 사실 「open BLOCKER 0」은 ground truth 가 아니다.** 그리고 그것이 **불변 태그에 영구 각인**됐다.

**경미 — staleness(3-M·3-N 이월, 방향 무관):**
- `ledger.md:3` 배너 「갱신 2026-08-22 (라운드 3-**K** 진행)」 — 카운트는 현행(verified 277)인데 라운드 라벨이 다섯 라운드 낡음.
- 요약 판정 블록 헤더가 **3-N** 이고 3-N 점수를 싣는다(3-O 재감정 반영 전이라 시점상 맞으나, 「7축 완주」 서술과 최신 카운트가 라벨과 어긋난다).
- 태그/머지의 카운트(verified 272/273, 281행)와 현재 대장(277, 285행)이 다름 — 태그를 mid-round 에 끊어 생긴 불변 스냅샷 드리프트(조작 아님).

---

## 발견 결함

1. **⛔ BLOCKER (open·신규)** — 번들 단축플래그 `-t`(`cp -rt`·`cp -ft`·`install -Dt`·`ln -st`)가 목적지 추출을 비껴가 하네스 소유 파일 덮어쓰기 → 저널 위조로 게이트 approved(doctor 무경고)·정책 덮기로 소스쓰기 강제 무력화(doctor 경고만). `core/src/bashwrite.ts:632`(`flagValues`). SEC-232·SEC-259 의 아홉 번째 사본. **끝단까지 GNU cp 로 실증.**
2. **(경미) staleness 3건** — 대장 배너 라운드 라벨·요약 헤더·태그/머지 카운트 드리프트. 조작 아님, 세 라운드 연속 미수정.

*BLOCKER 1건만 결함으로 셈(재현 완료). staleness 는 정직성 감점 요인이나 판정·강제엔 무영향.*

---

## 직전 라운드 대비 (3-N 3.0 → 3-O 3.0)

**개선(실측 확인, 그래서 아래로 안 내림):**
- **3-N 이 진단한 절차 실패가 실제로 닫혔다** — 인용 0건 세 장이 전건 인용됐고, 빠졌던 22건이 등재됐으며, [QUAL-234] 가드가 **광고대로 동작**(보고서 숨기니 테스트 깨짐, 직접 실증). 이 축이 6라운드 물어 온 「대장이 거짓을 말하는 절차」에 **처음으로 기계 방벽**이 섰다.
- **G9 가 이번엔 두 표면 다 확정 PASS**(3-N 은 부하로 wall-time 미확정) — realistic +16.0/+26.7 · corrupt +6.9/-7.1, 전부 <50ms. COST-262 로 명령 파싱 게이트까지 신설.
- **SEC-232·SEC-259 의 평문 형태는 전부 닫혔다** — `-t`·`--target-directory=`·`-tDIR`·`tar --directory`·`rsync --backup-dir`·`git clone --separate-git-dir` 전건 DENY. 닫힌 행 14/14 참.
- 게이트 13개가 3-N(부하로 G9 ⚠)보다 넓게 전건 초록.

**안 바뀐 것(그래서 위로도 안 올림):**
- **하드 조건 「open BLOCKER 0(ground truth)」이 또 거짓** — 4.8 원천 불가. 3-N 은 「승계 안 함」이 원인이었고 이번은 「고친 부류의 신규 변종」이 원인이라 **절차 책임은 가벼워졌으나, 축이 재는 대상(대장이 사실인가)의 결론은 같다.**
- **살아 있는 gate-위조 BLOCKER** — 한 줄로 사람 승인 없이 게이트 approved. 이 축의 산출물 핵심 주장(「open BLOCKER 0」)이 거짓인 한, 개별 게이트가 전부 초록이어도 **출하 품질 대장은 사실이 아니다.**
- staleness 3건 그대로.

**점수 산출**: 4.8 조건 「open BLOCKER 0(ground truth)」 **불충족**(목록 밖 신규 BLOCKER 끝단 재현) → 4.8 원천 불가. 바닥을 받치는 정직성·품질은 **3-N 보다 실질 개선**됐다: 절차 방벽(QUAL-234) 실동작·G9 양표면 확정·닫힌 행 14/14 참·판정 방향 전 표면 일관·게이트 13/13. 그러나 축의 **하드 조건이 같은 부류의 이유로 다시 깨졌고**, 살아 있는 BLOCKER 가 상승을 막는다. **개선분이 하락을 막고, 미충족 하드 조건이 상승을 막아 → 3.0 유지.** (직전 이 축: 3-N 3.0 · 3-M 3.0 · 3-L 3.0 · 3-K 2.5.)

---

## 마감 확인

- **`git status --porcelain`**: **빈 출력**(워킹트리 clean). 리포의 추적 파일을 편집·스테이징·커밋하지 않았다 — 모든 재현은 `mktemp` 샌드박스·`git archive`/`git clone` 사본에서 했고, 이 보고서 파일 하나만 새로 썼다.
- **HEAD 이동 고지(정직)**: 감정 착수 시 대상 `631f190`. 감정 도중 HEAD 가 `3056767`(「docs: 핸드오프 … 3-O 재감정 3축 디스패치됨」)로 **한 커밋 전진** — 내 손이 아니라 **환경의 자동 핸드오프 훅**이 `progress.md` 만 커밋한 것. 검증: `git diff 631f190 HEAD -- core/ bin/ hooks/ mcp/ profiles/ scripts/ skills/ agents/ package*.json` = **0줄**(코드·dist 무변경), 전체 diff 는 `progress.md` 76줄 추가뿐. **이 감정의 모든 코드·게이트 측정은 대상 코드에 유효하다.**
- **dist**: `core/dist/cli.js` sha256 = `fe1aa49a6155f683f1767b95b57387c1a8e45a0bc5ede547c36a58b3ec821175` — 대상 `631f190` 의 dist 와 바이트 동일(위 diff 0줄로 확인).
- **가드 부작용 고지**: 이 보고서(`round3o/appraisal8-4-value.md`)는 신규 파일이고 대장에 인용이 없다. 대장을 고칠 권한이 없으므로, 리포 안에서 테스트 스위트를 돌리면 [QUAL-234] 가드가 이 파일을 「인용 0건」으로 잡아 **G1 이 빨강이 된다.** 이는 가드 설계상 의도(모든 보고서는 인용돼야 한다)의 자연스러운 귀결이며, 등재 담당이 이 보고서를 대장에 인용하면 해소된다.
