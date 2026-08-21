# FEAT-73 — 워크플로 구현 보고와 적대적 검증

**커밋** `2cdfb7d — fix(hook): FEAT-73 — 없는 명령을 첫 지시로 주지 않는다`

## 구현 보고

### 요약
[FEAT-73] SessionStart 첫 지시가 이 플러그인에 없는 `/remote-control` 을 무조건 가리키던 문제를 고쳤다. 측정한 전제: `commands/` 디렉토리 False, `plugin.json` 의 commands 키 False — 그 명령은 이 플러그인이 제공하지 않는다. 그런데 `remote_control` 기본 on 이라 매 세션 「지시(1): 첫 행동으로 /remote-control 을 실행하라」가 나갔고, 없는 환경에서는 매 세션의 첫 행동이 실패하면서 하네스가 실제로 보장하는 일(활성 웨이브 이어받기·정산)이 뒤로 밀렸다.

바꾼 것: 번호 붙은 지시 목록에는 하네스가 보장하는 것만 넣고(첫 지시 = 활성 웨이브 이어받기), Remote Control 은 주입 맨 뒤의 조건부 안내 한 줄로 내렸다 — 「있으면 실행, 없으면 건너뛴다」 + 스펙 §3-6a 열화 경로(푸시·아티팩트)를 그 자리에서 명시 + 끄는 법(`remote_control: false`) 안내. 기본값 on 과 요구 15 는 유지했다.

부수 갱신: 스펙 §3-6a 에 개정 블록을 넣어 「첫 행동으로 지시」와 어긋난다는 사실과 근거를 남겼고, 결함 대장 FEAT-73 행을 open → verified 로 갱신했다.

### 판단 근거
「없는 명령을 첫 지시로 주는 것이 옳은가」 → 옳지 않다. 다만 고치는 방향 4후보 중 3개를 근거를 대고 버렸다.

- **명령 존재를 확인하고 있을 때만 지시** — 불가. 슬래시 명령은 클라이언트 내장·`~/.claude/commands/`·다른 플러그인에서 오고, 훅 서브프로세스가 그 목록을 조회할 방법이 없다. 파일시스템 탐침은 **거짓 음성**(실제로 있는데 없다고 판정)을 낳아 동작하는 채널을 죽인다 — 이 제품 기준으로 과차단이다.
- **기본값을 off 로** — 버렸다. 있는 환경에서는 실제로 동작하는 채널이고 훅은 어느 쪽인지 모른다. 모르는 것을 이유로 끄면 요구 15가 조용히 사라진다. 결함의 본질은 「기능이 틀렸다」가 아니라 「지시가 사실과 다르다」였다.
- **이 플러그인이 명령을 제공** — 불가. Remote Control 은 클라이언트 기능이라 하네스가 구현할 수 없다. 흉내만 낸 스텁 명령은 지금보다 더 큰 거짓말이다.
- **채택: 문구 완화 + 강등** — 스펙 §3-6a 스스로 활성화를 「모델 지시 기반(하드 강제 아님)」이라 적고 열화 경로(푸시·아티팩트)를 명시했다. 즉 조건부 안내는 스펙 위반이 아니라 스펙의 자기 문장에 충실한 구현이다. 여기에 **강등**을 더한 이유: 티켓이 지적한 것은 「첫 지시」라는 위치 자체이고, 문구만 고치면 없을 수 있는 것이 여전히 지시(1) 을 차지한다. 불변식을 하나 세웠다 — **번호 붙은 지시 목록에는 하네스가 보장하는 것만 들어간다.**

**스펙과 어긋나는 지점을 명시**: §3-6a 의 「SessionStart 주입이 Remote Control 활성화를 첫 행동으로 지시한다」는 이 플러그인이 그 명령을 제공한다는 전제 위에서만 옳았고, 그 전제가 거짓이다. 스펙이 틀린 쪽이라 판단해 §3-6a 에 개정 블록을 넣어 사실·근거·유지한 것(기본값 on, 요구 15)을 남겼다 — 그래야 다음 감사가 같은 결함을 반대 방향으로 다시 제기하지 않는다.

### 테스트
688 → 695 (+7, 전건 green, 28 파일). `npm run check` tsc 0. `npm run build` 성공(dist 재빌드 커밋 포함).

TDD 확인: 새 테스트 7건을 먼저 넣고 RED 를 실측했다 — `7 failed | 18 passed (25)`. 특히 과차단 대조군 테스트는 수정 전 상태에서 지시 번호가 2·3 → 1·2 로 밀리는 것을 잡아내며 실패했고(단순 문자열 존재 확인이 아니라 실제로 문다), 구현 후 7건 전부 GREEN.

추가한 테스트(core/test/hook-session-start.test.ts): 번호 붙은 지시가 아님 · 첫 지시는 활성 웨이브 · 웨이브 없어도 지시(1) 을 차지하지 않음 · 조건부 문구(ko) · 조건부 문구(en, 한글 0) · 안내는 지시 목록 뒤 · 과차단 대조군(on/off 단일 줄 diff).

### 바꾼 파일
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-5/core/src/hook.ts:239-246 (첫 지시 자리에서 제거 + 왜 탐지가 불가한지 주석)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-5/core/src/hook.ts:307-322 (주입 맨 뒤 조건부 안내 1줄, en/ko)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-5/core/test/hook-session-start.test.ts:281-368 (회귀 테스트 7건 · 과차단 대조군 포함)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-5/docs/superpowers/specs/2026-08-20-king-harness-design.md:188-201 (§3-6a 개정 블록)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-5/docs/release-readiness/2026-08-21/ledger.md:77 (FEAT-73 open → verified)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-5/core/dist/cli.js (재빌드)`
- `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-5/core/dist/mcp.js (재빌드)`

### 남긴 한계
1. **README 4종에 `remote_control` 이 한 번도 안 나온다** (en/ko/ja/zh 전부 grep 0건). 매 세션 주입되는 설정인데 문서 표면이 없다 — 이번엔 안내 줄 안에 끄는 법을 적어 급한 불만 껐다. config 키 전체를 문서화하는 건 별도 과제(범위 밖이라 손대지 않음).

2. **`docs/release-readiness/2026-08-21/00-summary.md:25` 의 open 목록은 갱신하지 않았다.** 그 문서는 라운드 01 판정 스냅샷이고 UX-71·I18N-72·OPS-74 등 다른 결함을 병렬 에이전트가 고치는 중일 수 있어, 결함별 status 의 정본인 ledger.md 만 갱신했다. 라운드 종합 시 오케스트레이터가 한 번에 반영하는 편이 안전하다.

3. **효과는 「지시가 정직해졌다」까지다.** `/remote-control` 이 실제로 있는지는 여전히 아무도 모른다 — 훅이 알 방법이 구조적으로 없다. 안내를 읽은 모델이 없는 명령을 한 번 시도할 가능성은 남지만, 「없으면 건너뛴다」와 폴백 채널을 같은 줄에 줬으므로 실패가 막다른 길이 되지는 않는다.

4. **`progress.md` 는 갱신하지 않았다.** 격리 worktree 의 서브에이전트이고 80KB 공유 파일이라 병렬 에이전트와 충돌한다 — 핸드오프 갱신은 부모 세션 몫이다.

5. 스펙 §3-6a 개정은 **스펙 본문을 지우지 않고 개정 블록을 덧댔다.** 원문과 개정이 함께 읽히므로, 다음 리뷰어가 「본문은 첫 행동이라 했는데?」로 걸릴 수 있다. 본문 자체를 다시 쓸지는 스펙 소유자의 판단.

---

## 적대적 검증 (독립 에이전트)

[VERDICT: CONFIRMED — report accurate, no overstatement]

## 1. Claimed measurements reproduce — verbatim

Worktree: `/Volumes/WorkSpace/0200_Dev/king-wjang-harness/.claude/worktrees/wf_28bae004-b27-5` @ `2cdfb7d`.

Built parent `hook.ts` and fixed `hook.ts`, drove the real CLI (`bin/harness hook session-start`) via python subprocess + `json.dumps`. Before/after tables are exact in both languages:
- BEFORE ko: `지시(1): 첫 행동으로 /remote-control …` / `지시(2)` wave / `지시(3)` settle
- AFTER ko: `지시(1)` wave / `지시(2)` settle / trailing `선택: …` line

Premise verified independently: no `commands/` dir, no `commands` key in `plugin.json` — the plugin genuinely does not ship `/remote-control`.

Their `verify.py`: **41 PASS, 0 failures**. Test counts by checkout-and-run: parent **688**, fix **695** (+7, 28 files). `npm run check` tsc 0. Rebuild is **byte-identical to committed dist** (`git status` clean).

## 2. Over-blocking: zero increase — proven, not asserted

Snapshotted 11 scenarios on both builds (normal wave, damaged sheet, no wave, corrupted `state.json`, backtrack, 16-probe pre-tool matrix, Stop hook, bare project), normalized timestamps/nonces, diffed:

- `pretool` (5 deny + 11 allow probes), `stop`, `bare` → **byte-identical** before/after
- All 8 changed scenarios: "non-RC/non-renumber diff lines = **0**"

My opt-out control is stricter than theirs — theirs overwrites `config.yaml` wholesale and leans on `HARNESS_LANG`; I flipped only the `remote_control` line keeping `lang`/`profile`. Still pure one-line diff, 0 mentions off / 1 on.

## 3. Tests genuinely bite

Reverting `hook.ts` reproduces claimed RED **exactly**: `7 failed | 18 passed (25)`. Control test fails on real renumbering (`지시(2)`→`지시(1)`), not string presence. Two partial-fix mutants they did not test:
- **Mutant A** (new wording, still numbered instruction) → caught by 5 tests
- **Mutant B** (demoted to tail, old unconditional wording) → caught by 2 tests

Both halves independently pinned.

## 4. Boundary conditions — 3 nits, no defects

- **`report.html` stale**: still lists FEAT-73 `open` at `hook.ts:215` while `ledger.md` says `verified`. **Not a regression** — SEC-69/SEC-70 already mismatched at parent. Pre-existing round-wide debt; the report's ledger claim is true as written.
- **"첫 지시 = 활성 웨이브" holds only at normal usage tier.** With `.harness/.runtime/usage-tier` = `reduce`/`settle-every-turn`/`final-handoff`, 지시(1) is token-guard guidance. Numbering stays `[1,2,3]`, RC stays last, count 1 — the actual invariant ("번호 붙은 지시에는 하네스가 보장하는 것만") is intact; only the summary's narrower phrasing is imprecise. Test name over-specific but cannot flake (fresh tmp roots).
- **Optional line is now the final line**, landing after the `⚠ 역행 진행 중` warning — least important line occupies the recency slot.

## Self-correction

My first `grep` for the Korean string in `core/dist/cli.js` returned 0 and looked like a stale build. My instrument was wrong — tsup escapes Korean as `\uXXXX`. Dist carries the fix correctly. (Also: a sibling agent overwrote my `after.json` in the shared scratchpad; re-ran the decisive comparison in an isolated dir — same result.)

Worktree restored clean at `2cdfb7d`. Files: `core/src/hook.ts:236-243,305-322` · `core/test/hook-session-start.test.ts:255-343` · scripts in `/private/tmp/claude-501/-Volumes-WorkSpace-0200-Dev-king-wjang-harness/6ad77aea-e19e-4c7b-840f-a5e3f4ca4d65/scratchpad/advF73/`
