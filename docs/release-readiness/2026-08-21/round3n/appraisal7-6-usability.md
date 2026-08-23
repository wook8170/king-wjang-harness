# [6] 사용성 감정 — 4.5/5

**점수** 4.5 · **4.8 충족** ✗ (루브릭 명시 조건 4건은 전건 measured 충족이나, 잔여 감점에 MED 2건 — ① 3-M 의 MED(하네스 해제 문 오진·처방 부재·문서 0건)가 **대장에 등재조차 되지 않은 채** 그대로 이월됐고 ② 신규로 「교차 그룹 플래그 무음 삼킴」을 발견 — 파서가 자기 입으로 "unknown flag is never applied" 라 말하면서 다른 명령군의 플래그는 조용히 버리고 exit 0 으로 성공한다) · **감정 시각** 2026-08-23 12:29 KST · **대상** HEAD a08ec18 (감정 종반 docs-only 커밋 6091a30(progress.md 단독)이 얹힘 — `core/dist/cli.js` sha256 `d9c601d5…` 동일, 코드 표면 무변경. 실측 전건은 커밋된 dist 로 수행)

**한 줄**: 걸어 본 왕복은 전부 닫힌다 — 게이트·역행·정산·손상 복구·정책 재고정·배포 개방까지 막힌 자리마다 다음 수가 실재하고 실제로 통한다. 그러나 직전 라운드 사용성 보고서의 결함 8건 중 7건이 손도 대지지 않은 채(대장 등재 0건) 이월됐고, 그 위에 「도움말이 광고한 것과 파서가 받는 것이 다른」 새 부류가 셋 나왔다.

## 조건별 실측

전부 mktemp 샌드박스(`scratchpad/usab.Np1NVG`), `CLAUDE_PROJECT_DIR` 주입, 커밋된 dist(`bin/harness` → `core/dist/cli.js`, 빌드 없음)로 직접 실행 [OPS-74].

| 조건 | 결과 | 실측 |
|---|---|---|
| `harness --help` exit 0 + 명령군 전부 나열 | ✓ | exit 0 · **20개 명령군 전부**(루브릭의 「13개」는 구판 기준). 핵심 흐름 요약·`--version`·ko 전환 안내 포함. `-h`·`help` 도 동일 exit 0 |
| 모든 명령군이 하위명령 안내 | ✓ | 20개 군 `--help` 전건 exit 0. 하위명령 있는 14개 군 전부에 미지 하위명령 `frob` 투입 → **전건 exit 1 + 전체 하위명령 목록**. 미지 명령 exit 1 + 오타 제안(`stauts` → "Did you mean `harness status`?") |
| 침묵 성공 0 | ✓ | 변이 명령 성공 전건이 결과 ≥1줄(init 2줄, wave create 는 id, deploy 는 기록 요약 등). 필수 인자 누락 23형 전수 → **전건 exit 1 + 메시지**(표는 아래). 유일한 무설명 exit 0 은 `design inventory` 빈 결과(이월 결함 13) |
| 첫 실행 온보딩 존재 | ✓ | `init` 이 다음 수(`harness --help`)와 보안 주의(approve 허용목록 금지) 출력 · 미초기화 `status`/`gate` → "run `harness init` first" · env 없이 cwd 만으로도 init 동작 · SessionStart 가 페이즈·차단 규칙·다음 수 주입 |

추가 실측: 훅 4종(`session-start`·`pre-tool`·`post-tool`·`stop`) stdin 구동 전건 정상. 쓰레기 stdin → exit 0 침묵 + `hook-errors.log` + `doctor` 경고 표면화. `.harness` 없는 프로젝트 훅 완전 침묵(출력 0·파일 생성 0). ANSI 이스케이프 0(NO_COLOR 무의미하게 통과). `HARNESS_LANG=ko`(CLI·훅 거부문·오타 제안까지)·`config.yaml lang: ko` 양쪽 동작, 기본 영어, 미지원 `ja` 는 영어 폴백. 비ASCII 경로(`…-한글 프로젝트`, 공백 포함)에서 init·deny 정상. 한국어+이모지 turn log 기록 정상. MCP initialize → `version: "0.1.0"`(3-M 결함 5 = PROD-222 **수정 확인**) · tools/list 16종.

## CLI 계약 전수

명령군 × 계약 4항. help = `--help` exit 0 · sub = 미지 하위명령이 exit≠0 + 목록 · miss = 필수 인자 누락 시 exit≠0 + 메시지(침묵 성공 0) · 실측 명령은 대표 표기.

| 군 | help | sub | miss(대표 실측) | 비고 |
|---|---|---|---|---|
| init | 0 | — | 재실행 → exit 1 "already initialised" | 온보딩 2줄 |
| status | 0 | — | — | 손상 시 exit 1 + `--repair` 처방 |
| doctor | 0 | — | — | `--accept-policy` env 없이 exit 1 + 정확 거부문 |
| phase | 0 | ✓(usage) | `set` 무인자·`P99` → exit 1 + 전체 페이즈 목록 | |
| gate | 0 | ✓ | submit 무paths·무phase 전건 exit 1 | |
| wave | 0 | ✓ | create 무goal·activate 무id·update 빈 텍스트 exit 1 | |
| node | 0 | ✓ | upsert 무id exit 1 · **bump 무id → "Node undefined is not in the design ledger"(결함 4)** | |
| trace | 0 | — | 무인자 → exit 1 + usage | |
| report | 0 | ✓ | **packet 무인자 usage 가 딴 명령을 가리킴(결함 3)** | |
| doc | 0 | ✓ | upsert 무인자 exit 1 · **url 무인자 → "Document undefined…"(결함 4)** | |
| adr | 0 | ✓ | propose/decide 무인자 exit 1 + usage | |
| design | 0 | ✓ | link 무인자 exit 1 · **baseline 무인자 → "undefined 는 UX- 로…"(결함 4)** | inventory 는 결함 13 |
| tokens | 0 | ✓ | gen 원천 없음 → 스켈레톤 통째 출력(복붙으로 왕복 성공) | |
| evidence | 0 | ✓ | spec 무인자 exit 1 | |
| loop | 0 | ✓ | attempt·raise 무인자 exit 1 · raise 성공 exit 2 는 출력이 계약을 설명 | |
| ship | 0 | ✓ | defect add·deploy 무인자 exit 1 · **update `--status fixing` 거부(결함 2)** | |
| profile | 0 | ✓ | bare → exit 1 + 목록 | cmd 미설정 시 파일 경로 처방 |
| usage | 0 | ✓ | `tier 90`(위치 인자) exit 1 + `--percent` usage | 10% 하향 왕복 동작 |
| backtrack | 0 | — | 무인자 → usage + **끝내는 문 `clear` 동봉** | |
| migrate | 0 | — | — | advice-only 명시, 실제 ~/.claude 훅 4건 검출 |

플래그 계약: 미지 플래그(`--frobnicate`) 8개 군 전건 exit 1 + "never applied" 문구 + `--help` 안내. 근거리 오타 제안 동작(`--rational`→`--rationale`, `--milestone2`→`--milestone`, `--ref`→`--refs`). **단 전역 어휘에 있는 플래그는 그룹 무관 통과 — 결함 1.** 광고 어휘 스팟체크: gate `--evidence claimed|code|measured` ✓ · ship severity 4종 ✓ · loop reason 4종 ✓ · **ship defect status 는 help 6종 vs 파서 4종 ✗(결함 2)**.

## 거부문 왕복 검증

만든 거부 → 그 자리 안내를 그대로 따름 → 실제로 풀리는가.

| 거부를 만든 방법 | 그 자리 안내 | 왕복 |
|---|---|---|
| `phase set P1` (P0 게이트 없이) | "Start with the earliest: `gate submit P0` → `gate approve P0`" | **O** — 그대로 쳐서 P1 도달 |
| `gate submit` 없는 파일 | "check the path, or write the document first" | O |
| 12자 문서 제출 | "12 … below the 80 minimum" 숫자 명시 | O — 실질 내용으로 통과 |
| 템플릿 복제 제출(P3, 신규 15자) | "gate P0, P1, P2 has not already reviewed … editing a few characters does not make a reviewed document a new one" — 원인·기준 정확 | **O** — 실질 신규 프로즈로 P3~P9 전건 통과 |
| TTY 없이 `gate approve` | 원인(에이전트 호출 형태) + 사람용 명령 + `HARNESS_APPROVE_NO_TTY=1` 탈출구 | **O** — env 로 승인됨 |
| `backtrack` 무인자 | usage + `backtrack clear` | O |
| [UTIL-189] 역행 왕복 | backtrack P0 → `phase set P0` 안내 → 전진 P1 → `clear` | **O** — 전 구간 완주, 막다른 골목 재발 없음 |
| Stop(턴 미정산, 활성 웨이브) | `wave update "<did/next>"` + 사소 턴 탈출구 | **O** — update 후 allow · 재발화(`stop_hook_active`) 탈출구도 allow 실측 |
| `wave create --refs UX-1` 미등록 | `node upsert` 를 CLI·MCP 양형으로 | O |
| UX 웨이브 complete, 증거 0건 | 정확한 절대경로 + "Put a screenshot"(절반 광고 — 이월 결함 9) | O — 스크린샷 경로 따르면 통과 |
| 증거 txt 만 | "not a visual artifact — png/jpg/webp or an exported HTML mockup" | **O** — html 목업으로 complete |
| `doc url` 비 claude.ai 주소 | 왜 안 되는지 + 정확한 URL 형식 예시 | **O** — claude.ai 주소로 등록됨 |
| `tokens gen` 원천 없음 | 최소 유효 문서를 에러 안에 통째로 | **O** — 복붙만으로 gen 성공(css·ts·tailwind 3종) |
| yq -i 로 config 쓰기 | 원인(자기 무장해제) + "사람이 터미널에서" | **O** — 사람 편집 → doctor 드리프트(해시 두 벌 명시) → env 없이 accept-policy 정확 거부 → `HARNESS_ACCEPT_POLICY=1` 재고정 → 클린. YAML 중복 키는 줄·칸·캐럿까지 |
| state.json 손상 | status 가 exit 1 + `doctor --repair` 처방, deny 말미 `[state damaged …]` 부착 | **O** — repair 로 페이즈·웨이브 복원 |
| 손상 + 저널도 오염 | repair **refuse** + "find out why … To repair anyway, use --force" | **O** — `--force` 로 복구, 이후 doctor 는 저널 경고만 유지(정직) |
| P10 에서 `npm publish`(게이트 미승인) | "`gate submit P10 --evidence measured --paths <artifacts>`" | **O** — claimed 제출 → approve 가 "measured 필요(Iron Rule §3-4)" 거부 → measured 재제출 → 승인 → **같은 명령 ALLOW** (dry-run 도 ALLOW) |
| P10 새 파일 Write | 두 갈래 탈출(backtrack P7 / `ship defect add`) | O — defect add 실측 |
| `ship verdict` NO-GO | 사유 2건 각각에 명령·절대경로 | O — checklist 와 동일 사유 일관 |
| `loop critical raise` | exit 2 의 의미 + `critical clear` | O — clear 왕복 |

새 강제면(3-M 이후 diff) 발화 + 과차단 짝: [SEC-221] `yq -i` DENY / `sort`·`awk` 조회 ALLOW · [EFF-227] `tmpfile=$(mktemp); echo > $tmpfile` ALLOW · [EFF-231] `npm publish --dry-run` ALLOW / `--dry-run; npm publish` 는 뒷줄 DENY(사면 없음) · [ENG-226] `sh -c 'cd src && echo x > app.ts'` DENY(원인 정확) / `echo 'a && b; c'` ALLOW · [QUAL-229] 절 삭제 후에도 `$(echo .harness)/…` 경로 DENY 유지. 과차단 프로브 16종(문서·설정·git·npm·tee·/dev/null·조회·백업·$HOME·tsc·curl 등) 중 15 ALLOW — 유일한 deny 는 `src/app.test.ts` 로, 차단 자체는 프로파일 우선이라 옳으나 **거부문이 자기모순**(결함 5).

**막다른 골목**: 이번에 걸은 지점 중 탈출구 없는 곳은 3-M 과 동일하게 **해제(off-ramp) 하나**(결함 7). 새 왕복 사고는 발견하지 못했다.

## 첫 실행 워크스루

빈 디렉토리에서 아무 맥락 없는 사람 페르소나로: `status`(→ init 하라) → `init`(온보딩 2줄) → session-start 주입(페이즈·차단 규칙·다음 수·remote-control 안내) → 첫 Write 거부(원인 = 프로파일 glob 명시, 쓸 수 있는 곳 목록) → 문서 작성 → `gate submit P0` 거부 사슬(없는 파일 → 12자 → 통과, 각 단계가 다음 수 제시) → 패킷 경로 + DOC 등록 안내 → no-TTY 거부 → env 탈출구로 승인 → P1. 이어 P3~P10 게이트 사슬·웨이브 2개·UX 증거·역행·손상 복구·정책 재고정·배포 개방·verdict NO-GO 까지 완주. **막힌 모든 자리에서 다음 수가 그 자리 메시지에 있었고, 문서를 열지 않고도 진행 가능했다.** 유보: 실제 Claude Code 플러그인 설치 흐름(`claude plugin …`)과 진짜 TTY 승인 다이얼로그는 미실측(훅은 전부 stdin 직구동, 승인은 문서화된 env 로 대체) — 3-M 과 같은 한계.

## 발견 결함

**신규 6건** (이번 라운드 발견 — 전건 커밋 dist 로 재현):

1. **MED — 교차 그룹 플래그 무음 삼킴: 파서가 자기 문구를 위반한다.** `unknownFlags`(`core/src/cli.ts:141`)가 그룹별 어휘가 아니라 **전역** `VALUE_FLAGS`/`BOOL_FLAGS` 로 판정한다. 재현: ① `harness wave create --goal g --reason r` → **exit 0 성공**(wave 생성), `--reason`(backtrack 의 플래그) 소리 없이 소실 ② `harness node upsert --id N --title t --evidence measured` → 성공, `--evidence` 소실 ③ 가장 자연스러운 오타 `harness gate submit P1 --path <f>`(단수) → `--path`(doc upsert 의 플래그)가 삼켜지고 "No artifacts to review" 로 **원인과 다른 메시지**(진짜 미지 플래그 `--frobnicate` 는 정확히 잡히므로 대비가 극명). 부수: 제안 엔진도 전역 어휘라 `adr decide --why` → "did you mean `--sha`?"(adr 에 --sha 없음). 왜 결함인가: 가드 자신이 "An unknown flag is never applied — accepting it silently would record something other than what you asked for" 라 인쇄하는데, 교차 그룹 부류(CLI 전 플래그 어휘 ~30종)에서 정확히 그 일이 일어나며 ①②는 exit 0 이라 **알 길이 없다**. 처방: `unknownFlags`/`nearestFlag` 에 해당 명령군의 어휘를 넘겨 판정한다(전역 어휘는 폴백 제안용으로만).

2. **LOW — `ship defect update` 의 광고 어휘 ≠ 파서 어휘.** `core/src/help.ts:182` 는 `--status <open|fixing|fixed|verified|rejected|deferred>`(6종)를 광고하는데 `core/src/ship.ts:84` `DEFECT_STATUSES` 는 4종(`open, fixed, verified, deferred`). 재현: `--status fixing`·`rejected` 전건 "Invalid defect status" exit 1. 에러가 실 어휘를 나열해 즉시 복구되나, **도움말을 믿고 친 첫 시도는 반드시 실패**한다(축 6 이 물어야 할 「광고된 것을 파서가 읽는가」의 반례). 처방: help 를 `DEFECT_STATUSES` 에서 파생(이 리포가 셸 목록에 여섯 번 적용한 바로 그 교훈 — 손 사본은 낡는다).

3. **LOW — `report packet` 무인자 usage 가 다른 명령을 가리킨다.** `core/src/cli.ts:1052` 가 `requirePhase(rest[0], 'harness evidence packet', lang)` 로 **잘못된 명령 이름**을 넘긴다. 재현: `harness report packet` → "Usage: `harness evidence packet <phase>`" → 그대로 치면 그 명령은 다른 서식(`--ux <UX-x>`)이라 또 실패. 두 번째 usage 로 복구는 되지만 3-M 이 「실재하지 않는 B = 0」으로 세었던 부류의 반례다(명령이 실재는 하되 **다른 문**이라 기계 추출망이 놓쳤다). 처방: `'harness report packet'` 으로 교체.

4. **LOW — 필수 인자 누락을 값 오류로 오진하며 `undefined` 를 노출하는 명령 3개.** `node bump` → "Node undefined is not in the design ledger" · `doc url` → "Document undefined is not in the registry" · `design baseline` → "undefined 는 UX- 로 시작하는…". 셋 다 exit 1 이라 침묵은 아니나, 원인 서술이 틀렸고(누락 ≠ 미등록) JS 내부값이 사용자 문장에 박힌다. 형제 명령들(`wave activate` 등)은 "Missing argument — usage: …" 로 정확하다. 처방: 인자 부재를 usage 분기로 선행 처리.

5. **LOW — `src/` 아래 테스트명 파일의 거부문이 자기모순.** 재현: 설계 트랙에서 `Write src/app.test.ts` → deny 문이 "…is blocked because it matches the source paths…"(원인 정확) 직후 "Writable: … files **named** as tests (`*.test.*`, …)" 를 광고 — **거부된 파일 자체가 그 이름 규칙에 맞는다.** 우선순위 단서("the profile's source paths win over all of these")는 SessionStart 주입문에만 있고 거부문에는 없다. 에이전트가 광고를 믿고 `src/` 안에서 이름만 바꿔 재시도하는 헛수고 경로. (경계 실측: `test/app.test.ts`·`tests/unit/foo_test.py` 는 ALLOW — 차단 자체는 옳다.) 처방: 대상이 테스트명 규칙에 맞을 때는 거부문에 우선순위 단서를 붙인다. `core/src/hook.ts` deny writable 목록 문구.

6. **LOW — `harness hook <미지 이벤트>` 손 실행이 완전 침묵 exit 0.** 재현: `… | harness hook PreToolUse` → 출력 0·exit 0, `hook-errors.log` 에 `unknown-hook-event` 한 줄, `doctor` 경고로만 표면화. `hook --help` 는 4개 이벤트를 적지만 **틀린 이름을 친 그 자리 피드백은 0** 이다. 왜 결함인가: 구현자 자신이 이번 웨이브에 이 함정으로 「차단이 전부 풀렸다」는 잘못된 결론을 냈다고 자인했다(progress.md 시스템 지식 절) — 관측된 실제 비용이 있다. 「항상 exit 0」 계약은 플랫폼 호출용이고, 플랫폼은 미지 이벤트 이름을 보내지 않으므로 **미지 이벤트일 때만** stderr 한 줄을 내도 계약이 깨지지 않는다. 처방: unknown-hook-event 분기에서 stderr 로 이벤트 이름 4종 안내(stdout 은 계속 침묵).

**이월 7건** (3-M appraisal6-6 발견분 — 이번 HEAD 에서 전건 재현·미수정. **대장에 등재 자체가 안 됐다**: `ledger.md` 에 `appraisal6-6-usability` 인용 0건. 같은 라운드 다른 축 보고서의 결함은 전건 등재·처리(SEC-221·PROD-222~225·ENG-226·EFF-227·COST-228·QUAL-229…)됐으므로, 사용성 축 보고서만 트리아지에서 누락된 **프로세스 결함**이다. 유일한 예외 3-M 결함 5(MCP 버전)는 축 7 경유(PROD-222)로 수정 확인):

7. **MED [이월=3-M 결함 1] — 하네스 해제 시도를 오진하고, 실재하지 않는 처방을 가리키며, 진짜 문은 어디에도 안 적혀 있다.** 재현(이번 HEAD): pre-tool `rm -rf .harness` → ".harness/state.json can only be changed by harness commands — editing it by hand desynchronises the journal from the state." (a) 행위는 편집이 아니라 **해제**(오진) (b) 해제하는 harness 명령은 존재하지 않음(처방 부재) (c) 의도된 사람 탈출구(루브릭 개정 1)가 README 4개 언어판·SKILL.md 어디에도 없음(`uninstall|opt-out|rm -rf .harness` grep 0건). `core/src/hook.ts:1068`.
8. **LOW [이월=결함 2]** — `echo F >> $(echo .harness)/events.jsonl` 거부문의 대상 표시가 `` `$` `` 한 글자로 뭉개짐. 재현 동일.
9. **LOW [이월=결함 3]** — 증거 0건 거부문이 "Put a screenshot" 만 광고(html 목업도 게이트를 여는데 첫 거부문은 절반만). `core/src/wave.ts:299`.
10. **LOW [이월=결함 4]** — SKILL.md 의 UX 게이트 함정 설명이 구판 계약("file of size > 0" — 실측상 txt 는 못 연다). `skills/king-wjang-harness/SKILL.md:98`.
11. **LOW [이월=결함 6, 확장]** — SessionStart 「다음 수」가 트랙 무관 고정 문구. P10 실측: "In the design track, write your design docs…" 만 나오고, **빌드·출하 트랙은 트랙 브리핑 자체가 없다** — 출하 트랙의 실재 규칙(새 파일 금지)을 세션 첫 주입이 말하지 않아 첫 deny 로만 학습된다. `core/src/hook.ts:534`(다음 수)·`:459`(설계 트랙만 브리핑).
12. **LOW [이월=결함 7]** — 증거 이중 잣대 무예고: `wave complete` 는 html 목업 인정, `ship verdict` 는 같은 웨이브에 "no real-run capture — leave headless 2x screenshots" 재방문 요구(이번 verdict 실측에 그대로 출현). `core/src/ship.ts:605`.
13. **LOW [이월=결함 8]** — `design inventory --from` 마커 없는 HTML → `{"components":[],"total":0}` 무설명 exit 0. 재현 동일.

## 직전 라운드 대비 (3-M 4.6 → 3-N 4.5)

- **좋아진 것**: MCP `serverInfo` 0.1.0(수정 확인). 이번 라운드가 넓힌 강제면 5부류(SEC-221·EFF-227·EFF-231·ENG-226·SEC-219) 전부 정확한 거부문 + 과차단 짝 통과로 실측 — 강제 확장에 안내가 계속 따라오고 있다. 3-M 이 실증한 왕복(역행 루프·정산·정책 재고정·손상 복구·배포 개방)은 이번 재실측에서도 전건 유지. 저널 오염 시 repair refuse → `--force` 안내 왕복은 이번에 새로 실측해 닫힘 확인.
- **나빠진/드러난 것**: ① 3-M 사용성 보고서의 결함 8건 중 7건이 **대장 미등재로 무처리 이월** — MED(해제 문)가 두 라운드째 열려 있다. ② 신규 MED 1(교차 그룹 플래그 무음 삼킴)과 「광고 ≠ 파서」 부류 신규 LOW 2(defect status 어휘·report packet 오지시) — 도움말·거부문이 가리키는 B 를 전수 실측하는 이 축의 방법이 처음으로 도움말 자체의 거짓을 셋 잡았다.
- 잔여 감점 총계: 3-M MED 1 + LOW 7 → **3-N MED 2 + LOW 11**(이월 6 + 신규 5). 조건 4건 충족은 유지되나 감점의 무게가 늘어 0.1 하향.

## 못 잰 것 (정직 고지)

- 실제 Claude Code 플러그인 설치·실 세션 훅 배선(`claude plugin marketplace add`/`install`) — 훅은 전부 stdin 직구동. hooks.json 등록은 정적 확인만.
- 진짜 TTY 의 `gate approve` 권한 다이얼로그 — `HARNESS_APPROVE_NO_TTY=1` 로 대체 완주.
- 소스 빌드 경로(빌드 금지 지침) · bench 수치(부하 환경) · README ja/zh 번역 정합 · 다중 머신 저널 핸드오프.
- `migrate` 가 검출한 실제 사용자 훅 4건의 제거 이행(advice-only 출력 확인까지만 — 사용자 `~/.claude` 는 건드리지 않았다).

## 마감 확인

- **측정 종료 시각(12:29 KST) 기준**: `git status --porcelain` → `?? docs/release-readiness/2026-08-21/round3n/` 한 줄뿐(병행 감정자들의 축 2·4 보고서가 든 신규 디렉토리 — 추적 파일 변경 0) · 워킹트리 `core/dist/cli.js` sha256 = `d9c601d5…` 과업 명세와 일치. **실측 전건이 이 시점 이전에 완료됐다.**
- **보고서 작성 직후(12:3x KST) 재확인에서 병행 세션의 워킹트리 수정 개시를 관측**: `core/src/cli.ts`·`core/src/bashwrite.ts`·`core/dist/cli.js` 가 M 상태(합계 +266/-13줄, 워킹트리 dist sha `01f000be…`) — 본 감정자의 편집이 아니며(이 보고서 파일 하나만 썼다), 3-M 때와 같은 패턴(감정 도중 구현 세션 병행 가동)이다. **커밋된 표면은 무변경**: `git show HEAD:core/dist/cli.js` sha256 = `d9c601d56631bffdfdea290ac61a8dcbbd92a6ae195d6a918d40de36d1c60249`(과업 명세와 일치). 본 보고서의 실측·인용 줄번호는 전부 HEAD(a08ec18, +docs 커밋 6091a30) 기준이다.
- 리포 파일 수정·스테이징·커밋 없음(본 보고서 신규 1파일 제외).
- 샌드박스: `scratchpad/usab.Np1NVG`(+파생 2개) — 리포 밖, 정리 불요.
