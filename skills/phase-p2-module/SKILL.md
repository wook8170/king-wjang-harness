---
name: phase-p2-module
description: Use when 하네스 설계 트랙의 P2(MODULE) 를 구동할 때 — 모듈 경계·인터페이스·의존 그래프를 확정하고 기술 스택·운영/배포/확장 두 결정 포인트를 ADR 로 매듭지어 게이트에 올릴 때. 트리거: "모듈 나누자", harness phase set P2, P2 게이트 제출, 02-module.md, M-x 노드, ADR 제안, 스택 결정, 배포 방식 결정.
---

# P2 MODULE — 모듈 설계 + 결정 포인트 2개

## Overview

도메인(`D-x`)을 **구현 단위 모듈**(`M-x`)로 떨어뜨리고, 이 페이즈에서만 할 수 있는
결정 두 개를 ADR 로 영구 기록한다. 산출물은 `.harness/design/02-module.md`.

| 결정 포인트 | ADR | 무엇을 정하나 |
|---|---|---|
| 기술 스택 | `ADR-1` | 언어·런타임·프레임워크·ORM·테스트 하네스 |
| 운영·배포·확장 | `ADR-2` | 호스팅·CI/CD·스케일링·관측·백업/DR·비용 |

두 ADR 은 **P7 뼈대·P10 체크·P11 배포 명령을 파라미터화**한다. 여기서 미루면 나중에
바꿀 때 backtrack + STALE 전파 비용을 문다.

## 산출물 구성 (`02-module.md`)

| 섹션 | 노드 | 반드시 담을 것 |
|---|---|---|
| 모듈 지도 | `M-x` | 모듈 목록 + 소속 도메인(`--parent D-x`) + 한 줄 책임 |
| 모듈 인터페이스 | `M-x` 하위 | 모듈이 **밖에 내주는 것**만. 내부 구현은 쓰지 않는다 |
| 의존 그래프 | — | 방향 있는 간선. 순환은 여기서 잡는다(P6 가 아니라) |
| 결정 근거표 | `ADR-1`,`ADR-2` | 선택지별 트레이드오프 표 — **CLI 가 못 담는 부분이 여기 산다** |

## ADR 흐름

**추천 패킷 → 사용자 채택 또는 재정의 → 기각 사유 필수.** 순서를 건너뛰지 마라.

```bash
# 1. 제안 — 선택지 2~4개(1개는 결정이 아니라 통보다). --recommend 는 선택지 id 중 하나
harness adr propose --id ADR-1 --phase P2 --question "기술 스택을 무엇으로 갈 것인가" \
  --option a:"Next.js + Prisma + Postgres" \
  --option b:"Fastify + Drizzle + Postgres" \
  --option c:"Go + sqlc" \
  --recommend a
# → 추천 패킷이 stdout 으로 렌더된다. 트레이드오프 표와 함께 사용자에게 제시하고 답을 기다린다.

# 2. 채택 — 채택하지 않은 **모든** 선택지에 기각 사유가 있어야 통과한다
harness adr decide ADR-1 --choose a --rationale "팀 숙련도·풀스택 단일 배포·P0 C-6 예산 제약" \
  --reject b:"운영 인력 없이 BFF 분리 유지 불가" --reject c:"팀에 Go 경험 0"

harness adr show ADR-1     # 기록 확인
harness adr list           # 전체 목록
```

- **사용자 재정의**: `--choose` 에 선택지 id 가 아닌 자유 문자열을 넣으면 `custom` 선택지로
  흡수되어 기록된다. 이때 **원래 선택지 전부**에 `--reject` 사유가 필요하다.
- `adr propose` 는 원장 노드 `ADR-x` 를 자동 등록한다 — `harness node upsert` 를 따로 칠 필요 없다.
- 결정을 바꾸려면 덮어쓰지 말고 `harness adr revise ADR-1 --question "<새 질문>"` — version++ 과
  STALE 전파가 함께 일어난다.

## 절차

```bash
harness node upsert --id M-1 --title "주문 API" --parent D-1 --anchor "02-module.md#주문-api"
harness doc upsert --id DOC-P2 --path .harness/design/02-module.md --phase P2 \
  --refs M-1,M-2,ADR-1,ADR-2
harness doc url DOC-P2 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P2          # artifact_url 없이는 거부된다
harness gate submit P2 --paths .harness/design/02-module.md --evidence claimed
# → .harness/packets/P2.md 제시 → 사용자 승인 대기
harness doc approve DOC-P2
harness phase set P3
```

## 승인은 사람이 한다

**`harness gate approve P2` 는 에이전트가 치지 않는다.** 두 ADR 이 `accepted` 인지,
리뷰 패킷에 블로커가 없는지 확인해 보고하고 기다린다.

## 함정

- **`--option` 은 `<id>:<제목>` 만 담는다 — pros/cons·트레이드오프를 CLI 로 넣을 방법이 없다.**
  비교표는 `02-module.md` 의 "결정 근거표" 섹션에 쓰고, 패킷 제시 때 그 섹션을 함께 보여라.
  ADR 기록만 보면 왜 골랐는지는 남지만 무엇과 비교했는지의 깊이는 문서에 있다.
- **제목에 공백이 있으면 따옴표로 감싼다** — `--option a:"Next.js + Prisma"`. 안 감싸면
  다음 토큰이 잘려 나간다.
- **같은 id 로 재제안하면 거부된다** — 이미 있는 ADR 은 덮어쓸 수 없다. 개정은 `adr revise`.
- **`adr decide` 는 `proposed` 상태에서만 통과한다.** 이미 결정된 것을 다시 결정하려 하면 막힌다.
- **스택이 정해졌다고 코드를 만들지 마라.** P6 승인 전까지 소스 Write/Edit 는 훅이 차단한다.
