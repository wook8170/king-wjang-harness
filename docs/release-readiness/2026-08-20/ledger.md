# 결함 대장 — king-wjang-harness 코어 엔진 v0 @ e48473d

**갱신** 2026-08-20(착수) · **판정** 미판정(감사 진행 중) · **open BLOCKER** 0 · **open 전체** 6

이전 리뷰·검증에서 이월된 항목을 착수 시점에 선등재한다. 감사 축 발견은 **번호 10부터** 부여
(01~09는 선등재 예약). 한 번 부여한 ID는 재사용하지 않는다.

| ID | 심각도 | 축 | 한 줄 | 상태 | 근거등급 | 근거 | 닫은 증거 |
|---|---|---|---|---|---|---|---|
| SEC-01 | MED | 06 | 보호 디렉토리 자체가 외부 심링크면 그 실경로 직접 쓰기가 P8에서 허용 | open | measured | 최종 재판정 E2E 재현, hook.ts:283-331 · Bash 표면과 동급이라 기존 수용 표면 이내 | — |
| SEC-02 | LOW | 06 | realpath 판정의 TOCTOU 잔존(판정 후 심링크 교체) — 계약상 "사고 방지 장치" 범위 | deferred | code | hook.ts 헤더 계약 · 문서화로 갈음 예정 | — |
| USE-01 | LOW | 04 | `wave activate <없는 id>` raw ENOENT 노출 (활성 잠금 케이스는 e48473d로 해소) | open | measured | 최종 재판정 Info · 재현: `harness wave activate wave-999` | — |
| SHIP-01 | LOW | 10 | devDependencies 없는 설치(`--omit=dev`)에서 prepare가 tsup 부재로 hard-fail | open | measured | Task 3 품질 리뷰 실측(npm 10.9.7) — private 패키지라 영향 소, 설치 문서 필요 | — |
| SHIP-02 | MED | 10 | 이 커밋 이전에 init된 기존 `.harness/`의 `*`-only `.runtime/.gitignore` 마이그레이션 부재 | open | code | state.ts는 신규 init만 고침 · doctor 검사 후보 | — |
| API-01 | LOW | 02 | `--refs` 원장 검증이 CLI 전용 — `createWave()` 직접 호출은 우회 | deferred | code | cli.ts:129-138 · v0 수용(CLI가 유일 소비자), 게이트 CLI(로드맵 2) 때 재고 | — |
| API-02 | LOW | 02 | `MultiEdit`은 현행 도구 목록에 없는 죽은 분기 (무해) | deferred | code | hook.ts WRITE_TOOLS · 하위호환 유지 결정(이전 세션) | — |
| LOGIC-01 | MED | 08 | 훅 자기호출 식별이 정규식(I6) — CLI 마커 방식 근본책은 로드맵 후속 | deferred | code | hook.ts HARNESS_CMD_RE · 명령 위치 한정으로 완화됨 | — |
| LOGIC-02 | LOW | 08 | doctor 정산 후 웨이브 파일이 복귀하면 frontmatter status:active 잔존(재활성화 가능) | open | measured | 최종 재판정 Info | — |
| OPS-01 | LOW | 11 | replayState가 「버린 이벤트 수」를 반환하지 않음(M1) | deferred | code | events.ts · 로드맵 후속 | — |
| OPS-02 | MED | 11 | doctor에 웨이브/원장 정합 검사 부재(M3) | deferred | code | doctor.ts · 로드맵 후속 | — |
