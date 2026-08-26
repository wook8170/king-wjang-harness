# 멀티에이전트 P8 오케스트레이션 — 설계 v2 (A안: 워크트리 격리)

- 상태: 초안 v2 (독립 리뷰 REWORK 반영 — BLOCKER 2·MAJOR 5·MINOR 6). 사용자 리뷰 대기.
- 결정 확정: 결과물 = **제품 + 운영 둘 다** · 목적 = **처리량 + 난이도별 모델 + 구현자≠검증자** 셋 다 · 격리 = **A안(워크트리)** · **코어(core/src) 무변경**.
- v1→v2 핵심: ① `.harness/` 격리를 «실측 사실»에서 **집행 전제조건**으로 격하 ② 회계 순서를 **선-create → 병렬 → 머지 → 후-정산**으로 재작성 ③ 신뢰경계를 **세션 전역 훅 가드**(워커도 가드됨)로 정정.
- 관련: `.claude/CLAUDE.md`(모델 라우팅), `skills/phase-p8-implement/SKILL.md`, `agents/wave-executor.md`·`wave-verifier.md`, `core/src/wave.ts`·`loop.ts`·`cli.ts`, `superpowers:dispatching-parallel-agents`·`using-git-worktrees`.

## 1. 문제와 목표

현재 P8(구현)은 **순차**다: 코어 `state.activeWave` 단수(`wave.ts:204` — 이미 활성이면 activate 거부), 메인 세션이 한 웨이브를 `create → activate → loop brief → wave-executor → loop attempt → wave update → complete` 로 돌린 뒤 다음으로 간다.

목표: **독립 웨이브를 병렬 구현**(처리량) + 난이도별 모델(비용/품질) + 구현자≠검증자(OPS-74). **코어 저널 무결성(SEC-49~318)은 동시쓰기로 만들지 않는다.**

핵심 원리: **느린 건 병렬, 싼 건 순차.** 구현·테스트(느림)는 워크트리별 워커가 병렬로. 회계(웨이브 create/complete·저널·RTM·STALE — 빠름·정본 `.harness/` 단일 기록자)는 오케스트레이터가 순차로.

### 1.1 두 전제 — «사실»이 아니라 «집행 전제조건»이다 (v2 정정: BLOCKER-1)

v1 은 「`.harness/` 는 git 미추적이라 워크트리 격리가 공짜」를 실측 사실로 적었다. **틀렸다.** 코어는 정반대를 문서화한다: `wave.ts:116`·`loop.ts:16` 「`.harness/` 는 git 커밋 대상이라 브랜치를 전환하면 events.jsonl 이 되감긴다」, `state.ts:98-101` 은 `.harness/.runtime/` **안에만** gitignore 를 둔다(=`.runtime/` 만 빼고 커밋). `nextWaveId` 이중최댓값·잔존증적 가드(`wave.ts:109-118,177-189`)·`migrate.ts:140-142` 는 전부 「커밋된 `.harness/` 가 브랜치와 함께 되감기는」 세계를 방어한다.

→ 워크트리 격리는 **대상 리포에서 `.harness/` 가 gitignore 되어 있을 때만** 성립한다(그래야 `git worktree add` 가 `.harness/` 사본을 안 만들고, 회계와 코드가 다른 브랜치로 갈라지지 않는다). 이를 **`phase-p8-orchestrate` 0단계에서 강제 검사**한다(아래 §6.0). 그리고 이 요구가 코어 주석과 모순되므로, **하네스 공식 스탠스**(병렬 오케스트레이션에서는 `.harness/` = 로컬/gitignored)를 이 문서로 못박고, 코어 주석과의 불일치를 「알려진 긴장」으로 명시한다 — 두 문서가 반대말을 한 채로 플랜에 들어가지 않는다.

## 2. 흐름 (v2: 선-create → 병렬 → 머지 → 후-정산 · BLOCKER-2)

v1 은 회계(`wave create`)를 **머지 후**로 미뤘다 — 그러면 워커에 줄 브리프가 없고(`loop brief` 는 디스크 지시서를 읽는다 `loop.ts:583`), 유령참조 검증이 구현 뒤로 밀리며(`createWave` 가 없는 refs 거부 `wave.ts:152`), 증적 id 가 없고(id 는 create 가 발급 `wave.ts:120-136`), 크래시 시 정본에 흔적이 0 이라 재개 불능이다(`loop.ts:7` 연속성 계약 위반). v2 는 순서를 뒤집는다:

```
Fable 오케스트레이터  (메인 세션 · 정본 .harness/ 소유 · 세션 전역 훅 가드 안)
  │
  ├─ (P8 진입) 0단계 전제조건 검사(§6.0) → 승인설계(F/M/SCH)에서 «웨이브 플랜» 산출
  │     각 웨이브 = { goal, refs, accept, fileScope(파생·§3), difficulty(§4), round }
  │     의존/충돌 그래프 → 위상 «라운드»로 분할 · 계약/생성파일은 라운드 선두 «계약 웨이브」로(§3)
  │
  └─ 라운드마다:
        1. [선-create] 라운드 웨이브들을 **순차 `wave create`** — id 발급·유령참조 사전검증·지시서 디스크 기록
             (create 는 activeWave 불변 → pending 다발 공존, 게이트 없음. wave.ts:138-200)
        2. [브리프] `harness loop brief <id>` 로 **코어가 만든 펜스 브리프**(nonce·sanitizeUntrusted, SEC-28)를
             각 워커에 전달 — 오케스트레이터 수제 브리프 금지(보안 회귀). buildExecutorBrief 는 active 불요(loop.ts:583)
        3. [병렬 구현] 워크트리별 wave-executor **병렬 디스패치**(난이도별 모델·워크트리경로·파일스코프)
             — 병렬 모드: 워커는 harness 명령 없이 «구현만», 턴로그는 scratchpad/<id>.md (§6.2)
        4. [검증] 웨이브별 신규 컨텍스트 wave-verifier(같은 워크트리)로 인수기준 판정 → pass/fail
             검증 결과는 도착 순서대로 오케스트레이터가 `loop attempt` 기록(recordAttempt active 불요, loop.ts:196)
        5. [머지] pass 웨이브 브랜치를 통합브랜치에 머지
        6. [통합검증] **머지 후·회계 전** 통합브랜치에서 전체 스위트 1회(§5, MAJOR-3) — 실패=충돌 취급
        7. [후-정산] 웨이브별 순차: activate → 증적 복사 → wave update(턴로그) → complete
             (증적: create 는 증적 디렉토리에 파일이 미리 있으면 거부하므로 순서는 create→복사→complete. wave.ts:177-189)
```

이 순서 하나로 브리프 보안·유령참조 시점·증적 id 정합·크래시 재개(지시서+attempt 가 저널에 실존)가 전부 성립하고 **코어 diff 0** 이 유지된다.

## 3. 웨이브 분해 · 독립성 (처리량의 핵심)

### 3.1 파일 스코프 파생
코어 노드/웨이브 모델에 path-scope 필드가 없으므로(`LedgerNode`·`WaveMeta` 확인) 오케스트레이터가 설계 산출물 + 리포 구조로 각 웨이브의 파일 스코프를 추정한다: P2 `02-module.md`(모듈 경계·의존그래프), P5 `05-contract`(SCH/API 가 닿는 파일), `.codesight`(고임팩트 파일·의존그래프).

### 3.2 독립성 판정
병렬안전 ⟺ 파일스코프 서로소 AND 산출 의존 없음. 겹침/의존이면 직렬화(다른 라운드).

### 3.3 계약/생성 파일 클래스 — 구조적 상수 (v2: MAJOR-4)
공유 고임팩트 파일만이 아니라 **한 파일에 모이는 계약·생성 파일**이 병렬성을 실질 무력화한다: `schema.prisma`(23모델 단일 파일)·순서 있는 마이그레이션 디렉토리·`package-lock.json`·배럴(`index.ts`). 이건 «분해 오류»가 아니라 구조적 상수다. 취급:
- **스키마·마이그레이션 변경**: 라운드 선두의 전용 **«계약 웨이브» 하나**로 몰고, 나머지 웨이브가 그 위에서 병렬(계약 웨이브는 그 라운드에서 단독).
- **락파일**: 웨이브별로 만지지 말고, 머지 시 `npm install` 재실행으로 **기계 재생성**(충돌 해소를 사람/오케스트레이터 편집이 아니라 도구로).
- **배럴/생성 파일**: 스코프에 명시하고 계약 웨이브 부류로.

### 3.4 라운드 구성
의존그래프 위상정렬 → 라운드. 라운드 내 서로소=병렬, 라운드 간 순차(앞 라운드 통합 결과가 뒷 라운드 base). 사이클/모호는 **보수적 직렬화**.

### 3.5 산출물
«웨이브 플랜»을 사람이 읽을 산출물로(스크래치 또는 오케스트레이터 로컬): `waveId·refs·accept·fileScope·difficulty·round·class(계약/일반)`. 코어 밖 계획 문서.

## 4. 난이도 → 모델 루브릭

| 난이도 | 신호 | 구현 모델 | 검증 모델 |
|---|---|---|---|
| **Trivial/기계적** | 스코프 1~2파일·고임팩트 무접촉·스펙 완전확정 | Haiku 4.5 | **Sonnet 5**(하한) |
| **Clear-spec** | 소~중·단일 모듈 내·인수기준 명확·신규성 낮음 | Sonnet 5 | Sonnet 5 |
| **Multi-file/통합/미묘** | 다파일·다모듈·고임팩트 접촉·미묘 로직·신규성 높음 | Opus 4.8 | Opus 4.8 |

- 오케스트레이터 = **Fable 5**(소진 시 Opus 4.8).
- **검증자 하한 = Sonnet**(v2: MINOR-2) — 검증은 판정 작업이고 CLAUDE.md 경계는 「애매하면 Sonnet」. 반증 지향 검증을 Haiku 에 주지 않는다.
- 채점은 루브릭(규칙표), 3-strike 시 한 단계 승급. 검증자는 항상 구현자와 다른 신규 컨텍스트(OPS-74) — 「이 인수기준을 반증하라」.

## 5. 머지 · 충돌 전략

- **통합 브랜치 경유**(main 직접 아님): 라운드들이 `integration/p8-<milestone>` 위에 쌓이고, 마일스톤 전체가 초록이면 main 으로.
- **라운드 내 머지**: 스코프 서로소라 파일 충돌 기대값 0. 순서 임의.
- **머지 후 통합 검증**(v2: MAJOR-3): 라운드 모든 머지 후·정본 회계 **전에** 통합브랜치에서 **전체 스위트 1회**. 서로소 파일스코프도 «의미 충돌»(A가 헬퍼 계약 변경·B가 새 호출자 추가 → 각자 초록·합치면 빨강)은 못 막으므로, 라운드 단위로 잡는다(마지막에 몰아 잡으면 격리 비용↑). 실패 = 충돌 취급.
- **충돌 처리**: ① 락파일류는 기계 재생성(§3.3) ② 그 외는 갱신된 base 에 **재디스패치**(오케스트레이터의 수제 해소 편집 금지 — 그 diff 는 어느 장부에도 안 실려 P8 의 변경↔노드 대응이 뚫린다. v2: MINOR-5). 재디스패치도 안 되면 두 웨이브 병합해 직렬화.
- **후-정산 타이밍**: 통합검증 초록 뒤 웨이브별 순차 `activate→증적복사→update→complete` → 코어 동시성 0.
- **3-strike**(v2: MINOR-4): 3연속 실패 웨이브는 사용자 소환. **소환 웨이브의 후속 의존 웨이브는 보류, 비의존 라운드는 진행**(명문화).

## 6. 오케스트레이션 기계장치 · 신뢰경계

### 6.0 0단계 전제조건 검사 (v2: BLOCKER-1)
`phase-p8-orchestrate` 진입 즉시: `git ls-files .harness` 가 비어 있고 `.gitignore` 에 `.harness/` 가 있는지 검사. 아니면 **중단하고 사용자 결정**(gitignore 추가 후 재개 / 병렬 모드 포기하고 순차 p8-implement). 이유·명령을 사용자에게 제시.

### 6.1 신뢰경계 — 세션 전역 훅 가드 (v2 정정: MAJOR-1)
**「워커 무가드」는 거짓이었다.** `hooks/hooks.json` 의 PreToolUse/PostToolUse 는 **세션 전역** 매처라 서브에이전트(Agent tool) 도구 호출에도 발화한다(리뷰가 실증). 가드 대상 판정은 경로 기반이고 루트 = `CLAUDE_PROJECT_DIR ?? cwd`(`cli.ts:1649`) = 정본 루트. 즉 **워커가 어느 워크트리에 있든 정본 `.harness/**` 쓰기는 오늘과 동일하게 가드된다** — 이는 A안에 유리한 정정이다(무가드 절충은 애초에 없었고, C안의 주 명분도 사라진다). 남는 한계(명시): 워커의 «소스» 쓰기는 빌드 트랙에서 허용이므로 정본 소스 트리에 닿을 수 있고, 이는 **파일스코프 규율(프롬프트)로만** 막는다.

### 6.2 wave-executor 병렬 모드 정의 (v2: MAJOR-2 — 결과물 항목)
현행 `agents/wave-executor.md` 철칙 3 「매 턴 `harness wave update`」는 병렬 모드에서 **정본 저널을 오염**시킨다(`harness` 는 `CLAUDE_PROJECT_DIR` 로 정본을 잡으므로 워크트리 cwd 에서 실행해도 정본에 떨어짐 `cli.ts:1649`; 라운드 중 정본에 활성 웨이브 없으면 에러, 있으면 남의 턴로그에 병렬 기록). → **병렬 모드에서 워커는 `harness` 명령 전면 금지, 턴로그는 `scratchpad/<waveId>.md`.** 별도 에이전트(`wave-executor-parallel`)로 분리하거나 브리프 모드 플래그로 명문화(현 설계가 이미 있는 것처럼 서술한 규칙을 실제로 적는다). wave-verifier 의 `harness status`/`trace` 질의도 같은 라우팅이므로 병렬 모드에선 워크트리 로컬 정보만 쓰게 조정.

### 6.3 워크트리 메커니즘 결정 (v2: MAJOR-5)
인용한 `superpowers:using-git-worktrees` 는 「네이티브 워크트리 도구가 있으면 수동 `git worktree add` 금지(#1 실수)」라 못박는다. 네이티브 둘: `EnterWorktree` 도구, Agent tool `isolation:"worktree"`. **결정: Agent `isolation:"worktree"` 우선** — 워커 디스패치가 자동 워크트리·미변경 시 자동 정리. 단 검증자가 실행자와 **같은 워크트리**를 써야 하므로(§2 step 4): 실행자 보고에 워크트리 경로를 포함, 검증자는 isolation 없이 그 경로로 진입. 「변경된 워크트리는 잔존」 수명주기 확인·정리를 운영 노트로. (선행 `.claude/worktrees/wf_*` 4개 잔여는 이 네이티브 도구가 남긴 것 — dogfood 전 정리.)

### 6.4 스킬 구조 (v2: MINOR-3)
신규 `phase-p8-orchestrate` 는 기존 `phase-p8-implement`(단일 웨이브 원자 절차)를 **위에서 조율**(스킬이 절차 문서이므로 orchestrate 가 회계 구간에서 p8-implement 절차를 그대로 수행 — 구조상 문제없음). **트리거 배타화**: orchestrate 는 «병렬·다웨이브» 신호에만, p8-implement description 에 상호참조 한 줄. 단일 웨이브 프로젝트는 p8-implement 로 폴백(과설계 방지). 병렬 디스패치는 `superpowers:dispatching-parallel-agents` 활용.

## 7. 결과물 (제품 + 운영)

1. `skills/phase-p8-orchestrate/SKILL.md`(신규) — §2 절차 + §6.0 전제조건 검사 + 트리거 배타화.
2. `agents/wave-executor.md` 병렬 모드(또는 `wave-executor-parallel`) — 워크트리경로·스코프·모델 입력 + **철칙 3 대체**(harness 금지·scratchpad 턴로그).
3. 난이도 루브릭 문서(§4, 검증자 하한 Sonnet).
4. `phase-p8-implement` — 폴백 관계·트리거 상호참조.
5. **코어 코드 변경 0.** 수용 기준: `core/src` diff 없음 **+ 스모크**(v2: MINOR-6) — 선-create 흐름이 코어 표면(brief/attempt 의 active 불요 동작)에 의존이 늘므로, pending 웨이브에 `loop brief`/`loop attempt` 성공이 회귀 없는지 스모크 테스트를 수용 기준에 추가.

## 8. Dogfood 계획

이 리포 자신의 다음 빌드 작업에 먼저 적용해 검증 후 제품 스킬로 확정. 단 §6.0 전제조건(`.harness/` gitignore) 충족 필요, 그리고 이 리포는 현재 설계/보안 트랙이라 실제 병렬 P8 dogfood 대상 웨이브가 마땅치 않을 수 있음 → dogfood 대상 별도 협의(작은 독립 개선 2~3건을 인위적 병렬 라운드로). → **결정(2026-08-26): 인위적 라운드 구성** — 이 리포는 병렬 P8 대상이 아니므로(자기 미적용·설계 트랙), 별도 샌드박스에 `harness init` + `.harness/` gitignore 후 독립 개선 2~3건을 인위적 병렬 라운드로 꾸며 end-to-end 검증한다. **실행은 후속 작업**(샌드박스 구성 + phase-p8-orchestrate 실구동). **워크트리 비용 주의**(v2: MINOR-1): 리포 안 `.claude/worktrees/` N체크아웃 → 메인의 전역 glob(테스트·린트·grep)이 사본을 주울 수 있고(러너 exclude 확인 필요), next-app 이면 워크트리마다 `npm install`(분·GB × N)이 처리량 이득을 상쇄 → pnpm/캐시 공유 또는 워크트리 재사용.

## 9. 위험 · 미해결

- **`.harness/` 스탠스 긴장**(BLOCKER-1): 코어 주석(커밋)과 오케스트레이션 요구(gitignore)가 반대 — §1.1 에서 병렬은 gitignore 로 못박되, 하네스 전체 공식 스탠스 결정은 열린 항목. → **결정(2026-08-26): A — 커밋된 `.harness/` 를 하네스 기본으로 유지**(브랜치 이동·PR 리뷰 이점, 잔존증적/nextWaveId 가드가 방어하는 세계). gitignore 는 병렬 모드 전용(§6.0 게이트)으로, 긴장은 「모드별 요구」로 확정 — 전역 스탠스는 바꾸지 않고 코어 주석도 그대로.
- **의미 충돌**: 서로소 스코프도 못 막음 → §5 라운드 통합검증으로 완화, 잔여는 마일스톤 검증.
- **분해 정확도**: 파일스코프 추정 오류 → 통합검증 실패=재디스패치.
- **워커 소스 규율**: 워커는 가드되지만 정본 소스 트리 쓰기는 파일스코프 프롬프트 규율에만 의존(§6.1).
- **dogfood 대상·워크트리 install 비용**(§8).

## 10. Non-goals

- 코어 N-활성웨이브(B안) — 저널 동시쓰기 위험, 제외.
- C안(워커별 `harness init`) — 「워커도 가드」는 §6.1 정정으로 A안에서 이미 성립하고, C안은 워크트리 로컬 저널 머지백 문제(버리면 유실·합치면 B안 동시쓰기)라는 더 나쁜 문제. 선-create(§2)가 C안 잔여 이점(지시서 실존·재개성)을 코어 무변경으로 흡수. **C안 필요 지점 없음.**
- 하네스 자동 에이전트 디스패치 — 디스패치는 메인 세션(스킬)이.
- 난이도 채점 ML — 규칙표로 충분.
