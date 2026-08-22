# [1] 효용성 감정 — 4.6/5
**점수** 4.6 · **4.8 충족** ✗ (조건 2개 전건 충족·잔여 MED 1건) · **감정 시각** 2026-08-22

> 감정자: 효용성 축 독립 감정. measured 만 점수 근거. 이 파일은 항목 종료마다 append.

## 조건별 실측

### 조건 1 — 문서·스킬·에이전트가 부르는 명령 MISSING 0 [measured]

**인벤토리 방법**: README×4 / skills/ / agents/ / profiles/ / docs/superpowers / hooks/ / .claude-plugin / mcp 에서
(a) 백틱 인라인 `harness …` (b) 코드펜스 내 `harness …` 행을 file:line 단위로 전수 추출.
prose 오탐("harness design track"="설계 트랙" 등)은 문맥 확인 후 제외.

**검증 방법**: 추출된 유니크 (group, sub) 68개 형태를 mktemp 샌드박스에서 전부 실제 실행,
stderr 의 `Unknown command/subcommand/flag` 패턴으로 판정 (이 CLI 는 unknown 을 명시적 에러로 뱉음을 사전 확인).

```
$ for p in ...68 forms...; do bin/harness $p; done | grep -i '^Unknown'
MISSING_COUNT=0 (out of 68 referenced forms)
```

**플래그 철자 검증** (unknown flag 는 이 CLI 에서 hard-fail 이므로 문서 오철자는 곧 사용자 차단):
- `wave create --accept`(README/SKILL 철자) → `wave-001` 발급 OK · `--acceptance`(help 철자) → OK (양쪽 alias 수용)
- `phase set P1 --force`(docs 참조) → 존재. `HARNESS_ALLOW_FORCE=1` 잠금 메시지 출력 (통제된 탈출구)
- `doc upsert --refs`(스킬 철자, doc --help 표기엔 없음) → 수용됨 (help 표기 불완전이나 동작함, LOW 후보)
- `gate submit --paths --evidence claimed` → 존재 (80자 최소 검사로 거부 — 게이트 앤티게이밍 동작 확인)
- `node upsert --status draft` → OK

**판정: MISSING 0 — 조건 1 충족.** (측정일 2026-08-22, HEAD 45bde0c)

### 조건 2 준비 — 3대 실패 모드 정의 (README 주장에서 도출)

README 가 막아 준다고 주장하는 개발 실패 3가지를 내 기준으로 확정:
- **FM1 설계 전 구현** — 설계 트랙(P0–P6)에서 소스 작성/배포성 Bash/하네스 소유 파일 손편집 → PreToolUse deny
- **FM2 미정산 세션 종료** — 실작업 후 턴로그 미갱신 채 세션 종료 → Stop block
- **FM3 근거 없는 산출** — (a) 그려진 적 없는 UX 를 완료 처리(증거 게이트), (b) 낡은 설계 위에 축적(STALE 전파)

### FM1 실측 — 설계 트랙 차단 매트릭스 [measured]

샌드박스 P0, profile generic(src/** lib/** app/**). `bin/harness hook pre-tool` 에 16케이스 주입. 결과:

| 케이스 | 기대 | 실측 |
|---|---|---|
| Write src/app.ts | deny | deny ("Implementation code cannot be written in the design track (P0)…profile generic, source_globs…") |
| Edit lib/util.py | deny | deny |
| Write src/foo.test.ts (소스 글롭 우선) | deny | deny |
| Write docs/design.md · README.md · 루트 foo.test.ts | 허용(무출력) | 무출력 ✓ |
| Edit/Write .harness/state.json · events.jsonl | deny | deny |
| Bash `sed -i state.json` · `echo >> events.jsonl` (Bash 우회) | deny | deny ("shell redirects, tee, sed -i follow the same rule") |
| Bash `vercel deploy` · `npm publish` | deny | deny |
| Bash `HARNESS_ALLOW_FORCE=1 harness phase set P7 --force` (에이전트 자기해제) | deny | deny ("the user must run it themselves") |
| Bash `ls -la` · `git commit` · `cat src/app.ts` (과차단 역방향) | 허용 | 무출력 ✓ |

16/16 기대 일치 · hook-errors.log 빈 파일 · 전부 exit 0. **FM1 E2E 실증됨.**
(주: deny JSON 은 하네스의 종단 출력이다 — 실제 차단 집행은 Claude Code 가 이 JSON 을 소비해 수행. permissionDecision:"deny" 스키마 형식 확인함)

### FM2 실측 — Stop 정산 가드 [measured]

시퀀스 전체를 한 샌드박스에서 E2E 로 구동 (전부 exit 0, stdout 관측):

| 단계 | 기대 | 실측 |
|---|---|---|
| stop (활성 웨이브 없음) | 침묵 | `[]` 빈 출력 ✓ |
| wave activate 후 stop (활동 없음) | 침묵 | 빈 출력 ✓ |
| post-tool(Write docs/design.md) 후 stop | block | `{"decision":"block","reason":"The turn log for active wave wave-001 has not been updated…"}` ✓ (탈출구 문구 포함) |
| `wave update "…"` 후 stop | 침묵 | 빈 출력 ✓ |
| post-tool(Bash `bin/harness status` = self) 후 stop | 침묵 (self Bash 는 비무장) | 빈 출력 ✓ |
| post-tool(Bash `ls -la` 읽기전용) 후 stop | 침묵 (사소 턴 비무장) | 빈 출력 ✓ |

**FM2 E2E 실증됨** — 무장 조건이 "실작업"에 정확히 반응하고 읽기전용/self 명령은 과차단하지 않음.

### FM3 실측 — 근거 없는 산출 차단 [measured]

**(a) UX 증거 게이트**: UX-1 노드 → wave-004(--refs UX-1) 활성 → complete:
- 증거 없음 → 거부 exit=1, "Put a screenshot in …/.harness/evidence/wave-004" · status 의 activeWave 그대로 (상태 변화 없음 확인)
- 0바이트 shot.png → 여전히 거부 exit=1 · `evidence check` = `ok:false, "0 bytes — an empty capture … silently passes it"`
- 유효 1×1 PNG(70바이트) → **complete 성공**, wave list 에서 status done 확인 (종단 상태 관측)

**(b) STALE 전파**: `node bump F-1` → `F-1 v2 — STALE waves: wave-001, wave-002` · wave list 에서 두 웨이브 status=stale 확인 (done 이던 wave-001 포함, UX-1 참조 wave-004 는 무변화 = 전파 범위 정확).
`wave activate wave-002` → **exit=1 거부**: "wave-002 is STALE — … Open a new wave against the current design instead" (E2E 소비자까지 확인).

**결함 발견 (아래 결함 목록 참조)**: complete 게이트는 자체 검사기 `evidence check` 가 "70 bytes (1x1) is too small — most likely a blank screen or a failed capture" 로 문제 판정하는 파일로 열린다 — 게이트(비어있지 않음)와 검사기(치수·헤더 검사)의 기준 불일치. 에이전트가 1×1 PNG 를 스스로 만들어 UX 게이트를 여는 자기해제 경로가 열려 있고, `.harness/evidence/` 쓰기는 훅이 막지 않음(실측: pre-tool 은 state.json/events.jsonl/config.yaml 급만 deny).

## 내가 추가로 만든 목록 (우리 목록 밖)

### ① 판정의 입력(정책·설정) 자체 [measured]
- **프로파일이 실제로 판정을 구동하는가**: config.yaml 을 `profile: nextjs-prisma` 로 바꾸자 `prisma/schema.prisma` Write 가 deny 되고 사유문에 "profile nextjs-prisma, source_globs: src/**, app/**, prisma/**" 가 반영됨 ✓
- **정책 드리프트 감시**: config.yaml 변경 후 `doctor` → "the policy files differ from the pinned baseline — pinned 242a25… ≠ current 478063…" 경고. 재핀은 `HARNESS_ACCEPT_POLICY=1 doctor --accept-policy` 이며 **에이전트의 pre-tool 호출로는 deny** ("accepting a change is the human's...") — 자기해제 봉쇄 실측 ✓
- **깨진 config.yaml**(YAML 파싱 불가) → 훅은 기본 프로파일로 **여전히 deny** (fail-open 아님, fail-safe). 단 파싱 실패 자체는 hook-errors.log 에도 doctor issues 에도 안 뜨고 드리프트 경고로만 간접 표면화 (LOW 후보)
- **state.json 파손** → session-start 가 "⚠ state.json is damaged — running from journal replay. Run `harness doctor --repair`." 주입 + 저널 리플레이로 계속 동작 · `doctor --repair` 후 상태가 파손 전과 **updatedAt 만 제외하고 동일** 복원, 재실행 doctor ok:true ✓ (E2E)

### ② 내 축 밖의 상태 [measured]
- 전체 실측(훅 40여 회 호출) 동안 각 샌드박스의 `.harness/.runtime/hook-errors.log` 는 계속 빈 파일 — 흡수된 내부 실패 0
- 리포 오염 없음: 모든 실측은 mktemp 샌드박스 · 리포 git status 청정 유지 (감정 종료 시 재확인)
- MCP 서버(stdio): initialize/tools-list 응답 ✓ — `harness_status`, `harness_gate_submit`(gate approve 는 도구 목록에 없음 = 인간 전용 설계 일관) 확인
- `bin/harness-hook`(플러그인이 부르는 셸 래퍼) 실행 가능·session-start JSON 정상 출력 ✓

### ③ 반대 방향 — 막지 말아야 할 것이 되는가 [measured]
- 설계 트랙: docs/·README·루트 테스트 파일 Write, `ls`/`git commit`/`cat src` Bash → 전부 무출력 허용 ✓
- 빌드 트랙(P7): `src/app.ts` Write 허용 ✓ (설계문서 Edit 는 deny — backtrack 안내)
- 십 트랙(P11): **P11 게이트 승인 후 `vercel deploy` 허용** ✓ (승인 전엔 deny) — 배포해야 할 때 배포가 됨
- Stop 가드: 읽기전용 Bash·self 명령·활동 없음 → 전부 비무장(침묵) ✓ — "사소한 턴은 건드리지 않는다" 실증
- 십 트랙에서 기존 소스 파일 Edit 는 결함 원장 없이도 허용됨 — deny 문구("this track only changes what the defect ledger lists")와 불일치 (LOW, 아래 결함)

### 효용성 본질 측정 — 안 쓸 때 대비 [measured]
- **골든 패스 E2E**: init → 설계문서 작성 → node upsert → gate submit P0 → (승인 전 phase set P1 = exit 1 거부) → gate approve → phase set P1 성공. 게이트가 순서를 실제로 강제 ✓
- **훅 레이턴시**: pre-tool 20회 — min 104 / p50 114 / **p95 126ms** / max 127 (README 주장 p95<150ms 충족; "measured 62ms" 는 내 기기에선 재현 안 됨 — 청구보다 느리지만 상한 안)
- **세션 주입 비용**: session-start additionalContext 944자 ≈ **236 토큰** (README "~240 tokens" 주장과 일치) · .harness 없는 프로젝트에선 4개 훅 전부 무출력(하단 비간섭 실측)
- **거부 메시지의 행동 가능성**: 실측한 모든 deny/block/refuse 가 "다음에 할 명령"을 문장 안에 포함 (backtrack, wave update, gate submit→approve, evidence 경로, 새 wave create) — 에이전트가 스스로 복구 가능한 품질

### 추가 실측 — 자기해제 경로 봉쇄 확인 [measured]
| 에이전트 시도 (pre-tool 주입) | 실측 |
|---|---|
| Bash `bin/harness gate approve P1` | **deny** ("Approving a gate is the human's decision") |
| Bash `HARNESS_ACCEPT_POLICY=1 doctor --accept-policy` | **deny** ("accepting a change is the human's…") |
| Bash `HARNESS_ALLOW_FORCE=1 phase set P7 --force` | **deny** ("the user must run it themselves") |
| Write `.harness/config.yaml` | **deny** (".harness/config.yaml decides what this hook blocks") |
| Write `.harness/waves/wave-003.md` | 허용 — 그러나 웨이브 md 손편집으로 Stop 가드가 **풀리지 않음** (저널 기준 정산; 손편집 후 stop = 여전히 block, `wave update` 후에만 침묵) [E2E] |
| Write `.harness/evidence/<wave>/fake.png` | **허용** — 증거 게이트의 유일한 에이전트 개방 표면 (아래 결함 D1) |

MCP 도구 목록에 `harness_gate_submit` 은 있고 gate approve 는 **없음** — 인간 전용 설계가 MCP 표면까지 일관 [measured].

### 완료 게이트의 증거 판정 정밀 측정 [measured]
- 증거 없음 → 거부 exit 1 · 0바이트 png → 거부 · **PNG 헤더 불량(garbage .png) → 거부** ("cannot read the PNG header — it may be a corrupt file that is only named .png")
- **유효 1×1 PNG(70B) → 통과** — 같은 제품의 `evidence check` 는 이 파일을 "70 bytes (1x1) is too small — most likely a blank screen or a failed capture" 로 problems 에 올리면서도 종합 ok:true

### 문서 정확성 교차 검증 [measured]
- `npm test` → **Tests 1031 passed (1031), 39 files** — README "1031 passing (39 files)" 정확 일치
- 비간섭: `.harness/` 없는 디렉토리에서 4개 훅 전부 빈 출력·exit 0 — README "silence" 주장 일치
- `~240 tokens` 주입 주장 → 944자 ≈ 236토큰 일치 · p95<150ms 주장 → 실측 p95 126ms 충족 (단 "measured 62 ms" 는 내 기기 p50 114ms 로 재현 안 됨)
- `migrate` → 실제 내 환경의 legacy 훅 4개를 지목하며 행동 지침 출력 ("advice only; the harness never touches your ~/.claude/") — 동작 확인
- `ship verdict` → P10 미승인 상태에서 **NO-GO** + 정확한 다음 명령 안내
- rendered views(`trace`/`report rtm`/`report hub`/`loop next`/`usage tier`) 전부 정상 렌더 [measured]

## 발견한 결함

**D1 · MED · UX 증거 게이트가 '그린 적 없는' 1×1 PNG 로 열림 (에이전트 자기해제 표면)**
- 위치: wave complete 의 증거 판정 (core) vs `evidence check` 의 치수 경고 로직
- 재현: `.harness/evidence/<wave>/shot.png` 에 유효 1×1 PNG(70B) 저장 → `bin/harness wave complete` → "Wave completed" / 같은 파일에 `bin/harness evidence check <wave>` → problems: "70 bytes (1x1) is too small — most likely a blank screen or a failed capture" (ok 는 true)
- 사전 조건: `.harness/evidence/` Write 는 pre-tool 훅이 deny 하지 않음(실측) → 에이전트가 스스로 유효 PNG 를 만들어 게이트 통과 가능
- 사용자 피해: "You can't ship a UX feature that was never actually drawn"(README) 이 위협 모델(에이전트 자기해제) 안에서 깨짐. 0바이트·비PNG 는 막지만 최소 치수 바닥이 게이트에 연결 안 됨 — 검출 로직은 이미 제품 안에 있음(치수 파싱·경고 문구까지)에도 완료 판정이 그것을 소비하지 않음. FAQ 의 "accident-prevention layer, not a security boundary" 고지로 심각도 한 단계 감경해 MED.

**D2 · LOW · 십 트랙 deny 문구가 실동작을 과대 서술**
- 재현: P11 에서 신규 `src/app.ts` Write → deny "this track only changes what the defect ledger lists" / 그러나 **기존** `src/app.ts` Edit 는 결함 원장이 비어 있어도 무출력 허용(실측)
- 피해: 사용자·에이전트가 문구를 믿고 결함 등록부터 하게 됨(과잉 절차) 또는 원장 스코프 강제가 있다고 오신뢰. 실제 강제는 "신규 파일 생성 금지"뿐.

**D3 · LOW · `doc --help` 에 `--refs` 미표기 (스킬은 사용, CLI 는 수용)**
- 재현: `bin/harness doc --help` 의 upsert 표기는 `--id --path --phase` 뿐 · `skills/phase-p10-harden/SKILL.md:73` 등은 `doc upsert … --refs F-12,UX-7` 사용 · 실행 시 정상 수용(실측)
- 피해: help 만 본 사용자는 refs 연결(RTM 추적성)을 누락하게 됨.

**D4 · LOW · 깨진 config.yaml 이 무음으로 기본 프로파일 폴백**
- 재현: config.yaml 에 비YAML 텍스트 저장 → pre-tool 은 기본 글롭으로 deny(fail-safe 자체는 좋음) · hook-errors.log 빈 파일 · `doctor` issues 빈 배열 (정책 드리프트 해시 경고로만 간접 표면화)
- 피해: nextjs-prisma 같은 커스텀 프로파일이 조용히 무효화되어 `prisma/**` 등 프로파일 고유 경로 강제가 사라져도 직접 경고가 없음.

**노트 (결함 아님)**: README 성능표 "measured 62 ms" 는 본 기기(M-시리즈, 부하 중)에서 p50 114ms 로 재현 안 됨 — 같은 표의 p95<150ms 한계는 충족(실측 p95 126ms).

## 반대 방향 / 과차단 측정
위 ③ 절에 통합 실측: 설계 트랙에서 문서·테스트 파일·읽기성 Bash 허용 16/16 기대 일치 · 빌드 트랙 소스 허용 · **승인된 P11 게이트 후 deploy 허용** · Stop 가드는 읽기전용/self/무활동 턴에 침묵 · `.harness/` 없는 프로젝트 4훅 완전 침묵. **과차단 0건 발견.**

## 못 잰 것 (정직 고지)
- 훅 deny JSON 을 **실제 Claude Code 런타임이 소비해 도구 호출을 물리적으로 중단하는 단계** — 나는 훅 프로토콜의 종단 출력(JSON 스키마·permissionDecision)까지 실측했고, 그 뒤는 Claude Code 플랫폼의 계약이다.
- P0→P6 **전체 7게이트 연쇄**(각 80자 신규 콘텐츠 + doc/artifact URL 요건 포함) — P0→P1 전이·P11 게이트만 완주. 중간 게이트들(P2~P6)의 승인 연쇄는 동일 메커니즘 반복이라 표본 측정.
- `design sync`/`tokens gen·lint·swap`/`gate feedback` 의 내용 정합(디자인 서브시스템 심층) — 존재·기동만 확인, 산출물 품질은 다른 축 영역으로 판단.
- README 성능표의 "journal-replay fallback 102ms@100k entries" — 100k 저널 합성은 시간 관계상 생략.
- 다국어 README 3종(ja/zh/ko)의 **번역 내용 정확도** — 명령 참조는 전수 검증(전부 존재), 산문 번역 품질은 미측정.

## 점수 산출 근거
- **조건 1 (MISSING 0)**: 충족 — 참조 명령 68형태 전수 실행, Unknown 0. 플래그 철자 단위까지 확인.
- **조건 2 (3대 실패 모드 E2E)**: 충족 — FM1 16/16 매트릭스(허용/차단 양방향), FM2 6단계 시퀀스(무장·정산·비무장), FM3 증거 게이트(부재·빈파일·손상 거부→유효 파일 완료, 종단 상태 관측)와 STALE 전파(bump→전파 범위 정확→활성화 거부 exit 1).
- **잔여 감점**: D1 MED 1건 (위협 모델 내 자기해제 표면 — 완화·고지 있으나 게이트가 자체 검출 로직을 소비 안 함) + LOW 3건.
- 4.8 정의(「조건 전건 충족 + 잔여 감점 LOW 이하」)에서 **MED 1건이 남아 4.8 미달**. 다만 조건 두 개는 모두 실측으로 충족되고, 효용성 본질(안 쓸 때 대비: 게이트 순서 강제·자기해제 봉쇄 6경로·행동 가능한 거부문·비간섭·손상 자가복구)이 광범위하게 실증되어 상단 근접.

# 최종
**점수 4.6/5 · 4.8 충족 ✗ (MED 1건 잔여) · 감정 시각 2026-08-22 18:30 KST · HEAD 45bde0c**
