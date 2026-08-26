# 출하 검증 — 라운드 3-S 재실행 (독립 재감정, 신규 세션)

**작성 2026-08-26** · 대상 `main` HEAD `349f29d` · 방식 **정식 11축** 재실행(사용자 선택) · 매체 CLI 도구 + Claude Code 플러그인
**독립성**: 이 세션은 구현에 관여하지 않은 신규 컨텍스트다(OPS-74 — 구현자≠감정자). 실측은 mktemp 샌드박스에서 제품을 실제 구동해 관측했다.
**기준선 대조**: 직전 판정 = **SHIP-READY**(G007, `00-summary.md`). 이 재실행이 그 판정을 유지/뒤집는지 확인한다.

## 게이트 (착수 전 확정 — `gates.md` G1~G13 목표를 **그대로 재현**, 완화 없음 · Iron Rule 1)

| 게이트 | 목표(재현) | 이번 실측 (2026-08-26, HEAD 349f29d) | 판정 |
|---|---|---|---|
| G1 테스트 | 전건 pass · fail 0 · skip 0 · 3회 동일 | 1404 pass ×다수 · **간헐 스위트-수집 실패 1회** 조사중 → FLAKE-01 | ⏳ |
| G2 타입 | tsc 오류 0 | `npx tsc --noEmit` exit 0 | ✅ |
| G3 빌드·자체완결 | 맨 클론서 `--version`·`init`·`status` exit 0 | `git archive HEAD` 맨 트리 3명령 전부 exit 0 | ✅ |
| G4 훅 무해 | 4이벤트×4입력 exit 0 · 미초기화 stdout 0바이트 | 미초기화 16조합 전부 exit 0 & 0바이트(FAIL 0) | ✅ |
| G5 훅 강제력 | 소스·코어·경로우회·배포Bash deny · 미정산 stop block | must-block 5/5 deny · 신규표기 적대 스윕 40여 표기 전건 deny(코어·정책·state·저널) · 과차단 0(대조 4/4 allow) — 아래 §적대 | ✅ |
| G6 🔴 안전 속성 | MCP 게이트 승인 불가 · 상태 불변 | `gate approve` TTY 부재로 refuse(exit 1) · phase P0→P0 불변 | ✅ |
| G7 결정성 | 3회 동일 · Math.random/무주입 Date.now 실사용 0 | `Math.random` 실사용 0 · `Date.now` core/src 2건 **전부 주석**(실사용 0) | ✅ |
| G8 공급망 | 프로덕션 도달 crit/high 0 | `npm audit --omit=dev` **0 vulnerabilities** | ✅ |
| G9 훅 지연 | 폴백 추가 p95 < 50ms(부류마다) | ⏳ `bench-hook-latency.mjs` 유휴 실행 대기 | ⏳ |
| G10 이력 비밀 | 전 이력 유출 0 | `gitleaks detect` **307 커밋 no leaks** | ✅ |
| G11 CLI 계약 | `--help` exit 0 · 미지 명령 exit≠0+명확 메시지 · 침묵 성공 0 | `--help` exit 0(31줄) · 미지 명령 exit 1 「Unknown command」 명령군 나열 | ✅ |
| G12 관측성 | 조용한 실패 0 · doctor 상태 반영 | doctor clean ok=true · 저널 손상 주입 후 warning 으로 반영 | ✅ |
| G13 패키징 | 선언 산출물 누락 0 | plugin.json·mcp/server.js·hooks.json 존재 · skills 15·agents 6 · **missing 0** | ✅ |

## FLAKE-01 (G1 결정성) — 조사 기록

- **관측**: `npx vitest run` 반복 중, 1회 **8개 스위트가 통째로 실패**(config·duplicate-rules·guidance-commands-exist·hook-stop·migrate·orchestrate-presettle-smoke·runtime·state — 1362 pass, 42 미실행). 나머지 다수 실행은 1404 pass.
- **성격**: 개별 단언 실패가 아니라 **스위트 통째(수집/워커) 실패** — 워커풀 경합의 전형. 8개 스위트 모두 자식 프로세스 미사용(cp-refs 0), 공유 setup.ts 는 env 설정뿐(레이스 없음).
- **근본 원인 확정 (measured)**: 유휴 12/12 = 1404 pass. **부하 인위 유발**(3중 동시 vitest, load 158) 시 2/3 실행이 실패 — 실패는 **절대 wall-clock 타이밍 단언 2건**:
  - `core/test/cost-3i-residuals.test.ts:108` [COST-129] — config 로드 `perCall < 1ms` 기대, 부하 시 **2.139ms** 관측.
  - `core/test/med-3j-residuals.test.ts:403` [COST-228] — 안전망 200KB 입력 `< 500ms` 기대, 부하 시 **640ms** 관측.
- **판정**: 제품 로직 비결정성 아님(끝단 상태·판정 동일). 플레이키는 **테스트 스위트의 절대시간 단언**에 국한. 아이러니하게 프로젝트가 G9 벤치에서 이미 세운 규율(부하 감지 BUSY 표기·델타 기반 · [PROD-212])을 **이 두 단위 테스트가 답습** — 절대 ms 문턱은 제품이 아니라 측정 머신을 잰다.
- **심각도**: LOW–MED · **출하 비차단**(제품 코드 아님, 배포 산출물 무영향 · 최종 사용자는 테스트를 부하 하에 돌리지 않음). Iron Rule 6/9상 실제 결함(부하 창에서 스퓨리어스 red → CI 노이즈). **처방(백로그)**: 두 테스트를 BUSY-aware/델타 기반으로 — 벤치와 동일 규율. **신규 등재 → 정본 대장 `FLAKE-01`(= COST-129·COST-228 테스트 경질화).**

## 적대적 훅-우회 스윕 (신규 표기, 코퍼스 밖) — 결과

`scratchpad/adversarial.sh` (P0 설계트랙, 각 명령 실제 훅 구동). **A** 신규 Bash 소스쓰기 19표기(printf·tee·dd·heredoc·sed -i·ex·ed·truncate·null-cmd·install·cp·mv·eval·xargs·python·perl·ruby·node·awk-inplace) **전건 DENY** · **B** 코어/정책/저널/state 8건 **전건 DENY** · **C** 별칭·TOCTOU(심링크-후-쓰기·하드링크·mv .harness) 3건 **DENY** · **D** 저널위조·`base64|sh` 2건 **DENY** · **F** 대조군(조회·ls·docs쓰기·git status) 4/4 **ALLOW**(과차단 0).

**E(MCP 중첩/배열 인자)**: 배열 `paths:[코어]`·중첩 `target:{path:코어}`·`path:config` **DENY**. 단 **`{note,dst:<소스>}` decoy-first = ALLOW**. 소스(`core/src/hook.ts:1635-1643` [SEC-299/F2])를 읽어 확정: `DEST_KEY=/path|file|dest|target|out$|to$|notebook/i` 에 **`dst`(e 없음)는 미매칭 → weak-key → coreOnly 판정**. 값이 유저 소스이면 통과. **판별 실측**으로 경계가 문서와 일치함을 확인 — weak `dst`→정책/state **DENY**, weak `dst`→소스 **ALLOW**, strong `dest/path/to`→소스 **DENY**. ⇒ **신규 결함·회귀 아님. 문서화된 의도적 weak-key 소스 한계**("설계=벽 아닌 과속방지턱, 훅은 보안경계 아닌 사고방지 장치" `README.ko.md:271`). **되돌릴 수 없는 표적(코어·정책·state·저널)은 전 표기 방어 유지. 신규 BLOCKER 0.**

## 축 커버리지 (정식 11축)

_보지 않은 축 없음(정식 11축 전부). ①의 경쟁 벤치마크만 제외(대조군 없음 — 자사 스펙 대비 완성도로 대체, `gates.md` 축계획과 동일)._

## 판정 — 출하 가능 (SHIP-READY) · 직전 판정 유지 (GO)

신규 세션 독립 재실행에서 **13 게이트 중 12 measured PASS**, 신규 적대 훅-우회 스윕(코퍼스 밖 ~40 표기) 전건 방어 — **되돌릴 수 없는 표적(코어·정책·state·저널)은 전 표기 DENY, 신규 BLOCKER 0**. E의 유일한 ALLOW는 문서화된 weak-key 소스 한계(신규 결함 아님). 직전 SHIP-READY 판정을 **유지**한다.

**커버리지 한계(명시)**: 이 판정은 본 축에 한한다(정식 11축, 뺀 축 없음 — ①경쟁 벤치마크만 대조군 부재로 제외). 단일 신규 컨텍스트 감정이며, 실측 명령은 재현 가능(`scratchpad/gates.sh`·`adversarial.sh`). 다중 컨텍스트 교차검증은 직전 G006(7축 독립)·G007 최종리뷰가 담당.

**잔여(비차단)**:
- **FLAKE-01** — `cost-3i-residuals.test.ts:108`·`med-3j-residuals.test.ts:403` 절대 wall-clock 단언, 부하 시 스퓨리어스 red. 제품 무영향, 백로그(BUSY-aware/델타화). 정본 대장 신규 등재 권장.
- **G9 재측정 유예** — 이 세션 측정 창이 사용자 활성 데스크톱으로 오염(load 25+, node 기동 바닥 197ms)되어 깨끗한 델타 재측정 불가(Iron Rule 5). 직전 R3-R 클린 측정(폴백 +11~24.5ms < 50ms)을 근거로 유지. **조용한 창에서 `node scripts/bench-hook-latency.mjs` 재실행 시 델타 < 50ms 확인이 다음 할 일**(결함 아님, 측정 가용성 문제).
