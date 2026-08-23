# [1] 효용성 감정 — 4.4/5

**점수** 4.4 · **4.8 충족** ✗ (rubric 조건 (a) 「문서가 부르는 명령 MISSING 0」 미충족 — README 4개 언어판이 광고하는 MCP 도구 2종 부재 · 잔여 감점에 MEDIUM 1건 존재) · **감정 시각** 2026-08-23 (측정은 2026-08-22 15:09~15:30 UTC) · **대상** HEAD `3aec164f87fb3b18e8b97722ac002c3dd9d6cf02`, `feature/core-engine-v0`, `git status --porcelain` **clean** (감정 중 `a1b5560` 커밋이 올라왔으나 diff 는 progress.md 62줄뿐 — 제품 표면 무변경, 본 실측은 두 HEAD 에 동일 유효)
**한 줄**: 광고한 수명주기(P0→P12·게이트·웨이브·증거·복구)를 샌드박스 E2E 로 실제로 완주시키고 막을 것을 막고 통과할 것을 통과시키는, 실질 효용이 높은 제품이나 — 「승인된 설계 위에서만 빌드된다」는 중심 보증에 자연 명령만으로 뚫리는 무감지 우회로 1개와, README 가 광고하는 MCP 도구 2종의 부재가 4.8 을 막는다.

측정 환경: Apple M4 · macOS(darwin 25.5.0) · node v22.22.2 · 샌드박스 `mktemp -d`(/tmp/hxsb.Kzb2pP) · 커밋된 `core/dist` 사용(빌드 안 함) · 모든 하네스 호출에 `cd <샌드박스>` + `CLAUDE_PROJECT_DIR=<샌드박스>` 지정 · 리포 무수정.

---

## 조건별 실측 (rubric: 효용성 4.8 = MISSING 0 + 3대 실패 모드 E2E 실증)

### 조건 (a) 문서·스킬·에이전트가 부르는 명령 MISSING 0 — **미충족 (MISSING 2, MCP 표면)**

내 목록(아래 절)의 전수 추출·실행 결과:

| 표면 | 추출 출처 | 실행 결과 |
|---|---|---|
| CLI 명령군 20개 (init·status·doctor·phase·gate·wave·node·trace·report·doc·adr·design·tokens·evidence·loop·ship·profile·usage·backtrack·migrate) | `harness --help` ↔ README·스킬 교차 | **20/20 `--help` exit 0**, 전부 실동작 (measured) |
| 문서가 부르는 하위명령 47종 (gate submit/approve/verify/sweep/status/feedback · wave create/activate/update/complete/list · node upsert/bump · doc upsert/url/submit/approve/revise/list · adr propose/decide/revise/show/list · design link/sync/baseline/html/inventory/list · tokens gen/lint/swap · evidence check · loop next/brief/attempt · ship defect add/list/update, deploy, verdict, checklist · report rtm/hub/packet · usage tier/status · backtrack/clear · migrate · hook 4종) | README 4개 언어판 + skills 11 + agents 5 + profiles 백틱/펜스 명령 전수 추출 | **전부 존재·실동작, 스텁 0** (measured). 실패 사례는 전부 내 플래그 오기였고 파서가 did-you-mean 으로 교정해 줌 |
| MCP 도구 | README §MCP (4개 언어판 동일 목록) ↔ `tools/list` 실측 16종 | **`harness_gate_verify`·`harness_doc_upsert` 부재** — README.md:197, README.ko.md:196, README.ja.md:197, README.zh.md:196 이 광고. **MISSING 2** |
| 스킬 참조 | p10 스킬·readiness-auditor 가 부르는 `verifying-production-readiness` 스킬 | 번들에 없음 — 단 README 「Known limits」가 스스로 고지 (disclosed, LOW) |

### 조건 (b) 3대 실패 모드 대응 E2E 실증 — **충족 (3/3 + 추가 4종, 전부 양방향)**

내가 정의한 3대 실패 모드(제품이 내건 핵심 약속에서 도출):

1. **설계 중 구현 착수** — P0 에서 `Write src/app.ts` → **deny** (프로파일 source_globs 명시, 대안 안내 포함). P6 승인·P7 진입 후 같은 호출 → **allow**. (measured, 양방향)
2. **미정산 세션 종료** — 활성 웨이브 + post-tool 활동 후 stop → **block** (`wave update` 정확 명령 + 사소턴 탈출구 안내). `wave update` 후 stop → **allow**. 활성 웨이브 없으면 guard 비무장(침묵). 탈출구: 1차 block 후 `stop_hook_active:true` 재시도 → **통과** — 정확히 1회 막고 무한루프 없음. (measured, 양방향)
3. **하네스 소유 파일 변조** — `Write .harness/events.jsonl` deny · Bash `>>` 리다이렉트 deny(같은 처방 문구) · `Edit .harness/config.yaml` deny(자기무장해제 사유 명시) — **어느 페이즈에서든**. (measured; 우회경로 전수는 축 2 소관)

추가 실증 (전부 measured):
- **UX 증거 게이트**: UX-노드 참조 웨이브 `wave complete` → 증거 없으면 거부. **가짜 PNG(헤더 불량)를 내용 검사로 거부**, 유효 800×600 PNG 만 usable 로 통과 → complete 성공. 양방향 완주.
- **STALE 전파**: `node bump C-1` → 참조 웨이브 2건 즉시 stale · `design sync`(승인 노드, 캔버스 변경) → v2 + **done 웨이브까지 stale 전파**. stale 웨이브 재활성화는 **거부**(새 웨이브 유도) — STALE 이 장식이 아님.
- **저널 재생 복구**: state.json 파손 → CLI 는 정확한 처방(`doctor --repair`)과 함께 exit 1, **훅 강제는 열화 중에도 동일 판정 유지**(deny 문구에 `[state damaged — run harness doctor --repair]` 가시 태그) → `doctor --repair` 로 P12 상태 완전 복원. 100,091줄/16.8MB 저널에서도 복구 성공.
- **게이트 시퀀스 강제**: 게이트 미승인 시 `phase set` 전진 거부(빠진 게이트 전부 이름으로 나열) · **invalidated 게이트가 있으면 전진 차단** · 80자 신규 문자 미만 제출 거부(「gate is a review, not a ceremony」) · **agent 형상(no-TTY) `gate approve` 거부** + 진짜 no-TTY 인간용 `HARNESS_APPROVE_NO_TTY=1` 탈출구 안내 · MCP `harness_gate_approve` 호출 → **거부 + 게이트 상태 불변**(submitted 유지, 실측 대조).

### 비간섭 (rubric 5축 소관이나 효용의 전제라 실측)

`.harness/` 없는 프로젝트에서 4 이벤트 × {정상 JSON, 빈 stdin, 깨진 JSON} = **12/12 exit 0 · stdout 0바이트 · stderr 0바이트 · 부작용 파일 0** (measured).

---

## 내가 만든 목록 / 내가 설계한 검사

대장·요약·이전 감정 보고는 읽지 않고(대장은 감정 대상으로만 취급, 실제로 열지 않음), 다음을 스스로 정해 쟀다:

1. **명령 전수 인벤토리**: README 4개 언어판 + skills 11개 + agents 5개 + profiles 에서 `harness …` 호출을 grep 전수 추출(백틱 88종 + 펜스 블록) → 산문 오탐(「the harness design track」 등) 제거 → 전 명령군·하위명령 실행. MCP 는 stdio JSON-RPC `initialize`→`tools/list`→`tools/call` 로 직접 대조.
2. **전 수명주기 완주 시나리오**: 한 샌드박스에서 P0 개념→P6 감사→P7 빌드→P10~P12 출하까지 게이트 13개를 문서화된 명령만으로 완주. 각 전이마다 막힘/뚫림을 기록. **deploy-류 Bash 가 P10 게이트 pending 때 deny, P11 gate pending 때 deny, P11 승인 직후 allow 로 열리는 것까지 실측** — 「배포 명령은 출하 트랙에서 열린다」는 광고가 참.
3. **양방향 원칙**: 모든 차단 검사에 통과 검사를 짝으로 설계(아래 과차단 절).
4. **열화 내구성**: 파손 상태에서 강제·판정·복구가 유지되는지(위 실증).
5. **회피 시나리오 능동 설계**: 「막힌 에이전트가 다음으로 시도할 자연스러운 수」를 직접 시도 — 그 중 1개가 뚫렸다(결함 1).
6. **메시지 행동가능성**: 수집한 거부/오류 메시지 25종 전수에서 「다음 수」가 명시되는지 판정 — **25/25 가 정확한 다음 명령 또는 대안을 문구에 포함** (예: deny 마다 `harness status`/`backtrack`/`ship defect add` 등 구체 처방, 오타 플래그에 did-you-mean, 빈 doc URL 에 발행→등록 순서 안내). 이 축의 뚜렷한 강점.
7. **광고 수치 대조**: 세션 주입 ~240 tokens 광고 → 실측 944 chars ≈ **236 tokens** (chars/4 추정) — 일치. `migrate` 는 감정자 머신의 실제 레거시 훅(handoff-guard 등 4건)을 탐지 — 스텁 아님. `lang: ko`/`HARNESS_LANG=ko` → 실제 한국어 출력(「페이즈 → P12」).

---

## 반대 방향 (과차단) 측정

차단당 통과 짝 + 실사용 시나리오 11종, **과차단 0** (measured):

| 호출 (설계 트랙 P0~P6) | 판정 | 비고 |
|---|---|---|
| `Write docs/design.md` · `Write .harness/design/*.md` | allow | 설계 산출물 쓰기 |
| Bash `echo note >> docs/notes.md` | allow | 리다이렉트라도 허용 접두면 통과 |
| Bash `git status` · `git commit -m "notes: npm publish steps"` | allow | **커밋 메시지 안 "npm publish" 문자열에 오탐 없음** |
| Bash `echo "how to npm publish later"` | allow | 따옴표 안 문자열 오탐 없음 — 광고(「substring match」)보다 실제가 더 정교 |
| Bash `npm test` · `npx vitest run` · `npm run build` | allow | 검증·빌드는 설계 중에도 허용 |
| Bash `mkdir -p src` | allow | 디렉토리 생성만으로 안 막음 |
| 활동 없는 turn 의 stop | 침묵 allow | guard 는 활성 웨이브+활동 시에만 무장 |
| stop 1차 block 후 재시도(stop_hook_active) | allow | 탈출구 실동작, 세션 인질 없음 |
| P7 에서 `Write src/app.ts` | allow | 빌드 트랙 개방 |
| P11 게이트 승인 후 `npm publish` | allow | 출하 개방 |
| backtrack 후 clear | 원상복귀 | 마커 잔류로 인한 지속 차단 없음 |

비간섭 프로젝트의 상시 비용: `bin/harness-hook` 은 `.harness` 부재 시 sh 단계에서 즉시 exit 0 (node 미기동) — 12/12 침묵 실측과 일치.

---

## G9 재정의 검증 (★ 필수 항목)

**결론: 재정의의 사유는 실측으로 재현·지지된다. 그러나 새 문턱은 「적용 표면」을 못 박지 않아, 자신이 고치겠다던 표면 모호성을 문턱 경계에서 재생산한다 — 조건부 타당.**

### 직접 실측 (측정 표면 명시)

- **표면 W (프로세스 wall-time)**: python `subprocess.run` spawn→exit, `bin/harness-hook pre-tool` + stdin JSON, 샌드박스 루트. n=30/조건.
- **표면 I (인프로세스)**: node 내부 `hrtime`, `require(core/dist/cli.js)`+`main(['hook','pre-tool'])`→exit 까지. **require 포함**(구현자 표면 B 는 `handleHook` 직접 호출로 require 제외 — 단 델타 비교에서는 양쪽 모두 상쇄되므로 비교 가능). n=20/조건.
- 머신: Apple M4, node v22.22.2. `node -e ''` p50 = **37.5ms**.
- 열화 = state.json 삭제(훅이 재생성하지 않음을 확인 — 반복 측정 유효). 정상→열화→정상 재확인 순서로 드리프트 통제.

| 저널 | 표면 W 추가비용 (p50/p95) | 표면 I 추가비용 (p50/p95) |
|---|---|---|
| 100k줄 · 8.5MB (경량 턴로그) | +29.2 / **+14.7ms** | +28.6 / **+34.1ms** |
| 100k줄 · 16.8MB (168B/줄) | +43.4 / **+38.0ms** | +44.3 / **+61.9ms** |
| (게이트 스펙 100k줄·15MB ≈ 157B/줄, 보간) | ≈ +40 / ≈ +33ms | ≈ +40 / ≈ **+55ms** |

### 판정

1. **「wall 절대 문턱은 머신을 잰다」는 사유 — 타당, 재현됨.** 구현자 머신은 node 기동 99ms·열화 p95 162ms 로 구 문턱(150ms) 미충족이었는데, 내 M4 는 같은 코드·같은 급 저널에서 열화 p95 **108.9ms 로 구 문턱을 통과**한다. 코드 무변경으로 머신에 따라 게이트 판정이 뒤집힘 — 구 문턱이 제품이 아니라 CPU 를 쟀다는 주장의 직접 실증.
2. **「제품이 통제하는 몫에 문턱」 — 방향 타당.** 폴백 추가비용은 저널 크기에 비례하고 제품 설계(무압축 저널, 재생 폴백)의 결과다. 이걸 재는 것이 제품을 재는 것 맞다.
3. **그러나 새 문턱 「<50ms」는 표면 미지정.** 게이트가 「두 표면 모두 계측」을 명하면서 50ms 가 어느 표면의 p95 인지 안 적었다. 내 실측에서 스펙 저널(≈15MB)일 때 **표면 W 는 ≈+33ms 통과, 표면 I 는 ≈+55ms 미충족** — 표면 선택으로 통과·불통과가 갈리는 원래 병이 문턱 경계에서 재발한다. (구현자 실측 +29/+16.3ms 는 양쪽 다 통과였기에 이 모호성이 드러나지 않았다. 내 표면 I 는 require 포함·n=20·분산 큼이라는 한계가 있으나, p50 기준으로도 W/I 가 43/44ms 로 문턱의 88%에 닿는다 — 여유가 크지 않다.)
4. **효용성 관점 — 사용자는 wall 을 겪는다는 반론**: 부분 수용. 사용자가 겪는 것은 도구호출당 wall(내 머신 정상 63ms, 구현자 머신 127ms, pre+post 2회) 이 맞다. 그러나 그중 node 기동은 Claude Code 훅 일반의 비용이고, 이 제품이 통제 가능한 몫은 폴백 추가비용 + 번들 require 다. gates.md 가 「절대 wall 도 함께 기록하되 문턱으로 안 쓴다」로 사용자 체감치를 기록에 남기게 강제했고 README Measured 표가 실제로 wall 133/162ms 를 고지한다 — 체감의 은폐는 없다. **통과시키기 위한 재정의로 보이지 않는다**(구 문턱은 오히려 내 머신에서 통과였다). 단, §3 의 표면 미지정을 고치지 않으면 다음 감정자 쌍에서 103.5 vs 202.5 사태가 「+38 vs +62」로 되풀이될 것이다.

---

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

### D1 [MEDIUM] 승인된 설계의 무감지 개정 — `phase set` 후진에 backtrack·해시 재검증이 없다
- **주장과의 어긋남**: README 「nothing silently builds on an outdated decision」·훅 거부문 「that is what keeps implementation and design from silently diverging」— 이 경로에서 둘 다 거짓 (measured).
- **재현** (전 단계 measured):
  1. P7(빌드)에서 `harness phase set P3` → **backtrack 마커 없이 성공** (경고·기록 요구 없음)
  2. 설계 트랙이므로 승인된 `.harness/design/03-*.md` 를 에이전트 Write 로 **수정 허용**
  3. `harness phase set P7` → **해시 재검증 없이 복귀 성공**, P3 게이트 status **approved 유지**(pinned hash 는 이미 불일치)
  4. `doctor` ok:true · session-start 무경고 · `ship verdict` 사유 목록에도 부재 — **어느 상시 표면도 탐지하지 않음**. `gate verify P3`/`gate sweep` 을 손으로 불러야만 잡힘.
- **anchor**: `core/src/gate.ts:878-905` `canEnterPhase` — 앞 게이트 status 만 검사, (i) 후진 시 backtrack 마커 불요구 (ii) 재진입 시 pinned artifactHash 재검증 없음. `harness backtrack` 은 순수 장부(마커) — 강제 효과 없음 (`gate.ts:1263` 부근).
- **완화 실재**: 수동 `gate verify/sweep` 는 정확히 탐지·invalidate 하고, invalidated 게이트는 전진을 막는다(실측). P6·P12 스킬이 sweep 실행을 지시한다(`skills/phase-p12-ship/SKILL.md:70`, `skills/phase-p6-audit/SKILL.md:73`). **그러나 그 완화는 전부 advisory 레인이고, 「모델은 지시를 합리화로 회피한다」는 이 제품 자신의 전제 위에서는 방어로 셀 수 없다.** P6 sweep 은 내 시나리오(변조가 P6 이후)를 시간상 못 잡고, P12 sweep 은 스킬을 따르는 에이전트만 잡는다.
- **severity 산정**: 에이전트의 자연 명령 2개(phase set·Write)만으로 중심 보증이 무음으로 뚫리므로 LOW 아님; 단 훅 거부문이 명시 유도하는 정상 경로(backtrack)는 온전하고, 변조는 저지르는 즉시 해시 불일치로 **탐지 가능 상태**가 되며(잡는 명령 실재), 사람 승인 클릭 자체는 위조 못 함 → HIGH 아님.
- **처방 방향**(참고): `canEnterPhase` 가 설계→빌드 방향 전이 시 approved 게이트의 pinned hash 를 재검증(사실상 sweep 내장)하거나, 후진 `phase set` 에 backtrack 마커를 요구.

### D2 [LOW~MEDIUM] README 4개 언어판이 광고하는 MCP 도구 2종 부재 — `harness_gate_verify` · `harness_doc_upsert`
- **재현**: MCP stdio `tools/list` → 16종 실측. 두 이름 부재. README.md:197 · README.ko.md:196 · README.ja.md:197 · README.zh.md:196 이 명시 광고.
- 축 조건 (a) 의 MISSING 2. CLI 동등물(`gate verify`, `doc upsert`)은 실재하므로 기능 상실은 아니나, 「README 가 광고하는 기능이 전부 실재」 계열의 광고-구현 불일치이며 MCP-only 클라이언트에는 실결손.
- 참고: `harness_gate_approve` 는 tools/list 에 **존재**하되 호출 시 사유 설명과 함께 거부 + 게이트 불변(실측) — 「approve 는 MCP 로 불가」 약속과 행동은 일치하나, 도구 목록만 본 독자에게는 README(「cannot approve a gate」)와 어긋나 보이는 표면. 문서 한 줄 보정 권장.

### D3 [LOW] G9 재정의 문턱의 적용 표면 미지정 (게이트 정의 결함)
- `docs/release-readiness/2026-08-21/gates.md` G9 행 — 「더하는 p95 비용 < 50ms」가 W/I 어느 표면의 p95 인지 없음. 위 G9 절 실측: 스펙 저널에서 표면에 따라 +33ms(통과)/+55ms(미충족)로 갈림. 문턱에 표면 한 줄(예: 「프로세스 wall-time 기준」)을 박아야 재현 가능한 게이트가 된다.

### D4 [LOW · disclosed] `verifying-production-readiness` 스킬 참조 미번들
- `skills/phase-p10-harden/SKILL.md` · `agents/readiness-auditor.md` 가 호출, 번들 부재. README Known limits 스스로 고지 — 고지된 한계로 감점 최소.

---

## 못 잰 것 (정직 고지)

- **결함 대장·00-summary 의 「닫힘」 주장 자체의 재검증** — 대장을 읽지 않는 방식으로 독립성을 지켰으므로, 대장 기재 항목과 내 발견의 대조(중복/신규 여부)는 하지 않았다.
- **npm run build·바이트 재현·테스트 스위트(1193 passing 광고)** — G1/G3 소관 + 빌드 금지 규칙. 커밋된 dist 로만 실측.
- **Bash 우회 경로 전수**(heredoc·tee·sed -i·cp/mv·스크립트 3단 해석·`--force` 도달성) — 축 2 소관. 나는 리다이렉트 1종·sed -i 1종만 표본 실측(둘 다 deny).
- **nextjs-prisma 프로파일** — 미실측(generic 만). 프로파일 교체 시 source_globs·deploy_commands 반영 여부 안 봄.
- **tokens 파이프라인의 정상 경로**(유효 design-tokens.json 으로 gen/lint/swap) — 오류 경로(파일 부재 시 처방 메시지)만 실측. `design html`·`design inventory` 출력 품질 미판정.
- **hook-errors.log 관측 가능 fail-open** — 훅 내부 예외를 인위 유발하지 않음(G12 소관).
- **README 의 2-에이전트 A/B 실험 주장**(「Without → 미완주, With → 완주」) — 재현하지 않음. 이 주장은 이 감정에서 미검증으로 남는다.
- **동시성**(두 세션 동일 프로젝트) · **플러그인 설치 경로**(`claude plugin install` 실제 설치·hooks.json 배선) — 샌드박스에서 훅 바이너리 직접 구동으로 대체. `${CLAUDE_PLUGIN_ROOT}` 치환 실배선은 미실측(G13 소관).
- **ship verdict 가 다른 차단 사유 해소 후 게이트 해시 재검증을 포함하는지** — 현 상태(다른 NO-GO 사유 존재)에서만 부재를 관측. 사유 전부 해소된 상태의 verdict 는 미실측 — D1 의 「ship 단계 최후 방어망 부재」 단정은 이 한도 안에서만 유효.
- **G9 표면 I 의 분산 원인**(GC·require 상호작용) — n=20, p95 신뢰구간 넓음. p50 은 안정적(양 표면 일치)이므로 결론은 p50 중심으로도 성립하나, I-표면 p95 수치 자체는 ±10ms 급 불확실성을 인정한다.

---

## 점수 산출 근거

- **기본기 — 광고한 효용의 실재성이 매우 높다**: 20 명령군·47 하위명령 전수 실동작(스텁 0), 3대 실패 모드 + 4종 추가 실증 전부 양방향 통과, 과차단 0/11, 비간섭 12/12, 거부 메시지 25/25 행동 가능, 열화 중 강제 유지 + 가시 태그 + 완전 복구, 배포 명령이 정확히 P11 승인 순간에 열림, ko/en 이중 출력, 세션 주입 236≈240 tokens 광고 일치. 「이 도구가 없을 때와 비교해」— 설계-먼저·정산-먼저·증거-먼저를 return value 로 강제한다는 중심 효용은 **실측으로 성립**한다.
- **4.8 조건 대조**: (a) MISSING 0 → **위반 2건**(D2, MCP 표면) — 조건 하나 미충족이므로 rubric 규정상 4.8 미만 확정. (b) 3대 실패 모드 E2E → 충족.
- **잔여 감점**: D1 은 MEDIUM(중심 보증의 무감지 우회로, 단 완화 실재·탐지 가능 상태 유지로 HIGH 아님) — 「잔여 감점 LOW 이하」 요건도 위반. D3·D4 는 LOW.
- **산출**: 조건 위반 2계열(a·잔여 MEDIUM)로 4.8 불가. 실측된 효용의 폭·양방향 건전성·메시지 품질은 4.5 안팎을 지지하나, D1 이 「없을 때 대비 무엇을 막아 주는가」라는 이 축의 핵심 질문에 난 구멍이므로 0.1 을 추가로 깎아 **4.4**. (D1 수리 + README MCP 2종 정정 시 4.7~4.8 재감정 여지.)
