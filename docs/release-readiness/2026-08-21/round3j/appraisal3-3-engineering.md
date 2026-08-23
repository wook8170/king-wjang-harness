# [3] 엔지니어링 품질 감정 — 4.6/5

**점수** 4.6 · **4.8 충족** ✗ (하드 조건 「중복 규칙 0」 미충족 — 「명령 실행 여부」 판정이 `runsCommand` 정본과 `cmd.includes` 두 벌로 존재하고 **실측으로 이미 갈렸다**) · **감정 시각** 2026-08-23 00:20 KST · **대상** `3aec164f87fb3b18e8b97722ac002c3dd9d6cf02` (feature/core-engine-v0, 감정 시작 시 working tree clean; 감정 도중 `a1b5560`(progress.md 62줄 추가, docs 전용)이 얹혔으나 모든 실측은 `git archive 3aec164`/checkout 3aec164 샌드박스에서 수행) · 도구: node v22.22.2 · npm 10.9.7 · vitest 2.1.9 · tsc 5.9.3 · tsup 8.5.1 · darwin 25.5.0 (arm64)

**한 줄**: 테스트 ×3 동일·tsc 0·빌드 3벌 바이트 일치·뮤테이션 10중 9 검출로 매우 견고하나, 이 리포가 스스로 하드 조건으로 못 박은 「같은 규칙 두 벌 금지」를 설계트랙 빌드 차단(`cmd.includes`)이 어기고 있고 그 두 벌이 실제로 갈려 있다(언급 과차단 + 이중 공백 실행 미차단).

## 조건별 실측 (테스트 ×3 / tsc / 빌드 재현 / 중복 규칙)

모든 실측은 `mktemp -d` 샌드박스(archive 추출 2벌 + git clone 1벌 + 뮤테이션 1벌)에서 수행. 리포 워킹트리는 읽기만 했다.

| 조건 | 결과 | 실측 |
|---|---|---|
| 테스트 ×3 동일 | ✅ | 샌드박스 A(`git archive 3aec164`): `npx vitest run` 3회 전부 **1177 passed / 16 skipped / 0 failed** — 3회 숫자 완전 동일, exit 0 |
| skip 0 (리포 표면) | ✅ | 샌드박스 C(git clone, 3aec164 checkout): **1193 passed / 0 skipped / 0 failed**. 아카이브 표면의 16 skip 은 전부 `skipIf(!HAS_DOCS)`/`skipIf(!IN_REPO)` 조건부 — `.gitattributes` 가 `docs/release-readiness` 를 export-ignore 해서다. skip 이 리포 안에서 조용히 성립하지 않게 막는 sanity 검사(PROD-141)가 별도로 존재하고 리포 표면에서 실행됨을 확인 |
| tsc | ✅ | 샌드박스 A `npx tsc --noEmit` exit 0 |
| 빌드 바이트 재현 | ✅ | 샌드박스 A 빌드 = 샌드박스 B 빌드 = **커밋된 `core/dist`(HEAD)** — `cli.js` sha256 `6f0e9a5d…9dfa51`, `mcp.js` `b4f98668…c5132` 3벌 완전 일치. **정규화 불필요**(tsup 산출물에 절대경로·시각 미포함). 커밋 dist 가 HEAD 소스의 빌드와 일치 = **dist 신선** |
| 중복 규칙 0 | ❌ | 아래 대조표 R7. 「이 명령이 X 를 실행하는가」 판정이 두 벌이고 실측으로 갈렸다 (결함 ENG-J1) |

## 중복 규칙 대조표 (규칙 → 구현 위치들 → 판정)

목록은 대장을 참조하지 않고 `hook.ts`·`bashwrite.ts`·`policy.ts`·`profile.ts`·`cli.ts`·`mcp.ts`·`bin/harness-hook`·`hooks/hooks.json` 정독으로 직접 뽑았다.

| # | 규칙 | 구현 위치들 | 판정 |
|---|---|---|---|
| R1 | 쓰기 대상 경로 판정(코어/정책/설계트랙/출하 신규금지) | `hook.ts` `judgeWritePath` **한 벌** — Write 도구·Bash 리다이렉트·패치 대상·스크립트 본문 전부 이 함수로 수렴 | ✅ 한 벌 |
| R2 | 보호 파일 목록 | `STATE_FILES`(hook.ts) + `POLICY_FILES`/`POLICY_PREFIXES`(policy.ts에서 import) — 차단 목록과 해시 감시 목록이 같은 정의 공유 | ✅ 한 벌 |
| R3 | 신뢰 경계 밖 텍스트 중화 | `untrusted.ts` `sanitizeUntrusted`/`contentNonce` 한 벌 (hook.ts·loop.ts 공유) | ✅ 한 벌 (과거 SEC-28 두 벌 → 통합 확인) |
| R4 | 훅 대상 도구 목록 | `WRITE_TOOLS`(hook.ts) ↔ `hooks.json` matcher — **불가피한 두 표면**(프로세스 경계) | ✅ 허용 — `surface-parity.test.ts`(PERF-95 절)가 배선을 교차 고정 |
| R5 | `.harness` 존재 게이트 | `bin/harness-hook` `[ -e ]` ↔ `hook.ts` `fs.existsSync` — 두 표면, 동일 판정(`-e`/existsSync, COST-130 로 정렬됨) | ✅ 허용 — 프로세스 경계, parity 테스트 존재 |
| R6 | 배포성 명령 실행 판정 | `runsCommand`(bashwrite.ts) 한 벌 — config 기본 목록과 프로파일 `isDeployCommand` 둘 다 이것을 씀 | ✅ 한 벌 |
| R7 | **빌드 명령 실행 판정** | ①`runsCommand`(정본, 래퍼 해체·실행 단위 정규화) ②**`hook.ts` ~L1266 `cmd.includes(build.trim().replace(/\s+/g,' '))`** — 같은 「실행하는가」 질문의 두 번째 구현 | ❌ **두 벌 + 실측 갈림** (ENG-J1) |
| R8 | 산출물/정책 해시 규율(경로·길이·내용 구분자) | `gate.ts` `computeArtifactHash` ↔ `policy.ts` `computePolicyHash` — 주석으로 「같은 규칙」이라 적었을 뿐 공유 헬퍼 없음 | ⚠ 두 벌 — 갈림 미실측이나 정책 쪽 구분자는 무테스트(MUT-9 생존)라 조용히 갈릴 수 있음 (ENG-J2, LOW) |
| R9 | harness 자기호출/호출 탐지 | `isSelfCall`(hook.ts, 선형 스캔) ↔ `invokesHarness`(FORCE_ESCAPE_RE+CORE_INVOKE_RE) ↔ `commandName`(bashwrite.ts) | ✅ 의도된 분리 — 실패 방향이 반대(탐지=넓게, 제외=좁게)라는 사유가 문서화·테스트 고정(LOGIC-94, PREFIX_COMMANDS 목록은 공유). 갈림 예 `sudo -u harness status`(자기호출 vs status)는 안전한 방향 |
| R10 | 게이트 승인 인간 전용 | 훅 deny(hook.ts) + CLI TTY 검사(cli.ts:508) + MCP 거부(mcp.ts `refuseApprove`) | ✅ 허용 — 같은 규칙의 복제가 아니라 **채널별 방어층**(각 층의 메커니즘이 다르고 각자 테스트됨) |
| R11 | MCP↔CLI 도메인 검증(부모 검증·목표 필수) | 도메인 함수(`createWave`·`upsertNode`)에 있고 양 표면이 호출 | ✅ 한 벌 — `surface-parity.test.ts` LOGIC-93/API-92 로 고정 |

**판정**: 명백한 위반 1건(R7) + 경계성 1건(R8). 하드 조건 「중복 규칙 0」 미충족.

## 뮤테이션 결과 (위치 · 입력 · 검출/생존)

샌드박스 M(archive 3aec164 + node_modules 복제)에서 규칙 구현부에 결함 10종을 각각 주입 → 전체 스위트 실행 → 원복. 각 뮤테이션은 그 절만 발화하는 규칙을 겨눴다.

| # | 뮤테이션 (파일 · 내용) | 결과 |
|---|---|---|
| MUT-1 | bashwrite.ts `find -delete` 분기 제거 (SEC-101) | **검출** (2 failed) |
| MUT-2 | hook.ts `CORE_INVOKE_RE` 무력화 — `node …/core/dist/cli.js` 형태 인식 제거 (SEC-96) | **검출** (2 failed) |
| MUT-3 | bashwrite.ts `>|` (noclobber 무시) 리다이렉트 추출 제거 | **검출** (2 failed) |
| MUT-4 | hook.ts 구현 판정에서 realpath 공간 제거 — 심링크 우회 재개방 (SEC-153/C3) | **검출** (2 failed) |
| MUT-5 | bashwrite.ts 미지 명령 `mutating` 기본값 역전 (SEC-B1 역행 — `xxd`/`openssl` 재개방) | **검출** (5 failed) |
| MUT-6 | hook.ts 설계트랙 빌드 차단 절 제거 | **검출** (1 failed) — 존재 자체는 고정돼 있으나 판정 술어의 품질(언급/공백)은 미고정(ENG-J1 이 그 틈) |
| MUT-7 | bashwrite.ts `mv` 원본 대상 제거 — `mv .harness /tmp` 재개방 (SEC-101) | **검출** (3 failed) |
| MUT-8 | hook.ts 스크립트 사슬 추적 깊이 3→1 (SEC-97 — `a.sh`→`b.sh` 재개방) | **검출** (1 failed) |
| MUT-9 | policy.ts `computePolicyHash` 길이 구분자(`${content.length}\0`) 제거 | **생존** (1177 passed — 무테스트) |
| MUT-10 | bashwrite.ts `git commit` 을 READ_ONLY_GIT 에 추가 — 활동 집계 구멍 (COST-111) | **검출** (3 failed) |

**9/10 검출.** 생존 1건(MUT-9)은 파일 조합 경계 붕괴 방지 속성이 초록 뒤에 숨는 지점 — 위협 모델상 사람 전용 경로라 LOW 지만, R8 두 벌 구조와 겹쳐 조용한 갈림의 통로다.

## G9 재정의 검증 (회귀를 잡을 수 있는 형태인가)

[OPS-74] 에 따라 구현자의 수치를 근거로 쓰지 않고 **독립 재측정**했다.

**측정 표면 명시**: 표면 A = 프로세스 wall-time(`spawnSync('node', [dist/cli.js, 'hook', 'pre-tool'])`, stdin `{"tool_name":"Bash","tool_input":{"command":"ls"}}`, hrtime 계측, 워밍업 3 버림). 표면 B = 인프로세스(`handleHook(root,'pre-tool',…)` 직접 호출 — `core/src/hook.ts` 를 esbuild 로 번들해 로드, 워밍업 5 버림). 저널: 자작 생성기 **100,003줄 / 21.2MB**(턴로그 90%·상태전이 10% — 게이트 규격 15MB 보다 무거움, 보수적 방향). 열화 = `state.json` 삭제. 프로토콜 = 정상→열화→정상 재확인, 각 n=30.

| 표면 | 정상 p95 | 열화 p95 | 정상 재확인 p95 | 폴백 추가 p95 |
|---|---|---|---|---|
| A wall-time | 64.7ms | 93.8ms | 80.9ms | **+29.1ms** (재확인 기준 +12.9ms) |
| B 인프로세스 | 0.32ms | 29.2ms | 0.31ms | **+28.9ms** |
| (바닥) `node -e ''` | p50 **39.4ms** | | | |

**① 새 문턱이 제품을 재는가 — 그렇다 (measured).** 구기준 「wall p95 < 150ms」는 이 머신에서 64.7ms 로 **통과**, 구현자 머신에서 162ms 로 **불통과** — 같은 코드다. Node 기동 바닥이 이 머신 39ms vs 구현자 머신 99ms 로, 구기준이 재던 것이 제품이 아니라 머신임을 **교차 머신으로 실증**했다. 3-G(103.5ms)/3-I(202.5ms) 감정자 상충도 같은 원인으로 설명된다. 새 지표(폴백이 더하는 비용)는 제품 코드가 통제하는 몫이고, 15MB 보다 무거운 21.2MB 저널에서도 두 표면 모두 +29ms < 50ms — **재측정으로도 통과**. 사유(gates.md 말미) 타당, 통과시키기 위한 재정의가 아니라고 판정한다(문턱 50ms 는 실측 29ms 대비 자의적 여유이지 실측 맞춤값이 아님).

**② 회귀를 잡을 수 있는 형태인가 — 아직 아니다.**
- **게이트가 코드로 존재하지 않는다.** 리포 전체에서 측정 스크립트·저널 생성기·CI 검사를 찾지 못했다(`*.sh`/`*.mjs` 탐색, core/test 내 G9/perf-139 참조 0건). 남은 것은 산문 규격(gates.md)과 결과 로그(`evidence/perf-139-latency.log`)뿐 — **CI 자동 검사 불가**.
- **저널 규격이 과소결정이다.** 「100k줄·15MB」에서 줄 길이 분포가 미명세 — 정직하게 100k줄을 만들어도 21.2MB 가 나왔다(내 경우). 재생 비용은 저널 크기에 비례하므로(내 +29ms vs 구현자 +16.3ms, 21/15MB 비율과 정합) **누가 다시 재면 다른 답이 나온다**.
- **차이-of-p95 는 노이즈에 취약하다.** 내 정상 p95 가 한 세션 안에서 64.7→80.9ms 로 ±16ms 흔들렸다. 여유(50−29=21ms)와 같은 자릿수다. 규격은 정상 재확인까지는 시키지만 **어느 기준선에서 빼는지, 드리프트가 크면 어떻게 하는지**를 정하지 않는다(내 데이터로는 기준선 선택만으로 +13 vs +29ms).
- 처방(권고): 저널 생성기+측정 드라이버를 리포에 커밋하고, 쌍대 차이(같은 회차 정상/열화 짝) 또는 p50 기반 판정으로 바꾸고, 기준선 규칙을 명문화하면 게이트로 성립한다.

**결론**: 재정의는 **정당**(제품을 재는 방향으로의 교정, 독립 재측정 값도 문턱 안). 단 **회귀 탐지 장치로는 미완성**이라 G9 를 「측정으로 통과」로는 인정하되 「게이트로 자동화됨」으로는 인정하지 않는다 (ENG-J3, LOW).

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

**ENG-J1 (MED) — 빌드 차단이 `runsCommand` 정본 대신 `cmd.includes` 두 벌째를 쓰고, 이미 갈렸다.**
`core/src/hook.ts` ~L1266: `if (build && cmd.includes(build.trim().replace(/\s+/g, ' ')))`. EFF-108 이 배포 차단에서 「언급이 아니라 실행」으로 고친 바로 그 결함이 빌드 차단에는 남았고, 반대 방향 구멍도 함께 있다.
재현(설계 트랙 P0, `.harness/profile/commands.yaml` 에 `build: 'npm run build'` — 번들 nextjs-prisma 프로파일도 같은 값이라 실사용 도달):
- `grep "npm run build" README.md` → **DENY** (언급 과차단 — 같은 언급인 `grep "npm publish" README.md` 는 runsCommand 라 allow. 비대칭 실측)
- `echo npm run build is documented` → **DENY** (과차단)
- `npm  run build` (공백 2개) → **allow** (실행 미차단 — 문구는 정규화하면서 명령은 정규화하지 않아서)
과차단은 이 제품이 스스로 「결함과 같은 무게」(hook.ts UX-71 주석)라 못 박은 부류다. 처방은 한 줄: `runsCommand(cmd, build)`.

**ENG-J2 (LOW) — 해시 규율 두 벌 + 정책 쪽 무테스트.** `core/src/policy.ts` ~L100(`computePolicyHash`) ↔ `core/src/gate.ts` L518(`computeArtifactHash`). 경로·길이·내용 구분자 규율이 복제돼 있고 공유 헬퍼가 없다. MUT-9(정책 쪽 길이 구분자 제거)가 전 스위트 초록으로 생존 — 한쪽만 고쳐지면 조용히 갈린다. 위협 모델상 사람 전용 경로라 LOW.

**ENG-J3 (LOW) — G9 게이트가 실행 가능한 형태로 부재.** 측정 스크립트·저널 생성기 미커밋, 저널 규격 과소결정(100k줄≠15MB), 차이-of-p95 의 노이즈 규칙 부재. 상세는 위 G9 절.

**ENG-J4 (INFO) — 접두 명령 해석기 이질.** `isSelfCall`(hook.ts L82~)과 `commandName`(bashwrite.ts L96~)의 플래그 값 처리 휴리스틱이 다르다 — `sudo -u harness status` 를 전자는 자기호출, 후자는 `status` 실행으로 읽는다. 갈림 방향이 문서화된 안전 방향(LOGIC-94)이고 PREFIX_COMMANDS 목록은 공유되므로 결함으로 세지 않는다.

## 못 잰 것 (정직 고지)

- **뮤테이션은 수작업 10종이다.** 뮤테이션 프레임워크 전수 실행이 아니므로 생존율의 전수 추정치가 아니다 — 다른 생존 지점이 더 있을 수 있다.
- **`npm ci` 신선 설치 미실측.** 모든 샌드박스가 리포의 node_modules 를 복제해 썼다 — 락파일에서의 재설치 재현성·다른 머신/툴체인에서의 빌드 바이트 재현성은 못 쟀다(동일 툴체인 3벌 일치까지만 measured).
- **대소문자 구분 FS(Linux) 미실측.** `.HARNESS/` 우회 테스트는 이 머신(case-insensitive APFS)에서 돌았고, case-sensitive 환경의 skip 여부·동작은 못 봤다.
- **G9 인프로세스 표면은 소스 번들로 쟀다**(esbuild 로 `core/src/hook.ts` 번들) — 출하 dist 바이트 그대로가 아니다(wall 표면은 출하 dist 사용). 소스는 동일 커밋이므로 의미론은 같다(inferred).
- **테스트 3회 반복 이상의 플레이크·부하 민감도 미실측.**
- CLI 전 명령군 계약(G11)·MCP 프로토콜 E2E·비밀 스캔(G10)·공급망(G8)은 이 축의 범위 밖이라 스팟 체크만 했다(MCP 승인 거부 경로·doctor 관측성은 실측).
- 대장(ledger.md)·요약의 집계 정합은 축 4의 몫이라 검증하지 않았다(단 그것을 지키는 테스트가 리포 표면에서 skip 없이 도는 것은 실측).

## 점수 산출 근거

- rubric 축 3 의 4.8 조건 4개 중 3개 충족 measured(테스트 ×3 동일 초록 · tsc 0 · 빌드 바이트 재현+dist 신선), **하드 조건 「중복 규칙 0」 1개 미충족** — R7 이 실측 갈림까지 동반(ENG-J1, MED). rubric 규정상 조건 하나라도 미충족이면 4.8 미만.
- 잔여 감점: MED 1(ENG-J1) + LOW 2(ENG-J2·J3). 반대 방향 가점 요인: 뮤테이션 9/10 검출(회귀가 초록 뒤에 숨는 지점이 실측으로 좁음), 판정 규칙의 단일화 규율이 R1~R6·R9~R11 에서 실제로 지켜짐, 조용한 실패 경로가 관측 가능(훅 fail-open 이 `hook-errors.log` 에 남고 doctor 가 저널 손상 줄 수·정책 드리프트를 정확히 보고 — 실측), skip 이 조건부로 설계되고 그 조건부가 다시 테스트로 고정됨(PROD-141).
- 산출: 5.0 기준에서 하드 조건 위반+MED 1 로 −0.4, LOW 2 는 관측성·뮤테이션 강도의 실측 가점과 상쇄 → **4.6**. ENG-J1 은 한 줄 수정(`runsCommand`)과 언급/공백 픽스처 추가로 닫히며, 닫힌 뒤 재감정 시 4.8 조건 충족 가능.
