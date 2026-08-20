# king-wjang-harness 진행상황 (핸드오프)

## 2026-08-20 — 설계 브레인스토밍 완료, 스펙 검토 대기

### 완료
- 브레인스토밍 전 과정 완료 (superpowers:brainstorming 플로우, 섹션별 사용자 승인).
- **마스터 설계 스펙 작성**: `docs/superpowers/specs/2026-08-20-king-harness-design.md`
  - 풀사이클 SDLC 하네스 플러그인 (배포용, OMC/gstack 독립 대체재)
  - 코어 TS 엔진 + 3어댑터(훅/MCP/스킬), 13페이즈(P0~P12) 3트랙
  - 설계 원장(추적성), 웨이브 지시서(연속성), 하드 게이트(훅 차단 + 권한 다이얼로그 승인)
  - ADR 결정 포인트(스택/운영/디자인 기반 — 추천+재정의), 디자인 시스템 4계층 + 토큰 단일점
    + 인터랙티브 HTML 정본 + 토큰 스왑 드릴, Claude Design 양방향 연동, 시각 증적 의무
  - 산출물 레지스트리(DOC 노드) + 요구사항 추적 매트릭스(RTM) — 요구→배포 문서 추적
  - 모바일 원격 관제(§3-6a): 새 세션마다 SessionStart가 /remote-control 활성화 지시 (요구 15)
  - 자작 4종(token-guard/auto-retry/handoff-guard/terse) 흡수 계획 포함
- 스펙 셀프 리뷰 완료 (토큰 원천 모순 수정: HTML 정본 단일 원천으로 고정)
- 검토용 아티팩트 발행: https://claude.ai/code/artifact/ca5f0860-4d76-40c5-b2e9-166c9c7f5397
  (갱신 시 scratchpad의 king-harness-spec.md 재발행 — 같은 URL 유지)
- git 커밋 2건 (스펙 + RTM 보강)

### 진행 중
- **사용자의 스펙 검토 대기** ← 지금 여기

### 다음에 즉시 할 일
1. 사용자 스펙 승인 받기 (수정 요청 시 스펙 개정 → 셀프 리뷰 재실행)
2. 승인 후: superpowers:writing-plans 스킬로 구현 플랜 작성 — 스펙 §13 로드맵 1번
   "코어 엔진 v0"부터 (개별 스펙→플랜→구현 사이클)

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
