---
name: phase-p0-concept
description: Use when 하네스 설계 트랙의 P0(CONCEPT) 를 구동할 때 — 제품 컨셉·비전·타깃·성공지표를 사용자 대화와 백데이터·첨부 문서로 확정하고 게이트에 올릴 때. 트리거: "컨셉 잡자", harness phase set P0, P0 게이트 제출, 00-concept.md, C-x 노드 등록, 첨부 문서 분석.
---

# P0 CONCEPT — 제품 컨셉 확정

## Overview

설계 트랙의 첫 페이즈. **사용자와의 대화가 1차 소스**이고 백데이터·첨부 문서는 근거 보강이다.
산출물은 `.harness/design/00-concept.md` 하나, 원장 노드는 `C-x`.

P0 는 상상하는 자리가 아니다 — 사용자가 말하지 않은 것은 **묻는다**. 추측으로 채운 컨셉은
P6 감사에서 "모호함"으로 전부 되돌아온다.

## 산출물 구성 (`00-concept.md`)

| 섹션 | 노드 | 반드시 담을 것 |
|---|---|---|
| 비전·문제 | `C-1` | 누구의 어떤 고통을 없애는가. 한 문단으로. |
| 타깃 사용자 | `C-2` | 1차/2차 사용자, 사용 맥락, 규모 가정 |
| 가치 제안 | `C-3` | 대안(경쟁·현상유지) 대비 무엇이 다른가 |
| 성공지표 | `C-4` | 측정 가능한 수치. "좋아진다" 금지 |
| 범위·비범위 | `C-5` | **안 만드는 것**을 적는다 — P1 도메인 경계의 입력 |
| 제약 | `C-6` | 규모·트래픽·팀·예산·운영 역량·규제 → **P2 ADR 추천의 입력** |

각 섹션 헤딩이 노드의 `--anchor` 가 된다. 제약(`C-6`)을 대충 쓰면 P2 기술 스택 ADR 이
근거 없는 취향 싸움이 된다.

## researcher 활용

첨부 문서·백데이터·경쟁 제품 조사는 `researcher` 서브에이전트(읽기 전용, sonnet)에 넘긴다.
넘길 때 **무엇을 판정해 달라는지** 명시하라 — "읽어봐"는 요약만 돌아온다.

```
researcher: 첨부 3건에서 (a) 명시된 사용자 유형 (b) 수치 목표 (c) 언급된 제약을
파일:줄 근거와 함께 추출. 문서에 없는 것은 "없음"으로 보고할 것.
```

## 절차

```bash
# 1. 노드 먼저 — 원장에 없는 id 를 문서가 참조하면 리뷰 패킷이 블로커로 잡는다
harness node upsert --id C-1 --title "비전·문제" --anchor "00-concept.md#비전-문제"
# 2. 문서 레지스트리 등록
harness doc upsert --id DOC-P0 --path .harness/design/00-concept.md --phase P0 \
  --refs C-1,C-2,C-3,C-4,C-5,C-6
# 3. claude.ai 아티팩트로 발행 → URL 등록 (artifact_url 없이는 submit 이 거부된다)
harness doc url DOC-P0 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P0
# 4. 게이트 제출 — 리뷰 패킷이 .harness/packets/P0.md 에 자동 생성된다
harness gate submit P0 --paths .harness/design/00-concept.md --evidence claimed
# 5. 사용자 승인 — 아래 "승인은 사람이 한다" 참조
# 6. 승인 뒤
harness doc approve DOC-P0
harness phase set P1
```

## 승인은 사람이 한다

**`harness gate approve P0` 를 에이전트가 대신 치지 마라.** 이 명령은 의도적으로 권한
다이얼로그를 타도록 설계됐고, 승인의 최종 클릭은 언제나 사람이다.
에이전트가 할 일은 여기까지다:

1. `.harness/packets/P0.md` 리뷰 패킷 경로와 아티팩트 URL 을 제시한다.
2. 패킷의 블로커 목록이 비었는지 확인해 보고한다.
3. 사용자가 승인할 때까지 **기다린다**. 승인 없이 `harness phase set P1` 은 거부된다.

## 함정

- **`doc submit` 은 `draft` 상태에서만 통과한다.** 이미 submitted 인 문서를 고쳐 다시 올리려면
  `harness doc revise DOC-P0` 로 새 버전(v+1, draft)을 만든 뒤 발행·제출한다. artifact_url 은
  개정본이 물려받으므로 같은 URL 로 재발행하면 된다.
- **제출과 승인 사이에 문서를 고치면 승인이 거부된다** — 해시가 어긋난다. 고쳤으면
  `harness gate submit P0` 을 다시 쳐라(재제출은 승인된 게이트도 다시 연다).
- **설계 트랙에서 소스 코드 Write/Edit 는 훅이 물리 차단한다.** 허용 경로는 `.harness/`·`docs/`·
  루트 `*.md` 다. P0 에서 코드를 만질 일은 없다 — 막혔다면 페이즈가 아니라 판단이 틀린 것이다.
- **근거 등급은 `claimed`.** 설계 트랙은 `claimed`/`code` 로 충분하다. `measured` 는 출하
  트랙(P10~P12) 전용이며 여기서 쓸 근거가 없다.
