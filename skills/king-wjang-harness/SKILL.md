---
name: king-wjang-harness
description: Use when a project needs king-wjang-harness 프로세스 규율을 적용하거나 운전할 때 — 리포에 활성화(harness init), 페이즈·설계 원장·웨이브 구동, 턴 로그 정산, 그리고 PreToolUse/Stop 훅이 소스 쓰기를 deny 하거나 세션 종료를 block 했을 때 대처. 트리거: "하네스 걸어줘", harness init, 페이즈 전환, 웨이브 생성/정산, node bump, doctor, deny/block 대처, 미정산 종료.
---

# king-wjang-harness 운영

## Overview

`harness` CLI로 **설계→구축→출하** 프로세스 상태를 운전하는 매뉴얼. 강제(설계 트랙 소스 쓰기 차단·미정산 종료 차단)는 **훅이 자동 수행**한다 — 이 스킬은 CLI를 올바로 몰고, deny/block을 만났을 때 무엇을 할지 안내한다.

**철칙: `.harness/state.json`·`events.jsonl`·`design/ledger.yaml`을 손편집하지 마라.** 오직 `harness` 명령으로만 바꾼다(저널이 진실의 원천, 손편집은 상태를 거짓으로 만든다 — 훅도 차단한다).

## When to use / not

- **쓴다**: 프로젝트에 하네스를 걸 때, 페이즈/노드/웨이브를 조작할 때, 훅 deny/block을 만났을 때, 상태·복구를 볼 때.
- **안 쓴다**: `.harness/` 없는 프로젝트의 일반 작업(훅은 완전 침묵) / king-wjang-harness **자체 개발**(→ `verify` 스킬).

## 적용 (부트스트랩)

**대상 프로젝트 루트에서** 실행한다:

```bash
harness init                                  # .harness/ 생성 — 여기서부터 훅 활성
harness phase set P0                          # 설계 트랙 진입 (v0 임시 — 게이트 구현 후 대체)
harness node upsert --id F-1 --title "기능명"  # 설계 원장에 노드 등록
```

⚠ **king-wjang-harness 그 자신의 dev repo에는 init 하지 마라** — 자기참조로 자기 소스 편집이 설계 트랙에서 막힌다.

## 명령 퀵 레퍼런스

| 명령 | 하는 일 |
|---|---|
| `harness init` | `.harness/` 상태 저장소 생성 |
| `harness status` | 현재 상태 JSON (미초기화면 init 안내) |
| `harness phase set <P0..P12>` | 페이즈 전환 |
| `harness node upsert --id <id> --title <제목> [--status draft\|approved\|stale] [--parent <id>] [--anchor <a>]` | 설계 원장 노드 upsert (재실행 시 version·미지정 필드 보존) |
| `harness node bump <id>` | 노드 개정 → version++·status=stale + 참조 웨이브 STALE 전파 |
| `harness wave create [--milestone <m>] [--goal <g>] [--refs <id,id>] [--accept <c,c>]` | 웨이브 생성 → **웨이브 id(wave-001…) 출력** |
| `harness wave activate <wave-id>` | 웨이브 활성화(state.activeWave 갱신) |
| `harness wave update "<한 일, 다음 할 일>"` | 턴 로그 정산 (빈 로그 거부) |
| `harness wave complete` | 웨이브 완료 (UX 노드 참조 시 시각 증적 필요 — 아래 함정) |
| `harness wave list` | 웨이브 목록 JSON |
| `harness backtrack <phase> --reason "<사유>"` / `harness backtrack clear` | 구축·출하 트랙에서 설계로 공식 역행 / 역행 종료 |
| `harness doctor [--repair [--force]]` | 무결성 검사·저널 재생 복구 (JSON: `ok/repaired/refused/issues/warnings`) |

`harness`엔 `--help`가 없다 — 이 표가 유일한 명령 출처다. 훅 이벤트(`harness hook <session-start\|pre-tool\|post-tool\|stop>`)는 **플러그인이 자동 호출**한다 — 직접 칠 일 없다(항상 exit 0).

## 페이즈 모델

| 트랙 | 페이즈 | 성격 |
|---|---|---|
| 설계 | **P0–P6** | 소스 쓰기·배포성 Bash 차단. 허용: `.harness/`·config 허용 프리픽스·루트 `*.md` |
| 구축 | **P7–P9** | 소스 자유. 단 설계 문서 직접 수정은 backtrack 필요 |
| 출하 | **P10–P12** | 구축과 동일 규율 |

## 훅 deny/block 대처

| 만난 것 | 뜻 | 할 일 |
|---|---|---|
| `deny: … 소스 코드를 쓸 수 없다 (설계 트랙)` | P0–P6에서 소스 편집 시도 | 설계 산출물(`docs/`·루트 `*.md`)을 먼저 완성, 또는 구축 페이즈면 `harness phase set P7` |
| `deny: … harness 명령으로만 변경할 수 있다` | 코어 3파일 손편집 시도 | 손편집 말고 해당 `harness` 명령으로 상태 변경 |
| `deny: … 설계 문서를 직접 수정할 수 없다` | 구축·출하 트랙에서 `.harness/design/` 편집 | `harness backtrack <페이즈> --reason "<사유>"`로 공식 역행 후 수정 |
| `deny: 배포성 명령(…)` | 설계 트랙에서 배포성 Bash | 구축 트랙으로 전환 후 실행 |
| `block: 턴 로그가 … 갱신되지 않았다` (종료 막힘) | 활성 웨이브에 작업했는데 미정산 | `harness wave update "<한 일, 다음 할 일>"` 후 종료. 정말 사소한 턴이면 사유 한 줄 보고하고 종료 가능 |

## 함정

- **`wave create --refs`의 id는 원장에 먼저 있어야 한다** — 없으면 거부. `harness node upsert`로 선등록. 여러 개는 쉼표 구분(`--refs F-1,F-2`, 공백 없이).
- **UX 게이트**: `UX-` 프리픽스 노드를 참조하는 웨이브는 `.harness/evidence/<wave-id>/`에 **size>0 파일**(디렉토리는 무시)이 있어야 `complete`된다. 증적을 넣는 harness 명령은 없다 — 그 경로에 **직접 파일**(스크린샷 등)을 만들어라. 손편집 금지는 코어 3파일뿐이라 증적 추가는 규율 위반이 아니다.
- **훅 실패는 전부 exit 0으로 흡수된다** — 하네스가 조용히 꺼진 걸 알려면 `.harness/.runtime/hook-errors.log`와 `harness doctor`를 보라.
- **state.json 손상 감지 시** 훅이 저널 재생으로 동작하며 경고를 낸다 → `harness doctor --repair`로 정산.
- **소스 파이프 뒤 `$?`는 파이프 마지막 명령의 코드다** — CLI 종료코드를 볼 땐 파이프 없이 실행.

## 검증

king-wjang-harness **자체를 개발**하며 변경을 검증할 때는 `verify` 스킬(샌드박스 init·훅 stdin 구동 레시피)을 쓴다.
