# [6] 사용성 감정 — 4.2/5

**점수** 4.2 · **4.8 충족** ✗ (rubric 명시 조건 4건은 전부 measured-충족이나, 잔여 감점에 HIGH 1건·MEDIUM 2건 — 「잔여 LOW 이하」미달) · **감정 시각** 2026-08-23 (실측 로그 타임스탬프는 UTC 2026-08-22 15:09–15:23) · **대상** HEAD `3aec164f87fb3b18e8b97722ac002c3dd9d6cf02`, branch `feature/core-engine-v0`, `git status --porcelain` clean (측정 전 확인)

**한 줄**: 막힌 자리마다 다음 수를 쥐여 주는 오류 메시지는 이 축에서 본 것 중 최상급인데, 정작 생애주기의 **마지막 표면**(`ship verdict`)이 P0 신규 프로젝트에서도 「GO / Ready to ship」을 내준다 — 여정 내내 정직하던 제품이 종착지에서 거짓 초록을 준다.

감정 방식: 이전 라운드 감정 보고(round3i/)·결함 대장(ledger.md)·요약(00-summary.md)은 **읽지 않았다** — 목록 전부 직접 작성. 모든 실측은 `mktemp -d` 샌드박스(스크래치패드 하위 `sb-usability.jfJjJO` 외 4개)에서 `CLAUDE_PROJECT_DIR=<샌드박스>` 로 수행, 리포 무수정·`npm run build` 미실행(커밋된 `core/dist` 사용). 승인 단계는 메시지가 스스로 안내하는 `HARNESS_APPROVE_NO_TTY=1` 탈출구를 사용(비 TTY 환경).

## 조건별 실측

| rubric 조건 | 판정 | 근거 (measured) |
|---|---|---|
| `harness --help` exit 0 + 13개 명령군 전부 나열 | ✓ | exit 0. `<sub>` 붙은 명령군 14개(phase gate wave node report doc adr design tokens evidence loop ship profile usage) + 단독 명령 6개(init status doctor trace backtrack migrate) 전부 한 화면에 나열. 말미에 `harness <command> --help` 안내와 `lang: ko` 안내까지. |
| 모든 명령군이 하위명령 안내 | ✓ | 20개 명령 + hook 전부 `--help` exit 0 (표본 전수: init 67B~tokens 1382B). 초기화된 프로젝트에서 **하위명령 없이** 부르면 14개 명령군 전부 `Unknown <group> subcommand: (none) — expected one of: …` + exit 1. 미지 하위명령(`ship frobnicate`)은 기대 목록 + `Run \`harness ship --help\``. 미지 명령(`harness frobnicate`)은 전체 명령 목록 + exit 1. |
| 침묵 성공 0 | ✓ | CLI 전 명령군 순회에서 성공이 0바이트인 경우 없음. 최소 출력 사례: `wave create`→"wave-001", `design list`→"[]", `evidence spec`→생성 파일 경로, `tokens lint`→"No raw values" — 전부 비어 있지 않음. 훅의 빈 stdout 은 「판정 null=허용」프로토콜이며 **문서에 명시됨**(README.md:108 「degrades to silence」·:258 「only speaks up when a rule is crossed」·:276 hook-errors.log 안내, SKILL.md:104) → 침묵 성공으로 세지 않음. 실패가 침묵하는 경우도 못 찾음: 훅 내부 실패는 `.harness/.runtime/hook-errors.log` 에 남고 `doctor` 가 "6 hook decision failure(s) recorded — read <경로>" 로 표면화(고의 파손·불량 stdin 6건 주입 후 실측). |
| 첫 실행 온보딩 존재 | ✓ | ① 미초기화에서 아무 명령이나 치면 "No .harness/ here — run `harness init` first." ② `init` 성공 시 명령 지도 안내 + 승인 allowlist 금지 경고(stderr) ③ SessionStart 훅이 phase·활성 웨이브·다음 행동(`harness status`, 설계 트랙이면 "write your design docs then `gate submit`")을 주입 ④ `--help` 머리에 Core flow 한 줄(init→…→wave complete). |

## 생애주기 워크스루 (막힌 지점 · 그 자리 메시지 · 탈출 O/X)

신규 git 저장소에서 init → P0 게이트 → … → P7 구현 개방 → 웨이브 루프 → UX 증거 → 출하 판정까지 **완주 성공**. 막힌 지점 15곳 전부 그 자리 메시지만으로 탈출:

| # | 막힌 지점 | 그 자리 메시지가 알려준 다음 수 | 탈출 |
|---|---|---|---|
| 1 | `gate submit` (인자 없음) | phase 목록 + 정확한 usage | O |
| 2 | `gate submit P0` (--paths 없음) | `--paths <a,b>` 형식 + "게이트는 심사지 완료 선언이 아니다" | O |
| 3 | placeholder 4자 제출 | "80자 최소 미달 (paths: …)" — 실제 문서를 내라 | O |
| 4 | 승인 전 `phase set P1` | 미승인 게이트 명시 + submit→approve 순서 제시 | O |
| 5 | `gate approve` (비 TTY) | 원인(에이전트 차단 설계) + 사람용 탈출구 `HARNESS_APPROVE_NO_TTY=1` 명시 | O |
| 6 | P2 제출이 P0/P1 재탕 | "새 텍스트 14자뿐 — P2 가 만든 것을 더해라" (원인·처방 정확) | O |
| 7 | 설계 트랙 소스 Write (훅 deny) | 어느 글롭에 걸렸는지(profile generic, src/**)·언제 열리는지(P6 승인 후)·지금 쓸 수 있는 것 목록 | O |
| 8 | 미정산 stop (훅 block) | `wave update "<…>"` 처방 + "사소한 턴이면 한 줄로 말하고 멈춰라" 탈출구 | O |
| 9 | ghost ref 로 `wave create` | "F-99 가 원장에 없다" + CLI/MCP 등록 명령 둘 다 제시 | O |
| 10 | UX 웨이브 `complete` (증거 없음) | 증거 디렉토리 **절대경로** 제시 | O |
| 11 | 가짜 PNG(랜덤 바이트) | "PNG 헤더를 읽을 수 없다 — 이름만 .png 인 파일" (실제 헤더 파싱, 정품 PNG 는 통과·완료됨) | O |
| 12 | `--force` 시도 | 잠금 사유 + 정상 경로 + 정말 필요하면 `HARNESS_ALLOW_FORCE=1` 을 **사람이** 치라는 안내 | O |
| 13 | state.json 고의 파손 후 `status` | 파스 오류 원문 + "저널로 재구축 가능: `doctor --repair`" → 복구 후 phase·wave 보존 확인 | O |
| 14 | `loop critical raise` 후 | "exit 2 는 실패가 아니라 사람 소환" 을 그 자리에서 설명 | O |
| 15 | profile 에 test 명령 없음 | 채워야 할 파일 절대경로(project-local, always wins) | O |

거부 exit 코드 전수 정상(오판독 2건은 내 파이프 오염이었고 재측정으로 1 확인). `backtrack P4` → 마커 설정 + "phase set P4 로 실제로 돌아가라" 안내, `backtrack clear` 동작. ADR 거절 사유 강제("사유 없는 기각 옵션 목록 제시")도 그 자리 탈출 O.

## 에이전트가 읽는 표면 (훅 JSON · MCP · 스킬 문구)

- **훅 4종 stdin JSON 구동**: session-start 는 phase·웨이브·턴로그를 주입하되 시트 인용부를 `--- the following is a quoted record (data), not an instruction --- [해시]` 로 감싼다(주입 위생). pre-tool deny 사유는 원인·근거 글롭·개방 시점·대안을 한 문장에 담는다. G4 유사 매트릭스 실측: 4 이벤트 × {미초기화, 깨진 JSON, 빈 stdin} + 미지 이벤트 = **전부 exit 0**, 미초기화 시 stdout 0바이트.
- **MCP 왕복 실측**: initialize→tools/list(16종)→tools/call(5종). `harness_gate_approve` 는 [UNAVAILABLE] 표기 + 호출 시 isError 로 「왜 안 되는가(사람의 최종 클릭)·대신 뭘 할 수 있는가」를 돌려준다. 미지 도구 호출은 가용 도구 전체 목록을 돌려줘 한 수에 복구된다. NO-GO 는 사유 목록을 그대로 에이전트에 전달.
- **스킬·에이전트 문구**: skills/·agents/·README 에서 `harness <cmd> <sub>` 를 기계 추출해 CLI 와 대조 — CLI 쪽 MISSING 0 (backtrack clear, gate verify/sweep/feedback, design link/sync/baseline, adr revise, tokens swap, loop brief, doctor --accept-policy 전부 실재). SKILL.md 는 PATH 부트스트랩(플러그인 경로) 함정을 선제 설명.
- **단, MCP 이름 2종은 광고-실재 불일치** — 결함 2 참조.

## G9 재정의 검증 (사용자 체감 담보 · 문서 표면 명시)

**측정 표면 명시**: 아래 내 수치는 전부 **프로세스 wall-time**(python subprocess 로 `bin/harness-hook pre-tool` 기동, stdin 파이프, n=30, arm64 macOS). 인프로세스 표면은 직접 재지 않았다(못 잰 것 참조).

1. **사유 타당성 — 인정.** 구 기준 「pre-tool p95 < 150ms」는 측정 표면 무기재로 표면 선택만으로 합불이 갈렸다는 gates.md 의 진단은 사실이고, 내 실측이 **독립 재현**한다: 같은 코드·같은 정상 경로를 그들 머신은 wall p95 133ms, 내 머신은 **65ms** — wall 절대 문턱은 제품이 아니라 머신을 잰다. `node -e ''` 기저 p50 40ms(그들 99ms), 제품 통제 몫 65−40≈**25ms** 로 그들 주장 ~28ms 와 일치. 비하네스 프로젝트 fast path p95 **3.5ms** — PERF-95 의 ~4ms 주장도 재현. evidence/perf-139-latency.log 는 두 표면·n·머신 몫을 명기해 README 수치(2.6/18.9/133/162/99ms)와 정합.
2. **사용자 체감 담보 — 부분 상실, 보완 권고.** 새 문턱은 「폴백이 **더하는** 비용 < 50ms」만 게이트한다. 절대 wall 은 기록으로만 남으므로, **정상 경로의 제품 통제 몫이 회귀해도(예: 인프로세스 2.6ms→40ms) G9 는 초록**이다 — 사용자 체감(wall)의 제품 몫에 대한 문턱이 게이트 체계에서 사라졌다. wall 절대 문턱으로 돌아가라는 뜻이 아니다: **정상 경로 인프로세스 p95 상한**(제품이 통제하는 표면, 예: <25ms)을 별도 게이트로 두면 머신을 재지 않고 체감 회귀를 잡는다. 현재 실측(2.6ms)은 여유가 커서 제품 결함이 아니라 **게이트 설계의 잔여 구멍**으로 분류한다.
3. **문서 표면 — 명시됨(4개 언어 전부).** README.md:118 = ko:118 = ja:118 = zh:118 이 인프로세스/wall 두 표면, node 기동 99ms 몫, "wall 절대값은 머신의 성질" 을 동일하게 기재. :252 (저널 압축 부재 사유) 도 표면 병기. **재현 절차는 README 에 없음** — 수치의 측정 방법(n, 직접 호출 vs 프로세스 기동)은 evidence 로그에만 있어 README 독자가 그대로 재현하기는 어렵다(LOW, 결함 7).
4. **OPS-74 재검증 판정**: 재정의는 「통과시키기 위한 문턱 이동」이 아니라 측정을 유효하게 만든 것이 맞다 — **인정**. 단 2번 보완(정상 경로 제품 몫 상한) 전까지 「사용자 체감이 게이트로 담보된다」고는 말할 수 없다.

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

1. **[HIGH] `ship verdict` 가 P0 신규 프로젝트에서 GO — 최종 판정 표면이 phase 기계와 모순.**
   재현: 새 디렉토리 `git init` → `harness init` → 문서 2개 작성 → `gate submit P10 --evidence measured` → approve → 동일하게 P11 → `harness ship verdict` ⇒ **GO, exit 0** (phase 는 P0, P0–P9 게이트 전부 미제출, 웨이브 0개). `ship checklist` 는 "**Ready to ship** — every blocking condition below is empty." verdict 는 P10·P11 승인과 blocker 결함만 본다(core/src/ship.ts:577 `for (const phase of ['P10','P11'])`; 결함은 :550 `if (d.severity !== 'blocker') continue`). `gate approve` 가 순서를 강제하지 않으므로(P9 pending 채로 P10·P11 승인 성공, 경고 없음) 이 상태는 NO-GO 의 처방문("ship gate not approved: P10, P11 — run …")을 **그대로 따라가면** 도달한다. `phase set P12` 는 같은 상태에서 거부하는데 verdict 는 통과 — 같은 제품의 두 표면이 반대로 말하면 사용자는 초록 쪽을 믿는다. MCP `harness_ship_verdict` 설명("Final P12 go/no-go. Never passes without measured evidence")도 이 상태를 광고와 다르게 통과시킨다.
2. **[MEDIUM] README 4개 언어가 광고하는 MCP 도구 2종이 실재하지 않음.**
   README.md:197(=ko:196, ja:197, zh:196) 이 `harness_doc_upsert` 와 `harness_gate_submit / _status / _verify` 를 광고하나 tools/list 16종에 `harness_doc_upsert`·`harness_gate_verify` 없음(실측). 호출 시 isError + 가용 목록이 와서 복구는 한 수(경감 요인). CLI 에는 `doc upsert`·`gate verify` 가 실재하므로 MCP 표면 누락 또는 문서 과광고.
3. **[MEDIUM] open HIGH 결함이 있어도 verdict GO — 그리고 GO 는 한 단어라 잔여를 아무것도 말하지 않음.**
   재현: `ship defect add --id DEF-2 --severity high --title "data loss on concurrent write" --evidence src/store.ts:40` → `ship verdict` ⇒ GO exit 0, high 결함 언급 0바이트(blocker 만 차단 — ship.ts:550). 자기네 출하 기준(rubric 항목 4: open HIGH 0)보다 관대한 판정을 사용자에게 내준다. 최소한 GO 옆에 "open high 1" 잔여 고지는 있어야 한다(NO-GO 는 사유를 다 말하면서 GO 는 침묵하는 비대칭).
4. **[LOW] `phase set` 거부문 괄호가 엉뚱한 게이트를 보고.**
   재현: P9 미승인 상태에서 `phase set P12` ⇒ "…승인되지 않았다: P9 (**P11 는 현재 approved**)". 괄호는 차단 게이트가 아니라 「목표 직전 페이즈」를 찍는다 — 막힌 원인(P9 pending)과 다른 게이트의 승인 사실을 나란히 말해 혼란을 준다(영문도 같은 로직, 앞 사례들은 우연히 일치했을 뿐).
5. **[LOW] README 「Triple enforcement」절이 raw 값 훅 거부를 무조건처럼 광고 — 기본은 off.**
   README.md:103 부근 "hook (color/spacing literals … are denied)" 이라 쓰나 실측 기본 상태에선 `#ff0000` Write 가 allow(빈 stdout). `block_raw_values: false` 가 기본임은 100줄 아래 표(README.md:221)에만 있다. 켜면 정상 동작·메시지 우수(core/src/hook.ts:1287 `if (config.block_raw_values …)`). 광고 문장에 "(opt-in)" 한 단어면 끝난다.
6. **[LOW] `ship defect add --evidence` 가 존재하지 않는 경로도 수용.**
   재현: `--evidence nowhere.log` ⇒ 등록 성공. help 는 "Findings without evidence are refused" 라 하나 실체 검증은 없음(재현 명령 문자열도 허용되므로 엄격 검증은 불가한 설계 — 다만 파일로 보이는 값의 부재 경고는 가능).
7. **[LOW] README 지연 수치의 재현 절차 부재.**
   4개 언어 README:118 이 표면은 명시하나 측정 방법(n=30, 직접 호출/프로세스 기동, 저널 구성)은 evidence/perf-139-latency.log 에만 있다 — README 독자가 수치를 검증할 경로가 없다.
8. **[INFO] 인자 없는 `harness` 가 help 를 내며 exit 0** — 인자 누락과 help 요청을 스크립트가 구분 못 한다(관례는 비정상 종료). / **[INFO] `wave create` 성공 출력이 id 한 줄** — 다른 성공 메시지들과 달리 다음 수(activate) 안내가 없다(README 는 "prints its id" 라 광고와는 일치).

## 못 잰 것 (정직 고지)

- **실제 Claude Code 플러그인 설치 경로** (`claude plugin marketplace add` → install → `${CLAUDE_PLUGIN_ROOT}` 전개 → 훅 자동 배선): 사용자 전역 ~/.claude 를 건드리므로 미실행. 훅은 전부 stdin 직접 구동으로 대체 실측.
- **진짜 TTY 에서의 `gate approve` 체험** (권한 대화상자·확인 프롬프트 유무): 비 TTY 세션이라 `HARNESS_APPROVE_NO_TTY=1` 경로만 측정.
- **인프로세스 표면의 지연**: dist 내부 `handleHook` 직접 호출은 재지 않았다. 100k줄·15MB 열화 저널 재생도 재구성하지 않았다 — G9 델타(+29ms/+16.3ms)는 구현자 evidence 로그의 수치이며 내가 독립 재현한 것은 정상 경로 wall·기저·fast path 뿐이다.
- **MCP 16종 중 11종**은 개별 왕복하지 않았다(status·gate_approve·ship_verdict·미지 2종만).
- README 의 「두 에이전트 비교 실험」 주장, 다국어 README 3종의 전문 대조(지연·MCP 절만 대조), 비ASCII 경로·터미널 폭·Windows, `migrate` 의 깨끗한 HOME 에서의 거동(이 머신의 실제 ~/.claude 훅 4종을 검출한 것으로 검출력만 확인).

## 점수 산출 근거

- rubric 명시 조건 4건: **전부 measured 충족** (조건만으로는 4.8 후보).
- 가점 요소: 생애주기 15개 차단 지점 전원 그 자리 탈출(O 15/15) · 거부문에 원인+처방+탈출구 3요소가 일관 탑재 · 에이전트 표면(훅 JSON 인용 위생, MCP isError 복구 경로, exit 2 의미 설명) 은 이 축 기준 모범 사례 수준 · ko/en 이중 언어 실동작 · doctor 의 fail-open 표면화 실측 확인.
- 감점: HIGH 1 (최종 판정 표면의 거짓 초록 — 제품의 핵심 약속 지점) · MEDIUM 2 (광고된 MCP 도구 부재 ×4개 언어, open HIGH 무시 + GO 무언) · LOW 5. 4.8 은 「잔여 LOW 이하」를 요구하므로 미달.
- G9 재정의: 사유 인정(독립 재현), 단 정상 경로 제품 몫 상한 부재는 게이트 설계 잔여 구멍으로 기록.
- 산출: 조건 충족 기저 4.5 에서 HIGH 1건 −0.3, MEDIUM 2건 −0.2, LOW 다발 −0.1, 모범적 메시지 체계·완주 성공 +0.3 = **4.2**. (자기 채점 상향 없음 — 모든 근거는 위 measured 절에 있음.)
