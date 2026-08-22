# [6] 사용성 감정 — 4.2/5

**점수** 4.2 · **4.8 충족** ✗ (rubric 조건 4종은 전부 measured PASS 이나, 잔여 결함에 HIGH 1건 — backtrack↔phase set 순환 막다른 길 — 과 MEDIUM 3건이 남아 「잔여 감점 요인 LOW 이하」미충족) · **감정 시각** 2026-08-23 02:04 KST · **대상** HEAD `80b633cb77d2567bd82405bb4ac42d273a1f1eeb` (worktree clean, 시작 시 `git status --porcelain` 공백 확인)

**한 줄**: 거의 모든 표면이 「막힌 자리에서 다음 수를 말해 주는」 모범 수준이고 rubric 조건은 전건 충족이지만, 정작 제품이 스스로 권하는 공식 역행(backtrack) 흐름이 두 메시지가 서로를 가리키는 **순환 막다른 길**이어서 — 이 축의 핵심 질문 「막혔을 때 그 자리에서 빠져나올 수 있는가」에 정확히 그 지점에서 X 가 나온다.

> 감정 종료 시점 고지: 감정 도중 다른 세션이 `92a6a1c`(docs 핸드오프 전용)를 커밋했다. `git diff 80b633c..92a6a1c -- core/ bin/ scripts/ mcp/ hooks/ skills/ agents/ profiles/ README*.md` 공(空) 확인 — 제품 표면 무변경이므로 본 실측은 두 HEAD 에 동일하게 유효하다.

감정 방법: 이전 라운드 감정 보고(round3i/·round3j/ appraisal\*.md)는 읽지 않았다. `mktemp -d` 샌드박스(`/tmp/harness-usability-L9QJUR`)에서 커밋된 `core/dist` 로 첫 사용자 생애주기를 P0→P12 GO 까지 완주했고, 문서·스킬·에이전트에 등장하는 `harness <group> <sub>` 조합 43종을 기계 추출해 전부 실행했으며, 훅 4종을 stdin JSON 으로, MCP 를 JSON-RPC 왕복으로 구동했다. 리포는 수정하지 않았다(`npm run bench:hook` 은 리포 cwd 에서 돌지만 쓰기는 `os.tmpdir()` 에만 발생함을 스크립트로 확인).

## 조건별 실측

| rubric 조건 | 실측 | 판정 |
|---|---|---|
| `harness --help` exit 0 + 13개 명령군 전부 나열 | exit 0. 명령군 20개 나열(init·status·doctor·phase·gate·wave·node·trace·report·doc·adr·design·tokens·evidence·loop·ship·profile·usage·backtrack·migrate) — 13개 이상 전부 | **PASS** |
| 모든 명령군이 하위명령 안내 | 20개 전군 `<group> --help` 실행: 전부 exit 0, `<sub>` 를 가진 14개 군 전부 서브커맨드 목록+인자 형식 출력. 알 수 없는 군/서브커맨드는 기대 목록과 `--help` 안내를 되돌려줌 | **PASS** |
| 침묵 성공 0 | 성공(exit 0) 호출 45종+ 전수 stdout 바이트 확인 — 최소 13바이트(`No raw values`) 이상, 전부 발화. 훅의 post-tool/stop 무결정 시 무출력은 「출력 없음=결정 없음(allow)」이라는 문서화된 계약이므로 침묵 성공으로 세지 않음 | **PASS** |
| 첫 실행 온보딩 존재 | `init` 이 다음 수(`harness --help`)와 보안 경고(gate approve 를 allowlist 에 넣지 말 것)를 출력. `--help` 머리에 Core flow 한 줄. SessionStart 주입이 현 위치+다음 수를 매 세션 제공 | **PASS** |

조건 전건 충족. 그러나 rubric 의 4.8 정의(「조건 전건 충족 **+ 잔여 감점 요인이 LOW 이하**」)에서 뒷항이 깨진다 — 아래 결함 절.

## 생애주기 워크스루 (막힌 지점 · 그 자리 메시지 · 탈출 O/X)

샌드박스에서 init → P0 게이트 → … → P12 `ship verdict` **GO** 까지 완주. 막힌 지점 전부:

| # | 막힌 지점 | 그 자리 메시지 (요지) | 탈출 |
|---|---|---|---|
| 1 | `phase set P7` (게이트 미승인) | 미승인 게이트 7개 열거 + "Start with the earliest: `harness gate submit P0` → `harness gate approve P0`" | **O** |
| 2 | `gate submit` (페이즈 누락) | 사용법 + P0–P12 목록 | **O** |
| 3 | `gate submit P0` (산출물 없음) | "`--paths <a,b>` 로 문서를 지정하라" | **O** |
| 4 | 문서 미등록 제출 | 제출은 되고, Note 로 `doc upsert → publish → doc url → 재제출` 체인 안내. 리뷰 패킷에도 동일 Blocker 명시 | **O** |
| 5 | `gate approve P0` (TTY 없음) | 왜 사람 전용인지 + 열려 있는 대안(`gate status`/`verify`) + 진짜 무TTY 사람용 탈출구 `HARNESS_APPROVE_NO_TTY=1` | **O** |
| 6 | Write `src/app.ts` (설계 트랙, 훅) | 어느 프로파일의 어떤 glob 에 걸렸는지 + 지금 쓸 수 있는 것 목록 | **O** |
| 7 | Stop (턴 로그 미정산) | `harness wave update "<did/next>"` 예시 + 「사소한 턴」 한 줄 탈출구 | **O** |
| 8 | `wave activate wave-002` (다른 웨이브 활성) | "wave-001 을 먼저 complete 하라" | **O** |
| 9 | `wave complete` (UX 참조, 증거 없음) | 증거 폴더 절대경로 제시 "Put a screenshot in …" | **O** (단, 스크린샷이 아니라 **텍스트 파일로도 열림** — 결함 D3) |
| 10 | `ship verdict` NO-GO | 사유 3건 각각에 실행할 명령/행동 명시 (P10·P11 제출 명령, 증거 폴더 경로) | **O** |
| 11 | `state.json` 손상 후 `status` | 손상 내용 + 파생 캐시 개념 + `doctor --repair`(수리)와 `doctor`(무변경 진단) 구분 안내 | **O** |
| 12 | **`backtrack P2` 후 `phase set P2`** | backtrack: "마커 설정 — **`phase set P2` 를 실행하라**" → phase set: "역행은 phase change 가 아니다 — **`backtrack P2 --reason` 을 쓰라**" — 서로를 가리키는 무한 순환. 마커가 서 있어도(`status` 로 확인) phase set 은 마커를 조회하지 않고 무조건 거부 | **X** |
| 13 | `loop critical raise` | exit 2 + "2 는 실패가 아니라 사람 소환" 설명 + clear 명령 | **O** |

13개 막힌 지점 중 12개 탈출 O — 단 하나의 X 가 하필 **제품의 모든 표면(README FAQ·훅 거부문·스킬 대응표)이 공식 경로로 권하는 흐름**이다.

## 에이전트가 읽는 표면 (훅 JSON · MCP · 스킬 문구)

- **훅 4종 stdin JSON 구동**: SessionStart 는 phase·활성 웨이브·INSTRUCTION(1)(2) 번호 붙은 다음 수·해시 논스 인용 펜스(`[552e4230]`)를 주입 — 에이전트가 깨어나서 바로 움직일 수 있는 밀도. PreToolUse deny 는 원인(프로파일명·매치된 glob)+현재 허용 목록+다음 수를 한 문단에 싣는다. PostToolUse/Stop 의 무결정 무출력은 계약대로. Stop block 은 정산 명령을 따옴표 예시로 제공.
- **MCP 왕복 실측**(JSON-RPC/stdio, 서버 기동+initialize+tools/list+tools/call = wall 0.06s): 광고대로 정확히 16개 도구. `harness_gate_approve` 는 「왜 터미널이어야 하는지」를 설명하며 거부(isError:true 로 모델에 원문 도달). 미지 도구 호출 → 가용 도구 16개 열거. 무하네스 프로젝트 → 도구 0개 + 호출 시 `harness init` 안내. CLI 거부문과 MCP 거부문이 동일 문구(표면 일치 확인: `harness_wave_complete` 증거 거부문 = CLI 와 동일).
- **스킬 문구**: `skills/king-wjang-harness/SKILL.md` 의 「deny/block 대응표」는 거부문별 원인·다음 수를 제공 — 좋은 설계다. 그러나 build/ship 트랙에서의 설계 수정 대응이 `harness backtrack <phase> --reason` 으로 안내되고(SKILL.md:88), 훅 ship-트랙 거부문도 같은 것을 권한다 — **둘 다 D1 순환에 에이전트를 밀어 넣는다**. 스킬·문서에 등장하는 명령 43종 전수 실행 결과 **MISSING 0**.

## 재현 절차·게이트 문서의 사용성 검증 (라운드 필수 항목)

**「그냥 도는가?」** — 돈다. `npm run bench:hook` 이 설치 그대로(빌드·의존성 없이) exit 0, 23.3s. 측정 표면을 출력 1행이 명시("프로세스 wall-time — 사용자가 도구 호출마다 기다리는 값")하고, 머신 정보(node v22.22.2·arm64·10 cores·loadavg)·방법론(10만줄·n=30·워밍업 3 제외)·node 기동 바닥값(p50 37.1ms)을 함께 찍는다. 여기까지는 모범적이다.

**「출력이 무엇을 뜻하는지 그 자리에서 알 수 있는가?」** — **부하 상태에서는 알 수 없다.** 실측 2회:

| 실행 | 조건 | realistic 델타 p95 | 게이트(<50ms) 대비 |
|---|---|---|---|
| 1회차 | loadavg 1.83/7.70/10.54 | **+162.0ms** | 3.2배 초과로 읽힘 |
| 2회차 | 유휴 | **+30.8ms** | 통과 |

출력은 "게이트(G9)는 마지막 열에 걸린다 — 폴백이 더하는 p95 < 50ms" 라고 문턱을 명시하면서 **판정(PASS/FAIL)도, 부하 경고도, 「수치가 문턱을 넘으면 유휴 상태에서 재실행하라」는 안내도 없다.** loadavg 를 찍어 놓고 해석하지 않는다. 첫 사용자는 1회차 출력만 보고 「이 제품은 자기 게이트를 3배 초과로 낙제한다」고 결론 내리게 된다 — 재현 도구가 정직한 수치로 오독을 만드는 구조다(결함 D2).

**「wall-time 체감 vs 델타 게이트 차이가 문서에서 정직하게 전달되는가?」** — **전달된다.** README Measured 표는 두 표면을 다 적고 "Absolute wall-clock is a property of your machine, not of this tool" 을 명시, FAQ 도 "What you feel is your machine starting node" 로 체감을 정면으로 다룬다. `gates.md` G9 절은 재정의 사유·수치·자기 감사 경고([OPS-74])까지 남겼다 — 게이트 문서로서 이례적으로 정직하다. 잔여 틈 둘: (a) README Measured 표의 인프로세스 수치(2.6/18.9ms)는 동봉 벤치로 **재잴 수 없다**(벤치는 wall-time 한 표면만 계측 — G9 명세의 「두 표면 모두」와 불일치, 인프로세스 벤치는 evidence/ 의 .ts 소스로만 존재하고 실행 러너 미동봉), (b) README 는 부류를 "realistic, corrupted, adversarial" 로 광고하는데 출력 라벨은 `realistic/corrupt/all-state` — all-state=적대 매핑을 각주에서 추론해야 한다.

**「README 4종이 같은 것을 말하는가?」** — 핵심 주장 파리티 확인: 훅 지연 수치(2.6/18.9/133/162/99ms)·테스트 수(1233/1217)·~240 tokens·MCP 16개·명령표 11행·`bench:hook` 광고 문단·벤치 3부류 서술 — **4종(en·ko·ja·zh) 일치**. (전문 대역 일치까지는 검증하지 않음 — 「못 잰 것」 참조.)

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

**D1 — HIGH · 공식 역행 흐름이 순환 막다른 길: `backtrack` 과 `phase set` 이 서로를 가리키며 왕복이 완성 불가**
재현: 샌드박스 P12 에서 ① `harness backtrack P2 --reason "x"` → exit 0, "run `harness phase set P2` to go back" ② `harness phase set P2` → exit 1, "Use `harness backtrack P2 --reason`…" ③ `status` 로 마커 `{to: P2}` 존재 확인 — ①②를 몇 번을 반복해도 페이즈는 P12.
원인: `core/src/cli.ts:475-489` ([UTIL-176] 후진 분기)가 `state.backtrack` 마커를 **조회하지 않고** 후진을 무조건 거부. `cli.ts:1287-1320` 의 backtrack 핸들러는 마커만 세우고 "phase set 을 실행하라"고 안내. 유일한 실탈출은 `HARNESS_ALLOW_FORCE=1 harness phase set P2 --force` 인데 **순환의 어느 메시지도 이를 언급하지 않는다**(--force 잠금 문구는 `--force` 를 우연히 시도해야만 보인다). 파급: README 명령표·FAQ("design/ship separation is crossed with an official `backtrack`")·훅 ship-트랙 거부문("go back with `harness backtrack P7 --reason`")·`skills/king-wjang-harness/SKILL.md:88` 이 전부 이 흐름을 권한다 — 에이전트는 지시를 따를수록 루프를 돈다. `core/test/med-3j-residuals.test.ts:106-134` 는 후진 거부와 마커 설정을 **각각** 검증할 뿐 왕복 완성을 검증하는 테스트가 없다.

**D2 — MEDIUM · `bench:hook` 이 문턱을 명시하고 판정·부하 진단은 주지 않아, 부하 머신에서 「가짜 낙제」를 만든다**
재현: 백그라운드 부하 중 `npm run bench:hook` → realistic 델타 +162.0ms(문턱 <50ms 의 3.2배로 읽힘), 유휴 재실행 → +30.8ms. `scripts/bench-hook-latency.mjs:79-100` — loadavg 를 출력만 하고(79행) 해석·경고·재실행 안내·PASS/FAIL 어느 것도 없다. n=30 의 wall-time p95 는 부하에 극도로 민감한데 그 한계 고지도 없다. 받는 사람이 다시 재게 하는 것이 이 스크립트의 존재 이유([PROD-180])인 만큼, 오독 방지는 스크립트의 책임이다.

**D3 — MEDIUM · UX 시각 증거 게이트의 표면 3개가 서로 다른 말을 한다 — 거부문은 "스크린샷", 실제 게이트는 텍스트 파일로 열리고, `evidence check` 는 PNG 를 지적하며 txt 를 usable 로 분류**
재현: ① UX-1 참조 wave-002 에서 `wave complete` → "Put a **screenshot** in …/evidence/wave-002" ② `echo 'not an image' > …/notes.txt` ③ `wave complete` → **"Wave completed"** ④ `evidence check wave-002` → `"usable": [notes.txt]`, 반면 200×100 PNG 는 "too small — most likely a blank screen" 으로 problems 에. README 의 "**cannot be completed without a visual artifact** … You can't ship a UX feature that was never actually drawn" 과 불일치(완료는 뚫리고, `ship verdict` 에 가서야 "no real-run capture" 로 잡힌다 — 늦은 검출 자체는 방어지만, 완료 시점 메시지와 check 의 usable 분류는 오진이다). 관련: `core/src/evidence.ts` 의 usable 판정(이미지 외 확장자 무검증 통과).

**D4 — MEDIUM · `bench:hook` 출력이 한국어 고정 — 영어 README 가 광고하는 재현 도구를 영어 사용자가 읽을 수 없다**
재현: `HARNESS_LANG=en npm run bench:hook` → 표 헤더·게이트 각주 전부 한국어(`scripts/bench-hook-latency.mjs:77-100` 하드코딩, `core/src/i18n.ts` 의 L() 미사용). 제품 기본 출력은 영어(rubric 항목 7 조건)고 README.md·ja·zh 가 이 명령을 광고하는데, 수치 해석에 필요한 문맥(측정 표면·게이트·all-state 제외 사유)이 전부 비영어다.

**D5 — LOW · README 벤치 부류명(adversarial)과 출력 라벨(all-state) 불일치** — README.md:125 vs bench 표. 각주 추론 필요.
**D6 — LOW · README Measured 표의 인프로세스 수치는 동봉 벤치로 재측정 불가** — 벤치는 wall-time 한 표면만. G9 명세("두 표면 모두 계측")와 동봉 도구의 커버리지 불일치. 인프로세스 벤치 소스는 `docs/release-readiness/2026-08-21/evidence/cost-177-bench.ts` 로 존재하나 실행 수단(tsx 등) 미동봉.
**D7 — LOW · `wave complete` 성공문이 완료된 웨이브 id 를 말하지 않는다** — "Wave completed" 뿐. 직전에 다른 웨이브 activate 를 거부당한 세션(실측 #8→#9 시나리오)에서는 **어느 웨이브가 닫혔는지** 모호 — 실제로 나는 wave-002 를 닫으려다 wave-001 을 닫았다.
**D8 — LOW · `phase --help` 헤더가 `harness phase <P0..P12>` 로 bare 형태를 시사하나 실제는 `phase set` 만 유효** — bare 실행 시 usage 정정이 나오므로 탈출은 되지만 헤더가 오도.
**D9 — LOW · backtrack 마커를 어떤 경로도 소비하지 않는다** — `HARNESS_ALLOW_FORCE=1 --force` 로 역행을 완성해도 마커가 남아(`status` 실측) `backtrack clear` 를 별도로 알아내야 한다. D1 수리 시 함께 볼 것.

## 못 잰 것 (정직 고지)

- **실제 Claude Code 플러그인 설치 왕복**(`claude plugin marketplace add`/`install`) — 사용자 전역 설정을 건드리므로 미실행. hooks.json·plugin.json 정합은 정적 확인만.
- **~240 tokens/세션 주장** — SessionStart 주입의 문자수만 봤고(주장과 모순 없음) 토크나이저 실측은 안 함.
- **실제 에이전트의 메시지 회복률** — 거부문을 읽고 다음 수를 아는지는 사람인 내가 판정한 것. 모델을 태워 A/B 하지 않았다(README 의 일화도 재실행 안 함).
- **README 4종의 전문 대역 일치** — 핵심 수치·주장·명령표만 파리티 확인. 문단 단위 의미 차이는 미검증.
- **훅 인프로세스 지연** — 동봉 도구가 없어 재측정 불가(D6). wall-time 만 실측.
- **`gate feedback --from` 실제 코멘트 파일 왕복, `design html`, `evidence packet` 성공 경로** — 미실행(도달 조건 미구성). 존재·인자 검증만.
- **Windows/비 zsh 환경** — darwin arm64 단일 머신.

시간 측정의 표면 명시: ① 벤치 = `npm run bench:hook` 자체 계측(스크립트 내부 hrtime, 자식 프로세스 wall) — darwin arm64·node v22.22.2·10코어, 1회차 loadavg 1.83/7.70/10.54, 2회차 유휴. ② 훅 스팟 = `/usr/bin/time -p` 로 `sh -c 'echo <payload> | harness-hook pre-tool'` 파이프라인 전체(echo·파이프 오버헤드 포함): 하네스 있음 0.07s×3, 없음(sh 게이트) 0.00s×3. ③ MCP = `/usr/bin/time -p` 로 서버 기동+3콜 왕복 0.06s.

## 점수 산출 근거

- rubric 4.8 조건 4종: **전건 measured PASS** (조건표 참조). 여기까지만 보면 4.8 후보.
- 그러나 4.8 의 정의는 「+ 잔여 감점 요인 LOW 이하」. 잔여가 **HIGH 1(D1) · MEDIUM 3(D2·D3·D4)** — 정의상 4.8 불가.
- D1 은 이 축의 핵심 질문(「막혔을 때 그 자리에서 빠져나올 수 있는가」)에 대한 정면 반례이며, 훅·스킬·README 세 표면이 사용자를 그 길로 **안내**한다는 점에서 단순 엣지가 아니다. 광고된 1급 흐름(공식 역행)이 CLI 로 완성 불가 — 기능 관점으론 BLOCKER 로 등재할 수도 있으나, 잠긴 탈출구(`HARNESS_ALLOW_FORCE`)가 존재하고 전진 생애주기는 무결점 완주되므로 사용성 축에서는 HIGH 로 계상했다.
- 상방 요인: 막힌 지점 13곳 중 12곳 탈출 O, MISSING 0, 침묵 성공 0, 열화 상태(state 손상)의 안내 품질, CLI=MCP 거부문 일치, `migrate` 의 실환경 감지 품질, exit 2 의 의미까지 설명하는 escalation — 이 제품의 메시지 표면은 전반적으로 상위 수준이다.
- 종합: 조건 전건 충족 + 표면 품질 상위(≈4.5 상당) − HIGH 1건이 핵심 질문의 반례(−0.3 상당) − MEDIUM 3건 중 재현 도구 오독 구조(D2)와 게이트 표면 모순(D3)의 무게 → **4.2**. 결과를 보고 기준을 낮추지 않았다 — 4.8 미달 판정은 rubric 정의를 그대로 적용한 것이다.
