---
name: phase-p7-skeleton
description: Use when driving P7 (SKELETON) of the harness build track — the first phase after the design gate, standing up the repo scaffold (CI, lint rule-pack, test harness, deploy skeleton) and converting every approved UX node into a Playwright scenario 1:1, so that an empty shell already passes deploy. Triggers - "start the build", "scaffold the repo", harness phase set P7, opening the build track, e2e spec generation from UX nodes, "green CI on an empty shell", wiring CI and lint.
---

# P7 SKELETON — the build track opens on an empty shell that already ships

## Overview

The **first phase of the build track**. It opens only after the P6 design gate is approved — until
then the hook blocks every source write. The job here is **not features**; it is the frame that makes
the later waves measurable: repo layout, CI, the lint rule-pack, the test harness, and a deploy
skeleton. The target state is deliberately blunt — **an empty shell that already goes green through
CI and deploy.** If the skeleton cannot ship, no wave built on it can either.

The second half of P7 is **traceability**: every approved `UX-x` node becomes a Playwright scenario,
one-to-one, so P9 has something concrete to verify against.

## Entering the track

```bash
harness gate approve P6        # human approval — this is what unlocks source writes
harness phase set P7           # refused until the P6 gate is approved
```

From here **source is free** — the design-track write block is lifted. Two rules still hold:
editing anything under `.harness/design/` requires a formal `harness backtrack`, and the core/policy
files are still hand-edit-banned (change them with `harness` commands).

## Procedure

1. **Scaffold to green.** Stand up the repo, CI, the lint rule-pack, the test harness, and the deploy
   skeleton. Commit a shell with no features and confirm CI is green and the deploy skeleton ships.
2. **Convert each UX node to a scenario, 1:1.** For every `UX-x` in the ledger:
   ```bash
   harness evidence spec UX-1 --out e2e/ux-1.spec.ts
   ```
   The core generates the spec from the node (headless + 2x discipline baked in — it does not drive
   a browser itself). One `UX-x` = one scenario file. `--out` must land inside the project; the
   command refuses a path that escapes the root or lands in the source tree during the design track.
3. **Wire the scenarios into CI** so they run on the skeleton (they will be red until P8 implements
   the screens — that is expected; P7 only proves they *run*).

## Gate

**Automatic — CI green.** There is no human approval gate between P7 and P8; the skeleton going
green through CI and deploy is the gate. Move on with `harness phase set P8` once it is.

## Pitfalls

- **The design-doc edit ban outlives the design track.** You are in the build track now, but a
  `.harness/design/` edit still returns `deny` — that is by design. Change design only through
  `harness backtrack <phase> --reason "..."`.
- **`harness evidence spec` needs the UX node to exist** in the ledger. If it does not, you skipped a
  P4 artifact — go back and register it, do not invent the scenario by hand.
- **A generated scenario is not a passing scenario.** P7 proves the harness runs; making it green is
  P8/P9. Do not delete a red skeleton spec to make CI pass.

## Companion skills (optional)

- `superpowers:test-driven-development` — the test harness you stand up here is what every later wave
  writes tests into first. Bringing the discipline in at P7 sets the rhythm for P8.
