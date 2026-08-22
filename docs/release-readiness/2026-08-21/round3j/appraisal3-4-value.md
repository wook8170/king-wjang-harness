# [4] 가치/품질(출하) 감정 — 3.0/5

**점수** 3.0 · **4.8 충족** ✗ (하드 조건 「open BLOCKER 0」이 ground truth 가 아니다 — 목록 밖에서 살아있는 BLOCKER 1건을 재현했다) · **감정 시각** 2026-08-23 00:10~00:25 KST · **대상** HEAD `3aec164f87fb3b18e8b97722ac002c3dd9d6cf02` (feature/core-engine-v0), working tree **clean** (`git status --porcelain` 빈 출력)
**한 줄**: 대장의 개별 행은 정직하고 measured 게이트는 재측정에도 버티지만, 「open BLOCKER 0」은 또다시 우리 목록의 산물이었다 — 에이전트가 **단일 Bash 한 줄로 자기 무장해제**하는 경로가 열거 밖에 살아 있고(네 라운드째 같은 패턴), 검증 장치(외부 lint)는 대장의 20%를 조용히 안 본다.

---

## 대장은 정직한가 (재집계 · lint 범위 · 표본 재현)

### 재집계 (헤더를 믿지 않고 직접 파싱)
- **데이터 행 192개**(ID 정규식 `^[A-Z0-9]+-[0-9A-Z]+$`). **ID 중복 0**.
- 심각도 분포: BLOCKER 12 · HIGH 33 · MED 63 · LOW 67 · `—`(양성 불변식 행) 17.
- 상태 분포: **verified 188 · deferred 3 · rejected 1**. (188+3+1 = 192)
- 헤더 주장: 「verified 188 · deferred 3 · open 전체 0 · open BLOCKER 0」. **open 0 · open BLOCKER 0 은 표 대조로 참**(12개 BLOCKER 전부 verified). 다만 헤더가 **rejected 1건(EFF-132)을 집계에 명시하지 않아** 188+3=191 로 1행이 뜬다 — 드리프트라기보다 불완전 표기(LOW).
- **요약↔대장 상태 불일치(발견)**: `00-summary.md:122` 는 「rejected 2건 — [EFF-132]·[QUAL-E]」라 적지만, 대장에서 **QUAL-E 의 상태 칸은 `verified`**(ledger.md:140), rejected 는 EFF-132 하나뿐이다. 산문이 상태 칸과 어긋난다. 판정에 영향은 없으나(둘 다 「닫힘」), 헤더/요약을 신뢰하면 못 볼 드리프트.

### rejected/deferred 가 회피가 아니라 판정인가
- **EFF-132**(rejected, `git push` 가 generic deploy 목록에 없음): **판정이 맞다.** 인용 테스트 실존 확인 — `hook-pre-tool.test.ts:217` 이 `git push origin feature` 를 「과차단 금지」 대상으로 못 박고, `profile.test.ts:76,84` 가 번들 프로파일과 `DEFAULT_CONFIG` 의 바이트 동일을 강제한다. 넣으면 정상 브랜치 push 가 막힌다 → 이 리포는 과차단을 미차단과 같은 무게로 센다. 회피 아님.
- **QUAL-E**(대장상 verified, 요약상 rejected): 인용 테스트 `cost-3i-residuals.test.ts:164` 실존. `src/**` co-located 테스트가 막히는 것을 「의도된 절충」으로 못 박고 표본 안으로 끌어들였다 — 판정으로서 타당. **다만 상태 라벨이 문서마다 다르다**(위 참조).

### lint 의 검사 **범위**를 쟀다 (핵심 발견 — LOW→MED급 신뢰성 결함)
외부 lint(`~/.claude/skills/verifying-production-readiness/bin/ledger-lint.sh`)를 대장에 돌리면:
```
✓ 대장 무결 — 153 행, R1–R7 통과 (open BLOCKER 0)   [exit 0]
```
그런데 **데이터 행은 192개다. lint 는 153개만 본다 — 39행(20%)을 조용히 건너뛴다.**
- 원인: 행 인식 셸 glob `[A-Z]*-[0-9]*` 는 **숫자로 끝나는 ID만** 매칭한다. `SEC-135` 는 보지만 **글자로 끝나거나 글자-숫자 접미인 ID**(`QUAL-E`·`UX-A1`·`PROD-B2`·`SEC-A`·`ENG-F` …)는 못 본다.
- 이건 요약이 「고쳤다」고 적은 바로 그 버그다(`00-summary.md` [SEC-79] 절: 「대장 행 정규식이 글자로 끝나는 ID를 세지 않아 8행이 집계 밖」). 그 수정은 **리포 내부 테스트의 정규식**에만 적용됐고, 감정 지시가 가리키는 **외부 lint 는 리포 밖이라 그대로**다 — 같은 결함이 검증 도구에 여전히 산다.
- **가장 위험한 지점**: 건너뛴 39행 중 **`SEC-A` 는 심각도 BLOCKER**다. lint 의 R6(「open BLOCKER 수 = 헤더」)이 이 행을 **집계에서 아예 뺀다** — 글자 접미 BLOCKER 를 `open` 으로 두면 lint 의 GO 게이트가 무력화된다(지금은 verified 라 실사고는 없지만 **가드가 구조적으로 눈멀었다**).
- **지시대로 그 39행에 R1–R7 을 직접 적용**(lint 로직을 Python 으로 재구현): **위반 0**. 인용 파일 실존·verified 증거 존재·rejected/deferred 사유 존재 전부 충족. 즉 **이번엔 내용은 정직**하나, 도구가 「153행 R1–R7 통과」라 **완전한 것처럼 보고**하는 것이 문제다.

---

## 대장은 완전한가 (목록 밖에서 내가 찾은 것)

**아니다. 살아있는 BLOCKER 1건을 목록 밖에서 재현했다.** 「open BLOCKER 0」은 대장이 그렇게 적었을 뿐 ground truth 가 아니다 — 지시가 경고한 네 라운드째 같은 패턴.

### BLOCKER: 슬래시 없는 파일명 + `cd` 로 SEC-135/SEC-136/SEC-69 가 통째로 재개방
스캐너(`bashwrite.ts`)의 방어는 촘촘하다 — 모르는 명령은 전부 `mutating=true`(fail-closed)로 보고, 안전망 `pathLikeMentions` 가 경로를 잡는다. **그러나 그 안전망은 「슬래시가 있는 토큰만」 본다**(코드 주석이 명시: 확장자만 있는 낱말은 오탐 방지로 제외). 그래서:

- 열거된 위치인자 쓰기 도구(`xxd`·`openssl`·`csplit`·`split`)는 switch 의 `default` 로 떨어져 **대상을 추출하지 않고** `mutating` 만 세운다. 대상 판정은 오직 `pathLikeMentions`(슬래시 필요)에 의존한다.
- 따라서 **경로에서 슬래시를 없애면**(먼저 `cd` 로 진입) 판정이 아예 일어나지 않는다.

**깨끗한 P0(설계 트랙) 샌드박스에서 with-slash vs slashless 대조:**
```
DENY   | xxd -r -p payload.hex src/app.ts            ← SEC-135 fix 작동(열거 범위)
DENY   | openssl enc -base64 -in x -out src/app.ts
DENY   | split -l1 in src/app.ts
DENY   | csplit -f src/c -b %d.ts in 1
ALLOW! | cd src && xxd -r -p payload.hex app.ts       ← 같은 도구, 슬래시만 없앰 → 뚫림
ALLOW! | cd .harness && xxd -r -p f.hex state.json    ← 코어/정책 파일도
ALLOW! | cd .harness && split -l1 in events
```

**엔드투엔드 재현 (훅이 ALLOW 낸 채 실제 디스크에 씀):**
1. P0 에서 훅에 `cd src && xxd -r -p /dev/stdin app.ts <<< "6d616c6963696f757320636f6465"` 를 물림 → **stdout 0바이트, exit 0 (ALLOW)**. 그 명령을 실제 실행 → `src/app.ts` 에 `"malicious code"` 가 쓰임(`xxd -c 32` 로 확인). **설계 승인 전 구현 소스가 쓰였다 — 제품의 핵심 약속 위반.**
2. **자기 무장해제(1~2줄)** — 신선한 P0 샌드박스에서:
   - `cd .harness && xxd -r -p ../p7.hex state.json` (state.json 을 `"P0"`→`"P7"` 로) → 훅 **ALLOW** → `harness status` 가 **phase P7** 보고.
   - 이후 `Write src/app.ts` → 훅 **ALLOW**. **설계 게이트 전면 해제.**
   - 대안 경로도 확인: `events.jsonl` 에 위조 `phase-set P7` 이벤트 append(훅 ALLOW) → `doctor` 는 「phase mismatch」로 **탐지**하지만, **`doctor --repair`(에이전트가 부를 수 있는 정상 명령, 훅 ALLOW)가 위조 저널로 state 를 재구축해 P7 을 정본화**한다. 즉 탐지는 되나 강제는 풀린다.
- **위협 모델 적합성**: 이 전부가 **에이전트의 Bash 도구 호출**이다. rubric 개정 1 이 명시한 위협 모델(「에이전트가 스스로 강제를 푸는 것」)의 정중앙이고, rubric 이 「전부 deny 된다」고 단언한 대상(`.harness/events.jsonl`·state·config 쓰기)이다. 사람이 터미널에서 하는 것이 아니다 → **범위 안, 결함으로 센다.**
- **falsify 하는 주장들**: rubric 개정1 「.harness/events.jsonl 쓰기는 Write·Bash·접두·디렉토리·스크립트까지 전부 deny」(SEC-49/50/90/91/92) · G5 「코어파일 편집 deny」 · 실효성 조건 (b)(c) · 대장 「open BLOCKER 0」.
- **테스트 커버리지 공백 확인**: `blocker-3i.test.ts:38,54,98` 은 `xxd -r -p payload.hex src/app.ts`(**with-slash**)만 검사한다. slashless-after-cd 변형을 검사하는 테스트는 없다(`grep 'cd src'`/`'cd .harness'` core/test → 0건).
- **뿌리**: SEC-135 가 「부류를 잡았다」던 fix 는 슬래시 경로에만 걸린다. 「보호 대상이 사라지는 것을 본다」던 원칙이 **경로 표면(슬래시)에 의존**하는 순간 다시 열거식이 됐다.

---

## 게이트 재측정 (G1–G13 중 내가 다시 잰 것)

커밋된 `core/dist` 로, `npm run build` 없이(환경 규칙 준수).

| 게이트 | 요약표 주장 | 내 재측정 | 판정 |
|---|---|---|---|
| G1 테스트 | 1193 passed ×3, 51 파일 | `vitest run` **×3 모두 1193 passed / 51 files** (동일) | ✅ 일치 |
| G2 타입 | tsc 0 | `tsc --noEmit` **exit 0** | ✅ 일치 |
| G8 공급망 | audit 0 | `npm audit --omit=dev` → **found 0 vulnerabilities** | ✅ 일치 |
| G10 이력 비밀 | **148 커밋** no leaks | `gitleaks detect` → **165 commits scanned, no leaks** | ⚠️ 무결성은 일치, **커밋 수 낡음**(148→165; `git rev-list --count`=169). 지시가 경고한 「낡은 수치」 재발 |
| G5 훅 강제력(부분) | 소스·코어파일 deny | with-slash 전건 DENY **확인** · **slashless 변형은 ALLOW**(위 BLOCKER) | ❌ **부분 실패** |
| G9 훅 지연 | 폴백 추가 wall +29ms | 100k줄/13MB 로 **폴백 추가 wall p95 +30ms** 독립 재현 | ✅ 재정의 근거 실증(아래 절) |

「낡음」 재확인: G10 커밋 수 148 은 라운드 3-I 대상(`45bde0c`) 시점 값으로 보이며, 현재 HEAD 는 165(gitleaks 계수)/169(rev-list)다. 무결성 결론(no leaks)은 내가 165 커밋 전수로 재확인해 유효.

---

## G9 재정의 검증 — 절차·타당성·판정 영향

### 절차: 위반이 아니라 「사유와 함께 남긴 개정」이나, **판정을 뒤집었다**
- `gates.md` 서두는 「낮춰야 할 사유가 생기면 시각·사유와 함께 남긴다」를 허용한다. G9 개정은 `gates.md` 말미 + `00-summary.md` 에 시각(2026-08-22)·사유·자기감사([OPS-74])와 함께 기록됐고, **감정자 재검증 전까지 이 근거로 종합 판정을 올리지 않는다**고 명시했다 → 규칙이 허용한 개정 형식.
- 그러나 Iron Rule 1 의 정신(「결과를 보고 낮추지 않는다」)과의 긴장은 실재한다: 문턱을 **측정 후**(wall 162ms 미충족을 본 뒤) 바꿨고, **옛 기준이라면 불통과였던 G9 를 통과로 만들었다.** 그래서 「무해한 재정의」가 아니라 「정직하게 공시된, 그러나 판정을 뒤집은 개정」으로 본다.

### 타당성: 논거가 내 독립 측정으로 **실증**됐다
새 문턱 「폴백이 **더하는** p95 < 50ms」의 근거 = 「wall-time 절대값은 Node 기동에 지배돼 제품이 아니라 머신을 잰다」.
- 내가 100k줄/13MB 저널로 재측정(wall-time, n=25): 정상 p95 **89ms**, 열화(재생 폴백) p95 **119ms** → **폴백 추가 +30ms**(증거의 +29ms 와 일치, 50ms 안). `node -e ''` 기동 p50 **61ms**.
- **결정적 근거**: 내 머신에서 열화 절대값 **119ms < 150ms 라서 옛 게이트를 통과**한다. 그들 머신에선 162ms 로 **불통과**였다. **동일 코드가 머신의 Node 기동 속도(내 61ms vs 그들 99ms)만으로 통과·불통과가 갈린다** — 「절대 wall-time 문턱은 측정 머신을 잰다」는 주장이 관측으로 증명됐다.
- **반론(사용자는 wall-time 을 겪는다)도 유효하다**: 사용자는 열화 상태에서 호출당 실제로 ~119~162ms 를 문다. G9 가 폴백 델타만 재게 되면 **사용자가 겪는 절대 지연을 캡하는 게이트가 하나도 안 남는다.** 다만 (a) 열화는 state.json 결손 시 1회성이고 재구축되며, (b) 비간섭 기동비는 PERF-95 가 셔뱅 래퍼로 따로 줄였고, (c) G9 의 본래 취지는 「폴백이 저널 크기에 따라 커지는가」라는 스케일 질문이라 델타가 맞는 측정면이다. → **재정의 자체는 타당**하되, **절대 지연 무캡**은 남는 한계(LOW).

### 판정 영향: **뒤집혔다**
옛 기준 「폴백 p95 < 150ms」를 **사용자가 겪는 wall-time 표면**으로 읽으면 그들 머신 162ms → **G9 불통과**. 인프로세스로 읽으면 18.9ms → 통과. 요약표 G9 행도 「wall-time 으로 읽으면 162ms — 미충족」을 스스로 인정한다. 새 기준으로는 통과. **즉 최소 한 게이트(G9)의 판정이 재정의로 fail→pass 로 바뀌었다** — 근거는 타당하나 사실은 사실이다.

---

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

1. **[BLOCKER] slashless-after-cd 로 설계 게이트·강제 전면 우회 (SEC-135/136/69 재개방)** — `core/src/bashwrite.ts:648`(pathLikeMentions, 슬래시 전용) + `:544`(default case, 대상 미추출). 재현(깨끗한 P0): `cd src && xxd -r -p /dev/stdin app.ts <<<HEX` → 훅 ALLOW + `src/app.ts` 실제 기록. 무장해제: `cd .harness && xxd -r -p ../p7.hex state.json` → phase P7 → 소스쓰기 전면 허용. 코어/정책 파일(`state.json`·`events.jsonl`·`config.yaml`)도 동일 경로로 ALLOW. 테스트 공백: `blocker-3i.test.ts:38` 는 with-slash 만 검사.

2. **[MED] 검증 도구(외부 ledger-lint)가 대장의 20%를 조용히 건너뛴다** — 행 glob `[A-Z]*-[0-9]*` 가 글자 접미 ID 39행(BLOCKER `SEC-A` 포함)을 안 본다. lint 는 「153행 R1–R7 통과」라 완전한 척 보고. 리포 내부 정규식만 고쳤고 외부 도구는 그대로. (내가 39행에 R1–R7 직접 적용 → 위반 0, 즉 현재 내용은 정직)

3. **[LOW] 요약↔대장 상태 드리프트** — `00-summary.md:122` 는 QUAL-E 를 rejected 라 하나 대장 상태 칸은 verified(`ledger.md:140`). 헤더는 rejected 1건을 집계에 명시 안 함(188+3=191≠192).

4. **[LOW] 요약표 G10 커밋 수 낡음** — 「148 커밋」 vs 실제 165(gitleaks)/169(rev-list). 무결성 결론은 유효.

5. **[LOW] 절대 사용자 지연을 캡하는 게이트 부재** — G9 재정의 후 폴백 델타(<50ms)만 잼. 사용자가 겪는 호출당 wall-time(열화 시 100k줄에서 ~119~162ms)에는 게이트가 없다.

---

## 못 잰 것 (정직 고지)

- **dist 재빌드 안 함**(환경 규칙) — 커밋된 `core/dist` 로만 실측. 소스↔dist 일치는 DET-41(바이트 재현)에 의존, 내가 재확인하지 않음.
- **G9 인프로세스 표면 직접 측정 안 함** — wall-time(사용자 표면)만 쟀다. 인프로세스 +16.3ms 주장은 재현 안 함(방향은 wall 델타로 교차 지지).
- **측정 표면 고지(G9)**: 위 89/119ms 는 **프로세스 wall-time**(`node cli.js hook pre-tool` 전체). 다른 감정자가 동시 실행 중일 수 있어 절대값에 부하 잡음 가능 — 그러나 정상↔열화를 **같은 머신에서 교차**로 재 델타(+30ms)는 부하에 강건.
- **G3·G4·G6·G7·G11·G12·G13 전수 재측정 안 함** — 시간·범위상 요약표 값을 액면 재현하지 않음(이 축은 G1/G2/G5부분/G8/G9/G10 에 집중).
- **동시 세션 경합·마켓플레이스 설치·`.harness` 병합 충돌·장기 상주** — 요약의 「못 본 축」과 동일, 나도 못 봄.
- **BLOCKER 의 심각도 등급화**: 무장해제가 「탐지는 되나(doctor) 강제는 풀린다」는 점에서, 위협 모델에서 doctor 를 강제 실행하는 운영 규율이 있다면 완화될 여지 — 그 규율의 실재는 코어 밖이라 못 쟀다(`inferred`: 없음).

---

## 점수 산출 근거

- 이 축의 **하드 조건 「open BLOCKER 0」이 ground truth 가 아니다** — 목록 밖에서 살아있는 BLOCKER(단일 Bash 자기 무장해제)를 깨끗한 P0 에서 엔드투엔드 재현. rubric 상 하드 조건 미충족은 **4.8 를 원천 차단**하고, 「출하 품질」 축에서 핵심 약속(물리적 강제)을 무력화하는 살아있는 BLOCKER 는 상한을 크게 끌어내린다. **(4.8 ✗)**
- **3.0 이하로 더 내리지 않은 이유**: 열거된 방어는 진짜로 깊다 — 목록 밖 우회 18+종(다른 인터프리터·awk 내부 리다이렉트·dd·install·truncate·ed/ex·sponge·env/nice/setsid/stdbuf/time/command prefix·경로 변수/따옴표/glob/명령치환 난독화) **전건 DENY**. measured 게이트(G1 1193×3·G2·G8·G10)는 재측정에 그대로 버텼고, 대장 개별 행은 인용 실존·측정 진실성에서 정직(lint 미검 39행 포함 R1–R7 위반 0). G9 재정의는 내 독립 측정으로 타당성이 실증됐다.
- **3.0 이상으로 올리지 않은 이유**: (a) 살아있는 core-promise-defeating BLOCKER — 이 축이 막아야 할 바로 그 실패 모드가 **네 라운드 연속** 목록 밖에서 나왔다. (b) 정직성 장치 자체의 완전성 결함 — 감정 지시가 가리키는 외부 lint 가 대장의 20%(BLOCKER 등급 행 포함)를 안 보면서 「통과」를 보고. (c) 낡은 수치(G10)·요약 드리프트(QUAL-E)로 헤더/요약을 액면 신뢰하면 안 됨을 재확인.
- 종합: **3.0/5.** 「닫혔다」의 개별 정직성은 높으나, **「완전하다」와 「출하 가능」은 아니다** — 판정은 결함 집계가 아니라 목록 밖 재현이 가른다는 이 리포 자신의 교훈이 이번에도 유효하다.
