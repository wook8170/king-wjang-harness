# king-wjang-harness 진행상황 (핸드오프)

## 2026-08-21 (라운드 3-B) — 🔴 **판정 철회** 후 BLOCKER 2건 봉인 · open 5건 워크플로 진행 중

**정본.** 앞 섹션(라운드 3)의 「출하 가능」은 **철회됐다.** 42 에이전트 독립 적대 감사가
내 측정이 놓친 **BLOCKER 2건**을 찾았고 전건 재현했다. 그 뒤 둘 다 닫았다.
커밋 4개: `53c3ac1`(철회) · `9055b5a`(SEC-70 정밀화+SEC-75) · `d5350ad`(SEC-69) · `18df98f`(SEC-70/77).
**688 tests green · tsc 0 · 대장 57행 lint 통과 · open BLOCKER 0 · open 전체 5.**

### 🔴 왜 「출하 가능」이 틀렸나 — 측정 범위 (가장 중요한 교훈)
라운드 3에서 「우회 10계열 60종 전건 deny · 의도적 허용 18종 전건 allow(과차단 0)」을 냈다.
그 60종은 **내가 막힐 거라 예상한 것**, 18종은 **통과할 거라 예상한 것**이었다.
**목록에 없던 셋**: ① 정책 파일 자체를 쓰는 것 ② 설계 트랙 **밖**의 페이즈
③ **막지 말아야 할 것을 막는지**. 자기 테스트 목록으로 자기 작업을 채점하면 이 셋은 구조적으로 안 보인다.
라운드 2 「한국어 0」 과다 주장과 **같은 뿌리**이고, 두 번 반복됐으므로 절차의 결함이다([OPS-74]).

### 닫은 것 (BLOCKER 2 + 1)
- **SEC-69 자기 무장해제** — 설계 트랙 차단은 `config.yaml` 의 `design_allowed_prefixes`
  **allow-list** 로 하는데 그 파일이 훅에서 allow 였다. **빈 문자열 접두사 한 줄이면 강제가 통째로
  꺼졌고** doctor 도 깨끗하다고 답했다. → 정책 파일(`config.yaml` + `.harness/profile/`)을 상태 파일과
  같은 등급으로. 쓰기 7종 전건 deny · **과차단 0**. deny 사유는 **분리**했다(상태=harness 명령으로만,
  정책=사용자가 터미널에서 직접) — 바꾸는 방법이 다르므로 한 문장으로 뭉개면 둘 다 틀린 안내가 된다.
- **SEC-70 P7~P12 강제 0** — 스펙 §4-2 2·3행 미구현. 13페이즈 중 6개에 강제가 없었다.
  → P7~P9 배포 명령·설계 문서 직접 수정 차단(backtrack 중이면 허용), P10~P12 신규 기능 코드·
  게이트 미승인 배포 차단. **정상 게이트 승인 경로로 측정**(`--force` 산물 반론 차단).
- **SEC-77 §4-2 1행 반쪽** — 배포 목록이 리터럴 5개뿐이라 `npm publish`·`terraform apply` 통과,
  **빌드 명령 차단은 아예 없었다**. → 계열별 21종 + 프로파일 `build` 차단. config·번들 프로파일·
  코드 내장 바닥값 **3곳 동기화**(기존 테스트가 내 누락을 잡았다).

### 진행 중 — 워크플로 `wf_28bae004-b27` (백그라운드)
open 5건을 **worktree 격리 병렬 구현 + 건별 적대적 검증**:
`UX-71`(과차단 광범위·사유 문구 거짓) · `I18N-72`(skills/agents/마켓플레이스 한글 15,569자) ·
`SEC-75`(2바이트 1장으로 12게이트 통과) · `OPS-76`(정책 변경 미탐지) · `FEAT-73`(없는 `/remote-control`).

### 다음 즉시 할 일
1. **워크플로 수령 → 액면으로 받지 말고 직접 재현**(앞 워크플로 결과도 5건 중 5건이 사실이었지만
   내 재현 시도 2번이 먼저 실패했다 — 규칙을 읽고 정확한 레버를 찾아야 했다).
2. 각 건 대장 반영 → lint → 커밋.
3. **재감정 재실행** — 이전 점수: 효용성 4.5 · 실효성 2.8 · 가치 2.7 · 가성비 4.3 · 사용성 4.2 ·
   상품성 3.5 · 엔지니어링 4.2 (**전 항목 4.8 미달**). 미달이면 사용자 지시대로 루프 재시작.
4. 재감정 아티팩트(b34b9d1e) 갱신 — 아직 라운드 2 상태다.

### 시스템 지식 (라운드 3-B)
- **자기 채점은 구조적으로 못 본다.** 독립 적대 감사를 판정 **전** 필수 절차로 넣어야 한다.
  이번에 42 에이전트가 BLOCKER 2건을 찾았고, 그건 내가 더 열심히 해서 나올 것이 아니었다.
- **재현 실패가 곧 반증이 아니다.** BLOCKER 주장을 두 번 재현 실패했는데(잘못된 config 키,
  잘못된 프로파일 벡터) **주장이 맞았다.** 규칙 소스를 읽고 정확한 레버를 찾은 뒤에야 재현됐다.
  추측으로 재현 시도하고 「안 되네」로 닫지 마라.
- **과차단은 결함과 같은 무게다.** 사람이 하네스를 끄면 방어가 0이 된다. 모든 차단 측정에
  「막으면 안 되는 것」 목록을 짝으로 재라.
- **판정 어휘·표 셀 규칙**(`ledger-lint.sh`): 고정 어휘만(출하 가능·조건부 출하 가능·출하 불가·판정 불가).
  표 셀에 **파이프 문자를 쓰지 마라** — `\|` 이스케이프를 lint 가 못 본다.
- **소스를 고치면 대장 인용 줄이 밀린다.** 커밋 전 `ledger-lint.sh` 를 돌려 R7 을 확인하라.
- 측정은 전부 **python subprocess + json.dumps** 로. shell 은 이 세션에서 세 번 틀렸다.

### 협업 (피어 세션 nfd-06)
철회를 알리자 **즉시 게시본에 경고 배너를 넣고**, 이어서 정식 NO-GO 로 재렌더했다(label round3-nogo).
「`--force` 로 잰 SEC-70 은 반론 여지가 있다」는 지적을 받아 정상 게이트 경로로 재측정했다.
`00-summary.md` 판정 블록의 대상 커밋이 `b259a0f` 로 낡았고 open 나열에 SEC-75 가 빠졌다는
지적도 받았다 — **아직 안 고쳤다. 다음 정산 때 맞출 것.**

### ⚠ 사용자 결정
- SEC-69 방향: **「config 를 코어 보호 대상에 포함 + 승인 경로화」** 선택받아 반영 완료.
- 진행 방식: **루프 계속(멀티에이전트 포함)** 지시받음.
- 그대로: CI 없음 · GitHub 리모트 없음 · **push 금지 유지** · main 병합 보류.


## 2026-08-21 (라운드 3) — ★ 판정 **출하 가능** · 스펙 갭 2건 · i18n 완주 · 우회 60종 봉인

**정본.** 커밋 5개: `900cc5d`(스펙갭+i18n+가드) · `7152fcf`(문서) · `b53eb7a`(SEC-65/66) ·
`9195a71`(SEC-67) · `b259a0f`(SEC-68). **671 tests green ×3, tsc 0.** 대장 **48행 lint 통과, open 0**.
피어 세션(nfd-06)이 PERF-26 을 재측정해 verified 로 올렸다 → **게이트 13/13**.

- 출하 검증 리포트(재게시됨, label round3-go): https://claude.ai/code/artifact/c6e6ed5c-baf3-4a2a-9779-e5b16592e0d8
- 재감정: https://claude.ai/code/artifact/b34b9d1e-558a-4ca6-9a2a-a457776a6a77 ← **갱신 대기**
- 문서: `fixes-round3.md`(본편) · `fixes-round3-perf.md`(피어) · `evidence/round3-verify.log`(§1~9)

### 이 라운드가 존재한 이유 — 라운드 2의 자기 보고가 틀렸다
「생성 문서 i18n 완료 · 산출물 한국어 0」은 **과다 주장**이었다. 30개 명령만 재고 전 표면이라 불렀다.
**번역이 어려웠던 게 아니라 부분 측정을 전수 측정이라 부른 것이 결함**이다. USE-59 를 정정하고
잔여를 [I18N-62] 로 이관해 닫았다.

### 닫은 것
- **SPEC-60** 스펙 §12 「init 시 allowlist 무력화 경고」 미구현 · **SPEC-61** §10 티어 지침이
  계산만 되고 세션에 전달 안 됨(SessionStart 가 현재 티어 주입 — 상승이 아니라 **서 있는 티어**)
- **LOGIC-63** 턴 로그 앵커가 언어 의존 → **영문 프로젝트에서 발췌 무음 실패**(라운드 2가 만든 회귀)
- **I18N-62** 잔여 8모듈 + 번들 `profiles/` 전량 · **OPS-64** 회귀 가드 부재
- **SEC-65/66/67/68** 우회 4배치 — noclobber `>|` · 변형 명령 안전망 비대칭 ·
  받아쓰기(`curl -o`/`wget -O`/`xargs`/`--write`) · **위치 인자 경로 구멍**(`cp -r /tmp/x src`)

### 최종 실측
- 우회 **10계열 60종 전건 deny** · 의도적 허용 **18종 전건 allow(과차단 0)**
- 영문 기본 산출물 한국어 **0**(회귀 가드 `core/test/i18n-en-default.test.ts`, 오염 주입으로 무는 것 실증)
- 명령 MISSING 0/38 · 침묵 성공 0 · 빌드 바이트 재현 · audit 0 · gitleaks 82커밋 0

### 다음 즉시 할 일
1. **멀티에이전트 재감정 워크플로 수령** (run `wf_3c6381fb-bcb`) — 적대적 5렌즈 + 7항목 독립 채점.
   4.8 미달 항목이 나오면 **루프 재시작**(사용자 지시).
2. 재감정 아티팩트(b34b9d1e) 갱신 — 라운드 3 반영.

### 시스템 지식 (라운드 3) — ⚠ 측정 도구가 세 번 틀렸다
- **shell `grep -c '[가-힣]'`** 이 순수 영문 줄을 한국어로 셌다(migrate 8줄 → python 0줄).
- **shell 인용이 파이프 문자를 먹어** 우회 프로브가 잘못 allow 로 보고했다.
- **backtick** 이 heredoc 안에서 해석돼 로그 작성이 깨졌다.
→ **판정은 전부 python subprocess + json.dumps 로 하라.** 결과가 극적이면 도구부터 의심.
- **런타임 테스트는 실행한 경로만 잰다.** i18n 가드 첫 버전이 오염을 못 잡았다 — 정상 실행이
  오류 경로를 안 지나서다. 「일부러 만든 고장 상태」 절을 넣은 뒤에야 물었다.
- **우회는 열린 집합이다.** 한 배치를 닫으면 다음이 나온다(65/66→67→68). 계열 단위로 덮고
  **경계를 명시**하는 것이 답이다. 의도적 허용(과차단 0)을 같은 무게로 재라 — 과차단하면 하네스를 끈다.
- **위치가 경로임을 말해 주는 자리에서 경로 판별을 요구하지 마라** — `cp -r /tmp/x src` 가 그 구멍이었다.
- 파싱 앵커는 표시 문자열이 아니다 — i18n 하면 파서도 같이 깨진다(LOGIC-63).
- `ledger-lint.sh` 는 표 셀 안의 `\|` 이스케이프를 못 본다. **파이프 문자를 셀에 쓰지 마라.**
  판정 어휘도 고정이다: 출하 가능·조건부 출하 가능·출하 불가·판정 불가.

### 협업 (피어 세션 nfd-06)
파일 소유권을 나눠 충돌 없이 진행했다 — 피어: `latency.log`·`fixes-round3-perf.md`·`report.html` 재게시.
나: 소스·`ledger.md`·`00-summary.md`·`fixes-round3.md`·`progress.md`.
피어가 내 인용 줄 밀림(SEC-33)과 판정 문법 오류를 잡아 줬다. **교차 세션 리뷰가 실제로 작동했다.**

### ⚠ 사용자 결정 (판정 밖)
- CI 없음 · GitHub 리모트 없음 · **push 금지 유지** · main 병합 보류.
- 새 한계 2건: 번들 `profiles/` 는 영문 단일(언어 해석기 없음) ·
  `profiles/*/guidance/`·`rules/` 를 **아무것도 로드하지 않음**(스펙 §9 배선 미구현, README 광고 없음 확인).


## 2026-08-21 (라운드 2) — ★ 생성 문서 i18n 완주 · 재감정 **5/7 도달** · 남은 건 PERF-26 하나

**정본.** 라운드 1 핸드오프의 「다음 즉시 할 일」 2건 중 **i18n 완료**, PERF-26 은 **이번에도 측정 창 없음**.
과정에서 **새 결함 2건**(도움말이 광고하는데 파서가 안 읽던 플래그)을 찾아 닫았다.
**628 tests green ×3, tsc 0.** 커밋 3개: `a7370a7`(i18n+플래그) · `541c1df`(readiness 문서) · `87991bc`(재감정).

- 재감정(갱신됨): https://claude.ai/code/artifact/b34b9d1e-558a-4ca6-9a2a-a457776a6a77
- 출하 검증 리포트: https://claude.ai/code/artifact/c6e6ed5c-baf3-4a2a-9779-e5b16592e0d8
- 새 파일: `docs/release-readiness/2026-08-21/fixes-round2.md` · `evidence/round2-verify.log`

### 닫은 것
- **USE-59** 생성 문서 5종 i18n — `report`(패킷·RTM·허브) · `ship`(대장·체크리스트) ·
  `loop`(브리프·소환문) · `evidence`(Playwright 사양·비교 패킷) · `design`(정본 HTML).
  언어를 진입점에서 한 번 해석해 `Tr` 함수로 넘긴다(줄마다 config 재파싱 방지).
- **범위 밖 누수 3건** — `wave.ts` 지시서 템플릿·`(미지정)` 자리표시자, `tokens.ts` 생성 파일 배너.
  **소스 grep 이 아니라 산출물을 측정했기 때문에** 잡혔다.
- **API-57**(HIGH) `wave create --acceptance` 가 조용히 무시 — 파서는 `--accept` 만 읽었다.
  실패하지 않고 수용 기준만 비어서, 검증자가 「판정 불가」를 내면 **사람이 자기 탓으로 오해**한다.
- **API-58**(MED) `design baseline --png <file>` 성립 불가 — 파서가 위치 인자만 읽어 `--png` 를 경로로 삼음.
- 둘 다 광고 이름을 정본으로, 기존 형태는 별칭 유지. **help↔파서 전수 대조 잔여 0건.**

### 재감정 점수 (rubric 은 착수 전 고정, 변경 없음)
효용성 4.8 ✅ · 실효성 4.8 ✅ · 엔지니어링 4.9 ✅ · 사용성 4.8 ✅ · **상품성 4.4 → 4.8 ✅**
품질 4.6 ❌ · 가성비 4.3 ❌ — **미달 2개는 원인이 하나**(훅 지연 p95 미측정)

### 다음 즉시 할 일 (하나뿐)
**PERF-26 재측정.** 대장 39행 중 유일한 비-verified(+ deferred 1: DEP-32 dev 체인, 사유 있음).
- 절차: `evidence/latency.log` 그대로 재실행 → 폴백 p95 < 150ms 확인 →
  대장 PERF-26 `fixed` → `verified` → G9 초록 = **게이트 13/13** → 품질·가성비 동시 상승 = **7/7**.
- **조건**: `uptime` 1분 load **< 2**. 이번 세션 내내 5~18 이었다(OrbStack·Ollama·VoiceMemos·WindowServer).
  사용자가 「내리겠다」고 했으나 세션 종료 시점에도 OrbStack(pid 98783)·Ollama(pid 768) 기동 중.
- **부하 상태로 재면 안 된다** — 통제 측정이 정상 경로보다 높게 나오는 등 창 자체가 무효가 된다.

### 시스템 지식 (라운드 2)
- **소스 grep 으로 i18n 완료를 판정하지 마라.** `L(en, ko)`·`ko:` 패턴 때문에 오탐이 섞이고,
  더 중요하게는 **범위 밖 파일의 누수를 못 본다.** 샌드박스에서 CLI 를 실제로 돌리고
  stdout·`.harness/`·생성 파일을 `grep -c '[가-힣]'` 하는 것이 유일하게 유효한 판정이다.
- **`--help` 광고와 파서는 갈린다.** `flag()` 는 `--<name>` **정확 일치**라 이름이 한 글자만 달라도
  조용히 무시된다. help.ts 의 `args` 문자열에서 `--flag` 를 뽑아 cli.ts 의 `flag()/has()` 호출과
  기계 대조하는 스크립트가 `evidence/round2-verify.log` §6 에 있다 — 회귀 때 다시 돌려라.
- **G11 은 명령 수준만 셌다.** 그래서 플래그 수준 어긋남이 초록을 통과했다. `gates.md` 에
  「광고 플래그 전수 대조」를 추가했다(목표를 낮춘 게 아니라 세는 법을 넓힌 것).
- `createWave`·`parseWave` 는 **같은 `UNSPECIFIED` 상수**를 써야 한다 — 쓰는 쪽과 읽는 쪽이
  갈리면 저장된 파일과 렌더가 다른 말을 한다.
- `tokens.ts` 생성기는 순수(doc → 문자열)라 `lang` 을 **인자로** 받는다. 결정성 유지
  (같은 doc + 같은 lang → 바이트 동일). `evidence.ts` 순수 검증기 2곳만 영어 고정으로 남는다.
- 아티팩트를 이전 세션 URL 로 갱신하려면 **먼저 `WebFetch` 로 읽어야** 한다(안 읽으면 거부됨).
- 이 세션에서 Bash 작업 디렉토리가 여러 번 리셋됐다 — **절대 경로를 쓰라.**

### ⚠ 사용자 결정
- **완료**: i18n(영문 기본 + `lang: ko`) · LICENSE(MIT) · `--force`(훅 deny + env).
- **유효**: CI 없음 · GitHub 리모트 없음 · **push 금지 유지** · main 병합 보류.
- **요청 대기**: PERF-26 측정을 위한 **조용한 창**(OrbStack·Ollama 종료).


## 2026-08-21 — ★ 출하 검증 라운드 1 완료 · NO-GO → **조건부 출하 가능** · 재감정 4/7 도달

**정본.** 출하 검증(NO-GO, 차단 2건)의 open 16건 + 라운드 중 드러난 3건을 전부 닫았다.
**테스트 584 → 626 green ×3, tsc 0.** 커밋 4개: `5f3b112`(Bash차단+정합성+help/i18n+trace/feedback)
· `0dfd9ca`(i18n 전면+LICENSE+오버헤드+재생 결정성) · 이벤트 타입 · 마무리.

- 리포트: https://claude.ai/code/artifact/c6e6ed5c-baf3-4a2a-9779-e5b16592e0d8
- 재감정: https://claude.ai/code/artifact/b34b9d1e-558a-4ca6-9a2a-a457776a6a77
- 파일: `docs/release-readiness/2026-08-21/` (ledger 36행 lint 통과 · fixes-round1.md · rubric.md)

### 닫은 것 (전건 재측정 — `evidence/round1-verify.log`)
- **SEC-49/50 BLOCKER** — 훅이 Bash 표면에서 파일 쓰기를 안 보던 것. `core/src/bashwrite.ts` 신설,
  추출한 쓰기 대상을 **Write 와 같은 판정 함수**(`judgeWritePath`)로 보낸다. 저널 위조로 사람 없이
  게이트가 열리던 경로도 함께 닫힘. 루트 밖 쓰기·조회는 **의도적으로 허용**(과차단하면 하네스를 끈다).
- **SEC-51**(코어파일 Bash 우회) · **SHIP-52**(`--force` → 훅 deny + `HARNESS_ALLOW_FORCE=1`)
- **OPS-20**(doctor 상시 오탐 — 저널 ts 를 상태에도 사용) · **LOGIC-21**(repair 가 evidence 삭제)
- **FEAT-22** `harness trace` · **FEAT-23** `harness gate feedback` 구현
- **UX-24** `--help` 전면(`core/src/help.ts` 레지스트리 한 벌) · **API-27/29/30** · **SEC-25/28** · **SHIP-31**
- 신규: **DET-53**(재생 비결정) · **OPS-55**(이벤트 타입 18종 미등록 → `doctor --repair` 가 복구 거부)
  · **LOGIC-56**(`gate-invalidated` 미폴드 → 복구가 무효화를 되살림)

### 재감정 점수 (기준은 `docs/release-readiness/2026-08-21/rubric.md`, 착수 전 고정)
효용성 4.5→**4.8** · 실효성 3.5→**4.8** · 엔지니어링 4.9 · 사용성 3.0→**4.8** ✅
품질 **4.6** · 가성비 4.0→**4.3** · 상품성 2.5→**4.4** ❌

### 다음 즉시 할 일 (4.8 미달 3항목 — 원인은 둘뿐)
1. **가성비·품질** — 훅 지연 **조용한 창 재측정**. 이 세션 내내 머신 load 12~17(OrbStack·Ollama)이라
   통제 측정이 정상 경로보다 높게 나오는 등 창이 무효였다. `evidence/latency.log` 절차 그대로
   재실행 → 폴백 p95 < 150ms 확인 → 대장 **PERF-26 을 fixed → verified** 로. 그러면 G9 초록 =
   게이트 13/13 → 품질도 함께 오른다.
2. **상품성** — **생성 문서 i18n**. 예외 메시지는 전량 끝났고 남은 것은 렌더 문서다:
   `report.ts`(리뷰 패킷·RTM·허브) · `ship.ts`(결함 대장·릴리스 체크리스트) 먼저,
   그다음 `loop.ts`(웨이브 브리프) · `evidence.ts`(Playwright 사양·비교 패킷) · `design.ts`(정본 HTML).
   확인: `HARNESS_LANG` 미설정에서 산출물에 한국어 0.

### 시스템 지식 (이번 웨이브)
- **zsh 는 무인용 파라미터 확장을 단어 분리하지 않는다.** `./bin/harness $c` 로 "gate approve" 를
  넘기면 한 덩어리로 들어가 「미구현 명령 48건」이라는 가짜 결함이 나온다. 결과가 극적이면 도구부터 의심.
- `ledger-lint.sh`·`report-html.py` 는 **리포 루트에서** 실행해야 `파일:줄` 인용이 해석된다.
- `report-html.py` 는 `<details>` 를 못 다룬다 — 마크다운 원문에 HTML 태그를 쓰지 마라.
- **테스트가 한국어 문자열을 단언한다(191곳).** `core/test/setup.ts` 가 스위트 전역을 `HARNESS_LANG=ko`
  로 고정해 그대로 유효하게 뒀다. 영문 기본값은 별도 테스트가 env 를 해제하고 본다.
- i18n 예외 2곳(`tokens.ts`·`evidence.ts` 순수 검증기)은 `root` 가 없어 영어 고정 — 파일 주석에 사유.
- 감정서 `docs/appraisal/2026-08-21-plugin-appraisal.html` 는 `bbbb9b6` 기준이라 여러 판정이 낡았다.
  대조표는 재감정 아티팩트 §04 와 `00-summary.md` 「감정서 대조」에 있다.

### ⚠ 사용자 결정 (이번 세션에 받은 것)
- i18n = **영문 기본 + `lang: ko`** · LICENSE = **MIT** · `--force` = **훅 차단 + env 로만 허용** → 전부 반영 완료.
- 남은 결정: **CI 없음** · GitHub 리모트 없음 · **push 금지 유지** · main 병합 보류.


## 2026-08-21 — ★ 출하 검증 완료 (11축) · **판정 NO-GO** · 차단 결함 2건

**정본.** `/verifying-production-readiness` 를 대상 `e860460` 에 대해 11축 전부 수행.
산출: `docs/release-readiness/2026-08-21/` (00-summary · ledger 33행 · 축파일 11 · 99-final ·
evidence 8종). **lint 통과**(R1–R7, open BLOCKER 2). 아티팩트:
https://claude.ai/code/artifact/c6e6ed5c-baf3-4a2a-9779-e5b16592e0d8

### 🔴 출하 차단 2건 — 뿌리는 하나: **훅이 Bash 표면에서 파일 쓰기를 안 본다**
- **[SEC-50]** 설계 트랙 소스 쓰기 금지가 Bash 로 무력화. `Write`→`src/app.ts` 는 deny 인데
  `echo "x" > src/app.ts`·heredoc·`touch` 는 **허용**. deny 메시지가 모델을 그 경로로 민다.
- **[SEC-49]** `echo '{"ts":"…","type":"phase-set","data":{"phase":"P7"}}' >> .harness/events.jsonl`
  + `harness doctor --repair` → **phase P7 로 위조**, 설계 트랙 해제. `gate-approved` 를 같은 방식으로
  넣으면 **사람 승인 없이 게이트가 approved** 가 된다. mcp.ts 가 코드 불변식까지 써서 지킨
  §4-3 안전 속성이 Bash 두 줄로 우회된다.
- 위치: `core/src/hook.ts:395` (Bash 분기가 `design_blocked_bash` 배포 명령만 본다).
- **완화 방향**(리포트 06 절): Bash 명령 문자열에서 쓰기 대상 추출 → `.harness/` 코어 파일과
  설계 트랙 소스 경로가 등장하면 deny. 완전 파싱은 불가하나 **모델이 자연히 가는 경로**는 닫힌다.

### 그 밖 open (HIGH 5 · MED 5 · LOW 2)
- **[OPS-20]** 게이트 승인 후 `doctor` 가 **영구히** `gates 불일치`·exit 1 — 승인 시각을
  `gate.ts:134` 와 `events.ts:25` 가 따로 찍는다. 상시 오탐이 SEC-49 위조를 숨긴다.
- **[LOGIC-21]** `doctor --repair` 가 게이트 `evidence`·`submittedAt` 삭제 — 저널엔 있는데
  재생 리듀서(`events.ts:74`)가 안 쓴다.
- **[FEAT-22]** `harness trace` 미구현(스펙·`agents/wave-verifier.md:31` 이 호출) ·
  **[FEAT-23]** `harness gate feedback` 미구현(**공개 README 4개 언어가 광고**).
- **[UX-24]** `--help`·`-h`·`help`·무인자 전부 exit 1 — 사용법 출력이 아예 없다.
- **[SEC-51]** 코어 파일 보호가 Write/Edit 표면만 · **[SHIP-52]** `phase set --force` 자기해제
  경로가 Bash 로 열려 있음 · **[SEC-25]** 게이트 산출물 경로가 루트 밖이어도 승인됨 ·
  **[PERF-26]** 폴백 경로 10만건 p95 169ms · **[API-27/29/30]**·**[SEC-28]**·**[SHIP-31]**.

### 통과한 것 (재확인 불필요 — 대장 verified 16행)
584 tests ×3 동일 · tsc 0 · **빌드 바이트 재현** · 맨 클론 설치 · **롤백 리허설 실제 성공** ·
gitleaks 71커밋 0 · 프로덕션 취약점 0 · 훅 무해/비간섭 전건 · **MCP 경로 게이트 승인 불가** ·
CLI 출력 계약 · 패키징 누락 0 · 침묵 catch 5/5 문서화.

### 다음 즉시 할 일
1. **SEC-49·SEC-50 수정** — `hook.ts` Bash 분기에 쓰기 대상 검사 추가 + 건별 회귀 테스트.
   수정 후 `evidence/final.log` 의 재현 시퀀스가 **deny 로 뒤집히는지 재측정**(Iron Rule 4).
2. 새 라운드 파일 `docs/release-readiness/2026-08-21/fixes-round1.md` 에 기록.
   **기존 축 파일·ledger 행은 상태만 갱신**(open→fixing→fixed→verified), 라운드 파일은 새로 만든다.
3. 재진입 첫 명령: `bash /Users/wjang/.claude/skills/verifying-production-readiness/bin/ledger-lint.sh docs/release-readiness/2026-08-21/`
   (**반드시 리포 루트에서** — 경로 인용이 루트 상대다).

### ⚠ 사용자 결정 대기
- **LICENSE 없음** — 공개 마켓플레이스 배포인데 라이선스가 없으면 "모든 권리 유보"다.
- **CLI·훅 출력 한국어 전용** — README 만 4개 언어. 글로벌 배포면 i18n 이 선결.
- **CI 없음** · GitHub 리모트 없음 · **push 금지 유지** · main 병합 보류.
- **`--force` 를 남길지** — 정당한 탈출구지만 접근 제한이 없다(SHIP-52).

### 시스템 지식 (이번 웨이브)
- **zsh 는 무인용 파라미터 확장을 단어 분리하지 않는다.** `./bin/harness $c` 로 "gate approve" 를
  넘기면 한 덩어리로 들어가 「미구현 명령 48건」이라는 **가짜 결함**이 나온다. 결과가 너무
  극적이면 도구부터 의심하라.
- `ledger-lint.sh`·`report-html.py` 는 **리포 루트에서** 실행해야 `파일:줄` 인용이 해석된다.
- 이전 감정서 `docs/appraisal/2026-08-21-plugin-appraisal.html` 는 `bbbb9b6`(198 tests) 기준이라
  「게이트 미구현」·「한국어 전용 README」·「67MB 배포」가 전부 낡았다. 대조표는 00-summary 에 있다.
- 파일 하나 = `docs/release-readiness/readiness.md`(구, `bbbb9b6`)는 **승계하지 않았다.**
  새 대장 ID 는 20번부터라 충돌 없다.


## 2026-08-21 — ★ 로드맵 §13.2~§13.8 완주 (13/13, 커밋 8개, 584 tests green)

**정본.** 사용자 지시(/ultragoal)대로 **로드맵 남은 전부를 구현 완료**. 테스트 **198 → 584 green**, tsc0.

- **커밋 8개**: `2e90344` gate+registry · `38432fd` 게이트 계약 테스트 반영 · `7ae08bd` report+adr ·
  `e00d96b` tokens+skills · `8e6a55c` design+profile · `5a4589b` loop+evidence ·
  `7c3b00d` ship+usage+migrate · `44d914c` P12스킬+readiness-auditor · `56b769e` MCP 어댑터
- **신규 코어 모듈 13개**: gate registry report adr tokens design profile evidence loop ship
  usage migrate mcp
- **CLI 명령군**: gate doc report adr tokens design profile evidence loop ship usage migrate
- **스킬 10종**(king-wjang-harness + phase-p0~p6 + p10 p11 p12) · **에이전트 5종**(researcher
  design-auditor wave-executor wave-verifier readiness-auditor) · **MCP 도구 16종**
- **최종 통합 검증(맨 클론 = 실제 배포 경로, 빌드·node_modules 없이)**: `--version`·`init`·`status`
  정상, 훅 exit 0, **MCP tools/list 정상**, **`.harness/` 없는 프로젝트에서 0바이트 침묵**(비간섭).
- **핵심 안전 속성 실증**: **MCP 로 게이트 승인 불가** — 승인 시도 후에도 게이트가 `submitted` 유지.
  (§4-3 "최종 클릭은 사람" 장치가 MCP 로 우회되지 않음을 실행으로 확인.)

### 다음 즉시 할 일
- 구현은 완료. **전체 출하 검증**(`/verifying-production-readiness`)을 새 세션에서 돌릴 것을 권장 —
  이번엔 축이 훨씬 넓어졌다(게이트·원장·디자인시스템·루프·출하·MCP).
- ultragoal 원장은 여전히 `0/13 complete` 로 보인다 — `/goal` 미설정으로 checkpoint 가 막혔기 때문.
  **실제 진행은 git 커밋이 정본**이다. 아래 확인 대기 참조.

### ⚠ 확인 대기 (사용자만 가능)
- **`/goal` 미설정** — ultragoal checkpoint 가 `/goal` 스냅샷을 요구하는데 슬래시 명령은 모델이 못 건다.
  없는 활성 목표를 지어내지 않았다. 원장 동기화를 원하면:
  `/goal Complete all ultragoal stories in .omc/ultragoal/goals.json`
- GitHub 리모트 없음 · LICENSE 없음 · **push 금지 유지** · main 병합 보류 (이전 결정 그대로).

## 2026-08-21 — 로드맵 §13.2~13.8 구현 (12/13 완료, 커밋 6개, 563 tests green)

**최신 정본.** 아래 이전 섹션들은 그 시점 기록.

- **완료 G001~G012** — 커밋 `2e90344`(gate+registry) `7ae08bd`(report+adr) `e00d96b`(tokens+skills)
  `8e6a55c`(design+profile) `5a4589b`(loop+evidence) `7c3b00d`(ship+usage+migrate).
  **테스트 198 → 563 green**, tsc0. 매 스토리 E2E 실측 통과.
- **신규 코어 모듈 12개**: `gate registry report adr tokens design profile evidence loop ship usage migrate`
- **신규 CLI 명령군**: `gate|doc|report|adr|tokens|design|profile|evidence|loop|ship|usage|migrate`
- **신규 스킬**: phase-p0~p6 (7종) + p10-harden·p11-deploy. **에이전트 4종**: researcher·
  design-auditor·wave-executor·wave-verifier.
- **진행 중(서브에이전트 2)**: ① `skills/phase-p12-ship` + `agents/readiness-auditor.md`
  (G011 에이전트가 남기고 종료한 조각) ② **G013 패키징·MCP 어댑터**(`core/src/mcp.ts`+`mcp/server.js`,
  의존성 무추가 stdio JSON-RPC 직접 구현 지시).
- **다음 즉시 할 일**: 두 에이전트 수령 → 배선·green 재측정 → 커밋 → **13/13 완주**.
  이후 전체 통합 검증(맨 클론 설치 E2E) 권장.

### ⚠ G013 안전 요구 (반드시 확인할 것)
**MCP 로 게이트 승인이 가능하면 §4-3 "승인의 최종 클릭은 사람" 장치가 통째로 우회된다.**
지시문에 `harness_gate_approve` 를 목록에서 빼거나 거부 반환하도록 명시했다 — 수령 시 **실제로
그렇게 됐는지 반드시 검증**하라(이게 뚫리면 하네스의 핵심 강제가 무의미해진다).

### 시스템 지식 (이번 웨이브 추가)
- **에이전트가 산출물 일부를 빠뜨리고 끝날 수 있다** — G011 이 ship.ts 는 냈지만 p12 스킬·
  readiness-auditor 를 안 만들고 종료. **완료 알림을 믿지 말고 파일 목록을 직접 확인**하라.
- **타입 불일치는 배선 때 드러난다** — `recordDeployment.evidence` 가 `string[]` 인데 CLI 에서
  `string` 을 넘겨 tsc 가 잡음. 배선 전 `grep`으로 시그니처 확인이 빠르다.
- 시간·홈 경로는 **파라미터로 주입**하게 만들면 결정적이고 테스트 가능해진다(usage.ts·migrate.ts).
- 코어에 넣지 않기로 한 것(의도적): launchd/systemd 잡 설치, usage API 네트워크 호출,
  Playwright 실주행, 캔버스 WebFetch — 전부 CLI/에이전트 몫(코어는 순수 로컬·결정적, §1).

## 2026-08-21 — 로드맵 §13.2~13.8 구현 (8/13 완료, 커밋 4개, 446 tests green)

**최신 상태.** 아래 이전 섹션(G001~G004)은 그 시점 기록이며 진행분은 여기가 정본.

- **완료 G001~G008** — 커밋 `2e90344`(gate+registry) `7ae08bd`(report+adr) `e00d96b`(tokens+skills)
  `8e6a55c`(design+profile). **테스트 198 → 446 green**, tsc0, 각 스토리마다 E2E 실측 통과.
  - §13.2 게이트·리뷰패킷·RTM·허브 ✅ / §5 ADR ✅ / §13.3 설계스킬 P0–P6 + 에이전트 2종 ✅
  - §13.4 토큰 파이프라인 + Claude Design 연동 ✅ / §13.5 스택 프로파일 ✅
  - 신규 코어 모듈 8개: `gate registry report adr tokens design profile` (+ 기존)
  - 신규 CLI 명령군: `gate|doc|report|adr|tokens|design|profile`
  - 신규 훅 강제: raw 값 리터럴 차단·디자인시스템 동결 경로 차단·프로파일 배포명령 차단
    (앞 둘은 config `block_raw_values`/`design_system_frozen_roots` 로 켠다, 기본 off=비간섭)
- **진행 중(서브에이전트)**: G009 웨이브 실행 루프(`core/src/loop.ts` + `agents/wave-executor.md`·
  `wave-verifier.md`), G010 시각 증적(`core/src/evidence.ts`).
- **다음 즉시 할 일**: G009·G010 수령 → CLI/훅 배선(**컨트롤러가 직접**) → green 재측정 → 커밋 →
  G011 출하 트랙 · G012 흡수 컴포넌트(token-guard·auto-retry) · G013 패키징(MCP 어댑터 포함) 순차.

### 시스템 지식 (이번 웨이브 추가)
- **에이전트 완료 알림의 `<result>` 는 비어 있다** — 산출은 파일·테스트로 직접 확인해야 한다.
- **에이전트가 아직 쓰는 중인 파일을 건드리지 마라.** 테스트 1건 실패를 발견했을 때 `stat -f %m` 으로
  mtime 을 보고 60초 무변경까지 기다렸더니 에이전트가 스스로 고쳤다(성급히 손대면 충돌).
- **E2E 는 올바른 전제 조건에서 실행해야 유효하다** — P0(설계 트랙)에서 raw 값 차단을 테스트하니
  설계트랙 소스 차단이 **먼저** 걸려 신규 규칙이 실행조차 안 됐다. `phase set P7 --force` 로 옮겨야 검증됨.
- **코어는 네트워크·브라우저를 쓰지 않는다**(§1) — Claude Design 캔버스는 에이전트가 WebFetch 로 받아
  파일로 넘기고(`design sync --from <파일>`), Playwright 도 코어는 스펙 생성·증적 검증만 한다.
- 번들 프로파일 경로는 `dist` 에서도 해석돼야 한다(`bundledProfilesDir()`), E2E 로 실증함.

## 2026-08-21 — 로드맵 §13.2~13.8 구현 착수 (ultragoal 13스토리, G001~G004 완료)

**사용자 지시(/ultragoal): §13.2~§13.8 전부를 서브에이전트로 설계·구현하고 테스트 green 유지.**
규모가 남은 제품 전부라 **한 세션에 안 끝난다** — ultragoal 원장으로 세션 넘김 가능하게 세움.

- **원장**: `.omc/ultragoal/{goals.json,ledger.jsonl}` — 13스토리 등록(G001 게이트코어 · G002 레지스트리 ·
  G003 리뷰패킷/RTM/허브 · G004 ADR · G005 설계스킬P0-P6 · G006 토큰파이프라인 · G007 ClaudeDesign연동 ·
  G008 스택프로파일 · G009 웨이브루프 · G010 시각증적 · G011 출하트랙 · G012 흡수도구 · G013 패키징).
  `omc ultragoal status` 로 조회.
- **완료 G001~G004** (§13.2 게이트·리뷰패킷 **완료**, §5 ADR **완료**):
  - `2e90344` gate.ts(submit/approve/verify/sweep, 해시고정→변조 자동무효화, **출하트랙 measured 강제**,
    canEnterPhase/setPhaseViaGate) + registry.ts(DOC-x, **artifact_url 없이 submitted 불가**, 개정=새버전+superseded)
  - `7ae08bd` report.ts(리뷰패킷·**RTM 갭 자동표시**·허브) + adr.ts(**선택지 2~4 강제**·**기각사유 필수**·
    개정 시 STALE 전파+unverifiable 보고)
  - CLI 배선 완료: `gate|doc|report|adr` 명령군. `gate submit` 이 `.harness/packets/<P>.md` 자동 생성.
  - **테스트 198 → 339 green**, tsc0. E2E 실측 전건 기대대로.
- **진행 중**: G005(설계 트랙 스킬 P0–P6 + researcher·design-auditor 에이전트, `skills/phase-*` `agents/*`),
  G006(토큰 파이프라인 `core/src/tokens.ts` — 생성기·raw값 탐지·동결·스왑드릴). 둘 다 서브에이전트.
- **다음 즉시 할 일**: G005·G006 결과 수령 → CLI/훅 배선(내가 직접, 충돌 방지) → green 재측정 → 커밋 →
  G007(Claude Design 연동)·G008(스택 프로파일) 병렬 착수. 이후 G009~G013 순차.

### ⚠ 확인 대기 (사용자만 가능)
- **`/goal` 미설정** — ultragoal checkpoint 가 `/goal` 스냅샷을 요구하는데 슬래시 명령은 내가 못 건다.
  **없는 활성 목표를 지어내지 않았다**(원장에 거짓 기록 금지). 사용자가 아래를 입력하면 일괄 checkpoint:
  `/goal Complete all ultragoal stories in .omc/ultragoal/goals.json`
  안 걸어도 구현은 진행되며 **실제 증거는 git 커밋**이다.
- GitHub 리모트 없음 · LICENSE 없음 · push 금지 유지 · main 병합 보류 (이전 섹션 그대로).

### 시스템 지식 (이번 웨이브)
- **병렬 서브에이전트는 파일 완전 분리**가 절대 조건. 공유 타입(`types.ts`)·경로(`paths.ts`)는
  **컨트롤러가 먼저 확정**하고 던져야 충돌이 없다. CLI 배선도 컨트롤러가 직접(에이전트에게 주면 충돌).
- **계약 변경은 기존 테스트를 깬다** — `phase set` 을 게이트 경유로 바꾸자 cli.test.ts 2건 실패.
  회귀가 아니라 의도된 계약 변경이므로 테스트를 새 계약(`--force` 부트스트랩 탈출구)에 맞췄다.
- `phase set --force` = 게이트 검사 우회(부트스트랩·복구용), 이벤트에 `forced:true` 기록.
- 서브에이전트 완료 알림의 `<result>` 는 비어 있다 — 실제 산출은 **파일·테스트로 직접 확인**해야 한다.

## 2026-08-21 — 재확인: JA/ZH 번역 실제 착지 확인 (읽기 전용 점검)

이전 세션에서 JA/ZH 번역 에이전트가 '중단됨'으로 보고됐으나, **실제로는 파일을 완성하고
커밋(`f8b1516`)까지 됐음을 실측 확인**했다 — 4개 언어 전부 10섹션·mermaid 1·표 28행 일치,
언어 스위처 정상. 재작업 불필요. (교훈: 에이전트 '중단' 알림 ≠ 산출물 유실 — 디스크를 먼저 보라.)

**남은 것은 전부 사용자 결정**: GitHub 리모트 없음 · LICENSE 없음 · README `<this-repo>`
플레이스홀더 4곳(리모트 확정 시 일괄 치환) · main 병합 보류 · push 금지 유지 ·
ultragoal 원장은 `/goal` 미설정으로 0/13 표시(실제 진행은 git 커밋이 정본).
**권장 다음 작업**: 넓어진 표면(게이트·원장·디자인시스템·루프·출하·MCP)에 대한 전체 출하 검증.

## 2026-08-21 — GitHub 런칭 README 4개 언어 + 아티팩트 (자율모드 완주)

**사용자 지시: "GitHub 올릴 README를 개발자가 혹할 만하게, 다국어로" + 이후 "자율모드로 끝까지".**
- **신규 README 4종**: `README.md`(EN 마스터·프론트) / `README.ko.md` / `README.ja.md` / `README.zh.md`.
  상단 언어 스위처 상호 링크. 기존 기술 README 내용(설치·명령·상태저장소)은 전부 흡수.
  구성: 훅 강제 vs 스킬 권고 **벤치마크 표**, 동작 방식(mermaid), **디자인 시스템 & Claude Design**,
  보증 불변식 + 실측표, 사용자 관점 사용법, 명령 레퍼런스, 상태·로드맵, FAQ.
- **정직성 원칙 확정(사용자 선택 "풀 비전 + 명확한 로드맵 라벨")**: v0 구현분은 ✅, 스펙 §7/§8
  (디자인 시스템·Claude Design 연동)은 **"By design (roadmap)" 라벨**로 명확히 분리 —
  미구현을 구현된 것처럼 쓰지 않는다. 로드맵 항목은 스펙 §13(8단계)에 정렬.
- **아티팩트(4개 언어 단일 페이지·언어 스위처)**: https://claude.ai/code/artifact/d7f23867-9a1a-4d57-bb3b-66337208cd38
  디자인: 철도 신호소 모티프(주제 = "unsafe route를 물리적으로 불가능하게"), Archivo+Source Serif 4+
  JetBrains Mono, 시그널 앰버 강조, 라이트/다크 토큰 양방향.
- **커밋**: 아래 참조(이 섹션 갱신과 함께 커밋).
- **⚠ 함정·지식**: ① 번역 서브에이전트(JA)가 **본문만 번역하고 h2/h3 헤딩·표 헤더를 영어로 남김** —
  구조 카운트(h2 수·표 수)만으로는 못 잡고 **헤딩 목록을 눈으로 대조**해야 발견됨(수정 완료).
  ② 아티팩트 빌드: `marked`를 `npm i --no-save`로 설치(package.json 무오염, node_modules는 gitignore).
  빌드 스크립트는 scratchpad(`build-artifact.js`) — 원문 상단 스위처 줄 제거 + ```mermaid →
  `<pre class="mermaid">`(아티팩트 네이티브) 변환이 핵심. ③ pandoc·python-markdown 이 장비에 없음.

### 확인 대기 (사용자 결정 필요 — 자율 진행 불가)
- **GitHub 리모트 없음**(`git remote -v` 비어 있음) → 실제 호스팅 위치 미정. README 설치 안내의
  `<this-repo>` 플레이스홀더도 실제 URL로 치환 필요.
- **push 여부** — 지시 전 금지 유지 중(리모트도 없음).
- **LICENSE 파일 없음**·package.json에 license 필드 없음 → 라이선스 선택은 사용자 몫
  (README "License & author" 절이 저장소 라이선스를 참조하므로 공개 전 필요).
- **main 병합** — 이전 세션 **보류** 확정 그대로 유지.

## 2026-08-20 — 하네스 운영 스킬 신설·검증·커밋 완료 (`cb4b0ac`, 사용자 지시)

**커밋 `cb4b0ac`** (사용자 "미커밋 전체 함께 커밋" 선택): 스킬 + `.claude-plugin/` +
경량 readiness 정본(readiness.md·evidence·report.html, 구 11축 감사 13파일 삭제) + progress.md.
23 files, +403/−1385. 소스 무변경(dist 무변경). **push 안 함**(지시 전 금지 유지) —
브랜치 `feature/core-engine-v0`. main 병합도 여전히 **보류**(이전 세션 확정, 변경 없음).
다음 즉시 할 일: 없음 — 사용자가 push/병합/추가작업 지시 시 진행.

**작업 경위** — 브레인스토밍→작성→RED/GREEN 검증→갭 수정.
- **결정(사용자)**: 범위 = **풀 운영 매뉴얼**, 위치 = **플러그인 동봉**, 이름 = **`king-wjang-harness`**.
- **신규(미커밋)**: `skills/king-wjang-harness/SKILL.md`. 플러그인 루트 `skills/`(source `"./"`) →
  `hooks/hooks.json`처럼 **자동 발견**(plugin.json에 skills 키 불필요). 호출 `king-wjang-harness:
  king-wjang-harness` 또는 description 트리거로 자연어 활성. 내용: 부트스트랩·전 명령 퀵레퍼런스·
  페이즈 모델(P0–P6 설계/P7–P9 구축/P10–P12 출하)·훅 deny/block 대처표·함정. **`cli.ts`·`hook.ts`·
  `types.ts` 실물 대조**해 작성.
- **검증 완료(RED-GREEN-REFACTOR)**: ① 내 **직접 CLI 실증**(샌드박스)으로 refs 선등록 가드·UX 증적
  게이트·P0 소스 deny·코어파일 deny·루트 md allow 전부 확인. ② **RED**(스킬 없이 README만) 서브에이전트
  = 목표 6(웨이브 complete) **완전 실패**(UX 증적 추가법을 못 찾고 "손편집 금지" 때문에 미완 방치),
  페이즈 트랙·refs 규칙 판정 불가. **GREEN**(스킬 제공) = 6목표 전부 달성. → 스킬이 정확히 그 갭을 메움.
  ③ **REFACTOR 반영 2건**: (a) UX 증적은 harness 명령이 아니라 **직접 파일로** 넣는다(코어 3파일
  손편집 금지와 무관)를 명시, (b) `--help` 없음·표가 유일한 명령 출처 명시.
- **다음 즉시 할 일**: 사용자 **커밋 여부 확인**(규율대로 **커밋/push는 지시 대기**). 커밋 시 기존
  미커밋분(`.claude-plugin/`·`docs/release-readiness/`·구 감사 staged 삭제·`progress.md`)과 함께 결정.
- **⚠ 지식**: 플러그인 스킬은 세션 시작 시 로드 → 이 스킬도 **재시작/새 세션부터** 자연어 트리거 활성.
  서브에이전트 async 결과는 알림 `<result>`에 안 실림 — 회수는 에이전트가 `SendMessage(to:"main")`
  해야 도착(내 평문 요청만으론 안 옴). 검증은 **내 직접 CLI 실증이 가장 확실**(관측·재현 완전 통제).

## 2026-08-20 — 플러그인 설치 완료 (사용자 지시)

**king-wjang-harness 를 Claude Code 플러그인으로 설치.** 마켓플레이스 채널(이전 "미정") 해소:
- **신규 매니페스트(미커밋)**: `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`
  (co-located, `source: "./"`). 실 설치본 스키마를 gsd/superpowers 예시에서 대조해 작성.
- **설치**: `claude plugin marketplace add <repo>` → **Directory 소스**(라이브 워킹트리 참조, 클론
  아님 → 미커밋 매니페스트도 인식·동작) → `claude plugin install king-wjang-harness@king-wjang-harness`.
  **scope: user(전역)·enabled.** 컴포넌트: **Hooks 4(Session/Pre/Post/Stop)**, ~0 토큰.
- **안전성**: 전역이어도 비간섭 불변식(LOGIC-01, 이번 감사서 실측)으로 `.harness/` 없는 프로젝트엔
  완전 침묵 → 프로젝트별 `harness init` 로만 활성. **이 dev repo 자체엔 init 금지**(자기참조: 설계
  페이즈 중 자기 core/src 편집이 막힌다).
- **⚠ 발효 시점**: 훅은 세션 시작 시 로드 → **현재 세션엔 미발효, 재시작/새 세션부터 적용.**
- **⚠ Directory 소스**: 플러그인이 이 repo 경로를 라이브 참조 → repo 이동·삭제 시 깨짐.
  타 장비/클론 재설치엔 `.claude-plugin/` 커밋 필요(현재 미커밋). 제거: `claude plugin uninstall
  king-wjang-harness@king-wjang-harness` + `claude plugin marketplace remove king-wjang-harness`.

## 2026-08-20 — 경량 모드 재검증(사용자 지시: 정식감사 폐기·경량 새시작) → 판정 출하 가능(GO)

**사용자가 기존 11축 정식 감사 산출물을 폐기하고 경량 모드로 새로 검증하라고 지시.** 수행 완료.
- **폐기**: `docs/release-readiness/2026-08-20/` 전체를 `git rm`(워킹트리에서만 제거, **커밋 안 함** —
  `bbbb9b6`에 커밋돼 있어 `git show bbbb9b6:...`로 언제든 복구). 커밋 여부는 사용자 결정 대기.
- **신규 정본**: **`docs/release-readiness/readiness.md`** 단일 파일(경량 모드 골격). 축 ④⑧⑨ + ②·⑦
  (변경이 닿는 축). 뺀 축 ①③⑤⑥⑩⑪은 파일 「보지 않은 것」에 사유 기재.
- **판정: 출하 가능(GO)** — 신규 BLOCKER 0. **정적 감사가 아니라 빌드된 `bin/harness`를 실제 훅 표면
  (stdin JSON)에서 구동한 E2E 23건 전건 PASS**로 뒷받침(Iron Rule 3). 게이트 9종 전건 measured:
  G1 테스트 198×3 동일·G2 tsc0·G3 빌드·G4 훅무해·G5 훅강제력·G6 결정성·G7 자체완결dist(무 node_modules)·
  **G8 공급망 0 vulns**(npm audit --omit=dev)·**G9 훅지연 p95 104ms**(<150ms). 근거는 `evidence/*.log`.
- **대장**: 불변식 15행(심각도 —·verified·measured 확인 대장) + deferred 1(SEC-02 realpath TOCTOU,
  "훅은 보안경계 아닌 사고방지" 계약 범위라 비차단). **ledger-lint: ✓ 16행 R1–R7 통과·open BLOCKER 0.**
- **아티팩트(신규)**: https://claude.ai/code/artifact/3628dd71-1a71-411b-be91-4093382baa5d
  (이전 정식감사 아티팩트 332d40fb…는 폐기 대상이라 갱신 안 함 — 별건).
- **미커밋 워킹트리**: (staged 삭제) 구 감사 13파일 / (신규) `readiness.md`·`evidence/`·`report.html` /
  (수정) `progress.md`. **커밋·push는 지시 대기.** main 병합은 직전 세션에서 **보류** 확정(변경 없음).
- **다음 즉시 할 일**: 없음(검증 완결). 사용자가 커밋/병합/추가감사 지시 시 진행.
- **⚠ 함정(경량 모드 lint)**: readiness.md 는 표 컬럼 8개(`ID|심각도|축|한줄|상태|근거등급|근거|닫은증거`)
  고정. measured 행은 근거·닫은증거에 **실존·비어있지않은 파일** 최소 1개 인용해야 R1 통과 → 그래서
  실측 출력을 `evidence/*.log`로 남기고 인용함. 판정줄 `**판정** 출하 가능 · …`는 장식 없는 순수 어휘.

## 2026-08-20 — 재진입 재확인(/verifying-production-readiness): 커밋된 GO 라이브 재측정

**판정 유지: 출하 가능(GO), 이번엔 라이브 재측정으로 재확인.** 직전 세션의 lint 수정은
이미 **커밋 완료**(`bbbb9b6`) — 아래 이전 섹션의 "미커밋" 기록은 그 시점 것으로 **낡음**.
현재 워킹트리 clean, HEAD는 docs-only, 마지막 제품코드 커밋은 `8d261d3`.
- **재진입 lint 재실행**: `ledger-lint.sh docs/release-readiness/2026-08-20` → **✓ 45행 R1–R7
  통과·open BLOCKER 0**. 판정 토큰은 순수 `## 출하 가능`(★ 제거분 반영됨).
- **라이브 재측정(경량, 제품코드 무변경이라 이 둘만 의미)**: G1 `vitest run` **198 passed(12파일)**·
  G2 `tsc --noEmit` **exit 0**. 무거운 게이트(G9 훅p95·G10 대형저널·G11/12 설치·롤백·G4 공급망·
  G5 이력비밀)는 `8d261d3` 이후 제품코드 무변경이라 이전 measured 유효(재실행 불필요).
- **병합 결정: 보류(b)** — 이번 세션에서 사용자가 **보류** 선택. 병합·push·PR 모두 안 함.
  브랜치 `feature/core-engine-v0` 그대로 유지, GO 판정만 확정. push는 지시 전 금지 유지.
  (재개 시 다시 물을 필요 없음 — 사용자가 새로 병합/PR 지시할 때까지 대기.)
- **함정 재확인**: ledger-lint R6는 판정 토큰의 어떤 장식(★·볼드)도 거부 → 순수 어휘여야.
  재진입 시 판정 전 lint 필수(커밋된 상태가 위반일 수 있음 — 직전 세션이 실제로 겪음).

## 2026-08-20 — 재진입 검증(/verifying-production-readiness): 커밋된 대장 lint 위반 발견·수정

**판정 유지: 출하 가능(GO).** 재진입 규칙대로 판정 전 lint 재실행 → **커밋 `81639a1`의 대장이
실제로는 R6 위반**이었음을 발견(이전 세션 "lint 통과" 기록은 스킬 진화 전 상태). 원인·수정:
- **R6 위반**: 판정 토큰이 `★ 출하 가능` — `★` 장식이 고정 어휘 접두 매칭을 깨 「판정 어휘 인식
  불가」. 스킬 규칙상 **lint 미통과 대장으로 낸 판정은 무효**.
- **수정(형식만, 판정 불변)**: `ledger.md:3`·`00-summary.md:8`에서 `★` 제거 → `출하 가능` 순수 토큰.
- **재측정**: `ledger-lint.sh` → **✓ 45행 R1–R7 통과, open BLOCKER 0**. G1 테스트 **198 passed
  (12파일)**·G2 tsc exit 0·dist yaml 인라인(SHIP-11 함정 clear) 재확인. 무거운 게이트(G9 훅p95·
  G10 대형저널·G11/12 설치/롤백·G4 공급망·G5 비밀)는 제품코드 무변경이라 이전 measured 유효.
- **미커밋**: `ledger.md`·`00-summary.md`(lint 수정) + `progress.md`. **커밋/push는 지시 대기.**
  단 lint 수정은 어느 병합 경로든 feature 브랜치 HEAD를 lint-valid로 만들어야 하므로 함께 커밋 대상.
- **다음 즉시 할 일**: 사용자 병합 결정(a 로컬병합/b 보류/c PR) 대기. 결정 후 lint 수정 커밋 동반.
- **⚠ 새 함정**: **ledger-lint R6는 판정 토큰의 어떤 장식(`★`·볼드 등)도 거부** — `**판정** 출하 가능 ·`
  처럼 순수 어휘여야. 재진입 시 판정 전·후 lint 필수(이번처럼 커밋된 상태가 위반일 수 있다).

## 2026-08-20 — ★★ 출하 검증 "출하 가능" 승급 완료 (HIGH 3건 전부 verified 종결)

**판정: 출하 가능** — BLOCKER 0·HIGH 0·전 게이트 재측정 PASS(198×3, 훅 p95 57ms). 수정 커밋:
- `b5d6248` F1: LOGIC-10/11(HIGH fail-open)·SEC-13 — 리뷰 Approved
- `2efe05d` F2: API-10=LOGIC-12·USE-01·API-12·OPS-11·LOGIC-16 — 리뷰 Approved
- `74df666` F3: SEC-10/11/12 주입 격리(sanitize 헬퍼·본문 nonce) — 리뷰 Approved
- `2f0456d` F3 리뷰 Minor 회귀: sanitizeUntrusted String() 강제(비문자열 backtrack.reason)
- `8d261d3` SHIP-11(사용자 결정 dist 커밋)+SHIP-12(README): **yaml 번들 인라인**으로
  self-contained dist — node_modules 없는 순수 클론서 하네스 실동작 E2E 검증(dist-only는
  yaml external이라 여전히 inert였던 것을 실행으로 발견·수정).
- **최종 보고서 아티팩트**: https://claude.ai/code/artifact/332d40fb-4f25-4be3-bc88-ac2730207c4a
- **대장 기계 검증 통과**(`81639a1`): 신버전 스킬 `ledger-lint.sh`(R1–R7) 실행 — 초기 16건 위반
  (어휘 볼드·(승격)/(부분) 접미사·deferred 사유 누락·이월 measured 인용 미해결) 전부 형식 문제,
  수정 후 "45행 R1–R7 통과, open BLOCKER 0". GO 기계 유효(LOGIC-02는 근거가 코드뿐→measured 강등).
  **재진입 세션은 판정 전·직후 lint 재실행 필수:**
  `bash ~/.claude/skills/verifying-production-readiness/bin/ledger-lint.sh docs/release-readiness/2026-08-20`
- **다음 즉시 할 일**: main 병합 결정(a 로컬병합/b 보류/c PR) — 출하 가능·lint 통과. **push는 지시 전 금지.**
- **잔여 백로그(비차단 MED/LOW)**: SEC-01(외부심링크P8)·SHIP-02(구 .harness gitignore 마이그레이션)·
  OPS-02/10/13/14·LOGIC-13/14/15·OPS-16·API-11·SEC-02·API-01/02·OPS-01·FEAT-10·DEP-10 — 대장 참조.
- **⚠ 함정**: **커밋된 dist는 self-contained여야**(yaml external이면 클론서 inert) — tsup
  noExternal:['yaml']. 소스 수정 시 `npm run build` 후 core/dist 재커밋(README·bin 주석 명시).
  파이프 뒤 `$?`는 head exit. 절전이 서브에이전트 끊음(완성본은 컨트롤러 검증·커밋).

## 2026-08-20 — HIGH 수정 라운드: 코드 3건 커밋 완료(이하 상세, 상위 섹션이 최신)

출하 검증 "조건부 출하 가능"의 HIGH 3건을 닫는 중(사용자 A 선택). 대장: `docs/release-readiness/2026-08-20/ledger.md`.
- ✅ **F1 `b5d6248`** — LOGIC-11·LOGIC-10(HIGH)·SEC-13. **리뷰 Approved, 대장 verified.**
- ✅ **F2 `2efe05d`** — API-10=LOGIC-12·USE-01·API-12·OPS-11·LOGIC-16. **리뷰 Approved,
  대장 verified.** (OPS-11 부분: 손상 state.json status 안내는 OPS-16으로 이월.)
- ✅ **F3 `74df666`** — SEC-10/11/12 주입 격리(sanitizeUntrusted 헬퍼 통일, nonce=본문
  SHA-256 앞 8자로 결정성 규칙 준수). 197 tests(+7)·E2E 6/6. **독립 리뷰 진행 중.**
- 통합 트리(F1+F2+F3) 실측: **197 passed·tsc0·빌드 ok.**
- **다음 즉시 할 일**: (1) F3 리뷰 통과 확인→SEC-10/11/12 verified 승급. (2) **SHIP-11 = core/dist
  커밋**(사용자 결정): `.gitignore`에서 `core/dist/` 제거 + `npm run build` 후 dist 커밋 +
  bin/harness 주석("gitignore다"→"커밋된다") 갱신. README.md(SHIP-12) 워킹트리에 작성 완료—함께 커밋.
  (3) **최종 재측정**(조용한 창에서 G1~G3·G9·G10 재확인) → 대장 SHIP-11/12·SEC-10/11/12 verified.
  (4) `00-summary.md` 판정 "조건부 출하 가능"→**"출하 가능"** 승급. (5) main 병합 결정(a/b/c).
- **잔여 open(비차단, 백로그)**: SEC-01(MED 외부심링크)·SEC-02·API-11·OPS-16·LOGIC-13/14/15·
  OPS-10/13/14 등 MED/LOW — 대장 open 행 참조. HIGH는 SHIP-11만 남고 그것도 dist 커밋으로 닫힘.
- **⚠ 함정**: 절전이 서브에이전트를 끊음(완성본은 컨트롤러가 검증·커밋, 미착수는 재디스패치).
  병렬 에이전트 파일 분리 필수(hook.ts=F1/F3 vs ledger·wave·cli=F2). 파이프 뒤 `$?`는 head exit.
  dist 커밋 후엔 코드 수정 시 `npm run build`+dist 재커밋 필요(README에 명시).

## 2026-08-20 — ★ 출하 검증 완료 — 판정 "조건부 출하 가능" (10축 ③ 제외, BLOCKER 0)

**대상 `e48473d`**. 산출: `docs/release-readiness/2026-08-20/` — 정본 `ledger.md`(대장),
판정·게이트 `00-summary.md`, 이음매 `99-final-verification.md`, 축별 `NN-*.md`.
- **판정: 조건부 출하 가능** — 차단 결함(BLOCKER) 0, 측정 게이트 G1~G12 전건 실측 PASS
  (테스트 171×3 동일·tsc0·훅지연 p95 59ms·doctor 1만이벤트 60ms·공급망 프로덕션도달0·
  이력비밀0·설치/업그레이드/롤백 성공). 다만 **출하 전 충족 조건 = HIGH 3건**:
  - **LOGIC-11**(HIGH): state.json 삭제 시 훅 전면 침묵(무흔적) — isInitialized를 harnessDir
    기준으로 + 저널 폴백. 재현: 활동 후 `rm state.json`→훅3종 무응답.
  - **LOGIC-10**(HIGH): state.json 형태손상(유효JSON `{}`) 시 저널 폴백 미발동→설계트랙 소스
    차단·stop 가드 침묵 해제. readState 형태검증 실패시 폴백. 재현: `echo {}>state.json`→P0 src allow.
  - **SHIP-11**(HIGH): 순수 클론 플러그인 설치서 core/dist 부재→하네스 inert. dist 커밋 or
    설치 빌드 보장+README. (수동 클론+빌드 경로는 동작·검증됨.)
  - 셋 다 근본원인 좁고 값쌈. LOGIC-10/11은 하네스 핵심 가치(강제력) 복원이라 닫기 권고.
- **부수 값싼 수정 후보**(이음매로 묶임): SEC-10~13(주입 격리 + fail-open mkdir), API-10=LOGIC-12
  (bumpNode 파서 이중화), USE-01/API-12/OPS-11/LOGIC-15(ENOENT 안내화 미적용 클래스), OPS-14
  (누적 hook-error 미노출).
- **다음 즉시 할 일**: 사용자에게 판정 보고 + HIGH 3건 수정 라운드 여부 확인. 승인 시
  subagent-driven으로 수정→재측정(대장 verified 승급). 미승인 시 조건부 출하로 확정하고 main
  병합 결정(a/b/c)으로.
- **⚠ 함정**: 파이프(`| head`) 뒤 `$?`는 head의 exit라 CLI 종료코드 관측 오염(파이프 없이 재라).
  일부 축 에이전트가 대장을 직접 편집함(수용, 병합 시 재읽기). SubagentStop 알림 반복은 무해 잡음.

## 2026-08-20 — ★ Critical 수정 웨이브 완료 — 최종 재판정 "머지 가능" (9커밋, 171 tests)

### 추가: /verify E2E 검증 + findings 보완 (웨이브 종결 후)
- **/verify PASS**: 빌드된 bin/harness를 샌드박스 6개에서 직접 구동(CLI+훅 stdin 두 표면),
  C1·C2·C3·값싼 수정 5건 전부 표면에서 확인. 검증 레시피를 `.claude/skills/verify/SKILL.md`
  로 영속화(`0ea7b8b`).
- **findings 보완 `e48473d`** (171 passed, +4): ① deny 사유 선택 `||`→`&&`(형태 불일치 시
  "루트 밖" 오표기 → "설계 트랙" 정문구, 차단 판정 불변) ② logTurn/completeWave의 활성
  웨이브 파일 부재 ENOENT를 doctor 안내 에러로 변환(파싱 오류는 원문 전파) ③ wave.test.ts
  "C3:" 오라벨 → "증적 게이트:". 표면 재검증 + 최종 리뷰어 확인 완료.
- 신규 이월(Info): `wave activate <없는 id>` raw ENOENT.

계정 전환 후 서브에이전트 주도(구현→스펙 리뷰→품질 리뷰 2단계, 수정 루프 포함)로 진행.
범위: 최종 리뷰 C1·C2·C3 + 값싼 수정 후보 (로드맵 이월 항목 I6·M1·M3 등은 범위 밖 유지).
**Fable 최종 리뷰어가 원 Critical 3건을 E2E 재현으로 전부 "닫힘" 확인, 판정 "머지 가능
(628cd60 포함)"** — 범위 64c99e2..628cd60, 실측 167/167 tests(12파일)·tsc 클린·tsup 빌드
성공, 값싼 수정 5건도 전부 원 지목 취지대로 E2E 검증 완료.

### 다음에 즉시 할 일
1. **main 병합 여부 사용자 확인** (superpowers:finishing-a-development-branch) — push 금지
   유지 중. 병합/보류/PR 은 사용자 결정 대기.
2. 결정 후 → 로드맵 2번 "게이트·리뷰 패킷" 스펙→플랜 사이클 시작.

### 최종 재판정 이월 기록 (Important 이하, 머지 비차단)
- 보호 디렉토리 자체가 외부 심링크일 때 그 실경로 직접 쓰기는 P8에서 허용(hook.ts:283-331)
  — 성립 조건·우회 수단 모두 애초 차단 범위 밖인 Bash로 가능해 기존 수용 표면 이내. "훅
  강제력 범위" 문서화로 갈음 가능 (Minor).
- deny 사유 문구 정밀화(hook.ts:306) · 신규 테스트 "C3:" 라벨 정정 (Cosmetic).
- doctor 정산 후 웨이브 파일 복귀 시 frontmatter status:active 잔존(재활성화 가능, 일관 동작)
  · 하드링크·Bash 직접 쓰기는 설계상 범위 밖 (Info).

### 태스크별 기록
- **Task 1 (C1+C2) 완료 — 2단계 리뷰 통과**: `a89d430`(구현: doctor activeWave 부재 issue
  승격+--repair 시 wave-stale 이벤트 정산, createWave id 저널·디스크 최댓값 기반) +
  `f3b7472`(품질 리뷰 지적 반영: **브랜치 되감김 잔존 증적 가드** — .harness/가 커밋 대상이라
  저널도 되감기므로 id 단조성 대신 evidenceDir 비어있지 않으면 create 거부 + 마이너 3건).
  스펙 리뷰 ✅, 품질 리뷰 Approved. 실측 142 passed.
- **Task 2 (C3 심링크) 완료 — 2단계 리뷰 통과**: `2944e1e`(realOrSelf 정규화) →
  `25d3872`(deny 검사 리터럴+realpath 이중 공간 합집합, 스펙 재리뷰 ✅) → `c0e8c3b`(품질
  리뷰 반영: allow 판정도 합집합 + 테스트 보강 — 정상 통과 4·P8 realRel 분기·형태 불일치
  회귀·대소문자 우회 봉인). 품질 재판정 Approved. 156 passed.
- **Task 3 (값싼 수정 5건) 완료 — 2단계 리뷰 통과**: `19f6042`(prepare 스크립트·
  .runtime/.gitignore 자기예외·bump 가드 해제 고지·doctor 훅 로그 정리·--refs 원장 검증,
  163 passed, 스펙 리뷰 ✅) → 품질 리뷰 With fixes: **Important 2건** — (a) doctor --repair가
  hook-errors.log를 비가역 truncate(이 diff의 회귀, --force 경로가 최악) → `.prev` 회전으로,
  (b) 맨 클론(플러그인 배포 경로)에서 bin/harness가 MODULE_NOT_FOUND exit 1 → 훅 무해 계약
  위반(기존 결함, 3줄 가드: hook이면 stderr 안내+exit 0). 수정 커밋 `c820dc6` 반영,
  품질 재판정 Approved. 165 passed.
- **추가 수정 (최종 재판정의 Important 즉시 반영)**: `628cd60` — evidenceFiles에 isFile()
  필터. 빈 서브디렉토리(stat.size 64>0)만으로 UX 게이트·잔존 증적 가드가 "증적 있음" 오판하던
  기존 구멍(최종 리뷰어 재현). 공유 헬퍼 단일 지점 수정으로 두 판정 기준 동일 유지, 테스트
  2건 봉인. 최종 리뷰어 확인 완료. 167 passed.
- Task 3 품질 리뷰 Minor 이월(머지 비차단): devDependencies 필수(--omit=dev 설치 시 prepare
  실패) 설치 문서 한 줄 · 기존 .harness/의 옛 `*`-only .gitignore 마이그레이션(doctor 검사
  후보) · --refs 검증이 CLI 전용(createWave 직접 호출은 우회 — v0 수용, 게이트 CLI 때 기억).
- 리뷰어 부수 발견(기록): C3 수정으로 **대소문자 우회(.HARNESS/state.json)·심링크 별칭 간접
  편집도 함께 닫힘**(base에서는 통과되던 구멍). realpath 판정의 TOCTOU 잔존은 "훅은 보안
  경계가 아닌 사고 방지 장치" 계약 범위 — 문서에만 남기면 충분(로드맵 문서화 후보).
- 환경 잡음: 서브에이전트가 "SubagentStop 알림 반복 수신"을 호소하며 멈추는 현상 관측
  (orca claude-hook.sh 추정, 무해) — 재개 메시지로 무시 지시하면 진행됨.

## 2026-08-20 — ★ 코어 엔진 v0 구현 완료 (14/14 태스크, 로드맵 1번 종료)

### 최종 상태
- **브랜치 `feature/core-engine-v0`** (push 안 함), 최종 검증: **134 tests passed(12 파일)**,
  `tsc --noEmit` 클린, tsup 빌드 성공(36.65KB), `bin/harness --version` 동작.
- **Task 13 완료** (`2f104d6`): `hooks/hooks.json` 배선(전 이벤트 `harness hook` 한 줄).
  현행 Claude Code 훅 문서와 스키마·출력 계약 일치 실검증(curl 원문 대조). 스모크 4종 통과
  (P8 허용 / P0 설계 차단 deny / stop 가드 block→정산 후 통과 / doctor ok).
- **Task 14 완료**: 전체 검증 + 이 핸드오프.
- 각 태스크는 구현→스펙 리뷰→품질 리뷰(수정 루프 포함) 2단계 리뷰를 통과함. 품질 리뷰가 잡아낸
  주요 결함(경로 정규화 우회, 웨이브 쓰기 id 비대칭, doctor 신뢰도 게이트, 저널 손상 은폐 등)
  전부 수정·재승인 완료. 상세는 아래 태스크별 기록.

### 최종 코드 리뷰 결과 (2026-08-20) — ★ 머지 불가, Critical 3건 수정 필요
전체 브랜치 리뷰(b22a49f..HEAD) 판정: **머지 차단 3건. C1·C2는 반드시 함께 수정.**
- **C1 — activeWave 웨이브 파일 유실 시 영구 잠금**: complete/update/activate 전부 ENOENT,
  doctor --repair --force도 무동작(replay도 같은 activeWave라 issues 0), state.json 직접 편집은
  훅이 차단, hook 안내는 doctor로 보내는데 doctor에 수단 없음. **수정**: doctor가 "activeWave
  파일 부재"를 warning이 아닌 issue로 올리고 --repair 시 activeWave 정산(null).
- **C2 — createWave id 재발급** (wave.ts:73-76 디스크 파일명 기반): 파일 삭제 후 create가 같은
  id 재발급 → 이전 웨이브의 evidence/wave-NNN/을 자기 증적으로 인정, **스크린샷 0장으로 UX 게이트
  통과**(재현됨). git 브랜치 전환으로도 트리거. **수정**: 저널 wave-created 최대 id와 디스크
  최대치 중 큰 값 + 파일 존재 시 거부.
- **C3 — 심링크 루트에서 CORE_FILES 보호 우회** (hook.ts relPath가 realpath 미정규화):
  실경로로 주면 state.json 편집 통과(재현됨). **수정 한 줄**: fs.realpathSync.native 정규화
  (실패 시 원본 유지).
- **값싼 수정 후보**(같은 웨이브에서): core/dist gitignore인데 prepare 스크립트 없음 → 클론 직후
  bin/harness MODULE_NOT_FOUND(훅 무해 계약이 CLI 바깥에서 깨짐, `"prepare": "tsup"` 추가) ·
  .runtime/.gitignore `*`가 자신도 무시(`*\n!.gitignore`로) · markStale이 activeWave 비울 때
  그 세션 stop 가드 꺼짐 · hook-errors.log 비울 수단(doctor가 정리) · --refs 원장 미존재 id 무검증.
- 로드맵에서 자연 해소로 기록: gate CLI(로드맵 2), terse 소비·trace·plugin.json(각 로드맵),
  P7~P9 배포 명령 차단(로드맵 5), backtrack의 phase 복귀 시맨틱.

### 다음에 즉시 할 일
1. **Critical 수정 웨이브**: C1+C2 함께, C3 한 줄, 값싼 수정 후보 포함 → 테스트 추가 →
   최종 리뷰어 재판정 (에이전트 a749acc532540f1d1 트랜스크립트에 재현 절차 있음. 새 세션이면
   이 섹션 내용만으로 충분)
2. 통과 시 superpowers:finishing-a-development-branch 로 main 병합 여부 사용자 확인
3. **로드맵 2번 "게이트·리뷰 패킷"** 스펙→플랜 사이클 시작

### ⚠ 세션 상태 (2026-08-20)
**사용량 한도 100% 도달** (리셋 2026-08-20T06:50Z ≈ 15:50 KST) — 새 세션 시작 직후 token-guard
경보 관측. 신규 작업 중단, 사용자 지시 대기(auto-retry 자동 재개 vs 세션/계정 전환).
이 세션에서 코드 변경 없음 — 아래 핸드오프 그대로 유효.

### 미해결·확인 대기 / 이월 기록
- `MultiEdit`은 현행 도구 목록에 없음(무해한 죽은 분기) — 하위호환 위해 유지 결정, 정리 후보
- I6 근본책(훅 자기호출을 정규식 대신 CLI 마커로 식별) — 로드맵 후속
- replayState가 "버린 이벤트 수" 미반환(M1), doctor의 웨이브/원장 정합 검사(M3) — 로드맵 후속
- **사용량 한도 96% 경고 관측됨(2026-08-20 오후)** — 한도 도달 시 auto-retry가 재개.
  새 세션은 이 파일만 읽으면 이어받기 가능.
- 마켓플레이스 배포 채널·auto-retry bypassPermissions 고지 수위 (스펙 단계부터 이월)

## (이하 태스크별 상세 기록) — 코어 엔진 v0 구현 (Task 12/14 완료 시점 기준)

### 완료
- 브레인스토밍 + 마스터 설계 스펙 (`docs/superpowers/specs/2026-08-20-king-harness-design.md`),
  검토용 아티팩트 https://claude.ai/code/artifact/ca5f0860-4d76-40c5-b2e9-166c9c7f5397 (스펙 승인 완료)
- 구현 플랜 작성: `docs/superpowers/plans/2026-08-20-core-engine-v0.md` (14 태스크, TDD, Task별 체크박스)
- **Task 1: 프로젝트 스캐폴드** — package.json/tsconfig.json/tsup.config.ts/vitest.config.ts/
  bin/harness/core/src/cli.ts/.gitignore. 커밋 `858c358`, `d7c2fef`(.omc 스크래치 정리).
- **Task 2: 타입·경로·config** — `core/src/types.ts`(Phase 상수+HarnessState 등 타입 단일 정의처),
  `core/src/paths.ts`(.harness/ 경로 헬퍼), `core/src/config.ts`(config.yaml 로드+기본값 병합),
  `core/test/config.test.ts`(2 tests). 검증: vitest 2 passed, `npm run check` 타입 에러 0.
  커밋 `7bf9a42`, `49c9f45`(config 정규화 보강). 브랜치 `feature/core-engine-v0` (push 안 함).
- **Task 3: 상태 저장소** — `core/src/state.ts`(defaultState/readState/writeState 임시파일+rename
  원자적 쓰기/initHarness/isInitialized), `core/test/state.test.ts`(5 tests: 초기화 트리 생성,
  중복 초기화 시 에러, 원자적 쓰기 잔여 tmp 없음, updatedAt 갱신, .runtime/.gitignore). 검증:
  vitest 14 passed(state 5 + config 9), `npm run check` 타입 에러 0. 커밋 `85a1c8c`.
- **Task 3 품질 리뷰 수정** — Critical: `initHarness` 가드를 `isInitialized`(state.json 존재)에서
  `fs.existsSync(harnessDir(root))`(디렉토리 존재)로 교체 — state.json만 사라진 `.harness/`에서
  init 재실행 시 events.jsonl(진실의 원천)·config.yaml이 덮여 전멸하는 사고를 차단.
  `isInitialized`는 시그니처·의미 유지(훅 비간섭 판정용으로 별도 존치). writeState의 rename
  주석에 내구성 한정어 추가(내구성은 events.jsonl 재생 담당). 공허했던 updatedAt 테스트를
  고정 과거값 비교로 교체 + 회귀 테스트 추가(state.json만 지운 채 재실행 시 throw & events 보존).
  검증: vitest 15 passed(state 6 + config 9), `npm run check` 타입 에러 0. 커밋 `a04b18f`.
- **Task 4: 이벤트 저널 (append/replay)** — `core/src/events.ts`(appendEvent/readEvents/
  replayState), `core/test/events.test.ts`(5 tests: 순서 보존, replay로 상태 재구성, 미지
  이벤트 타입 무시(전방 호환), 유효하지 않은 phase의 phase-set 무시(손상 방어), 깨진 JSONL
  줄 스킵(부분 손상 방어)). 리뷰 확정 계약 2건 반영: (A) 모듈 헤더에 "appendEvent는
  writeState보다 먼저" 변이 순서 계약 명시, (B) replayState의 phase-set/backtrack-started는
  `isPhase` 검증 후 대입(맨 캐스트 아님) — 손상 이벤트가 state를 오염시켜 doctor가 정품으로
  세탁하는 사고 방지. 검증: vitest 20 passed(state 6 + config 9 + events 5), `npm run check`
  타입 에러 0. 커밋 `a81c442`.
- **Task 5: 설계 원장 CRUD + bump/STALE 스캔** — `core/src/ledger.ts`(loadLedger/saveLedger/
  getNode/upsertNode/bumpNode), `core/test/ledger.test.ts`(6 tests: 빈 원장 upsert→get, 같은
  id upsert는 교체, bumpNode의 version++/status→stale/참조 웨이브 id 반환, 없는 노드 bump는
  에러, 이미 stale인 웨이브는 affectedWaves 제외, frontmatter 없는 웨이브 파일은 스캔 무시).
  bumpNode는 실제 웨이브 STALE 마킹을 하지 않고 affectedWaves(id 배열)만 반환 — 호출측(Task 12
  CLI)이 wave.markStale로 마킹하는 분리 설계(순환 import 방지, ledger.ts는 wave.ts를 모른다).
  검증: vitest 32 passed(state 6 + events 11 + config 9 + ledger 6), `npm run check` 타입
  에러 0. 커밋 `dd6a291`.
- **Task 5 품질 리뷰 수정 — 원장 하드닝** — Important 2건 + 보강 4건: (1) 웨이브 파일 식별을
  `f.endsWith('.md')`(느슨) → `/^wave-\d+\.md$/`로 통일하고 affectedWaves는 `meta.id` 대신
  **파일명 stem**을 push(소비처 markStale이 파일명으로 해석 — frontmatter id 오기입/불일치에
  안전). (2) `saveLedger`를 state.ts와 동일한 tmp+rename 원자적 쓰기로 교체(원장은 저널 재생
  복구가 없어 state.json보다 위험도 높음). 그 외: 모듈 헤더에 "원장은 저널 파생 아님(git이
  복구 수단)" 계약 명시, `loadLedger`가 `nodes` 필드 배열 검증(`Array.isArray`) 후 아니면 [],
  frontmatter 정규식 CRLF 대응(`\r?\n`), `upsertNode`를 filter+push에서 `findIndex` 제자리
  교체로 변경(원장 내 노드 순서 보존, diff 안정성). `core/test/ledger.test.ts`에 7 tests 추가
  (wave-*.md 패턴 아닌 파일 무시, 깨진 YAML frontmatter 스킵, CRLF frontmatter 감지, 참조
  웨이브 여럿일 때 파일명 정렬 반환, nodes 비배열이면 빈 배열, upsert 순서 보존, saveLedger
  후 .tmp- 잔여 없음) — 총 13 tests, 기존 6개 중 3개는 반복되는 웨이브 frontmatter 작성을
  `writeWave` 헬퍼로 리팩터(테스트 파일 내 DRY, 프로덕션 코드 영향 없음). 검증: vitest 39
  passed(state 6 + events 11 + config 9 + ledger 13), `npm run check` 타입 에러 0.
  커밋 `7178e14`.
- **Task 6: 웨이브 지시서 수명주기 + runtime 스텁** — `core/src/runtime.ts`(noteActivity/
  noteTurnLogged/readRuntime — `.harness/.runtime/{last-activity,last-turn}` 타임스탬프 파일),
  `core/src/wave.ts`(parseWave/serializeWave/readWave/listWaves/createWave/activateWave/
  logTurn/completeWave/markStale), `core/test/wave.test.ts`(8 tests: 번호 자동증가+pending
  생성, activate 단일성+state.activeWave 갱신, logTurn 턴로그 추가, 활성 웨이브 없으면
  logTurn 에러, UX 참조 웨이브는 시각 증적 없으면 complete 거부·있으면 done, markStale,
  CRLF frontmatter 파싱, done 웨이브 재활성 불가). 리뷰 이월 계약 2건 반영: (A)
  activateWave/completeWave 모두 appendEvent를 writeState보다 먼저(events.ts 헤더 변이
  순서 계약 준수), (B) parseWave 정규식 `/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/`로
  CRLF 허용. createWave 번호 자동증가는 listWaves(파일명 `wave-\d+\.md` 패턴) 최댓값+1 —
  ledger.ts bumpNode의 파일명 stem 기준 affectedWaves와 일관. 검증: vitest 47 passed
  (state 6 + events 11 + config 9 + wave 8 + ledger 13), `npm run check` 타입 에러 0.
  커밋 `05bded4`. 관찰(미수정, 지시서 스펙 그대로): wave.ts의 파일 쓰기는 state.ts/ledger.ts와
  달리 tmp+rename 원자적 쓰기가 아니라 직접 writeFileSync — 필요 시 별도 리뷰 대상. markStale은
  활성 웨이브 여부를 확인하지 않아 활성 웨이브를 stale 처리해도 state.activeWave가 그대로
  남는 엣지케이스 있음(테스트 범위 밖).
- **Task 7: runtime 스크래치 테스트 보강** — `core/test/runtime.test.ts`(3 tests: noteActivity/
  noteTurnLogged 타임스탬프 기록, readRuntime 빈 파일·미존재 시 undefined 방어). runtime.ts
  본체는 Task 6에서 이미 생성 완료라 이번엔 테스트만 추가, 소스 변경 없음. 검증: vitest 50
  passed(wave 8 + ledger 13 + runtime 3 + 기존), `npm run check` 타입 에러 0. 커밋 `d9d6577`.
- **Task 8: 훅 판정기 — session-start 주입 + 비간섭/무해 불변식** — `core/src/hook.ts`
  (handleHook 진입점, sessionStart: 페이즈·활성 웨이브·remote-control·backtrack·저널 손상
  경고 주입, `.harness/` 없으면 완전 침묵, 판정 실패는 절대 throw 안 하고 null + hook-errors.log
  흔적), `core/test/hook-session-start.test.ts`(6 tests). 이후 하드닝 라운드에서 대거 보강:
  (a) 경로 정규화(`docs/../src/a.ts` 우회 차단, 루트 밖 절대/상대경로 차단, 빈 file_path
  안전 기본값 차단), (b) 코어 파일 보호(`.harness/{state.json,events.jsonl,design/ledger.yaml}`
  직접 편집 금지 — 페이즈·config 무관, `.harness/` 무조건 허용보다 우선), (c) 활동 집계를
  쓰기 가능 도구(Write/Edit/MultiEdit/NotebookEdit/비자기호출 Bash)로 한정하고 harness 자기
  호출은 **명령 위치**에서만 식별(주석·인자 속 "harness" 낱말 오탐 방지), (d) session-start
  마커 리셋을 `source==='startup'|'clear'`로만 한정(`compact`/`resume`/미지정은 정산 증거
  보존 — 컨텍스트 압축 직후 stop 가드가 함께 풀리는 회귀 차단), (e) 턴 로그 인용을 구분자로
  감싸고 줄당 200자 절단(프롬프트 인젝션 폭 제한), (f) 저널 손상 줄 수를 주입·차단 사유 양쪽에
  노출. 커밋 `6305fc7`(구현) → `12fc1cd`(하드닝 1차) → `ff8baf4`(compact 회귀 차단). 검증:
  vitest 91 passed, `npm run check` 타입 에러 0.
- **Task 9+10 (통합): pre-tool 차단 매트릭스·stop 가드 잔여 테스트** — 하드닝 라운드에서 이미
  커버된 걸 빼고 남은 케이스만 신규 파일 2개로 추가. `core/test/hook-pre-tool.test.ts`(8 tests:
  설계 페이즈 docs/·루트 md 허용, 배포성 Bash 차단, 일반 Bash 허용, 구축 페이즈 소스 쓰기
  허용, 설계 문서 직접 수정 차단+backtrack 안내, backtrack 중엔 설계 문서 수정 허용, Read는
  무간섭, 출하 페이즈도 설계 문서 차단), `core/test/hook-stop.test.ts`(4 tests: 로그가 활동보다
  나중이면 통과, `stop_hook_active`는 루프 가드로 무조건 통과, 활성 웨이브 없으면 통과, 차단
  사유에 갱신 명령+탈출구 문구 포함). 기존 hook-misc.test.ts/hook-session-start.test.ts는
  무수정. 사전에 hook.ts 실동작과 테스트 기대를 전부 대조 검증했고 전 케이스 수정 없이 1회에
  그린 — hook.ts 자체는 무수정. 검증: vitest 103 passed(10 files), `npm run check` 타입
  에러 0. 커밋 `5a2463e`.
- **Task 11: doctor — 무결성 검사·재생 복구** — `core/src/doctor.ts`(runDoctor →
  `{ok, repaired, refused, issues, warnings, notes}`), `core/test/doctor.test.ts`(14 tests).
  설계 핵심 3가지: (1) **issues(=state.json이 이벤트 재생과 발산 — 복구 대상이자 ok 판정
  기준) 와 warnings(=저널 건강·환경 진단 — 복구로 안 고쳐지므로 ok를 내리지 않음) 분리** —
  버전 스큐로 생기는 미지 이벤트가 영구 red를 만들어 경보를 죽이는 걸 차단. (2) **신뢰도
  게이트(trustworthy)는 복구 게이트일 뿐 ok와 무관** — 손상뿐 아니라 **저널 부재·절단 의심도
  불신**으로 침("증거 없음"은 "아무 일 없었다는 증거"가 아니다). 발산이 있는데 저널을 못
  믿으면 `refused` 반환하고 `--force` 로만 강제. (3) 고아 tmp 스윕은 **죽은 pid(`process.kill(pid,0)`
  → ESRCH만 사망 판정, EPERM은 생존)** 것만 치우고, 복구 시 `doctor-repaired` 이벤트로
  흔적을 남김. 비교 범위(COMPARED_FIELDS = phase/activeWave/gates/backtrack)와 덮어쓰기
  범위를 일치시킴 — 한쪽만 넓으면 감지 못 한 채 날아가는 필드가 생긴다.
  커밋 `cffa872`(구현) → `6835ad1`(신뢰도 게이트 재설계).
- **Task 12: CLI 디스패치** — `core/src/cli.ts` Task 1 스텁 전체 교체(10줄 → 165줄),
  `core/test/cli.test.ts`(9 tests). `run(argv, root): number` 가 exit code를 **반환**하고
  `main`이 `process.exitCode`에 대입 — 테스트가 프로세스 없이 직접 호출한다. 리뷰 이월 4건
  전부 반영: (1) **`hook` 분기를 바깥 try보다 앞에 두고 이중 try/catch → 어떤 실패에도
  exit 0** (handleHook 자체 방어에 더해 stdin 읽기·JSON 파싱 실패까지 CLI 계층에서 흡수 —
  훅이 0이 아닌 코드로 끝나면 세션이 깨진다), (2) doctor `--repair`/`--force` 배선 +
  `refused→1`, `(ok||repaired)→0`, 그 외 1, (3) **node upsert가 기존 노드의 version·status를
  보존**(`prev?.version ?? 1`, status는 `--status` 지정 시에만 변경 — 재실행이 bump 이력을
  리셋하지 않는다), (4) CLI가 직접 쓰는 phase-set·backtrack 두 분기 모두 `appendEvent` →
  `writeState` 순서 계약 준수. 플랜 대비 의도적 편차 2건: **stdin 읽기에 `!process.stdin.isTTY`
  가드 추가**(인터랙티브 터미널에서 손으로 `harness hook stop` 을 치면 EOF를 기다리며 멈추는
  실사용 함정 차단 — 실제 훅 호출은 파이프라 무영향), `csv()` 헬퍼 추출(중복 제거, 동작 동일).
  검증: vitest **126 passed(12 files)**, `npm run check` 타입 에러 0. 추가 E2E 스모크(`npm run
  build` + `bin/harness`): init→phase set→node upsert→wave create/activate 정상, JSON stdin
  파이프 시 `hookSpecificOutput` 출력·exit 0, **깨진 stdin·닫힌 stdin 모두 exit 0**, unknown
  명령 exit 1. 커밋 `9928cd9`.
- **Task 12 품질 리뷰 수정 5건** — Critical 2 + Important 3. (C-1) **훅 이벤트 화이트리스트**
  (`HOOK_EVENTS = session-start|pre-tool|post-tool|stop`) — 미지 이벤트는 exit 0 유지하되
  `.runtime/hook-errors.log` 에 `cli unknown-hook-event <값>` 기록. 배선 오타(`PreToolUse` 같은
  Claude Code 원본 이름)가 **조용히 죽는 것**이 훅 계열 최악의 실패 모드다. (C-2) **stdin 파손
  기록** — 내용이 있는데 JSON.parse 가 실패한 경우만 `cli corrupt-stdin <event>` 기록(stdin
  부재·빈 입력은 정상이라 무기록). 둘 다 `logHookIssue(root, msg)` 헬퍼 공유이며 **`.harness/`
  가 있을 때만** 쓴다(비간섭 불변식 — 하네스 안 쓰는 프로젝트에 파일 만들면 위반).
  (I-1) **bump 순서·부분 실패 보고** — `bumpNode` 직후 **즉시** `node-bumped` 이벤트(markStale
  루프보다 먼저, 루프가 죽어도 bump 사실은 남음), 루프는 웨이브별 try/catch 로 실패를 모아
  `STALE 마킹 실패: ... — 수동 확인 필요` + exit 1, 성공분은 계속 진행. 이벤트 data 는
  `staleWaves` → `{id, version, affected}` (affected 는 "대상"이지 "성공"이 아님). ledger.ts
  `bumpNode` 웨이브 스캔의 `readFileSync` 도 try/catch 스킵(기존 파싱 실패와 동일 관용).
  (I-2) **빈 턴 로그 거절** — `wave update` 인자가 공백뿐이면 에러. 내용 없는 `- [ts]` 한 줄로
  stop 가드가 풀리는 걸 막는다. (I-3) **flag() 값 필터 제거** — `--` 로 시작한다고 버리면
  `--goal "--force 제거"` 같은 정당한 값이 조용히 기본값으로 바뀐다. 값 누락 시 다음 플래그를
  삼키는 건 사용자 책임으로 문서화. 검증: vitest **131 passed(12 files)**, `npm run check`
  타입 에러 0, E2E 로 hook-errors.log 2줄(corrupt-stdin/unknown-hook-event)·빈 stdin 무기록
  확인. 커밋 `2bfaddf`.
- **Task 12 재검토 수정 — bump 검증 불가 보고** — 앞선 I-1 수정(스캔 `readFileSync` try/catch
  스킵)이 **chmod 000 시나리오를 "무흔적 exit 0" 으로 퇴행**시킨 것을 되돌렸다. `bumpNode` 반환을
  `{node, affectedWaves, unverifiable}` 로 확장하고, 스캔 중 ① 읽기 실패(I/O) ② frontmatter
  없음 ③ 깨진 YAML ④ 스칼라 frontmatter 인 `wave-NNN.md` 는 **스킵하지 말고 `unverifiable` 에
  수집**한다. 원칙: **"검증 불가는 침묵 스킵이 아니라 보고 대상"** — 해당 노드를 참조하는지
  판정할 수 없으면 마킹할 수도, 무시해도 된다고 단정할 수도 없다. CLI 는 `unverifiable` +
  `failed`(markStale 실패)를 합쳐 `STALE 전파 불완전 — 검증 불가/실패 웨이브: ... — 수동 확인
  필요` + **exit 1**, `node-bumped` 이벤트 data 에도 `unverifiable` 을 남긴다. 빈 frontmatter
  (`YAML.parse → null`)는 정상적인 '참조 없음' 이라 unverifiable 아님. 검증: vitest **134
  passed(12 files)**, `npm run check` 타입 에러 0, E2E 로 실제 `chmod 000` 재현 →
  `exit=1` + 에러에 wave-002 명시 + 이벤트에 `"unverifiable":["wave-002"]` + 읽히는 wave-001 은
  `status: stale` 확인. 커밋 `58b30f5`.

### 진행 중
- 코어 엔진 v0 플랜 14 태스크 중 Task 1-12 완료(리뷰 수정까지 반영), **Task 13(훅 배선 +
  실전 스모크)부터 이어감** ← 지금 여기
  (플랜 문서: `docs/superpowers/plans/2026-08-20-core-engine-v0.md`)

### 다음에 즉시 할 일
1. Task 13: 훅 배선 + 실전 스모크 — `handleHook`을 실제 Claude Code 훅 이벤트(SessionStart/
   PreToolUse/PostToolUse/Stop)에 settings.json 으로 연결. CLI 쪽 진입점은 이미 완성:
   `harness hook <session-start|pre-tool|post-tool|stop>` 가 stdin JSON을 읽어 stdout에
   훅 응답 JSON을 뱉고 **항상 exit 0**. 배선 시 주의 3가지:
   (a) **CLI 이벤트 이름은 케밥케이스**(`pre-tool`)이고 Claude Code 훅 이름은 `PreToolUse` 다 —
   settings.json 에 원본 이름을 그대로 쓰면 매칭 실패한다. 실패해도 조용히 exit 0 이므로
   **배선 직후 `.harness/.runtime/hook-errors.log` 에 `unknown-hook-event` 가 쌓이는지로
   검증하라**(C-1 이 이걸 위해 있다).
   (b) `bin/harness` 가 `core/dist/cli.js` 를 요구하므로 **`npm run build` 선행 필수**.
   (c) 훅 커맨드에 `CLAUDE_PROJECT_DIR` 이 전달되는지 확인
   (`main`이 `process.env.CLAUDE_PROJECT_DIR ?? process.cwd()` 로 root를 잡는다).
2. Task 14: 마무리 — 타입체크·전체 테스트·핸드오프. 완료 후 로드맵 2번 "게이트·리뷰 패킷"
   스펙→플랜 사이클로 이동.
3. (이월) `harness phase set` 은 **v0 임시 명령**이다 — 게이트 구현 시 승인 흐름으로 교체
   대상(출력 문구에도 명시해 둠).

### 미해결·확인 대기
- ~~플러그인 공개 이름 미정~~ → **`king-wjang-harness` 확정** (2026-08-20 사용자 지정)
- 마켓플레이스 배포 채널 (자체 marketplace.json 가정)
- auto-retry bypassPermissions opt-in 문구/고지 수위

### 시스템 지식 (함정·환경)
- 사용자 자작 도구 원본: `~/.claude/{token-guard,handoff-guard,auto-retry}/DESIGN.md` + bin/,
  `~/.claude/hooks/terse-mode.sh`, `~/.claude/skills/verifying-production-readiness/` (벤더링 대상)
- usage API 실측 노하우(180초 캐시, 티어 상승 시만 주입)는 token-guard DESIGN.md에 근거 —
  재설계 말고 이식할 것
- 사용자는 아이패드 원격 접속 — 산출물은 반드시 claude.ai 아티팩트로 (localhost/파일 첨부 불가,
  이미지는 base64 임베드, 캡처 2x)
- 브라우저 작업 항상 headless (글로벌 CLAUDE.md)
- 각 코어 모듈은 `(root: string)`을 첫 인자로 받는 순수 함수 모음, 전역 상태 없음 —
  테스트는 `fs.mkdtempSync` 임시 디렉토리로 완전 격리 (config.test.ts 패턴 그대로 재사용)
- `module: commonjs` + `esModuleInterop: true` 이므로 `import * as fs/path/YAML` 형태 사용
- 브랜치 `feature/core-engine-v0` 유지, **push 금지** (사용자 지시)
- **CLI 계층 계약**: `run(argv, root)` 은 throw 하지 않고 exit code를 반환한다(모든 에러는
  바깥 try/catch가 `console.error` + 1). 단 `hook` 분기만은 그 바깥 catch보다 **앞**에 있어
  무조건 0을 반환한다 — 이 순서를 뒤집으면 훅 무해 불변식이 깨진다.
- **vitest 환경의 fd 0**: worker thread에서 `process.stdin.isTTY` 는 `undefined`,
  `fs.readFileSync(0)` 은 `EAGAIN` 을 즉시 throw(블로킹 아님) — 실측 확인. 그래서 CLI의
  stdin 읽기가 테스트를 멈추지 않는다. 다만 `--pool=forks` 로 바꾸면 파이프가 열린 채
  남아 블로킹할 수 있으니 주의.
- `bin/harness` 는 `require('../core/dist/cli.js').main(...)` 를 호출한다 — 소스만 고치고
  `npm run build` 를 빼먹으면 예전 동작이 그대로 돈다. cli.ts의 `require.main === module`
  가드 덕에 이중 실행은 없다.
- **훅 계열 실패는 전부 exit 0 으로 흡수되므로 로그가 유일한 관측 수단이다** —
  `.harness/.runtime/hook-errors.log` 를 보라. hook.ts 의 판정 실패(`logHookError`)와
  cli.ts 의 미지 이벤트·stdin 파손(`logHookIssue`)이 같은 파일에 쌓이고, doctor 가
  줄 수를 세어 warning 으로 올린다.
- **손상 방어에 "관용적 스킵"을 넣을 때는 관측 가능성을 함께 보라** — 깨진 입력을 조용히
  건너뛰면 그 경로의 보증(여기선 STALE 전파)이 통째로 뚫려도 아무 흔적이 없다. bumpNode 가
  이 함정을 한 번 밟았다(읽기 실패 스킵 → chmod 000 이 무흔적 exit 0). listWaves 의 스킵은
  "목록 조회가 죽으면 안 된다"는 다른 목적이라 유지 중이나, 같은 눈으로 재검토할 후보다.
- **읽기 실패를 테스트로 만드는 법**: 파일 자리에 **디렉토리를 만들면** `readFileSync` 가
  EISDIR 로 실패한다 — `chmod 000` 은 root 로 돌리면 무력화되므로 이쪽이 이식성 있다.
  (ledger.test.ts '읽을 수 없는 웨이브 파일' 테스트)
- **쓰기 실패를 테스트로 만드는 법**: `writeWave`/`writeState` 의 tmp 경로는
  `<target>.tmp-<pid>` 로 결정적이다. 테스트에서 그 경로에 **디렉토리를 미리 만들어 두면**
  읽기·스캔은 정상인 채 쓰기만 EISDIR 로 실패한다(chmod 보다 이식성 좋음). cli.test.ts 의
  bump 부분 실패 테스트가 이 기법을 쓴다. 참고: `wave-002.md.tmp-123` 은
  `/^wave-\d+\.md$/` 필터에 걸리지 않아 listWaves·bumpNode 스캔을 오염시키지 않는다.
