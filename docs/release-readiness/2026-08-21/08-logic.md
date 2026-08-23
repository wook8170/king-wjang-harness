# ⑧ 논리 불변식 · 데이터 정합성

## 스스로 선언한 불변식 — 수집 후 전건 검증

코드 주석·README·스펙이 선언한 불변식을 모아 **깨지는 시나리오**를 만들어 돌렸다.

| 선언된 불변식 | 시나리오 | 결과 |
|---|---|---|
| `.harness/` 가 없으면 완전 침묵 | 4 이벤트 발화 | ✅ exit 0 · stdout 0바이트 · 디렉토리 미생성 |
| 훅은 세션을 절대 깨지 않는다 | 깨진 JSON·빈 stdin·미지 이벤트·`null` 필드·9000자·유니코드 | ✅ 6/6 exit 0 |
| 설계 트랙에서 소스 쓰기 금지 | `src/app.ts` 쓰기 | ✅ deny |
| 코어 파일 직접 편집 금지 | `.harness/state.json` 편집 | ✅ deny |
| 경로 우회 차단 | `docs/../src/x.ts` · 심링크 `docs-link/` | ✅ 둘 다 deny |
| 이벤트 저널이 진실의 원천 | state.json 삭제 후 훅 발화 | ✅ 폴백으로 강제 유지 |
| 형태 손상 state 도 흡수 | `{}` 로 덮고 훅 발화 | ✅ exit 0 |
| 저널 손상은 은폐하지 않는다 | `events.jsonl` 을 쓰레기로 | ✅ doctor 가 `1줄 손상 — 재생 불완전` 보고 |
| 유령 설계 참조 거부 | `wave create --refs GHOST-9` | ✅ exit 1 |
| UX 웨이브는 증적 없이 완료 불가 | 증적 없이 `wave complete` | ✅ 거부 → 증적 추가 후 통과 |
| 웨이브는 동시에 하나만 활성 | 완료 웨이브 재활성 | ✅ 거부 |
| 심사한 것과 승인할 것이 같다 | 제출 후 산출물 변경 → 승인 | ✅ 해시 불일치로 거부(코드+E2E) |

## 🔴 깨진 불변식 [LOGIC-21] HIGH

**「state.json 은 events.jsonl 의 파생물이다」가 지켜지지 않는다.**

`gate.ts:97`·`gate.ts:134` 는 `evidence`·`submittedAt` 를 state 에 쓰지만,
`events.ts:74~89` 의 재생 리듀서는 `gate-submitted`/`gate-approved` 에서 **`evidence` 를
복원하지 않는다** — 저널 이벤트는 그 값을 갖고 있는데도(`gate.ts:135`) 리듀서가 버린다.

실측(재현):
```
harness gate submit P10 --paths docs/a.md --evidence measured && harness gate approve P10
harness gate status   # → "evidence": "measured"
harness doctor --repair
harness gate status   # → evidence 필드 자체가 사라짐. submittedAt 도 사라짐
```
**복구 명령이 데이터를 지운다.** 파괴 방향은 안전한 쪽이다(근거 등급이 사라지면 출하
판정은 NO-GO 로 기운다 — `core/src/ship.ts:511`) 이고 저널에 원본이 남아 리듀서 수정만으로
되살릴 수 있어 **BLOCKER 가 아니라 HIGH** 로 매겼다. 그 사유를 여기 남긴다.

## 경계값

`0건 / 1건 / 1만 / 10만` 이벤트, 빈 문자열, `null`, 9000자, 유니코드, `__proto__` 키 —
전부 크래시 없음. `schemaVersion: 99`(미래값)만 무경고 통과 → [SHIP-31] LOW.
