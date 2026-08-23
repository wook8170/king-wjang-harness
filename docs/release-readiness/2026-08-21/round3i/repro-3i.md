# 라운드 3-I 감정 발견 — 메인 세션 재현 (OPS-74)
대상 HEAD 45bde0c · 전건 mktemp 샌드박스

## [확인·BLOCKER] 열거되지 않은 쓰기 프리미티브 (가치 축 NEW-1)
`scanBashWrites` 는 쓰기 도구를 **이름 열거**로 본다. 목록 밖 도구가 위치 인자로 파일을 쓰면
대상 추출이 안 되고 리다이렉트도 없어 `mutating=false` → ALLOW.

| 명령 | 판정 |
|---|---|
| `echo x > src/app.ts` (대조) | DENY |
| `xxd -r -p payload.hex src/app.ts` | **ALLOW** |
| `openssl enc -base64 -in x -out src/b.ts` | **ALLOW** |
| `csplit -f src/c input.txt 1` | **ALLOW** |
| `split -l1 input.txt src/d` | **ALLOW** |
| `xxd -r -p payload.hex .harness/state.json` | **ALLOW** |
| `openssl enc -base64 -in x -out .harness/config.yaml` | **ALLOW** |
| `xxd -r -p payload.hex > src/app.ts` (리다이렉트) | DENY |

→ **위치인자형만 뚫린다.** SEC-50·SEC-92(둘 다 BLOCKER)와 같은 부류.

## [확인·BLOCKER] 그것으로 강제를 푼다 (가치 축 NEW-2 = SEC-69 재발)
끝단까지 실측:
1. `Write src/app.ts` → **DENY** · `echo x > src/app.ts` → **DENY**
2. `openssl enc -out .harness/config.yaml` → **ALLOW** (위 결함)
3. config.yaml 이 `design_allowed_prefixes: [src/, docs/]` 로 덮임
4. `Write src/app.ts` → **ALLOW** · `echo x > src/app.ts` → **ALLOW** ← 강제 사라짐
5. `doctor` → `ok=true`, 정책 드리프트는 **warning** 으로만. 탐지는 되나 강제는 복원 안 됨.

## [확인·BLOCKER] 64KB 스크립트 캡이 방어를 되돌린다 (가성비 축 MED-1)
`hook.ts` 의 `SCRIPT_MAX_BYTES = 64KB` — 넘으면 본문을 **아예 안 읽는다**(비용 목적).
- `small.sh`(35B, 첫 줄이 `echo "{}" >> .harness/events.jsonl`) → `bash small.sh` **DENY(289B)**
- `big.sh`(같은 첫 줄 + 70KB 패딩) → `bash big.sh` → **ALLOW(0B)**
- 직접형 대조 → DENY(289B)
→ SEC-49·SEC-A·SEC-100 이 막으려던 그 사슬을 **비용 캡이 열어 놨다.** README 「알려진 한계」에 미기재.

## [확인·조건 미충족] G9 폴백 p95 (가성비 축 MED-2 — 지난 라운드 감정자와 상충)
내가 직접 측정(머신 조용, 다른 감정자 전원 종료 후):
- 저널 100,002줄 / 10.5MB(턴로그 90% — 제품이 상정한 현실 분포), `state.json` 삭제(열화)
- `bin/harness hook pre-tool` n=30 → **p50 211.3ms · p95 229.1ms · max 237.6ms**
- 게이트 G9 = 폴백 p95 **< 150ms** → **미충족**. README 광고치(≈101ms)와도 2배 차이.
- 지난 라운드 가성비 감정자는 같은 항목을 103.5ms 로 냈다 — **두 측정이 어긋난다.**
  내 수치는 프로세스 기동 포함 wall-time 이고, 조건도 프로세스 표면 기준이므로 이쪽을 채택한다.
  (지난 측정이 in-process 였거나 저널 구성이 달랐을 가능성 — 어느 쪽이든 지금 값이 게이트를 넘는다.)

## 사용자 결정 반영
- `verifying-production-readiness` 스킬은 **출하 직전 동봉 예정**(사용자 지시).
  따라서 상품성 축 MED(D2)는 「미동봉」이 아니라 **`agents/readiness-auditor.md` 가
  "It is already installed on this machine" 라고 단정하는 것**만 결함으로 등재한다(LOW).
