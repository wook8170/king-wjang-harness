# [6] 사용성 감정 — 4.4/5
**점수** 4.4 · **4.8 충족** ✗ (하한 조건 4/4 전건 충족, 그러나 잔여 MED 5건 — 「LOW 이하」 요건 미달) · **감정 시각** 2026-08-22 18:14–18:40 KST · 대상 HEAD 45bde0c (`feature/core-engine-v0`)

감정 방식: mktemp 샌드박스에서 `bin/harness init` 후 **전 생애주기(P0→P12 GO)를 실제로 완주**. 20개 명령군 전부 `--help` 실행, 문서(README×4·SKILL.md 13종·agents 5종)에 등장하는 harness 명령 전수 추출 후 그대로 실행, 훅 4종 stdin 구동, MCP initialize/tools/list/tools/call 실측. 리포 파일 무변경(모든 실측은 샌드박스 2곳 + /tmp).

## 조건별 실측
| 조건 | 판정 | 실측 |
|---|---|---|
| `harness --help` exit 0 + 명령군 전부 나열 | ✅ | exit 0, **20개 명령군** 전부 나열(rubric의 13은 하한). 코어 플로우 한 줄 요약 + 언어 전환 안내 포함 |
| 모든 명령군이 하위명령 안내 | ✅ | 20/20 exit 0. `<sub>` 있는 14개 군은 하위명령 표, 단일 명령 6개는 usage 한 줄. `tokens --help`는 최소 유효 문서 예시까지 내장 |
| 침묵 성공 0 | ✅ | 성공한 모든 CLI 호출이 ≥1행 출력(`wave create`→id, `node upsert`→id, `wave update`→"Turn log recorded" 등). 훅의 stdout 공백은 「판정 null=허용」 프로토콜이며 SKILL.md·verify 스킬에 명시됨 — 침묵 성공으로 세지 않음 |
| 첫 실행 온보딩 존재 | ✅ | `init` → ".harness/ initialised — run `harness --help`" + 허용목록 금지 경고. init 전 `status` → "run `harness init` first". SessionStart 훅이 phase·활성 웨이브·다음 명령을 주입. README Quick start·메인 SKILL 부트스트랩 절(PATH 함정 포함) 존재 |

## 첫 사용자 생애주기 워크스루 (막힌 지점 · 그 자리 메시지 · 빠져나왔나)
init → P0 제출/승인 → P1..P6 게이트 → P7 구현 개방 → 웨이브 루프(에스컬레이션 포함) → UX 증거 → P8..P11 → ship verdict GO → P12. **막힌 지점 11곳 중 10곳은 그 자리 메시지만으로 탈출 성공.**

1. `phase set P1` (P0 미승인) → "Start with the earliest: `harness gate submit P0` → `harness gate approve P0`" — **탈출 O** (명령 그대로 실행됨)
2. `gate submit P0` 빈 인자/빈 파일/17자 플레이스홀더 → 각각 다른 원인 진단 + 처방 — **탈출 O**
3. `gate submit P2`에 기존 게이트와 유사한 문서 → "carries only 10 characters ... gate P0, P1 has not already reviewed — below the 80 minimum" — 원인·수치·이유 완비, **탈출 O**
4. 존재하지 않는 경로 제출 → **"must live inside the project — outside paths: docs/concept.md"** — 실제 원인은 「파일 없음」인데 「프로젝트 밖」으로 오진. **메시지만으론 탈출 실패**(경로는 명백히 프로젝트 안이라 사용자 혼란) → 결함 #3
5. 훅 deny(P1에서 src/ Write) → 트랙·프로파일·source_globs·쓰기 가능 목록·"P6 승인 후 개방" 전부 명시 — **탈출 O**, 실제로 P6 승인+P7 진입 후 같은 Write가 허용됨(약속 이행 확인)
6. UX 웨이브 `complete` 거부 → 증거 디렉토리 절대경로 제시 — **탈출 O**. 단 0바이트 파일을 넣어도 같은 문구("no visual evidence")가 나와 혼란(→ #6); `evidence check`가 정확한 원인을 주지만 complete 메시지가 그걸 가리키지 않음
7. 3연속 실패 → 🚨 critical + 결정 메뉴 3종 + `loop critical clear` 해제 경로 — **탈출 O**
8. Stop 훅 블록(턴로그 미정산) → 정산 명령 + "사소한 턴이면 한 줄 사유로 종료" 밸브 — **탈출 O**
9. backtrack P4 → 문서 수정 → `gate sweep`(P4 invalidated) → 재제출·재승인 → 재진행 — 각 단계 메시지가 다음 수 제시, **탈출 O**
10. `ship verdict` NO-GO 4건 → 사유마다 처방(제출 명령·증거 경로·"headless 2x") — 처방 그대로 실행(400×300 캡처 교체, P10/P11 게이트) 후 **GO 전환, 탈출 O**
11. `usage tier --percent 91` 실험 후 세션 주입 문구가 영구 잔류, 91→10 하향해도 안 지워짐 — **탈출 실패**(해제 명령 부재) → 결함 #1

## 안내된 명령의 실재·실행 검사 (N개 중 부재 M · usage 에러 K)
README×4·SKILL.md 13종·agents 5종·hooks에서 backtick 인용 harness 명령 전수 추출(유니크 약 60형태), 대표 인자로 전부 실행: **부재 0 · usage 에러 0**. 에러 메시지 안에 안내된 명령(gate submit→approve, node upsert, wave activate, evidence check, doctor --repair, backtrack, loop critical clear, HARNESS_ALLOW_FORCE=1 phase set --force, HARNESS_ACCEPT_POLICY=1 doctor --accept-policy 등)도 전부 그대로 실행 성공. 예외 1건: help가 `[--wave]`를 선택으로 표기한 `evidence packet --ux UX-1`이 활성 웨이브 없으면 **이유 없는 bare usage로 실패**(→ #2). 표기 불일치 1건: 문서는 `--accept`, help는 `--acceptance`(둘 다 동작하는 별칭 — 미문서화, → #11).

## 에이전트 표면(훅 JSON·MCP·스킬 문구) 사용성
- **훅 deny JSON**: 최상급. `gate approve` 시도 → 왜 막는지 + 에이전트가 할 수 있는 것(`gate status/verify`) + 사람의 실행 경로까지. `doctor --accept-policy`·`phase set --force`도 동일 패턴. 약점: 배포성 명령 deny는 한 줄("cannot run in the design track")로 탈출 경로 없음(→ #10).
- **SessionStart 주입**: phase·쓰기 가능 목록·다음 명령·활성 웨이브 지시서 경로·최근 턴로그(해시 논스 인용 fence). 새 세션이 자기 위치를 즉시 안다. 단 stale usage-tier 문구 영구 주입 결함(→ #1).
- **Stop 블록**: 정산 명령 + 사소-턴 밸브. 정산 후 통과 확인.
- **MCP**: 16 tools, 설명 정확. `harness_gate_approve`는 [UNAVAILABLE] 자기문서화 tool — 호출 시 터미널 경로·이유·대안(`harness_gate_submit`)을 isError로 반환. 인자 오류도 CLI와 같은 문구.
- **스킬**: 메인 SKILL.md에 PATH 부트스트랩 함정, deny→행동 매핑 표, 함정 목록(pipe `$?` 함정까지). 훅 이벤트는 "you never type them" 명시. 실측과 전부 일치.
- **ko 로컬라이즈**: CLI·훅 모두 HARNESS_LANG=ko 동작 확인.

## 발견한 결함
**MED 5**
1. **usage 티어 하향 미기록 → stale 지시 영구 주입.** `core/src/cli.ts:521` `if (inject) recordTier(...)` — 상승시에만 기록. 한 번 90%를 찍으면 이후 사용량이 10%여도 모든 새 세션 SessionStart에 "[harness] usage at 90% — split waves smaller"가 무기한 주입. 해제 명령 부재(usage는 tier/status뿐), 유일한 탈출은 미문서화된 `.harness/.runtime/usage-tier` 손편집. `core/src/usage.ts` 모듈 주석("하강(리셋)은 조용히 기록만 한다")과 코드가 모순.
2. **`evidence packet --ux <UX-x>`가 이유 없는 bare usage로 실패.** help는 `[--wave]` 선택 표기인데 활성 웨이브 없으면 원인 설명 없이 Usage 한 줄(exit 1). 형제 명령 `evidence spec`은 같은 상황에서 "no active wave — activate ... or pass waveId"로 설명함 — 비일관.
3. **존재하지 않는 제출 경로를 「프로젝트 밖」으로 오진.** `gate submit P0 --paths docs/concept.md`(파일 미존재) → "Artifacts under review must live inside the project — outside paths: ...". 원인은 파일 없음인데 위치 문제로 안내 — 첫 사용자 혼란 지점.
4. **정책 config 키 4종 미문서화.** `design_allowed_prefixes`·`design_blocked_bash`·`design_system_frozen_roots`·`block_raw_values`(`core/src/config.ts`)가 README×4·스킬·agents 어디에도 없음(내부 감정 문서에만 존재). 훅 차단의 입력을 사용자가 조정할 통로가 발견 불가 — 축 ①(판정 입력의 이해·조정) 부분 미달. profile 쪽은 `profile show`+problems+doctor drift로 잘 노출되는 것과 대조적.
5. **`profile cmd` 실패 처방이 번들 플러그인 디렉토리를 가리킴.** "set it in `<plugin>/profiles/generic/commands.yaml`" — 실측상 프로젝트 로컬 `.harness/profile/commands.yaml`이 존재하고 항상 우선하는데(`core/src/profile.ts:328`) 그 경로를 안내하지 않음. 플러그인 설치본 편집은 업데이트에 소실되고 전 프로젝트에 영향.

**LOW 8**
6. UX complete 거부 문구가 0바이트 증거 존재 시에도 "there is no visual evidence"로 동일 — `evidence check <wave>`(정확한 원인 제공)를 안내하지 않음.
7. 1×1·70바이트 캡처로 `wave complete`는 통과(경고 미표출), P12 `ship verdict`에서야 같은 증거가 NO-GO — 경고가 정산 시점에 나오지 않고 출하 시점으로 지연.
8. `design sync --from <없는 파일>` → 가공 없는 `ENOENT: no such file or directory` 원시 에러(타 명령의 세공된 에러와 대조).
9. doctor 경고 "1 hook decision failure(s) recorded — find out why"가 로그 위치(`.harness/.runtime/hook-errors.log`)를 안 알려줌(README 지원 표에는 있음).
10. 배포성 명령 deny 한 줄에 탈출 경로 없음(어느 페이즈·게이트가 열어주는지 무언급) — 다른 deny의 풍부함과 비대칭.
11. 플래그 명칭 불일치: help `--acceptance` vs 문서 전체 `--accept`(둘 다 동작하나 별칭 미문서화). `evidence spec` 에러는 "pass waveId explicitly"라고만 하고 실제 플래그명 `--wave`를 안 씀.
12. `--version` → "king-wjang-harness core v0" — package.json 0.0.1과 불일치, 버그 리포트 요청("include your harness --version")의 식별력 약함.
13. 이중 트랙 혼란: `gate submit --paths`만 쓰면(코어 플로우 안내대로) 리뷰 패킷 머리에 "**No artifact is registered ... this packet is not grounds for approval**"이 항상 박힘 — doc 레지스트리(`doc upsert`+`doc url`) 병행이 전제인데 최상위 help·코어 플로우 어디에도 그 연결 안내가 없고, 그 상태로 `gate approve`는 성공함(패킷과 게이트가 서로 모순된 신호).

## 못 잰 것 (정직 고지)
- 실제 Claude Code 플러그인 설치 경로(`claude plugin install`)와 permission dialog 실동작 — CLI/훅/MCP를 stdin·직접 실행으로 대체 실측. dialog가 사람에게 보이는 문구는 미확인.
- SessionStart의 `/remote-control` 안내 실효성(해당 환경 없음).
- `harness design html`의 토큰 파일 존재 시 출력 품질(토큰 파일 미작성 경로만 실측), `tokens gen` 성공 경로.
- 장기 저널(수만 이벤트)에서의 체감 지연 — README 실측치(62ms)를 검증하지 않음(성능 축 소관).
- 4개 언어 README의 번역 품질 상호 비교(ko/en 표면만 실측, ja/zh는 명령 문자열 일치만 확인).
- `npm run build`(동시 감정자 충돌 금지 준수) — committed dist로만 실측.

## 점수 산출 근거
- 하한 4조건 **전건 충족**(20/20 help·침묵 성공 0·온보딩 존재). 진짜 질문인 「막혔을 때 빠져나올 수 있는가」에서 막힘 11곳 중 10곳이 그 자리 메시지만으로 탈출 — 에러 메시지가 원인·위치·처방·이유(rationale)까지 갖춘 것이 기본값이고, 사람-전용 탈출구(approve/--force/--accept-policy)는 deny 문구가 사람의 실행 명령까지 대필해 줌. 문서에 안내된 명령 전수(약 60형태) 부재 0·usage 에러 0. 에이전트 표면(훅 JSON·MCP isError·SKILL deny표)은 이 축에서 본 제품 중 최상급.
- 그러나 4.8은 「잔여 감점 LOW 이하」를 요구. **MED 5건 잔존**: 특히 #1(한 번의 실험이 모든 미래 세션을 오염시키고 해제 수단이 없음 — '되돌리는 법' 부재의 전형)과 #4(차단 정책의 절반이 조정 불가능하게 숨어 있음 — 축 ① 직격), #3(오진 에러)은 첫 사용자가 실제로 부딪히는 지점.
- 산식: 기저 5.0 − MED 5×0.10 − LOW 8×0.0125(≈0.1) = **4.4**. 4.8 미충족은 조건이 아니라 잔여 MED 때문.
