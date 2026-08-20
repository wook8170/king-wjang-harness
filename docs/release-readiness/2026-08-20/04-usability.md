# 축④ 사용성 · E2E 워크플로우 시뮬레이션

**측정 2026-08-20** · 대상 `e48473d` · 방식: 빌드된 `bin/harness`를 mktemp 샌드박스에서 페르소나별 실주행
(GUI 없음 → 표면은 CLI 텍스트 + 훅 주입 컨텍스트. 근거등급 measured).

주의: 아래 exit code 는 파이프(`| head`) 없이 관측한 값만 기재한다 — 파이프 뒤 `$?`는 head의
종료코드라 신뢰할 수 없다(이번 감사에서 자가 오염 1건 관측, 값 폐기).

## 페르소나 · 시나리오

### P1 — 신규 사용자: 프로젝트 착수부터 첫 턴 로그까지
init → phase set P0 → node upsert F-1 → wave create(--refs F-1) → activate → wave update →
session-start 훅 주입 확인 → wave list.
**전 단계 성공.** 세션시작 훅이 페이즈·활성 웨이브·설계 트랙 제약·활성 웨이브 지시서 안내·
최근 턴 로그 발췌(구분자로 감싼 데이터 라벨)를 정확히 주입. → 판정 **성공**.

- 🟡 마찰: P0에서 wave activate 직후 세션시작 훅이 "소스 코드 쓰기 차단(설계 트랙)"을 알린다.
  설계 트랙(P0~P5) 정책상 정확하나, 웨이브를 막 활성화한 신규 사용자는 "왜 코드를 못 쓰지?"
  하고 멈칫할 수 있다. 결함 아님(정책대로) — 온보딩 문서에서 트랙 개념을 먼저 설명하면 해소.

### P2 — 복구 사용자: 활성 웨이브 파일 유실에서 탈출
activate 후 웨이브 파일 삭제 → `wave update` → 안내 에러(활성 웨이브 id·"파일 복원 우선"·
"유실이면 doctor --repair 정산" 명시, /verify에서 파이프 없이 exit 1 확인) → `doctor --repair`
→ activeWave null 정산 → 잠금 해제. → 판정 **성공**. (C1 수정 e48473d로 raw ENOENT → 안내화)

### P3 — 설계 트랙 에이전트: 훅이 경계를 강제
심링크 root 포함 조합에서 `.harness/state.json` 직접 편집 deny, 소스(`src/a.ts`) deny(사유
"설계 트랙에서 소스 금지"), 설계 산출물(`docs/a.md`) 허용(무출력). → 판정 **성공**
(/verify 축에서 실측, 06-security와 교차).

### P4 — 운영자: 설계 변경으로 STALE 전파
활성 웨이브가 참조하는 노드 `node bump` → version++·STALE 마킹 + stderr로 "이 세션 stop 가드
해제, 미정산 작업이 있으면 새 웨이브 기록" 고지 + activeWave 정산. → 판정 **성공**.

## 발견

| ID | 심각도 | 한 줄 | 근거등급 | 근거 |
|---|---|---|---|---|
| USE-01 | LOW | `wave activate <없는 id>`가 raw ENOENT 노출(활성 잠금 케이스는 e48473d로 안내화됐으나 이 경로는 미변환) | measured | 재현 `harness wave activate wave-999` → `ENOENT: ...wave-999.md`. wave.ts activateWave의 readWave가 부재를 안내로 변환하지 않음 |
| USE-02 | — | P1~P4 전 페르소나 시나리오 완주(실패 0) | measured | 위 P1~P4 |

## 판정선 대비
시나리오 실패 **0**. 마찰 1건(P1 트랙 개념, 문서로 해소). → 축④ 판정선 충족(부분성공/실패 없음).

**축④ 완료: BLOCKER 0, HIGH 0, MED 0, LOW 1 (USE-01, 기존 대장 등재)**
