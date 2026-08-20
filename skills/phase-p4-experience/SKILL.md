---
name: phase-p4-experience
description: Use when 하네스 설계 트랙의 P4(EXPERIENCE) 를 구동할 때 — 디자인 기반 결정(ADR)을 매듭짓고 UX 시나리오·디자인 시스템 4계층·Claude Design 캔버스·인터랙티브 HTML 정본을 만들어 게이트에 올릴 때. 트리거: "화면 설계하자", harness phase set P4, P4 게이트 제출, 04-experience.md, UX-x 노드, DS-TOK/PRIM/COMP/DCOMP, 디자인 토큰, 디자인 시스템 정본.
---

# P4 EXPERIENCE — UX + 디자인 시스템

## Overview

설계 트랙에서 가장 무거운 페이즈. 결정 하나(ADR-3)와 산출물 세 벌을 낸다.

| 산출물 | 경로 | 성격 |
|---|---|---|
| UX·디자인 문서 | `.harness/design/04-experience.md` | 사람이 읽는 정본 |
| 인터랙티브 HTML 정본 | `.harness/design/design-system.html` | **P4 게이트의 실제 심사 대상** |
| 토큰 원천 | `.harness/design/tokens/design-tokens.json` | 시각 톤의 단일점 |

## 결정 포인트: 디자인 기반 (ADR-3)

```bash
harness adr propose --id ADR-3 --phase P4 --question "디자인 기반을 무엇으로 갈 것인가" \
  --option lib:"오픈소스 라이브러리 + 토큰 오버레이" \
  --option own:"완전 자체 구축" \
  --option hybrid:"하이브리드(headless 컴포넌트 + 자체 스타일)" \
  --recommend lib
harness adr decide ADR-3 --choose lib --rationale "<근거>" \
  --reject own:"<사유>" --reject hybrid:"<사유>"
```

어느 길을 골라도 **토큰 단일점 불변식은 같다**. 라이브러리를 고르면 M0 = 설치 → 토큰 브리지 →
갤러리 검증. 선택지별 트레이드오프 표는 `04-experience.md` 에 쓴다(CLI 는 제목만 담는다).

## 원장 노드

| 프리픽스 | 무엇 | 예 |
|---|---|---|
| `UX-x` | 화면/시나리오 1개 | `UX-7 결제 화면` — `--parent F-x` |
| `DS-TOK-x` | L1 시맨틱 토큰 | 색·타이포·간격·radius·그림자·모션·브레이크포인트 |
| `DS-PRIM-x` | L2 프리미티브 | Box·Stack·Grid·Text·Icon |
| `DS-COMP-x` | L3 기본 컴포넌트 | Button·Input·Card·Modal·Table |
| `DS-DCOMP-x` | L4 도메인 컴포넌트 | 제품 고유 — `--parent D-x` 또는 `F-x` |

참조 방향은 **아래로만**. L3 이 L4 를 알면 계층이 깨진 것이다.

## 레이아웃 템플릿

app-shell·list-detail·form-page·dashboard 등 제품에 맞는 세트를 P4 에서 **승인**한다.
모든 `UX-x` 는 템플릿 1개를 선언한다. 템플릿에 없는 구조가 필요하면 그건 템플릿 신설이고,
템플릿 신설은 설계 개정이다.

## Claude Design 캔버스

`design` 스킬로 캔버스를 만든다. **아트보드 1장 = UX 노드 1개**, 명명은 `"UX-7 결제 화면"`.
디자인 시스템 전용 아트보드(토큰 시트·컴포넌트 갤러리)는 별도로 둔다.

캔버스 URL 을 담는 전용 필드는 코어에 없다 — `04-experience.md` 의 해당 UX 섹션에 URL 을 적고
노드의 `--anchor` 로 그 섹션을 가리켜라. 불일치 시 **HTML 정본이 우선**한다(캔버스는 시각 표현).

## 인터랙티브 HTML 정본

게이트 심사 대상은 "그림"이 아니라 **클릭되는 자기완결 HTML** 이다. 담을 것:

- 토큰 CSS 변수 블록 — 이 블록이 곧 `design-tokens.json` 의 원천(동일물)
- 컴포넌트 **전 상태** 갤러리 (default/hover/focus/active/disabled/error)
- 대표 화면 2~3장 페이지 데모 (승인된 레이아웃 템플릿 위에)
- 동작하는 인터랙션: 모달·탭·폼 검증 상태·라이트/다크 토글

`Artifact` 도구로 발행한다. 외부 요청은 CSP 로 막히니 CSS·JS·이미지는 전부 인라인/`data:` URI.

## 절차

```bash
harness node upsert --id UX-7 --title "결제 화면" --parent F-12 --anchor "04-experience.md#ux-7-결제-화면"
harness node upsert --id DS-TOK-1 --title "색 토큰" --anchor "04-experience.md#토큰"
harness doc upsert --id DOC-P4 --path .harness/design/04-experience.md --phase P4 \
  --refs UX-7,DS-TOK-1,DS-COMP-1,ADR-3
harness doc upsert --id DOC-P4-DS --path .harness/design/design-system.html --phase P4 \
  --refs DS-TOK-1,DS-PRIM-1,DS-COMP-1,DS-DCOMP-1
harness doc url DOC-P4 https://claude.ai/public/artifacts/<id>
harness doc url DOC-P4-DS https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P4 && harness doc submit DOC-P4-DS    # artifact_url 없이는 둘 다 거부된다
harness gate submit P4 --evidence claimed \
  --paths .harness/design/04-experience.md,.harness/design/design-system.html,.harness/design/tokens/design-tokens.json
# → .harness/packets/P4.md 제시 → 사용자 승인 대기
harness doc approve DOC-P4 && harness doc approve DOC-P4-DS
harness phase set P5
```

## 승인은 사람이 한다

**`harness gate approve P4` 는 에이전트가 치지 않는다.** HTML 정본 아티팩트 URL 을 먼저 주고,
사용자가 실제로 눌러 보게 하라. P4 는 눈으로 보고 승인하는 게이트다.

## 함정

- **`UX-x` 를 참조하는 웨이브는 시각 증적 없이 `complete` 되지 않는다.** P8~P9 에서
  `.harness/evidence/<wave-id>/` 에 size>0 파일(2x 스크린샷)이 있어야 한다. 여기서 UX 노드를
  만든다는 건 나중 웨이브에 그 의무를 거는 일이다 — 화면 하나에 노드 하나, 남발 금지.
- **raw 값 금지는 P4 부터 시작된다.** HTML 정본 안에서도 hex·px 매직넘버를 컴포넌트에 직접
  쓰지 마라 — 전부 CSS 변수 참조. `text.primary` 는 되고 `blue.500` 은 안 된다.
- **토큰 원천은 파일 1개다.** CSS 변수·TS 상수·Tailwind config 는 전부 생성물이며 수동 복제 금지.
- **P4 승인 후 디자인 시스템 디렉토리는 동결된다.** 원장에 없는 컴포넌트 신설 시도는
  PreToolUse 가 잡는다 — 필요하면 backtrack 으로 정식 개정하라.
- 캔버스 동기화·게이트 피드백 수집 명령은 아직 코어에 없다 — 캔버스 변경은 **손으로**
  `harness node bump UX-x` 를 쳐서 개정으로 승격시켜야 STALE 이 전파된다.
