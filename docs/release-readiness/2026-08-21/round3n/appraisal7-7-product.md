# [7] 상품성 감정 — 4.6/5

**점수** 4.6 · **4.8 충족** ✗ (영문 기본·`lang: ko`·LICENSE·온보딩·광고=실재 다섯 조건은 전부
실측 충족했으나, 배포본에 실리는 `package-lock.json` 이 두 필드에서 아직 **0.0.1** 이라 버전
표면 하나가 릴리스와 어긋나고, README 가 안내하는 소스 설치 경로(`npm install`)를 밟으면 첫
걸음에 추적 파일이 더럽혀진다 — MEDIUM 1건 잔존이라 「잔여 감점 요인 LOW 이하」 미달)
· **감정 시각** 2026-08-23 12:12–12:36 KST · **대상 HEAD** 6091a30 (지시서의 a08ec18 에서
`progress.md` +68줄 커밋 하나 전진 — 그 파일은 export-ignore 라 **배포본은 a08ec18 과 동일**,
`core/dist/cli.js` sha256 `d9c601d5…` 리포·아카이브 양쪽 일치 확인)

**한 줄**: 세 라운드를 끌던 「재현 불가능한 수치를 measured 로 광고」가 이번에는 실제로 닫혔다 —
동봉 벤치를 직접 돌리면 README 4개 언어의 표가 오차 몇 ms 안에서 그대로 나오고, 테스트 수는
자릿수까지, 버전은 여섯 표면에서 일치한다. 남은 것은 잠금파일 한 곳의 낡은 버전과 문구 수준의
잔가지다.

**감정 방법**: `git archive HEAD` → 샌드박스 2벌(`sbx3n/pkg`: `npm install --ignore-scripts` /
`sbx3n/pkg-ci`: `npm ci --ignore-scripts` — dist 재빌드 없이 배포본 그대로), 리포 전용 검사는
별도 `git clone` (`sbx3n/repoclone`)에서. 테스트 프로젝트 4개(proj-en·proj-ko·proj-onboard·
proj-bare, 전부 `CLAUDE_PROJECT_DIR` 지정). 리포 워킹트리는 읽기만 했다. 감정 도중 워킹트리에
**다른 세션의 진행 중 편집**(`core/src/cli.ts`, [SEC-233])이 나타났으나 감정 대상은 커밋된
HEAD 의 아카이브이므로 측정에 영향 없다(→ 마감 확인). 환경: node v22.22.2 · arm64 · 10코어 ·
부하 2.6~36 변동(수치 측정은 유휴 시점을 골라 실행, 각 절에 병기). 직전 라운드(3-M) 보고서는
지시서에 따라 읽고 시작했다.

## 광고 ↔ 실재 전수 대조

README 4개 언어가 공통으로 광고하는 주장 전체를 배포본(아카이브)에서 직접 확인했다.

| 광고 (4개 언어 공통) | 실측 | 판정 |
|---|---|---|
| 테스트 **1284 passing (53 files)**, 배포본은 16건 skip 으로 **1268** | 리포 클론: **1284 passed (53 files)** · 배포본: **1268 passed \| 16 skipped (1284), 52+1 파일** — 자릿수까지 일치 | ✓ |
| 결정성: 3× 실행 동일 판정 | 배포본 스위트 4회 실행 전부 green, 수치 포착 2회 동일(1268/16), 나머지 2회 exit 0 | ✓ |
| MCP 도구 **정확히 16개** + 명단 16개 열거 | tools/list = **16개, 이름 전부 명단과 일치** | ✓ |
| `harness_gate_approve` 는 거절 전용 | 호출 → isError, 「Gate approval cannot be done over MCP — run … in the terminal」 | ✓ |
| MCP 로 게이트 승인·미승인 게이트 통과 불가 | 승인 도구 거절 전용 ✓ · phase 조작 도구 자체가 명단에 없음 | ✓ |
| 세션당 추가 컨텍스트 **~240 토큰** | session-start additionalContext 944자 ≈ **236 토큰**(chars/4; 3-M 의 토크나이저 실측과 동일 값) | ✓ |
| 비간섭: `.harness/` 없으면 4훅 전부 침묵 | session-start·pre-tool·post-tool·stop 전부 **exit 0 · 0바이트** | ✓ |
| 셸 게이트 **~4ms p95** (Node 기동 전 탈출) | n=100: **p50 3.93ms** · p95 7.64ms — 단 측정 시점 부하 17.9/10코어(외부 요인)라 p95 는 판정 유보. p50 은 광고와 부합 | ✓(p50)·유보(p95) |
| `npm audit --omit=dev` 취약점 0 | **0 vulnerabilities** | ✓ |
| 런타임 의존성 1개(`yaml`, 번들) | package.json dependencies = yaml 하나 · dist 커밋 · `npm ci` 없이도 CLI/MCP 동작 | ✓ |
| 설계 트랙 소스 쓰기 deny | `src/app.ts` Write → deny(영어) · `docs/design.md` 는 침묵 통과 | ✓ |
| 설계 트랙 배포성 Bash deny | `npm publish` deny · `fish -c 'npm publish'` deny | ✓ |
| 하네스 소유 파일 손편집 deny (「shell redirects, tee, sed -i 동일」) | 저널 직접·glob(`e*.jsonl`)·변수 조립(`$a$b`)·`cd` 접두 전부 deny · 통제군 `LOG=build/out.log; echo x >> $LOG` 침묵 통과 | ✓ |
| Stop: 미정산 종료 block + 「사소한 턴」 탈출구 | 활동 후 stop → block(탈출구 문구 포함) · `wave update` 후 stop → 침묵 | ✓ |
| UX 증적 게이트: 무증적·텍스트·1×1 거부, 실물 통과 | 무증적 거부 / note.txt 「not a visual artifact」 / 1×1 PNG 「(1x1) is too small … at least 200px」 / 320×240 PNG → **Wave completed** | ✓ |
| `doctor --repair` = 저널 재생 복구 | state.json 을 쓰레기로 덮음 → repair ok:true·repaired:true → status 정상 | ✓ |
| 명령군: 표의 11행 + design/tokens/evidence/loop/ship/profile/adr/doc/report/usage/migrate/trace | `--help` 의 명령군 **20개 전부 exit 0** · 광고 하위명령(gate submit/approve/verify/sweep/feedback · design link/sync/baseline/html · tokens gen/lint/swap · report rtm/hub · backtrack clear · ship verdict) 전부 help 에 실재 | ✓ |
| 스킬: P0–P6·P10–P12(P7–P9 없음을 문서가 먼저 시인) · 에이전트 5종 | 스킬 11개(P7–P9 없음 그대로) · researcher/design-auditor/wave-executor/wave-verifier/readiness-auditor 5종 | ✓ |
| config 표 기본값(profile generic·remote_control true·terse false·allowed prefixes `.harness/`,`docs/`) | `init` 생성 config 3키 일치 · session-start 문구가 prefixes 와 일치 | ✓ |
| 훅 자동 배선 4종 | hooks/hooks.json: SessionStart/PreToolUse/PostToolUse/Stop, `${CLAUDE_PLUGIN_ROOT}/bin/harness-hook` | ✓ (대화형 `claude plugin install` 완주는 미실행 — 3-M 과 동일 한계) |
| 알려진 한계의 부정 광고 없음(`make` 미해석 · 깊이 4+ 사슬 거부 등) | 4단 스크립트 사슬 → **deny** 실측 · 나머지는 문서가 한계로 먼저 시인 | ✓ |
| 「MCP 도구 설명·거절문은 영어로 남는다」 | 설명 16개 영어 ✓ · gate_approve 거절 영어 ✓ · **단 도구 오류문은 ko 에서 한국어** — 결함 2 참조 | △ |

없는 채널·없는 URL·없는 플래그의 광고: 발견 못 했다. 외부 링크는 superpowers(실재 공개 리포)와
표준 문서(keepachangelog·semver)뿐이고, 저장소가 비공개임을 4개 언어 모두 Support 절에서 밝힌다.

## 광고 수치 재현 — `npm run bench:hook` 직접 실행

**유휴 실행** (배포본 `pkg-ci`, 시작 시 부하 **2.62**/10코어 — 벤치의 busy 문턱 5.0 미만,
busy 배너 없음, exit 0):

| 항목 | README 광고 | 이번 실행 | 판정 |
|---|---|---|---|
| in-process 정상 p95 | 0.9 ms | **0.9 ms** | 일치 |
| in-process 폴백 p95 | 18.6 ms | 16.8 ms | 오차 내 |
| in-process 폴백 추가분 | +17.7 ms | +15.9 ms | 오차 내, G9 PASS |
| wall-time 정상 p95 | 77 ms | 75.6 ms | 오차 내 |
| wall-time 폴백 p95 | 102 ms | 105.9 ms | 오차 내 |
| wall-time 폴백 추가분 | +24.7 ms | +30.3 ms | 오차 내(문턱 50 의 61%), G9 PASS |
| `node` 기동 바닥 | 40 ms | p95 39.3 ms (p50 36.2) | 일치 |
| corrupt 형상 | (게이트 대상) | +5.4 / +18.8 ms — PASS | ✓ |
| all-state 형상 | recorded only | +43.0 / +464.7 ms — 「recorded only」 표기 그대로 | ✓ |

**두 표면을 다 찍는다(PROD-211)**: 실측 확인 — 표가 in-process 와 wall-time 을 형상마다 나란히
싣고, 기동 바닥값을 병기하며, 게이트는 추가분에만 건다. README 의 수치는 이 실행이 내놓는
수치와 같은 자리에서 나온다. **재현됨.**

**부하 중 「machine busy」 표기(PROD-212)**: CPU 스피너로 부하 36 을 만들고 재실행 —
busy 배너(「Every verdict below is marked "machine busy" — passes included」)가 뜨고 게이트
열이 전부 **`pass — machine busy`** 로 바뀌었다(초과뿐 아니라 충족도 유보). **실측 확인.**

부기: CHANGELOG [0.1.0] 의 「In-process p95 is 2.6 ms (18.9 ms …)」 는 이번 실행(0.9/16.8)과
README(0.9/18.6) 양쪽과 다르다 — 결함 3.

## 4개 언어 일치

- **구조**: 제목(h1–h3) 22개가 4개 언어에서 1:1 대응(순서 포함). 줄수 차(en 295 · ko/ja 293 ·
  zh 291)는 포맷 차이일 뿐 절 누락 없음.
- **수치**: 0.9 · 18.6 · 77 · 102 · 40 · +17.7 · +24.7 · 1284 · 1268 · 16 · ~240 · 문턱 50 ·
  ~4ms · 3× — 전부 4개 언어에서 **동수 출현**(grep 대조). 언어마다 다른 숫자 없음.
- **주장**: MCP 16개 명단, 설정 표 9키, 알려진 한계 9항목, 벤치 일화의 「벤치마크가 아니라
  일화」 정직 고지, 비공개 저장소 표기 — 전부 동일.
- **유일한 변주**: ja 의 `lang` 행에만 「日本語環境では `ko`（韓国語）も選べる」 한 문장이 더
  있다 — 실질 동일 주장(일본어 로케일을 광고하지 않음), 허위 아님. 결함으로 세지 않는다.

## 버전 고정 — 일곱 표면

| 표면 | 값 |
|---|---|
| `package.json` | 0.1.0 |
| `.claude-plugin/plugin.json` | 0.1.0 |
| `.claude-plugin/marketplace.json` (metadata·plugins 양쪽) | 0.1.0 |
| `CHANGELOG.md` | `[0.1.0] — 2026-08-23` |
| `harness --version` (배포본) | `king-wjang-harness v0.1.0` · exit 0 |
| MCP `serverInfo.version` (배포본 실측) | **0.1.0** — 3-M 의 0.0.1 하드코딩이 [PROD-222] 로 package.json 단일 원천화(`mcp/server.js:19`), 실패 시 `unknown` 정직 폴백까지 확인 |
| **`package-lock.json`** (배포본 동봉) | **0.0.1 ×2 필드** — 결함 1 |

릴리스 고정의 실체: `git tag -l` **0개**, `main` 은 여전히 `.omc`·`docs`·`progress.md` 뿐
(제품 없음), remote 미설정 — 3-M 결함 3 과 동일 상태. 태그·푸시는 **사용자 결정 대기**로
지시서가 밝혔고, 어떤 표면도 태그·공개 저장소가 「있다」고 광고하지 않으므로(비공개 고지 4개
언어 실재) 이번 라운드에 허위 광고 결함으로 세지 않는다. 다만 v0.1.0 의 정체가 미병합 브랜치의
파일 내용으로만 존재한다는 잔여 리스크는 그대로다 — 배포를 시작하는 순간 닫아야 한다.

## 배포본 위생 — export-ignore 실측

`git archive HEAD` 추출 결과:

- **부재 확인**: `progress.md` · `docs/release-readiness` · `docs/appraisal` · `docs/superpowers`
  · `.claude` · `.codesight` 전부 없음. `docs/` 디렉토리 자체가 배포본에 없다. README 와
  반대되는 출하 판정 문서의 반출 없음 — 대신 README·CHANGELOG 가 「not-ready」를 표면에서
  직접 시인한다(정직 방향 유지).
- **동봉 확인**: `.claude-plugin/`(manifest 2종) · `hooks/hooks.json` · `core/dist/`(sha 일치)
  · `bin/` · `mcp/` · `scripts/bench-hook-latency.mjs` · md 25개 전부 제품 표면(README 4 ·
  CHANGELOG · 스킬 11 · 에이전트 5 · 프로파일 가이드 4).
- 배포본에서 `npm ci --ignore-scripts` exit 0 · `npm test` 1268 green · bench 구동 — 전부 통과.

## 발견 결함

1. **[MEDIUM] 배포본의 `package-lock.json` 이 아직 0.0.1 — 일곱 번째 버전 표면이 릴리스와 다르고, 소스 설치 첫 걸음에 트리가 더럽혀진다.**
   재현: `git show HEAD:package-lock.json | head -12` → `"version": "0.0.1"` ×2 (루트·`packages.""`,
   `license` 필드도 없음). 클론에서 README 개발 경로 그대로 `npm install` → npm 이 잠금파일을
   0.1.0 으로 재작성 → **건드린 적 없는 추적 파일이 `git status` 에 M 으로 뜬다.**
   왜 결함인가: 이 축이 세 라운드 연속 지적한 「같은 리포의 두 표면이 다른 버전을 말한다」의
   잔재다. [PROD-222] 가 「버전을 두 벌로 두지 않는다」며 serverInfo 를 단일 원천화했지만,
   잠금파일은 릴리스 컷에서 재생성되지 않았다. `npm ci`·플러그인 설치 경로는 무사하다(exit 0
   실측)는 점에서 좁지만, 소스 설치자 전원이 첫 명령에서 만나는 표면이다.
   처방: `npm install --package-lock-only` 로 잠금파일을 0.1.0 으로 재생성해 릴리스 컷에 포함.
   버전 bump 시 잠금파일 동기화를 검사하는 테스트 한 줄(이미 있는 surface-parity 계열에 추가)이
   재발을 막는다.

2. **[LOW] 「MCP 도구 설명·거절문은 영어로 남는다」의 「거절문」이 실측과 어긋나는 넓은 읽기를 허용한다.**
   재현: `lang: ko` + `HARNESS_LANG=ko` 양쪽 설정 → 도구 설명 16개 영어 ✓ · `harness_gate_approve`
   거절 영어 ✓ — 그러나 `harness_node_bump`(없는 id) → isError 본문이 **한국어**(«노드 NOPE-1 가
   원장에 없다»). 왜 결함인가: 3-M 결함 2 의 허위 근거(「ko 문자열이 MCP 번들에 없다」)는
   삭제됐고 좁은 읽기(설명 + gate_approve 전용 거절)로는 문장이 참이지만, isError 응답 일반을
   「거절문」으로 읽은 독자는 한국어 오류를 받고 문서와 어긋난다고 여긴다. ko 사용자에겐 유리한
   방향의 부정확이라 LOW. 처방: 「도구 설명과 게이트 승인 거절문은 영어로 남고, 도구 호출의
   오류문은 `lang` 을 따른다」로 한 문장 정밀화(4개 언어).

3. **[LOW] 같은 릴리스의 두 표면이 다른 in-process 수치를 현재형으로 말한다.**
   관측: CHANGELOG [0.1.0] 「In-process p95 **is** 2.6 ms (18.9 ms on the journal-replay
   fallback…)」 vs README 4종 「0.9 ms / 18.6 ms」. 이번 실측은 0.9/16.8 — README 쪽이 맞다.
   왜 결함인가: 버그 신고에 CHANGELOG 를 읽고 오는 사람이 두 「현재」 수치를 만난다. 처방:
   해당 불릿을 측정 시점 과거형으로 고치거나(「at the time of that fix」), 최종 벤치 값으로 갱신.

4. **[LOW] §4-3 인용의 대상 문서가 배포본에 없다.**
   관측: README 4종 MCP 절 + `skills/phase-p12-ship/SKILL.md:97` 이 「§4-3」 을 인용하는데,
   그 절이 사는 문서(`docs/release-readiness/2026-08-21/…`)는 export-ignore 로 배포본에서
   빠진다. 설치자는 다섯 표면에서 해석 불가능한 절 번호를 만난다. 처방: 절 번호 대신 실제
   장치를 지목(「the TTY lock — approval needs a human terminal」)하거나 번호 삭제.

5. **[LOW · 3-M 결함 5 이월, 무변경] 배포된 메인 스킬이 배포본에 없는 `verify` 스킬을 가리킨다.**
   관측: `skills/king-wjang-harness/SKILL.md:26,112` — verify 는 export-ignore 된 `.claude/`
   의 리포 전용 스킬. 해당 분기(「하네스 자체를 개발할 때」)가 설치자와 무관하므로 LOW 유지.

## 직전 라운드 대비 (3-M 4.3 → 4.6)

**닫힌 것 (전부 실측 확인)**:
- 3-M 결함 1 (MCP serverInfo 0.0.1, MEDIUM) → **닫힘.** package.json 단일 원천 + `unknown`
  정직 폴백([PROD-222]), initialize 실측 0.1.0.
- 3-M 결함 2 (「ko 문자열이 MCP 번들에 없다」 허위 근거, LOW–MEDIUM) → **핵심은 닫힘.** 허위
  근거 문장이 삭제되고 주장이 실측 가능한 범위로 축소됐다. 잔여 애매함은 결함 2(LOW)로 강등.
- 3-M 결함 4 (CHANGELOG `### Added` 중복) → **닫힘.** 두 번째 절이 「Added — earlier in the
  same release (round 3-I)」 로 구분됐다.
- 이번 라운드 신설 검증: 벤치 두 표면(PROD-211) 재현 ✓ · busy 표기(PROD-212) 실측 ✓ ·
  테스트 수 광고가 1268→1284 로 갱신되고 자릿수까지 재현 ✓.

**남은 것**: 3-M 결함 3 (릴리스 고정 부재 — 태그 0·main 무제품·remote 없음) — 상태 무변경이나
사용자 결정 대기로 명시돼 허위 광고는 아님(버전 고정 절 참조) · 3-M 결함 5 (verify 포인터) 무변경.

**새로 잡힘**: package-lock 0.0.1(결함 1 — 전 라운드 미검 표면) · CHANGELOG/README 수치 불일치
(결함 3) · §4-3 인용(결함 4).

## 못 잰 것 (정직 고지)

1. 셸 게이트 **p95** ~4ms: p50 3.93ms 로 방증했으나 p95 측정 시점(7.64ms)에 외부 부하
   17.9/10코어가 있었다 — 벤치 자신의 busy 규율에 따라 판정 유보, 결함으로 세지 않음.
2. 대화형 `claude plugin marketplace add`/`install` 완주: 이 환경에서 불가 — hooks.json ·
   manifest · MCP 서버를 직접 구동해 대신 검증(3-M 과 동일 한계).
3. Claude 데스크톱 앱 동일 동작 주장: 관측 수단 없음.
4. ja/zh 번역 전문의 축자 검증: 구조·수치·핵심 주장·한계·지원 절만 대조했다.
5. ~240 토큰의 상한(활성 웨이브 + 지시문 주입 시): P0·무웨이브(236)만 쟀다.

## 마감 확인

- **감정 시작 시점(12:12)** `git status --porcelain` **비어 있음**, 워킹트리
  `core/dist/cli.js` sha256 = `d9c601d5…` 지시서 값과 일치 — 둘 다 확인하고 시작했다.
- **종료 시점(12:36)** 워킹트리에는 **병행 중인 다른 세션의 [SEC-233] 진행 중 작업**이 떠
  있다: ` M core/src/cli.ts` · ` M core/src/bashwrite.ts` · ` M core/dist/cli.js`(재빌드,
  워킹트리 사본 sha `01f000be…` 로 전진) — 이 감정이 만들지 않았고, 같은 시간대에 `round3n/`
  에 타 축 보고서 4건도 생성됐다. 추가로 `?? docs/release-readiness/2026-08-21/round3n/`
  (본 보고서 포함 라운드 디렉토리). **이 감정의 쓰기는 본 보고서 파일 하나뿐이다.**
  커밋·스테이징·푸시·태그 없음.
- **감정 대상의 dist 는 불변**: `git show HEAD:core/dist/cli.js` = `git show
  a08ec18:core/dist/cli.js` = 감정에 쓴 아카이브 사본 = 전부
  `d9c601d56631bffdfdea290ac61a8dcbbd92a6ae195d6a918d40de36d1c60249` — 지시서 값과 일치.
  모든 실측은 이 커밋본 아카이브에서 나왔으므로 병행 편집의 영향이 없다.
- 모든 실행·산출물은 scratchpad 샌드박스(`sbx3n/`)에서 이뤄졌다. 부하 유도용 CPU 스피너는
  측정 직후 전부 종료 확인.
