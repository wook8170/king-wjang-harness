# 축⑨ 결정성 · 재현성

**측정 2026-08-20** · 대상 `e48473d` · 근거등급 measured (달리 표기한 곳 제외).

## 측정 결과

| 항목 | 방법 | 결과 |
|---|---|---|
| 테스트 플레이키 | `npm test` 3회 반복(조용한 창) | **171 passed 3/3 동일** — 설명 못 하는 실패 0 |
| 빌드 재현성 | 같은 커밋 `npm run build` 반복 | 산출 `core/dist/cli.js` 동일(40.68KB CJS 단일), 락파일 `lockfileVersion:3` 고정(축⑦) |
| 시간·난수 의존 | `grep Math.random\|Date.now\|new Date` over core/src | `Math.random` **0**. `new Date().toISOString()` 8곳 전부 **타임스탬프 메타데이터**(이벤트 ts·state.updatedAt·턴로그 ts·활동마커·에러로그) — 로직 판정 무관 |
| 재생 결정성 | 같은 저널 replayState 반복 | 순수 폴드(입력 이벤트 순서에 결정적), 축⑧ LOGIC-1b에서 doctor 수렴 measured |
| 마이그레이션 양방향 | 축⑩: 구버전→신버전(업그레이드), 신버전→구버전(롤백) | **양방향 성공·데이터 유실 0** (`10-deploy.md`) |

## 시간 의존의 유일한 실판정 지점: stop 가드
`stopGuard`는 런타임 마커 `lastActivityAt`/`lastTurnAt`(타임스탬프 파일)을 비교해 "작업 후 턴
로그 미갱신"을 판정한다(hook.ts). 이는 **같은 세션 내 활동↔로그의 실제 발생 순서**에 결정적이며
(마커는 실제 이벤트 시점에 쓰임), 벽시계 절대값이 아니라 상대 순서만 본다 — 결정성 결함 아님.
DST·타임존 영향 없음(ISO UTC, 비교만).

## 발견
| ID | 심각도 | 한 줄 | 근거등급 |
|---|---|---|---|
| DET-10 | — | 테스트 3회 동일·빌드 재현·난수 0·타임스탬프는 메타데이터뿐·마이그레이션 양방향 성공 | verified/measured |

마이그레이션 파일(DB 스키마) 개념 없음(파일 기반 상태, 전방호환은 replayState의 미지 이벤트
무시로 확보 — 축⑧ 2b·축⑩ 롤백). **"없다"는 code로 확정, "동작한다"는 measured.**

**축⑨ 완료: BLOCKER 0, HIGH 0, MED 0, LOW 0 (DET-10 verified)**
