# [7] 상품성 감정 — 4.7/5
**점수** 4.7 · **4.8 충족** ✗ (조건 4건 전건 충족, 그러나 잔여 감점에 MED 1건) · **감정 시각** 2026-08-22 18:2x KST · HEAD 45bde0c

감정 방식: 리포 무수정. 실측은 mktemp 샌드박스 3개(`bin/harness init` 프로젝트 2, git-archive 배포본 시뮬레이션 1)에서 전부 실행. `npm run build` 미실행.

## 조건별 실측 (영문 기본 / lang:ko / LICENSE / 광고=실재 / 온보딩)

**① 영문 기본 출력 — ✅ measured (CLI 밖 표면 포함)**
- `init` 안내·`--help` 전문·모든 오류/거절 메시지: 영어.
- **훅 JSON**: PreToolUse deny(소스 차단·deploy 차단·harness 소유 파일 차단), Stop block, SessionStart additionalContext — 전부 영어 실측.
- **MCP**: initialize/tools/list 16개 도구 description 전부 영어.
- **생성 산출물**: wave 지시서(`.harness/waves/wave-001.md`), 리뷰 패킷(`packets/P0.md`), RTM/허브/체크리스트/결함 대장 렌더, evidence packet HTML(`<html lang="en">`) — 전부 영어.
- 스킬 11개·에이전트 5개·프로파일 가이드: 영어.
- 예외(사용자 산출물 아님·아래 결함 D1): 배포본에 실리는 내부 문서 2건은 한국어.

**② `lang: ko` 옵션 — ✅ measured**
- `HARNESS_LANG=ko`(env) 및 `.harness/config.yaml`의 `lang: ko` 양쪽 실측 — deny JSON·`--help` 전문·profile 오류·doctor 경고가 한국어로 전환. 기본은 영어(`core/src/i18n.ts`: env > config > `en`, OS 로케일 무시 — 명시 전환만). `--help` 푸터가 옵션을 안내("Language: set `lang: ko` …"). 단, README 4종 어디에도 이 옵션이 없다(결함 D5).

**③ LICENSE — ✅ measured**
- `/…/LICENSE` MIT 전문, "Copyright (c) 2026 장욱 (Wook Jang)". `package.json` `"license": "MIT"` 일치. README가 LICENSE 링크·저자 표기. git archive에 포함.

**④ README 광고 기능 전부 실재 — ✅ measured (46조합 실행, MISSING 0)** — 아래 절 참조.

**⑤ 온보딩 — ✅ measured**
- Quick start 설치 2줄: `claude plugin marketplace add` + `king-wjang-harness@king-wjang-harness` — marketplace.json(마켓 이름)·plugins[0].name(플러그인 이름) 실물과 일치.
- `init` 이 다음 행동을 안내(+gate approve 를 allowlist에 넣지 말라는 보안 온보딩), `--help`가 Core flow 한 줄 요약 제공, SessionStart 훅이 현 위상·다음 행동 주입(클린 세션 1,032자 ≈ 광고 "~240 tokens"와 부합), 미초기화 프로젝트에선 4개 훅 모두 stdout 0바이트·exit 0(비간섭 실측).

## 문서 명령 기계 추출 결과 (46조합 중 MISSING 0) · 문서 계량 대조

README 4종 + 스킬 11 + 에이전트 5 + 배포본 내 문서에서 `harness <군> [하위]` 46개 유니크 조합을 기계 추출(grep) 후 **전부 실인자로 실행**:
- init / status / doctor(+--repair) / migrate / trace — OK
- phase set(승인 없는 건너뛰기 거절 실측: P5 요청 → P1~P4 미승인 사유 명시) — OK
- gate submit/approve/verify/sweep/status/feedback — OK (placeholder 4자 제출 → "80자 미만" 거절 실측 = Known limits의 80자 주장과 일치)
- wave create/activate/update/complete/list — OK (README 표기 `--accept`·실제 help 표기 `--acceptance` **양쪽 다 수용됨** 실측)
- node upsert/bump/list — OK (bump → STALE 전파·활성 wave 자동 settle 메시지 실측)
- doc upsert/url/submit/approve/revise/stale/list — OK (URL 없는 문서 gate행 거절 실측)
- adr propose/decide/revise/show/list — OK (기각 사유 없는 decide 거절 → --reject 주면 통과)
- design link/sync/inventory/baseline/html/list — OK (baseline은 실PNG로, html은 토큰 파일 생성 후 HTML 렌더 실측)
- tokens gen/lint/swap — OK (lint가 `#ff0000`·`17px` 2건 적발, swap "2 token(s) changed")
- evidence spec/check/packet — OK
- loop next/attempt/brief/critical raise·clear — OK (brief에 nonce 펜스 `[54aeb04c]` = 주입 방호 광고 실측)
- ship defect add/update/list, deploy, deployments, checklist, verdict — OK (verdict: P10/P11 미승인 + UX 실캡처 부재로 NO-GO 사유 3건 — 광고 "never passes without measured" 동작 일치)
- profile show/cmd, usage tier/status, backtrack(+clear) — OK
- 훅 4종(`bin/harness-hook` — hooks.json이 실제 부르는 바이너리로도 구동) — OK

**문서 계량 대조:**
| 광고 | 실측 | 판정 |
|---|---|---|
| 테스트 1031개 / 39파일 | `vitest run` → **Tests 1031 passed (1031) · Files 39 passed (39)** | ✅ 정확 일치 |
| 훅 p95 < 150ms | 30회 spawn 실측 p95 **131ms** (min 93 · med 104) | ✅ |
| `npm audit --omit=dev` 0건 | **found 0 vulnerabilities** | ✅ |
| 세션당 ~240 tokens | 클린 session-start 1,032자(JSON 포함) ≈ 230~260tok | ✅ 근사 |
| 미가입 프로젝트 0 tokens | 4 이벤트 stdout 0바이트 | ✅ |
| 런타임 의존 1(yaml, 번들) | package.json dependencies 1개 · dist 커밋 | ✅ |
| 저널 재생 fallback | state.json을 garbage로 파괴 → deny 판정 유지 + "[state damaged — run harness doctor --repair]" 부기, doctor가 파손 보고 | ✅ |
| 13/13→0·1·2(게이트 강화), A/B 2-에이전트 실험, 100k 저널 p95 101ms | 재현 불가(픽스처·실험 로그 비배포) | 못 잼(하단 고지) |

## 양방향 검사 (없는 기능 광고 / 있는 기능 부정)

**없는 기능을 광고? — 1건 경계 사례 외 없음.**
- Known limits의 부정 주장 8건을 역검증: P7–P9 스킬 없음(스킬 디렉토리 실물과 일치) · `/remote-control` 비제공(플러그인에 commands 없음, 세션 힌트는 조건부 문구로 실측) · 캔버스 네트워크 fetch 미출하(design sync는 `--from <file>` 전용 — help·실행 일치) · 저널 압축 명령 없음(help 전수에 부재) · 80자 게이트(실측 일치). 전부 사실.
- **경계 사례(결함 D2)**: P10 판정 플로우가 외부 스킬 `verifying-production-readiness`에 의존. README는 "called but not bundled — installed separately"로 정직 공지하지만 **획득 경로(URL·출처)가 어디에도 없고**, `agents/readiness-auditor.md:19`는 "**It is already installed on this machine**"이라고 단정 — 낯선 설치자에게는 거짓 전제이며 대체 절차 금지("do not replace it with a summary")까지 걸려 있어 P10 감사 플로우가 미설치 환경에서 막힌다.

**있는 기능을 부정? — 없음.** 과거 사고 지점이던 "Claude Design integration" 절은 "shipped, except the network pull"로 정정되어 있고, 그 절이 주장하는 sync/diff/bump-STALE·P4 inventory·baseline·gate feedback 전부 실행으로 실재 확인. 과소 광고 잔존 없음.

## 낯선 사용자 설치 워크스루 (배포본 기준 — 무엇이 실제로 들어 있나)

- `git archive HEAD` = **153 엔트리**. `core/dist/{cli.js,mcp.js}` **커밋·포함** → 배포본 시뮬레이션에서 `--version`·`init`·훅 deny 전부 **빌드 없이 즉시 동작 실측** (빌드본 부재 가드는 dist 삭제 시에만 발동 — README "works on clone, no build step" 사실).
- `.gitattributes`(PROD-113)가 progress.md · docs/release-readiness · docs/appraisal · .codesight 를 배포본에서 제외 — 제외 실측 확인. README와 모순되는 내부 출하 판정문은 실려 나가지 않는다.
- **그러나** 내부 작업물 2건은 여전히 실린다(결함 D1): `docs/superpowers/{plans,specs}/…`(한국어 내부 설계 스펙·플랜, "상태: 사용자 검토 대기" 헤더)와 `.claude/skills/verify/SKILL.md`(한국어 개발용 E2E 레시피). 배포본의 docs/ 아래 문서는 이 한국어 내부 스펙뿐이다.
- 플러그인 매니페스트: plugin.json(이름·0.0.1·mcpServers `${CLAUDE_PLUGIN_ROOT}/mcp/server.js`) + hooks/hooks.json(4 이벤트, `"${CLAUDE_PLUGIN_ROOT}/bin/harness-hook"`, timeout 10) — 경로 실물 존재·직접 구동 확인. skills/ 11개·agents/ 5개 동봉.
- node_modules 미포함, package-lock.json 포함. yaml은 dist에 인라인 번들(런타임 npm install 불요 — 배포본 시뮬레이션에서 node_modules 없이 동작으로 입증).
- 지원 채널: README Support 절 — 로컬 자가진단 표 + "no public issue tracker yet, report through the channel you installed from" 정직 공지.

## 발견한 결함

- **D2 [MED]** P10 판정 의존 스킬 `verifying-production-readiness` 가 비동봉인데 **획득 경로가 문서 어디에도 없고**, `agents/readiness-auditor.md`는 "It is already installed on this machine"이라고 단정(신선한 설치에서 거짓). README Known limits의 정직 공지와 자기모순 — 낯선 사용자의 P10 감사 플로우가 막히는 실마찰.
- **D1 [LOW]** 배포본 위생 자기 기준(PROD-113 "내부 작업물이 실려 나가지 않게 한다") 미완: 한국어 내부 스펙/플랜(docs/superpowers)과 한국어 개발 레시피(.claude/skills/verify)가 export-ignore 누락으로 배포본에 잔존.
- **D3 [LOW]** `harness --version` → "king-wjang-harness core v0" — package/plugin/MCP의 0.0.1과 정밀도 불일치. Support 절이 버그 리포트에 이 출력을 붙이라는데 릴리스 구분이 불가능.
- **D4 [LOW]** CHANGELOG/버전 이력 부재(0.0.1 첫 릴리스라 치명적이진 않음; README Status 절이 부분 대체).
- **D5 [LOW]** `lang: ko` 옵션이 README 4종(한국어판 포함) 어디에도 미기재 — `--help` 푸터에만 존재.
- **D6 [LOW]** 로컬 프로파일(`.harness/profile/`)이 없을 때 `profile cmd` 오류가 **플러그인 설치 디렉토리의** `profiles/generic/commands.yaml`을 고치라고 안내 — 플러그인 업데이트에 유실되고 전 프로젝트에 영향. 프로젝트-로컬 오버라이드가 실재·동작(실측)하는데 그 경로를 안내하지 않음.
- (비결함 기록) README 표의 `wave create … --accept` vs help의 `--acceptance` — 양쪽 다 수용됨을 실측, 표기 비일치만 있고 사고 없음.

## 못 잰 것 (정직 고지)

- `claude plugin marketplace add` 실제 설치 의식(이 환경에 실 설치 불가) — 매니페스트·경로·바이너리 구동으로 대체 검증.
- 게이트 강화 계량(13/13→0·1·2), 2-에이전트 A/B 실험, 100k 저널 p95 101ms — 산출 픽스처가 배포본에 없어 재현 불가(수치 자체는 광고문에 "measured"로 남아 있으나 제3자 재현 불가라는 점만 기록; 나머지 계량이 전수 일치라 신뢰 훼손으로 안 봄).
- "Works identically in the Claude desktop app" — 데스크톱 앱 미보유.
- ja/zh README의 번역 품질(구조·계량·설치명령 패리티는 확인: 1031 2회·설치명령 1회·LANG-SWITCH 존재, 행수 249~252).

## 점수 산출 근거

- 하한 조건 4건 전건 **measured 충족**: 영문 기본(훅 JSON·MCP·생성물 포함) + lang:ko 실동작 / LICENSE 실재·일관 / 광고 기능 46조합 MISSING 0 + 계량 5건 정확 일치 / 온보딩(설치 2줄 실물 일치·비간섭·자기안내).
- 배포본 기준 워크스루에서 무너지는 곳 없음(dist 커밋·의존 0 설치·훅 경로 유효).
- 잔여 감점: **MED 1건(D2)** + LOW 5건. 4.8 정의("전건 충족 + 잔여 LOW 이하")에서 D2 하나로 미달.
- 따라서 4.8 미만·4.5 이상 구간에서, 문서 정직성·패키지 위생·계량 정확성이 매우 높은 점을 반영해 **4.7**.
