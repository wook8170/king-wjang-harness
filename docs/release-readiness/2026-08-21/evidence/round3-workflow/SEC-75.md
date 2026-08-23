# SEC-75 — 워크플로 구현 보고와 적대적 검증

**커밋** `4162cbd — `fix(gate): SEC-75 — 게이트가 산출물의 내용·구별성·페이즈 적합성을 검사한다`
(브랜치 `worktree-wf_28bae004-b27-3`, 11 files changed, 1327 insertions, 461 deletions. 워킹 트리 clean.)`

## 구현 보고

### 요약
SEC-75: 게이트의 통과 기준이 「파일이 존재한다」뿐이라 2바이트 파일 한 장으로 13게이트를 전부 열 수 있었다. `submitGate` 에 제출 시점 검사 3종을 넣었다. (1) 최소 실질성 — 빈 파일·공백뿐인 파일 거부, 제출 **집합 전체**의 공백 제외 문자가 80 미만이면 거부, 자리표시자(TODO·TBD·미지정)로만 채운 문서 거부. (2) 구별성 — 이미 다른 게이트를 연 **내용**으로 또 다른 게이트를 열 수 없다. (3) 페이즈 적합성 — 레지스트리(§3-7)가 아는 경로는 제 페이즈에서만 심사된다. 부수로 심사 경로를 realpath 기준 정규화(한 파일이 두 장으로 세어지지 않게)하고, 페이즈별 최신 제출을 저널 한 번만 읽어 모은다.

### 판단 근거
**「어디까지가 코어의 일인가」 — 4개 항목 중 3개는 넣고 1개는 경계로 명시했다.**

- **최소 실질성 — 넣음.** 임계 80은 추측이 아니라 실측 세 점에서 나왔다: 이 리포의 실제 산출물 55개 중 최소가 213자, 정당한 한국어 3문장이 91자, 공격이 2바이트. 80은 91·213 아래이면서 공격의 40배다. **바이트가 아니라 문자로 센다** — 한국어는 문자당 3바이트라 바이트 임계는 언어마다 다른 분량을 요구하게 된다. **파일별이 아니라 집합 전체로 잰다** — 큰 본문+작은 색인이라는 정당한 조합이 색인 하나 때문에 막히면 안 된다(파일별로는 «완전히 빈 것»만 거부).
- **구별성 — 넣음. 단 경로가 아니라 내용으로.** 처음엔 `artifactHash`(경로 포함)로 만들었는데 실측에서 `cp a.md b.md` 한 줄에 뚫렸다. 제출 시점 `contentDigest`(경로 뺀 내용 집합)를 저널에 박고 그것으로 비교한다. 지금 디스크를 다시 읽지 않는 이유: 그 사이 표류가 판정을 흔든다 — 물어야 할 것은 「그때 도장 찍힌 내용」이다. 같은 게이트 재제출과 무효화된 게이트는 제외(개정 루프는 정상 경로).
- **페이즈 적합성 — 넣되 비대칭으로.** 레지스트리가 그 경로를 **하나도 모르면 통과**시킨다. 문서 등록은 아직 선택 배선이라 여기서 강요하면 레지스트리를 안 쓰는 프로젝트가 전부 막힌다. 아는 경우에도 「전부 이 페이즈」가 아니라 「**하나라도** 이 페이즈」를 요구한다 — P6 총감사는 자기 리포트와 함께 P0~P5 산출물을 올리는 것이 정상이기 때문이다.
- **`--evidence measured` 근거 — 넣지 않았다(경계로 명시).** 측정을 다시 돌리는 것은 네트워크·브라우저·실주행이라 코어(순수·로컬·결정적, §1)의 능력 밖이다. 내용을 훑어 「숫자가 있으니 측정이다」 같은 휴리스틱은 실질성 검사 위에 얹는 값이 거의 없으면서 오탐만 만든다. 대신 그 주장의 **가장 싼 형태**(내용 없는·이미 도장 찍힌·페이즈 어긋난 산출물로 measured 주장)를 위 3검사가 닫는다. 코드 머리말에 이 경계를 그대로 적었다.

**탈출구(env·config)를 두지 않았다.** `--force` 같은 잠금 해제 패턴이 이 리포에 이미 있지만, 임계가 실 산출물 하한의 절반 아래라 탈출구는 막힌 사람을 풀어주기보다 우회에 쓰일 가능성이 높다. 임계가 틀렸다면 고칠 것은 임계이지 우회로다.

### 테스트
**688 → 724 (+36), 전건 green ×3연속. `npm run check` tsc 0. `npm run build` 성공.**

증가분 36건은 전부 `core/test/gate.test.ts` (38 → 74). TDD 로 진행했고 RED 를 세 번 실증했다:
1. 실질성·구별성·페이즈 적합성 22건 추가 → **11 failed** (막아야 할 것 전건 실패, 과차단 가드 11건은 처음부터 통과 = 기존 동작을 안 깨는 것이 먼저 확인됨)
2. 경로 우회 6건 추가 → **6 failed**
3. 내용 복사 우회 4건 + 바이너리 과차단 1건 추가 → **5 failed**

기존 테스트는 하나도 삭제·약화하지 않았다. 다른 테스트 파일 5곳의 수정은 **픽스처 본문을 실제 문서로 바꾼 것뿐**이다(`'A'`·`'v1'`·`'# 컨셉\n'` 등 1~7자 → 한 문단). 검증 의도(해시 고정·승인 흐름·이벤트 순서·재생)는 그대로다.

### 바꾼 파일
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/src/gate.ts:63 (canonicalRel — realpath 기준 경로 정규화)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/src/gate.ts:77 (normalizePaths — root 인자 추가)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/src/gate.ts:99 (MIN_SUBSTANCE_CHARS = 80, 실측 근거 주석)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/src/gate.ts:105 (PLACEHOLDER_WORDS / PLACEHOLDER_WORDS_KO)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/src/gate.ts:136 (readArtifacts — substance·binary 판정)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/src/gate.ts:153 (assertSubstantive)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/src/gate.ts:207 (contentDigest — 경로 뺀 내용 다이제스트)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/src/gate.ts:230 (latestSubmissions — 저널 1회 읽기)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/src/gate.ts:257 (assertDistinct)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/src/gate.ts:293 (assertPhaseFit)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/src/gate.ts:392 (submitGate — 3검사 배선, 저널·상태 변이 전에 던진다)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/src/gate.ts:399 (gate-submitted 이벤트에 contentHash 추가)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/src/help.ts:47 (gate submit 도움말 — 거부 조건 명시, i18n)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/src/mcp.ts:97 (harness_gate_submit 설명 — CLI 와 1:1 유지)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/test/gate.test.ts:26 (body 헬퍼 + 픽스처 실질화)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/test/gate.test.ts:395 (SEC-75 신규 테스트 36건 — 실질성·구별성·우회·페이즈 적합성)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/test/bashwrite.test.ts:161 (픽스처 실질화)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/test/mcp.test.ts:98 (픽스처 실질화)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/test/mcp.test.ts:217 (픽스처 실질화)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/test/report.test.ts:33 (register 픽스처 실질화)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/test/ship.test.ts:31 (approveShipGate 픽스처 실질화 + 페이즈별 내용 분리)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/test/ship.test.ts:267 (픽스처 실질화)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/docs/release-readiness/2026-08-21/ledger.md:79 (SEC-75 open → fixed, 측정 결과 기재)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/dist/cli.js (빌드본 — 리포 관례상 커밋 대상)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3/core/dist/mcp.js (빌드본)`

### 남긴 한계
**1. 닫지 못한 것 — 코드 머리말에 경계로 명시했다.**
- `--evidence measured` 주장 자체의 참·거짓은 코어가 못 잰다(위 판단 참조).
- **한 글자 덧붙여 내용만 바꾸는 회피는 여전히 열려 있다.** `docs/a.md` 끝에 `x` 하나를 붙이면 다른 내용이 되어 다음 게이트가 열린다. 이것을 막으려면 「의미 있는 차이」를 재야 하는데 그건 내용의 질 판정이라 코어 밖이다. 우회는 열린 집합이고, 이번에 덮은 것은 **표기 계열 6종 + 내용 이동 계열 5종**이다.

**2. 대장 헤더 숫자를 손대지 않았다.** `ledger.md` 의 SEC-75 행만 open → fixed 로 바꿨고, 헤더의 「open 전체 5 · fixed 0」 집계는 그대로다. 다른 워크트리 에이전트가 같은 파일의 다른 행을 동시에 고치고 있으면 각자 계산한 헤더가 병합 후 틀리기 때문이다. **병합하는 쪽이 행을 세어 헤더를 다시 계산해야 한다.** 또 `verified` 가 아니라 `fixed` 로 둔 것은 의도다 — 재측정은 내가 했지만 이 리포의 관례상 승격은 독립 확인 몫이다.

**3. `progress.md` 를 갱신하지 않았다.** 80KB 짜리 메인 세션 소유 파일이고 병렬 에이전트와 충돌하므로 오케스트레이터가 집계할 사안으로 남겼다.

**4. 기존 프로젝트 업그레이드 시 1회성 재제출이 필요할 수 있다.** 경로를 비정규 표기(`./docs/a.md` 등)로 제출해 둔 프로젝트는 정규화 때문에 고정 해시가 달라져 `gate verify` 가 불일치를 보고한다. 사유와 다음 수(재제출)를 그대로 안내하는 기존 경로로 떨어지며, 이 리포는 아직 리모트·릴리스가 없어 실사용자 영향은 없다.

**5. `contentHash` 없는 옛 저널**은 구별성 판정이 `artifactHash`(경로 포함)로 떨어진다 — 더 얕지만 있는 정보로 할 수 있는 최선이고, 재제출하면 즉시 내용 기반으로 올라선다.

**6. 파일 머리말의 기존 「알려진 미배선」(events.ts 재생이 evidence·invalidated 를 폴드하지 않음)은 손대지 않았다** — events.ts 소유 작업이라 범위 밖이다. 다만 이번에 추가한 `contentHash` 필드는 재생에 영향이 없음을 E2E 에서 `doctor` issues 0 으로 확인했다.

---

## 적대적 검증 (독립 에이전트)

SEC-75 적대적 검증 결과 — 재현 환경: worktree `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-3` (commit `4162cbd`, 워킹 트리 clean). 모든 측정은 python subprocess + list argv (shell=False) 로 실제 샌드박스 CLI 를 구동했다. `npm run build` 재실행 후 `git status core/dist` 무변화 — 커밋된 dist 가 src 와 실제로 일치한다.

## 1. 재현되는 것 — 측정의 대부분은 정확하다

| 주장 | 내 재현 |
|---|---|
| 2바이트 파일 → 13게이트 (전) | BEFORE 13/13 opened, `ship verdict` = GO. 정확 |
| 같은 것 (후) | 0/13, P0 에서 「2자, 최소 80자 미달」 |
| 한 장으로 13게이트 → P0 하나 | 실 산출물 1장: BEFORE 13/13 → AFTER 1/13. 문구까지 일치 |
| 막아야 할 것 + 우회 계열 | 내가 재작성한 19종 전건 rc=1 (경로 6종·복사/하드링크/대소문자 5종 포함) |
| 테스트 688 → 724 | `18df98f` 체크아웃 실측 688, HEAD 724, 28파일 green. `gate.test.ts` 38 → 74 |
| tsc 0 / build | 둘 다 확인 |
| E2E 13/13 · doctor 0/0 · hook rc=0 | 확인 (`verify P0` ok, `sweep` 무효화 없음) |
| 임계 근거 「리포 최소 산출물 213자」 | 정확히 재현 — min 213자 `profiles/nextjs-prisma/commands.yaml`, 80자 미만 0개 |
| 실패한 제출은 흔적을 안 남긴다 | 저널·state 바이트 동일, packets 미생성 |

테스트는 진짜로 문다. 9종 뮤테이션 전부 RED: `assertSubstantive` 무력화 7 fail · `assertDistinct` 11 · `assertPhaseFit` 1 · 임계 80→1 3 · 임계 80→120 4 · 구별성을 경로기반으로 되돌림 4 · `canonicalRel` 제거 2 · 바이너리 예외 제거 1 · digest 중복제거 제거 1. 임계가 양방향으로 고정돼 있고(과소·과차단 둘 다 레드), 과차단 회귀 가드가 실제로 물리는 것까지 확인했다.

## 2. 반증 — 핵심 주장 하나가 과장이다

### ① 「한 장으로 13게이트」 공격 부류는 닫히지 않았다 (실산출물 0장으로 GO)

```
docs/f0..f12.md = ('a'*80 + i)   ← 실제 문서 0장, 순수 필러
→ 13/13 approved · evidence=measured · ship verdict GO · doctor rc=0 issues 0
```

BEFORE 26바이트 → AFTER 1056바이트. 비용 40배지만 `for` 루프 한 줄이다. 상위집합 경로는 더 싸다 — 실 문서 1장 + 서로 다른 1바이트 파일 13장(총 262바이트)으로 13/13 approved + GO + doctor clean.

중요한 이유: 그 상위집합 경로는 보고서가 「막으면 안 되는 것」으로 직접 고정한 테스트다(`core/test/gate.test.ts:544`). 과차단 배려와 우회로가 같은 메커니즘이고, 이건 공개한 경계에 없다. 공개된 경계는 "한 글자 덧붙여 내용만 바꾸는 회피"(= 실 문서를 고쳐야 함)인데 실제로는 실 문서가 아예 필요 없다. 「0/10 → 10/10」은 프로브 점수지 부류 점수가 아니다.

### ② 과차단 0 은 재현되지 않는다 — 구조적 과차단 2건 (`assertPhaseFit`)

임계 효과를 분리하려고 픽스처를 109자로 올려 재측정한 결과, 길이와 무관한 과차단 2건:

- P6 감사 리포트가 아직 미등록 + P0~P5 등록문서 동반 → 차단
- 새 산출물(미등록) + 앞 페이즈 등록 스펙 동반 (P3 계획 + P1 스펙) → 차단

보고서의 동일 항목 가드가 통과한 건 테스트가 감사 리포트를 먼저 P6 로 등록하기 때문이다(`gate.test.ts:710`).

근본 원인은 `core/src/gate.ts:297` 한 줄:
```ts
if (known.length === 0) return;          // 전부 미등록일 때만 면제
if (known.some(d => d.phase === phase)) return;
```
비대칭의 명분은 "등록을 강요하면 레지스트리를 안 쓰는 프로젝트가 막힌다"였는데, 면제가 하나도 등록 안 된 경우에만 걸린다. 실제로 막히는 건 레지스트리를 부분적으로 쓰는 프로젝트 — 가장 흔한 이행 중 상태다. 오류 문구가 `doc upsert` 복구법을 정확히 안내하므로 막다른 길은 아니고 마찰이다.

### ③ 임계 여유가 보고서 인상보다 훨씬 얇다

「짧은 ADR 은 통과」 가드 픽스처는 실측 160자 = 임계의 2배라 경계를 전혀 찌르지 않는다(보고서의 "378자"는 내 측정과 불일치, 미확인). 실제 경계를 찔러 보면:

- 짧게 쓰려 하지 않고 자연스럽게 쓴 한국어 4문장 산출물 = 77자 → 차단
- 상태/맥락/결정/결과를 다 갖춘 터스한 한국어 ADR = 58자 → 차단
- 작은 디자인 토큰 JSON = 57자 → 차단

임계 근거(91·213)가 장황한 한국어 산문 리포 하나에서 나온 탓이다. 토큰·ADR·소형 config 부류에는 마진이 없다. 판단의 문제이지 결함은 아니지만 "실측 하한 아래라 안전하다"는 서술은 과신이다.

### ④ 사소 — 표의 귀속 오류
"한국어 자리표시자 → rc=1" 행은 자리표시자 규칙이 아니라 길이 규칙(68 < 80)이 잡은 것이다. 임계 위로 패딩해 확인하니 `PLACEHOLDER_WORDS_KO` 는 실제로 문다 — 결론 유지, 귀속만 틀렸다.

## 결론

정직한 구현이고 측정 방법론도 견고하다 — 뮤테이션 9/9 레드, 임계 양방향 고정, 과차단 회귀를 테스트로 박은 것, dist 무표류, 실패 제출 무흔적까지 확인됐다. 설계 판단(내용 다이제스트, 비대칭 레지스트리 검사, 탈출구 없음)도 근거가 실측이다.

다만 두 가지가 과장이다: (1) 헤드라인 공격 부류는 비용이 40배 올랐을 뿐 여전히 열려 있고 — 실 문서 0장으로 `ship verdict GO` 까지 간다 — 그 최저가 경로가 자기들이 과차단 가드로 고정한 상위집합이라는 사실이 경계 서술에 빠져 있다. (2) 「과차단 0」은 성립하지 않는다(`gate.ts:297`, 부분 등록 상태 2건). ①의 미공개 경계가 더 무겁다 — 중심 주장이 「게이트는 의식이 아니라 심사다」인데, 내용 없는 파일 13장으로 출하 트랙까지 GO 가 나오는 상태는 그 주장을 아직 지지하지 못한다.

권고: ②는 `gate.ts:297` 한 줄 수정으로 닫힌다(제출 경로 중 미등록이 하나라도 있으면 통과). ①은 코어 능력 밖이 아니다 — 구별성을 「집합」이 아니라 「집합 내 각 산출물」 기준으로 보거나 페이즈별 최소 신규 실질 분량을 요구하면 상위집합 경로가 닫힌다. 최소한 경계 서술을 "한 글자 덧붙이기"가 아니라 "실 산출물 없이도 열린다"로 정정해야 한다.
