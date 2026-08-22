# [6] 사용성 감정 — 4.6/5

**점수** 4.6 · **4.8 충족** ✗ (조건 4개는 전건 measured 충족이나, 잔여 감점에 MED 1건 — 하네스 해제(off-ramp) 경로의 거부문이 원인을 오진하고 실재하지 않는 처방을 가리키며, 제품 표면 어디에도 그 문이 문서화돼 있지 않다) · **감정 시각** 2026-08-23 05:35 KST · **대상** HEAD d8ebde4 (감정 개시 직후 docs-only 커밋 540c186 이 얹힘 — 코드 표면 동일. 감정 도중 05:33 KST 부터 **병행 세션이 워킹트리를 수정하기 시작**했으므로, 그 이후의 실측 6건은 `git show 540c186:core/dist/*` 로 추출한 고정 번들에서 재실행해 전건 동일 판정임을 확인했다)

**한 줄**: 거부는 크게 늘었지만 막힌 자리마다 원인과 다음 수가 붙어 있고 그 다음 수가 실제로 열린다 — 전 생애주기(P0→P12→GO)를 처음 쓰는 사람으로 완주하며 확인한 막힌 지점 24곳 중 탈출구가 없는 곳은 단 하나, 「하네스를 이 프로젝트에서 떼는 문」뿐이다.

## 조건별 실측

루브릭 축 6 의 4.8 조건 (전부 mktemp 샌드박스 `/tmp/harness-usab-w9SZ`, `CLAUDE_PROJECT_DIR` 지정, 커밋된 dist 로 실측):

| 조건 | 결과 | 실측 |
|---|---|---|
| `harness --help` exit 0 + 명령군 전부 나열 | ✓ | exit 0, **20개 명령군 전부** 나열(루브릭의 「13개」는 구판 기준 — 현재 레지스트리 20개가 전부 나옴). 핵심 흐름 요약 + 언어 전환 안내 포함 |
| 모든 명령군이 하위명령 안내 | ✓ | 20개 군 전부 `--help` exit 0. 하위명령 있는 군은 인자 서식까지 표로. 미지 하위명령 → `가능: a | b | c` + `--help` 안내. 미지 명령 → 오타 제안(`stauts` → "Did you mean `harness status`?") |
| 침묵 성공 0 | ✓ | 전 명령군 happy path 실행 — 변이 명령 전건이 결과 한 줄 이상 출력(wave create 는 id, init 은 온보딩 2줄, doc url 은 `DOC-1 → <url>` 등). 유일한 침묵은 훅의 allow(계약상 침묵)와 경계 사례 `design inventory` 의 `{"components":[],"total":0}` (아래 결함 8) |
| 첫 실행 온보딩 존재 | ✓ | `init` 이 다음 수(`harness --help`)와 보안 주의(allowlist 금지)를 출력. 미초기화 `status` → "run `harness init` first". SessionStart 훅이 페이즈·차단 규칙·다음 수를 주입 |

추가 실측: 훅 4종 stdin 구동 전건 정상(session-start 주입 / pre-tool deny·allow / post-tool 활동 기록 / stop block·allow). 쓰레기 stdin → exit 0 침묵 + `hook-errors.log` 기록 + `doctor` 가 그 수를 경고로 표면화(광고대로). `.harness` 없는 프로젝트에서 훅 4종 완전 침묵. ko 언어(`HARNESS_LANG=ko`) CLI·훅 거부문 모두 동작.

## 생애주기 워크스루 (막힌 지점 · 그 자리 메시지 · 탈출 O/X)

첫 사용자 페르소나로 init → P0 → … → P12 → `ship verdict` GO 까지 완주. 막힌 지점 전수:

| # | 막힌 지점 | 그 자리 메시지가 준 다음 수 | 탈출 |
|---|---|---|---|
| 1 | 설계 트랙에서 `src/app.ts` Write/Bash 리다이렉트 | 원인(프로파일 source_globs 명시) + "설계 산출물 먼저" + 쓸 수 있는 곳 목록 | **O** — P6 승인 후 같은 Write 가 실제로 allow 됨(왕복 실증) |
| 2 | `gate submit` 대상 파일 없음 | "check the path, or write the document first" | O |
| 3 | `gate approve` 를 TTY 없이 | 원인(에이전트 호출 형태) + 사람용 명령 + 열려 있는 대체(`gate status/verify`) + 원격 파이프용 탈출구 `HARNESS_APPROVE_NO_TTY=1` 명시 | **O** — 그 env 로 실제 승인됨 |
| 4 | 게이트 건너뛴 `phase set P2` | 미승인 게이트 열거 + "Start with the earliest: `gate submit P1` → `gate approve P1`" | O |
| 5 | `wave create --refs` 미등록 노드 | 등록 명령을 CLI·MCP 양쪽 형태로 제시 | O |
| 6 | 신규 내용 80자 미만 gate submit | 부족량을 숫자로("17 characters … below the 80 minimum") + 무엇을 더해야 하는지 | O — 실질 내용으로 재제출 통과 |
| 7 | Stop 훅 block(턴 미정산) | `wave update "<did/next>"` + 사소한 턴 탈출구("say why in one line") | **O** — update 후 stop allow(왕복) |
| 8 | UX 웨이브 complete, 증거 없음 | 정확한 증거 디렉토리 절대경로 제시 | O |
| 9 | 증거로 txt 만 있음 (신규 [QUAL-200]) | "not a visual artifact — png/jpg/webp or exported HTML" | **O** — html 목업으로 complete 성공(왕복) |
| 10 | 후진 `phase set P3` | `backtrack P3 --reason` 정확 제시 | **O** — [UTIL-189] 왕복 완주: backtrack → phase set 통과 → `backtrack clear` → 전진 복귀까지 전부 동작. 직전 라운드의 막다른 루프가 실제로 닫혔다 |
| 11 | `backtrack` 무인자 (신규 [UX-193]) | 사용법 + **끝내는 문 `backtrack clear`** 를 함께 안내 | O |
| 12 | STALE 웨이브 재활성화 | refs 를 미리 채운 `wave create` 명령 제시 | O — 그 명령으로 새 웨이브 생성됨 |
| 13 | `loop critical raise` 후 | exit 2 의 의미("사람 소환이지 실패 아님")와 해제 명령 안내 | O — `critical clear` 왕복 |
| 14 | `tokens gen` 원천 파일 없음 | **최소 유효 문서 스켈레톤을 에러 안에 통째로 출력** | **O** — 그 스켈레톤 복붙만으로 gen 성공(왕복) |
| 15 | agent 의 config.yaml Write | 원인(자기 무장해제) + "사람이 터미널에서" | **O** — 사람 편집 → `doctor` 드리프트 경고(재고정 명령 명시) → `HARNESS_ACCEPT_POLICY=1 doctor --accept-policy` 재고정 → doctor 클린(전 왕복). env 없이 부르면 정확한 거부문. YAML 중복 키까지 줄·칸 번호로 진단 |
| 16 | state.json 손상 | doctor 가 진단, SessionStart·deny 문 말미에 `[state damaged — run harness doctor --repair]` 부착 | **O** — `--repair` 로 P7 복원(왕복) |
| 17 | 출하 트랙 새 파일 생성 | 두 갈래 탈출(backtrack P7 / `ship defect add`) 제시 | O — backtrack 으로 실증 |
| 18 | 동결 디자인 시스템 경로 편집 | `backtrack P4 --reason` 제시 | **O** — 마커 열림 상태에서 같은 Write 가 allow, `clear` 후 다시 deny(양방향 실증) |
| 19 | raw 색상 리터럴 Write (`block_raw_values`) | 줄 번호 + 값 + 규칙 예시("text.primary is fine, blue.500 is not") | O — `var(--…)` 참조 쓰기는 allow |
| 20 | 설계·구축 트랙 `npm publish` | "ship track (P10 onward), once that phase's gate is approved" | **O** — 게이트 승인된 P10 에서 같은 명령 allow(왕복) |
| 21 | `ship verdict` NO-GO | 사유 4건 각각에 실행할 명령·놓을 경로 명시 | **O** — 지시대로 채우자 GO(전 생애주기의 「끝내는 문」 실증) |
| 22 | MCP `harness_gate_approve` | 터미널 명령 + 왜 MCP 로 안 되는지 | O — 설계된 거부, 우회는 사람 |
| 23 | ADR decide, 버린 선택지 사유 없음 | "--reject" 로 전 선택지 사유 요구 | O |
| 24 | **에이전트의 `rm -rf .harness` (하네스 해제 시도)** | ".harness/state.json can only be changed by harness commands — editing it by hand …" | **X** — 아래 결함 1 |

MCP 왕복: initialize(16 tools — README 광고 목록과 정확히 일치) → `harness_status` 정상 → 미지 키에 "this tool takes milestone, goal, design_refs, acceptance" 로 거부 → doctor repair 호출 정상.

`npm run bench:hook` 처음 받는 사람 눈: 설치 그대로 exit 0 완주. 방법론(n·워밍업·저널 3부류)·머신 기동 바닥값을 스스로 출력하고, **감정 머신이 바쁜 것을 스스로 감지해 "재실행 전에는 판정을 읽지 말라"고 경고** — 처음 받는 사람이 오독할 길을 도구가 먼저 막는다.

## 새로 생긴 거부문 전수 점검 (원인 정확성 · 다음 수 · 왕복 완주)

라운드 3-K/3-L(+SEC-219)에서 추가된 거부문을 diff(92a6a1c..d8ebde4)로 전수 추출, 각각 발화:

| 거부문 | 발화 입력 | 원인 정확 | 다음 수 | 왕복 |
|---|---|---|---|---|
| [SEC-194] 글롭이 보호 파일 지목 | `printf x >> .harness/e*.jsonl` | ✓ 맞은 파일명 명시 | "경로를 그대로 적고 harness 명령" | ✓ 읽기 글롭(`cat .harness/e*.jsonl`)·비보호 글롭은 allow |
| [SEC-195/208] 하네스 프로그램 복사 | `cp <dist>/cli.js /tmp/x.js` · python3 read/write 형 | ✓ 왜 복사가 잠금 무력화인지 설명 | "설치된 harness 명령을 쓰라" | ✓ 직접 실행(`node <dist>/cli.js status`)은 allow(SEC-96 문 유지) |
| [SEC-216] 볼 수 없는 쓰기 대상 | `p=$(…base64 -d); echo >> $p` | ✓ | "경로를 리터럴로" | ✓ 정적 대입(`LOG=build/out.log`)·리터럴·`$HOME` 쓰기 전부 allow — 과차단 없음 실증 |
| [SEC-213] 실행 시점 이름 조립 | `a=$(date +%s); echo >> .harness/$a.jsonl` | ✓ 제한된 디렉토리 명시 | 동일 | ✓ |
| [SEC-207] 추출 실패(targetLost) | `echo >> .harness/{events,_x}.jsonl` · `$(echo .harness)/events.jsonl` | ✓ (단, 후자의 표시가 `` `$` `` 로 뭉개짐 — 결함 2) | 동일 | ✓ |
| [SEC-219] 루트 밖 스크립트가 소유 파일 접근 | `/tmp/evil.sh` 에 저널 쓰기 넣고 `sh /tmp/evil.sh` | ✓ 어느 파일을 쓰는지 명시 | "harness 명령으로" | ✓ 무해한 루트 밖 스크립트는 allow — 광고한 좁은 판정 그대로 |
| [QUAL-200] 비시각 증거 거부 | txt 만 놓고 `wave complete` | ✓ 인정 형식 열거 | png/jpg/webp/html | ✓ html 로 완료 |
| [UX-193] backtrack 무인자 | `harness backtrack` | ✓ | 사용법 + `clear` | ✓ |
| [UTIL-189] 역행 후 phase set | 마커 세운 뒤 `phase set P3` | — (거부가 아니라 **통과로 바뀐 쪽**) | — | ✓ 루프 닫힘 실증 |
| [SEC-204] 과차단 축소 | `HARNESS_ALLOW_FORCED_MIGRATION=1 npm run migrate` | ✓ allow (무관 이름 통과) / `HARNESS_ALLOW_FORCE=1` 은 deny + 사람용 원문 명령 제시 | | ✓ |
| [EFF-214] 조회 복권 | `sed -n`·`cat` 저널 읽기, `cp` 저널 백업 | ✓ 전부 allow — "읽는 것까지 막히면 사람이 하네스를 끈다"는 처방 실증 | | ✓ |

「A 를 막고 B 로 보낸다」 기계 추출: dist 번들에서 거부문 안 백틱 `harness …` 참조 **전건 추출(약 60형)** — 참조된 명령·하위명령·플래그가 전부 실재함을 20개 군 실행으로 확인. **실재하지 않는 B 는 0** (단 결함 1 의 "use harness commands" 는 명령 이름이 아니라 부류 지칭이라 추출망 밖이었고, 그 부류에 해당 명령이 없다). 역행(backtrack)·소환(critical clear)·역행 종료(clear)·정책 재고정(accept-policy) 등 직전 라운드에 막다른 길이던 흐름 전부 왕복 완주.

시작만 있고 끝이 없는 흐름: 못 찾았다 — gate feedback(수집→packet 재생성 안내), usage tier(낮은 percent 보고로 해제), escalation(clear), backtrack(clear), 게이트(승인), 웨이브(complete), 출하(verdict GO) 모두 닫는 문이 실재·동작. **유일한 예외가 결함 1 의 해제(uninstall) 문이다.**

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

1. **MED — 하네스 해제 시도를 오진하고, 실재하지 않는 처방을 가리키며, 진짜 문은 어디에도 안 적혀 있다.**
   재현: 하네스 있는 프로젝트에서 pre-tool 에 `{"tool_name":"Bash","tool_input":{"command":"rm -rf .harness"}}` → deny ".harness/state.json can only be changed by harness commands — editing it by hand desynchronises the journal from the state."
   문제 셋: (a) 행위는 「편집」이 아니라 **스토어 전체 삭제(해제)** — 원인 서술이 오진. (b) 처방 "harness 명령으로 바꿔라" — 해제하는 harness 명령은 **존재하지 않는다**(20개 군 전수 확인). (c) 사람의 진짜 문("사용자가 터미널에서 `.harness/` 를 지운다" — 루브릭 개정 1 이 명시한 의도된 탈출구)이 README 4개 언어판·SKILL.md·훅 문구 어디에도 없다(`uninstall|deinit|opt-out|삭제|제거` 전수 grep 0건). 에이전트는 이 deny 를 받으면 사용자에게 틀린 안내를 중계하게 된다. 막는 것 자체는 옳다 — **문구와 문서가 문제다.**
   파일: `core/src/hook.ts:1074-1080` (디렉토리-포괄 삭제가 파일 편집용 문구를 받는 경로), README.md FAQ(문서 부재).

2. **LOW — 명령치환 대상의 거부문 표시가 뭉개진다.** 재현: `echo F >> $(echo .harness)/events.jsonl` → "computes the write target at run time (`` `$` ``)" — 대상이 `$` 한 글자로 표시. 원인·처방은 정확, 표시만 무정보. `core/src/bashwrite.ts` blindTargets 추출( `/^[$`]/` 필터) → `core/src/hook.ts:1472-1481` 표시.

3. **LOW — 빈 증거 디렉토리 거부문이 인정 형식의 절반만 광고.** 재현: 증거 0건으로 `wave complete` → "Put a **a screenshot** in <dir>" — [QUAL-200] 이후 html 목업도 게이트를 여는데 첫 거부문은 스크린샷만 말한다(파일이 하나라도 있으면 나오는 두 번째 거부문은 둘 다 말함). 스크린샷을 따르면 통과하므로 막다른 길은 아님. `core/src/wave.ts` (evidence 부재 분기).

4. **LOW — SKILL.md 의 UX 게이트 함정 설명이 [QUAL-200] 이전 계약.** "needs a **file of size > 0**" — 실측으로 txt(>0) 는 이제 게이트를 못 연다. 에이전트가 이 문서만 믿으면 첫 시도가 실패(거부문이 그 자리에서 교정해 주므로 복구는 됨). `skills/king-wjang-harness/SKILL.md` Pitfalls 절.

5. **LOW — MCP 핸드셰이크가 구버전을 보고.** initialize → `serverInfo.version: "0.0.1"`, 제품·CLI·plugin.json 은 0.1.0. `mcp/server.js:18` SERVER_VERSION. (감정 중 병행 세션이 이 파일을 수정하기 시작한 것을 관찰 — 본 결함은 대상 커밋 기준.)

6. **LOW — SessionStart 의 「다음 수」가 트랙 무관 고정 문구.** 활성 웨이브 없을 때 P7~P12 에서도 "In the design track, write your design docs then `gate submit`" — 조건부 표현이라 거짓은 아니나, 구축·출하 트랙의 자연스러운 다음 수(`wave create`·`loop next`)가 없다. `core/src/hook.ts:543`.

7. **LOW — 증거의 이중 잣대가 완료 시점엔 안 보인다.** `wave complete` 는 html 목업을 인정하는데, `ship verdict` 는 같은 웨이브에 "no real-run capture — leave headless 2x screenshots" 를 요구(§3-5). 각 메시지는 제 잣대를 경로까지 정확히 말하므로 그 자리 복구는 되지만, 완료 시점에 「출하 때는 실주행 캡처가 더 필요하다」는 예고가 없어 같은 웨이브를 두 번 방문하게 된다. `core/src/evidence.ts` vs `core/src/ship.ts:605`.

8. **LOW(경계) — `design inventory` 가 빈 결과를 무설명 exit 0.** 컴포넌트 마커 없는 HTML 에 `{"components":[],"total":0}` — 무엇을 찾는지(어떤 마커·구조) 아무 힌트가 없어, 0 이 「없음」인지 「형식이 달라 못 읽음」인지 구분 불가. `core/src/design.ts`.

## 못 잰 것 (정직 고지)

- **실제 Claude Code 플러그인 설치 흐름** (`claude plugin marketplace add` / `install`) 과 실 세션에서의 훅 배선 — 사용자 `~/.claude` 를 건드리지 않기 위해 훅은 전부 stdin 직접 구동으로 대체했다. hooks.json 의 4 이벤트 등록·타임아웃 값은 정적 확인만.
- **진짜 TTY 에서의 `gate approve` + 권한 다이얼로그 상호작용** — 문서화된 탈출구 `HARNESS_APPROVE_NO_TTY=1` 로 대체 완주. PTY 실측은 안 했다.
- **소스 빌드 경로**(`npm install` → prepare) — 「build 금지」 지침에 따라 미실측. dist 부재 시 bin/harness 의 안내문은 코드 정독으로만 확인.
- **bench 의 깨끗한 수치** — 감정 머신 부하(load 15.95/10코어)를 bench 스스로 경고했다. 이 축의 대상인 「처음 받는 사람의 경험」은 측정됐으나 수치 자체는 유효 표본이 아니다.
- **README ja/zh 번역판 품질** — 존재·명령 추출만 했고 번역 정합 검수는 안 했다.
- **`migrate` 안내의 실제 이행**(사용자 settings.json 수정) — advice-only 출력 확인까지만.
- **다중 세션·머신 간 저널 핸드오프** — 단일 샌드박스 내 /clear 상당(재주입)만 실측.
- **감정 도중 워킹트리 오염**: 05:33 KST 부터 병행 수정(SEC-221 등)이 시작됐다. 이후 실행된 실측 6건(no-TTY env·미해결 cd·패치·64KB 스크립트·P10 publish·동결 루트)은 고정 커밋에서 추출한 번들로 재실행해 동일 판정을 확인했으나, **그 외 병행 변경분은 이 감정의 대상이 아니다.**

## 점수 산출 근거

- 루브릭 명시 조건 4건: 전건 measured 충족 (조건별 실측 표).
- 이번 라운드의 질문 「거부문이 사람을 빠져나가게 하는가」: 막힌 지점 24곳 중 23곳이 그 자리 메시지의 다음 수로 탈출 가능하고, 그 다음 수들을 실제로 완주했다(설계 차단→P6 후 개방, 역행 루프 폐합, 정책 수정 왕복, 증거 게이트 왕복, 배포 차단→P10 개방, NO-GO→GO). 새 거부문 11부류 전수 발화 — 원인 오진 0, 실재하지 않는 B 0 (결함 1 제외).
- 남은 감점: MED 1건(해제 경로 — 오진 문구 + 처방 부재 + 문서 0건. 사람이 물리적으로 갇히지는 않으나, 제품이 제공하는 유일한 안내가 틀린 방향이다) + LOW 7건(표시 뭉개짐·절반 광고·구판 매뉴얼·버전 오보고·고정 문구·이중 잣대 무예고·경계 침묵).
- 4.8 은 「전건 충족 + 잔여 LOW 이하」 — MED 1건이 남아 미달. 이전 3.0 대비: 도움말·온보딩·탈출구가 구조적으로 갖춰졌고 확장된 강제에 비례해 안내가 따라왔다. **4.6.**
