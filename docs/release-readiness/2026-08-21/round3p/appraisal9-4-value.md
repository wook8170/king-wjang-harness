# [4] 품질(출하) 감정 — 3.0/5

**점수** 3.0 · **4.8 충족** ✗ — 하드 조건 「대장 open BLOCKER 0(ground truth)」이 **세 라운드 연속** 거짓이다. 이번엔 한 개가 아니라 **서로 다른 두 개**의 목록 밖 BLOCKER 로 깨진다: ① 내가 독립 발견한 **`perl` 인터프리터 쓰기 경로**(`perl` 이 `MUTATING_TOKENS` 에서 빠져 있어 `perl -e 'open(">", 코어파일)'`·`rename`·`unlink` 가 전부 ALLOW), ② 병렬 축2(3-P) 감정자가 낸 **판정-실행 TOCTOU**([EFF-P1], 내가 독립 재현). 둘 다 끝단까지 실증했고 대장·테스트·`progress.md` 어디에도 없다(grep 0). · **감정 시각** 2026-08-24 09:2x–10:0x KST · **대상 HEAD** `d3e2a0a`(감정 중 환경 자동 핸드오프가 HEAD 를 `36226be` 로 전진 — `progress.md` +76줄뿐, `git diff d3e2a0a HEAD -- core/ bin/ hooks/ mcp/ …` = **0줄**. 모든 측정은 `d3e2a0a` 코드·dist 에 유효. 마감 확인 참조).

**한 줄**: 게이트 13개는 개별로 재면 **전부 초록**(G9 두 표면 다 <50ms, 명령 파싱 게이트 실재), 닫힌 행 표본 **15/15 참**(무작위 10 + 이번 라운드 5건 전부), [QUAL-234] 기계 가드는 **실제로 동작**(보고서 한 장 숨기니 테스트 깨짐), 광고 계량 「1311 / 배포본 1294 + 리포전용 17 / 54파일」은 **정확히 실측 일치**, 판정 「출하 불가」는 README 4종·CHANGELOG·태그·머지에서 **일관** — 3-O 가 낸 BLOCKER 2 + MED 1 + 축3 2건도 **전부 실봉인·재검증 통과**다. 그런데 그 모든 초록·정직 위에 얹힌 「open BLOCKER 0」이 **두 줄로 다시 거짓**이 된다(`perl -e 'unlink ".harness/events.jsonl"'` = ALLOW, 저널 삭제; `ln -s .harness ./h && echo x > ./h/config.yaml` = ALLOW, 정책 위조). 이 축이 여섯 라운드 물어 온 「열거 기반 방어의 다음 사본」이 이번엔 **두 부류로** 남았고, 하나는 3-O 를 봉인한 **바로 그 수정(EFF-214, perl 을 목록에서 뺀 것)이 열었다.**

---

## 게이트 G1–G13 재측정

`git archive HEAD`(= `.gitattributes` export-ignore 적용 = **배포본 형태**) 사본에 `npm install`(리포 미오염) + 커밋된 `core/dist` 로 실측. 리포 전용 검사는 별도로 `git clone`(docs 포함) 사본에서 확인.

| 게이트 | 정의된 판정법 | 내가 실제로 돌린 것 | 관측 | 판정 |
|---|---|---|---|---|
| G1 테스트 | 전건 pass·fail 0·skip 0·3회 동일 | 배포본 사본 `npx vitest run </dev/null` ×3 | **1294 passed · 17 skipped · 53파일+1skip ×3 완전 동일**. 리포 사본(docs 포함)에서는 **1311 passed · 0 skip · 54파일** | ✅\* |
| G2 타입 | `tsc --noEmit` exit 0 | 사본에서 실행 | exit 0 · 0줄 | ✅ |
| G3 빌드·자체완결 | node_modules 없는 맨 아카이브 `--version`·`init`·`status` exit 0 | `git archive`(node_modules 無)→`bin/harness` | 3/3 **exit 0** | ✅ |
| G4 훅 무해 | 4이벤트×{미초기화,깨진JSON,빈} 전부 exit 0·미초기화 0바이트 | stdin 12조합 구동(미초기화 프로젝트) | **12/12 exit 0 · 전부 0바이트** | ✅ |
| G5 훅 강제력 | 소스쓰기·코어·경로우회·배포 Bash deny·과차단 0 | pre-tool 매트릭스(30+ 벡터) | **정의된 벡터는 전건 기대대로.** 그러나 **목록 밖 두 부류가 ALLOW**(perl·TOCTOU — 아래 open 0 검증). G5 초록과 강제 실재는 이 축이 여섯 라운드 확인한 대로 **독립** | ✅※ |
| G6 🔴 안전 속성 | MCP approve 후 게이트 상태 불변 | `mcp/server.js` `harness_gate_approve{P6}` tools/call | **isError:true** · gate `{}`→`{}` 불변 | ✅ |
| G7 결정성 | 3회 동일·결정 경로 `Math.random`/`Date.now` 실사용 0 | grep + G1 ×3 | 소스 실사용 **0**(전 매치가 「이 파일엔 없다」주석) · ×3 동일 | ✅ |
| G8 공급망 | `npm audit --omit=dev` critical/high 0 | 배포본 사본 | **found 0 vulnerabilities** | ✅ |
| G9 훅 지연 | 폴백이 더하는 p95 < 50ms — **두 표면·저널 부류마다** | `npm run bench:hook`(동봉, 100k줄, n=30) | **두 표면 다 인쇄·둘 다 문턱 안**: realistic in-proc **+14.6**·wall **+17.0** · corrupt in-proc **+5.2**·wall **+9.9** · all-state 기록만(+43.7/+47.9). 명령 파싱 게이트 실재·PASS(plain 68.6·long-noslash 207·cd-redirect 338.7·quoted 147.7ms < 1000) | ✅ |
| G10 이력 비밀 | `gitleaks detect` 전 이력 0 | `gitleaks` | **208 commits · 6.43MB · no leaks found** | ✅ |
| G11 CLI 계약 | 전 명령군 `--help` exit 0·미지 명령 exit≠0 | 20 명령군 + 미지 | **20/20 --help exit 0** · `frobnicate` → exit 1 | ✅ |
| G12 관측성 | 조용한 실패 0·doctor 가 실제 상태 반영 | 빈 catch grep + 저널 고의 손상 후 doctor | `catch {}`(주석 없는 빈 삼킴) grep **0** · 손상 후 doctor **warnings:1**(표면화, ok:true) | ✅ |
| G13 패키징 | manifest↔파일 누락 0 | plugin.json/hooks.json/skills/agents 대조 | `bin/harness-hook`·`core/dist/cli.js`·`mcp/server.js`·**스킬 11·에이전트 5** 전부 실재 | ✅ |

**G1 별표(✅\*)**: 배포본(export-ignore) 형태에서 17 skip 는 `skipIf(!IN_REPO/!HAS_DOCS)` 리포 전용 검사다 — 위조가 아니라 환경 조건부이고, **광고 문구(「17 리포 전용, 배포본 1294」)와 정확히 일치**한다. 리포 형태에서는 17건이 다 돌아 1311 전건 pass.

**G5 별표(✅※)**: **정의된 벡터 목록으로는 전건 통과**. 그러나 목록은 열거이고 **목록 밖에서 강제가 뚫린다**(perl·TOCTOU). 개별 게이트 13/13 초록이어도 **대장이 사실이 아닐 수 있다** — 이 축의 핵심 명제가 이번에도 그대로 성립한다.

---

## 「open 0」 검증

### 대장 lint — 통과, 그러나 사각은 그대로

```
$ bash ~/.claude/skills/verifying-production-readiness/bin/ledger-lint.sh docs/release-readiness/2026-08-21
✓ 대장 무결 — 290 행, R1–R13 통과 (open BLOCKER 0 · 실측 근거 대장 287 · 게이트 0)
```
재집계: **verified 282 · deferred 5 · rejected 3 = 290 행**. 대장의 자기 산술은 정직하다. 하지만 lint 는 **대장 안의 정합성**만 본다 — 「open BLOCKER 0」은 lint 가 **적힌 BLOCKER 행의 상태를 센 값**이지 코드에 BLOCKER 가 없다는 뜻이 아니다. 이 사각이 여섯 라운드 그대로다.

### 대장 밖 탐색 — 두 개의 살아 있는 BLOCKER (전건 끝단 실증)

`mktemp` 샌드박스에 `harness init` 후 커밋 dist 로 훅을 구동해 30+ 벡터를 던졌다. 두 부류가 ALLOW 로 떨어졌다.

#### ⛔ BLOCKER ① (open·신규·내 독립 발견) — `perl` 인터프리터가 `MUTATING_TOKENS` 밖이라 코어·정책·소스에 도달

**심각도** BLOCKER. **상태** open(대장·테스트·`progress.md` grep 0). **위협 모델 해당** rubric 개정1 (a)설계 소스 (b)코어·정책 — 사람 터미널이 아니라 **훅 판정**이 ALLOW 한다.

**뿌리**(`core/src/bashwrite.ts:37` `MUTATING_TOKENS` + `:738` `case 'perl'`): [EFF-214] 가 「`sed`·`awk`·`perl` 은 이름만으로 변형이 아니다」며 `perl` 을 `MUTATING_TOKENS` 에서 **뺐다**. 그런데 `case 'perl'` 은 **`-i`(제자리 편집)일 때만** 대상을 올린다. 그래서 `perl -e 'open(F,">", 코어파일)'` 처럼 **함수-호출 쓰기 API** 는 (a) 이름으로도(perl 빠짐) (b) case 로도(`-i` 없음) (c) 리다이렉트 스캐너로도(경로가 `>` 에 인접하지 않고 `open(F,">", …)` 로 분리) **아무 데도 안 걸려** `mutating` 이 서지 않고 안전망이 발화하지 않는다.

**핵심 비대칭**: 같은 목록에서 **`ruby`·`python`·`python3`·`node` 는 그대로 남겨 뒀다.** 그것들은 함수-호출 쓰기(`IO.write`·`open(...,"w")`·`writeFileSync`)도 DENY 다 — 이름이 `MUTATING_TOKENS` 에 있어서다. `perl` 만 **똑같은 범용 인터프리터인데 목록에서 빠졌다.** [EFF-214] 는 perl 의 **줄편집 조회 형태**(`-ne`·`-pe`)를 과차단에서 구하려다, perl 이 **범용 언어**라는 사실을 sed/awk(진짜 줄편집기)와 뭉뚱그렸다.

**훅 판정 재현(커밋 dist · mktemp 샌드박스 · `/usr/bin/perl` 상존):**
```
perl -e 'open(F,">",".harness/state.json");print F 1'   → ALLOW ✗   (ruby/python/node 동형은 DENY)
perl -e 'open(F,">",".harness/config.yaml")'            → ALLOW ✗
perl -e 'open(F,">","src/app.ts");print F 1'            → ALLOW ✗   (설계 트랙 소스)
perl -e 'rename "a",".harness/state.json"'              → ALLOW ✗
perl -e 'unlink ".harness/events.jsonl"'                → ALLOW ✗   (rm 동형은 DENY)
대조: ruby -e 'IO.write(".harness/state.json","x")'     → DENY  (perl 만 뚫린다)
      perl -i -pe 's/a/b/' .harness/config.yaml         → DENY  (줄편집 형태는 잡힌다)
```

**끝단(상태 변화)까지 실증 — 정책 무력화:**
```
$ echo x > src/app.ts                                          → DENY (강제 서 있음)
$ perl -e 'open(F,">",".harness/config.yaml"); print F "design_allowed_prefixes:\n  - \x27\x27\n"'   → 훅 ALLOW → 실제 덮어씀
$ echo x > src/app.ts                                          → ALLOW   (소스쓰기 강제 무력화)
$ harness doctor  → warnings:1 「policy files differ from pinned baseline」(ok:true)   ← 무력화 뒤 경고
```
**끝단까지 실증 — 저널 위조(백스톱 0):** brace-free perl 한 줄(`chr(123)`/`chr(125)`)로 `events.jsonl` 에 `gate-approved` 를 append:
```
$ (훅) perl 저널 append → ALLOW → 실제 유효 JSON 줄 기록
$ harness doctor --repair   # 재생
$ harness gate status  → {"P6":{"status":"approved","approvedAt":"…"}}   사람 승인 0
$ harness doctor       → ok:true · warnings:[] · issues:[]   경고조차 없음
```
`gate-approved` 리듀서가 위조 줄을 approved 로 폴드한다. 저널 경로는 **doctor 가 아무 경고도 안 낸다** — `SEC-49`·`SEC-136`·`SEC-232`·`SEC-264` 와 **한 표기로 같은 결과**.

#### ⛔ BLOCKER ② (open·병렬 축2 [EFF-P1]·내 독립 재현) — 판정-실행 TOCTOU

병렬 축2(3-P) 감정자가 `round3p/appraisal9-2-effectiveness.md` 에서 낸 것을 **커밋 dist·mktemp 샌드박스에서 독립 재현**했다: 한 Bash 명령 안에서 앨리어스(심링크/`cp -l` 하드링크)를 만들고 그 앨리어스에 쓰면, 훅이 경로를 **realpath 로 푸는 시점에는 앨리어스가 아직 없어** 리터럴 경로로 남고, 명령이 실제로 돌 때 앨리어스가 생겨 쓰기가 `.harness` 에 떨어진다.
```
ln -s .harness ./h && echo x > ./h/config.yaml              → ALLOW ✗
ln -s .harness h2 && tee h2/events.jsonl                    → ALLOW ✗
mkdir -p d && ln -s ../.harness d/link && echo x > d/link/state.json   → ALLOW ✗
cp -l .harness/config.yaml ./hl && echo x >> ./hl           → ALLOW ✗
대조: echo x > .harness/config.yaml (직접)                   → DENY
```
[SEC-263] 이 하드링크를 「경로 문자열 아래(파일 실체)」에서 막았는데, 이 부류는 **그 아래(시간 층)** 에서 우회한다 — SEC-263 의 inode 대조는 판정 시점에 앨리어스가 없으면 대조할 대상이 없다. 두 감정자가 **서로 다른** 부류로 「open 0 거짓」을 동시에 실증했다.

### 전 라운드 보고서(3-I~3-O) ↔ 대장 인용 대조 — 절차 방벽은 유지된다

3-N 이 거짓을 찾은 방법(보고서 전수 인용 대조)을 반복했다. **round3i~round3o 의 감정 보고서는 전건 대장에 최소 1회 인용**됐고, 인용 0건 보고서는 없다(아래 가드가 이를 기계로 고정). **3-N 이 진단한 「보고서를 통째로 떨어뜨리는」 절차 실패는 이번에도 닫혀 있다.**

### [QUAL-234] 기계 가드 — 실제로 동작한다 (실증)

docs 포함 클론에서 인용 0건 보고서 한 장(`round3z/appraisal-phantom.md`)을 심자 `ledger-summary-sync.test.ts` 가 깨졌다:
```
× QUAL-234 … 모든 라운드 보고서가 대장에 최소 한 번 인용된다
  → 대장에 인용 0건인 감정 보고서: [ 'round3z/appraisal-phantom.md' ] to deeply equal []
Test Files 1 failed | Tests 1 failed | 13 passed
```
**보고서 한 장을 숨기면 테스트가 깨진다.** 재발 방지 장치가 광고대로 작동한다. (한계는 대장 스스로 고지: 가드는 **파일명이 대장에 등장하는지**만 본다 — 한 보고서 안 다른 결함이 떨어지는 것, 또는 **어떤 보고서에도 없는 새 벡터**는 못 잡는다. 위 두 BLOCKER 가 후자다.)

---

## 닫힌 행 표본 재검증

커밋 dist 제품 표면에서 재현. **필수 5건(이번 라운드 봉인) + 무작위 10건 = 15/15 참.**

| 행 | 어떻게 쟀나 | 결과 |
|---|---|---|
| **SEC-263**(필수·하드링크) | `ln .harness/config.yaml ./alias`·`ln .harness/events.jsonl h`·`link .harness/state.json h2` | **참** — 3건 전부 **DENY** · 심링크→비코어 과차단 0 |
| **SEC-264**(필수·묶음 `-t`) | `cp -rt`·`cp -ft`·`cp -rt.harness`·`install -Dt`·`install -Dvt`·`ln -st`·`--target-directory`(공백·`=`) | **참** — 전 변종 **DENY** · `cp -rt /tmp/bak srcdir` 과차단 0. 3-O 의 아홉 번째 변종 실봉인 |
| **SEC-265**(필수·MCP 표면) | `mcp__*__write_file/edit_file/create_file` 를 코어·정책·소스로 | **참** — 코어/정책/소스 쓰기 **DENY** · `read_file` ALLOW · in-project doc ALLOW · outside-root 은 native `Write` 와 **동일 규칙**(과차단 아님) |
| **ENG-266**(필수·dry-run 개행) | `npm publish --dry-run` + {개행·`&&`·`;`} + `npm publish`(설계 트랙) | **참** — 세 구분자 전부 **DENY** · 전부 dry-run 은 ALLOW · plain publish DENY |
| **ENG-267**(필수·nodejs 런타임) | 7런타임 `<r> core/dist/cli.js phase set P7 --force` | **참** — node·nodejs·deno·bun·npx·bunx·pnpx **7/7 DENY** · 언급(grep) ALLOW |
| SEC-50(무작위) | `echo x > src/app.ts` | **참** — DENY |
| SEC-51(무작위) | `sed -i s/a/b/ .harness/state.json` | **참** — DENY |
| SEC-135(무작위) | `xxd -r a.hex src/app.ts`·`openssl enc -out .harness/config.yaml` | **참** — DENY |
| SEC-170(무작위) | `cd .harness && tee events.jsonl` | **참** — DENY |
| SEC-208(무작위) | `python3 -c open('core/dist/cli.js','w')` | **참** — DENY |
| SEC-232(무작위) | `cp -t .harness /tmp/config.yaml` | **참** — DENY |
| SEC-259(무작위) | `tar --directory=.harness`·`rsync --backup-dir=.harness` | **참** — DENY |
| UTIL-238(무작위) | `echo x > src/app.test.ts` | **참** — DENY(프로파일 소스 우선) |
| FEAT-22/23·UX-24(무작위) | `trace`·`gate feedback`·`--help` | **참** — 전부 exit 0 실재 |
| USE-242(무작위) | `ship … --status` 어휘 | **참** — 도움말이 `open\|fixed\|verified\|deferred` 파서 어휘와 일치 |

닫힌 행의 인용 근거는 실재하고 주장은 참이다. **이번 라운드 봉인 작업의 품질은 높다** — 문제는 닫힌 것이 아니라 **목록 밖에 남은 두 부류**다.

---

## 광고 계량 실측

README(4개 언어)가 「**1311 passing** (54 files) — 17 리포 전용 검사는 배포본에서 skip(배포본 1294)」이라 한다. **직접 셌다:**

| 형태 | 측정 | 관측 | 광고 |
|---|---|---|---|
| 배포본(`git archive`, export-ignore 적용) | `npx vitest run` ×3 | **1294 passed · 17 skipped · 53파일+1skip** ×3 동일 | 1294 ✓ · 17 ✓ |
| 리포(docs 포함 clone) | `npx vitest run` | **1311 passed · 0 skip · 54파일** | 1311 ✓ · 54 ✓ |

**광고 계량은 정확하다.** 1311 = 1294 + 17 이 실측으로 맞고, 파일 수 54 도 맞다. `.gitattributes` 의 export-ignore(`docs/release-readiness`·`docs/appraisal`·`docs/superpowers`·`.claude`·`.codesight`·`progress.md`)가 적용된 배포본 형태에서 17 리포 전용 검사가 정확히 skip 된다. 구현자가 예전에 한 번 잘못 적었다가 고친 부류의 수치 오류는 **더 발견되지 않았다** — 이번 수치는 4개 언어에서 동일하고 실측과 일치한다.

---

## 판정의 정직성 (open 0 · 머지 · 태그 vs 「출하 불가」)

**판정 방향은 전 표면에서 일관된다:**

| 표면 | 판정 문구 |
|---|---|
| README.md:239 / ko:238 / ja:238 / zh:236 | still **not-ready** / **출하 불가** / **出荷不可** / **不可出货** |
| CHANGELOG.md:76·80 | agent-lane discipline, **not a security boundary** · verdict still **not-ready** |
| 태그 `v0.1.0` | 「이 태그가 고정하는 것: 코드·검증. **고정하지 않는 것: 출하 판정** — 여전히 출하 불가」 |
| 머지 `edc224c` | 「**판정은 「출하 불가」 유지** — main 에 오르는 것과 출하는 다른 말」 |

「코드·검증은 고정하되 출하 판정은 고정하지 않는다」는 분리는 **정직하고 방어 가능**하다 — **이 리포의 큰 강점이다.** 그리고 rubric 개정1 의 「강제는 에이전트 레인 규율이지 보안 경계가 아니다」가 README·CHANGELOG 에 그대로 적혀 있다.

**그러나** — 위 두 BLOCKER 는 **에이전트 Bash 호출**이 코어·정책·소스에 도달하는 것으로, 「사람은 자기 `.harness` 를 지울 수 있다」는 개정1 의 **범위 밖 항목이 아니다.** 개정1 이 재는 것은 정확히 「에이전트의 도구 호출이 (a)(b)(c) 에 도달하는가」이고, perl·TOCTOU 둘 다 **에이전트 경로에서 도달한다.** 그런데 같은 표면들(태그·머지·요약·대장 헤더)이 **「open BLOCKER 0 · HIGH 0」을 부속 사실로 단언한다.** 판정 결론(not-ready)은 **다른 이유로**(가성비 축 미완결·재감정 진행 중) 우연히 옳지만, 그 결론을 떠받치는 **관측 사실 「open BLOCKER 0」은 ground truth 가 아니며, 불변 태그 `v0.1.0` 에 영구 각인**됐다.

**경미(staleness, 방향 무관, 이월):** 대장 배너 「갱신 …(라운드 3-**K** 진행)」이 카운트(verified 282)와 어긋난 채 여러 라운드 낡음. 태그/머지의 스냅샷 카운트(1296 tests·verified 273/272·281행)와 현재(1311·282·290행)의 드리프트는 태그를 mid-round 로 끊어 생긴 **불변 스냅샷 드리프트**(조작 아님).

---

## 발견 결함

1. **⛔ BLOCKER ①(open·신규)** — `perl` 이 `MUTATING_TOKENS`(`core/src/bashwrite.ts:37`)에서 빠지고 `case 'perl'`(`:738`)은 `-i` 만 봐서, `perl -e 'open(">", 코어파일)'`·`rename`·`unlink` 가 전부 ALLOW → 정책 덮기(소스쓰기 무력화)·저널 위조(gate approved·doctor 무경고)·저널 삭제. **ruby·python·node 는 목록에 남아 DENY 인데 perl 만 뚫린다** — [EFF-214] 가 만든 자리. 끝단까지 실증.
2. **⛔ BLOCKER ②(open·[EFF-P1] 축2 발견·내 독립 재현)** — 판정-실행 TOCTOU. 단일 Bash 콜로 심링크/`cp -l` 앨리어스를 만들고 그 앨리어스에 쓰면 (a)(b)(c) 동시 재개통. SEC-263 의 inode 대조가 판정 시점엔 앨리어스가 없어 무의미. 끝단까지 실증(축2 보고서 + 내 재현 일치).
3. **(경미) staleness 2~3건** — 대장 배너 라운드 라벨·태그/머지 스냅샷 카운트 드리프트. 조작 아님, 여러 라운드 미수정.

*BLOCKER 2건(재현 완료). staleness 는 정직성 감점 요인이나 판정·강제엔 무영향.*

---

## 직전 라운드 대비 (3-O 3.0 → 3-P 3.0 유지)

**개선(실측 확인, 그래서 아래로 안 내림):**
- **3-O 가 낸 것 전건 실봉인·재검증 통과** — SEC-263(하드링크)·SEC-264(묶음 `-t`)·SEC-265(MCP)·ENG-266(dry-run 개행)·ENG-267(런타임 7/7). 닫힌 행 **15/15 참**(3-O 는 14/14).
- **광고 계량이 정확** — 1311/1294+17/54 전부 실측 일치. 3-O 는 staleness·카운트 드리프트를 경미 결함으로 안았는데, **이번 수치 자체는 4개 언어에서 정확**(드리프트는 불변 태그 스냅샷에만 잔존).
- **절차 방벽·게이트 유지** — [QUAL-234] 가드 실동작, G9 두 표면 확정 PASS, 게이트 13/13 초록, 판정 방향 전 표면 일관.

**안 바뀐 것(그래서 위로도 안 올림):**
- **하드 조건 「open BLOCKER 0(ground truth)」이 세 라운드 연속 거짓** — 4.8 원천 불가. 이번엔 **두 개**의 목록 밖 BLOCKER 로, 그것도 **두 독립 감정자**(축2 TOCTOU + 축4 perl)가 동시에 실증했다. 그중 하나(perl)는 **3-O 를 봉인한 EFF-214 가 연** 자리다 — 열거 기반 방어의 구조적 한계가 이 축이 여섯 라운드 물어 온 바로 그 문장이다.
- **살아 있는 gate-위조/정책-무력화 BLOCKER** — 한 줄로 사람 승인 없이 게이트 approved(perl 저널 경로는 doctor 무경고). 개별 게이트가 전부 초록이어도 **출하 품질 대장은 사실이 아니다.**

**점수 산출**: 4.8 조건 「open BLOCKER 0(ground truth)」 **불충족**(목록 밖 BLOCKER 2건 끝단 재현) → 4.8 원천 불가. 바닥을 받치는 봉인 품질·정직성은 3-O 와 **동급 이상**(닫힌 행 15/15·광고 계량 정확·가드 실동작·게이트 13/13·판정 일관). 상승을 막는 것은 **하드 조건이 같은 부류의 이유로 또 깨졌다**는 것이고, 하락을 막는 것은 **3-O 결함 전건 실봉인 + 광고 계량 정확 + 닫힌 행 전건 참**이다. BLOCKER 가 1→2 로 늘고 하나가 더 근본적(TOCTOU)이라는 점은 **미충족 하드 조건 안에서의 악화**이나, 봉인·정직성의 실질 개선이 그것을 상쇄한다 → **3.0 유지.** (직전 이 축: 3-O 3.0 · 3-N 3.0 · 3-M 3.0 · 3-L 3.0 · 3-K 2.5.)

---

## 마감 확인

- **`git status --porcelain`**: 추적 파일 변경 **0** — 유일한 항목은 `?? docs/release-readiness/2026-08-21/round3p/`(이 보고서 + 병렬 축2 보고서, 신규 미추적). 리포의 추적 파일을 편집·스테이징·커밋하지 않았다. 모든 재현은 `mktemp` 샌드박스·`git archive`/`git clone` 사본에서 했다.
- **HEAD 이동 고지(정직)**: 감정 착수 시 대상 `d3e2a0a`. 감정 도중 HEAD 가 `36226be`(「docs: 핸드오프 … 3-P 재감정 디스패치됨」)로 **한 커밋 전진** — 내 손이 아니라 **환경의 자동 핸드오프**가 `progress.md` 만 커밋한 것. 검증: `git diff d3e2a0a HEAD -- core/ bin/ hooks/ mcp/ profiles/ scripts/ skills/ agents/ package*.json tsconfig.json tsup.config.ts vitest.config.ts` = **0줄**. 전체 diff 는 `progress.md` +76줄뿐. **이 감정의 모든 코드·게이트 측정은 대상 코드 `d3e2a0a` 에 유효하다.**
- **가드 부작용 고지**: 이 보고서(`round3p/appraisal9-4-value.md`)는 신규 파일이고 대장에 인용이 없다. 리포 안에서 테스트 스위트를 돌리면 [QUAL-234] 가드가 이 파일(과 병렬 축2 보고서)을 「인용 0건」으로 잡아 **G1 이 빨강이 된다.** 이는 가드 설계상 의도의 자연스러운 귀결이며, 등재 담당이 두 보고서를 대장에 인용하면 해소된다. (본 감정의 G1 측정은 이 파일이 없는 `git archive`/`git clone` 사본에서 했으므로 영향 없음.)
