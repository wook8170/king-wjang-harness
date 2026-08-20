---
name: phase-p11-deploy
description: Use when 하네스 출하 트랙의 P11(DEPLOY) 를 구동할 때 — 프로덕션 배포를 실행하고 스모크·카나리로 실주행 검증한 뒤 harness ship deploy 로 배포 기록을 등록해 게이트에 올릴 때. 트리거: "배포하자", "프로덕션 올리자", harness phase set P11, P11 게이트 제출, 스모크 테스트, 카나리, 배포 기록, deployments.yaml, 롤백.
---

# P11 DEPLOY — 배포와 실주행 검증

## Overview

**P10 이 승인되기 전에는 배포 명령이 훅에 막힌다**(§4-2). 여기서 하는 일은 셋이다:
배포 → 스모크·카나리 실주행 검증 → **배포 기록 등록**.

배포 기록의 존재 이유는 로그가 아니라 **역추적**이다(§3-7) — "이 요구사항이 어느 배포에
실렸나"에 답하려면 커밋 SHA·버전·환경·검증 증적이 한 줄에 함께 있어야 한다. 기록하지 않은
배포는 RTM 의 배포 칸을 영원히 비워 둔다.

## 배포 전 확인

```bash
harness ship verdict          # P10 승인·열린 blocker 0 을 여기서 다시 본다
harness gate verify P10       # 승인 후 산출물이 변조되지 않았는지
harness profile cmd deploy    # 배포 명령은 프로파일이 준다 — 손으로 짜지 마라
```

| 확인 | 왜 |
|---|---|
| 롤백 경로 | 운영 ADR 이 정한 롤백 절차를 **실제로 부를 수 있는지**. "롤백 버튼이 있다"는 눌러 보기 전까지 measured 가 아니다 |
| 배포 대상 커밋 | `git rev-parse HEAD` — 기록에 박을 SHA 는 **실제로 나간 커밋**이어야 한다 |
| 환경 | `production` / `staging`. 스모크 증적이 어느 환경 것인지 대장이 말할 수 있어야 한다 |

## 스모크 · 카나리

배포 직후의 검증은 **실주행이다.** 로그가 조용한 것은 검증이 아니라 침묵이다.

- 핵심 사용자 시나리오를 **제품으로 끝까지** 해 본다(Iron Rule 3). 정적 확인으로 대체하지 마라.
- UI 가 있으면 **headless · `deviceScaleFactor: 2`** 로 캡처한다. 창을 띄우면 사용자 화면의
  포커스를 빼앗고, 1x 캡처는 원격 검토에서 글자가 뭉개져 회귀를 눈으로 잡을 수 없다.
- 카나리는 **되돌릴 수 있는 범위**에서 먼저 받는다. 전량 전환은 카나리 관측 뒤다.
- 스모크 로그·캡처 경로가 곧 배포 기록의 `--evidence` 값이 된다.

## 절차

```bash
$(harness profile cmd deploy)           # 프로파일이 준 배포 명령
# → 스모크·카나리 실주행 → 로그·캡처를 .harness/ship/evidence/ 에 남긴다
harness ship deploy --version v1.2.0 --sha "$(git rev-parse HEAD)" --env production \
  --evidence .harness/ship/evidence/smoke.log,.harness/ship/evidence/canary.png
harness doc upsert --id DOC-P11 --path .harness/ship/deployments.yaml --phase P11 --refs F-12
harness doc url DOC-P11 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P11              # artifact_url 없이는 거부된다
harness gate submit P11 --evidence measured \
  --paths .harness/ship/deployments.yaml,.harness/ship/evidence/smoke.log
# → .harness/packets/P11.md 제시 → 사용자 승인 대기
harness doc approve DOC-P11
harness phase set P12
```

빈 커밋 SHA·빈 환경·빈 버전은 코어가 거부한다 — 역추적 불가능한 기록은 기록이 아니다.

## 승인은 사람이 한다

**`harness gate approve P11` 은 사람이 누른다. 에이전트가 대신 승인하지 않는다.**
배포는 되돌리는 비용이 가장 큰 행동이다. 스모크·카나리 결과와 롤백 경로를 제시하고 기다려라.
근거 등급이 `measured` 가 아니면 코어가 먼저 거부한다.

## 함정

- **배포하고 기록하지 않으면 P12 가 막힌다.** 체크리스트의 배포 칸이 비고, RTM 이 "어느 배포에
  실렸나"에 답하지 못한다. `harness ship deploy` 는 배포 직후에 친다 — 나중에 몰아 치면 SHA 를 잃는다.
- **재배포는 새 기록이다.** 기존 줄을 고치지 마라. 같은 버전을 다시 올렸어도 SHA·시각이 다르면
  다른 배포다.
- **스모크가 실패하면 결함 대장으로 돌아간다.** `harness ship defect add` 로 등록하고 P10 루프를
  다시 돈다. 실패를 안고 P12 로 넘어가지 마라.
- **`--evidence` 를 비우지 마라.** 증적 없는 배포 기록은 "올렸다"는 주장일 뿐이고, P12 판정에서
  근거로 서지 못한다.
- **배포 중 발견한 개선은 신규 기능 코드다 — 훅이 막는다.** 대장 항목이 아니면 백로그로 보내라.
