# king-wjang-harness — 풀사이클 SDLC 하네스 플러그인 설계 스펙

- 작성일: 2026-08-20
- 상태: 사용자 검토 대기
- 결정 경로: 브레인스토밍 대화 (섹션별 승인 완료)

## 0. 목적과 포지셔닝

**그라운드 제로 → 상용 출하까지의 풀사이클을 강제하는 Claude Code 플러그인.**
요구사항 식별부터 설계·검증·뼈대·디자인 시스템·DB/백엔드·구현·테스트·운영/배포 검증·출하 승인까지를
에이전트 오케스트레이션과 스킬로 끌고 가되, **설계 품질**을 최우선으로 한다.

- **배포용**: 마켓플레이스로 배포. 다른 사용자도 설치해 쓸 수 있어야 한다.
- **독립 대체재**: oh-my-claudecode·gstack 등 기존 하네스에 의존하지 않는다. 검증된 패턴은 참고해 재설계.
- **하드 강제**: 규칙은 모델 지침이 아니라 훅이 물리적으로 차단한다.
- **개입 비대칭**: 설계 트랙 = 전 게이트 사용자 승인 / 구축 트랙 = 자동 게이트(개입 최소화) /
  출하 트랙 = 사용자 승인 (되돌릴 수 없는 것들).

### 핵심 요구 (사용자 원문 요약)

1. 탑다운 설계: 제품 컨셉 → 도메인 → 모듈 → 기능. 각 단계는 사용자 대화(확인)·백데이터·첨부 문서 기반.
2. 설계 완료 승인 전 구현 금지 (물리 차단).
3. 최종 설계 후 별도 최상위 모델 에이전트가 논리 정합성·오류·모호함·블로커·UI/UX 시나리오 재검토.
4. 구현은 웨이브/턴 단위 작업 지시서 관리 (작성·업데이트·완료처리) — 세션 단절·토큰 소진·세션 교체에도 이어받기.
5. 구현 중 크리티컬 이벤트 없으면 사용자 개입 최소화.
6. 설계 변경 발생 시 구현↔설계 교차 검증·추적.
7. Claude Design 협업 (프롬프트·산출물·시스템 연동 최대 활용).
8. headless 브라우저·Playwright로 "눈으로 검증" 의무화.
9. 최종 출하 검증은 자작 `verifying-production-readiness` 스킬을 동봉·사용.
10. 비정상 종료·세션 클리어·**계정 교체 로그인**에도 이어받는 구조.
11. 디자인 시스템: 토큰·프리미티브·기본 컴포넌트·도메인 컴포넌트 4계층 + 페이지 레이아웃 일관성 강제.
12. 디자인 시스템은 Claude Design에서 **인터랙션 동작하는 HTML 정본**으로 확인 가능해야 하고,
    코드에서 디자인 시스템만 수정하면 톤·토큰 일괄 변경이 가능해야 한다 (지침 강주입).
13. 기술 스택 / 운영·배포·확장 / 디자인 기반(오픈소스 라이브러리 vs 자체 구축)은
    시스템 성격·사용자 의도 기반 **추천 + 재정의** 가능해야 한다.
14. 요구사항부터 배포까지 **문서로 추적 가능한 산출물 관리** (레지스트리 + 추적 매트릭스).
15. 개발 진행 중 새 세션이 열리면 **Remote Control 활성화** — 모바일 환경에서 연속 확인 가능.

## 1. 아키텍처: 코어 엔진 + 3 어댑터 (접근안 C)

상태 머신·게이트 규칙·원장·웨이브·프로파일 해석을 **하나의 Node/TS 코어**(`harness` CLI)로 구현.
나머지는 전부 얇은 어댑터:

1. **훅 어댑터** — 모든 훅은 `harness hook <event>` 한 줄. 판단(차단/주입)은 코어가 수행.
   순수 로컬 실행(네트워크 없음, <100ms 목표). MCP 서버 생사와 무관하게 하드 강제 유지.
2. **MCP 어댑터** — 같은 코어를 도구로 노출: `harness_status`, `harness_gate_*`, `harness_wave_*`,
   `harness_trace` 등 구조화 조회·조작.
3. **스킬 어댑터** — 페이즈 스킬은 "무엇을 만들지" 지침 담당. 상태 조작은 전부 CLI/MCP 경유.

근거: 하드 강제 + 13페이즈 + 프로파일 + 연동 로직을 bash에 흩으면 자작 도구 파편화를 플러그인 안에서
재현하게 된다. 강제 로직은 코드 한 곳 → 단위 테스트 가능.

## 2. 페이즈 파이프라인 (13페이즈 · 3트랙)

### 설계 트랙 — 탑다운, 전 단계 사용자 승인 게이트

| # | 페이즈 | 하는 일 | 게이트 |
|---|---|---|---|
| P0 | CONCEPT | 제품 컨셉·비전·타깃·성공지표. 사용자 대화 + 백데이터·첨부 문서 분석 | 사용자 승인 |
| P1 | DOMAIN | 도메인 분해 — 도메인 모델·경계·도메인별 요구사항 | 사용자 승인 |
| P2 | MODULE | 모듈 설계 — 경계·인터페이스·의존 그래프. **결정 포인트: 기술 스택 + 운영·배포·확장** (ADR) → 스택 프로파일 확정 | 사용자 승인 |
| P3 | FEATURE | 기능 명세 — 기능별 유저 스토리·시나리오·수용 기준 | 사용자 승인 |
| P4 | EXPERIENCE | **결정 포인트: 디자인 기반**(라이브러리/자체/하이브리드) → UX 시나리오 + 디자인 시스템 4계층 + Claude Design 캔버스 + **인터랙티브 HTML 정본** | 사용자 승인 |
| P5 | CONTRACT | DB 스키마 + API 계약 (엔드포인트·타입·에러 규약) | 사용자 승인 |
| P6 | AUDIT | **설계 총감사** — design-auditor(최상위 모델)가 P0~P5 전체 재검토: 논리 정합성·오류·모호함·블로커·UX 워크스루. 발견 시 해당 페이즈 역행 수정 → 재감사 | 감사 통과 + 사용자 최종 설계 승인 |

**P6 승인 전까지 소스 코드 Write/Edit·빌드·배포 명령을 훅이 물리 차단한다.**

### 구축 트랙 — 자동 게이트, 개입 최소화

| # | 페이즈 | 하는 일 | 게이트 |
|---|---|---|---|
| P7 | SKELETON | 리포·CI·린트 룰팩·테스트 하네스·배포 골격 + UX 노드 → Playwright 시나리오 1:1 변환. "빈 껍데기가 배포 통과" 상태 | 자동 (CI 그린) |
| P8 | IMPLEMENT | 웨이브 단위 구현. 웨이브 지시서를 코어가 관리 | 자동 (웨이브 수용 기준) |
| P9 | VERIFY | 웨이브별 테스트·QA·시각 검증. P8↔P9 루프 | 자동 — 크리티컬 이벤트 시에만 사용자 소환 |

- M0(첫 마일스톤)은 무조건 디자인 시스템 구현(또는 라이브러리 브리지) — §7 참조.
- 마일스톤 목록은 P6 감사 통과 시 설계에서 도출·확정.

### 출하 트랙 — 사용자 승인 게이트

| # | 페이즈 | 하는 일 | 게이트 |
|---|---|---|---|
| P10 | HARDEN | `verifying-production-readiness` 첫 판정 패스 → 결함 대장 → 수정→재판정 루프. 보안·성능·운영 준비(ADR 운영 결정 기반 체크) + 토큰 스왑 드릴 | 사용자 승인 |
| P11 | DEPLOY | 프로덕션 배포 + 스모크/카나리 검증 | 사용자 승인 |
| P12 | SHIP | 같은 스킬의 최종 go/no-go 재판정 — `measured` 근거 없이 출하 불가 (Iron Rule 그대로 게이트 규칙) + 릴리스 노트·최종 체크리스트 | 사용자 승인 |

### 흐름 규칙

- **통제된 역행**: `harness backtrack <페이즈> --reason` → 산출물 개정 → 영향 웨이브 STALE 자동 마킹 → 재승인 후 복귀. 역행 이력은 이벤트 로그에 기록.
- **P8↔P9 웨이브 루프**: 실패 시 재시도, 동일 웨이브 3회(기본값) 연속 실패 = 크리티컬 이벤트.
- **게이트 = 산출물 승인**: 페이즈 전환은 "작업 완료"가 아니라 "산출물 승인"으로만 발생.

## 3. 상태 모델

### 3-1. 상태 저장소 `.harness/` (프로젝트 로컬, git 커밋 대상)

```
.harness/
  state.json          # 상태 머신: 현재 페이즈, 게이트별 상태, 활성 웨이브 포인터 (원자적 쓰기)
  config.yaml         # 게이트 정책(완화), 프로파일 선택, 모델 라우팅, terse, auto-retry opt-in, remote_control
  design/
    00-concept.md …   # P0~P5 산출물 (사람이 읽는 정본)
    ledger.yaml       # 설계 원장 (기계가 읽는 추적 정본)
    tokens/design-tokens.json
  waves/wave-NNN.md   # 웨이브 지시서
  audit/audit-rN.md   # P6 감사 리포트 (라운드별)
  ship/readiness.md   # readiness 결함 대장
  evidence/wave-NNN/  # 시각 증적 (2x 스크린샷, E2E 산출)
  profile/            # (커스텀 스택 시) 프로젝트 로컬 프로파일
  events.jsonl        # append-only 이벤트 저널 (승인·역행·STALE·차단·소환)
```

### 3-2. 설계 원장 (traceability)

모든 설계 요소는 ID를 가진 노드: `C-x`(컨셉) `D-x`(도메인) `M-x`(모듈) `F-x`(기능)
`UX-x`(화면/시나리오) `API-x` `SCH-x`(스키마) `DS-TOK/PRIM/COMP/DCOMP-x`(디자인 시스템 4계층)
`ADR-x`(결정 기록) `DOC-x`(산출물 문서, §3-7).

- 노드 스키마: `id, title, parent, doc_anchor(파일#헤딩), version, status(draft→approved→stale)`
- 웨이브 지시서 frontmatter가 구현 대상 노드 ID를 참조, 커밋 트레일러에도 기록.
- 설계 개정 시 노드 version 상승 → 참조하는 모든 웨이브(완료분 포함) STALE 마킹 → 교차 검증 큐.
- 역방향: 원장에 없는 작업(노드 미참조 변경)은 훅이 잡아 backtrack 경로로 유도.
- `harness trace <노드ID>`: 설계→웨이브→코드 추적 조회.

### 3-3. 웨이브 지시서

```markdown
---
id: wave-012
milestone: M2-결제
design_refs: [F-12, API-23, SCH-4]
status: active          # pending → active → done → (stale)
acceptance: ["결제 e2e 그린", "F-12 수용기준 3/3", "UX-7 시각 증적"]
---
## 목표 / 작업 항목 / 완료 기준
## 턴 로그
- [시각] 한 일, 다음 할 일
```

- 수명주기는 코어 명령으로만: `harness wave create|activate|update|complete`.
- design_refs에 UX 노드가 있으면 시각 증적 없이는 complete 불가 (코어가 기계 검사).
- Stop 훅: 활성 웨이브의 턴 로그 미갱신 시 세션 종료 차단 (handoff-guard 로직의 정확화 버전).
- SessionStart 훅: state + 활성 지시서 주입. progress.md 수동 관리 대체.

### 3-4. 게이트 기록과 근거 등급

- 게이트 레코드: `{phase, status, artifact_hash, evidence: claimed|code|measured, approved_at}`.
- 출하 트랙 게이트는 `measured`만 통과 가능.
- 승인 후 산출물 해시 불일치 감지 시 게이트 자동 무효화.

### 3-5. 시각 증적 서브시스템 (요구 8)

- P4 승인된 UX 노드는 P7에서 Playwright 시나리오로 1:1 변환 (`e2e/ux-7.spec.ts` ← UX-7).
- UI 웨이브는 headless Playwright 실주행 + **2x 스크린샷** 증적 의무.
- P4 아트보드 PNG(2x) = 기준 이미지 → P9 비교 리뷰 패킷 (기준 vs 구현, 사람+감사 에이전트 대조).
- P10/P12: E2E 실주행 증적 없으면 `measured` 불가 → 출하 불가.
- 실행 규율(코어 캡처 유틸에 내장): 항상 headless, `deviceScaleFactor: 2`,
  원격 검토용 증적은 base64 임베드 아티팩트.

### 3-6. 연속성 불변식 (요구 4·10)

**이어받기에 필요한 모든 것은 `.harness/`에만 존재한다.** 세션·계정·키체인 의존 금지.

| 단절 | 복구 |
|---|---|
| /clear·새 세션 | SessionStart 주입 → 즉시 재개 |
| 비정상 종료 | state 원자적 쓰기 + events.jsonl 재생 복구 + 작업트리 diff vs 턴 로그 정산 지시 |
| 계정 교체 | 계정 종속 데이터는 소모성 캐시뿐 — `.harness/`는 계정 무관 |
| auto-retry `--resume` 실패 | 폴백: `claude -p "<상태 읽고 활성 웨이브 계속>"` 신규 세션 부트스트랩 (상태 기반 재개) |
| 머신 교체 | `.harness/` git push/pull. 웨이브 루프는 안정 시점마다 커밋 |

`harness doctor`: 무결성 검사 + 이벤트 재생 복구 + 진행 중 작업 보고.

### 3-6a. 모바일 원격 관제 (Remote Control) (요구 15)

`config.yaml: remote_control: on`(기본 on)이면, `.harness/`가 활성인 프로젝트에서 **새 세션이 열릴
때마다 SessionStart 주입이 Remote Control 활성화를 첫 행동으로 지시**한다(`/remote-control` 실행) —
세션이 바뀌어도 사용자는 모바일에서 끊김 없이 진행 상황을 관제·개입할 수 있다.

- **크리티컬 이벤트 소환(§4-4)과 결합**: 소환 알림(푸시)을 받고 모바일에서 바로 현재 세션에 접속해
  응답하는 동선이 완성된다. 게이트 리뷰 패킷(아티팩트)·승인 요청도 같은 채널에서 이어짐.
- **열화 경로**: 활성화는 모델 지시 기반(하드 강제 아님)이므로 실패할 수 있다 —
  auto-retry의 headless 재개(`claude -p`)처럼 Remote Control이 불가한 실행 형태에서는
  PushNotification + 아티팩트가 모바일 가시성의 폴백 채널.

### 3-7. 산출물 레지스트리 · 요구사항 추적 매트릭스(RTM)

**모든 페이즈 산출물은 등록된 문서다.** 설계 문서·ADR·감사 리포트·결함 대장·시각 증적·릴리스 노트가
원장에 `DOC-x` 노드로 등록된다:

```
{id, phase, path, version, status(draft→submitted→approved→superseded), hash, linked_nodes}
```

- **게이트 연동**: `gate submit` = submitted, `gate approve` = approved + 해시 고정.
  개정은 새 버전 생성 + 이전 버전 superseded (git 이력으로 언제든 회수).
- **전 구간 추적 체인**: F-x(요구) → 설계 문서 섹션(doc_anchor) → ADR → 웨이브 → 커밋 →
  테스트/E2E 증적 → 배포 기록 → 릴리스 노트. `harness trace <노드>`가 문서·증적 포함 전 체인 조회.
- **`harness report rtm`** — 요구사항 추적 매트릭스 생성: 기능(F-x) × {설계 문서, ADR, 웨이브,
  테스트, 증적, 배포}. 미커버 구간(설계만 있고 구현 없음, 구현만 있고 검증 없음)을 자동 표시.
  게이트 리뷰 패킷과 P12 출하 체크리스트에 첨부, 아티팩트로 발행.
- **배포 기록**: P11 배포마다 `{버전, 커밋 SHA, 환경, 시각, 검증 증적}` 등록 →
  "이 요구사항이 어느 배포에 실렸나" 역추적 가능.

## 4. 게이트·훅 강제

### 4-1. 훅 배선 (`hooks/hooks.json` → 전부 `harness hook <event>`)

| 훅 | 판단 |
|---|---|
| SessionStart | state + 활성 웨이브 + 페이즈 규칙 + (config에 따라) terse 규칙·Remote Control 활성화 지시(§3-6a) 주입 |
| PreToolUse (Write·Edit·Bash) | 페이즈별 차단 매트릭스 + 디자인 시스템 동결 + raw 값 리터럴 경고 |
| Stop | 턴 로그 신선도 차단 + 크리티컬 이벤트 소환 + 한도 티어별 핸드오프 강제 |
| PostToolUse | 실패 카운터, usage 티어 갱신 (token-guard 이식) |

### 4-2. 페이즈별 차단 매트릭스

| 페이즈 | 허용 | 차단 |
|---|---|---|
| P0~P6 | `.harness/`·설계 문서, 리서치 | 소스 Write/Edit 전부, 빌드·배포 명령 |
| P7~P9 | 소스, 테스트 실행 | 설계 문서 직접 수정(backtrack 없이), 배포 명령, 동결된 디자인 시스템 경로 |
| P10~P12 | 결함 대장 항목에 한한 수정 | 신규 기능 코드, 게이트 미승인 배포 |

차단 시 사유 + 올바른 경로(`harness backtrack` 등)를 안내 메시지로 반환.
소스 경로·배포 명령의 정의는 프로파일이 제공.

### 4-3. 게이트 승인 — 권한 다이얼로그 장치 (승인됨)

1. `harness gate submit <P>` → 리뷰 패킷 아티팩트 생성 (산출물 요약 + 원장 diff + 스크린샷·캔버스 링크).
2. `harness gate approve <P>` 는 **의도적으로 permission allowlist에서 제외** → 실행 시마다
   권한 다이얼로그 → 승인의 최종 클릭은 항상 사람. LLM 단독으로 게이트를 열 수 없다.
3. 승인 레코드에 산출물 해시 저장 → 사후 변조 시 게이트 자동 무효화.

### 4-4. 크리티컬 이벤트 소환 (요구 5)

발동 조건: ① backtrack 필요 ② 동일 웨이브 N회(기본 3) 연속 검증 실패 ③ 외부 블로커(자격증명 등)
④ 수용 기준 해석 불가. 감지 → 플래그 → Stop 훅이 소환 사유 정리 + 알림(macOS osascript 확실성 +
PushNotification 도구 지시 병행 — token-guard 검증 패턴).

## 5. 결정 포인트(ADR) 서브시스템 (요구 13)

패턴: **시스템 성격(P0~P1: 규모·트래픽·팀·예산·운영 역량·규제) + 사용자 의도 → 추천 패킷(선택지 2~4 +
트레이드오프 + 추천안) → 사용자 채택 또는 재정의(자유 정의 포함) → `ADR-x` 노드로 영구 기록**
(선택지·근거·기각 사유 포함). ADR 변경 = backtrack + STALE 전파.

| 위치 | 결정 | 재정의 경로 |
|---|---|---|
| P2 | 기술 스택 | 번들 프로파일 밖 스택 → `generic` 기반 프로젝트 로컬 프로파일 스캐폴딩 (`.harness/profile/`) |
| P2 | 운영·배포·확장 (호스팅·CI/CD·스케일링·관측·백업/DR·비용) | ADR이 P7 뼈대·P10 체크·P11 배포 명령을 파라미터화. 변경 시 해당 산출물 STALE |
| P4 진입 | 디자인 기반: (a) 오픈소스 라이브러리 + 토큰 오버레이 (b) 완전 자체 (c) 하이브리드(headless+자체 스타일) | 어느 길이든 토큰 단일점 불변 (§7). 라이브러리 시 M0 = 설치→토큰 브리지→갤러리 검증 |

researcher 에이전트가 필요시 생태계 리서치로 추천 근거 보강.

## 6. 에이전트 오케스트레이션 · 모델 라우팅

**원칙: 만든 자가 검증하지 않는다.** 감사·검증 에이전트는 읽기 전용 + 신규 컨텍스트(확증 편향 차단).
모든 감사 발견은 원장 노드 ID 또는 `파일:줄` 필수 (Iron Rule 2의 전 트랙 확장).

| 에이전트 | 모델 | 역할 |
|---|---|---|
| (메인 세션) | 사용자 선택 (Fable/Opus 권장) | 컨트롤러. 설계 대화 P0~P5는 메인 세션이 직접 |
| researcher | sonnet | 백데이터·첨부 문서 분석, 생태계 리서치 |
| design-auditor | fable → opus 폴백 | P6 총감사. 4렌즈 병렬(논리 정합성/모호함/블로커·실현성/UX 워크스루) → 교차 검증된 발견만 채택 |
| wave-executor | opus(까다로움)/sonnet(기계적) | 지시서 1건 구현. 지시서 밖 작업 금지 |
| wave-verifier | opus | 실행자와 분리. 테스트 + Playwright 시각 검증 + 수용 기준·레이아웃 룰 판정 |
| readiness-auditor | fable → opus | P10/P12 readiness 스킬 구동 |
| scout | haiku | 판단 없는 조회 |

### 웨이브 실행 루프 (P8↔P9)

```
컨트롤러: pending 웨이브 → harness wave activate
  → wave-executor (지시서 + 참조 설계 노드 발췌 + 디자인 시스템 철칙 자동 동봉)
  → wave-verifier (수용 기준 + UX 증적 요구)
  → 통과: wave complete → 다음  /  실패: 턴 로그 기록 → 재시도 (3회 = 소환)
```

- 진행 상태 전부 `.harness/` → 컨트롤러가 죽어도 새 세션이 이어받음. auto-retry와 결합 시 무인 야간 주행.
- 독립 웨이브 병렬 디스패치는 worktree 격리 + config opt-in. 기본 직렬.

## 7. 디자인 시스템 (요구 11·12)

### 4계층 (참조 방향은 아래로만)

L1 토큰(시맨틱: `bg.surface`·타이포 스케일·간격 리듬·radius·그림자·모션·브레이크포인트, 라이트/다크)
→ L2 프리미티브(Box·Stack·Grid·Text·Icon) → L3 기본 컴포넌트(Button·Input·Card·Modal·Table…)
→ L4 도메인 컴포넌트(제품 고유, `D-x`/`F-x` 링크). 원장 노드 `DS-*`로 전부 등록.

### 페이지 레이아웃 일관성

- P4에서 **레이아웃 템플릿 세트** 승인 (app-shell, list-detail, form-page, dashboard 등 제품 맞춤).
- 모든 UX 노드는 템플릿 1개를 반드시 선언. 템플릿에 없는 구조 = 템플릿 신설 = 설계 개정.

### 인터랙티브 HTML 정본 (요구 12 전단)

P4 게이트 심사 대상: **디자인 시스템이 적용된, 클릭 가능한 자기완결 HTML 아티팩트** —
토큰 CSS 변수 + 컴포넌트 전 상태 갤러리 + 대표 화면 2~3장 페이지 데모,
기본 인터랙션 동작(hover/focus/active·모달·탭·폼 검증 상태·라이트/다크 토글).
이 HTML의 CSS 변수 블록이 곧 `design-tokens.json`의 원천(동일물). M0 = 이 정본의 스택 이식.
Claude Design 캔버스(시각 편집)와 상호 보완.

### 토큰 단일점 아키텍처 (요구 12 후단)

**불변식: 제품의 시각적 톤 전체가 토큰 파일 1개의 함수다.**

주입 철칙 (모든 UI 웨이브 디스패치에 코어가 자동 동봉 + 프로파일 guidance 상세판):
1. 기능 코드에 raw 값(hex·px 매직넘버·폰트명) 절대 금지 — 시맨틱 토큰 참조만.
2. `text.primary`는 되고 `blue.500`은 안 됨 — 팔레트→시맨틱 매핑은 토큰 파일 내부 사정.
3. 컴포넌트 로컬 오버라이드 금지 — 변형은 variant 토큰 별칭 신설(=원장 개정).
4. 토큰 원천은 `design-tokens.json` 1개. CSS 변수·TS 상수·Tailwind config는 전부 생성물 (수동 복제 금지).

강제 3중: **린트**(raw 값 = CI 레드) + **훅**(토큰 파일 외 위치의 색·간격 리터럴 Edit 차단) +
**토큰 스왑 드릴**(대체 테마로 갈아끼우고 전 화면 스크린샷 → 하드코딩 화면만 안 바뀌어 즉시 노출.
M0 게이트·P10 의무 — "일괄 변경 가능"을 measured 증적으로).

### 컴포넌트 신설 통제

P4 승인 후 디자인 시스템 디렉토리 **동결**. 원장에 없는 컴포넌트 신설·수정 시도는 PreToolUse가 잡아
"컴포넌트 제안(mini-backtrack)" 경로로 유도. 난립·중복 원천 차단.

## 8. Claude Design 연동 (요구 7)

- **캔버스 = UX 노드의 시각 정본**: 아트보드 1장 = UX 노드 1개 (`"UX-7 결제 화면"` 명명 관례).
  캔버스 URL은 원장에 기록. 디자인 시스템 전용 아트보드(토큰 시트·컴포넌트 갤러리) 별도 생성.
- **양방향 동기화**: pull = `harness design sync` (WebFetch로 캔버스 읽기 → 승인 해시 대조 →
  변경 시 UX 노드 version 상승 → STALE 전파: 캔버스 수정도 정식 설계 개정).
  push = 하네스 쪽 화면 신설을 아트보드 추가로 반영.
- **P4 승인 시 캔버스에서 추출 2종**: 컴포넌트 인벤토리 / 아트보드 PNG 2x(=P9 기준 이미지).
  토큰의 원천은 캔버스가 아니라 **HTML 정본의 CSS 변수 블록**(§7) 단일 — 캔버스 디자인 시스템
  아트보드는 그 시각적 표현이며, 불일치 시 HTML 정본이 우선.
- **피드백 채널**: 리뷰 패킷·캔버스의 아티팩트 코멘트 스레드를 `harness gate feedback`으로 수집 →
  개정 반영. 아이패드에서 채팅 없이 "검토→코멘트→개정→재제출" 루프.
- 열화 경로: 캔버스 편집 불가 환경은 view-and-export + 코멘트·채팅 폴백.

## 9. 스택 프로파일

**코어는 "무엇을", 프로파일은 "어떻게".** P2에서 확정(잠금).

```
profiles/<이름>/
  profile.yaml      # 메타
  skeleton/         # P7 템플릿·생성 스크립트 (리포 구조, CI, Playwright 설정)
  rules/            # 린트 룰팩 (§7 강제의 정적 부분)
  design-system/    # 토큰 → 코드 생성 템플릿
  commands.yaml     # test/build/deploy/e2e/dev-server 명령 매핑
  guidance/         # 페이즈 스킬 주입용 스택별 지침
```

- 코어-프로파일 계약: 코어의 추상 동작(테스트 돌려, 소스 경로가 뭐야, 배포 명령이 뭐야)에
  프로파일이 구체값 제공.
- v1 동봉: `nextjs-prisma` + `generic`(명령 매핑만 있는 최소). 커스텀 스택은 §5의 스캐폴딩으로
  프로젝트 로컬 프로파일 생성.

## 10. 자작 도구 흡수

| 도구 | 처리 |
|---|---|
| handoff-guard | 완전 흡수(대체). Stop 차단·SessionStart 주입을 코어로 이식, mtime 휴리스틱 → 웨이브 상태 기반 정확 판정 |
| token-guard | 완전 흡수. usage API 감지(180초 캐시·티어 상승 시만 주입 등 검증 노하우 그대로) → 코어 모듈. 티어: 90%=웨이브 축소, 95%=매 턴 지시서 갱신 강제(스로틀 해제), 99%=최종 핸드오프+소환 |
| auto-retry | 흡수하되 옵션 컴포넌트. 플랫폼 어댑터(macOS=launchd, Linux=systemd/cron). `bypassPermissions`는 위험 고지 후 opt-in. 재개 세션은 지시서 기반 자율 재개. `--resume` 실패 시 상태 기반 부트스트랩 폴백 (§3-6) |
| terse | `config.yaml: terse: on` 플래그로 흡수. SessionStart 주입에 간결 규칙 동봉 |

검증된 안전장치(루프 가드·스로틀·캐시 TTL·중복 잡 가드)는 재설계 없이 이식.
설치 시 `/harness doctor`가 기존 자작 훅 감지 → 중복 등록 해제 안내.

## 11. 플러그인 레이아웃 · 배포

```
king-wjang-harness/
  .claude-plugin/{plugin.json, marketplace.json}
  core/{src,test}/        # TS 코어 (단위 테스트 필수)
  bin/harness             # CLI 진입점 (Node, 의존성 최소)
  hooks/hooks.json
  mcp/                    # MCP 어댑터
  skills/
    harness/              # /harness — status·init·start·doctor·config·gate·wave·trace
    phase-*/              # P0~P12 페이즈 스킬 13종
    verifying-production-readiness/   # 벤더링
  agents/                 # researcher, design-auditor, wave-executor, wave-verifier, readiness-auditor, scout
  profiles/{nextjs-prisma, generic}/
  components/             # auto-retry 플랫폼 어댑터, 알림 유틸
```

### 사용자 여정

```
claude plugin install king-wjang-harness@<마켓플레이스>
/harness init     # .harness/ 생성, 프로파일 후보 제시, config 대화
/harness start    # P0 진입, 이후 파이프라인이 주도
```

### 공존·비간섭 원칙

하네스 훅은 `.harness/`가 있는 프로젝트에서만 활동, 없으면 완전 침묵.
`state.json`에 스키마 버전 기록, 코어가 마이그레이션 담당.

## 12. 알려진 한계 (정직 고지)

- 권한 다이얼로그 승인 장치는 Claude Code의 permission 프롬프트에 의존 —
  사용자가 해당 명령을 allowlist에 넣어버리면 무력화된다 (init 시 경고 고지).
- 프로파일이 얇은 스택(generic)에서는 차단 매트릭스·룰팩의 정밀도가 떨어진다 —
  수동 매핑 품질에 비례.
- usage API·Claude Design 아티팩트 구조는 외부 의존 — 변경 시 코어 어댑터 계층에서 흡수.
- 계정 교체 시 usage 티어·auto-retry 세션 복원은 리셋됨(설계상 의도 — 상태 기반 재개로 폴백).

## 13. 구현 로드맵 (마스터 스펙 이후)

각 항목은 개별 스펙→플랜→구현 사이클로 진행:

1. **코어 엔진 v0**: state.json·events.jsonl·원장·웨이브 CRUD·`harness hook` 판정기 + 훅 배선 + 단위 테스트
2. **게이트·리뷰 패킷**: submit/approve/무효화 + 아티팩트 생성 + 권한 다이얼로그 장치 + 산출물 레지스트리·RTM 리포트
3. **설계 트랙 스킬 (P0~P6)** + researcher/design-auditor + ADR 결정 포인트
4. **디자인 서브시스템**: Claude Design 연동(sync/추출) + HTML 정본 생성 + 토큰 파이프라인
5. **구축 트랙**: 프로파일 2종 + 웨이브 루프 + executor/verifier + 시각 증적 + 룰팩·스왑 드릴
6. **출하 트랙**: readiness 벤더링·통합 + HARDEN/DEPLOY/SHIP 스킬
7. **흡수 컴포넌트**: token-guard·auto-retry 이식 + doctor + 마이그레이션
8. **패키징·배포**: plugin.json·마켓플레이스·문서·eval
