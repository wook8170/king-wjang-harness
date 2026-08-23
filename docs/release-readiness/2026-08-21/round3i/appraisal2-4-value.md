# [4] 가치/품질(출하) 감정 — 3.5/5
**점수** 3.5 · **4.8 충족** ✗ · **감정 시각** 2026-08-22 · **대상** HEAD 45bde0c (feature/core-engine-v0)

**한 줄**: 대장 집계·lint·tsc·1031tests×3·게이트는 실질 green 이고 대장은 정직하다(표본 25/25 진짜 닫힘). 그러나 독립 재현으로 **열거되지 않은 쓰기 도구(xxd·openssl·csplit·split)** 가 설계트랙 소스·정책 파일 차단을 비껴가 **SEC-69 자기무장해제가 재발**(끝단 관측). 대장의 「open BLOCKER 0」은 ground truth 가 아니며 4.8 하드조건 미충족.

# [4] 가치/품질(출하) 감정 — (작성 중)
**감정 시각** 시작: $(date)

## 조건별 실측 — 1) 대장 집계 재계산 (measured)
- 방법: ledger.md 의 표 행을 파이썬으로 직접 파싱해 재집계 (헤더 수치 불신).
- 실측: **총 157행** · severity {BLOCKER 9, HIGH 33, MED 51, LOW 47, — 17} · status {verified 124, deferred 3, open 30}
- 교차: open 은 전부 LOW(30건) · **open BLOCKER 0 · open HIGH 0** · ID 중복 0
- 헤더 주장 「open 전체 30 (전부 LOW) · verified 124 · deferred 3」 ↔ 재계산 **일치** ✅

## 조건별 실측 — 2) lint R1–R7 + 검사 커버리지 (measured)
- lint 는 리포 밖: `~/.claude/skills/verifying-production-readiness/bin/ledger-lint.sh` (실존, 181줄)
- 실행: `ledger-lint.sh docs/release-readiness/2026-08-21` (리포 루트 CWD)
  → `✓ 대장 무결 — 118 행, R1–R7 통과 (open BLOCKER 0)` exit 0 ✅
- 커버리지: lint 의 행 매칭 glob `[A-Z]*-[0-9]*` 를 파이썬으로 에뮬레이션 → **118행 검사 / 39행 미검사**(글자접미 ID: SEC-A, UX-A1 등). 대장 [QUAL-115] 의 자기 고지 「118/157」과 정확히 일치.
- 미검사 39행 보완: R1/R2/R4/R5/R7 을 파이썬으로 재구현해 39행에 직접 적용 → **위반 0** ✅
- 리포 안 가드: `core/test/ledger-summary-sync.test.ts:206` 이 사각 상한 41행을 테스트로 고정(실측 39 ≤ 41) — 실재 확인.

## 조건별 실측 — 3) 게이트 G1–G13 (measured, 내 재현)
- G1 테스트: `npm test` ×3 → **1031 passed (39 files)** 3회 동일 ✅
- G2 타입: `npx tsc --noEmit` exit 0 ✅
- G3 자체완결: 샌드박스 init/status/doctor exit 0 ✅
- G4 훅 무해: 미초기화·미지 이벤트 stdout 0바이트 exit 0 ✅
- G5 훅 강제력: Bash 소스쓰기·코어·경로우회 전건 deny (아래 재현) ✅
- G6 🔴 MCP 승인 불가: 제출된 P0 게이트에 MCP `harness_gate_approve` 호출 → isError:true, 상태 `submitted` **불변** (state.json gates 미변경). ✅ **끝단 관측 완료**
- G7 결정성: 테스트 3회 동일 ✅ (Math.random 실사용 grep 별도 미측 — 못 잰 것에 기재)
- G8 공급망: 미측(npm audit 미실행 — 못 잰 것)
- G9 훅 지연: **불일치 발견** — `00-summary.md:297` 게이트표는 「폴백 재측정 대기 ⚠ 조건 ①」, 그러나 ledger PERF-26·`fixes-round3-perf.md` 는 폴백 p95 82~101ms<150ms 재측정 완료·verified·「G9 초록」. 요약 게이트표가 낡음(피어 PERF 세션 결과가 표에 반영 안 됨).
- G10 이력 비밀: 미측(gitleaks 미실행)
- G11 CLI 계약: --help exit 0·20군 나열·미지 명령 exit 1·미지 플래그 거절 ✅
- G12 관측성: doctor JSON 6키(ok/repaired/refused/issues/warnings/notes) ok=true ✅
- G13 패키징: MCP tools/list 16개 노출 ✅ (skills/agents 파일대조 별도)

## verified 표본 재현 결과 (measured)
보안 BLOCKER/HIGH 표본 20+건 재현 — 전건 대장 주장대로 닫힘:
- SEC-49/SEC-A/SEC-100 저널위조(echo>>events·git apply·base64|sh): 3/3 DENY
- SEC-90 접두명령(sudo tee·nohup cp·env sh -c): 3/3 DENY
- SEC-91 디렉토리대상(mv src·cp -r .harness): 2/2 DENY
- SEC-92 스크립트실행(실제 소스쓰기 스크립트 sh/bash/./): 3/3 DENY · 무해 스크립트 ALLOW(과차단 아님)
- SEC-97 깊이2 체인(a.sh→b.sh)·래퍼(sh -c cp·git checkout -- src): 3/3 DENY
- SEC-101 mv/rm .harness: 2/2 DENY
- SEC-96 node cli.js 직접호출: DENY
- SEC-69 config.yaml 자기무장해제(Bash·Write): 2/2 DENY
- SEC-67 curl/wget -o src: 2/2 DENY
- 과차단 대조: docs 쓰기·cat src·ls: 3/3 ALLOW ✅
기능 HIGH: UX-24(--help exit0)·FEAT-22(trace)·FEAT-23(gate feedback)·API-57(--acceptance 저장, 미지플래그 거절)·G11 전건 재현 확인.
**표본 25건 중 25건이 대장 주장대로 닫혀 있었다. 과잉주장(닫혔다는데 안 닫힘) 0건.**

## 대장에 없는 것 — 내가 새로 찾은 BLOCKER-급 결함 (measured, 끝단 관측)

### [NEW-1] 열거되지 않은 쓰기 프리미티브가 설계트랙 소스·코어·정책 파일 차단을 통째로 비껴간다
`core/src/bashwrite.ts:279` `scanBashWrites` 는 쓰기 명령을 **이름 열거**로 판정한다
(tee/touch/rm/truncate/unlink/sed/perl/ruby/cp/install/mv/rmdir/ln/dd/curl/wget/
prettier/eslint/patch/ed/ex/tar/unzip/bsdtar/rsync/scp/sponge/vim/vi/nvim/git/
sh/bash/zsh/dash/ksh/eval/find/xargs). **위치 인자로 파일을 쓰는데 목록에 없는 도구**는
대상 추출이 안 되고, 리다이렉트도 없으면 mutating=false → ALLOW.

빠진 도구 4종 실측(전부 P0 설계트랙, 샌드박스):
- `xxd -r -p <hex> src/app.ts` → **ALLOW** (실행 후 src/app.ts 에 `const evil = true;` 실제 기록 확인)
- `openssl enc -base64 -in x -out src/b.ts` → **ALLOW**
- `csplit -f src/c <file> 1` → **ALLOW**
- `split -l1 <file> src/d` → **ALLOW**
- 같은 도구로 코어/정책 파일도: `xxd -r <hex> .harness/state.json` · `openssl -out .harness/config.yaml` → **ALLOW**
- 대조: 직접형 `echo > src/app.ts` 는 **DENY** (차단 활성 확인). 리다이렉트형 `xxd ... > src/app.ts` 도 DENY(> 스캔). **위치인자형만 뚫린다.**
- 이 4개 이름은 대장 157행·규칙 소스 어디에도 없음(grep 0).

이는 SEC-50(`echo>src` **BLOCKER**)·SEC-92(스크립트로 소스쓰기 **BLOCKER**)와 **동일 부류**다.
대장 자신의 심각도 보정으로 BLOCKER-급. OPS-74/SEC-91 이 인정한 "열거하면 언제나 빠진 이름이
있다"의 재발 — 소멸(mv/rm)은 "대상이 사라지는 것을 본다"로 덮었으나 **생성/덮어쓰기**는 여전히
명령 allowlist 에 의존.

### [NEW-2] SEC-69 자기무장해제 재발 — openssl/xxd 로 config.yaml 덮어 하네스 무장해제 (끝단 관측)
전체 사슬 실측(샌드박스 P0):
1. before: `echo > src/app.ts` → **DENY**
2. `openssl enc -out .harness/config.yaml` → 훅 **ALLOW** (NEW-1)
3. 에이전트가 `design_allowed_prefixes` 에 `src/` 추가한 config.yaml 기록
4. after: `echo > src/app.ts` → **ALLOW**, `Write src/app.ts` → **ALLOW** — 소스쓰기 차단이 풀렸다
5. `doctor` 는 정책해시 변경을 **warning** 으로 알림(OPS-76 탐지 작동) — 그러나 `ok=true`,
   훅(실제 강제 지점)은 계속 ALLOW. 탐지는 사후·수동(doctor 를 돌려야)이고 강제를 복원하지 않는다.

[SEC-69] 는 대장에서 **BLOCKER**로 등재·verified. 그 처방(코어 보호에 config.yaml 추가)은
**알려진 쓰기 명령만** 막았고, openssl/xxd(미열거)로 같은 자기무장해제가 성립한다.
위협모델(개정1: "에이전트가 스스로 강제를 푸는 것")의 정중앙 — 에이전트 도구호출로 강제가 풀린다.

**결론: 대장의 「open BLOCKER 0」은 측정범위 산물이지 ground truth 가 아니다.**
독립 재현으로 agent-reachable BLOCKER-급 자기무장해제가 살아 있다. → 4.8 하드조건(open BLOCKER 0) 미충족.

## 대장에 없는 것 — 문서/출하 위생 결함
### [NEW-3] MED — `00-summary.md` 「게이트 실측」표가 낡음(내부 모순)
`00-summary.md:289` 게이트표: G1 "**626 passed ×3, 27 파일**"(실제 1031/39) · G9 "폴백 재측정 대기 **⚠ 조건 ①**" · G10 "gitleaks **71 커밋**"(감사 후반 82). 같은 문서 헤더(14·149행)와 ledger PERF-26(verified·G9 초록)과 **모순**. 라운드3 피어 PERF 세션이 PERF-26 을 닫은 결과가 게이트표에 반영 안 됨. 판정 근거표가 "G1–G13 전부 ✅"를 **자기 문서 안에서 보여주지 못한다**(G9=⚠로 표기). 대장 미등재.
※ G9 자체는 실질 충족(`evidence/latency.log:28-46` 폴백 p95 최악 101ms<150ms 재측정 실재) — 결함은 요약표 갱신 누락.

## 가치 판단 (값을 하는가 — 내 측정)
- **핵심 값 제안(설계 우선 페이즈 게이트를 에이전트에 강제 + 승인클릭은 항상 사람)은 대체로 작동한다.** MCP 게이트 승인 불가(G6 끝단 확인), 배포명령은 위조 P10 에서도 차단(npm publish DENY), 알려진 우회 60+종 deny, 과차단 통제 양호(docs/cat/ls ALLOW).
- **그러나 헤드라인 보증("에이전트는 하네스를 스스로 풀 수 없다")이 흔한 유닉스 도구 4종으로 재현 가능하게 깨진다.** 값의 본질이 "에이전트가 강제를 못 벗어난다"인 제품에서, 작동하는 자기무장해제는 치명적 값 결손이지 미관 문제가 아니다.
- 엔지니어링 위생은 강함: 1031 tests ×3 green · tsc 0 · 자체완결 · 정직한 대장(재계산 일치, 표본 25/25 실제로 닫힘). 대안 대비: Claude Code 순정 훅보다 훨씬 구조화됨. 값은 실재하되 보증에 구멍.

## 못 잰 것 (정직 고지)
- G8 공급망(npm audit)·G10(gitleaks)·G7 Math.random grep 는 직접 재실행 안 함 — 요약표 수치를 신뢰(다만 G10 커밋수는 낡음).
- 빌드(tsup) 미실행(동시 감정자 충돌 회피 규칙). dist 바이트 재현성 미검.
- NEW-1 의 "빠진 도구"는 4종만 확인 — 전수는 아님(더 있을 수 있음, 열거의 근본 한계).
- 실제 Claude Code 세션 내 훅 실동작 미관측(stdin JSON 구동으로 재현).

## 점수 산출 근거
- 대장 재계산 정확·lint 통과·tsc0·1031tests×3·게이트 실질 green·표본 25/25 진짜 닫힘 → 출하위생 자체는 ~4.5.
- 그러나 4.8 하드조건 「open BLOCKER 0」이 ground truth 로 **미충족**(NEW-1/NEW-2 재현). rubric: "조건 하나라도 미충족이면 4.8 미만."
- 완화요인: 알려진 테마의 변주(열거 갬)·배포체인은 여전히 차단·doctor 부분 탐지·나머지 전부 정직/우수 → 바닥은 아님.
- **3.5/5. 4.8 미충족.**
