# OPS-76 — 워크플로 구현 보고와 적대적 검증

**커밋** `300a103 — feat(policy): OPS-76 정책 변경 탐지 — 베이스라인 해시 고정 + doctor 관측`

## 구현 보고

### 요약
[OPS-76] 정책 변경을 관측 가능하게 만들었다. 게이트 산출물 해시(gate.ts 의 artifactHash)와 같은 패턴으로, 정책 파일 집합(.harness/config.yaml + .harness/profile/**)의 SHA-256 을 저널에 고정(policy-pinned)하고 doctor 가 대조한다. 새 모듈 core/src/policy.ts 가 정본이며, hook.ts 의 SEC-69 쓰기 보호 목록도 이제 여기서 import 한다 — 「막는 목록」과 「감시하는 목록」이 갈리면 느슨한 쪽이 정본이 되기 때문이다. 정당한 갱신 경로로 `harness doctor --accept-policy` 를 주고, 에이전트가 그것을 실행하는 경로는 훅이 막는다(정책 쓰기를 막아 놓고 수용을 열어 두면 에이전트가 드리프트를 조용히 승인해 탐지 장치를 끌 수 있다).

### 판단 근거
과제가 물은 네 가지에 대한 답과 근거. (1) 언제 고정하나 — init(사람이 아직 손대지 않은 정책 상태) + 명시적 수용(doctor --accept-policy) 둘뿐. 게이트 승인에서는 재고정하지 않는다: 승인 다이얼로그의 클릭은 «이 산출물을 심사했다»는 뜻이지 «정책 변경을 승인한다»가 아니라, 거기서 재고정하면 무관한 클릭에 정책 변경이 세탁돼 들어간다. 대신 gate-approved 이벤트에 그때의 정책 해시를 찍기만 해서(재고정 아님) 「이 게이트는 어떤 정책 아래 열렸나」를 저널만으로 답하게 했다. (2) issue 인가 warning 인가 — warning. doctor.ts 의 정의상 issues 는 «state 가 재생과 발산한 것 = repair 대상»인데, 정책 드리프트는 재생으로 못 고치고 고쳐서도 안 된다(repair 가 사용자의 config.yaml 을 되돌리면 SEC-69 가 남긴 사람의 탈출구를 하네스가 도로 빼앗는다). issue 로 올리면 사용자가 파일을 되돌릴 때까지 ok=false 가 영구히 박히는데, 그 파일 머리말이 적은 그대로 영구 red 는 경보를 죽인다. 그리고 정책 변경은 정당할 수 있다 — 목표는 「금지」가 아니라 「보이게」. (3) 저널 — 남긴다. 새 타입 policy-pinned 를 EVENT_TYPES 에 등록했다(미등록이면 doctor 가 「미지 이벤트 → 재생 불신」으로 판정해 --repair 가 복구를 거부한다; 과거 사고). 상태 무변이라 REPLAY_TYPES 에는 넣지 않았고, state 스키마도 넓히지 않았다 — 게이트가 심사 경로를 state 가 아니라 gate-submitted 이벤트에 두는 것과 같은 선택이다. (4) 정당한 갱신 — doctor --accept-policy 가 직전 해시를 prevHash 로 함께 남기며 재고정한다. 같은 해시면 저널을 늘리지 않는다(중복 이벤트는 잡음). 추가 결정: 해시 대상은 파싱한 «유효 정책»이 아니라 파일 바이트다 — loadConfig 는 HARNESS_LANG env 를 얹어 머신마다 값이 달라지고 YAML 파싱 실패는 조용히 기본값으로 떨어져 오히려 변경을 숨긴다. 대가는 lang·terse 같은 취향 항목 변경도 경고를 부른다는 것인데, 그건 보호 대상 파일이 실제로 바뀐 것이 맞고 정산은 한 명령이다.

### 테스트
688 → 709 tests green (28 → 29 파일, 신규 21건). tsc --noEmit 0 에러. npm run build 성공(core/dist 갱신 커밋 포함). 테스트가 실제로 무는지 증명: 신규 모듈이 없어 로드 실패하는 RED 를 먼저 확인했고, 구현 7곳을 하나씩 역돌연변이해 전건 RED 를 측정했다 — M1 drift 를 warning→issue 로(4건 실패) · M2 EVENT_TYPES 에서 policy-pinned 제거(4건, --repair 거부 회귀 포함) · M3 훅의 accept-policy 차단 제거(1건) · M4 init 의 베이스라인 고정 제거(7건) · M5 정책 범위에서 .harness/profile/ 제외(2건) · M6 gate-approved 의 policyHash 제거(1건) · M7 --accept-policy 재고정 무시(2건). env 접두 우회 테스트는 하드닝 전에 실제로 RED(expected false to be true)를 확인한 뒤 고쳤다.

### 바꾼 파일
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-4/core/src/policy.ts:1-151 (신규 — 정책 파일 목록·해시·저널 고정. 머리말에 설계 결정 3건의 근거)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-4/core/src/events.ts:37-41 (EVENT_TYPES 에 'policy-pinned' 등록 — 미등록이면 --repair 가 복구 거부)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-4/core/src/doctor.ts:85 (opts.acceptPolicy), :10-12 (warnings 축 정의 갱신), :208-262 (7b 정책 무결 — 수용·미고정 note·드리프트 warning)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-4/core/src/cli.ts:57 (import), :163 (init 이 pinPolicy(root,'init')), :186-192 (doctor --accept-policy 배선)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-4/core/src/gate.ts:34 (import), :200-205 (gate-approved 에 policyHash 스탬프 — 재고정 아님)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-4/core/src/hook.ts:28 (POLICY_FILES/POLICY_PREFIXES 를 policy.ts 에서 import — 목록 정본 일원화), :52 (HARNESS_CMD_RE 가 env 할당 건너뜀), :614-628 (에이전트의 doctor --accept-policy deny)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-4/core/src/help.ts:35-41 (doctor 인자·요약에 --accept-policy)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-4/core/test/policy.test.ts:1-267 (신규 21건)`

### 남긴 한계
1) 간접 실행 우회는 남는다 — `env harness doctor --accept-policy`, `sh -c '…'`, `bash -c "…"`, `xargs -I{} harness …` 는 실측 결과 여전히 allow 다. HARNESS_CMD_RE 가 «명령 위치»를 문자열로 인식하는 기존 한계이고 `phase set --force` 잠금과 같은 한 벌을 쓰므로, 닫으려면 두 잠금을 함께 다루는 별도 작업이 맞다(따옴표 안의 harness 를 잡으면 `echo "harness doctor --accept-policy" >> README.md` 같은 정당한 문서 쓰기가 과차단된다 — 이번 과차단 목록에 실제로 들어 있다). 다만 백스톱을 실측으로 확인했다: 재고정은 반드시 policy-pinned 이벤트를 남기고, 에이전트가 그 저널을 지우려는 시도(`sed -i '' '/policy-pinned/d' .harness/events.jsonl`)는 deny 다 — 우회해도 조용하지는 않다. 2) 해시가 파일 바이트라서 `lang: ko` 같은 취향 항목만 바꿔도 경고가 뜬다(의도된 절충, 근거는 decision 참조). 정산은 `harness doctor --accept-policy` 한 번. 3) doctor 의 exit code 는 여전히 0 이다 — warning 은 ok 를 내리지 않는다는 기존 계약을 지켰기 때문이다. CI 에서 정책 드리프트를 실패로 다루고 싶다면 warnings 를 읽어야 하며, `--strict` 류 플래그는 이번 범위 밖으로 두었다. 4) 번들 프로파일(profiles/)은 해시 대상이 아니다 — 플러그인 설치본이지 프로젝트 정책이 아니고, 프로젝트 로컬 .harness/profile/ 이 항상 우선한다. 설치본 변조는 다른 신뢰 경계의 문제다.

---

## 적대적 검증 (독립 에이전트)

VERDICT: substantially honest — every reported number reproduces to the digit — but the central security claim is materially overstated. The observability half is real; the enforcement half is not a lock.

## 1. Claimed measurements — all reproduced

Verified at `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-4` (`300a103`, parent `18df98f`, tree clean). Baseline built from a fresh detached worktree at `18df98f` (worktree `-3` was dirty — another agent — so I did not use it). All judgments via `python subprocess` + `json.dumps`.

| Claim | Result |
|---|---|
| Detection before: exit 0 · ok true · issues 0 · warnings 0 | reproduced |
| Detection after: warnings 1, `pinned 242a25805337 … ≠ current e6614194a6b9` | reproduced, hashes match exactly |
| `--accept-policy` note `242a25805337 → e6614194a6b9`, re-run warnings 0 | reproduced |
| journal: 2 × `policy-pinned` (`init` prev=None / `accept` prev=242a25805337) | reproduced |
| `doctor --repair` refused=false | reproduced |
| Duplicate accept adds no event ("already matches") | reproduced |
| Block 5/10 → 10/10, exactly the 5 named | reproduced |
| Overblock 0/17 before and after, on their list | reproduced |
| 709 tests / 29 files green; tsc 0 | reproduced |
| perf p50 61.8ms | 61.9ms. p95 70.7ms vs claimed 62.9 (noise; far under the 150ms gate) |

Extras that hold up: MCP `harness_doctor` hardcodes `repair`/`force` only (`core/src/mcp.ts:468`) — no `acceptPolicy` passthrough; `initHarness` throws when `.harness/` exists (`core/src/state.ts:41`), so re-running `init` cannot launder drift; journal `rm`/truncate all DENY; symlink-swapped `config.yaml` is detected; legacy projects get a note, not a warning; committed `core/dist` is byte-identical to a fresh `npm run build`.

## 2. Tests genuinely bite — claim understated

All 7 reverse-mutations go RED. Two bite harder than reported: M3 = 2 failures (claimed 1), M5 = 3 (claimed 2). Others exact: M1=4, M2=4, M4=7, M6=1, M7=2.

## 3. BLOCKER — the accept-policy lock opens with a newline

`core/src/hook.ts:52` — no `m` flag, and `\n` is not in `[;&|]`:

```js
const HARNESS_CMD_RE = /(^|[;&|]\s*|\(\s*)([A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(\S*\/)?harness(\s|$)/;
```

Measured ALLOW (deny never fires): `cd /tmp\nharness doctor --accept-policy` · `\nharness …` · `` echo `harness …` `` · `env HARNESS_LANG=ko harness …` · `sudo harness …` · `nohup harness …` · `bash -c "harness …"`

End-to-end exploit confirmed: drifted sandbox → warnings 1 → hook ALLOWs `cd <dir>\n<abs>/bin/harness doctor --accept-policy` → command runs → warnings 0. The agent silenced the detector — precisely the threat the report claims to close.

Second independent bypass: `node <abs>/core/dist/cli.js doctor --accept-policy` → ALLOW → warnings 1 → 0. The relative-path form appeared DENY only incidentally via the design-track source-write rule ("shell write target: core/dist/cli.js"), not the policy lock — it would not fire in the build track.

Fairness: the newline hole is inherited, not introduced — baseline `18df98f` also allows `echo hi\nharness phase set P7 --force` while denying the plain form. But the report's own standard ("`VAR=1` 한 조각으로 풀리는 것은 잠금이 아니다") condemns this equally; it hardened the narrower prefix and left the wider one untested.

Blast radius is bounded: path-based protections survive newline (`cd /tmp\necho x > .harness/config.yaml`, `sed -i`, `rm .harness/events.jsonl` all still DENY).

Fix verified:
```js
/(^|[;&|\n`]\s*|\(\s*)((env|sudo|nohup|time)\s+)*([A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(\S*\/)?harness(\s|$)/
```
→ all 6 bypasses DENY (including `newline+force`, closing the inherited SHIP-52 hole), block 10/10, overblock 0/17. Applied, measured, reverted; worktree left clean.

## 4. "과차단 0" holds only on their 17-item list

The 17 reproduce at 0/17 — but the list avoids the failure mode. 4 of 6 realistic commands are falsely denied:

- `harness doctor; echo "next: harness doctor --accept-policy"` → DENY
- `harness status && echo "see harness doctor --accept-policy"` → DENY
- `harness doctor | grep -- --accept-policy` → DENY
- `harness doctor > /dev/null; cat <<EOF >> notes.md … EOF` → DENY

Cause: the three regexes (`HARNESS_CMD_RE`, `/\bdoctor\b/`, `/--accept-policy\b/`) are tested independently against the whole string, so any real harness invocation plus a textual mention denies. This is wider than the existing convention: SHIP-52 tails on `--force(\s|$)` (`hook.ts:601`) whereas the new check tails on `\b`, so the quoted form baseline allows is now denied — measured both ways. It bites because doctor's own warning text tells the reader to run that exact command; an agent relaying the remediation right after running doctor is blocked. The passing allow-list item `echo 'run harness doctor --accept-policy' >> README.md` passes only because no harness command sits at command position — a coincidence, not coverage.

## 5. Design judgments — no objection

warning-not-issue, byte-hashing over effective policy, no re-pin at gate approval (stamp only), `EVENT_TYPES` registration without `REPLAY_TYPES`, and consolidating the SEC-69 block list into `core/src/policy.ts` are all sound and match the stated reasoning. The `--repair`-would-revert-the-user's-escape-hatch argument is correct.

## Bottom line

Ship the observability — it is real, well-tested, and honestly measured. Do not claim the agent path is blocked until `hook.ts:52` is widened; two one-line bypasses silence the detector end-to-end, and the fix is a character class.
