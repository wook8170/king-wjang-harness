---
name: phase-p1-domain
description: Use when 하네스 설계 트랙의 P1(DOMAIN) 을 구동할 때 — 컨셉을 도메인으로 분해하고 도메인 모델·경계·도메인별 요구사항을 확정해 게이트에 올릴 때. 트리거: "도메인 나누자", harness phase set P1, P1 게이트 제출, 01-domain.md, D-x 노드 등록, 도메인 경계.
---

# P1 DOMAIN — 도메인 분해

## Overview

P0 의 컨셉(`C-x`)을 **도메인으로 쪼갠다**. 산출물은 `.harness/design/01-domain.md`,
원장 노드는 `D-x`. 모든 `D-x` 는 `--parent` 로 자기 근거가 된 `C-x` 를 가리킨다.

여기서 정한 경계가 P2 모듈 경계·P5 스키마 소유권을 결정한다. 경계가 흐리면
P6 감사가 "논리 정합성" 렌즈로 잡아내고 전부 P1 으로 역행한다.

## 산출물 구성 (`01-domain.md`)

| 섹션 | 노드 | 반드시 담을 것 |
|---|---|---|
| 도메인 지도 | — | 도메인 목록 + 한 줄 책임. 표 하나로 전체가 보여야 한다 |
| 도메인별 상세 | `D-1`, `D-2`… | 책임, 핵심 개념(엔티티·용어), **경계 밖으로 미루는 것** |
| 도메인 간 관계 | — | 어느 도메인이 어느 도메인을 **부르는가**(방향 있는 화살표). 순환 금지 |
| 도메인별 요구사항 | `D-x` 하위 | 그 도메인이 만족해야 할 것 — P3 기능의 원료 |
| 유비쿼터스 용어 | — | 같은 것을 두 이름으로 부르지 않기 위한 사전 |

## 경계 판정 기준

| 물음 | 예 → | 아니오 → |
|---|---|---|
| 한 문장으로 책임을 말할 수 있나 | 도메인 1개 | 쪼개라 |
| 두 도메인이 같은 데이터를 **쓰기** 하나 | 소유자를 정하라(한쪽은 읽기) | 그대로 |
| 도메인 간 호출이 양방향인가 | 순환이다 — 상위 도메인 신설 또는 이벤트로 끊어라 | 그대로 |
| 팀/배포 단위로 갈릴 여지가 있나 | 경계 후보 | 합쳐도 된다 |

## 절차

```bash
harness node upsert --id D-1 --title "주문" --parent C-1 --anchor "01-domain.md#주문"
harness doc upsert --id DOC-P1 --path .harness/design/01-domain.md --phase P1 --refs D-1,D-2,D-3
harness doc url DOC-P1 https://claude.ai/public/artifacts/<id>   # 발행 먼저, URL 등록
harness doc submit DOC-P1                                        # artifact_url 없으면 거부된다
harness gate submit P1 --paths .harness/design/01-domain.md --evidence claimed
# → .harness/packets/P1.md 리뷰 패킷 자동 생성 → 사용자에게 제시하고 대기
harness doc approve DOC-P1     # 사용자가 gate approve P1 을 끝낸 뒤
harness phase set P2
```

## 승인은 사람이 한다

**`harness gate approve P1` 은 에이전트가 절대 치지 않는다.** 리뷰 패킷 경로와 아티팩트 URL 을
제시하고 사용자의 승인을 기다린다. 승인 없이는 `harness phase set P2` 가 거부된다 —
페이즈 전환은 "작업 완료"가 아니라 "산출물 승인"으로만 일어난다.

## 함정

- **`--parent` 를 빼먹으면 추적 체인이 끊긴다.** `C-x → D-x → F-x → 웨이브 → 커밋` 사슬이
  RTM 의 뼈대다. 부모 없는 도메인은 "왜 이게 있나"에 답하지 못한다.
- **P0 문서를 여기서 고치지 마라.** 컨셉이 틀렸다면 그건 개정이다 —
  `harness backtrack P0 --reason "<사유>"` 로 공식 역행한 뒤 고치고, 해당 노드는
  `harness node bump C-x` 로 버전을 올린다(참조 웨이브에 STALE 이 전파된다).
- **노드 id 를 나중에 바꾸지 마라.** 문서·웨이브·커밋 트레일러가 id 로 묶인다. 이름이 틀렸으면
  `harness node upsert --id D-1 --title "<새 제목>"` 으로 제목만 고친다(version 은 보존된다).
- **원장 손편집 금지.** `.harness/design/ledger.yaml` 직접 편집은 훅이 차단한다 —
  오직 `harness node` 명령으로만 바꾼다.
