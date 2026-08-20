# king-wjang-harness 진행상황 (핸드오프)

## 2026-08-20 — ★ 코어 엔진 v0 구현 완료 (14/14 태스크, 로드맵 1번 종료)

### 최종 상태
- **브랜치 `feature/core-engine-v0`** (push 안 함), 최종 검증: **134 tests passed(12 파일)**,
  `tsc --noEmit` 클린, tsup 빌드 성공(36.65KB), `bin/harness --version` 동작.
- **Task 13 완료** (`2f104d6`): `hooks/hooks.json` 배선(전 이벤트 `harness hook` 한 줄).
  현행 Claude Code 훅 문서와 스키마·출력 계약 일치 실검증(curl 원문 대조). 스모크 4종 통과
  (P8 허용 / P0 설계 차단 deny / stop 가드 block→정산 후 통과 / doctor ok).
- **Task 14 완료**: 전체 검증 + 이 핸드오프.
- 각 태스크는 구현→스펙 리뷰→품질 리뷰(수정 루프 포함) 2단계 리뷰를 통과함. 품질 리뷰가 잡아낸
  주요 결함(경로 정규화 우회, 웨이브 쓰기 id 비대칭, doctor 신뢰도 게이트, 저널 손상 은폐 등)
  전부 수정·재승인 완료. 상세는 아래 태스크별 기록.

### 최종 코드 리뷰 결과 (2026-08-20) — ★ 머지 불가, Critical 3건 수정 필요
전체 브랜치 리뷰(b22a49f..HEAD) 판정: **머지 차단 3건. C1·C2는 반드시 함께 수정.**
- **C1 — activeWave 웨이브 파일 유실 시 영구 잠금**: complete/update/activate 전부 ENOENT,
  doctor --repair --force도 무동작(replay도 같은 activeWave라 issues 0), state.json 직접 편집은
  훅이 차단, hook 안내는 doctor로 보내는데 doctor에 수단 없음. **수정**: doctor가 "activeWave
  파일 부재"를 warning이 아닌 issue로 올리고 --repair 시 activeWave 정산(null).
- **C2 — createWave id 재발급** (wave.ts:73-76 디스크 파일명 기반): 파일 삭제 후 create가 같은
  id 재발급 → 이전 웨이브의 evidence/wave-NNN/을 자기 증적으로 인정, **스크린샷 0장으로 UX 게이트
  통과**(재현됨). git 브랜치 전환으로도 트리거. **수정**: 저널 wave-created 최대 id와 디스크
  최대치 중 큰 값 + 파일 존재 시 거부.
- **C3 — 심링크 루트에서 CORE_FILES 보호 우회** (hook.ts relPath가 realpath 미정규화):
  실경로로 주면 state.json 편집 통과(재현됨). **수정 한 줄**: fs.realpathSync.native 정규화
  (실패 시 원본 유지).
- **값싼 수정 후보**(같은 웨이브에서): core/dist gitignore인데 prepare 스크립트 없음 → 클론 직후
  bin/harness MODULE_NOT_FOUND(훅 무해 계약이 CLI 바깥에서 깨짐, `"prepare": "tsup"` 추가) ·
  .runtime/.gitignore `*`가 자신도 무시(`*\n!.gitignore`로) · markStale이 activeWave 비울 때
  그 세션 stop 가드 꺼짐 · hook-errors.log 비울 수단(doctor가 정리) · --refs 원장 미존재 id 무검증.
- 로드맵에서 자연 해소로 기록: gate CLI(로드맵 2), terse 소비·trace·plugin.json(각 로드맵),
  P7~P9 배포 명령 차단(로드맵 5), backtrack의 phase 복귀 시맨틱.

### 다음에 즉시 할 일
1. **Critical 수정 웨이브**: C1+C2 함께, C3 한 줄, 값싼 수정 후보 포함 → 테스트 추가 →
   최종 리뷰어 재판정 (에이전트 a749acc532540f1d1 트랜스크립트에 재현 절차 있음. 새 세션이면
   이 섹션 내용만으로 충분)
2. 통과 시 superpowers:finishing-a-development-branch 로 main 병합 여부 사용자 확인
3. **로드맵 2번 "게이트·리뷰 패킷"** 스펙→플랜 사이클 시작

### ⚠ 세션 상태 (2026-08-20 오후)
**사용량 한도 99% 경보 관측** — token-guard 정책상 신규 작업 중단, 이 핸드오프가 마지막 갱신.
한도 도달 시 auto-retry가 리셋 후 재개하거나, 사용자가 새 세션에서 이 파일로 이어받는다.

### 미해결·확인 대기 / 이월 기록
- `MultiEdit`은 현행 도구 목록에 없음(무해한 죽은 분기) — 하위호환 위해 유지 결정, 정리 후보
- I6 근본책(훅 자기호출을 정규식 대신 CLI 마커로 식별) — 로드맵 후속
- replayState가 "버린 이벤트 수" 미반환(M1), doctor의 웨이브/원장 정합 검사(M3) — 로드맵 후속
- **사용량 한도 96% 경고 관측됨(2026-08-20 오후)** — 한도 도달 시 auto-retry가 재개.
  새 세션은 이 파일만 읽으면 이어받기 가능.
- 마켓플레이스 배포 채널·auto-retry bypassPermissions 고지 수위 (스펙 단계부터 이월)

## (이하 태스크별 상세 기록) — 코어 엔진 v0 구현 (Task 12/14 완료 시점 기준)

### 완료
- 브레인스토밍 + 마스터 설계 스펙 (`docs/superpowers/specs/2026-08-20-king-harness-design.md`),
  검토용 아티팩트 https://claude.ai/code/artifact/ca5f0860-4d76-40c5-b2e9-166c9c7f5397 (스펙 승인 완료)
- 구현 플랜 작성: `docs/superpowers/plans/2026-08-20-core-engine-v0.md` (14 태스크, TDD, Task별 체크박스)
- **Task 1: 프로젝트 스캐폴드** — package.json/tsconfig.json/tsup.config.ts/vitest.config.ts/
  bin/harness/core/src/cli.ts/.gitignore. 커밋 `858c358`, `d7c2fef`(.omc 스크래치 정리).
- **Task 2: 타입·경로·config** — `core/src/types.ts`(Phase 상수+HarnessState 등 타입 단일 정의처),
  `core/src/paths.ts`(.harness/ 경로 헬퍼), `core/src/config.ts`(config.yaml 로드+기본값 병합),
  `core/test/config.test.ts`(2 tests). 검증: vitest 2 passed, `npm run check` 타입 에러 0.
  커밋 `7bf9a42`, `49c9f45`(config 정규화 보강). 브랜치 `feature/core-engine-v0` (push 안 함).
- **Task 3: 상태 저장소** — `core/src/state.ts`(defaultState/readState/writeState 임시파일+rename
  원자적 쓰기/initHarness/isInitialized), `core/test/state.test.ts`(5 tests: 초기화 트리 생성,
  중복 초기화 시 에러, 원자적 쓰기 잔여 tmp 없음, updatedAt 갱신, .runtime/.gitignore). 검증:
  vitest 14 passed(state 5 + config 9), `npm run check` 타입 에러 0. 커밋 `85a1c8c`.
- **Task 3 품질 리뷰 수정** — Critical: `initHarness` 가드를 `isInitialized`(state.json 존재)에서
  `fs.existsSync(harnessDir(root))`(디렉토리 존재)로 교체 — state.json만 사라진 `.harness/`에서
  init 재실행 시 events.jsonl(진실의 원천)·config.yaml이 덮여 전멸하는 사고를 차단.
  `isInitialized`는 시그니처·의미 유지(훅 비간섭 판정용으로 별도 존치). writeState의 rename
  주석에 내구성 한정어 추가(내구성은 events.jsonl 재생 담당). 공허했던 updatedAt 테스트를
  고정 과거값 비교로 교체 + 회귀 테스트 추가(state.json만 지운 채 재실행 시 throw & events 보존).
  검증: vitest 15 passed(state 6 + config 9), `npm run check` 타입 에러 0. 커밋 `a04b18f`.
- **Task 4: 이벤트 저널 (append/replay)** — `core/src/events.ts`(appendEvent/readEvents/
  replayState), `core/test/events.test.ts`(5 tests: 순서 보존, replay로 상태 재구성, 미지
  이벤트 타입 무시(전방 호환), 유효하지 않은 phase의 phase-set 무시(손상 방어), 깨진 JSONL
  줄 스킵(부분 손상 방어)). 리뷰 확정 계약 2건 반영: (A) 모듈 헤더에 "appendEvent는
  writeState보다 먼저" 변이 순서 계약 명시, (B) replayState의 phase-set/backtrack-started는
  `isPhase` 검증 후 대입(맨 캐스트 아님) — 손상 이벤트가 state를 오염시켜 doctor가 정품으로
  세탁하는 사고 방지. 검증: vitest 20 passed(state 6 + config 9 + events 5), `npm run check`
  타입 에러 0. 커밋 `a81c442`.
- **Task 5: 설계 원장 CRUD + bump/STALE 스캔** — `core/src/ledger.ts`(loadLedger/saveLedger/
  getNode/upsertNode/bumpNode), `core/test/ledger.test.ts`(6 tests: 빈 원장 upsert→get, 같은
  id upsert는 교체, bumpNode의 version++/status→stale/참조 웨이브 id 반환, 없는 노드 bump는
  에러, 이미 stale인 웨이브는 affectedWaves 제외, frontmatter 없는 웨이브 파일은 스캔 무시).
  bumpNode는 실제 웨이브 STALE 마킹을 하지 않고 affectedWaves(id 배열)만 반환 — 호출측(Task 12
  CLI)이 wave.markStale로 마킹하는 분리 설계(순환 import 방지, ledger.ts는 wave.ts를 모른다).
  검증: vitest 32 passed(state 6 + events 11 + config 9 + ledger 6), `npm run check` 타입
  에러 0. 커밋 `dd6a291`.
- **Task 5 품질 리뷰 수정 — 원장 하드닝** — Important 2건 + 보강 4건: (1) 웨이브 파일 식별을
  `f.endsWith('.md')`(느슨) → `/^wave-\d+\.md$/`로 통일하고 affectedWaves는 `meta.id` 대신
  **파일명 stem**을 push(소비처 markStale이 파일명으로 해석 — frontmatter id 오기입/불일치에
  안전). (2) `saveLedger`를 state.ts와 동일한 tmp+rename 원자적 쓰기로 교체(원장은 저널 재생
  복구가 없어 state.json보다 위험도 높음). 그 외: 모듈 헤더에 "원장은 저널 파생 아님(git이
  복구 수단)" 계약 명시, `loadLedger`가 `nodes` 필드 배열 검증(`Array.isArray`) 후 아니면 [],
  frontmatter 정규식 CRLF 대응(`\r?\n`), `upsertNode`를 filter+push에서 `findIndex` 제자리
  교체로 변경(원장 내 노드 순서 보존, diff 안정성). `core/test/ledger.test.ts`에 7 tests 추가
  (wave-*.md 패턴 아닌 파일 무시, 깨진 YAML frontmatter 스킵, CRLF frontmatter 감지, 참조
  웨이브 여럿일 때 파일명 정렬 반환, nodes 비배열이면 빈 배열, upsert 순서 보존, saveLedger
  후 .tmp- 잔여 없음) — 총 13 tests, 기존 6개 중 3개는 반복되는 웨이브 frontmatter 작성을
  `writeWave` 헬퍼로 리팩터(테스트 파일 내 DRY, 프로덕션 코드 영향 없음). 검증: vitest 39
  passed(state 6 + events 11 + config 9 + ledger 13), `npm run check` 타입 에러 0.
  커밋 `7178e14`.
- **Task 6: 웨이브 지시서 수명주기 + runtime 스텁** — `core/src/runtime.ts`(noteActivity/
  noteTurnLogged/readRuntime — `.harness/.runtime/{last-activity,last-turn}` 타임스탬프 파일),
  `core/src/wave.ts`(parseWave/serializeWave/readWave/listWaves/createWave/activateWave/
  logTurn/completeWave/markStale), `core/test/wave.test.ts`(8 tests: 번호 자동증가+pending
  생성, activate 단일성+state.activeWave 갱신, logTurn 턴로그 추가, 활성 웨이브 없으면
  logTurn 에러, UX 참조 웨이브는 시각 증적 없으면 complete 거부·있으면 done, markStale,
  CRLF frontmatter 파싱, done 웨이브 재활성 불가). 리뷰 이월 계약 2건 반영: (A)
  activateWave/completeWave 모두 appendEvent를 writeState보다 먼저(events.ts 헤더 변이
  순서 계약 준수), (B) parseWave 정규식 `/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/`로
  CRLF 허용. createWave 번호 자동증가는 listWaves(파일명 `wave-\d+\.md` 패턴) 최댓값+1 —
  ledger.ts bumpNode의 파일명 stem 기준 affectedWaves와 일관. 검증: vitest 47 passed
  (state 6 + events 11 + config 9 + wave 8 + ledger 13), `npm run check` 타입 에러 0.
  커밋 `05bded4`. 관찰(미수정, 지시서 스펙 그대로): wave.ts의 파일 쓰기는 state.ts/ledger.ts와
  달리 tmp+rename 원자적 쓰기가 아니라 직접 writeFileSync — 필요 시 별도 리뷰 대상. markStale은
  활성 웨이브 여부를 확인하지 않아 활성 웨이브를 stale 처리해도 state.activeWave가 그대로
  남는 엣지케이스 있음(테스트 범위 밖).
- **Task 7: runtime 스크래치 테스트 보강** — `core/test/runtime.test.ts`(3 tests: noteActivity/
  noteTurnLogged 타임스탬프 기록, readRuntime 빈 파일·미존재 시 undefined 방어). runtime.ts
  본체는 Task 6에서 이미 생성 완료라 이번엔 테스트만 추가, 소스 변경 없음. 검증: vitest 50
  passed(wave 8 + ledger 13 + runtime 3 + 기존), `npm run check` 타입 에러 0. 커밋 `d9d6577`.
- **Task 8: 훅 판정기 — session-start 주입 + 비간섭/무해 불변식** — `core/src/hook.ts`
  (handleHook 진입점, sessionStart: 페이즈·활성 웨이브·remote-control·backtrack·저널 손상
  경고 주입, `.harness/` 없으면 완전 침묵, 판정 실패는 절대 throw 안 하고 null + hook-errors.log
  흔적), `core/test/hook-session-start.test.ts`(6 tests). 이후 하드닝 라운드에서 대거 보강:
  (a) 경로 정규화(`docs/../src/a.ts` 우회 차단, 루트 밖 절대/상대경로 차단, 빈 file_path
  안전 기본값 차단), (b) 코어 파일 보호(`.harness/{state.json,events.jsonl,design/ledger.yaml}`
  직접 편집 금지 — 페이즈·config 무관, `.harness/` 무조건 허용보다 우선), (c) 활동 집계를
  쓰기 가능 도구(Write/Edit/MultiEdit/NotebookEdit/비자기호출 Bash)로 한정하고 harness 자기
  호출은 **명령 위치**에서만 식별(주석·인자 속 "harness" 낱말 오탐 방지), (d) session-start
  마커 리셋을 `source==='startup'|'clear'`로만 한정(`compact`/`resume`/미지정은 정산 증거
  보존 — 컨텍스트 압축 직후 stop 가드가 함께 풀리는 회귀 차단), (e) 턴 로그 인용을 구분자로
  감싸고 줄당 200자 절단(프롬프트 인젝션 폭 제한), (f) 저널 손상 줄 수를 주입·차단 사유 양쪽에
  노출. 커밋 `6305fc7`(구현) → `12fc1cd`(하드닝 1차) → `ff8baf4`(compact 회귀 차단). 검증:
  vitest 91 passed, `npm run check` 타입 에러 0.
- **Task 9+10 (통합): pre-tool 차단 매트릭스·stop 가드 잔여 테스트** — 하드닝 라운드에서 이미
  커버된 걸 빼고 남은 케이스만 신규 파일 2개로 추가. `core/test/hook-pre-tool.test.ts`(8 tests:
  설계 페이즈 docs/·루트 md 허용, 배포성 Bash 차단, 일반 Bash 허용, 구축 페이즈 소스 쓰기
  허용, 설계 문서 직접 수정 차단+backtrack 안내, backtrack 중엔 설계 문서 수정 허용, Read는
  무간섭, 출하 페이즈도 설계 문서 차단), `core/test/hook-stop.test.ts`(4 tests: 로그가 활동보다
  나중이면 통과, `stop_hook_active`는 루프 가드로 무조건 통과, 활성 웨이브 없으면 통과, 차단
  사유에 갱신 명령+탈출구 문구 포함). 기존 hook-misc.test.ts/hook-session-start.test.ts는
  무수정. 사전에 hook.ts 실동작과 테스트 기대를 전부 대조 검증했고 전 케이스 수정 없이 1회에
  그린 — hook.ts 자체는 무수정. 검증: vitest 103 passed(10 files), `npm run check` 타입
  에러 0. 커밋 `5a2463e`.
- **Task 11: doctor — 무결성 검사·재생 복구** — `core/src/doctor.ts`(runDoctor →
  `{ok, repaired, refused, issues, warnings, notes}`), `core/test/doctor.test.ts`(14 tests).
  설계 핵심 3가지: (1) **issues(=state.json이 이벤트 재생과 발산 — 복구 대상이자 ok 판정
  기준) 와 warnings(=저널 건강·환경 진단 — 복구로 안 고쳐지므로 ok를 내리지 않음) 분리** —
  버전 스큐로 생기는 미지 이벤트가 영구 red를 만들어 경보를 죽이는 걸 차단. (2) **신뢰도
  게이트(trustworthy)는 복구 게이트일 뿐 ok와 무관** — 손상뿐 아니라 **저널 부재·절단 의심도
  불신**으로 침("증거 없음"은 "아무 일 없었다는 증거"가 아니다). 발산이 있는데 저널을 못
  믿으면 `refused` 반환하고 `--force` 로만 강제. (3) 고아 tmp 스윕은 **죽은 pid(`process.kill(pid,0)`
  → ESRCH만 사망 판정, EPERM은 생존)** 것만 치우고, 복구 시 `doctor-repaired` 이벤트로
  흔적을 남김. 비교 범위(COMPARED_FIELDS = phase/activeWave/gates/backtrack)와 덮어쓰기
  범위를 일치시킴 — 한쪽만 넓으면 감지 못 한 채 날아가는 필드가 생긴다.
  커밋 `cffa872`(구현) → `6835ad1`(신뢰도 게이트 재설계).
- **Task 12: CLI 디스패치** — `core/src/cli.ts` Task 1 스텁 전체 교체(10줄 → 165줄),
  `core/test/cli.test.ts`(9 tests). `run(argv, root): number` 가 exit code를 **반환**하고
  `main`이 `process.exitCode`에 대입 — 테스트가 프로세스 없이 직접 호출한다. 리뷰 이월 4건
  전부 반영: (1) **`hook` 분기를 바깥 try보다 앞에 두고 이중 try/catch → 어떤 실패에도
  exit 0** (handleHook 자체 방어에 더해 stdin 읽기·JSON 파싱 실패까지 CLI 계층에서 흡수 —
  훅이 0이 아닌 코드로 끝나면 세션이 깨진다), (2) doctor `--repair`/`--force` 배선 +
  `refused→1`, `(ok||repaired)→0`, 그 외 1, (3) **node upsert가 기존 노드의 version·status를
  보존**(`prev?.version ?? 1`, status는 `--status` 지정 시에만 변경 — 재실행이 bump 이력을
  리셋하지 않는다), (4) CLI가 직접 쓰는 phase-set·backtrack 두 분기 모두 `appendEvent` →
  `writeState` 순서 계약 준수. 플랜 대비 의도적 편차 2건: **stdin 읽기에 `!process.stdin.isTTY`
  가드 추가**(인터랙티브 터미널에서 손으로 `harness hook stop` 을 치면 EOF를 기다리며 멈추는
  실사용 함정 차단 — 실제 훅 호출은 파이프라 무영향), `csv()` 헬퍼 추출(중복 제거, 동작 동일).
  검증: vitest **126 passed(12 files)**, `npm run check` 타입 에러 0. 추가 E2E 스모크(`npm run
  build` + `bin/harness`): init→phase set→node upsert→wave create/activate 정상, JSON stdin
  파이프 시 `hookSpecificOutput` 출력·exit 0, **깨진 stdin·닫힌 stdin 모두 exit 0**, unknown
  명령 exit 1. 커밋 `9928cd9`.
- **Task 12 품질 리뷰 수정 5건** — Critical 2 + Important 3. (C-1) **훅 이벤트 화이트리스트**
  (`HOOK_EVENTS = session-start|pre-tool|post-tool|stop`) — 미지 이벤트는 exit 0 유지하되
  `.runtime/hook-errors.log` 에 `cli unknown-hook-event <값>` 기록. 배선 오타(`PreToolUse` 같은
  Claude Code 원본 이름)가 **조용히 죽는 것**이 훅 계열 최악의 실패 모드다. (C-2) **stdin 파손
  기록** — 내용이 있는데 JSON.parse 가 실패한 경우만 `cli corrupt-stdin <event>` 기록(stdin
  부재·빈 입력은 정상이라 무기록). 둘 다 `logHookIssue(root, msg)` 헬퍼 공유이며 **`.harness/`
  가 있을 때만** 쓴다(비간섭 불변식 — 하네스 안 쓰는 프로젝트에 파일 만들면 위반).
  (I-1) **bump 순서·부분 실패 보고** — `bumpNode` 직후 **즉시** `node-bumped` 이벤트(markStale
  루프보다 먼저, 루프가 죽어도 bump 사실은 남음), 루프는 웨이브별 try/catch 로 실패를 모아
  `STALE 마킹 실패: ... — 수동 확인 필요` + exit 1, 성공분은 계속 진행. 이벤트 data 는
  `staleWaves` → `{id, version, affected}` (affected 는 "대상"이지 "성공"이 아님). ledger.ts
  `bumpNode` 웨이브 스캔의 `readFileSync` 도 try/catch 스킵(기존 파싱 실패와 동일 관용).
  (I-2) **빈 턴 로그 거절** — `wave update` 인자가 공백뿐이면 에러. 내용 없는 `- [ts]` 한 줄로
  stop 가드가 풀리는 걸 막는다. (I-3) **flag() 값 필터 제거** — `--` 로 시작한다고 버리면
  `--goal "--force 제거"` 같은 정당한 값이 조용히 기본값으로 바뀐다. 값 누락 시 다음 플래그를
  삼키는 건 사용자 책임으로 문서화. 검증: vitest **131 passed(12 files)**, `npm run check`
  타입 에러 0, E2E 로 hook-errors.log 2줄(corrupt-stdin/unknown-hook-event)·빈 stdin 무기록
  확인. 커밋 `2bfaddf`.
- **Task 12 재검토 수정 — bump 검증 불가 보고** — 앞선 I-1 수정(스캔 `readFileSync` try/catch
  스킵)이 **chmod 000 시나리오를 "무흔적 exit 0" 으로 퇴행**시킨 것을 되돌렸다. `bumpNode` 반환을
  `{node, affectedWaves, unverifiable}` 로 확장하고, 스캔 중 ① 읽기 실패(I/O) ② frontmatter
  없음 ③ 깨진 YAML ④ 스칼라 frontmatter 인 `wave-NNN.md` 는 **스킵하지 말고 `unverifiable` 에
  수집**한다. 원칙: **"검증 불가는 침묵 스킵이 아니라 보고 대상"** — 해당 노드를 참조하는지
  판정할 수 없으면 마킹할 수도, 무시해도 된다고 단정할 수도 없다. CLI 는 `unverifiable` +
  `failed`(markStale 실패)를 합쳐 `STALE 전파 불완전 — 검증 불가/실패 웨이브: ... — 수동 확인
  필요` + **exit 1**, `node-bumped` 이벤트 data 에도 `unverifiable` 을 남긴다. 빈 frontmatter
  (`YAML.parse → null`)는 정상적인 '참조 없음' 이라 unverifiable 아님. 검증: vitest **134
  passed(12 files)**, `npm run check` 타입 에러 0, E2E 로 실제 `chmod 000` 재현 →
  `exit=1` + 에러에 wave-002 명시 + 이벤트에 `"unverifiable":["wave-002"]` + 읽히는 wave-001 은
  `status: stale` 확인. 커밋 `58b30f5`.

### 진행 중
- 코어 엔진 v0 플랜 14 태스크 중 Task 1-12 완료(리뷰 수정까지 반영), **Task 13(훅 배선 +
  실전 스모크)부터 이어감** ← 지금 여기
  (플랜 문서: `docs/superpowers/plans/2026-08-20-core-engine-v0.md`)

### 다음에 즉시 할 일
1. Task 13: 훅 배선 + 실전 스모크 — `handleHook`을 실제 Claude Code 훅 이벤트(SessionStart/
   PreToolUse/PostToolUse/Stop)에 settings.json 으로 연결. CLI 쪽 진입점은 이미 완성:
   `harness hook <session-start|pre-tool|post-tool|stop>` 가 stdin JSON을 읽어 stdout에
   훅 응답 JSON을 뱉고 **항상 exit 0**. 배선 시 주의 3가지:
   (a) **CLI 이벤트 이름은 케밥케이스**(`pre-tool`)이고 Claude Code 훅 이름은 `PreToolUse` 다 —
   settings.json 에 원본 이름을 그대로 쓰면 매칭 실패한다. 실패해도 조용히 exit 0 이므로
   **배선 직후 `.harness/.runtime/hook-errors.log` 에 `unknown-hook-event` 가 쌓이는지로
   검증하라**(C-1 이 이걸 위해 있다).
   (b) `bin/harness` 가 `core/dist/cli.js` 를 요구하므로 **`npm run build` 선행 필수**.
   (c) 훅 커맨드에 `CLAUDE_PROJECT_DIR` 이 전달되는지 확인
   (`main`이 `process.env.CLAUDE_PROJECT_DIR ?? process.cwd()` 로 root를 잡는다).
2. Task 14: 마무리 — 타입체크·전체 테스트·핸드오프. 완료 후 로드맵 2번 "게이트·리뷰 패킷"
   스펙→플랜 사이클로 이동.
3. (이월) `harness phase set` 은 **v0 임시 명령**이다 — 게이트 구현 시 승인 흐름으로 교체
   대상(출력 문구에도 명시해 둠).

### 미해결·확인 대기
- ~~플러그인 공개 이름 미정~~ → **`king-wjang-harness` 확정** (2026-08-20 사용자 지정)
- 마켓플레이스 배포 채널 (자체 marketplace.json 가정)
- auto-retry bypassPermissions opt-in 문구/고지 수위

### 시스템 지식 (함정·환경)
- 사용자 자작 도구 원본: `~/.claude/{token-guard,handoff-guard,auto-retry}/DESIGN.md` + bin/,
  `~/.claude/hooks/terse-mode.sh`, `~/.claude/skills/verifying-production-readiness/` (벤더링 대상)
- usage API 실측 노하우(180초 캐시, 티어 상승 시만 주입)는 token-guard DESIGN.md에 근거 —
  재설계 말고 이식할 것
- 사용자는 아이패드 원격 접속 — 산출물은 반드시 claude.ai 아티팩트로 (localhost/파일 첨부 불가,
  이미지는 base64 임베드, 캡처 2x)
- 브라우저 작업 항상 headless (글로벌 CLAUDE.md)
- 각 코어 모듈은 `(root: string)`을 첫 인자로 받는 순수 함수 모음, 전역 상태 없음 —
  테스트는 `fs.mkdtempSync` 임시 디렉토리로 완전 격리 (config.test.ts 패턴 그대로 재사용)
- `module: commonjs` + `esModuleInterop: true` 이므로 `import * as fs/path/YAML` 형태 사용
- 브랜치 `feature/core-engine-v0` 유지, **push 금지** (사용자 지시)
- **CLI 계층 계약**: `run(argv, root)` 은 throw 하지 않고 exit code를 반환한다(모든 에러는
  바깥 try/catch가 `console.error` + 1). 단 `hook` 분기만은 그 바깥 catch보다 **앞**에 있어
  무조건 0을 반환한다 — 이 순서를 뒤집으면 훅 무해 불변식이 깨진다.
- **vitest 환경의 fd 0**: worker thread에서 `process.stdin.isTTY` 는 `undefined`,
  `fs.readFileSync(0)` 은 `EAGAIN` 을 즉시 throw(블로킹 아님) — 실측 확인. 그래서 CLI의
  stdin 읽기가 테스트를 멈추지 않는다. 다만 `--pool=forks` 로 바꾸면 파이프가 열린 채
  남아 블로킹할 수 있으니 주의.
- `bin/harness` 는 `require('../core/dist/cli.js').main(...)` 를 호출한다 — 소스만 고치고
  `npm run build` 를 빼먹으면 예전 동작이 그대로 돈다. cli.ts의 `require.main === module`
  가드 덕에 이중 실행은 없다.
- **훅 계열 실패는 전부 exit 0 으로 흡수되므로 로그가 유일한 관측 수단이다** —
  `.harness/.runtime/hook-errors.log` 를 보라. hook.ts 의 판정 실패(`logHookError`)와
  cli.ts 의 미지 이벤트·stdin 파손(`logHookIssue`)이 같은 파일에 쌓이고, doctor 가
  줄 수를 세어 warning 으로 올린다.
- **손상 방어에 "관용적 스킵"을 넣을 때는 관측 가능성을 함께 보라** — 깨진 입력을 조용히
  건너뛰면 그 경로의 보증(여기선 STALE 전파)이 통째로 뚫려도 아무 흔적이 없다. bumpNode 가
  이 함정을 한 번 밟았다(읽기 실패 스킵 → chmod 000 이 무흔적 exit 0). listWaves 의 스킵은
  "목록 조회가 죽으면 안 된다"는 다른 목적이라 유지 중이나, 같은 눈으로 재검토할 후보다.
- **읽기 실패를 테스트로 만드는 법**: 파일 자리에 **디렉토리를 만들면** `readFileSync` 가
  EISDIR 로 실패한다 — `chmod 000` 은 root 로 돌리면 무력화되므로 이쪽이 이식성 있다.
  (ledger.test.ts '읽을 수 없는 웨이브 파일' 테스트)
- **쓰기 실패를 테스트로 만드는 법**: `writeWave`/`writeState` 의 tmp 경로는
  `<target>.tmp-<pid>` 로 결정적이다. 테스트에서 그 경로에 **디렉토리를 미리 만들어 두면**
  읽기·스캔은 정상인 채 쓰기만 EISDIR 로 실패한다(chmod 보다 이식성 좋음). cli.test.ts 의
  bump 부분 실패 테스트가 이 기법을 쓴다. 참고: `wave-002.md.tmp-123` 은
  `/^wave-\d+\.md$/` 필터에 걸리지 않아 listWaves·bumpNode 스캔을 오염시키지 않는다.
