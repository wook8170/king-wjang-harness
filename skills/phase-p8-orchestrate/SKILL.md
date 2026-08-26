---
name: phase-p8-orchestrate
description: Use when driving P8 (IMPLEMENT) of the harness build track for MULTIPLE INDEPENDENT waves in PARALLEL — implementing independent design waves concurrently in isolated git worktrees with difficulty-matched models and implementer≠verifier, while the orchestrator keeps the canonical .harness/ accounts sequentially. Triggers - "implement these waves in parallel", "parallel P8", "run the waves concurrently", multi-wave round, worktree-per-wave, difficulty-matched models. For a SINGLE wave, use phase-p8-implement (sequential) instead — this skill is over-designed for one wave.
---

# P8 ORCHESTRATE — slow work parallel, cheap work sequential

## Overview

The default P8 (`phase-p8-implement`) is sequential: the core's `state.activeWave` is singular, so one
wave runs create→activate→brief→execute→attempt→update→complete before the next. This skill runs
**independent** waves in parallel without ever writing the canonical `.harness/` journal concurrently.

**Principle: slow work parallel, cheap work sequential.** Implementation and testing (slow) run per
worktree in parallel. Accounting (fast — wave create/complete, journal, RTM, STALE; single writer of
the canonical `.harness/`) stays sequential in the orchestrator.

## Two premises — these are enforcement PRECONDITIONS, not facts

Worktree isolation only holds when the target repo has `.harness/` **gitignored**. The core documents
the opposite as its normal model (`wave.ts:116`, `loop.ts:16`: committed `.harness/` rewinds with the
branch), so parallel orchestration pins a different stance: **for parallel P8, `.harness/` is
local/gitignored.** This disagreement with the core comments is a **known tension** (spec §9), pinned
here on purpose so the two documents do not carry opposite claims silently.

## Step 0 — precondition gate (run FIRST, on entry)

Parallel isolation requires `.harness/` to be gitignored in the target repo. Check it before anything
else:

```bash
# PASS only if .harness/ is untracked AND gitignored.
git ls-files .harness            # must print NOTHING
grep -nE '(^|/)\.harness/?($|\*)' .gitignore   # must print a matching ignore line
```

If either check fails, **STOP and ask the user to decide** — do not proceed:
- **(a) Enable parallel mode:** `printf '\n.harness/\n' >> .gitignore && git rm -r --cached .harness && git commit -m "chore: gitignore .harness/ for parallel P8"` — then re-enter this skill.
- **(b) Stay sequential:** abandon parallel mode and use `phase-p8-implement` (one wave at a time), which is safe with a committed `.harness/`.

Present both options with the exact commands. Never auto-run option (a) — it changes the repo's
accounting model.

## Procedure

Produce a **wave plan** from the approved design (F/M/SCH nodes): each wave =
`{ goal, refs, accept, fileScope (§ decomposition), difficulty (see references/difficulty-model-rubric.md), round }`.
Split into topological **rounds** (dependency/conflict graph); contract/generated files go into a
lead **contract wave** (see decomposition below).

Then, for each round:

1. **[pre-create]** Create the round's waves with **sequential `harness wave create`** — this issues
   ids, pre-validates ghost refs, and writes each instruction sheet to disk. `create` leaves
   `activeWave` unchanged, so many `pending` waves coexist with no gate.
   ```bash
   harness wave create --goal "<goal>" --milestone <M> --refs <F-ids> --accept "<criteria>"
   # → prints the wave id, e.g. wave-001
   ```
2. **[brief]** Get each worker's brief from the core — never hand-write it (that is a security
   regression: the core brief carries nonce + sanitizeUntrusted, and `buildExecutorBrief` needs no
   active wave):
   ```bash
   harness loop brief <wave-id>            # executor brief
   harness loop brief <wave-id> --for verifier
   ```
3. **[parallel implement]** Dispatch one `wave-executor-parallel` per worktree, in parallel — pass the
   brief (in a quote fence), the worktree path, the file scope, and the rubric-chosen model. Use the
   Agent tool with `isolation:"worktree"` (see "Worktree mechanism" below). Workers run **no harness
   command** and log to `scratchpad/<waveId>.md`.
4. **[verify]** For each wave, dispatch a fresh `wave-verifier` into the **same worktree** to judge the
   acceptance criteria → pass/fail. Record verdicts as they arrive:
   ```bash
   harness loop attempt <wave-id> --outcome <pass|fail> --detail "<verifier summary>"
   ```
5. **[merge]** Merge each passing wave's branch onto the integration branch `integration/p8-<milestone>`.
6. **[integration verify]** After all merges for the round, **before any settling**, run the whole
   suite once on the integration branch (see Merge strategy). A failure is treated as a conflict.
7. **[post-settle]** Sequentially, per wave: `activate → copy evidence → wave update "<turn log>" →
   complete`. (Evidence order matters: `create` refuses if evidence files already exist, so the order
   is create → copy → complete.)
   ```bash
   harness wave activate <wave-id>
   # copy the wave's evidence into place
   harness wave update "<what the round did for this wave>"
   harness wave complete
   ```

This single ordering makes brief security, ghost-ref timing, evidence-id consistency, and crash
resumption all hold, and keeps **core diff 0**.

## Wave decomposition & independence (§3)

- **File scope** is derived (the core has no path-scope field): use `02-module.md` (module
  boundaries), `05-contract` (files SCH/API touch), and `.codesight` (high-impact files / dep graph).
- **Parallel-safe ⟺ file scopes disjoint AND no output dependency.** Overlap or dependency ⇒ serialize
  into different rounds.
- **Contract/generated-file class (structural constant):** files that everything funnels into
  (`schema.prisma`, ordered migration dirs, `package-lock.json`, barrels/`index.ts`) defeat
  parallelism. Handle them as a lead **contract wave** (alone in its round); regenerate lock files
  mechanically by re-running `npm install` at merge time, never by hand-editing.
- **Rounds:** topological sort of the dependency graph. Disjoint within a round = parallel; rounds are
  sequential (a round's integrated result is the next round's base). Cycles/ambiguity ⇒ **conservative
  serialization**.

## Merge & conflict strategy (§5)

- **Integration branch, not main:** rounds stack on `integration/p8-<milestone>`; the milestone goes to
  main only when fully green.
- **Post-merge integration verification:** disjoint scopes still allow *semantic* conflicts (A changes
  a helper contract, B adds a caller — each green alone, red together). Catch them with the full-suite
  run per round (step 6). Failure = conflict.
- **Conflict handling:** lock files → mechanical regeneration; otherwise **re-dispatch** the wave onto
  the updated base. **Never hand-edit a merge resolution** — that diff lands in no ledger and breaks
  P8's change↔node mapping. If re-dispatch also fails, merge the two waves and serialize.
- **3-strike:** a wave failing 3 times in a row summons the user. **Dependent downstream waves are held;
  independent rounds proceed.**

## Trust boundary (§6.1)

The `hooks/hooks.json` PreToolUse/PostToolUse matchers are **session-global** — they fire on subagent
tool calls too, and the guarded root is `CLAUDE_PROJECT_DIR ?? cwd` = the canonical root. So a worker
in any worktree is guarded against writing the canonical `.harness/**` exactly as today. Remaining
limit (state it): a worker's **source** writes are allowed on the build track, so a worker can reach
the canonical source tree — this is contained by **file-scope discipline in the prompt only**.

## Worktree mechanism (§6.3)

Use the Agent tool's `isolation:"worktree"` (native worktree — do not hand-run `git worktree add`).
The verifier must run in the **same** worktree as its executor: the executor reports its worktree path,
and the verifier is dispatched (without its own isolation) into that path. Confirm/clean the
"modified worktrees persist" lifecycle as an operations note.

## Skill relationship (§6.4)

This skill orchestrates `phase-p8-implement` from above (it performs the same per-wave settling
procedure in the accounting steps). Triggers are exclusive: this skill fires only on parallel /
multi-wave signals; a single wave falls back to `phase-p8-implement`. Parallel dispatch itself uses
`superpowers:dispatching-parallel-agents`.
