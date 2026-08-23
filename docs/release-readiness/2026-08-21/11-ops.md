# ⑪ 운영 · 관측성

서버가 없으므로 「알림」은 **사람이 문제를 알아채는 경로**로 번역했다:
`doctor` 진단 · `hook-errors.log` · 훅이 화면에 내는 사유 문구.

## 🔴 [OPS-20] HIGH — 유일한 건강검진이 상시 빨강

게이트를 **한 번이라도 승인하면** 그 뒤 모든 `doctor` 가 `ok:false`·exit 1 이다.

```
harness gate submit P0 --paths docs/spec.md --evidence claimed
harness gate approve P0
harness doctor
# → "gates 불일치: state={...approvedAt:"...925Z", evidence:"claimed"},
#     이벤트 재생={...approvedAt:"...926Z"}"        ← 1ms 차이 + evidence 누락
```

원인 둘 (⑨·⑧ 참조):
1. `gate.ts:134` 가 승인 시각을 자체 `new Date()` 로, `events.ts:25` 가 저널 시각을 **따로** 찍는다 → 항상 어긋난다.
2. 재생 리듀서가 `evidence` 를 복원하지 않는다 → 항상 필드가 빈다.

**왜 HIGH 인가**: 이 진단은 저널·상태 드리프트를 잡으라고 있는 유일한 장치다. 정상 사용에서
늘 빨갛다면 진짜 드리프트가 났을 때 아무도 구별하지 못한다 — 「그거 원래 실패해요」가
제품에 내장된 셈이다(Iron Rule 6). exit 1 이라 자동화에 물리면 그대로 파이프라인을 세운다.

## 조용한 실패 [OPS-47] ✅

전 소스에서 **무처리 catch 5건**을 찾아 하나씩 「실패하면 누가 아는가」를 물었다.

| 위치 | 삼키는 것 | 아는 방법 |
|---|---|---|
| `core/src/cli.ts:83` · `core/src/hook.ts:162` | hook-errors 기록 실패 | 이중 실패 — 다만 훅의 유일한 의무는 세션 보호. 계약 범위 |
| `core/src/doctor.ts:61` · `:207` | 진단 중 경합·회전 실패 | **다음 실행에 경고가 다시 보인다** |
| `core/src/runtime.ts:26` | 마커 삭제 실패 | 세션 시작을 막지 않음 |

**5/5 전부 주석으로 사유가 적혀 있고 대체 관측 경로가 있다.** 새 결함 없음.

## 관측 경로가 실제로 도는가

- `hook-errors.log` — 깨진 stdin·미지 이벤트를 실제로 기록하는 것을 확인(`evidence/e2e.log`).
- 로그 회전 — `doctor` 가 `hook-errors.log` 를 **비우지 않고 `.prev` 로 회전**한다
  (`core/src/doctor.ts:206`). `.runtime/` 이 gitignore 라 유일본이라는 이유까지 주석에 있다.
- 훅 deny 사유가 **다음 행동을 말한다**: 「설계 산출물을 먼저 완성하라」 등.

## 운영 작업

`doctor --repair`(저널 재생 복구) · `--force`(저널 불신 시 강행) · `gate sweep` ·
`backtrack clear` 가 CLI 로 가능하다. **DB 직접 수정이 필요한 작업은 없다.**
단 `--repair` 는 지금 데이터를 지운다 → [LOGIC-21].

## 보지 않은 것

- **CI 가 없다.** 테스트·타입·audit 이 사람 손으로만 돈다 — 회귀를 자동으로 알 방법이 없다.
  기술 결함이라기보다 **사용자 결정 사항**(리모트 없음과 묶임)으로 올린다.
