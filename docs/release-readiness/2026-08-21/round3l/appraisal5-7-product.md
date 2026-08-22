# [7] 상품성 감정 — 4.8/5

**점수** 4.8 · **4.8 충족** ✓ (조건 4건 — 영문 기본+`lang: ko` · LICENSE · 광고=실재 · 온보딩 — 전부 measured 로 충족, 잔여 감점 요인 LOW 이하) · **감정 시각** 2026-08-23 02:47 KST · **대상** HEAD `909f8b2e03ef5413d246e01d76cdacf8d6c5f25a` (워킹트리 clean, 실측은 `git archive HEAD` 샌드박스 2곳 + 별도 테스트 프로젝트)

> 감정 도중 워킹트리 HEAD 가 `d7f826f`(progress.md +58줄 핸드오프 커밋)로 전진했으나, 그 파일은 export-ignore 라 두 커밋의 `git archive` 산출물은 동일 — 전 실측이 `909f8b2` 배포본 기준으로 유효하다.

**한 줄**: 배포본만으로 — 빌드도 `npm install` 도 없이 — 광고한 명령·도구·언어·수치의 거의 전부가 재현되고, 재현 안 되는 것(인프로세스 p95)마저 측정 표면을 문서가 스스로 밝혀 두었다; 남은 것은 LOW 급 잔여뿐이다.

---

## 조건별 실측 (영문 기본 / lang / LICENSE·메타 / 광고=실재 / 온보딩)

### 1. 영문 기본 출력 — 충족 (전 표면 실측)

| 표면 | 실측 | 결과 |
|---|---|---|
| CLI (`--help`·`init`·`doctor`·19개 명령군 `--help`) | 전부 exit 0, 한글 0줄 | 영어 ✓ |
| 훅 JSON — SessionStart 주입 | 1,032바이트 JSON, additionalContext 944자, 전부 영어 | ✓ |
| 훅 JSON — PreToolUse deny (설계 트랙 `src/app.ts`) | "Implementation code cannot be written in the design track (P0)…" | ✓ |
| 훅 JSON — Stop block (미정산 턴) | "The turn log for active wave wave-001 has not been updated…" + trivial 탈출구 안내 | ✓ |
| MCP 도구 16개 설명 | `toolDefinitions()` 직렬화 후 한글 문자 0 | ✓ |
| MCP 거부문 (`lang: ko` 상태에서 호출) | "Unknown input for harness_wave_activate…", gate_approve 거부문 — **ko 설정이어도 영어** | README 의 고지("MCP tool descriptions and refusals stay English")와 정확히 일치 ✓ |
| 생성 산출물 (`wave create` 지시서) | `## Goal / ## Done when / ## Turn log / (unspecified)` | ✓ |
| 스킬 11개·에이전트 5개·프로파일 2종·hooks.json·bin·mcp/server.js | 한글 grep 0건 | ✓ |
| 동봉 스크립트 (`scripts/bench-hook-latency.mjs`) | 출력 영어 기본 (한글은 코드 주석과 ko 분기뿐) | ✓ |

### 2. `lang: ko` / `HARNESS_LANG` — 양쪽 실측 충족

- `.harness/config.yaml` 에 `lang: ko` → CLI 헬프 한국어("설계→구축→출하 규율을…"), 생성 지시서 한국어(`## 목표 / ## 완료 기준 / ## 턴 로그 / (미지정)`) ✓
- `HARNESS_LANG=ko` (config 무수정) → PreToolUse deny 한국어("설계 트랙(P0)에서는 구현 코드를 쓸 수 없다…") ✓ · 벤치 출력 전체 한국어 ✓
- 키 없으면 영어 (init 이 만든 config 에 `lang` 키 자체가 없고 모든 출력 영어) — README config 표의 "default `en`" 서술과 일치 ✓
- README config 표가 이 동작을 정확히 서술: CLI·훅 JSON·생성 문서는 lang 을 따르고 **MCP 는 영어 고정** — 실측과 전부 일치. dist/mcp.js 의 한글 16줄은 코드 주석 + `PLACEHOLDER_WORDS_KO`(자리표시자 검출용 검증기)뿐, ko 메시지 문자열 아님 — "the ko strings are not in the MCP bundle" 은 의미 있는 수준에서 참.

### 3. LICENSE · 메타 · 지원 채널 — 충족

- `LICENSE` 배포본에 실림: MIT, "Copyright (c) 2026 장욱 (Wook Jang)" · `package.json` `"license": "MIT"` 일치 ✓ (doc-claims.test 가 이 일치를 상시 검증)
- 버전 일관: package.json = plugin.json = marketplace.json = `harness --version` = mcp SERVER_VERSION = CHANGELOG 전부 `0.0.1` ✓
- **`repository`/`bugs` 부재 — 주소를 지어내지 않은 것은 옳다**: 공개 저장소가 실재하지 않는 상태에서 가짜 URL 을 넣으면 그게 바로 「없는 것을 광고」다. 대신 4개 언어 README 전부에 지원 절이 있고(README.md:270-284, ko:273, ja:274, zh:271) "no public issue tracker yet — report through the repository you installed it from" 라고 **정직하게 고지**, 신고 시 `harness doctor` + `--version` 출력 동봉과 "둘 다 파일 내용을 담지 않아 붙여도 안전"까지 안내. 로컬 자가진단 표(증상→명령)도 실재 명령만 가리킴(`doctor`, `doctor --repair`, `.harness/.runtime/hook-errors.log` — 경로가 dist/cli.js·mcp.js 에 실재함을 확인).

### 4. 광고 = 실재 — 기계 추출 후 전건 대조, 충족

- **명령**: README 에서 `harness …` 패턴 17종 추출 → 전부 실재. 19개 명령군 `--help` 전건 exit 0·영어·비어 있지 않음. `gate submit/approve/verify/sweep/status/feedback` · `design link/sync/inventory/baseline/html/list` · `tokens gen/lint/swap` — README 가 부르는 하위명령 전부 헬프에 실재.
- **MCP**: "exactly 16 tools" → `toolDefinitions()` 실측 16개, 이름 16개 전부 README 나열과 일치. `harness_gate_approve` 는 광고대로 거부만 하고 터미널을 가리킴(실호출 확인). "cannot set a phase past an unapproved gate" — phase-set 도구 자체가 없음(더 강한 형태로 참).
- **config 8키**: 코드 기본값과 표가 전부 일치 — `design_allowed_prefixes: ['.harness/', 'docs/']` (core/src/config.ts:12), deploy 목록에 `npm publish`·`docker push`·`terraform apply` 실재, `remote_control: true`·`terse: false`·`block_raw_values: false`. "config.yaml 은 보호 파일" — 에이전트 Write 실측 deny ✓.
- **불변식 4종 실측**: 비간섭(`.harness/` 없는 곳에서 session-start·pre-tool 출력 0바이트·exit 0) ✓ · 결정론(같은 입력 3회 → SHA-256 3회 동일) ✓ · 자기완결(**`npm install` 0회**의 순수 아카이브에서 `--version`·`init`·`status`·훅 deny 전부 동작 — yaml 번들 실증) ✓ · `npm audit --omit=dev` **0 vulnerabilities** 실측 일치(dev 는 5건 있으나 광고가 `--omit=dev` 로 정직하게 한정) ✓
- **수치**: 테스트 "1253 (53 files), published package 에선 16 skip → 1237" → 배포본 실측 **1237 passed | 16 skipped (1253) · 52+1 (53 files)** — 자릿수까지 정확 ✓ · "~240 tokens" → 실측 944자 ≈ 236토큰 ✓ · "0 tokens without `.harness/`" → 0바이트 ✓ · 4개 언어가 같은 수치를 말함(1253 · 2.6/18.9ms 병기 실측, doc-claims.test 가 상시 검증).
- **양방향 — 있는 것을 부정하는가**: "Not shipped: 네트워크 캔버스 fetch" — `design sync` 는 광고대로 `--from <file>` 만 받음 ✓ · "No skills for P7–P9" — 스킬 디렉토리 실측 11개(P0–P6, P10–P12)로 정확 ✓ · "verifying-production-readiness 는 called but not bundled" — 배포본에 없음, 고지 정확 ✓ · 과거 과소광고였다는 절(Claude Design integration)은 실재 명령들로 뒷받침됨 ✓.
- **A/B 절의 정직성**: 제목부터 "**One informal run — not a benchmark.**" — 1회/조건, 방법론 미기록을 명시하고 "read it as an anecdote, not a measurement" 라 못 박음. 수치·표·백분위 없음. 4개 언어 동일 고지 실측(ko:41 "벤치마크가 아니다", ja:41, zh:41). **벤치마크처럼 읽히지 않는다** — 정직 판정.

### 5. 온보딩 — 충족

`harness init` 성공 메시지가 다음 행동(`harness --help`)과 보안 경고(gate approve 허용목록 금지)를 함께 줌 → SessionStart 가 현 위치·다음 수(`harness status`·gate submit)를 주입 → README Quick start 는 "프롬프트만 보내면 된다" 사용자 자리 서술 + 결정점(설계 승인) 명시. 지원 절이 증상→명령 표로 마무리. 첫 실행 경로가 막다른 곳 없이 이어짐.

---

## 배포본 위생 (git archive 기준)

- 아카이브 총 **133파일** 전수 열람 — 전부 제품 구성물(코드·dist·테스트·스킬·에이전트·프로파일·README 4종·LICENSE·CHANGELOG·벤치).
- `.gitattributes` 가 `progress.md`, `docs/release-readiness`(README 와 **반대되는 출하 판정** 포함 — 주석이 그 이유까지 자술), `docs/appraisal`, `docs/superpowers`, `.claude`, `.codesight` 를 export-ignore — **아카이브에서 부재 실측 확인**. 내부 작업물·모순 판정문 유출 0.
- CHANGELOG 가 내부 대장을 인용하되 "(not shipped in the package)" 를 명시 — 받는 사람이 못 여는 경로를 여는 척하지 않음.
- 배포본에서 `npm test` 실행: **green** (1237 passed / 16 skipped, 7.8s). 배포본이 자기 광고를 스스로 검증하는 doc-claims.test(스크립트 실재·수치 정합·MCP 도구 실재·4개 언어 정합·라이선스 정합) 포함.
- 사소: 테스트 파일명에 내부 라운드 표식(`med-3g-*`, `blocker-3i` 등)과 벤치 스크립트의 한국어 주석이 실려 나감 — 출력·기능 무영향.

---

## 광고 수치의 재현 가능성 — 배포본에서 직접 돌려 본 결과 (★ 핵심 질문)

**돌았는가**: `npm run bench:hook` — 배포본 안에서, 빌드 0·추가 의존성 0 으로 **exit 0 완주** (스크립트는 node 내장 모듈만 사용, 훅은 커밋된 dist 로 구동. `node scripts/bench-hook-latency.mjs` 직접 실행도 성립하는 구조). 2회 실측:

- **1차 (load 5.18/10코어 — 부하 중)**: node v22.22.2 · n=30 · 워밍업 3 폐기 · node 기동 바닥 p50 39.4 / p95 48.2ms. realistic 526.1→283.4ms (Δ−242.7, PASS) · corrupt 142.5→163.3 (Δ+20.7, PASS) · all-state 89.1→634.9 (Δ+545.8, 기록만). **부하 경고 발동** — "Re-run on an idle machine before reading a verdict."
- **2차 (`HARNESS_LANG=ko`, load 11.69)**: realistic 84.5→114.0 (Δ**+29.4ms**, 충족) · corrupt 122.6→132.9 (Δ+10.3, 충족) · all-state 75.6→159.3 (Δ+83.8, 기록만). 출력 전체 한국어.

**같은 자리를 재는가**: 출력이 표면(**process wall-time — "what you wait for on every tool call"**)·표본(n=30, 워밍업 3)·백분위(p95)·머신 의존성(node 버전·아치·코어·load·기동 바닥값 병기, "that floor belongs to your machine, not to this tool")을 **전부 자기 출력 안에 명시**한다. G9 판정은 절대값이 아니라 **폴백 델타 < 50ms** 로 걸리고, 유휴 머신에서 초과 시 exit 1(스크립트 실측 확인), 부하 중 초과는 "over — machine busy" 로 실패 집계에서 제외 — 판정 설계가 정직하다. README Known limits 의 "(+29 ms wall-clock)" 는 실측 델타 +29.4ms 와 **소수점 한 자리까지 상응** — 이 열은 완전 재현된다.

**아직 재현 불가로 남은 광고 수치** (README 4종 계량 주장 전수 판정):

| 수치 | 패키지 안 재현 | 판정 |
|---|---|---|
| 1253/53/16-skip/1237 · 16 도구 · ~240/0 토큰 · dep 1 · audit 0 · 3× 결정론 · 13 페이즈 · 4 훅 | `npm test`·직접 실측 | **재현됨** ✓ |
| wall-clock 급 수치·node 기동 바닥·폴백 델타(+29ms) | `npm run bench:hook` | **재현됨** ✓ (절대값은 고지대로 머신 성질) |
| **인프로세스 p95 2.6 ms / 18.9 ms / ≈19 ms** (README.md:118·259) | 어떤 동봉 도구도 인프로세스 시간을 출력하지 않음 (벤치는 wall-time 전용, core/test 에도 해당 계측 없음) | **재현 불가 — 잔여** (단, 측정 표면이 문서에 명시돼 있고 재현되는 델타와 정합) |
| 저널 "(15 MB)" | 벤치가 100k 엔트리는 합성하나 바이트 수를 출력하지 않음 | 재현 불가 (사소) |
| 게이트 실험 "13/13 → 0, 1, 2 openings" (README.md:246) | 기전은 gate 테스트가 커버하나 그 공격 실험 자체는 재실행 불가 | 재현 불가 (사소 — "measured:" 로 출처 자체는 명시) |

지난 라운드의 「Measured 표를 배포본만으로 재현할 수 없다」는 **대부분 닫혔고**, 인프로세스 열 하나가 LOW 로 남았다.

---

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

1. **LOW — Measured 표의 인프로세스 p95(2.6/18.9ms·≈19ms)는 여전히 동봉 도구로 재현 불가.** 재현: 배포본에서 `npm run bench:hook` → 출력에 인프로세스 수치 없음; `grep -rn "in-process" core/` → 계측기 부재. "Re-measure it yourself" 문단이 표 바로 아래 붙어 표 전체가 재현되는 인상을 줌 — 실제 재현 범위는 wall-time 과 폴백 델타. README.md:118·124·259, scripts/bench-hook-latency.mjs:50-74. (감경: 표면 명시 + 재현되는 델타 +29ms 와 정합 + 표가 wall-clock 병기.)
2. **LOW — 부하 중 PASS 는 그대로 찍힌다.** 부하 중 "초과" 는 "over — machine busy" 로 바꾸면서(비대칭), 노이즈가 델타를 **음수로 만들어도** PASS 로 인쇄(1차 실측: load 5.18 에서 Δ−242.7ms 가 PASS). 부하는 회귀를 부풀릴 수도 **가릴 수도** 있다 — 대칭적으로 "busy — inconclusive" 가 정직하다. scripts/bench-hook-latency.mjs:122-129. (감경: 헤더 경고가 "판정 전 유휴에서 재실행" 을 이미 지시.)
3. **LOW — "(15 MB)" 저널 크기가 벤치 출력에 없다.** 100k 엔트리는 합성하지만 결과 바이트를 인쇄하지 않아 README 의 괄호 수치를 출력만으로 대조할 수 없다. scripts/bench-hook-latency.mjs, README.md:118.
4. **TRIVIAL — 동봉 스크립트·dist 에 한국어 주석 잔존.** 출력은 영어 기본이라 기능 무영향이나, 영어 사용자가 여는 첫 스크립트에 비영어 주석이 섞임. scripts/bench-hook-latency.mjs:86 등, core/dist/mcp.js:7408-8463(주석 16줄).
5. **TRIVIAL — 게이트 공격 실험 수치("13/13 → 0, 1 and 2")는 서술형 실험이라 패키지에서 재실행 불가.** README.md:246. 기전 자체는 동봉 테스트가 고정.

**결함 아님(판정 기록)**: `repository`/`bugs` 공란 — 실재하지 않는 주소를 지어내지 않은 것이 옳고, 4개 언어 지원 절이 그 상태를 그대로 고지한다. README 와 모순되는 내부 출하 판정문은 export-ignore 로 배포본에서 제외 — 리포에는 남겨 감사 가능성 유지. A/B 절은 일화로 정직하게 강등됨.

---

## 못 잰 것 (정직 고지)

- **`claude plugin marketplace add` → `install` 실경로**: 실제 Claude Code 플러그인 설치·훅 자동 배선은 이 세션의 사용자 설정을 건드려야 해서 돌리지 않았다. manifest(plugin.json·marketplace.json 이름 일치, hooks.json 4이벤트, `${CLAUDE_PLUGIN_ROOT}` 참조)까지만 정적 확인.
- **유휴 머신 벤치**: 감정 머신이 내내 load 5–14 라 벤치의 절대값·PASS 판정을 유휴 조건에서 재확인하지 못했다(벤치 자신이 그 사실을 경고한 것은 확인). exit 1 경로는 코드 열람으로만 확인, FAIL 을 실제로 유발하지는 못했다.
- **기능 심층 E2E**: `design html` 렌더 결과물, `tokens gen/swap` 산출물, UX 증적 게이트(PNG 치수), `ship`·`loop`·`migrate` 의 동작 품질 — 존재·헬프·인자 표면까지만 쟀다(축 1·6 의 영역).
- **ja/zh 번역의 문장 품질**: 수치·고지·절 구성의 정합은 쟀으나 번역 자연스러움은 판정하지 않았다.
- **Windows/비 macOS**: 벤치의 `os.loadavg()` 는 Windows 에서 0 이라 부하 경고가 침묵한다 — 실측 불가 환경.
- **~240 토큰의 정밀 토크나이저 계측**: chars/4 근사(≈236)로만 확인. "~" 표기 범위 안.

---

## 점수 산출 근거

- 루브릭 4.8 조건 4건: **영문 기본 출력**(9개 표면 전건 실측 영어) ✓ · **`lang: ko` 옵션**(config·env 양경로, CLI·훅·생성문서 실측) ✓ · **LICENSE 존재**(+메타 정합, 공란 메타의 정직 고지) ✓ · **광고 기능 전부 실재**(명령 17종·명령군 19·MCP 16·config 8키·불변식 4종 전건 실측, 양방향 — 없는 것 광고 0건·있는 것 부정 0건) ✓ · **온보딩** ✓.
- 이번 라운드 필수 항목: 벤치가 배포본 안에서 무빌드·무추가의존으로 돌고, 표면·표본·백분위·머신 의존성·부하 경고·판정·exit code 를 전부 갖췄으며, 재현 가능 범위가 지난 라운드 대비 실질 확장(폴백 델타는 README 수치와 +0.4ms 차로 상응). 잔여는 인프로세스 열 하나.
- 잔여 결함이 LOW 2 + TRIVIAL 3 + LOW(15MB) — **HIGH·MED 0**. 4.8 정의("조건 전건 충족 + 잔여 감점 LOW 이하")에 부합. 4.8 초과를 주지 않는 이유: 광고 수치 중 재현 불가 열이 남아 있고(결함 1), 판정 언어의 부하 비대칭(결함 2)이 벤치의 신뢰 표면에 남아 있다.
