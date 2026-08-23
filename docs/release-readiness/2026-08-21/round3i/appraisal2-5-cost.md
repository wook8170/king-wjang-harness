# [5] 가성비 감정 — 4.5/5
**점수** 4.5 · **4.8 충족** ✗ · **감정 시각** 2026-08-22

## 측정 환경
- Apple M4 · 10코어 · node v22.22.2 · 단독 감정(다른 축 종료 후). 측정 중 load 1분 평균 4.1~4.3 (15분 평균은 이전 감정자 부하 잔재 12→ 감소 중). 스폰 바닥(python subprocess 로 /usr/bin/true): p50 1.5ms — 모든 수치에 포함된 공통 오버헤드.
- 측정 도구: bench.py (워밍업 3회 제외, subprocess wall time, 표본 정렬 후 p50/p95/max)

## 조건별 실측 1 — 비간섭 시 비용 0 (.harness 없는 프로젝트)
- sh 게이트 `bin/harness-hook pre-tool`: n=100, p50 2.9 / p95 3.4 / max 4.0 ms · stdout 0B · exit 0 · **디렉토리에 파일 생성 0건** ✅
- session-start / stop 게이트: n=30 각, p50 3.0 / p95 3.5~3.7 ms · 침묵 ✅
- MCP 서버(빈 프로젝트): initialize 188 chars, **tools/list = 0개 도구**(13 chars) · stderr 0 · 파일 생성 0건 ✅
- 참고(게이트 없을 때의 비용): `bin/harness` node 직행 pre-tool = p50 56.7 / p95 59.5 ms — sh 게이트가 이 비용을 **19.5배**(56.7→2.9ms) 줄인다. 코드 주장(~107ms→~4ms, bin/harness-hook:5)과 방향 일치, 절대값은 이 머신에서 더 빠름.

## 조건별 실측 2 — 훅 기동 감축 주장 재현
- 주장 1(matcher 감축): 구 감정문서(docs/appraisal/2026-08-21-plugin-appraisal.html:196)의 「PostToolUse matcher `*`」가 hooks/hooks.json 에서 `Write|Edit|MultiEdit|NotebookEdit|Bash` 로 좁혀져 있음을 확인 — Read/Grep/Glob/Task/WebFetch 등 조회 도구에는 훅이 아예 뜨지 않는다(파일 기준 재현 ✅, 세션 도구 믹스별 감축률은 환경 의존이라 별도 실측 불가 고지).
- 주장 2(PERF-95, 기동비 ~107ms→~4ms): 위 실측으로 재현 ✅ (56.7ms→2.9ms).
- 주장 3(COST-A, 래퍼 25개 정규식 8270ms→선형 스캔): 아래 최악 경로에서 재현.
- 주장 4(PERF-26, 저널 10만건 p95 169ms→150ms 미만): 아래 폴백 실측에서 재현.

## 지연 분포 — 정상 경로 (.harness 있음, state.json 정상, n=50/30)
| 경로 | p50 | p95 | max | stdout |
|---|---|---|---|---|
| pre-tool Write 허용(docs) | 65.6 | 83.7 | 90.8 | 0B(침묵=허용) |
| pre-tool Write 거부(.harness/state.json) | 65.6 | 102.3 | 121.7 | 237B |
| pre-tool Write 거부(P0에서 src/app.ts) | 69.7 | 72.6 | 76.8 | 654B |
| pre-tool Bash 단순명령 | 68.8 | 93.9 | 118.1 | 0B |
| post-tool | 64.7 | 77.1 | 148.3 | 0B |
| session-start | 64.7 | 71.4 | 78.1 | 1032B |
| stop | 63.8 | 86.8 | 88.7 | 0B |
- 분해: node 기동 p50 41.3ms + 594KB 번들 require ≈ +15ms (node -e require = 56.1ms) → **판정 로직 자체는 ~10ms**, 지연의 85%가 프로세스 기동.

## 토큰 비용 (문자수 · ~ASCII/4 토큰 추정)
- **SessionStart 주입** (세션마다, 컨텍스트에 상주):
  - 갓 init(P0·활성웨이브 없음): 944 chars ≈ 236 토큰. 설계트랙 안내(P0~P6)가 대부분.
  - 활성 웨이브 + 61KB 지시서(30×2KB 턴로그): **2,233 chars ≈ 558 토큰** — 지시서가 커도 주입은 캡됨(턴로그 excerpt 마지막 5줄·각 줄 UNTRUSTED_MAX_LINE=200자 절단). **폭주 없음** ✅
  - degraded 시 경고 2줄 추가(+저널 손상 줄수).
- **훅 deny 메시지** (거부 발생 시 1회, 상주 아님): opaque-exec 573B · git apply(stdin) 375B · deploy 177B · bash→src 611B · core파일 보호 290B · stop 가드 283B. 최대 ~600B ≈ 150토큰. 거부는 이벤트성이라 상주 비용 아님.
- **스킬/에이전트** (invoke 시에만 본문 로드): SKILL.md 본문 3.6~7.9KB(11개·총 58KB), 에이전트 2.5~7KB(5개·23KB). **세션 상주 비용은 frontmatter description 만** — 스킬 11개 합 4,534 chars(≈1,133토큰), 에이전트 5개 각 ~400 chars. 본문은 지연 로드라 상주 아님.
- **MCP 스키마** (하네스 프로젝트에서 MCP 연결 시 상주): tools/list 16개 도구 = 5,835 chars ≈ **1,458 토큰**. 빈 프로젝트에선 0개(비간섭). 상시 노출이라 세션당 가장 큰 단일 토큰 비용.

## 최악 경로 (내가 만든 것)
- **거대 저널 폴백**(state.json 삭제, 저널 100k~300k줄) — 아래 결함 COST-1 로 상세. F4(전부 replay-type 100k)가 최악.
- **64KB 초과 스크립트**: `bash big.sh`(>64KB, 안에 `>> .harness/events.jsonl`) → **출력 0B(스캔 스킵, 통과)**. SCRIPT_MAX_BYTES=64KB 비용캡이 방어를 뚫는다(반대방향 결함).
- **깊이 4 스크립트 체인**(a→b→c→d, d가 코어파일 기록) → **출력 0B(통과)**. depth<3 비용캡 초과.
- **접두 래퍼 폭주**(COST-A 재현): 아래 결함에서 선형 스캔 확인.

## 조건별 실측 3 — COST-A(접두 래퍼 정규식 지수폭발) 재현
- `isSelfCall` 이 선형 스캔인지: `timeout 30` 을 10/22/25/40회 중첩 후 `make buildX`(비-harness) 로 끝나는 Bash pre-tool.
- 결과(load 높은 상태라 절대값 인플레): wrappers 10→40 에서 p50 337→385ms 로 **평탄**. 25 래퍼에서 8270ms 같은 폭발 없음. **선형 스캔 고정 확인 ✅** (구 정규식 회귀는 로드와 무관하게 초 단위로 보였을 것 — 안 보임).

## 폴백(저널 재생) 경로 — 조건 「폴백 p95 < 150ms」 검증
### 정상 vs 폴백-fresh 짝측정(같은 로드창, load 53.8, 프로세스 포함)
- NORMAL(state.json 존재): p50 201.6 / p95 453.5ms (로드 인플레)
- FALLBACK-fresh(state.json 삭제, 2줄 저널): p50 212.7 / p95 254.9ms
- **DELTA p50 = +11ms** — fresh 폴백은 정상 경로보다 딱 저널 2줄 읽기+재생만큼(~10ms) 비싸다. 청정창 정상 p95(72~102ms) + 11 ≈ **85~113ms < 150ms ✅**
### 저널 처리 순수 CPU 비용(in-process, warm, node기동 제외, load 41.8 인플레)
| 저널 | FAST p50/p95 | NAIVE(구, 전줄파싱) p50 | 속도향상 |
|---|---|---|---|
| fresh(2줄) | 0.1 / 0.5ms | 0.0ms | — |
| 100k 현실적(99% 턴로그) | 78.8 / 126.2ms | 237ms | **3.0x** |
| 100k 전부 replay-type | 168.9 / 202.6ms | 140.6ms | **0.8x (역행!)** |
| 300k 현실적 | 199.0 / 212.5ms | 590.7ms | 3.0x |
- **PERF-26 주장(10만건 p95 169→150미만) 재현**: 현실적 저널에서 fast p95 126ms(load 41.8, 청정시 더 낮음) — 방향·효과 확인 ✅
- **역행 발견**: 저널이 전부 상태변경 이벤트면 fast 경로가 naive 보다 **느리다**(regex 스캔 + 전줄 JSON.parse 이중 비용). 현실 저널은 턴로그·노드등록이 대부분이라 실측 이득이 크지만, all-replay 는 최악.
- **비용 절벽**: 저널 100k+ 에서 폴백 경로가 순수 CPU 만으로 150ms 근접/초과, 300k 는 확실히 초과. 단 이는 **state.json 부재/손상(열화) + 대형저널** 동시 조건에서만 — 정상 경로는 state.json(O(1)) 만 읽고 저널을 아예 안 본다(handleHook: readState 성공시 저널 미접근, 코드+F5 실측 확인).

## 청정창 재측정 (load 9~11 — 세션 내내 외부 빌드(gstudio vitest)가 10코어 포화, 완전 청정창 확보 불가)
- 로드 보정 기준: load 4(초기 청정) 정상 p50 65.6/p95 83.7 → load 9 정상 p50 99.8/p95 116.1. **load 9는 정상경로에 +34/+32ms 인플레.**
| 경로(process 포함, n=40) | p50 | p95 | max | load4 보정 추정 p95 |
|---|---|---|---|---|
| 정상(state.json 존재) | 99.8 | 116.1 | 164.7 | ~84 |
| 폴백 fresh(2줄) | 111.0 | 125.6 | 133.2 | **~93 <150 ✅** |
| 폴백 100k 현실적(23MB) | 172.3 | 202.5 | 252.9 | **~170 >150 ✗** |
| 폴백 100k all-replay(9MB) | 242.8 | 272.9 | 303.9 | ~240 |
| 폴백 100k short-line(10MB) | 204.6 | 247.3 | 275.5 | ~215 |
- **README 주장 반증**: README:118 「102ms on the journal-replay fallback with a 100k-entry journal」·README:216 「replay at 100k p95 ≈ 101ms」 — 내 최선의 창(load 9~11)에서 100k 폴백은 p95 202~247ms, load4 보정해도 ~170~215ms 로 **150ms·101ms 둘 다 초과**. 파일크기(23MB vs 10MB) 무관하게 라인수 10만이 원인. in-process 순수 CPU(78~169ms, load무관 상대작업) 만으로도 node기동 56ms 위에 얹혀 150ms 근접 — 로드와 무관하게 100k 폴백이 150ms 를 넘는다고 판단.
- **조건 2 판정**: fresh/전형 폴백은 <150ms 충족 ✅. 그러나 제품이 **헤드라인으로 광고한** 100k 폴백 지점은 미충족 ✗ (그리고 문서의 101ms 는 재현 실패).

## 발견한 결함

### MED-1 · 64KB 스크립트 크기캡(비용캡)이 코어파일 보호를 뚫는다 — 미문서화
- 파일: core/src/hook.ts:653 (`SCRIPT_MAX_BYTES = 64*1024`), :675 (`st.size > SCRIPT_MAX_BYTES` → continue). 주석이 명시적으로 「비용은 … 64KB 상한이 막는다」 = 비용 목적.
- 재현: 샌드박스 D에서
  - `printf 'echo "{}" >> .harness/events.jsonl\n' > small.sh` → `bash small.sh` pre-tool = **deny(290B)** ✅
  - 같은 첫 줄 + 65KB 패딩 → `bash big.sh` pre-tool = **출력 0B(허용)** ✗
- 피해: 스크립트 본문을 64KB 넘겨 패딩하면 훅이 본문을 아예 안 읽어(statSync 크기 게이트) 그 안의 `>> .harness/events.jsonl` 저널 위조가 **투명하게 통과**. 이어서 `harness doctor --repair` 재생으로 위조 gate-approved 가 상태로 반영 → **사람 승인 없이 배포 게이트 개방**. 이는 SEC-49/SEC-A/SEC-100 세 커밋이 막으려던 바로 그 클래스이고, 비용캡이 되돌렸다. README 「알려진 한계」는 depth-3·4단계·make 만 적고 **64KB 크기캡은 미기재**. (보안축이 심각도를 더 높게 볼 수 있음 — 가성비축에서는 「비용절감이 방어를 뺀 곳」으로 MED.)

### MED-2 · 100k 저널 폴백이 광고 지연(150ms/101ms)을 초과 — 문서 주장 재현 실패
- 파일: README.md:118, :216 (100k 폴백 p95 ≈ 101~102ms 주장); events.ts:104 (PERF-26).
- 재현: 위 청정창 표 — 100k 현실적 폴백 p95 202.5ms(load9), load4 보정 ~170ms; short-line 도 247ms. in-process 순수 CPU 78~169ms.
- 피해: state.json 부재/손상(열화) + 대형저널 동시조건에서 도구 호출당 사람이 기다리는 지연이 광고의 2배. 열화 복구 구간 한정이나, 제품이 헤드라인으로 내건 수치가 안 맞음.

### LOW-1 · PERF-26 fast-path 가 all-replay 저널에서 naive 보다 느리다(역행)
- 파일: events.ts:112~128 (readJournalForReplay). 재현: in-process 100k all-replay FAST p50 168.9 vs NAIVE 140.6 = **0.8x**. regex 스캔 + 전줄 JSON.parse 이중비용. 현실 저널(턴로그 다수)에선 3.0x 이득이라 실무 영향 작음, 저널쓰기는 코어보호로 막혀 악의적 유발도 어려움 → LOW.

### LOW-2 · 깊이 4 스크립트 체인 미추적(비용캡 depth<3) — 문서화됨
- 파일: hook.ts:661 (`depth >= 3`). 재현: a.sh→b.sh→c.sh→d.sh(d가 코어파일 기록) → `bash a.sh` = 출력 0B(통과). README:220 에 「4-level script chain is not followed」 명시. 문서화된 한계라 LOW.

## 반대 방향 (비용 절감이 방어를 빼먹는 곳)
- **64KB 크기캡**(MED-1): 큰 파일 안 읽어 지연 절약 → 스캔 자체를 건너뛰어 저널위조 통과. 가장 강한 역행.
- **depth<3 체인캡**(LOW-2): 파일 몇 개 안 읽어 절약 → 4단계 체인 통과(문서화).
- **PostToolUse read-only 분류**(COST-111, hook.ts:1233): 조회 Bash 를 활동집계 제외해 정산왕복 절약. **화이트리스트+스캐너 AND·fail-closed** 로 안전하게 설계됨 — `echo hi>f` 는 활동, `git commit` 은 활동. 역행 아님(모범).
- **profileCache**(hook.ts:923): 대상마다 YAML 재파싱 안 함 — 방어 무손실 비용절감(모범).
- **matcher 축소**(hooks.json): Read/Grep 등에 훅 미기동 — 그 도구들은 쓰기가 아니라 강제 대상 아님(안전).

## 못 잰 것 (정직 고지)
- **완전 청정 지연창 확보 실패**: 세션 내내 외부 프로젝트(gstudio) vitest 가 M4 10코어를 포화(load 4→67, 최선의 창도 load 9~11). 초기 비간섭·정상경로(load 4.1~4.3)만 청정. 폴백 절대값은 load 인플레 포함 — 단 in-process CPU 분해와 load 보정으로 결론(100k 폴백 >150ms)은 로드와 무관하게 성립.
- **세션 도구믹스별 실제 감축률**: matcher 축소가 실세션에서 몇 % 훅을 줄이는지는 사용자 도구 사용 분포에 의존 — 환경별이라 단정 불가(파일기준 재현만).
- **Makefile 경로**: make 타깃 미해석은 문서화된 한계로 확인만, 별도 실측 안 함.
- **isSelfCall 직접 단위측정 불가**: cli.js 번들에 미노출 → 훅 경로(프로세스 포함)로만 COST-A 재현.

## 점수 산출 근거
- 조건1(감축 측정치) ✅ 강하게 재현: sh게이트 비간섭 기동 56.7→2.9ms(19.5x), matcher 축소, COST-A 선형화(25래퍼 8270ms 폭발 소거), PERF-26 현실저널 3.0x.
- 조건3(비간섭 0) ✅ 모범: 훅 stdout 0B·파일 0건·MCP tools 0개·부작용 0.
- 조건2(폴백 p95<150ms) △: fresh/전형 폴백 ~93ms 충족이나 **제품이 광고한 100k 폴백은 ~170ms(load보정)로 미충족 + 문서 101ms 재현 실패**(MED-2).
- 잔여: MED-1(64KB 미문서 비용캡→저널위조 통과)·MED-2. 4.8 규칙(전건충족+잔여 LOW이하) 미달 — MED 2건.
- 코어·상시경로의 비용공학은 우수(비간섭·정상·fresh폴백 전부 예산내, 저널 재파싱 캐시·fail-closed 조회분류). 그러나 광고 지연이 안 맞는 지점과 비용캡發 미문서 방어구멍이 있어 4.8 아래.
- **점수 4.5 / 5** · 4.8 충족 ✗
