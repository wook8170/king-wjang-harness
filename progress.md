# king-wjang-harness 진행상황 (핸드오프)

## 2026-08-20 — 코어 엔진 v0 구현 진행 중 (Task 4/14 완료)

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

### 진행 중
- 코어 엔진 v0 플랜 14 태스크 중 Task 1-4 완료, **Task 5(설계 원장)부터 이어감** ← 지금 여기
  (플랜 문서: `docs/superpowers/plans/2026-08-20-core-engine-v0.md`, Task 5 섹션 577행부터)

### 다음에 즉시 할 일
1. Task 5: 설계 원장 (CRUD + bump/STALE 스캔) — TDD로 진행
   (플랜 문서 Task 5 섹션 그대로 따를 것, superpowers:subagent-driven-development 권장)
2. Task 6~14 순서대로 계속 (웨이브 → runtime → 훅 3종 → doctor → CLI → 훅 배선 → 마무리)
   — Task 11(doctor)이 이번 Task 4의 replayState를 복구 근거로 그대로 소비하므로 events.ts의
   시그니처(appendEvent/readEvents/replayState)를 바꾸지 말 것.
3. Task 14(마무리) 완료 후: 로드맵 2번 "게이트·리뷰 패킷" 스펙→플랜 사이클

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
