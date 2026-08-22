# [1] 효용성 감정 — 4.6/5

**점수** 4.6 · **4.8 충족** ✗ (rubric 조건 2건은 전건 충족했으나, 잔여 감점에 MEDIUM 1건 — 「잔여 감점 LOW 이하」 미충족) · **감정 시각** 2026-08-23 01:50~02:15 KST · **대상** HEAD `80b633cb77d2567bd82405bb4ac42d273a1f1eeb` (`feature/core-engine-v0`, 감정 시작 시 `git status --porcelain` 깨끗 — 실측)

> **대상 이동 고지**: 감정 종료 시점 재확인에서 HEAD 가 `92a6a1c`(3-J 핸드오프 docs 커밋)로 이동했고, 작업 트리에 **미커밋 수정**(`core/src/cli.ts`·`core/dist/cli.js`·`ledger.md`·`00-summary.md`·`bench-hook-latency.mjs`)이 있었다. 그중 `cli.ts` 의 [UTIL-189] 는 **아래 결함 1 과 동일한 문제의 수리 진행분**이다(마커가 가리키는 페이즈로의 `phase set` 통과). 내 실측 시점의 dist 는 이 수정을 포함하지 않았다(거부가 실제 재현됨 — 타임라인 일관). 본 보고서의 모든 수치·판정은 **감정 시작 시 고정한 80b633c 의 커밋된 산출물** 기준이며, 미커밋 수리는 검증하지 않았으므로 닫힘으로 세지 않는다. bench 2회는 구판 스크립트로 실행했다(타이밍 코어는 신판과 동일 — diff 로 확인, 변경은 출력 포맷·판정 열 추가).

**한 줄**: 이 도구가 내건 실패 모드(설계 중 소스 쓰기·미정산 종료·증거 없는 UX 완료·코어 파일 손대기·상태 손상)는 전부 샌드박스 E2E 로 양방향 실증됐고 참조 명령 MISSING 0 인데, 제품 스스로 내건 「거부는 다음 수를 준다」 불변식이 정확히 한 곳 — 공식 역행(backtrack) 흐름 — 에서 순환 안내로 깨져 있어 4.8 에 못 미친다.

측정 환경: Apple M4 · 10 cores · RAM 24GB · macOS 26.5.2 · node v22.22.2. 모든 실측은 스크래치패드 아래 `mktemp -d` 샌드박스(`sbx-main.*`, `sbx-none.*`, `sbx-uninit.*`)에서 `cd <샌드박스>` + `CLAUDE_PROJECT_DIR=<샌드박스>` 로 수행. 리포 무수정 · `npm run build` 미실행(커밋된 `core/dist` 사용) · bench 는 `os.tmpdir()` 에만 씀(스크립트 소스로 확인 후 실행).

---

## 조건별 실측

### 조건 1 — 문서·스킬·에이전트가 부르는 명령 MISSING 0 → **충족 (measured)**

- 추출: `README.md`·`README.ko/ja/zh.md`·`skills/`(11개 SKILL.md)·`agents/`(5개)·`profiles/` 전체에서 `harness <...>` 호출 전수 grep. 프로즈 오탐(`harness design track` = "the harness design track" 등) 문맥 확인 후 제외.
- 결과: 참조된 명령군 21개 × 하위명령 약 60쌍. **전부 존재**하고, help 나열만이 아니라 **샌드박스에서 실제 실행**했다:
  - `init`·`status`·`doctor(--repair/--accept-policy)`·`phase set`·`gate submit/approve/verify/sweep/status/feedback(--from 포함)`·`wave create/activate/update/complete/list`·`node upsert/bump/list`·`doc upsert/url/submit/approve/revise/stale/list`·`adr propose/decide/revise/show/list`·`design link/sync/inventory/baseline/html/list`·`tokens gen/lint/swap`·`evidence spec/check/packet`·`loop next/attempt/brief/critical raise/clear`·`ship defect add/update/list, deploy, deployments, verdict, checklist`·`report packet/rtm/hub`·`profile show/cmd`·`usage status`·`trace`·`backtrack`/`backtrack clear`·`migrate`·`hook ×4` — 모두 실행, exit code 설계 의도대로(예: `loop critical raise` 의 exit 2 = "사람 소환" 의미까지 출력에 명시).
  - 21개 명령군 `--help` 전부 exit 0.
  - MCP: `mcp/server.js` 에 `tools/list` 실측 → **정확히 16개**, README 광고 목록과 일치. `harness_gate_approve` 는 광고대로 거부 전용(터미널 안내 반환) — 실측.
- **MISSING: 0건.**

### 조건 2 — 3대 실패 모드 대응 E2E 실증 → **충족 (measured, 전부 양방향)**

내가 정의한 실패 모드(README 의 제품 약속에서 도출): ① 설계 전 구현, ② 미정산 세션 종료, ③ 그리지 않은 UX 출하. 셋 다 훅 stdin 프로토콜로 E2E:

| 실패 모드 | 차단 방향 (measured) | 반대 방향 = 과차단 짝 (measured) |
|---|---|---|
| ① 설계 트랙 소스 쓰기 | P0 에서 `Write src/app.ts`·`lib/foo.js`, Bash `>`·`tee`·`sed -i` 소스 표적, `npm publish`·`docker push` — **11/11 deny** | 같은 P0 에서 `docs/`·루트 `*.md`·`package.json`·`assets/`·`.harness/evidence/`·`test/` 밖 테스트 파일 쓰기, `git`·`npm test`·`ls`·`mkdir` — **allow**. P6 게이트 승인 후 P7 에서 `Write src/app.ts` — **allow(무출력)** |
| ② 미정산 stop | 활성 웨이브 + post-tool 활동 기록 후 `stop` → **block**, 메시지가 정확한 다음 수(`harness wave update "<...>"`)와 사소-턴 탈출구를 함께 줌 | `wave update` 정산 후 stop → **침묵 allow** · 활동 없는 stop → **침묵 allow** · 웨이브 비활성 프로젝트 stop → **침묵** |
| ③ 증거 없는 UX 완료 | `--refs UX-1` 웨이브 `complete` → 거부(증거 폴더 명시). **가짜 PNG(헤더 위조) 거부** · 1×1 유효 PNG 거부 · 300×300/911B 균일색 PNG 거부 — 문서(size>0)보다 강한 검증이 실제로 동작 | 300×300 노이즈 PNG(270KB) 투입 → `evidence check` ok:true → `wave complete` **성공** |

추가로 실증한 부수 계약(전부 measured):
- **코어·정책 파일 잠금**: `state.json`·`events.jsonl`·`config.yaml`·`design/ledger.yaml`·`.harness/profile/` — Write·Bash(sed) 전부 deny, P0/P7 양 트랙.
- **인간 전용 잠금**: `gate approve` 는 TTY 없으면 CLI 자체가 거부(에이전트 tool call 형상). 에이전트가 Bash 로 `harness gate approve`·`HARNESS_ACCEPT_POLICY=1 doctor --accept-policy`·`phase set --force`·**python pty 래퍼** 시도 → pre-tool 훅이 전부 deny. (pty 로 승인이 되는 것은 진짜 인간 터미널을 모사한 내 감정 스크립트뿐 — 세션 안 에이전트 경로는 닫혀 있음을 실측.)
- **STALE 전파**: `node bump F-1` → 참조 웨이브 2건 즉시 stale + "stop 가드가 함께 풀렸다" 경고까지 출력. STALE 웨이브 재활성 시도 → 거부 + 정확한 대체 명령 제시.
- **회복 경로**: `state.json` 파손 → pre-tool 이 **저널 재생으로 정확한 판정 유지**(fail-open 아님 — 파손 상태에서 deny 가 나와야 할 입력으로 판별), SessionStart 가 ⚠ 열화 경고 주입, `doctor` ok:false → `--repair` 로 P7 상태 복원. 전량 손상 저널 + 캐시 부재의 극단에서도 deny 사유 말미에 `[state damaged — run harness doctor --repair; 58 journal line(s) corrupt]` 가 붙음 — 열화가 판정 지점에서 관측 가능.
- **비간섭**: `.harness/` 없는 디렉토리에서 4 이벤트 × exit 0 × stdout 0바이트, 깨진 JSON·빈 stdin 도 0바이트, **파일 생성 0**(디렉토리 empty 확인).
- **게이트 안티게이밍**: 80자 미만 제출 거부(현재 글자수 명시) · 타 페이즈 등록 문서로 게이트 열기 거부(레지스트리 근거 명시).
- **게이트 승인 체인**: P0→P6 제출·승인·`phase set` 전진을 실제로 완주(승인은 pty 로 인간 모사). 미승인 시 `phase set` 이 가장 이른 미승인 게이트와 정확한 명령 순서를 제시.

## 내가 만든 목록 / 내가 설계한 검사

rubric 조건 밖에서 추가로 설계·실측한 것:

1. **판정의 입력(정책) 자체를 쓰는 경로** — `config.yaml`·`.harness/profile/` 쓰기 deny ✓, 사람이 config 를 고치면 `doctor` 가 정책 드리프트를 경고(ko 로도) ✓.
2. **과차단 스윕**(아래 절).
3. **손상 저널 전량 파손 시 상태 오판** — 재생이 P0 로 떨어져 빌드 프로젝트의 소스 쓰기를 막지만, deny·SessionStart·doctor 3면에서 열화가 고지됨. 진실 원천 자체를 잃은 경우라 제품 통제 밖 — 결함으로 안 세움.
4. **첫 실행 온보딩** — 미초기화 `status`/`wave create` → "run `harness init` first" · `init` 성공 출력이 다음 수 + **allowlist 금지 경고**(gate approve 를 허용목록에 넣지 말라)까지 · 중복 `init` 거부.
5. **오류 메시지 행동 가능성** — 미지 명령(후보 전체 나열)·잘못된 페이즈(유효값 나열)·없는 ref(등록 명령을 CLI/MCP 양쪽으로 제시)·goal 누락(이유 설명 포함) 전부 즉시 다음 수가 나옴.
6. **SessionStart 주입량** — 무웨이브 466자 ≈ 116 tokens (README 주장 ~240 tokens 이내).
7. **`migrate`** — 실제로 내 머신의 legacy 훅 4건을 탐지하고 "advice only" 를 명시.
8. **lang: ko** — CLI·doctor·훅 deny 메시지 한국어 전환 실측.

## 반대 방향 (과차단) 측정

- **P7 빌드 트랙**: 흔한 명령 15종(`python3 -c`·`node -e`·`npx vitest`·`git commit`·`curl`·`grep`·`cat state.json`·`npm install/build`·`make test`·스크립트 실행·`/tmp` 리다이렉트·`sed -i src`·`docker build`·`gh pr create`) — **15/15 allow**.
- **P0 설계 트랙**: 동일 스윕 + 설계 작업 명령 — 18종 중 **17 allow**, 소스 표적(`sed -i src`·`> lib`·`npm publish`)만 deny. 셸 스크립트는 **내용 해석**까지 정확: 읽기만 하는 `./scripts/check.sh` allow, `src/` 에 쓰는 `./scripts/writer.sh` deny.
- **발견한 과차단 1건**: 설계 트랙에서 **프로젝트 내 `.py`/`.js` 스크립트 실행이 deny** — `python3 scripts/analyze.py`(print 만 함) 가 ".py 파일은 소스 코드다 … (셸 쓰기 대상)" 사유로 막힘. **실행을 쓰기로 오분류**. 완화 실측: `python3 -c` · `-m` · `docs/` 하위 스크립트 · 프로젝트 밖 절대경로는 전부 allow → 좁고 우회 가능하나, 읽을 수 있는 스크립트 파일은 막고 불투명한 인라인 `-c` 는 허용하는 역전이 있음 (LOW~MED 경계, LOW 로 등재).
- **stop 가드**: 사소 턴(활동 없음)·웨이브 비활성 시 완전 침묵 — "질리게 하는" 방향의 잡음 0.
- **주의(정직 고지)**: 최초의 「설계 트랙 스윕」은 backtrack 결함(아래 결함 1) 때문에 실제로는 P7 에서 돌았다. 발견 즉시 P0 샌드박스에서 전체 재실행했고 위 수치는 재실행 값이다.

## G9 입력 집합 분리 검증

**판정: 구분 자체는 조건부 정당 — 그러나 「도달 불가」 문구는 기계적 보증이 아니라 개연성 판단이며, 그 구분이 통과의 하중을 실제로 받치고 있다(내 머신에서 적대 부류는 두 번 다 문턱 초과).**

1. **「저널은 harness 명령으로만 늘어난다」 — 사실 (measured)**. `appendEvent` 호출부 전수: 37곳, 전부 CLI/MCP 명령 모듈(`cli/wave/gate/ledger/registry/adr/design/loop/ship/doctor/policy/mcp`). **훅은 저널에 쓰지 않는다** — `hook.ts` 의 유일한 append 는 `.runtime/hook-errors.log`(hook.ts:300), 활동 추적은 `.runtime/last-activity·last-turn`(runtime.ts:9·14). 에이전트의 저널 직접 쓰기는 Write·sed·리다이렉트 전부 deny (실측 D6·D9).
2. **「10만 상태 전이 도달 불가」 — 과장 (inferred + 부분 measured)**. 재생 대상 타입은 9종(`REPLAY_TYPES`, events.ts:93-97). 이를 늘리는 경로에 **상한·속도 제한은 없다**: (a) `node bump` 는 참조 웨이브 N개당 `wave-stale` N건을 append (wave.ts:326 — 1명령→N전이 증폭), (b) 에이전트가 `wave activate` 핑퐁·`gate submit` 반복을 합법적으로 루프할 수 있고 MCP 도구도 같은 엔진을 부른다. 유기적 사용으로는 무거운 프로젝트도 O(10³) 전이 수준이라 10⁵ 은 비개연 — 그러나 「도달할 수 없다」(불가)가 아니라 「도달할 개연성이 낮다」가 정확하다. 로그성 대량 이벤트(`wave-turn-logged`·`wave-attempt`)는 사전 필터가 건너뛰므로 적대 부류에 안 들어간다는 구분은 코드와 일치.
3. **문턱/기록 구분의 정당성**: 문턱 부류(현실 분포·손상)는 실제 도달 상태(크래시·트렁케이션)를 덮고, 손상 줄 집계·노출(`readJournal` corruptLines)도 실재. 적대 부류는 합성 극단이 맞다. **통과시키기 위한 구분인가?** — 숫자를 숨기지 않고 기록하고, 대장에 COST-178(LOW·deferred)로 등재했으며 「다음 감정에서 이 구분 자체를 재검증받는다」고 스스로 적었고(gates.md G9 말미·ledger.md:225), README 알려진 한계에도 재생 비용을 공개한다 — 은폐형 통과는 아니다. **다만**: 문턱을 전 부류에 걸었다면 내 머신에서 G9 은 불통과였다(아래). 구분이 곧 통과 조건이라는 사실은 명시적으로 유지·재검증돼야 한다.
4. **`npm run bench:hook` 직접 실행 (measured)** — 측정 표면: **프로세스 wall-time**(`execFileSync` 로 `bin/harness-hook pre-tool` 자식 프로세스 기동, node 부팅 포함), n=30·워밍업 3·저널 100k줄, 스크립트가 node 기동 바닥값을 별도 표기. 머신: Apple M4·10코어·node v22.22.2·macOS 26.5.2.

   | 부류 | 1차 (load 23.9) | 2차 (load 8.2) | 문턱 50ms |
   |---|---|---|---|
   | node 기동 바닥 p50 | 49.4ms | 39.8ms | — |
   | realistic 폴백 추가 p95 | **+44.0ms** | **+21.3ms** | 내 |
   | corrupt 폴백 추가 p95 | **+3.8ms** | **+36.1ms** | 내 |
   | all-state 폴백 추가 p95 | **+51.4ms** | **+67.8ms** | **초과** |

   - 적대 부류는 **두 번 다 50ms 초과** — gates.md 의 자기 고지(49.4ms·"느린 머신에서는 넘는다")가 빠른 M4 에서도 성립함을 확인. record-only 결정이 관념이 아니라 **실제로 게이트 판정을 가르는 자리**다.
   - 부수 관찰 2건: (a) 패키지 벤치는 **한 표면(wall-time)만** 잰다 — G9 의 「세는 방법」은 두 표면 모두인데, 인프로세스 표면은 커밋된 evidence 로그로만 남아 있고 설치본으로 재현할 수단이 없다(ENG-187 이 부분 인지). (b) 정상/열화를 순차 측정해 델타에 부하 드리프트가 실린다 — corrupt 델타가 실행 간 +3.8↔+36.1ms 로 요동(ENG-187 의 「노이즈 규칙 부재」 실증).

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

1. **[MEDIUM] 공식 역행(backtrack) 흐름의 순환 안내 — 닫힌 두 결함(UX-122·UTIL-176)의 합성 모순**
   - 재현(샌드박스, P7 상태): `harness backtrack P4 --reason x` → exit 0, 출력이 "run `harness phase set P4` to go back" 지시 → `harness phase set P4` → **exit 1**, 거부문이 "Use `harness backtrack P4 --reason ...`" — 방금 실행한 그 명령을 다시 가리킨다. 마커는 서 있는데(`status` 확인) 두 안내가 서로를 순환.
   - 원인: `cli.ts:1310-1318`(UX-122 가 넣은 backtrack 성공 문구)이 `phase set` 을 지시하고, `cli.ts:475-486`(UTIL-176)이 후진 `phase set` 을 **마커 유무와 무관하게** 무조건 거부. 대장에는 둘 다 verified·closed (ledger.md:169·223) — 각자는 검증됐으나 **합성 흐름은 아무도 재실행하지 않았고**, 낡은 문구를 고정하는 테스트까지 있다(`core/test/low-3i-guidance.test.ts:81`).
   - 실질 영향: 기능 자체는 산다 — 마커만으로 `.harness/design/` 편집이 열림(실측 ALLOW). 그러나 「거부는 다음 수를 준다」는 제품 1급 불변식이 1급 흐름에서 깨지고, README 명령표의 "Officially return to design"(README.md:191) 도 실제로는 페이즈가 돌아가지 않아 어긋난다. 에이전트는 안내 루프에 최소 1턴을 태우고, 문서(p6 스킬)까지 읽어야 마커 의미를 안다.
   - 후기: 감정 종료 시점 작업 트리에 이 문제의 수리 진행분([UTIL-189], 미커밋)이 관찰됐다 — 독립 발견이 교차 확인된 셈이나, 커밋·검증 전이므로 본 감정에서는 open 으로 센다.
2. **[LOW] 설계 트랙에서 프로젝트 내 스크립트 실행을 「쓰기」로 오분류** — `python3 scripts/analyze.py`(읽기 전용) deny, 사유가 "구현 코드를 **쓸** 수 없다 … (셸 쓰기 대상)" (hook.ts 의 경로 추출 정규식 ~:715 이 실행 인자를 쓰기 대상으로 취급). `node scripts/gen.js` 동일. 우회는 넓으나(인라인 `-c`·`-m`·`docs/` 하위·프로젝트 밖 경로 전부 allow — 실측) 읽히는 파일은 막고 불투명 인라인은 허용하는 역전 + 오도하는 사유.
3. **[LOW] 설계 트랙 deny 문구의 자기모순 — 테스트 파일** — `Write src/app.test.ts` deny 는 source_globs 우선으로 의도된 동작이나, 같은 deny 문구가 "files **named** as tests (`*.test.*` …) 는 쓸 수 있다"고 광고해 방금 거부당한 형태를 다시 시도하게 만든다(우선순위 미고지, hook.ts 설계트랙 deny 문구). README config 표의 "tests, config, and docs are not blocked by this rule"(README.md:225)도 과광고.
4. **[LOW] 증거 거부 사유가 실패 기준을 반만 말함** — 300×300/911B PNG 가 "최소 200px" 사유로 거부되지만 실제 탈락 기준은 `MIN_PNG_BYTES=1024`(evidence.ts:126·488-496) — 픽셀 조건을 이미 충족한 제출자가 고칠 것을 알 수 없다. 실제 스크린샷(270KB)은 여유 통과라 실질 과차단 확률은 낮음.
5. **[LOW] G9 record-only 사유 문구 과장** — "도달할 수 없다"는 기계적 보증이 아님(상한·속도 제한 부재, `node bump` 1명령→N전이 증폭, wave.ts:326). 「유기적 사용에서 비개연」으로 적어야 정확. 구분 자체·기록·대장 등재는 유지(위 G9 절).
6. **[LOW] 패키지 벤치가 G9 의 두 표면 중 하나만 실림** — `scripts/bench-hook-latency.mjs` 는 wall-time 만. 인프로세스 표면은 재현 수단 미동봉(ENG-187 부분 인지). + 순차 측정 설계로 델타가 부하에 민감(실행 간 요동 실측).

## 못 잰 것 (정직 고지)

- **실제 Claude Code 플러그인 설치 E2E** (`claude plugin marketplace add` → hooks 자동 배선) — 훅은 stdin 프로토콜 수준으로만 검증. `hooks.json` 의 `${CLAUDE_PLUGIN_ROOT}` 치환·타임아웃 10s 의 실전 동작은 미실측.
- **P8~P12 승인 체인 완주** — P0→P7 만 완주. `ship verdict` 는 미승인 상태의 NO-GO(사유 3건 명시)로만 실측, GO 경로 미도달.
- **MCP 16 도구의 개별 기능** — `tools/list` 존재 + `gate_approve` 거부만 실측, 나머지 15개 도구의 호출 결과는 미실측.
- **~240 tokens 주장의 상한** — 무웨이브 116 tokens 만 측정, 활성 웨이브+턴로그+열화 경고가 다 실린 최대 주입량 미측정.
- **인프로세스 표면의 훅 지연** — 커밋된 evidence 값(19ms 등)을 재현하지 않음(재현 수단이 패키지에 없음 — 결함 6).
- **대형 상태(수백 웨이브·수천 노드)에서의 CLI 명령 지연**.
- **README ja/zh 의 명령 외 서술 정확성** — 명령 문자열 존재 대조만.
- **`design sync` 승인-노드 개정 경로** — draft 노드 경고 메시지까지만(승인 노드 bump 연쇄는 node bump 로 대체 실증).

## 점수 산출 근거

- rubric 조건: ① 참조 명령 MISSING 0 — **충족(measured, 실행 검증까지)** ② 3대 실패 모드 E2E — **충족(measured, 전 항목 차단·허용 양방향)**.
- 도구의 핵심 가치 명제 — 「없을 때 대비 무엇을 막고 무엇을 되게 하나」 — 는 방어(설계 전 구현·미정산 종료·가짜 증거·자기 권한 확장·인간 전용 잠금)와 회복(재생 폴백이 fail-open 이 아님을 판별 실측, doctor --repair 복원)과 침묵 비용(비간섭 0바이트·과차단 33/34 통과) 모두에서 실증됐다. 라운드 3-J 시점 문서보다 실물이 더 강한 지점(PNG 헤더·크기 검증, 스크립트 내용 해석)도 확인.
- 그러나 4.8 의 둘째 조건 「잔여 감점 LOW 이하」에서 **MEDIUM 1건**(결함 1 — 제품의 1급 불변식이 1급 흐름에서 깨지고, 대장의 closed 2건이 합성 모순을 이룸)이 남는다. → **4.8 미달**.
- 4.5(전 라운드 값) 대비: 조건 2건이 새로 전건-measured 로 충족됐고 과차단 실측 폭이 넓어졌으므로 +0.1. 결함 1 이 남아 있어 그 이상은 근거 없음. → **4.6**.
- 등재 결함이 수리되면(문구 2곳 + 테스트 1곳 수준) 이 축은 4.8 조건을 충족한다.
