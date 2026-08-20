---
name: phase-p3-feature
description: Use when 하네스 설계 트랙의 P3(FEATURE) 를 구동할 때 — 기능별 유저 스토리·시나리오·수용 기준을 F-x 노드로 확정해 게이트에 올릴 때. 트리거: "기능 명세 쓰자", harness phase set P3, P3 게이트 제출, 03-feature.md, F-x 노드 등록, 유저 스토리, 수용 기준, RTM 행.
---

# P3 FEATURE — 기능 명세

## Overview

모듈(`M-x`)이 실제로 무엇을 해주는지를 **기능 단위**(`F-x`)로 쓴다.
산출물은 `.harness/design/03-feature.md`.

**`F-x` 는 RTM(요구사항 추적 매트릭스)의 행이다.** 기능 하나 = 노드 하나 = RTM 한 줄.
id 없는 기능은 추적 대상이 아니고, 추적되지 않는 기능은 구현 커버리지 판정에서 사라진다.
`harness report rtm` 이 "설계만 있고 구현 없음 / 구현만 있고 검증 없음" 을 잡아내는 근거가
바로 이 id 다.

## 기능 하나의 최소 구성

| 항목 | 규칙 |
|---|---|
| id | `F-1`, `F-2`… 연속 번호. 재사용·재배치 금지 |
| 부모 | `--parent M-x` (소속 모듈). 모듈 없는 기능은 존재할 수 없다 |
| 유저 스토리 | `<역할>로서 <목적>을 위해 <행동>한다` — 역할은 P0 `C-2` 의 타깃이어야 한다 |
| 시나리오 | 정상 흐름 + **예외 흐름 최소 1개**. 예외 없는 명세는 절반이다 |
| 수용 기준 | 검증 가능한 문장 N개. 각 항목은 P8 웨이브의 `--accept` 로 그대로 간다 |
| 우선순위 | 마일스톤 배정의 입력 (P6 통과 시 마일스톤 확정) |

**수용 기준 작성 기준**: "빠르다" ✗ / "목록 200건 렌더 1s 이내" ○.
사람이 판정에 이견을 낼 수 있으면 아직 기준이 아니다.

## 절차

```bash
harness node upsert --id F-1 --title "주문 생성" --parent M-1 --anchor "03-feature.md#f-1-주문-생성"
harness node upsert --id F-2 --title "주문 취소" --parent M-1 --anchor "03-feature.md#f-2-주문-취소"
harness doc upsert --id DOC-P3 --path .harness/design/03-feature.md --phase P3 --refs F-1,F-2,F-3
harness doc url DOC-P3 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P3          # artifact_url 없이는 거부된다
harness gate submit P3 --paths .harness/design/03-feature.md --evidence claimed
# → .harness/packets/P3.md 제시 → 사용자 승인 대기
harness doc approve DOC-P3
harness phase set P4
```

`--refs` 는 쉼표 구분, **공백 없이**. 기능이 많으면 전부 넣어라 — 리뷰 패킷의 원장 노드 표가
곧 심사 범위이고, 빠진 노드는 심사받지 않은 것이다.

## 승인은 사람이 한다

**`harness gate approve P3` 는 에이전트가 치지 않는다.** 기능 수·수용 기준 개수·
누락된 예외 흐름을 요약해 보고하고, 사용자의 승인을 기다린다.

## 함정

- **수용 기준을 나중에 쓰겠다고 비워두지 마라.** P8 웨이브는 `harness wave create --accept`
  로 이 문장을 그대로 받는다. 비어 있으면 웨이브가 "무엇을 만족하면 끝인지" 없이 시작한다.
- **기능을 합치거나 쪼개는 것은 개정이다.** 승인 후 `F-3` 을 둘로 나누려면
  `harness backtrack P3 --reason "<사유>"` → 수정 → `harness node bump F-3`
  (참조 웨이브 STALE 전파) → 재제출.
- **`node bump` 는 부분 실패를 exit 1 로 보고한다** — "STALE 전파 불완전" 메시지가 뜨면
  해당 웨이브를 손으로 확인하라. 조용히 넘어가면 낡은 설계로 구현된 웨이브가 살아남는다.
- **UX 는 P4 의 몫이다.** 여기서 화면·컴포넌트를 정하지 마라 — `UX-x` 는 P4 노드다.
  P3 는 "무엇을" 까지, "어떻게 보이나" 는 P4.
