# [6] 사용성 감정 — 4.5/5

**점수** 4.5 · **4.8 충족** ✗ (rubric 명시 4조건은 전건 충족했으나, 잔여 결함에 MEDIUM 2건이 남아 「잔여 감점 요인 LOW 이하」 조건 미달) · **감정 시각** 2026-08-23 (KST 기준 세션) · **대상** HEAD `078ce674142b128a843b9f176c629bda5eff6439` (git status clean, 리포 무수정)

**한 줄**: 막힌 자리마다 다음 명령을 정확히 이름 붙여 주는 표면이 완성 단계에 이르렀고 주요 왕복은 전부 완주되나, 역행 마커와 STALE 웨이브 두 흐름은 「시작하는 문」만 사용자 눈앞에 있고 「끝내는 문」이 숨어 있거나 아예 없다.

**동시 작업 고지**: 감정 도중 리포에 다른 세션의 작업이 진행됐다 — 시작 직후 docs-only 커밋 306f2e2 가 얹혔고(코드 무변경), 종료 직전(04:33–04:35 KST) `core/src/hook.ts`·`bashwrite.ts` 미커밋 수정과 dist 재빌드가 일어났다. **내 훅·CLI 실측은 전부 04:35 재빌드 이전의 커밋된 dist(= 대상 HEAD 078ce674 의 dist)에 대해 수행됐다** (dist mtime 04:35:11 대비 마지막 프로브 04:33 이전 확인). 진행 중인 미커밋 수정([SEC-213] 등)은 아래 U-7 관측을 닫으려는 것으로 보이나, 본 감정의 대상은 커밋 시점이다.

측정 환경: `mktemp -d` 샌드박스 3개(생애주기용·P0 과차단 프로브용·미init용), `cd <샌드박스>` + `CLAUDE_PROJECT_DIR=<샌드박스>` 동시 지정, 커밋된 `core/dist` 사용(빌드 안 함), 훅은 `bin/harness-hook <event>` stdin JSON 구동, MCP 는 `mcp/server.js` 에 JSON-RPC stdio 직결. 이전 라운드 감정 보고(round3i~3l)는 읽지 않았다.

---

## 조건별 실측

| 4.8 조건 (rubric) | 실측 | 판정 |
|---|---|---|
| `harness --help` exit 0 + 명령군 전부 나열 | exit 0 · 20개 명령 전부 나열(rubric 작성 시점 13개에서 증가) + Core flow 한 줄 + 언어 안내 | ✓ |
| 모든 명령군이 하위명령 안내 | 20개 전부 `<group> --help` exit 0. 하위명령 있는 14개 군은 서브커맨드 표 출력, 단일 명령 6개는 사용법 1줄 | ✓ |
| 침묵 성공 0 | 변이 명령 전수급 샘플(init·phase set·gate submit/approve/sweep·wave create/activate/update/complete·node upsert/bump·doc upsert/url/submit/approve·adr propose/decide·design link/sync·tokens gen·backtrack/clear·loop critical raise/clear·usage tier·doctor --repair) 모두 확인 출력 있음. 유일한 무출력은 훅의 「무결정=허용」(설계된 계약) | ✓ |
| 첫 실행 온보딩 존재 | `init` 이 `--help` 를 가리킴 · `--help` 에 Core flow · init 전 명령은 전부 "run `harness init` first" · SessionStart 가 에이전트에게 현 위치+다음 수 주입 | ✓ |

추가 실측:
- **훅 4종 stdin 구동**: session-start(주입문 확인) · pre-tool(Write/Edit/Bash 다수) · post-tool(활동 기록) · stop(차단→해소) 전부 동작. 깨진 stdin → exit 0 침묵 + `.harness/.runtime/hook-errors.log` 에 `corrupt-stdin pre-tool` 기록(관측 가능한 fail-open 실증).
- **비간섭**: `.harness` 없는 프로젝트에서 훅 4종 전부 무출력 exit 0.
- **성능 겉느낌** (측정 표면: 샌드박스 소저널, `/usr/bin/time` 로 sh 파이프 1회 호출, **부하 ~100 인 바쁜 머신**): real 0.13–0.14s ×3. 수치는 참고용으로만 적는다.
- **i18n**: `HARNESS_LANG=ko` 로 CLI 오류·훅 거부문 한국어 전환 확인. 기본은 영문.
- **state.json 파손 시**: `status` 가 파손 사실+`doctor --repair` 를 지목, degraded 상태에서도 pre-tool 이 저널 재생으로 **올바른 deny** 를 내리고 SessionStart 가 "⚠ state.json is damaged — running from journal replay. Run `harness doctor --repair`." 경고. `--repair` 후 phase 보존 확인.
- **MCP 왕복**: initialize→tools/list(16개, README 광고와 일치)→`harness_status`(실상태 반환)→`harness_gate_approve`(거부 + 터미널 명령 + `harness_gate_submit` 대안 안내, isError). 왕복 완주.
- **동봉 벤치** `npm run bench:hook`: 처음 받는 사람 눈으로 — 표 각 열에 라벨, 게이트 기준(fallback delta < 50ms p95)이 본문에 자체 정의돼 있고, node 기동 바닥이 절대치에 포함된다는 설명까지 자리에 있다. 특히 **머신 부하(load 108/10코어)를 스스로 감지해 판정 대신 "over — machine busy" + 재측정 안내를 출력** — 오판을 만들지 않는다. 출력 자족성 합격. (게이트 실판정은 못 쟀다 — 아래 정직 고지.)

## 생애주기 워크스루 (막힌 지점 · 그 자리 메시지 · 탈출 O/X)

P0 init → 설계 → 게이트 6개 → P7 웨이브 3개(UX 증거 포함) → 역행 왕복 → P10 배포 명령 개방까지 첫 사용자 시점으로 완주. 막힌 지점 전부:

| # | 막힌 지점 | 그 자리 메시지가 준 다음 수 | 탈출 |
|---|---|---|---|
| 1 | P0 에서 `src/app.ts` Write | 왜(프로파일 source_globs 명시)+뭐가 쓰기 가능한지+"Finish the design artifacts first" | O |
| 2 | `phase set P1` (게이트 미승인) | `gate submit P0` → `gate approve P0` 정확 지목, 가장 이른 게이트부터 | O |
| 3 | `gate submit P0` (빈손) | `--paths <a,b>` 지목 | O |
| 4 | 등록 안 된 문서로 submit | 성공하되 Note 로 `doc upsert → publish → doc url` 3단 지목 | O |
| 5 | `gate approve` (TTY 없음) | 사람이 터미널에서 + CI 용 `HARNESS_APPROVE_NO_TTY=1` 탈출구 명시 | O |
| 6 | 다른 페이즈 등록 문서로 submit | "DOC-1(P0)" 이라고 소속까지 밝히며 `doc upsert --phase P1` 지목 | O |
| 7 | 신규성 미달 submit (14자 < 80자) | 몇 자가 새로 왔는지 수치로, 어느 게이트가 이미 봤는지 명시 | O |
| 8 | `wave create` (goal 없음) | 사용법 + 왜 goal 이 필요한지 | O |
| 9 | Stop (턴 로그 미정산) | `wave update "<did/next>"` 정확 지목 + 사소 턴 탈출구 언급 | O |
| 10 | UX 웨이브 complete (증거 없음) | 스크린샷 넣을 **절대경로** 지목 | O |
| 11 | 가짜 PNG (헤더 8바이트) | 파일명+사유("cannot read the PNG header") | O |
| 12 | **914바이트 300×300 PNG** | "too small … at least 200px on each side" — **각 변 200px 을 이미 충족하는데 치수만 말함**. 실규칙(1024바이트 하한)은 메시지에 없어, 시키는 대로 다시 찍어도 단색 화면이면 영원히 못 나감 | **X** (결함 1) |
| 13 | `phase set P4` (역방향) | `backtrack P4 --reason` 지목 | O |
| 14 | STALE 웨이브 재활성화 | "새 웨이브를 열어라" + `--refs` 까지 채운 명령 | O (단 결함 5 참조) |
| 15 | `phase set P10 --force` | 잠금 사유 + `HARNESS_ALLOW_FORCE=1 …` 그대로 복사 가능한 탈출구 | O |
| 16 | P10 에서 `npm publish` (게이트 미승인) | `gate submit P10 --evidence measured --paths <artifacts>` 지목 | O |
| 17 | `doctor --accept-policy` (env 없음) | `HARNESS_ACCEPT_POLICY=1 …` 전체 명령 제시 | O |
| 18 | `tokens gen` (토큰 파일 없음) | 스키마 요약 + **복사해 쓰면 실제로 통과하는 최소 문서 전문** (붙여 넣어 실행 → tokens.css/ts/tailwind 3종 생성 확인) | O (모범) |
| 19 | `report packet` (인자 없음) | "Usage: `harness evidence packet <phase>`" — **엉뚱한 명령**이고, 그대로 치면 다른 문법의 2차 오류 | **X** (결함 3) |
| 20 | init 전 아무 명령 | "No .harness/ here — run `harness init` first." | O |
| 21 | `loop critical raise` | exit 2 의 뜻("사람 소환이지 실패 아님")과 닫는 명령 `critical clear` 를 그 자리에서 | O |

21곳 중 19곳 탈출 O. 오진하는 메시지 2건(#12, #19)이 이 축의 실점 핵심.

## 「A 를 막고 B 로 보낸다」 흐름의 왕복 완주 검증

거부문·스킬·README 에서 백틱 인용 `harness …` 명령을 기계 추출(55종·유니크 45개)해 **전수 실행** — 존재하지 않는 B 는 0 (전부 실명령). 그중 왕복이 있는 흐름은 끝까지 완주:

| A (막힘) | B (보내는 곳) | 왕복 완주 |
|---|---|---|
| 역방향 `phase set` | `backtrack <P> --reason` → `phase set <P>` → 복귀 `phase set P7` → `backtrack clear` | ✓ **직전 수리된 왕복이 실제로 돈다.** 단, clear 를 가리키는 문장이 본류 메시지에 없음(결함 2) |
| 게이트 앞 `phase set` | `gate submit` → (사람) `gate approve` | ✓ P0–P6·P10 총 8회 완주 |
| agent 의 `gate approve` | 터미널 / `HARNESS_APPROVE_NO_TTY=1` | ✓ env 로 실제 열림 |
| `--force` 잠금 | `HARNESS_ALLOW_FORCE=1` | ✓ 실제 열림 |
| `--accept-policy` 잠금 | `HARNESS_ACCEPT_POLICY=1` | ✓ 재핀 확인, 재실행 doctor 에서 경고 소멸 |
| config.yaml 쓰기 deny | 사람이 터미널에서 편집 → `doctor` 드리프트 경고 → accept | ✓ 완주 (부수 소득: 중복 YAML 키를 줄번호까지 짚는 경고) |
| 설계트랙 `npm publish` deny | "ship track (P10 onward)" → P10 미승인 deny → `gate submit P10 --evidence measured` → 승인 → **allow** | ✓ 3단 체인 끝이 실제로 열림 |
| UX complete deny | 증거 디렉토리에 캡처 | ✓ (정상 크기 PNG 로 완주 · 메시지 결함 1 별도) |
| state 파손 | `doctor --repair` | ✓ phase 보존 복구 |
| STALE 재활성화 deny | `wave create --refs …` | **✗ 반완주** — B 는 실행되지만 A 의 나그(nag)가 영원히 안 꺼짐 (결함 5) |
| `report packet` 인자 오류 | `evidence packet <phase>` (오기) | **✗** 2차 오류 (결함 3) |
| MCP `harness_gate_approve` | 터미널 명령 + `harness_gate_submit` | ✓ 대안 도구 실존 |
| 미설치 스킬(readiness) | 에이전트 문서가 "실패하면 멈추고 설치 요청하라" 명시 | ✓ (정직한 막다른 길 처리, README 한계 고지와 일치) |

**시작하는 문만 있고 끝내는 문이 안 보이는 흐름**: 2건 발견 — (1) 역행 마커: 끝문(`backtrack clear`)은 존재하나 사용자가 실제로 지나는 표면(역행 성공 메시지·SessionStart ⚠경고)에 없음, (2) STALE: 끝문 자체가 없음(설계상 영구 묘비인데 메시지는 "settle" 이라는 도달 불가 행동을 지시). 그 외 — escalation(raise/clear 대칭 노출), freeze(config 로 시작·해제), doc(submit/approve/revise), defect(add/update --status) — 는 시작·끝 모두 표면에 있다.

## 새로 생긴 과차단이 있는가

**없다.** P0(설계트랙, 가장 엄격한 상태)에서 정적 확장 문자가 든 정상 작업 12종 프로브:

- `rm -rf dist/*` (빌드 산출물 정리) · `echo hi > logs/run-$(date +%F).log` (로그 경로 조립) · `mkdir -p docs/{api,ui}` · `cat docs/*.md > docs/summary.md` · `cp README.md /tmp/backup-$(date +%s).md` · `echo x > "$HOME/x.txt"` · `echo done > out-*.txt` · `npm test` · `echo note | tee docs/note.md` · `find dist -name "*.js" -delete` — **전부 ALLOW(무간섭)**.
- DENY 는 부류가 맞는 것만: `npm publish`(배포류), `echo x > src/*.ts`(소스 글롭 실일치), `.harness/` 소유 파일 3종, P0 소스 확장자.
- 콜로케이트 테스트 `src/utils.test.ts` deny 는 「프로파일 소스 경로 우선」이라는 명시된 설계이고 `test/utils.test.ts` 라는 탈출구가 실제로 열려 있음 — 과차단으로 세지 않되, **그 자리 거부문이 자기모순**(결함 6).

과차단의 반대급부(교차 축 고지): 경로에 `$()` 가 들어가면 정적 해석을 포기하고 **허용**한다 — `echo x > src/$(echo app).ts` ALLOW, `echo x >> .harness/$(echo events).jsonl` ALLOW (bashwrite.ts 의 unresolvedTargets 는 파일명 리터럴만 소유 파일과 대조: `$(echo events).jsonl` ≠ `events.jsonl`). 과차단 최소화를 위한 의도된 절충으로 주석에 명시돼 있으나, 설계트랙 소스 가드와 저널 가드 양쪽이 치환 한 겹으로 뚫린다. **사용성 결함 아님 — 실효성(축 2) 재감정으로 이관할 관측.**

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

1. **[MEDIUM] U-1 · UX 증거 거부문이 바이트 하한을 숨기고 치수만 오진** — `core/src/evidence.ts:506-516` (판정 `size < 1024 || edge < 200` 은 508, 메시지 511-515). 재현: UX 참조 웨이브 활성 → 단색 300×300 PNG(914바이트)를 evidence 디렉토리에 → `wave complete` → "too small … at least 200px on each side" — 이미 충족한 치수를 고치라 한다. 1024바이트 규칙은 어떤 표면에도 없어 메시지만 따르면 탈출 불가.
2. **[MEDIUM] U-2 · 역행의 끝문이 본류 표면에 없다** — `core/src/cli.ts:1338-1343`(역행 성공 메시지) · `core/src/hook.ts:541`(SessionStart ⚠경고). 재현: `backtrack P4 --reason x` → `phase set P4` → `phase set P7` 복귀 → status 에 마커 잔존, 이후 **모든 세션**의 SessionStart 에 "⚠ Backtrack in progress" — 어느 메시지도 `backtrack clear` 를 말하지 않는다(인자 없는 오류문과 `--help` 에만 존재, [UX-193] 수리가 절반만 닿음).
3. **[MEDIUM(빈도 낮음)] U-3 · `report packet` 인자 오류문이 엉뚱한 명령의 사용법을 준다** — `core/src/cli.ts:1052` (`requirePhase(rest[0], 'harness evidence packet', lang)` 복붙 오기). 재현: `harness report packet` → "Usage: `harness evidence packet <phase>`" → 그대로 실행하면 `evidence packet` 은 `--ux` 문법이라 2차 오류. 2단 막다른 길.
4. **[MEDIUM] U-5 · "settle the STALE ones" 는 어떤 명령으로도 수행 불가** — `core/src/loop.ts:507-513`. 재현: `node bump UX-1` 로 wave-002 STALE → 제품이 시키는 대로 새 웨이브 생성·완료 → `loop next` 여전히 "done 2 / STALE 1 — … settle the STALE ones". STALE 은 의도된 영구 상태(wave.ts:210-231 [UTIL-105])인데 idle 문구는 끝낼 수 있는 일처럼 지시하고 명령은 이름 붙이지 않는다. 카운트는 단조 증가라 나그가 영원하다.
5. **[MEDIUM-LOW] U-4 · SessionStart 가 미해결 escalation 을 주입하지 않는다** — `core/src/hook.ts` 전체에 summon/escalation 참조 0. 재현: `loop critical raise --reason external-blocker` → 새 세션 SessionStart 주입문에 소환 언급 없음(`loop next` 를 쳐야만 발견). "사람을 소환하고 기다려라" 가 세션 경계를 못 넘는다 — 저널이 기억이라는 제품 자신의 핸드오프 시나리오에서 구멍.
6. **[MEDIUM-LOW] U-6 · 콜로케이트 테스트 거부문이 자기모순** — `core/src/hook.ts:1164` 부근. 재현: P0 에서 `src/utils.test.ts` Write → deny 문이 "files **named** as tests (`*.test.*` …) 는 쓰기 가능" 이라 말하면서 그 이름의 파일을 막는다. 우선순위 절("the profile's source paths win")은 SessionStart 문구(hook.ts:460-461)에만 있고 거부문에는 없으며, 실존 탈출구(`test/` 디렉토리로 이동)를 가리키지도 않는다.
7. **[교차 축 이관 · 실효성] U-7 · 경로 내 명령 치환으로 소스 가드·저널 가드 우회** — `core/src/bashwrite.ts:76-82`(의도 주석)·`core/src/hook.ts:1394`(basename 대조). 재현: P0 에서 `echo x > src/$(echo app).ts` ALLOW · 임의 페이즈에서 `echo x >> .harness/$(echo events).jsonl` ALLOW. 사용성 감점에는 안 넣고 기록만 한다.

## 못 잰 것 (정직 고지)

- **실제 Claude Code 세션에서의 훅 발화** — 훅 4종은 stdin 모사로만 구동. 플러그인 설치 경로(`claude plugin marketplace add` / `install`)와 `${CLAUDE_PLUGIN_ROOT}` 치환, 실 permission dialog 의 gate approve 체험은 미측정.
- **bench:hook 게이트(G9)의 실판정** — 이 머신이 부하 108/10코어라 벤치 스스로 "over — machine busy" 를 출력. 한가한 머신에서의 delta < 50ms 성립 여부는 못 쟀다 (측정 표면: `npm run bench:hook`, 리포 루트, n=30).
- **Stop 의 「사소한 턴」 탈출구의 실지 체감** — `stop_hook_active` 루프 가드는 실증했으나, 에이전트가 한 줄 사유로 실제 세션을 끝내는 상호작용은 하네스 밖 일이라 미측정.
- **3단 초과 스크립트 체인 deny 문구** — README 가 고지하는 深체인 차단의 그 자리 메시지 품질은 프로브 안 함.
- **P4 추출·design baseline·gate feedback --from 의 실캔버스 왕복** — 가짜 콘텐츠 파일로 sync 왕복(변경 감지→v++→STALE→동일 해시 무변경)까지만.
- **스킬 매뉴얼(P0–P6·P10–P12) 을 에이전트로서 끝까지 따라가는 주행** — 명령 추출·실존 검증(전부 실재)까지만.
- **침묵 성공 0 의 완전 전수** — 명령 × 상태 조합 전체가 아니라 변이 명령 전종 × 대표 상태의 샘플. 관측 범위 안에서 0.
- 훅 지연 절대치 — 바쁜 머신이라 참고 기록만.

## 점수 산출 근거

- rubric 의 4.8 명시 조건 4건: **전건 measured 로 충족** (조건별 실측 표).
- 이 라운드 필수 검증: 「A막고 B로」 왕복 13종 중 11종 완주 · 직전 수리된 backtrack↔phase set 왕복 **실제로 돈다** · 새 과차단 **0**(12종 프로브 전부 무간섭) · 벤치 출력 자족성 합격.
- 남은 감점: 오진 메시지 2건(U-1 은 메시지만 따르면 탈출 불가, U-3 은 2단 막다른 길), 끝문 가시성/부재 2건(U-2·U-5), 에이전트 표면 누락 1건(U-4), 자기모순 문구 1건(U-6). MEDIUM 이 남아 있으므로 4.8 은 못 준다.
- 기준선 3.0(감정서) 대비: 막힌 21곳 중 19곳이 그 자리 메시지만으로 탈출 가능하고, 탈출구(env 3종·backtrack·evidence·repair)가 전부 실제로 열리는 것을 완주로 확인 — 대폭 상회. **4.5**.

*측정 원자료: 본 세션 트랜스크립트의 명령·출력 전문. 샌드박스: `scratchpad/sb-tyspCq`(생애주기) · `sb-p0-2gfc0M`(P0 프로브) · `sb-noinit-*`(미init). 리포 수정 없음(시작·종료 시 status clean).*
