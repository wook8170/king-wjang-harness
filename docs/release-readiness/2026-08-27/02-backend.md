# 02. 백엔드·API — CLI 계약 · 훅 계약 · MCP 계약 · 파일 포맷 계약

**감사 모델**: claude-opus-5 · **위임 도구**: 직접 수행(서브에이전트 미사용) · **감사일** 2026-08-27
**대상 커밋** `bacb4bc`

## 방법 — 실제로 무엇을 했나

워킹트리는 읽기 전용으로 취급했다. 모든 실험은
`…/scratchpad/ax02/` 안에서 했고, 저장소 바이너리(`bin/harness`·`bin/harness-hook`·`mcp/server.js`)를
**`CLAUDE_PROJECT_DIR` 를 샌드박스 프로젝트로 지정해** 그대로 구동했다.

읽은 파일: `core/src/cli.ts` · `core/src/help.ts` · `core/src/hook.ts`(발췌) · `core/src/bashwrite.ts`(발췌)
· `core/src/config.ts` · `core/src/state.ts` · `core/src/events.ts` · `core/src/profile.ts`(발췌)
· `core/src/mcp.ts`(발췌) · `core/src/doctor.ts`(발췌) · `mcp/server.js` · `hooks/hooks.json`
· `bin/harness` · `bin/harness-hook` · `profiles/generic/profile.yaml` · `core/test/profile.test.ts`(발췌).

돌린 것:

1. **dist 재현성** — 저장소를 샌드박스에 복사해 `npx tsup` 로 재빌드하고 커밋된 `core/dist/*.js`
   와 바이트 비교(차이 288줄 전부 `node_modules/yaml` 경로 주석 = 심링크 경로 차이. 제품 코드
   차이 0).
2. **서브커맨드 전수 exit code** — `core/src/help.ts` 의 `COMMANDS` 레지스트리를 esbuild 로
   번들해 기계적으로 64개 (군, 하위명령) 쌍을 뽑고, 전부 무인자로 실행해 exit code·stderr
   첫 줄·스택트레이스 유무를 표로 수집. 이어서 **인자 과다**(위치인자 뒤에 쓰레기), **빈 문자열**,
   **미지 하위명령**, **열거형 오값**(severity·status·phase·evidence), **존재하지 않는 ID**,
   **200 000자 인자**, **경로 traversal 형태 ID**, **ANSI 제어문자**를 각각 투입.
3. **훅 stdin 구동** — Claude Code 훅 프로토콜 그대로 stdin 에 JSON 을 먹여
   `bin/harness-hook {session-start|pre-tool|post-tool|stop}` 를 직접 실행. 정상 페이로드,
   빈 stdin, 잘린 JSON, JSON 아닌 것, `null`/`[]`/`12345`(파싱은 되지만 객체가 아닌 것),
   100 KB·1 MB·5 MB 페이로드, 그리고 리다이렉트/명령 형태를 바꿔 가며 판정 차이를 관측.
   `core/src/bashwrite.ts` 를 esbuild 로 번들해 `scanBashWrites()`·`isReadOnlyCommand()` 를
   직접 호출해 내부 상태(`mutating`·`targets`)를 확인.
4. **MCP** — `node mcp/server.js` 를 띄워 JSON-RPC 로 `initialize` → `notifications/initialized`
   → `tools/list` → `ping` → `resources/list`(미지 메서드) → 파싱 불가 줄 → `tools/call`
   (미지 툴·필수 인자 누락·미지 인자·타입 오류) 순으로 실제 왕복.
5. **파일 포맷** — 샌드박스 `.harness/` 를 실제로 손상시켜 봤다: `state.json` 손상/삭제/
   `schemaVersion: 99`, `events.jsonl` 에 비-JSON 줄·`type` 없는 줄·`null` 줄·미래 이벤트 타입
   주입, `config.yaml` 을 파싱 불가 YAML 로 만들기, 그리고 **키 오타**.
6. **규칙 복제** — 같은 상수·같은 판정이 여러 파일에 있는지 훑고, 갈린 지점을 실측으로 확인.

**단일 테스트 파일 실행: 없음.** (`npm test` 전체·`bench:hook` 모두 미실행. 필요한 계약은 전부
실제 바이너리 구동으로 확인했다.)

> **오케스트레이터에게 — 워킹트리 오염 보고(내 소행 아님으로 보이나 확정 못 함)**
> 이 축 세션 시작 시 `git status --porcelain` 은 `?? docs/release-readiness/2026-08-27/` 하나였다.
> 감사 종료 시점에는 `M progress.md` 와 `?? .harness/` 가 추가로 떠 있다.
> - `progress.md` 는 2026-08-27 23:43:58 에 33줄이 추가됐다 — **나는 이 파일을 읽지도 쓰지도 않았다.**
> - `.harness/` 는 23:54:32 에 생겼고 저널에 `init` + `policy-pinned` 두 줄뿐이다
>   (`.harness/.runtime/last-activity` 는 그 뒤 훅이 계속 갱신 중). 내 모든 `harness init` 은
>   `CLAUDE_PROJECT_DIR` 를 샌드박스로 지정해 실행했고 그 시각에 나는 `init` 을 부르지 않았다.
> 두 변경 모두 **다른 축 에이전트/오케스트레이터의 동시 작업**으로 보인다. 남의 진행 중 상태를
> 지우는 것이 더 위험하다고 판단해 **손대지 않았다.** `.harness/` 는 `.gitignore` 에 없으므로
> (`.gitignore` 는 `node_modules/`·`.omc/`·`.claude/terse-mode.state` 3줄뿐) 커밋 전에 정리가 필요하다.

## 판정선 대비 (게이트 G4)

| 게이트 목표 | 실측 | 판정 |
|---|---|---|
| 서브커맨드 전수 exit code 계약 위반 0 | 64개 전수 실행. 스택트레이스 유출 0, 미지 하위명령 전부 exit 1 + 후보 목록. **다만 exit 1 이 4가지 의미로 겹쳐 있다**(API-05) | ✗ (부분) |
| `--help` 정확성 — 문서에 없는 명령 0 | 저장소 전 `.md`/`.json` 의 `` `harness …` `` 인용 전수 대조: **레지스트리에 없는 명령 언급 0** | ✓ |
| `--help` 정확성 — 명령에 없는 문서 0 | `cli.ts` 디스패치 라벨 85개 전수 ↔ `help.ts` 레지스트리 64개 대조. 누락 0(`hook`·`--version`·`backtrack clear` 포함 전부 도달 가능하고 도움말에 표기됨) | ✓ |
| 비TTY/파이프 안전 | ANSI 0, 파이프 조기 종료(EPIPE) 크래시 0, stdin 닫힘 exit 0, `TERM` 없음 exit 0 | ✓ |
| 입력 검증 누락 0 | 열거형(severity/status/phase/evidence)·필수 인자·미지 플래그·MCP 미지 인자는 전부 거부. **그러나** 설정 키 오타(API-03), 노드 ID 형식(API-08), 위치인자 과다(API-12)는 침묵 통과 | ✗ |
| (훅 계약) 10초 타임아웃 안에 끝나는가 | ~1 MB Bash 명령에서 **10.1–12.8초**(3회 재측정 전부 초과). `timeout 10` 시뮬레이션에서 stdout 0바이트 = 무판정 = allow | ✗ |
| (do-no-harm) 비정상 입력에 세션을 깨지 않는가 | 빈·잘린·비JSON·5 MB stdin 전부 exit 0, `pre-tool` 은 읽지 못하면 fail-closed deny | ✓ |

**G4 미통과.** 결정적인 것은 세 가지다: 읽기 전용 명령의 과차단(API-01), 규칙 두 벌 중 한쪽만
막는 경로(API-02), 그리고 정책 설정의 침묵 유실(API-03).

## 발견

### [API-01] BLOCKER — `2>&1` 하나로 읽기 전용 명령이 「소스 쓰기」로 오판돼 설계 트랙에서 거부된다
**근거등급** measured
**근거** `core/src/bashwrite.ts:1246` · `core/src/hook.ts:1935` · `core/src/hook.ts:1930`(반증되는 주석)

재현(샌드박스 프로젝트 `P` 는 `harness init` 만 된 P0 상태):

```sh
printf '{"tool_name":"Bash","tool_input":{"command":"cat src/app.ts"},"cwd":"'"$P"'"}' \
  | CLAUDE_PROJECT_DIR="$P" bin/harness-hook pre-tool     # → 빈 출력 (allow)

printf '{"tool_name":"Bash","tool_input":{"command":"cat src/app.ts 2>&1"},"cwd":"'"$P"'"}' \
  | CLAUDE_PROJECT_DIR="$P" bin/harness-hook pre-tool
# → {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
#     "permissionDecisionReason":"Implementation code cannot be written in the design track (P0)
#      — src/app.ts is blocked because a .ts file is source code. … (shell write target)"}}
```

실측한 거부 범위(전부 P0, 전부 읽기 전용):

| 명령 | 판정 |
|---|---|
| `cat src/app.ts` | allow |
| `cat src/app.ts 2>&1` | **deny** |
| `head -50 src/app.ts 2>&1` | **deny** |
| `wc -l src/app.ts 2>&1` | **deny** |
| `git log -1 -- src/app.ts 2>&1` | **deny** |
| `git diff src/app.ts 2>&1` | **deny** |
| `diff src/a.ts src/b.ts 2>&1` | **deny** |
| `grep -rn TODO src/ 2>&1` | **deny** |
| `less src/app.ts 2>&1` | **deny** |
| `cat src/app.ts 1>&2` · `>&2` · `3>&1` · `2>& 1` | **deny** |
| `cat src/app.ts 2>/dev/null` | allow (대상이 `/dev/null` 로 추출됨) |
| `cat README.md 2>&1` | allow (소스가 아니라서) |

`scanBashWrites` 를 직접 호출해 내부 상태를 봤다:

```
mut=false targets=[]  | cat src/app.ts
mut=true  targets=[]  | cat src/app.ts 2>&1     ← fd 복제인데 mutating 이 선다
```

**무엇이 깨지는가** 인과가 두 마디다. ① `bashwrite.ts:1246` 은 `if (redirects.length > 0)
mutating = true` 다 — `redirectTargets()` 는 `2>&1` 을 **fd 복제라 파일이 아니다**라고 올바르게
걸러내는데(`bashwrite.ts:630`), 그 앞에서 「리다이렉트가 있었다」는 사실만으로 `mutating` 이
선다. ② `hook.ts:1935` 는 `scan.targets.length === 0` 이면 **명령문의 모든 경로 토큰**을 쓰기
대상으로 판정한다. 그래서 *읽고 있던* 파일이 쓰기 대상이 된다.
`hook.ts:1930` 의 주석은 정확히 이것을 부정한다 — *"`mutating` 과 AND 이므로 `cat src/app.ts`
같은 조회는 걸리지 않는다"*. `2>&1` 이 붙는 순간 성립하지 않는다.

파급은 좁지 않다. 모든 프로젝트는 P0(설계 트랙)에서 시작하고, 설계 중에 소스를 **읽는** 것은
정상 작업이다. 게다가 거부문이 「구현 코드는 설계 트랙에서 쓸 수 없다 · P6 승인 뒤에 하라」라
사람과 에이전트 모두 **원인과 전혀 다른 곳**(게이트 절차)으로 인도된다 — `2>&1` 을 떼면
된다는 것을 알 길이 없다. `bashwrite.ts:604` 가 스스로 적어 둔 기준
(「과차단이 곧 방어 0 — 사람이 하네스를 꺼버린다」)에 정면으로 걸린다.

**같은 뿌리의 두 번째 증상**: `isReadOnlyCommand()` 도 리다이렉트가 붙으면 false 를 준다
(실측: `git status` → true, `git status 2>&1` → false). `hook.ts` 의 PostToolUse 활동 집계가
이 함수를 쓰므로([COST-111]), **순수 조회만 한 턴이 「작업 활동」으로 집계돼** Stop 훅의
턴 로그 차단이 깨어난다. [COST-111] 이 없앴다고 적은 비용이 `2>&1` 한 번에 되돌아온다.

**제안** `mutating` 을 「리다이렉트가 있었다」가 아니라 「**파일 대상 리다이렉트가 있었다**」로
좁힌다(`redirectTargets()` 가 이미 fd 복제를 구분하므로 그 결과를 쓰면 규칙이 한 벌로 남는다).
`hook.ts:1935` 의 `pathLikeMentions` 안전망은 「추출 실패」일 때만 도는 것이 원 의도이므로,
「대상이 0개」가 아니라 「대상 추출이 실패했다」는 플래그를 스캐너가 명시적으로 내도록 한다.

---

### [API-02] HIGH — 「프로젝트 루트 밖 쓰기 금지」 규칙이 Write/Edit 에만 있고 Bash 경로에는 없다
**근거등급** measured
**근거** 재현:

```sh
# Write 도구
printf '{"tool_name":"Write","tool_input":{"file_path":"/tmp/outside-code.ts","content":"x"},"cwd":"'"$P"'"}' \
  | CLAUDE_PROJECT_DIR="$P" bin/harness-hook pre-tool
# → deny "Paths outside the project root cannot be written in the design track: /tmp/outside-code.ts"

# 같은 대상, Bash 리다이렉트
printf '{"tool_name":"Bash","tool_input":{"command":"echo x > /tmp/outside-code.ts"},"cwd":"'"$P"'"}' \
  | CLAUDE_PROJECT_DIR="$P" bin/harness-hook pre-tool
# → 빈 출력 (allow)
```

`cat > /tmp/outside-code.ts <<EOF … EOF` 도 allow.

**무엇이 깨지는가** 같은 질문(「루트 밖에 써도 되는가」)에 두 표면이 다른 답을 준다. 이
저장소의 코드 주석이 반복해 적은 실패 유형 그대로다 — *「규칙이 두 벌이면 느슨한 쪽이 정본이
된다」*(`hook.ts:2288` 부근·`bashwrite.ts` 다수). Write 쪽 규칙은 사실상 장식이 된다: 막고 싶은
행위가 Bash 한 줄로 그대로 성립하기 때문이다. 프로젝트 **안**의 소스 쓰기는 두 경로 모두
막히는 것을 확인했으므로(아래 API-V9·V11) 즉시 데이터가 깨지지는 않지만, 「어떤 규칙이
어느 표면에 있는지」가 우연에 맡겨져 있다는 사실 자체가 다음 규칙에서 재발한다.

**제안** 두 경로가 같은 판정 함수(`judgeWritePath`)를 이미 공유한다면 루트-밖 검사만 Write
분기에 남아 있는 것이므로 그 검사를 판정 함수 안으로 옮긴다. 옮기지 않기로 한다면 **왜
Bash 는 예외인지**를 주석/README 「알려진 한계」에 적어 두 표면이 같은 말을 하게 한다.

---

### [API-03] HIGH — `.harness/config.yaml` 의 키 오타가 침묵으로 무시되고, `doctor` 는 `ok: true` 를 준다
**근거등급** measured
**근거** `core/src/config.ts:83`(알려진 키만 뽑아 나머지를 버리는 매핑) · `core/src/config.ts:104`(`inspectConfig` 가 파싱 실패와 「매핑이 아님」만 본다)

재현:

```sh
# 사용자가 막고 싶었던 것: my-secret-deploy
cat > "$P/.harness/config.yaml" <<'EOF'
profile: generic
design_bloked_bash:        # ← 오타 (blocked → bloked)
  - "my-secret-deploy"
EOF

printf '{"tool_name":"Bash","tool_input":{"command":"my-secret-deploy now"},"cwd":"'"$P"'"}' \
  | CLAUDE_PROJECT_DIR="$P" bin/harness-hook pre-tool
# → 빈 출력 (ALLOW — 사용자의 차단은 존재하지 않는다)

CLAUDE_PROJECT_DIR="$P" bin/harness doctor
# → "ok": true, issues: [], warnings: [ 정책 파일이 베이스라인과 다르다 … "The change may well be legitimate" ]
```

키를 바르게 적으면(`design_blocked_bash`) 같은 명령이 deny 된다 — 즉 차이는 오직 오타 하나다.

**무엇이 깨지는가** 이 제품에서 `config.yaml` 은 **훅이 무엇을 막을지 정하는 파일**이다.
그 파일의 키를 잘못 적으면 정책이 조용히 기본값으로 되돌아가고, 사용자는 자기가 적어 둔
차단이 걸려 있다고 믿는다. `doctor` 가 내는 유일한 신호는 「정책 파일이 바뀌었다 —
**정당한 변경일 수 있다**」인데, 이 경우 사용자는 실제로 정책을 바꾸려 했으나 **효과가 0**이다.
안내가 오히려 안심시킨다.

이것이 특히 아픈 이유는 **같은 제품의 다른 두 입력 표면이 정확히 반대로 행동**하기 때문이다:

- CLI 미지 플래그 → `core/src/cli.ts:590` 이 큰 소리로 거부한다.
  *"An unknown flag is never applied — accepting it silently would record something other than what you asked for."*
- MCP 미지 인자 → 실측 거부: `harness_node_upsert {"bogusArg":"XXX"}` →
  *"Unknown input for harness_node_upsert: bogusArg … An unknown key is never applied."*
- **정책 config 미지 키 → 침묵 수용.**

셋 중 가장 위험한 표면만 관용적이다. `core/src/config.ts:96` 부근의 [UX-151] 주석이
*「강제가 사라진 것보다 사라진 줄 모르는 것이 나쁘다」* 라고 적고 파싱 실패만 처리했는데,
오타는 파싱에 성공한다.

**제안** `inspectConfig` 가 `DEFAULT_CONFIG` 의 키 집합과 대조해 미지 키를 `problems` 로 올린다
(값 하나, 판정 경로는 그대로 조용히 둔다 — `doctor` 만 말하면 된다). 대소문자·오타 근접
후보를 함께 제시하면 CLI 의 `explainUnknownFlag` 와 같은 말을 하게 된다.

---

### [API-04] HIGH — PreToolUse 가 `hooks.json` 의 10초 예산을 초과한다(4 MB stdin 상한의 산정 근거가 실측과 어긋난다)
**근거등급** measured
**근거** `hooks/hooks.json:8`(`"timeout": 10`) · `core/src/cli.ts:249`(`MAX_BYTES = 4 * 1024 * 1024` 와 그 산정 주석)

재현(대상이 전부 통과 대상인 Bash 명령 = allow 경로):

```sh
python3 -c "
import json
parts=['cd s%d && echo x > f%d.txt'%(i,i) for i in range(30000)]
print(json.dumps({'tool_name':'Bash','tool_input':{'command':' ; '.join(parts)},'cwd':'$P'}))
" > /tmp/px.json          # 1 028 022 바이트

time CLAUDE_PROJECT_DIR="$P" bin/harness-hook pre-tool < /tmp/px.json
```

실측(3회 반복):

| 페이로드 | 소요 |
|---|---|
| 0.34 MB (n=10 000) | 4.6 s / 4.3 s / 6.1 s |
| 0.68 MB (n=20 000) | 10.8 s / 7.0 s / 4.5 s |
| **1.03 MB (n=30 000)** | **12.8 s / 10.1 s / 10.5 s** |
| 2.08 MB (n=60 000) | 11.8 s / 19.8 s / 20.4 s |

Claude Code 가 실제로 하는 것을 시뮬레이션:

```sh
timeout 10 bin/harness-hook pre-tool < /tmp/px.json ; echo "exit=$?"
# exit=124, stdout 0바이트  ← 무판정 = allow
```

**무엇이 깨지는가** `cli.ts:241-249` 의 [COST-261] 주석은 상한을 **타임아웃에서 역산했다**고
적는다: *「판정 비용은 1MB 당 약 1초라 … 4MB 는 실측 약 4초로 여유 2.5배다」*. 이 산정은
페이로드 **크기**만 보고 **모양**을 보지 않았다. 쓰기 대상이 많고 `cd` 로 깊이가 자라는
명령에서는 1 MB 가 약 10초다 — 즉 **상한(4 MB) 안쪽에 이미 fail-open 구간이 있다.**
같은 주석이 *「상한이 타임아웃보다 크면 그 사이 구간은 거부가 아니라 fail-open 이 된다」*
라고 경고한 바로 그 상태다.

**관측된 영향의 한계도 함께 적는다(과장하지 않기 위해)**: 거부 대상이 하나라도 섞이면
스캐너가 **빠르게 단락**한다 — 1 MB 패딩 뒤에 `echo x > src/app.ts` 나
`cd "$P/src" && echo x > app.ts` 를 붙여도 0.99–1.5초에 deny 가 나왔다. 그래서 이 세션에서는
**이것을 소스 쓰기 우회로 전환하지 못했다.** 확정적으로 관측된 것은 두 가지다:
(1) 정상 도구 호출 하나가 **10초 멈춘 뒤**(PostToolUse 까지 세면 두 번) 아무 판정 없이 지나간다,
(2) 그 구간에서 훅은 **판정을 낸 적이 없다**. 물리 정규화가 필요한 거부(심링크·`..`)가 느린
경로에 놓이는 형태가 있는지는 축⑥(보안)에 넘긴다.

**제안** `MAX_BYTES` 를 실측 최악 모양(대상 다수 + `cd` 깊이) 기준으로 다시 잡는다(0.5 MB
수준). 더 나은 것은 **대상 개수·경로 해석 횟수에 상한**을 두고 상한 초과를 `unread` 와 같은
태도로 **거부**하는 것이다 — 지금은 상한이 바이트 하나뿐이라 모양이 바뀌면 예산이 무너진다.

---

### [API-05] MED — exit code 1 이 네 가지 의미로 겹쳐 있다(「판정이 NO-GO」와 「명령이 실패」를 구분할 수 없다)
**근거등급** measured
**근거** `core/src/cli.ts:927`(`return v.ok ? 0 : 1`) · `core/src/cli.ts:1638`(모든 예외 → `return 1`)

재현(`$PV` = 초기화된 프로젝트, `$PN` = `.harness/` 없는 디렉토리):

```
verdict: NO-GO (실제 판정)          exit=1   NO-GO
verdict: .harness 없음 (환경 오류)   exit=1   No .harness/ here — run `harness init` first.
verdict: 하위명령 오타 (사용법 오류)  exit=1   Unknown ship subcommand: verdikt — …
doctor: state 손상                  exit=1   {…}
doctor: 정상                        exit=0
unknown top-level command           exit=1   Unknown command: frobnicate
```

**무엇이 깨지는가** `harness ship verdict` 는 출하 게이트다 — CI 나 릴리스 스크립트가
`harness ship verdict || exit 1` 로 쓰는 것이 정상 사용이다. 그런데 **엉뚱한 디렉토리에서
실행했거나 하위명령을 오타 냈을 때도 정확히 같은 exit 1** 이 나온다. 스크립트는 「제품이
준비되지 않았다」와 「명령이 아예 돌지 않았다」를 구분할 수 없고, 후자가 전자로 읽히면
**릴리스가 조용히 멈춘 채 이유를 오해**한다. 반대로 실패를 무시하도록 짜 두면 진짜 NO-GO 도
무시된다. 어느 문서에도 exit code 규약이 없다(README·docs 전수 검색, `exit code` 언급 0).

**제안** 최소 3구간으로 나눈다: `0` 성공/GO · `1` 사용법·환경 오류 · `2` 판정이 「아니오」
(`ship verdict` NO-GO, `doctor` 진단 실패, `gate verify` 드리프트). 그리고 그 표를
`harness --help` 꼬리와 README 에 적는다.

---

### [API-06] MED — 사용자에게 `undefined` 가 그대로 보이는 오류문이 3곳 남아 있다([USE-94] 가 없앴다고 적은 바로 그 패턴)
**근거등급** measured
**근거** `core/src/cli.ts:1380`(`reviseAdr(root, rest[0], …)`) · `core/src/cli.ts:904`(`updateDefect(root, flag(args,'id') ?? rest[1], …)`) · `core/src/cli.ts:1108`(`commandFor(p, rest[0])`)

재현(전부 인자 없이):

```
harness adr revise          → exit 1  "No ADR record undefined (/…/.harness/adr/undefined.yaml)"
harness ship defect update  → exit 1  "No such defect id in the ledger: undefined — check ids with …"
harness profile cmd         → exit 1  "Profile generic has no 'undefined' command — set it in …"
```

**무엇이 깨지는가** `cli.ts:560` 의 `req()` 헬퍼와 그 위 [USE-94] 주석이 정확히 이 증상을
설명하고 고쳤다고 적는다 — *「예전에는 `undefined` 가 그대로 오류문에 박혀(「No such ADR:
undefined」) 사람이 「내가 등록을 안 했나」로 오진했다」*. 세 호출부가 `req()` 를 통과하지
않아 그 오진이 그대로 남아 있다. 특히 `adr revise` 는 예시로 든 문장과 **거의 같은 문장**을
낸다. 진단은 「ADR 을 등록했는가」로 향하지만 진짜 원인은 「인자를 안 줬다」다.

**제안** 세 자리에 `req(rest[0], 'harness adr revise <ADR-x> --question <q>')` 형태를 끼운다.
근본적으로는 `req()` 통과를 강제할 방법이 없으므로(호출부 규율), 위치인자를 읽는 지점을
`positional(rest, 0, usage)` 한 함수로 모아 `rest[0]` 직접 접근을 없애는 편이 재발을 막는다.

---

### [API-07] MED — `harness backtrack clear` 는 역행이 없어도 성공하고, 매번 저널에 사건을 남긴다
**근거등급** measured
**근거** `core/src/cli.ts:1585`(`clear` 분기)

재현:

```
harness init                        # 저널 2줄
harness backtrack clear  ×3         # 전부 exit 0, "Backtrack ended"
→ 저널 5줄. 끝 두 줄:
{"ts":"…","type":"backtrack-cleared","data":{}}
{"ts":"…","type":"backtrack-cleared","data":{}}
```

**무엇이 깨지는가** `events.jsonl` 은 이 제품에서 **진실의 원천**이다(`state.json` 은 파생
캐시이고 `doctor --repair` 가 저널을 재생해 복구한다). 그 저널에 **일어나지 않은 역행 종료**가
기록된다. 나중에 저널을 읽어 「이 프로젝트에서 역행이 몇 번 있었나」를 세는 사람·도구는
실제보다 많은 수를 본다. 침묵 성공의 전형이기도 하다 — 마커가 없는데 "Backtrack ended" 는
사실이 아니다. (같은 파일의 [USE-90] 이 `backtrack --reason` 누락을 「침묵 성공이자 사고」로
규정하고 고친 것과 같은 부류인데, `clear` 쪽만 남았다.)

**제안** 마커가 없으면 exit 0 + 「역행 중이 아니다」로 **저널에 쓰지 않고** 끝낸다.
(멱등성은 유지하되 사건을 지어내지 않는다.)

---

### [API-08] MED — `harness node upsert --id` 에 ID 형식 검증이 전혀 없다(200 KB·개행·traversal 형태 전부 exit 0)
**근거등급** measured
**근거** 재현:

```
harness node upsert --id "../../etc/x" --title t        → exit 0  "../../etc/x created in the design ledger"
harness node upsert --id <200 000자> --title t          → exit 0  (원장 200 188 바이트로 팽창, 출력에 200 KB 그대로 반향)
harness node upsert --id $'D-1\nnodes:\n  - id: INJECTED\n    title: pwned' --title t
                                                        → exit 0  (YAML 은 블록 인용으로 안전하게 감싼다 — 주입은 성립하지 않는다)
harness node upsert --id D-esc --title $'T\e[31mRED\e[0m' → exit 0  (ANSI 제어문자 그대로 저장)
```

같은 명령군의 형제는 검증한다: `harness doc upsert --path ../../../etc/passwd --phase P0` →
exit 1 *"A registered document must live inside the project"*.

**무엇이 깨지는가** 설계 원장(`ledger.yaml`)은 이 제품의 중심 산출물이고, 노드 ID 는
웨이브·문서·RTM 이 참조하는 **키**다. 형식 검증이 없으므로 오타·붙여넣기 사고가 그대로
영구 노드가 되고(원장은 append 성격), 그 뒤 `harness node bump <id>`·`harness trace <id>` 로
다루려면 200 KB 짜리 인자를 다시 정확히 재현해야 한다. YAML 주입은 성립하지 않는 것을
확인했으므로 데이터 파괴는 아니지만, **입력 검증 누락 0** 이라는 이 축의 판정선에는 걸린다.

**제안** ID 에 최소 형식(예: `^[A-Za-z][A-Za-z0-9._-]{0,63}$`)을 걸고, 어긋나면 다른 열거형
검증과 같은 어투로 거부한다(`Invalid node id: … — use letters, digits, . _ -`).

---

### [API-09] MED — 배포 명령 목록이 세 벌인데 테스트는 그중 두 벌만 잇고, 두 판정 게이트의 대조 방식이 다르다
**근거등급** measured + code
**근거** `core/src/config.ts:16`(`DEFAULT_CONFIG.design_blocked_bash`, 21개) · `core/src/profile.ts:91`(`GENERIC_FLOOR.deployCommands`, 21개) · `profiles/generic/profile.yaml:25`(`deploy_commands`, 21개) · 판정: `core/src/hook.ts:2275`(config 게이트) vs `core/src/profile.ts:500`(`isDeployCommand`) · 테스트: `core/test/profile.test.ts:85`

`profile.ts:78-81` 이 스스로 적는다: *「코드 내장 바닥값 — `profiles/generic/profile.yaml` 과
같은 값이어야 한다(**테스트가 지킨다**). deploy_commands 는 `config.ts` 의
`DEFAULT_CONFIG.design_blocked_bash` 와도 같다. 세 곳이 갈라지면 정본이 사라진다.」*

실제로는 `profile.test.ts:85` 가 `profile.yaml ↔ GENERIC_FLOOR` **한 쌍만** 검사한다.
`GENERIC_FLOOR.deployCommands ↔ DEFAULT_CONFIG.design_blocked_bash` 를 잇는 단언은 전 테스트
파일에 없다(`core/test/` 전수 grep). 지금은 세 값이 우연히 같다 — 지켜서 같은 것이 아니다.

두 게이트의 대조 방식도 다르다(실측, `config.yaml` 기본 상태):

| 명령 | 발화한 게이트 |
|---|---|
| `npm publish` | config 게이트 |
| `npm  publish`(공백 2) | config 게이트 |
| `sh -c "npm publish"` | config 게이트 |
| `NPM PUBLISH` | **profile 게이트**(config 게이트는 대소문자 구분이라 놓친다) |

그리고 `design_blocked_bash: []` 로 **비워도** `npm publish`·`docker push`·`terraform apply` 가
전부 profile 게이트에서 deny 된다(실측).

**무엇이 깨지는가** ① 세 목록 중 한 곳만 고치면 조용히 갈리고, 그 사고를 잡을 테스트가
`config.ts` 쪽에는 없다. ② 사용자가 `config.yaml` 의 `design_blocked_bash` 를 「차단 목록의
정본」으로 읽는 것이 자연스러운데(키 이름이 그렇게 말한다) 실제로는 **두 게이트의 합집합**
이라 config 만으로는 좁힐 수 없다 — 정본이 어디인지 사용자가 알 수 없다.
(단, 어느 쪽으로 갈려도 **더 막는 쪽**으로 떨어지므로 지금 당장 뚫리지는 않는다.)

**제안** ①`config.ts` ↔ `profile.ts` 동치를 단언하는 테스트를 한 줄 추가한다(세 다리를 모두
잇는다). ②둘 중 하나를 파생으로 만든다 — `DEFAULT_CONFIG.design_blocked_bash`
= `GENERIC_FLOOR.deployCommands` 로 직접 참조하면 목록이 한 벌이 된다. ③`config.yaml` 값이
합집합의 한쪽일 뿐이라는 사실을 키 주석과 README 에 적는다.

---

### [API-10] MED — 저널·원장·웨이브를 읽는 경로에 크기 상한이 없고, 저널에는 회전·압축도 없다
**근거등급** code
**근거** `core/src/events.ts:67` · `core/src/events.ts:150`(둘 다 `fs.readFileSync(eventsPath(root),'utf8').split('\n')`) · `core/src/ledger.ts:16` · `core/src/wave.ts:62` · `mcp/server.js:144`(`buffer += chunk`, 줄 길이 상한 없음)

`core/src/` 전수 검색에서 `rotate|compact|prune|MAX_EVENTS|archive` 가 걸리는 곳은
`doctor.ts:345`(`hook-errors.log` 회전) 하나뿐이다 — **append-only 저널 자신에는 회전이 없다.**
`readAllStdin` 에는 4 MB 상한이 있으나(`cli.ts:249`) 그것은 **입력** 상한이고, 이미 디스크에
있는 저널·원장을 읽는 쪽에는 어떤 상한도 없다.

**무엇이 깨지는가** `events.jsonl` 은 프로젝트 수명 내내 자라고(웨이브 턴 로그·게이트·노드
갱신마다 한 줄), 훅은 열화 상태에서 저널을 **재생**한다(`events.ts:150` 의 `replayState`).
저널이 커질수록 훅 1회 비용이 선형으로 자라는데, 그 비용은 API-04 의 10초 예산과 같은
지갑에서 나간다. 상한이 없으므로 「언제부터 위험한가」를 코드가 스스로 알지 못한다.
(수치 실측은 축⑤ 소관이므로 여기서는 **코드상 상한 부재**만 올린다.)
`mcp/server.js:144` 도 같은 부류다 — 개행 없는 한 줄이 오면 버퍼가 상한 없이 자란다.

**제안** 저널 재생에 줄 수/바이트 상한과 「상한 초과 시 doctor 로 안내」를 둔다. 장기적으로는
스냅샷 + 이후 델타(압축) 구조. MCP 는 줄 길이 상한(예: 4 MB)을 두고 초과 시 `-32700`.

---

### [API-11] LOW — MCP `harness_wave_create` 스키마가 `goal` 을 선택으로 선언하는데 구현은 필수로 거부한다
**근거등급** measured
**근거** `core/src/mcp.ts:132-144`(`inputSchema` 에 `required` 없음)

```
tools/call harness_wave_create {}  → isError: true
  "A wave needs a goal — an instruction sheet without one cannot be picked up by the next session"
```

**무엇이 깨지는가** 모델은 스키마를 읽고 호출을 만든다. 스키마가 「전부 선택」이라고 하면
`goal` 없이 부르고, 그때마다 왕복 한 번이 낭비된다. 선언된 계약과 구현이 다르면 **선언이 아니라
시행착오가 계약이 된다**. (다른 15개 툴은 `required` 가 실제와 맞고, `harness_gate_approve` 의
빈 `required` 는 「이 툴은 MCP 로는 못 한다」는 의도적 설계라 문제 없다.)

**제안** `required: ['goal']` 을 넣는다.

---

### [API-12] LOW — 위치인자 과다(arity overflow)가 전 명령에서 침묵 무시된다 — 미지 플래그는 큰 소리로 거부하면서
**근거등급** measured
**근거** `core/src/cli.ts:590`(미지 **플래그**만 검사한다)

```
harness node list GARBAGE          → exit 0  []
harness gate status GARBAGE        → exit 0  {}
harness status GARBAGE             → exit 0  {…}
harness node upsert --id D-2 --title T2 GARBAGE   → exit 0  "D-2 created in the design ledger"
harness --nonsense                 → exit 1  "Unknown flag: --nonsense. An unknown flag is never applied …"
```

**무엇이 깨지는가** `cli.ts:590` 의 거부문이 이유를 명시한다 — *「조용히 받으면 요청과 다른
것이 기록된다」*. 그 이유는 위치인자에도 똑같이 성립하는데(예: `harness node bump D-1 D-2` 는
`D-2` 를 버린다) 한쪽만 검사한다. 지금까지 관측된 실제 피해는 없다(대부분 조회 명령이고,
쓰기 명령은 플래그 형식이다).

**제안** 각 하위명령이 받는 위치인자 개수를 `help.ts` 의 `args` 에서 파생해 초과분을 같은
어투로 거부한다.

---

### [API-13] LOW — JSON 으로 파싱되지만 객체가 아닌 stdin 은 「입력 없음 = 통과」가 된다(파싱 실패는 fail-closed 인데)
**근거등급** measured
**근거** `core/src/cli.ts:485`(`input = JSON.parse(raw)` — 결과가 객체인지 확인하지 않는다)

```
printf 'null'          | bin/harness-hook pre-tool  → exit 0, 빈 출력 (allow)
printf '[]'            | bin/harness-hook pre-tool  → exit 0, 빈 출력 (allow)
printf '12345'         | bin/harness-hook pre-tool  → exit 0, 빈 출력 (allow)
printf '{"tool_name":' | bin/harness-hook pre-tool  → deny (읽지 못했다 — fail-closed) ✔
```

**무엇이 깨지는가** [SEC-233] 이 세운 규칙은 「읽지 못한 것은 통과시키지 않는다」인데,
`JSON.parse('null')` 은 **성공**하므로 그 규칙을 우회한다. Claude Code 는 항상 객체를 보내므로
실사용에서 도달하지 않는 것으로 보이지만, fail-closed 를 만든 근거가 「형태를 보장할 수 없다」
였다면 형태 검사가 파싱 성공에도 붙어야 일관된다.

**제안** `typeof input === 'object' && input !== null && !Array.isArray(input)` 이 아니면
`unread = true` 로 떨어뜨린다(파싱 실패와 같은 경로).

---

### [API-14] LOW — 58개 하위명령 중 20개가 저장소의 어느 `.md` 에도 등장하지 않는다(`--help` 에만 있다)
**근거등급** measured
**근거** 저장소 전 `.md`/`.json`(release-readiness 제외)의 `` `harness …` `` 인용을 기계적으로
추출해 레지스트리와 대조. 결과: 문서에만 있고 존재하지 않는 명령 **0**(양호),
반대로 문서에 한 번도 안 나오는 하위명령 **20**:

```
node list · report packet · doc upsert · doc url · doc approve · doc stale
adr propose · adr decide · design inventory · design html · design list
evidence packet · loop next · loop critical raise · loop critical clear
ship deployments · profile show · profile cmd · usage tier · usage status
```

**무엇이 깨지는가** G4 의 「`--help` 정확성」 자체는 통과한다(`--help` ↔ 디스패치가 정확히
일치한다). 다만 `adr propose`·`adr decide` 처럼 **페이즈 스킬이 실제로 쓰라고 지시하는 절차**가
산문 문서에 한 줄도 없어, `--help` 를 부르지 않는 독자는 그 기능의 존재를 모른다.

**제안** README 의 명령 표를 `help.ts` 레지스트리에서 생성하거나, 최소한 커버리지 테스트를
둔다(문서에 없는 하위명령 목록을 실패로).

---

### [API-15] LOW — `state.json` 의 `schemaVersion` 을 읽기 경로가 검사하지 않는다(`doctor` 만 본다)
**근거등급** measured
**근거** `core/src/state.ts:50`(`JSON.parse(...) as HarnessState` — 버전 확인 없음) vs `core/src/doctor.ts:194`

```
# state.json 을 schemaVersion: 99, phase: "P8" 로 손으로 바꿔 두면
harness status  → exit 0, 그대로 출력
훅 pre-tool (src/app.ts Write) → 빈 출력 = ALLOW  ← P8 을 그대로 믿는다
harness doctor  → issues: ["phase mismatch: state=P8, journal replay=P0"],
                  warnings: ["state.json schemaVersion is 99, but this build only knows 1 …"]
```

**무엇이 깨지는가** 미래 버전이 쓴 상태 파일을 **판정 경로(훅)** 가 v1 로 조용히 읽는다.
버전 필드를 둔 이유가 「형태가 바뀔 수 있다」인데, 정작 그 형태를 신뢰해 결정을 내리는 곳이
확인하지 않는다. 지금은 v1 뿐이라 실피해가 없고, `.harness/state.json` 은 Write·Bash 양쪽에서
보호되므로(API-V9) 에이전트가 스스로 위조할 수는 없다 — 하지만 **버전 스큐**(플러그인
업/다운그레이드, 팀원 간 버전 차이)에서는 사람이 만들지 않아도 발생한다.
`doctor` 가 잡는 `phase mismatch` 도 판정 경로에는 전달되지 않는다.

**제안** `readState` 가 알 수 없는 `schemaVersion` 을 만나면 훅에서는 **가장 엄격한 페이즈로
떨어뜨리거나**(fail-closed) 최소한 `degraded` 로 표시해 deny 문에 태그가 붙게 한다.

---

## 확인했고 괜찮았던 것 (verified/measured 행)

### [API-16] — 서브커맨드 전수 도달성과 `--help` 정확성
**근거** `help.ts` 의 `COMMANDS` 를 esbuild 로 번들해 64개 (군, 하위명령) 쌍을 기계적으로 뽑고
전부 실행 — 「알 수 없는 하위명령」이 나온 것 0. 역방향으로 `cli.ts` 의 디스패치 라벨 85개
(`case '…'` + `sub === '…'` + `op === '…'`)를 전수 추출해 대조 — 레지스트리 밖 디스패치는
`hook`(의도적 은닉, 자체 `hook --help` 있음)·`--version`(도움말 꼬리에 명시)·`backtrack clear`
(`backtrack` 의 `args` 문자열에 `| clear` 로 표기됨) 셋뿐이고 전부 도달 가능·표기됨.
20개 군 각각 `harness <군> --help` 실행 → 전부 exit 0.

### [API-17] — 스택 트레이스 유출 0 · 열거형 검증 · 미지 하위명령 안내
**근거** 64개 명령 무인자 실행 전수에서 stderr 에 `at ` 프레임 0건. 전부 사용법 문장 + exit 1.
열거형 오값 실측: `--severity NOT_A_SEVERITY` → *"Invalid severity: … (one of blocker, high,
medium, low)"*, `--status NOT_A_STATUS`, `--phase P99`, `--evidence bogus` 전부 exit 1 + 허용값
열거. 미지 하위명령은 14개 군 전부 *"Unknown <군> subcommand: X — expected one of: …"* + exit 1.
빈 문자열 인자(`node bump ""` 등)도 `req()` 가 잡아 exit 1.

### [API-18] — 훅 do-no-harm: 깨진 입력에 세션을 깨지 않는다
**근거** `bin/harness-hook {session-start|pre-tool|post-tool|stop}` 에 각각
빈 stdin · 잘린 JSON(`{"tool_name":"Write","tool_input":`) · 비-JSON(`this is not json at all`) ·
`{"tool_name":null,"tool_input":null}` · `{"tool_name":{"nested":"obj"},"tool_input":[1,2,3]}` ·
100 KB/1 MB/5 MB 페이로드를 투입. **전부 exit 0**, 예외 전파 0. `pre-tool` 은 읽지 못한 입력에
대해 fail-closed deny 를 낸다:
*"The harness hook could not read this tool call (payload unreadable or too large), so it could
not judge it — and a call it cannot read is not a call it may allow."*
5 MB(4 MB 상한 초과) 페이로드도 327–464 ms 안에 deny 로 끝난다. 실패는 전부
`.harness/.runtime/hook-errors.log` 에 남고 `doctor` 가 *"13 hook decision failure(s) recorded"*
로 보고하는 것을 실측.

### [API-19] — MCP JSON-RPC 계약
**근거** `node mcp/server.js` 를 실제로 띄워 왕복:
`initialize` → `protocolVersion` 을 요청대로 에코, `capabilities.tools.listChanged: true`,
`serverInfo {name: king-wjang-harness, version: 0.1.2}`(= `package.json`);
`notifications/initialized`(id 없음) → **무응답**(규격대로);
`tools/list` → 16개 툴, 각 `inputSchema` 확인;
`ping` → `{}`; `resources/list` → `-32601 Method not found`;
파싱 불가 줄 → `{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}`
(JSON-RPC 2.0 규격대로 id=null, 서버는 죽지 않고 다음 줄을 계속 처리);
미지 툴 → 프로토콜 오류가 아니라 `isError: true` 결과 + *"available tools: …"* 안내;
필수 인자 누락(`harness_gate_submit {phase,paths:"not-an-array"}` 등) → 전부 `isError`;
**미지 인자 거부** → `harness_node_upsert {"bogusArg":"XXX"}` →
*"Unknown input for harness_node_upsert: bogusArg — this tool takes id, title, parent,
doc_anchor, status. An unknown key is never applied."*;
`harness_gate_approve` → *"Gate approval cannot be done over MCP — run `harness gate approve …`
in the terminal."* (사람의 최종 클릭 계약이 MCP 표면에서도 지켜진다).
`.harness/` 없는 프로젝트에서는 `tools/list` 가 **빈 배열**(비간섭).

### [API-20] — 손상·부재 상태 파일에서 훅이 fail-closed 로 떨어진다
**근거** `state.json` 을 `garbage{{{` 로 덮은 뒤와 아예 삭제한 뒤, 각각 `pre-tool` 에
`src/app.ts` Write 페이로드 → **둘 다 deny**. CLI 쪽은 원인과 처방을 함께 준다:
*"state.json is damaged and could not be parsed (…) — the state store is derived, so the event
journal can rebuild it: run `harness doctor --repair`."* / *".harness/ is here but state.json is
missing — … Do not run `harness init`: it refuses while .harness/ exists"*.
`harness doctor` 는 `ok:false` + `issues:["state.json is damaged — cannot parse"]`, exit 1.

### [API-21] — 저널 손상·미래 이벤트 타입을 세어서 드러낸다(은폐하지 않는다)
**근거** `events.jsonl` 에 `not json at all` · `{"ts":"x","type":123}` · `null` ·
`{"type":"unknown-future-event",…}` 4줄을 주입 후 `harness doctor`:
```
warnings: [ "3 line(s) of events.jsonl are corrupt — the replay is incomplete",
            "1 event(s) of unknown type (unknown-future-event) — the replay result is
             untrustworthy (possible version skew)" ]
```
손상 3줄(비JSON·type 없음·null)을 정확히 세고, 미래 타입을 **버전 스큐**로 명시한다.
`doctor --repair` 도 같은 경고를 유지한 채 상태를 망가뜨리지 않았다.

### [API-22] — 비TTY·파이프 안전
**근거** `harness --help | head -3`(조기 종료) · `harness report rtm | head -1` → EPIPE 크래시 0.
`harness status < /dev/null` exit 0, stdin 을 아예 닫은 `harness status 0<&-` exit 0.
`env -u TERM NO_COLOR=1 harness --help` exit 0. 출력에 ANSI 이스케이프 **0건**(정규식 대조).
`bin/harness-hook pre-tool < /dev/null` → exit 0, stdout 0바이트. 손으로 실행해도 TTY 에서
EOF 를 기다리며 멈추지 않는다(`tty.isatty(0)` 로 fd 를 건드리지 않고 묻는다, `cli.ts:479`).

### [API-23] — 커밋된 `core/dist` 가 `core/src` 에서 그대로 재현된다
**근거** 저장소를 샌드박스에 복사(`node_modules` 는 심링크)해 `npx tsup` 재빌드 후
`core/dist/cli.js`·`core/dist/mcp.js` 를 커밋본과 비교. 차이 288줄 **전부**
`// node_modules/yaml/…` 경로 주석(심링크 때문에 상대경로가 달라진 것)이고, 제품 코드
차이 **0줄**. 마지막 `core/src` 단독 커밋(`679e5bd`, `profile.ts` 의 죽은 export 제거)이
tree-shake 로 dist 에 영향이 없다는 그 커밋 메시지의 주장도 이로써 확인된다.

### [API-24] — `.harness/state.json` 이 Write 와 Bash 양쪽에서 보호된다
**근거** `{"tool_name":"Write","tool_input":{"file_path":"$P/.harness/state.json"}}` 와
`{"tool_name":"Bash","tool_input":{"command":"echo {} > .harness/state.json"}}` 둘 다 deny:
*".harness/state.json can only be changed by harness commands — editing it by hand desynchronises
the journal from the state. … (shell redirects, tee, sed -i follow the same rule)"*
같은 세션에서 `echo BYPASSED > src/app.ts` · `cd src && echo BYPASSED > app.ts`(1 MB 패딩을 앞에
붙인 형태 포함)도 전부 deny — 프로젝트 **안**의 소스 쓰기 차단은 Bash 경로에서도 성립한다.

### [API-25] — 비간섭 게이트와 오설정 fail-closed
**근거** `.harness/` 가 없는 디렉토리에서 `pre-tool` 15회: stdout **0바이트**, p50 **17 ms**
(min 13 / max 24) — `bin/harness-hook:26` 의 sh 게이트가 node 기동 자체를 건너뛴다.
`.harness` 를 **일반 파일**로 만들어 둔 오설정 상태에서는 게이트가 통과시키지 않고 코어로
넘겨 **deny** 가 나온다([COST-130] 이 적은 fail-closed 가 실제로 그렇게 동작한다).
같은 페이로드를 정상 하네스 프로젝트에서 15회 돌린 값은 p50 412 ms(min 282 / max 1059) —
수치 판단은 축⑤ 소관이므로 참고로만 적는다.

### [API-26] — 배포 차단의 우회 형태와 `--dry-run` 예외
**근거** P0 상태에서 실측:
`npm publish` deny · `npm  publish`(공백 2개) deny · `NPM PUBLISH` deny ·
`sh -c "npm publish"` deny · `echo hi && npm publish` deny ·
**`npm publish --dry-run` allow**([EFF-231] 의 「dry-run 은 배포가 아니다」가 실제로 성립).
`config.yaml` 에 `design_blocked_bash: ["my-secret-deploy"]` 를 넣으면 그 명령이 deny 되는 것도
확인(설정이 **넓히는** 방향으로는 동작한다).

### [API-27] — 열거형·필수 인자 외의 형태 검증
**근거** `node upsert --id $'D-1\nnodes:\n  - id: INJECTED\n    title: pwned'` 를 넣어도
`ledger.yaml` 이 블록 스칼라(`id: |-`)로 안전하게 감싸 **YAML 주입은 성립하지 않는다**
(`node list` 가 JSON 으로 정상 파싱되고 INJECTED 노드는 생기지 않는다).
`doc upsert --path ../../../etc/passwd` 는 exit 1 + *"A registered document must live inside the
project"* 로 거부된다.

---

## 확인 불가

- **실제 Claude Code 런타임에서의 훅 타임아웃 처리** — API-04 는 `timeout 10` 으로 플랫폼
  동작을 시뮬레이션했다. Claude Code 가 10초 초과 훅을 (a) 죽이고 무판정=allow 로 보는지,
  (b) 사용자에게 무엇을 보여 주는지는 이 세션에서 직접 관측하지 못했다.
  **필요한 것**: 하네스가 설치된 실제 Claude Code 세션에서 1 MB Bash 명령을 한 번 실행하고
  그때의 UI·transcript 를 캡처해 주면 확정된다.
- **API-04 의 느린 경로가 「거부해야 할 입력」과 겹치는가** — 거부 대상이 섞이면 스캐너가
  1초 안에 단락하는 것을 확인해 소스 쓰기 우회로 만들지 못했다. 물리 정규화(심링크·`..`)가
  필요한 거부가 느린 경로 뒤에 놓이는 형태가 있는지는 **축⑥(보안)** 이 판단해야 한다.
  이 축에서 넘기는 재료: `bashwrite.ts` 의 `realOrSelf` 재귀 + [COST-260] 판정 1회 캐시,
  그리고 「대상이 전부 allow 인 명령이 가장 느리다」는 실측.
- **버전 스큐 실측(API-15)** — 이전/이후 릴리스의 `.harness/` 를 실제로 갖고 있지 않아
  「구버전 하네스가 쓴 상태 파일」을 진짜로 재현하지 못했다. `schemaVersion` 을 손으로 바꾼
  합성 입력으로만 확인했다. **필요한 것**: 0.1.0/0.1.1 태그의 하네스로 초기화한 프로젝트
  디렉토리 하나.
- **`hooks.json` 이 선언한 matcher 가 실제 MCP 도구 이름과 맞는지** —
  `mcp__.*(write|edit|create|…)` 정규식이 실사용 MCP 서버들의 실제 도구 이름을 얼마나 덮는지는
  이 세션에 붙어 있는 서버 목록만으로는 대표성이 없다. **필요한 것**: 대상 사용자가 실제로
  켜 두는 MCP 서버들의 `tools/list` 덤프.
