---
name: phase-p12-ship
description: Use when 하네스 출하 트랙의 P12(SHIP) 를 구동할 때 — harness ship verdict 로 최종 go/no-go 를 재판정하고 릴리스 노트·최종 체크리스트(RTM 첨부)를 만들어 마지막 승인을 받을 때. 트리거: "출하하자", "go/no-go", "릴리스 노트", harness phase set P12, P12 게이트 제출, 출하 체크리스트, 최종 판정.
---

# P12 SHIP — 최종 go/no-go

## Overview

마지막 페이즈. 여기서 하는 일은 **재판정**이다 — P10 에서 한 번 봤다는 이유로 다시 보지 않는
것이 출하 사고의 표준 경로다. P11 배포가 상태를 바꿨으므로 판정은 새로 낸다.

**`measured` 근거 없이 출하 불가.** 이건 지침이 아니라 코어 규칙이다 —
`harness gate approve P12` 는 근거가 `claimed`·`code` 면 거부된다(Iron Rule, §3-4).

## 최종 판정 — `harness ship verdict`

기계가 보는 차단 조건은 넷이다. 하나라도 남으면 NO-GO 이고, 사유는 **무엇을 어떻게 닫는지까지**
지목한다.

| 차단 조건 | 닫는 법 |
|---|---|
| 열린 `blocker` 결함 | 수정 → **재측정** → `harness ship defect update <id> --status verified` |
| `fixed` 에 멈춘 `blocker` | 「고쳤다」는 주장이다. 다시 돌려 관측한 뒤 `verified` 로 올린다 |
| P10·P11 게이트 미승인 | 해당 페이즈로 돌아가 산출물을 제출하고 사용자 승인을 받는다 |
| 출하 게이트 근거가 `measured` 아님 | 실주행·측정 증적을 붙여 재제출 |
| UX 참조 웨이브에 실주행 캡처 없음 | `harness evidence check <wave>` → headless 2x 스크린샷을 남긴다 |

판정은 디스크 내용만으로 결정된다 — 같은 상태면 같은 판정이다. **NO-GO 를 우회하는 경로는
없다.** 판정을 통과시키려면 상태를 바꿔라, 판정을 바꾸지 말고.

`deferred` 는 차단 조건이 아니다 — **그래서 위험하다.** blocker 를 `deferred` 로 옮기면
판정은 GO 로 뒤집힌다. 그건 결함을 닫은 것이 아니라 **사람에게 넘긴 것**이므로, 사유를 들고
승인자 앞에 서라(아래 함정).

## 최종 체크리스트

`harness ship checklist` 가 판정·결함 대장 요약·배포 기록·**RTM 전문**을 한 장으로 낸다.
RTM 은 요약해 옮겨 적지 않고 그대로 첨부한다(§3-7) — 옮겨 적는 순간 두 문서가 갈라지고,
갈라지면 느슨한 쪽이 읽힌다. RTM 의 미커버 구간은 **NO-GO 사유는 아니지만 승인자가 반드시
봐야 하는 정보**다: 설계만 있고 구현이 없는 요구가 이 릴리스에 무엇인지 사람이 판단한다.

## 릴리스 노트

| 섹션 | 내용 |
|---|---|
| 실린 것 | 이번 배포의 요구(F-x) 단위. RTM 의 배포 칸과 일치해야 한다 |
| 알려진 한계 | `deferred` 결함 전부 + 사유. 숨기면 다음 사람이 같은 것을 다시 발견한다 |
| 보지 않은 것 | 판정에서 뺀 축과 그 사유. 뺐다는 사실 자체가 정보다 |
| 배포 좌표 | 버전 · 커밋 SHA · 환경 (`harness ship deploy` 기록 그대로) |

## 절차

```bash
harness ship verdict                    # 재판정 — NO-GO 면 여기서 멈춘다
harness ship checklist > .harness/ship/release-checklist.md
# → 릴리스 노트 작성 (.harness/ship/release-notes.md)
harness doc upsert --id DOC-P12 --path .harness/ship/release-checklist.md --phase P12 --refs F-12,UX-7
harness doc url DOC-P12 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P12              # artifact_url 없이는 거부된다
harness gate submit P12 --evidence measured \
  --paths .harness/ship/release-checklist.md,.harness/ship/release-notes.md,.harness/ship/defects.yaml
# → .harness/packets/P12.md 제시 → 사용자 최종 출하 승인 대기
harness doc approve DOC-P12
harness report hub                      # 허브 아티팩트 갱신 — 사용자의 북마크가 최신을 가리킨다
```

제출 전에 `harness gate sweep` 을 한 번 돌려라 — 승인 후 변조된 산출물을 승인 요청 **전에** 잡는다.

## 승인은 사람이 한다

**`harness gate approve P12` 는 사람이 누른다. 에이전트가 대신 승인하지 않는다.**
이건 "출하" 버튼이고 되돌리는 비용이 가장 크다. 판정 결과·deferred 목록·RTM 미커버 구간을
있는 그대로 제시하고, 사용자가 직접 승인하게 하라. GO 판정은 승인이 아니라 **승인 심사의
입력**이다.

## 함정

- **P10 판정을 재사용하지 마라.** 배포가 상태를 바꿨다. 재판정 없는 출하는 어제의 관측으로
  오늘을 승인하는 것이다.
- **NO-GO 사유를 요약하지 마라.** "준비 안 됨" 한 줄은 다음 사람에게 아무것도 알려주지 않는다.
  판정이 낸 사유를 그대로 사용자에게 보여라.
- **유예로 뒤집은 NO-GO 는 GO 가 아니다.** blocker 를 고치지 않고 `deferred` 로 옮기면 판정은
  통과하지만 결함은 그대로 나간다. 코어는 사유 없는 유예를 거부하고(`--defer-reason` 필수)
  유예된 항목을 **체크리스트에 계속 노출한다** — 숨길 수 없게 되어 있는 것은 숨기지 말라는
  뜻이다. 유예는 "고쳤다"가 아니라 **"이 사유로 안 고치고 나가겠습니다"** 라는 승인 요청이다.
- **`deferred` 를 릴리스 노트에서 빼지 마라.** 알려진 한계를 적지 않으면 그건 한계가 아니라
  사고가 된다.
- **체크리스트는 발행해야 산출물이다(요구 16).** 로컬에만 있는 문서로는 게이트에 올릴 수 없다 —
  `harness doc submit` 이 artifact_url 부재를 거부한다.
- **출하 후 발견은 새 사이클이다.** P12 승인 뒤 고칠 것이 생기면 `harness backtrack` 으로
  정식 역행하라. 승인된 산출물을 조용히 고치면 게이트가 자동 무효화된다(§4-3).
