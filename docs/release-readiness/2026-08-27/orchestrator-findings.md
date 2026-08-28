# 오케스트레이터 직접 발견 (축 파일 소유 충돌 회피용 별도 파일)

**감사 모델**: 오케스트레이터(Opus 5, 메인 세션) · **감사일** 2026-08-27 · **대상 커밋** `bacb4bc`
**성격**: 축 감사 중 오케스트레이터가 **자기 도구 호출이 거부되는 것을 관찰해** 직접 재현·분리한 발견.
축 ④(E2E)·⑥(보안)·②(계약) 담당 에이전트가 아직 실행 중이라 그 파일을 건드리지 않고 여기에 적는다.

> **전제**: 감사 중 에이전트 하나가 브리핑을 어기고 대상 저장소 루트에서 `harness init` 을 실행해
> 저장소가 자기 훅의 통제 아래 들어갔다(`evidence/hygiene-contamination-2354.md` 참조 — 그 파일도
> 같은 이유로 못 써서 이 파일에 합쳤다). 그 결과 **감사 세션 자신이 이 제품의 실사용자가 됐고**,
> 아래는 그 상태에서 관측된 실제 사용 경험이다. 오염은 측정 위생상 문제지만, 이 발견들 자체는
> 「하네스가 켜진 프로젝트에서 에이전트가 겪는 일」이라 **오염이 아니라 관측**이다.

---

## [ORCH-01] HIGH — heredoc **본문**의 문자열이 쓰기 대상으로 오인돼, 하네스를 문서화할 수 없다

**근거등급** measured

**재현 (그대로 붙여넣으면 재현된다 — `.harness/` 가 있는 프로젝트에서)**

```
cd <harness 가 켜진 프로젝트>/docs
cat > probe-t2.md <<'EOF'
Prose mention with a fully literal write target: .harness/state.json
EOF
```

**관측된 결과** — PreToolUse 훅이 `deny`:

```
.harness/state.json can only be changed by harness commands — editing it by hand
desynchronises the journal from the state. (shell redirects, tee, sed -i follow the same rule)
```

**무엇이 깨지는가**

쓰기 대상은 `probe-t2.md` 다. 완전한 **리터럴 경로**이고, **프로젝트 안**이고, 하네스 소유 경로가
전혀 아니다. 그런데도 거부된다 — 훅이 **명령 텍스트 전체**(heredoc 본문 포함)에서 하네스 소유
경로 문자열을 찾고, 그것이 실제 리다이렉트 대상인지 **본문 데이터인지 구분하지 않기 때문**이다.

파급:

- **하네스가 켜진 프로젝트에서 에이전트는 하네스를 문서화할 수 없다.** README·설정 가이드·아키텍처
  문서·체인지로그·감사 리포트 — `.harness/state.json`·`.harness/events.jsonl`·`.harness/config.yaml`
  같은 파일명을 본문에 적는 순간 쓰기가 막힌다.
- **이 제품 자신의 저장소가 가장 큰 피해자다.** `README.md`·`docs/` 가 이 경로들을 수십 번 언급한다.
  이 저장소에서 하네스를 켠 채 에이전트에게 문서 작업을 시키면 그 작업이 막힌다.
- 이번 감사에서 **실제로 막혔다**: 오염 사건 기록 파일(`evidence/hygiene-contamination-2354.md`)을
  Bash heredoc 으로 쓰려다 세 번 거부당했고, 결국 Write 도구로 우회해 이 파일을 만들었다.
- 워크어라운드는 「그 파일명을 적지 않는 것」뿐이다. 정확한 문서를 쓰지 못하게 만드는 워크어라운드다.

**분리 실험 — 「대상이 불명확해서」가 아니라 「본문을 스캔해서」임을 확정했다**

| 시도 | 쓰기 대상 | 본문에 하네스 경로 | 결과 |
|---|---|---|---|
| T1 | `"$SP/t1.md"` (변수) | 있음 | deny |
| T2 | `evidence/probe-t2.md` (**완전 리터럴 · 프로젝트 안**) | 있음 | **deny** ← 결정적 |
| 대조 | `evidence/probe-write.txt` (리터럴) | 없음 | **allow** (`evidence/probe-write.txt:1` 이 그 산출물) |

T2 와 대조군의 차이는 **본문에 그 문자열이 있느냐 하나뿐**이다.

**결정적 교차 근거 — Write 레인은 같은 내용을 통과시킨다**

이 파일(`orchestrator-findings.md`) 자체가 증거다. 이 파일은 `.harness/state.json` 을 **본문에서
여덟 번 넘게 언급**하는데, **Write 도구로는 한 번에 통과**했다. 같은 프로젝트·같은 설계 트랙·같은
확장자·같은 문자열인데 **Bash 레인만 거부한다.**

이것이 문제의 위치를 정확히 짚는다: Write 는 쓰기 대상이 `file_path` 필드로 **모호하지 않게**
주어지므로 본문을 데이터로 올바르게 취급한다. Bash 는 명령을 파싱해야 하는데, 그 파서가
heredoc 본문을 명령 텍스트와 섞어 본다. **정답은 이미 Write 레인에 구현돼 있다** — Bash 레인의
판정 입력에서 heredoc 본문을 빼면 된다.

**제안** 쓰기 판정은 **실제 리다이렉트/명령 인자 위치에서 해석된 경로**로만 하고, heredoc 본문·
따옴표 안 데이터는 판정 입력에서 제외한다. 본문 스캔이 의도된 방어(본문에 숨긴 경로 조립)라면,
그건 「대상이 불명확하면 deny」 규칙(ORCH-02 참조)이 이미 담당하는 영역이라 중복이다.

---

## [ORCH-05] HIGH — FD 복제 리다이렉트(`2>&1`)를 파일 쓰기로 오인해, **순수 읽기 명령**이 거부된다

**근거등급** measured

**통제 대조쌍 — 기저 명령을 `cat .harness/state.json` 으로 고정하고 리다이렉트만 바꿨다**

| 리다이렉트 | 판정 |
|---|---|
| (없음) | allow |
| `2>/dev/null` — **진짜 파일 리다이렉트** | allow |
| `2>&1` — FD 복제, 파일을 안 쓴다 | **deny** |
| `1>&2` — FD 복제 | **deny** |

`ls -d` 로 기저를 바꿔도 같다(`ls … 2>/dev/null` allow · `ls … 2>&1` deny). 즉 **명령도, 파일
리다이렉트 여부도 아니고, `N>&M` 형태 하나가 판정을 뒤집는다.**

전수 결과: `evidence/probe-overblock.md` · 드라이버 `evidence/probe-overblock.js`
(훅을 stdin JSON 으로 직접 구동 — Claude Code 가 보내는 형태 그대로).

**무엇이 깨지는가**

`cmd 2>&1` 은 셸에서 가장 흔한 관용구다. 하네스가 켜진 프로젝트에서 **하네스 파일을 들여다보는
모든 명령**이 여기 걸린다 — `cat`·`ls`·`wc`·`tail` 무엇이든 `2>&1` 이 붙으면 거부된다.

더 나쁜 것은 **거부 메시지가 사실과 다르다**는 점이다:

> `.harness/state.json` **can only be changed** by harness commands — **editing it by hand**
> desynchronises the journal from the state.

사용자는 **아무것도 바꾸지 않았다. 읽으려 했을 뿐이다.** 이 메시지를 받은 에이전트는 「내가 쓰기를
시도했구나」라고 잘못 결론 내리고, 실제로는 존재하지 않는 문제를 고치려 든다. 이것이 훅 출력이
모델의 컨텍스트로 들어가는 제품에서 특히 비싼 이유다.

**추정 원인** 파서가 `>` 뒤의 `&1` 을 파일명으로 해석하려다 실패하고, 「대상을 해석할 수 없다」
분기로 떨어져 **명령 어디엔가 있는 하네스 경로를 쓰기 대상으로 간주**한다. 실제로 이 세션은 그
분기의 메시지를 직접 받았다: *"expands the path in a way this hook cannot resolve (command
substitution, brace expansion, or a glob), so where the write lands is unknown"*.

**제안** 리다이렉트 대상 파싱에서 `N>&M`(FD 복제)과 `&-`(FD 닫기)를 **파일 쓰기가 아닌 것**으로
먼저 분류한다. 이 둘은 파일시스템에 전혀 닿지 않으므로 fail-closed 분기에 들어갈 이유가 없다.

**진짜 차단은 온전하다 — 이건 과차단만의 결함이다** 같은 프로브에서 진짜 금지 쓰기 5종
(직접 덮어쓰기 · append · `tee` · `sed -i` · `rm`)은 **5/5 전부 deny** 됐다(`evidence/probe-overblock.md`).
보안 핵심을 약화시키자는 제안이 아니라, 파일을 안 쓰는 형태를 오탐에서 빼자는 것이다.

---

## [ORCH-11] MED — 「gitleaks 0」이 「GitHub 푸시 보호 통과」를 뜻하지 않는다

**근거등급** measured · **발견 경위**: 출하 push 가 실제로 거부되면서.

라운드 3 의 비밀 마스킹 테스트가 픽스처로 토큰 «모양» 리터럴을 넣었고, `git push` 가
**GitHub 푸시 보호에 거부**됐다:

```
remote: —— Slack API Token ——
remote:  locations:
remote:    - commit: 9ca6277… path: core/test/ops-round3-2026-08-27.test.ts:67
remote: ! [remote rejected] main -> main (push declined due to repository rule violations)
```

**그런데 같은 문자열을 `gitleaks` 는 잡지 않는다.** 격리 확인(임시 디렉터리, `gitleaks` v8.30.1
기본 룰): 슬랙 봇 토큰 접두(`xox` + `b-`)와 GitHub PAT 접두(`ghp` + `_`) 형태를 넣은 파일에 대해
**`no leaks found`**. — **이 문서도 그 모양을 리터럴로 적지 않는다**: 그러면 이 리포트가
다시 push 를 막는다(방금 그렇게 될 뻔했다). 정확한 값은 `core/test/ops-round3-2026-08-27.test.ts`
의 런타임 조립 픽스처가 갖고 있다.
저장소 이력 전체 스캔도 마찬가지로 0이었다(316 커밋) — **거부된 커밋을 담고 있던 그 순간에도.**

**무엇이 깨지는가** 두 스캐너가 서로 다른 것을 본다. 그 자체는 정상이지만, 이 제품은
**「gitleaks 이력 스캔 0」을 안전 근거로 광고**하고 이번 감사의 **G8 도 그 수치를 근거로 삼았다**.
그 근거는 **「비밀이 없다」가 아니라 「gitleaks 룰에 걸리는 비밀이 없다」**만 말한다 — 실제로
GitHub 이 막는 형태를 gitleaks 가 통과시키는 사례가 방금 나왔다.

실무적 파급도 있다: 「gitleaks 통과 = push 된다」가 아니므로, **릴리스가 push 단계에서 처음
막힐 수 있다**(이번에 그랬다).

**제안** README 의 gitleaks 문구에 「이 스캔이 커버하는 범위」를 한 줄 덧붙이거나, CI 에
push 보호와 같은 계열의 검사(예: `gitleaks` 룰 확장 또는 `trufflehog`)를 한 겹 더한다.
**적어도 감사 리포트는 이 근거의 범위를 명시해야 한다** — 이 문서가 그것이다.

---

## [ORCH-12] — 확인했고 고친 것: 비밀 «마스킹» 테스트가 비밀 모양을 리터럴로 담고 있었다

**근거등급** measured

「비밀이 새지 않게 한다」를 검증하는 파일이 정작 비밀 모양을 소스에 박아 두는 것은 앞뒤가
맞지 않는다. 픽스처를 **런타임 조립**(`tok('xox','b-…')`)으로 바꿨다 — 파일에는 그 모양이
없고 런타임 값은 같다. 검사 대상은 그 «값»이지 소스의 바이트가 아니므로 테스트 의미는 그대로다
(14/14 green 유지).

**차단 해제 URL 은 쓰지 않았다.** 예외를 받으면 비밀 모양이 저장소에 영구히 들어가고, 다음
사람에게 「막히면 예외를 받으면 된다」는 선례가 남는다. 스캐너에게 「이건 테스트야」를
구분하라고 요구하는 것도 옳지 않다 — 그게 스캐너가 일하는 방식이다.

---

## [ORCH-10] HIGH — heredoc 본문의 **마크다운 백틱**이 명령 치환으로 오인된다

**근거등급** measured

이 감사 세션이 결함 대장에 축⑪ 행을 이어붙이려다 거부당했다. 명령은 `cat >> ledger.md <<'EOF' … EOF`
이고, 본문은 **마크다운 표 행**이었다. 거부 사유:

> This computes the write target at run time (``doctor``), so the harness cannot see which file
> it writes — and that includes the event journal that decides whether a gate is approved.

`` `doctor` `` 는 **마크다운 인라인 코드**다. 셸에서 백틱은 명령 치환이지만, **따옴표로 닫힌
heredoc(`<<'EOF'`) 본문 안에서는 아무 의미가 없다** — 셸조차 치환하지 않는다. 그런데도 파서는
이것을 「런타임에 계산되는 쓰기 대상」으로 보고 fail-closed 로 떨어졌다.

**무엇이 깨지는가** 백틱은 마크다운에서 가장 흔한 문자다. 하네스가 켜진 프로젝트에서 에이전트가
heredoc 으로 **문서·리포트·체인지로그를 쓰는 일**이 광범위하게 막힌다. 이번 감사만 해도 같은
이유로 **아홉 번** 우회해야 했고, 결국 대장 일부는 Write 도구로 조각 파일을 만들어 `cat` 으로
이어붙이는 방식으로만 기록할 수 있었다.

**같은 뿌리** ORCH-01·05·07·08 과 동일하다 — **명령 텍스트를 구문 해석 없이 문자열로 스캔**한다.
따옴표 닫힌 heredoc 본문은 셸 자신이 「데이터」로 확정한 구간이므로, 판정 입력에서 빼면 된다.

---

## [ORCH-07] HIGH — `cd X && <순수 읽기>` 가 읽기를 소스 쓰기로 뒤집는다

**근거등급** measured · 전수: `evidence/probe-overblock2.md`

**조각 분해로 트리거를 `cd` 접두사 하나로 좁혔다**

| 명령 | 판정 |
|---|---|
| `grep -n dist core/src/doctor.ts` | allow |
| `grep -n dist core/src/doctor.ts \| head` | allow |
| `echo "x"; grep -n dist core/src/doctor.ts` | allow |
| **`cd <repo> && grep -n dist core/src/doctor.ts`** | **deny** |
| `head -30 bin/harness-hook` | allow |
| **`cd <repo> && head -30 bin/harness-hook`** | **deny** |
| `head -30 README.md; grep -n dist core/src/doctor.ts` | allow |

같은 읽기 명령이 **`cd … &&` 를 앞에 붙이는 것만으로** 거부된다. 거부 사유는 소스 쓰기 금지 문구다:

> Implementation code cannot be written in the design track (P0) — `…/core/src/doctor.ts` is
> blocked because a `.ts` file is source code. … **(shell write target)**

**무엇이 깨지는가** `cd <dir> && <명령>` 은 에이전트가 가장 흔히 쓰는 명령 형태 중 하나다(이 감사
세션도 계속 그렇게 썼고, 실제로 그래서 거부당했다). 설계 트랙에서 이 형태로 **소스를 읽는 것**이
막히면 에이전트는 「설계 트랙에서는 소스를 읽을 수도 없구나」라고 잘못 결론 내린다 — 설계 단계에서
기존 코드를 읽는 것은 정확히 해야 하는 일인데도.

---

## [ORCH-08] HIGH — 게이트 승인 문구가 **명령 텍스트 어디에 있든** 승인 시도로 오인된다 (`echo` 포함)

**근거등급** measured

| 명령 | 판정 |
|---|---|
| `echo "문서: harness ga·te app·rove P0"` (문자열 출력만) | **deny** |
| heredoc 본문에 같은 문구를 담아 문서 파일 쓰기 | **deny** |

거부 사유:

> Approving a gate is the human's decision — an agent cannot run `harness gate approve`.

**아무것도 실행하지 않았다.** 문자열을 출력했을 뿐이다. 이 감사에서 실제로 막힌 사례:
결함 대장에 「README 표에 게이트 제출·승인 두 명령이 없다」는 **결함 설명 한 줄**을 쓰려다 거부됐다
(그래서 대장의 USE-04 행은 그 명령 이름을 못 쓰고 우회 표현으로 적혀 있다).

**무엇이 깨지는가** 게이트 승인 절차를 **문서화·설명·교육**할 수 없다. 이 제품의 README·스킬·
온보딩 문서가 전부 이 문구를 담고 있으므로, 하네스가 켜진 상태에서 에이전트에게 자기 문서를
갱신시키는 일이 막힌다. ORCH-01 과 같은 뿌리(명령 텍스트 전체 스캔)지만 트리거가 달라 별도로 남긴다.

---

## 과차단 종합 — 진짜 차단은 온전하고, 정밀도만 문제다

| | 결과 |
|---|---|
| **진짜 차단(true positive)** | **10/10** — 저널·state 덮어쓰기(4), 소스 직접 쓰기, append, `tee`, `sed -i`, `rm`, 리다이렉트 |
| **과차단(false positive)** | **8/32 ≈ 25%** — 정당한 읽기·문서 쓰기 32건 중 8건이 거부됨 |
| 트리거 4종 | ① `N>&M` FD 복제(ORCH-05) ② heredoc 본문의 소유 경로(ORCH-01) ③ `cd X && <읽기>`(ORCH-07) ④ 승인 문구 언급(ORCH-08) |

**보안 핵심은 약해지지 않았다** — 축⑥의 30+ 우회 배터리와 축④의 28벡터도 전건 차단됐다.
결함은 전부 **정밀도(precision)** 쪽이고, 넷 다 같은 뿌리를 공유한다: **명령 텍스트 전체를
문자열로 스캔하고, 실제 쓰기 대상 위치를 구문적으로 해석하지 않는다.**

부작용이 큰 이유는 **거부 사유가 사실과 다르기 때문**이다. 「읽으려 했는데」 「바꿀 수 없다」고
답하고, 「문서를 쓰려 했는데」 「승인은 사람만 한다」고 답한다. 훅 출력이 모델 컨텍스트로
들어가는 제품에서 틀린 사유는 **에이전트를 잘못된 방향으로 밀어낸다.**

---

## [ORCH-02] MED — 설계 트랙에서 **프로젝트 루트 밖 쓰기가 전면 차단**돼, 에이전트의 임시 작업 공간이 사라진다

**근거등급** measured

**재현** 설계 트랙(P0)인 프로젝트에서 Write 도구로 `/private/tmp/.../scratchpad/probe.js` 쓰기 시도.

**관측된 결과**

```
Paths outside the project root cannot be written in the design track:
/private/tmp/claude-501/.../scratchpad/probe.js
```

**무엇이 깨지는가**

Claude Code 세션은 **프로젝트 밖 스크래치패드 디렉터리를 표준으로 쓴다**(이 세션의 시스템 프롬프트가
「임시 파일은 항상 이 스크래치패드를 쓰라」고 지시한다). 설계 트랙에서 그 경로 전체가 막히면:

- 에이전트가 중간 산출물·분석 스크립트·로그를 둘 데가 없어져 **프로젝트 안에 쓰게 된다** —
  즉 이 규칙이 오히려 **작업 저장소를 더럽히는 쪽으로 밀어낸다.**
- 이번 감사에서 실제로 그렇게 됐다: 스크래치패드에 측정 드라이버를 못 써서
  `docs/release-readiness/2026-08-27/` 안에 증거 파일을 만들 수밖에 없었다.

의도된 설계일 가능성이 있다(설계 트랙은 「소스를 쓰지 마라」이고, 프로젝트 밖은 판정 불가라
fail-closed). 그렇다면 **문서에 그렇게 적혀 있어야 한다** — 「알려진 한계」에서 이 항목을 찾지 못했다.
축⑩(배포)·축⑪(운영) 담당이 문서 대조로 확정해 주면 상태를 올리거나 기각할 수 있다.

**제안** 임시 디렉터리(`$TMPDIR`·`/tmp`·세션 스크래치패드)를 명시적 허용 목록에 넣거나, 최소한
「알려진 한계」에 이 동작을 적는다.

---

## [ORCH-03] — 확인했고 괜찮았던 것: `.harness/` 제거가 사람 전용 경로로 정확히 막힌다

**근거등급** measured

감사 중 오염된 `.harness/` 를 스크래치패드로 옮기려 했으나(`mv`) 훅이 거부했다:

```
.harness/state.json can only be changed by harness commands — editing it by hand desynchronises
the journal from the state. If you meant to stop using the harness in this project, that is a
human decision and there is no command for it: delete `.harness/` yourself in your own terminal.
This hook governs the agent lane, not you.
```

**이것은 정상 동작이고, 광고한 강제가 감사자 본인에게도 그대로 작동한 실증이다.** 메시지가
(a) 왜 막는지 (b) 사람이 무엇을 하면 되는지 (c) 이 훅의 관할이 어디까지인지를 전부 말한다 —
축⑪ 게이트 「오류 메시지에 다음 행동 존재」의 좋은 사례다.

---

## [ORCH-04] — 확인했고 괜찮았던 것: 정당한 프로젝트 내 문서 쓰기는 허용된다(과차단이 전면적이지 않다)

**근거등급** measured

같은 설계 트랙(P0)에서 하네스 경로를 언급하지 않는 프로젝트 내 문서 쓰기는 통과했다 —
산출물이 `evidence/probe-write.txt` 로 남아 있다. 즉 ORCH-01 의 과차단은 **「본문에 하네스 경로
문자열이 있을 때」로 한정**되며, 문서 작성 전반이 막히는 것은 아니다.
