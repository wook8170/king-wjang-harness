---
name: phase-p10-harden
description: Use when 하네스 출하 트랙의 P10(HARDEN) 를 구동할 때 — readiness 첫 판정을 받아 결함 대장을 세우고 수정→재판정 루프를 돌며 토큰 스왑 드릴·보안·성능·운영 준비를 measured 근거로 닫을 때. 트리거: "출하 준비", "readiness 판정", harness phase set P10, P10 게이트 제출, 결함 대장, defects.yaml, readiness.md, 토큰 스왑 드릴, 재측정.
---

# P10 HARDEN — readiness 판정과 결함 대장

## Overview

출하 트랙의 첫 페이즈. **여기서부터 게이트는 `measured` 근거만 통과한다**(Iron Rule, §3-4) —
`harness gate approve P10` 은 근거가 `claimed`·`code` 면 코어가 거부한다. 실주행·측정 없이는
출하 트랙이 열리지 않는다.

판정은 `readiness-auditor` 가 `verifying-production-readiness` 스킬을 구동해 낸다. 만든 자가
검증하지 않는다 — 구축 트랙을 몬 세션이 아니라 신규 컨텍스트의 읽기 전용 감사자가 본다.

**차단 매트릭스가 바뀐다(§4-2).** P10~P12 에서 허용되는 소스 수정은 **결함 대장에 올라온
항목에 한한다.** 신규 기능 코드는 훅이 막는다 — 출하 직전에 끼워 넣는 기능이 가장 비싼 사고다.

## 결함 대장 — 정본은 yaml, readiness.md 는 렌더 사본

| 파일 | 무엇 | 누가 쓴다 |
|---|---|---|
| `.harness/ship/defects.yaml` | **기계 정본.** `harness ship verdict` 가 읽는 곳 | `harness ship defect` 만 |
| `.harness/ship/readiness.md` | 사람이 읽고 아티팩트로 발행하는 **렌더 사본** | 코어가 매 변경마다 다시 찍는다 |

**`readiness.md` 를 손으로 고치지 마라** — 다음 `harness ship defect` 실행이 통째로 덮어쓴다.
감사자가 돌려준 발견은 전부 CLI 로 등록한다.

| 필드 | 규칙 |
|---|---|
| `severity` | `blocker` / `high` / `medium` / `low`. **올릴 수는 있고 내릴 수는 없다** — 내리려면 사유를 남겨라 |
| `evidence` | `파일:줄`(`src/auth.ts:88`) 또는 재현 명령·증적 경로. 없으면 코어가 등록을 거부한다 |
| `status` | `open` → `fixed` → `verified`. **`fixed` 는 주장이고 `verified` 가 관측이다** |
| `deferReason` | `deferred` 로 두려면 **필수**. 사유 없는 유예는 유예가 아니라 은폐다 (코어가 거부) |

`blocker` 는 `verified` 가 되기 전에는 P12 판정을 막는다 — `fixed` 로 멈춰 있어도 막힌다.

## 수정 → 재측정 루프

```bash
harness ship defect add --id SEC-01 --severity blocker \
  --title "세션 토큰이 로그에 남는다" --evidence "src/auth.ts:88"
# → 결함 대장 항목에 한해 수정 (신규 기능 코드는 훅이 막는다)
harness ship defect update SEC-01 --status fixed
# → 같은 측정을 다시 돌린다. 수정은 다음 결함을 드러낸다 (Iron Rule 4)
harness ship defect update SEC-01 --status verified --evidence ".harness/ship/evidence/e2e.log"
```

고친 뒤 재측정하지 않고 `verified` 로 올리는 것은 대장을 거짓말로 채우는 일이다.
재판정은 **readiness-auditor 를 새로 디스패치**해서 받는다(같은 세션이 자기 수정을 승인하지 않는다).

## 의무 항목 — 이 셋은 P10 에서 반드시 measured 로 닫는다

| 항목 | 어떻게 | 근거 |
|---|---|---|
| 토큰 스왑 드릴 | `harness tokens swap --with <대체테마.json>` → 전 화면 headless 2x 재캡처 → **안 바뀐 화면이 곧 하드코딩된 화면** | §7 강제 3중 |
| E2E 실주행 증적 | UX 참조 웨이브마다 `harness evidence check <wave>` 통과 (2x 스크린샷) | §3-5 |
| 운영 준비 | `harness adr show <운영 ADR>` 의 결정(호스팅·백업/DR·관측·롤백)을 하나씩 실제로 확인 | §5 P2 결정 |

스왑 드릴은 "일괄 변경 가능"이라는 주장을 **measured 증적으로 바꾸는** 장치다. 드릴 없이
P10 을 닫으면 토큰 단일점은 문서에만 존재한다.

## 절차

```bash
harness ship verdict                    # 지금 무엇이 막고 있는지 먼저 본다
# → readiness-auditor 디스패치 (verifying-production-readiness 구동, 읽기 전용)
# → 발견을 harness ship defect add 로 전부 등록 → 수정 → 재측정 → verified
harness ship verdict                    # 열린 blocker 0 · UX 웨이브 증적 확인
harness doc upsert --id DOC-P10 --path .harness/ship/readiness.md --phase P10 --refs F-12,UX-7
harness doc url DOC-P10 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P10              # artifact_url 없이는 거부된다
harness gate submit P10 --evidence measured \
  --paths .harness/ship/readiness.md,.harness/ship/defects.yaml
# → .harness/packets/P10.md 제시 → 사용자 승인 대기
harness doc approve DOC-P10
harness phase set P11
```

## 승인은 사람이 한다

**`harness gate approve P10` 은 사람이 누른다. 에이전트가 대신 승인하지 않는다.**
판정 결과·미해결 항목·deferred 사유를 정직하게 요약해 제시하고 기다려라. 근거 등급이
`measured` 가 아니면 코어가 먼저 거부한다 — 그 거부를 우회하려 하지 마라.

## 함정

- **감사자에게 수정 권한을 주지 마라.** `readiness-auditor` 는 읽기 전용이다. 고치는 것은
  메인 세션의 일이고, 고친 자가 다시 판정하면 확증 편향이 그대로 돌아온다.
- **게이트를 먼저 수치로 못 박아라(Iron Rule 1).** 결과를 본 뒤 임계값을 낮추면 그건 판정이
  아니라 사후 승인이다. 완화가 필요하면 **바꾼 사실·시각·사유**를 대장에 남겨라.
- **`deferred` 는 사유가 없으면 등록 자체가 거부된다.** 우회하려고 `low` 로 낮추지 마라 —
  심각도를 내리는 것은 수정이 아니다.
- **빈 대장은 "결함 없음"이 아니라 "아직 보지 않았다"다.** 판정을 돌리지 않은 채 P10 을
  제출하면 리뷰 패킷이 그렇게 적혀 나간다.
- **신규 기능 코드는 훅이 막는다.** 출하 준비 중 발견한 개선 욕구는 결함이 아니라 백로그다.
  진짜 설계 변경이면 `harness backtrack <페이즈> --reason "<사유>"` 로 정식 역행이다.
