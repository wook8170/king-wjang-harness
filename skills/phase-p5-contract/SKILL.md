---
name: phase-p5-contract
description: Use when 하네스 설계 트랙의 P5(CONTRACT) 를 구동할 때 — DB 스키마와 API 계약(엔드포인트·타입·에러 규약)을 SCH-x/API-x 노드로 확정해 게이트에 올릴 때. 트리거: "스키마 짜자", "API 계약", harness phase set P5, P5 게이트 제출, 05-contract.md, SCH-x, API-x, 에러 규약.
---

# P5 CONTRACT — 스키마 + API 계약

## Overview

설계 트랙의 마지막 **생산** 페이즈(P6 는 감사). 여기서 정한 계약이 P7 뼈대와 P8 구현의
입력이 된다. 산출물은 `.harness/design/05-contract.md`.

**계약은 구현이 아니다.** 마이그레이션 SQL 을 짜거나 라우터 파일을 만들지 마라 —
P6 승인 전까지 소스 Write/Edit 는 훅이 물리 차단한다. 여기서 쓰는 것은 문서다.

## 원장 노드

| 프리픽스 | 무엇 | 부모 |
|---|---|---|
| `SCH-x` | 테이블/엔티티 1개 | `--parent D-x` (소유 도메인 — P1 에서 정한 그 소유자) |
| `API-x` | 엔드포인트 1개 | `--parent F-x` (그 API 를 필요로 하는 기능) |

한 기능이 API 셋을 쓰면 `API-3,API-4,API-5` 셋 다 `--parent F-12`.

## 스키마 (`SCH-x`) 최소 구성

| 항목 | 규칙 |
|---|---|
| 필드 | 이름·타입·nullable·기본값. 타입은 ADR-1 의 스택 타입 체계로 쓴다 |
| 키·인덱스 | PK, 유니크 제약, 조회 패턴에 근거한 인덱스 |
| 관계 | 카디널리티 + 삭제 정책(cascade/restrict) 명시. "나중에 정함" 금지 |
| 소유 도메인 | 쓰기 권한을 가진 도메인 하나. 나머지는 읽기 |
| 수명주기 | 소프트 삭제 여부, 보존 기간, PII 여부 |

## API 계약 (`API-x`) 최소 구성

| 항목 | 규칙 |
|---|---|
| 메서드·경로 | `POST /orders` — 경로 규칙은 문서 상단에 한 번 선언하고 전체가 따른다 |
| 요청·응답 타입 | 필드 단위. `any`·"객체" 금지 |
| 에러 규약 | 코드 체계 + HTTP 상태 매핑. **전 엔드포인트 공통 규약을 먼저 쓰고** 개별 예외만 나열 |
| 인가 | 누가 부를 수 있나 (P0 `C-2` 의 역할로) |
| 멱등성 | 재시도 안전 여부. 결제·생성 계열은 필수 명시 |

에러 규약을 엔드포인트마다 따로 쓰면 P6 감사가 "논리 정합성" 으로 잡는다 — 공통 표 하나.

## 절차

```bash
harness node upsert --id SCH-1 --title "orders" --parent D-1 --anchor "05-contract.md#sch-1-orders"
harness node upsert --id API-3 --title "POST /orders" --parent F-12 --anchor "05-contract.md#api-3-post-orders"
harness doc upsert --id DOC-P5 --path .harness/design/05-contract.md --phase P5 \
  --refs SCH-1,SCH-2,API-3,API-4
harness doc url DOC-P5 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P5          # artifact_url 없이는 거부된다
harness gate submit P5 --paths .harness/design/05-contract.md --evidence claimed
# → .harness/packets/P5.md 제시 → 사용자 승인 대기
harness doc approve DOC-P5
harness phase set P6
```

## 승인은 사람이 한다

**`harness gate approve P5` 는 에이전트가 치지 않는다.** 리뷰 패킷과 아티팩트 URL 을 제시하고
기다린다. 승인 없이는 `harness phase set P6` 이 거부된다.

## 함정

- **커버리지를 직접 확인하라.** 모든 `F-x` 가 최소 하나의 `API-x` 또는 `UX-x` 로 실현되는지,
  모든 `UX-x` 가 필요한 데이터를 부를 API 를 가졌는지. `harness report rtm` 이 미커버 구간을
  표로 보여준다 — P6 에 넘기기 전에 여기서 본다.
- **P1~P4 문서를 손대지 마라.** 계약을 쓰다 상위 설계의 구멍을 발견하면 그건 backtrack 대상이다:
  `harness backtrack P3 --reason "<사유>"` → 수정 → `harness node bump F-x` → 재제출 → `backtrack clear`.
- **`gate submit` 은 문서 파일이 실제로 존재해야 통과한다** — `--paths` 의 파일을 못 읽으면
  해시 계산 단계에서 거부된다. 경로 오타를 여기서 잡아라.
- **타입을 스택 문법으로 못 박지 마라.** 계약은 언어 중립 서술 + ADR-1 스택 매핑 한 줄이면 된다.
  P7 이 이 문서에서 코드를 생성한다.
