---
name: king-wjang-harness
description: Use when a project needs the king-wjang-harness process discipline applied or driven — activating it in a repo (harness init), driving phases, the design ledger and waves, settling the turn log, and what to do when the PreToolUse/Stop hooks deny a source write or block a session from ending. Triggers - "put the harness on this", harness init, phase transitions, creating or settling a wave, node bump, doctor, handling a deny/block, an unsettled session end.
---

# Operating king-wjang-harness

## Overview

The manual for driving **design → build → ship** process state with the `harness` CLI. Enforcement
(blocking source writes in the design track, blocking an unsettled session end) **happens
automatically in the hooks** — this skill is about driving the CLI correctly and about what to do
when you hit a deny or a block.

**Iron rule: never hand-edit `.harness/state.json`, `events.jsonl`, or `design/ledger.yaml`.**
Change them only through `harness` commands (the journal is the source of truth; hand-editing makes
the state a lie — and the hook blocks it anyway). The same holds for the policy files
(`.harness/config.yaml`, `.harness/profile/`): they decide what the hook blocks, so only the user
changes them, in their own terminal.

## When to use / not

- **Use it**: putting the harness on a project, driving phases/nodes/waves, hitting a hook deny or
  block, inspecting state or recovering it.
- **Do not**: ordinary work in a project with no `.harness/` (the hooks stay completely silent) /
  developing **king-wjang-harness itself** (→ the `verify` skill).

## Bootstrapping

**The CLI ships with the plugin and is not on your PATH.** It lives at `<plugin root>/bin/harness` —
the same path the plugin's own hook wiring uses (`${CLAUDE_PLUGIN_ROOT}/bin/harness`, see
`hooks/hooks.json`). Call it by path, or put it on PATH once per shell:

```bash
export PATH="${CLAUDE_PLUGIN_ROOT}/bin:$PATH"   # then `harness ...` works as written below
```

Every `harness ...` line in this skill and in the phase skills assumes that. If `harness: command not
found` comes back, this is why — it is not a broken install.

Run this **in the target project's root**:

```bash
harness init                                     # creates .harness/ — the hooks go live from here
harness phase set P0                             # enter the design track
harness node upsert --id F-1 --title "feature"   # register a node in the design ledger
```

⚠ **Never run init in king-wjang-harness's own dev repo** — self-reference would block editing its
own source in the design track.

## Command quick reference

| Command | What it does |
|---|---|
| `harness init` | Creates the `.harness/` state store |
| `harness status` | Current state as JSON (tells you to init if it is not initialised) |
| `harness --help`, `harness <group> --help` | Command map, and the subcommands of one group |
| `harness phase set <P0..P12>` | Phase transition (gate approval required; `--force` is locked and human-only) |
| `harness node upsert --id <id> --title <title> [--status draft\|approved\|stale] [--parent <id>] [--anchor <a>]` | Upsert a design-ledger node (a re-run preserves version and unspecified fields) |
| `harness node bump <id>` | Revise a node → version++, status=stale, and STALE propagates to referencing waves |
| `harness wave create [--milestone <m>] [--goal <g>] [--refs <id,id>] [--accept <c,c>]` | Create a wave → **prints the wave id (wave-001…)** |
| `harness wave activate <wave-id>` | Activate a wave (updates state.activeWave) |
| `harness wave update "<what you did, what is next>"` | Settle the turn log (an empty log is rejected) |
| `harness wave complete` | Complete the wave (a UX node reference requires visual evidence — see Pitfalls) |
| `harness wave list` | Wave list as JSON |
| `harness gate submit <P> --paths <a,b> [--evidence claimed\|code\|measured]` / `harness gate approve <P>` | Submit artifacts for review / **human** approval |
| `harness backtrack <phase> --reason "<reason>"` / `harness backtrack clear` | Formally go back to design from the build/ship track / end the backtrack |
| `harness doctor [--repair [--force]] [--accept-policy]` | Integrity check and journal-replay recovery (JSON: `ok/repaired/refused/issues/warnings`). `--accept-policy` re-pins the policy baseline and needs `HARNESS_ACCEPT_POLICY=1` — the user runs it |

Hook events (`harness hook <session-start|pre-tool|post-tool|stop>`) are **invoked by the plugin
automatically** — you never type them (they always exit 0).

## Phase model

| Track | Phases | Character |
|---|---|---|
| Design | **P0–P6** | Implementation code and deploy-ish Bash are blocked. Writable: documents, assets, configuration, files *named* as tests, plus `.harness/`, the configured allow prefixes, and root `*.md` |
| Build | **P7–P9** | Source is free. Editing design documents directly still requires a backtrack |
| Ship | **P10–P12** | Same discipline as build, plus: no deploying without an approved gate |

## Handling a hook deny / block

| What you hit | Meaning | What to do |
|---|---|---|
| `deny: Implementation code cannot be written in the design track` | You tried to edit implementation in P0–P6 | Finish the design artifacts first (documents, `docs/`, root `*.md`), or if you really are in the build phase, get the gate approved and move to P7 |
| `deny: … can only be changed by harness commands` | You tried to hand-edit one of the core files | Do not hand-edit — change the state with the matching `harness` command |
| `deny: Design documents cannot be edited directly in the build/ship track` | You edited `.harness/design/` from the build or ship track | Backtrack formally first: `harness backtrack <phase> --reason "<reason>"` |
| `deny: Deploy-ish commands (…) cannot run in …` | A deploy-ish Bash command in the design or build track | Move to the ship track with an approved gate, then run it |
| `deny: \`phase set --force\` …` / `deny: \`doctor --accept-policy\` …` | An agent tried to open one of the human-only escape hatches | Report it to the user with the exact command; they run it themselves in their terminal |
| `block: The turn log for active wave … has not been updated` (the session cannot end) | You worked on the active wave but never settled it | `harness wave update "<what you did, what is next>"` and then end. If the turn really was trivial, report one line of reasoning and end |

## Pitfalls

- **The ids in `wave create --refs` must already exist in the ledger** — otherwise it is rejected.
  Register them first with `harness node upsert`. Separate several with commas and no spaces
  (`--refs F-1,F-2`).
- **The UX gate**: a wave that references a `UX-` prefixed node needs a **file of size > 0**
  (directories are ignored) in `.harness/evidence/<wave-id>/` before it will `complete`. No harness
  command puts evidence there — create the file (a screenshot, say) **directly** in that path. The
  hand-edit ban covers the core and policy files only, so adding evidence is not a breach of discipline.
- **A gate needs real artifacts.** `gate submit` rejects empty or placeholder files, a submission set
  under 80 non-whitespace characters in total, and content that already opened another gate.
- **All hook failures are absorbed as exit 0** — to notice that the harness has quietly gone dark,
  read `.harness/.runtime/hook-errors.log` and run `harness doctor`.
- **If state.json is detected as damaged**, the hook keeps working by replaying the journal and warns
  you → settle it with `harness doctor --repair`.
- **`$?` after a pipe is the last command's code** — check a CLI exit code without a pipe.

## Verification

When you are **developing king-wjang-harness itself** and need to verify a change, use the `verify`
skill (sandbox init and the hook-over-stdin recipe).
