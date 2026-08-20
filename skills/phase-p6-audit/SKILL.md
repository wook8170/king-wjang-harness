---
name: phase-p6-audit
description: Use when 하네스 설계 트랙의 P6(AUDIT) 를 구동할 때 — design-auditor 로 P0~P5 전체를 재감사하고 발견을 해당 페이즈로 역행 수정한 뒤 최종 설계 승인을 받을 때. 트리거: "설계 감사", harness phase set P6, P6 게이트 제출, audit-rN.md, 4렌즈 감사, backtrack, 설계 최종 승인, 구현 시작 전.
---

# P6 AUDIT — 설계 총감사

## Overview

**만든 자가 검증하지 않는다.** 메인 세션이 P0~P5 를 썼으니, 감사는 읽기 전용·신규 컨텍스트의
`design-auditor` 서브에이전트가 한다. 산출물은 `.harness/audit/audit-rN.md`
(라운드별 — 1차 감사는 `audit-r1.md`, 수정 후 재감사는 `audit-r2.md`).

**P6 게이트 승인 전까지 소스 코드 Write/Edit·빌드·배포 명령은 훅이 물리 차단한다.**
"이제 좀 만들어 보면서 확인하자" 는 통하지 않는다 — 여기를 통과해야 P7 로 간다.

## 4렌즈 병렬 감사

`design-auditor` 를 **렌즈당 하나씩, 한 번에 디스패치**한다. 렌즈를 섞으면 한 관점이 다른
관점을 잡아먹는다.

| 렌즈 | 묻는 것 |
|---|---|
| 논리 정합성 | 노드 사슬(`C→D→M→F→UX/API/SCH`)이 끊기거나 모순되는 곳. 순환 의존. 소유권 충돌 |
| 모호함 | 두 사람이 다르게 읽을 수 있는 문장. 검증 불가능한 수용 기준 |
| 블로커·실현성 | ADR 제약(예산·인력·규제) 대비 불가능한 것. 외부 의존·자격증명 공백 |
| UX 워크스루 | 시나리오를 실제로 따라 걸어본다 — 도달 못 하는 화면, 없는 API 를 부르는 UX |

**모든 발견은 원장 노드 ID 또는 `파일:줄` 을 달아야 한다.** 근거 없는 지적은 채택하지 않는다.
두 렌즈 이상에서 교차 검증된 발견을 우선 채택한다.

## 감사 리포트 (`audit-rN.md`)

| 섹션 | 내용 |
|---|---|
| 판정 | `통과` / `수정 필요` — 하나만 |
| 발견 | 심각도(HIGH/MED/LOW) × 근거(노드 id 또는 파일:줄) × 귀속 페이즈 × 제안 |
| 교차 검증 | 어느 렌즈들이 같은 것을 짚었나 |
| 미해결 | 감사가 판정하지 못한 것과 그 이유 (숨기지 않는다) |

## 발견 → 역행 → 재감사

```bash
harness backtrack P3 --reason "F-12 수용 기준이 검증 불가 (audit-r1 HIGH-2)"
# → 해당 페이즈 문서 수정
harness node bump F-12                 # 개정된 노드 → version++ · STALE 전파
harness doc revise DOC-P3              # 새 버전(draft) 생성, artifact_url 승계
# → 같은 URL 로 아티팩트 재발행 → harness doc submit DOC-P3
harness gate submit P3 --paths .harness/design/03-feature.md --evidence claimed
# → 사용자 재승인 → harness doc approve DOC-P3
harness backtrack clear
# → design-auditor 재디스패치 → audit-r2.md
```

발견이 여러 페이즈에 걸치면 **가장 상위 페이즈부터** 고친다. P1 을 고치면 P3 가 따라 바뀐다.

## 절차 (감사 통과 후)

```bash
harness doc upsert --id DOC-P6 --path .harness/audit/audit-r2.md --phase P6 --refs F-12,UX-7
harness doc url DOC-P6 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P6              # artifact_url 없이는 거부된다
# P6 는 설계 전체의 최종 승인이다 — 심사 대상에 설계 문서 전부를 넣어 해시를 고정한다
harness gate submit P6 --evidence claimed --paths .harness/audit/audit-r2.md,\
.harness/design/00-concept.md,.harness/design/01-domain.md,.harness/design/02-module.md,\
.harness/design/03-feature.md,.harness/design/04-experience.md,.harness/design/05-contract.md
# → .harness/packets/P6.md 제시 → 사용자 최종 설계 승인 대기
harness doc approve DOC-P6
harness phase set P7                   # 여기서부터 소스 쓰기가 열린다
```

제출 전에 `harness report rtm` 과 `harness gate sweep` 을 돌려라 — 미커버 구간과
변조된 승인 문서를 승인 요청 **전에** 잡는다.

## 승인은 사람이 한다

**`harness gate approve P6` 는 에이전트가 절대 치지 않는다.** 이건 "설계 끝, 만들기 시작"
버튼이고 되돌리는 비용이 가장 크다. 감사 판정·미해결 항목·RTM 미커버 구간을 정직하게 요약해
제시하고, 사용자가 직접 승인하게 하라.

## 함정

- **감사 에이전트에게 수정 권한을 주지 마라.** `design-auditor` 는 읽기 전용이다. 발견을
  고치는 것은 메인 세션의 일이며, 고친 자가 다시 감사하면 확증 편향이 그대로 돌아온다.
- **재감사 없이 통과시키지 마라.** `수정 필요` 판정을 받고 고쳤으면 반드시 새 라운드
  (`audit-r2.md`)를 돈다. 라운드 번호를 재사용하면 무엇을 언제 봤는지 사라진다.
- **`--paths` 에 파일이 여러 개면 쉼표 구분·공백 없이.** 줄바꿈이 필요하면 `\` 로 잇되
  쉼표 뒤에서 끊어라. 하나라도 못 읽으면 제출 자체가 거부된다.
- **`gate approve` 는 제출 이후 파일이 바뀌면 거부된다.** 승인 요청 후 문서를 손보지 마라 —
  손봤으면 재제출이다.
- **역행 중에는 `.harness/design/` 편집이 열린다.** 끝나면 `harness backtrack clear` 를 반드시
  쳐라. 열어 둔 채 P7 로 가면 구축 트랙의 설계 문서 보호가 풀린 상태로 남는다.
