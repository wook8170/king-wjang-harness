# 수정 라운드 1 — 확정 결함 16건 (2026-08-21)

- 대상: `06-security.md` [SEC-49][SEC-50][SEC-51][SEC-25][SEC-28] · `08-logic.md` [LOGIC-21] ·
  `11-ops.md` [OPS-20] · `01-features.md` [FEAT-22][FEAT-23] · `02-backend.md` [UX-24][API-27][API-29][API-30] ·
  `05-perf.md` [PERF-26] · `10-deploy.md` [SHIP-52][SHIP-31]
- 원칙: 근본 원인 수정 · 외과적 변경 · 건별 회귀 테스트 · 수정 후 실측
- 커밋 `5f3b112` · `0dfd9ca` · `1eb0a7f`(이벤트 타입) — 테스트 584 → 626 green ×3, tsc 0

---

## [SEC-50] BLOCKER — 설계 트랙 소스 쓰기가 Bash 로 무력화

**근본 원인** 훅은 Bash 를 매칭하고 명령을 읽지만 **배포 명령 목록만** 봤다
(`core/src/hook.ts:395`). 파일 쓰기 판정이 `Write`/`Edit` 표면에만 있었다.
「우회하려는 자」의 문제가 아니라 **막힌 모델이 자연히 가는 다음 경로**가 비어 있었던 것이다.

**무엇을 어떻게 고쳤나** `core/src/bashwrite.ts` 신설 — 셸 명령에서 쓰기 대상을 추출한다
(리다이렉트·heredoc·`tee`·`touch`·`sed -i`·`cp`/`mv`/`ln`/`dd`/`rm`). 추출한 대상은
**`Write` 와 같은 판정 함수** `judgeWritePath`(`core/src/hook.ts`)로 보낸다 — 규칙을 두 벌로
두면 한쪽만 강화돼 갈린다. 이번 사고가 정확히 그것이었다.

의도한 비대칭 하나: **루트 밖 Bash 쓰기는 통과시킨다.** `npm test > /tmp/out.log` 를 막으면
사람이 하네스를 꺼버리고, 그러면 방어가 0이 된다. 지켜야 할 것은 이 프로젝트의 소스다.

**회귀 테스트** `core/test/bashwrite.test.ts` — 추출 11건 + 판정 10건.
**재측정** 리다이렉트·heredoc·touch·cp 전부 deny, 구축 트랙·루트 밖·docs 는 그대로 허용.

## [SEC-49] BLOCKER — 저널 위조로 사람 없이 게이트가 열림

**근본 원인** 같은 뿌리. `events.jsonl` 은 진실의 원천인데 평문 append-only 파일이고
Bash 쓰기가 검사되지 않았다. `echo '{"type":"phase-set",...}' >> .harness/events.jsonl`
+ `doctor --repair` 로 페이즈가 P7 이 되고, `gate-approved` 를 같은 방식으로 넣으면
**사람이 클릭한 적 없는 승인 도장**이 찍혔다.

**무엇을 어떻게 고쳤나** 코어 파일(`state.json`·`events.jsonl`·`ledger.yaml`) 판정을
페이즈 무관으로 Bash 표면에도 적용. 구문을 못 읽는 경우(`python -c "open(...)"`)를 위해
「코어 파일 언급 + 변형 명령」 안전망을 뒀다. **조회(`cat`·`grep`)는 막지 않는다** — 저널을
읽어 디버깅하는 것은 정당하고 그것까지 막으면 하네스를 끈다.

**재측정** `evidence/round1-verify.log` — 위조 시퀀스 전건 deny.

## [SEC-51] HIGH — 코어 파일 보호가 Write/Edit 표면에만

위와 같은 수정으로 함께 닫혔다. `echo x > .harness/state.json`·`sed -i`·`rm` 전부 deny.

## [SHIP-52] HIGH — `phase set --force` 자기해제

**고친 방법** ① 훅이 에이전트의 Bash 실행을 deny(인라인 env 우회도 함께 차단 — 인라인으로
켤 수 있으면 잠금이 아니다) ② CLI 자체도 `HARNESS_ALLOW_FORCE=1` 을 요구한다(훅을 타지
않는 경로 대비). **사람이 자기 터미널에서 env 를 켜는 순간이 곧 「사람의 최종 클릭」**이다.

## [OPS-20] HIGH — 게이트 승인 후 doctor 가 영구 빨강

**근본 원인** 상태와 저널이 **각자 `new Date()` 를 찍었다**(`gate.ts:134` ↔ `events.ts:25`).
밀리초가 갈려 `doctor` 가 승인 이후 항상 `gates 불일치` 를 보고했다.
**시각 주입 규율이 `usage`·`migrate`·`tokens` 에는 적용돼 있고 `gate` 에는 없던** 부분 적용이 뿌리다.

**고친 방법** 저널을 먼저 쓰고 **그 이벤트의 `ts` 를 상태에도 그대로** 쓴다.
**재측정** 승인 후 `doctor` → `ok:true`, `issues: []`.

## [LOGIC-21] HIGH — `doctor --repair` 가 근거 등급을 삭제

**근본 원인** 재생 리듀서(`events.ts:74~`)가 `gate-submitted`/`gate-approved` 의 `evidence` 를
버렸다. 저널 이벤트는 그 값을 싣고 있는데도. 「저널이 진실의 원천」은 *저널에 있는 것은 전부
되살아난다*까지 포함한다.

**재측정** `--evidence measured` 로 승인 → `doctor --repair` → `evidence`·`submittedAt` 보존.

## [FEAT-22] HIGH — `harness trace` 미구현

스펙 §125·§200 이 정의하고 `agents/wave-verifier.md:31` 이 지시하는데 CLI 에 없었다(MCP 전용).
**고친 방법** 조인 규칙을 `report.traceNode` 한 벌로 뽑고 CLI·MCP 가 **같은 함수**를 쓴다.

## [FEAT-23] HIGH — `harness gate feedback` 미구현

공개 README 4개 언어가 광고하던 기능. **고친 방법** `design sync --from` 과 같은 패턴으로
가져온 리뷰 코멘트를 수집해 리뷰 패킷에 개정 근거로 싣는다(코어는 네트워크를 타지 않는다).
수집 내용은 신뢰 경계 밖이라 **중화**한다 — 패킷은 심사자·모델이 읽는 지시 채널이다.

## [UX-24] HIGH — 진입점이 없음 / [API-27] 하위명령 안내가 절반만

**근본 원인** 하위명령 목록이 각 `case` 안에 손으로 박혀 있었다.
**고친 방법** `core/src/help.ts` **명령 레지스트리 한 벌**에서 최상위 도움말·군별 도움말·
「알 수 없는 하위 명령」 안내가 전부 파생된다. 새 명령을 추가하면 세 곳이 함께 갱신된다.

## [SEC-25] MED — 게이트 산출물이 루트 밖이어도 승인

웨이브 id 는 검증하면서 산출물 경로는 안 하던 비대칭. 실경로 기준으로 루트 밖을 거부한다.

## [SEC-28] MED — 인젝션 방어 규칙 두 벌

`hook.ts`(정규식)와 `loop.ts`(코드포인트 루프)가 같은 규칙을 다르게 구현하고 있었고,
loop.ts 주석이 "한쪽을 고치면 다른 쪽도 고쳐라"라고 적어 두었다 — 사람이 기억해야 하는
방어는 결국 갈린다. `core/src/untrusted.ts` **한 벌**로 합쳤다.

## [API-29] `wave create` 침묵 성공 / [API-30] 어댑터 불일치

목표 없는 웨이브 생성을 거부한다. CLI `wave update` 가 `--text` 도 받아 MCP 와 통일했다.

## [SHIP-31] LOW — 미래 schemaVersion 무경고 수용

`doctor` 가 `schemaVersion !== 1` 을 경고한다.

## [PERF-26] MED — **fixed (verified 아님)**

**고친 방법** 열화 경로의 저널 재생을 `readJournalForReplay` 로 가속 — 상태를 바꾸는 8개
타입만 파싱한다. 기제 자체는 단위 테스트로 확인했다(201건 저널에서 객체화 <10건).
**재측정 실패** 세션 내내 머신 load 가 12~17(10 코어)이었고, 통제 측정(`post-tool` 하한)이
정상 경로보다 높게 나오는 등 창이 통째로 무효였다. **절대 p95 < 150ms 는 조용한 창에서
다시 재야 한다** — 그때까지 `verified` 로 올리지 않는다(Iron Rule 4).

---

# 드러난 다음 결함 (새 ID)

## [DET-53] — `replayState` 가 비결정적 (verified)
새로 쓴 빠른-재생 동등성 테스트가 **전체 스위트에서만** 실패했다(격리 실행은 통과).
원인은 `defaultState()` 의 `updatedAt`(호출 시각). 「마지막 이벤트 ts」로 고쳐도 부족했다 —
빠른 경로는 상태 무변이 이벤트를 걷어내 «마지막 이벤트»가 경로마다 다르다.
**상태를 실제로 바꾼 마지막 이벤트**의 ts 로 고정했다. 3회 반복 동일.

## [OPS-55] HIGH — 이벤트 타입 드리프트로 doctor 가 복구를 거부 (verified)
하네스가 쓰는 타입 **18종**이 `KNOWN_EVENT_TYPES` 에 없었다. ADR·문서·출하·캔버스·루프를
**정상적으로 쓰기만 해도** 저널이 「미지 이벤트 → 불신」이 되고, 그 판정이 `trustworthy=false`
라 **`doctor --repair` 가 거부**했다 — 유일한 복구 경로가 정상 사용으로 잠긴다.
`gate.ts`·`registry.ts` 주석이 "배선 시 등록해야 한다"고 적어 뒀지만 사람이 기억하는 목록은
갈린다. `EVENT_TYPES` 를 단일 정의로 두고 `appendEvent` 가 그 유니온만 받게 해
**등록 누락을 컴파일 에러**로 만들었다.

## [LOGIC-56] HIGH — 무효화가 복구로 되살아남 (verified)
`gate-invalidated` 를 재생이 폴드하지 않아, 산출물이 바뀌어 무효가 된 게이트가
`doctor --repair` 한 번으로 **승인 상태로 되살아났다.** 폴드를 추가하고 회귀 테스트를 붙였다.
