# 라운드 3-I 수정 기록 — BLOCKER 3건 봉인

**대상** `feature/core-engine-v0` · 감정 고정 HEAD `45bde0c` · 수정 커밋 `d065cf1`
**발견** 7축 독립 재감정 2회차(가치 축 3.5 · 가성비 축) → **메인 세션이 전건 끝단까지 재현**
(재현 기록 `round3i/repro-3i.md`, 감정 원문 `round3i/appraisal2-*.md`)

---

## 뿌리가 하나였다

> **열거는 언제나 빠진 이름을 남기고, 「못 봤으면 통과」는 못 본 만큼 구멍이다.**

세 건 모두 「무엇을 막을지 이름으로 세는」 구조이거나 「비용 때문에 안 본 것을 통과시키는」
구조였다. 라운드 3-H 의 [SEC-100]·[SEC-101] 과 정확히 같은 교훈의 세 번째·네 번째 사례다.

## [SEC-135] 열거 밖 쓰기 프리미티브

`scanBashWrites` 가 쓰기 도구를 이름으로 열거해서, 목록 밖 도구가 **위치 인자**로 파일을 쓰면
대상 추출이 안 되고 리다이렉트도 없어 `mutating=false` 로 통과했다.

| 명령 | 수정 전 | 수정 후 |
|---|---|---|
| `echo x > src/app.ts` (대조) | DENY | DENY |
| `xxd -r -p payload.hex src/app.ts` | **ALLOW** | DENY |
| `openssl enc -base64 -in x -out src/b.ts` | **ALLOW** | DENY |
| `csplit -f src/c input.txt 1` | **ALLOW** | DENY |
| `split -l1 input.txt src/d` | **ALLOW** | DENY |
| `xxd -r -p payload.hex .harness/state.json` | **ALLOW** | DENY |
| `openssl enc -out .harness/config.yaml` | **ALLOW** | DENY |

**처방 — 기본값을 뒤집었다.** 조회라고 *아는* 것(`READ_ONLY_HEADS`)만 빼고 나머지 명령은
변형으로 본다. 대상을 직접 올리지는 않는다 — `node build.js` 의 실행 대상이 쓰기로 오인되기
때문이고, 대신 기존 안전망(슬래시 있는 경로만 보는)이 발화해 진짜 경로만 판정으로 간다.
`READ_ONLY_HEADS` 는 [COST-111] 이 만든 목록을 `bashwrite` 로 옮겨 **한 벌로** 쓴다.

## [SEC-136] 그 구멍으로 강제가 풀린다 — [SEC-69] 재발

1. `Write src/app.ts` → **DENY** · `echo x > src/app.ts` → **DENY**
2. `openssl enc -out .harness/config.yaml` → **ALLOW** ([SEC-135])
3. `design_allowed_prefixes` 가 `[src/, docs/]` 로 덮임
4. `Write src/app.ts` → **ALLOW** ← **강제가 사라졌다**
5. `doctor` → `ok=true`. 정책 드리프트는 warning 으로만 — 탐지는 되나 **강제는 복원 안 됨**

[SEC-135] 처방으로 사슬이 2단계에서 끊긴다. 더해 **가장 무거운 사유를 먼저 말하도록**
코어·정책 대상을 먼저 판정한다 — 안 그러면 입력 파일(`enc.b64`)이 「새 파일 금지」로 거부돼
**진짜 사유가 안 보인다.** 거부의 사유가 엉뚱한 파일을 가리키면 그 거부는 무의미해진다.

## [SEC-137] 비용 캡이 방어를 되돌린다

`SCRIPT_MAX_BYTES = 64KB` 를 넘으면 훅이 스크립트 본문을 **아예 안 읽고** 통과시켰다.

| 입력 | 수정 전 | 수정 후 |
|---|---|---|
| `small.sh` 35B — 첫 줄 `echo "{}" >> .harness/events.jsonl` | DENY (289B) | DENY |
| `big.sh` 같은 첫 줄 + 70KB 패딩 | **ALLOW (0B)** | DENY |
| 직접형 대조 | DENY (289B) | DENY |

[SEC-49]·[SEC-A]·[SEC-100] 세 커밋이 막아 온 「저널 위조 → `doctor --repair` →
**사람 승인 없는 게이트 개통**」 사슬을 크기 패딩만으로 다시 열 수 있었다.
**캡은 지연을 지키려 남기고, 못 읽은 것을 사실로 올려 거부한다**(`opaqueExec` 와 같은 태도).

---

## 측정

| 항목 | 결과 |
|---|---|
| 막아야 할 것 | **11형태 11/11 DENY** |
| 막으면 안 될 것 — 설계 트랙 정상 작업 | **20건 중 오차단 0** |
| 막으면 안 될 것 — 구축 트랙 | **8건 중 0** |
| 무장해제 사슬 | 2단계에서 끊김(정책 파일 사유로 **정확히** 거부) |
| 스위트 | **1041 tests green · tsc 0** |

## 이 라운드가 남긴 것 — 닫지 못한 것

BLOCKER 는 닫혔지만 **같은 감정이 MED 12건을 새로 열었고**, 그중 다섯은
라운드 3-H 가 「닫았다」고 적은 처방의 **잔여**다([QUAL-140]·[SEC-138]·[PROD-141]·[UX-147]·[UX-166]).
[PERF-139] 는 한 발 더 나가 **[PERF-26] 의 close 근거 자체를 다시 열었다**(폴백 p95 229ms).
목록은 대장과 `00-summary.md` 판정 블록에 있다.

> **닫았다고 적기 전에 「이 처방이 안 덮는 이웃 경우는 무엇인가」를 한 번 더 물어야 한다.**
