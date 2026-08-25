---
name: phase-p8-implement
description: Use when driving P8 (IMPLEMENT) of the harness build track — implementing the design wave by wave, where each wave is one instruction sheet the core keeps accounts for, acceptance criteria come straight from the P3 features, and a wave-executor implements exactly one sheet without leaking outside it. Triggers - "implement this wave", "build the feature", harness phase set P8, harness wave create, dispatching wave-executor, the wave loop, loop brief, loop attempt, settling a wave, wave complete.
---

# P8 IMPLEMENT — one wave, one instruction sheet, accounts that stay honest

## Overview

Implementation happens **wave by wave**. A wave is a single instruction sheet the core keeps accounts
for — what changed, how, and because of which design node. That mapping is what makes the RTM and
STALE propagation hold. The acceptance criteria of a wave are **the acceptance criteria you wrote as
`F-x` features in P3** — they carry straight through with `--accept`.

The implementer is the `wave-executor` agent: it works only from the brief and **never touches
anything outside the sheet**. The moment it fixes neighbouring code "while it is in there", the
accounts become a lie. Verification is not its job — that is P9 (`wave-verifier`).

## Procedure

1. **Open a wave from the design nodes it implements.**
   ```bash
   harness wave create --goal "Create order end to end" --milestone M-1 \
     --refs F-1,F-2 --accept "a 200-row list renders within 1s,cancel restores stock"
   # → prints the wave id, e.g. wave-001
   ```
   `--goal` is required. The ids in `--refs` **must already exist** in the ledger (they were
   registered in design) or the wave is refused. Separate ids with commas and no spaces.
2. **Activate it and brief the executor.**
   ```bash
   harness wave activate wave-001
   harness loop brief wave-001     # the brief you hand to wave-executor
   ```
   Dispatch `wave-executor` with that brief. It implements exactly the sheet.
3. **Record each attempt.**
   ```bash
   harness loop attempt wave-001 --outcome pass --detail "list + cancel implemented, tests green"
   ```
   `--outcome` is `pass` or `fail`. Three consecutive failures on the same wave is a critical event
   that summons the user (P8↔P9 loop, default threshold 3).
4. **Settle the turn log, then complete.**
   ```bash
   harness wave update "implemented F-1/F-2; next: wire cancel into the order API"
   harness wave complete
   ```
   An empty turn log is rejected. A wave that references a `UX-` node will not `complete` without
   real visual evidence in `.harness/evidence/<wave-id>/` — that belongs to P9.

## Gate

**Automatic — wave acceptance criteria.** A wave closes on its own `--accept` criteria being met;
there is no separate human gate inside P8. The loop between P8 and P9 is where a wave earns
completion.

## Pitfalls

- **Not leaking outside the sheet is the executor's first job.** If a change does not trace to the
  wave's refs, it does not belong in the wave — open another wave for it.
- **`--refs` ids must pre-exist.** Register design nodes with `harness node upsert` first; you do not
  create `F-x` nodes in the build track.
- **`$?` after a pipe is the pipe's last code** — check a `harness` exit code without a pipe.

## Companion skills (optional)

- `superpowers:test-driven-development` — write the wave's acceptance criteria as failing tests
  first, then implement to green. The wave's `--accept` list is exactly the test list.
- `superpowers:executing-plans` / `oh-my-claudecode:executor` — for driving the implementation of a
  briefed wave without drifting outside its scope.
