---
name: phase-p9-verify
description: Use when driving P9 (VERIFY) of the harness build track — verifying each wave with tests, QA and visual comparison against the P4 baseline, looping back to P8 on failure, and using the RTM to catch anything designed-but-not-verified before the ship track. Triggers - "verify this wave", "QA the build", harness phase set P9, dispatching wave-verifier, visual comparison, harness evidence packet, harness design baseline, the P8 to P9 loop, harness report rtm, a wave that will not complete.
---

# P9 VERIFY — the wave is not done until it is verified, and the RTM says so

## Overview

Every wave gets **tests, QA, and — where it touches a `UX-x` node — visual verification** against the
P4 baseline. The verifier is the `wave-verifier` agent in a fresh context: the author does not verify
their own work. On failure the wave loops back to P8; on the third consecutive failure the user is
summoned. The phase closes only when the **RTM shows nothing designed-but-not-verified**.

## Procedure

1. **Verify against the acceptance criteria.** Dispatch `wave-verifier`. It re-runs the wave's tests
   and QA and renders a verdict (it does not implement — that is P8).
2. **Visual verification for UX waves.** The P4 canonical artboard is the baseline; the wave's real
   run is the candidate.
   ```bash
   harness design baseline UX-1 --png .harness/evidence/wave-001/ux-1-2x.png   # register the P9 baseline
   harness evidence packet --ux UX-1 --wave wave-001 --out .harness/evidence/wave-001/packet.html
   ```
   The packet places the P4 baseline (2x artboard) next to the wave's live capture, self-contained
   with the images embedded. A screen that does not change under a token swap is a hard-coded screen.
   Captures must be **2x (retina)** — a 1x or 1x1 image does not open the UX gate.
3. **Loop or complete.**
   ```bash
   harness loop attempt wave-001 --outcome fail --detail "cancel does not restore stock"   # → back to P8
   harness loop attempt wave-001 --outcome pass --detail "all acceptance criteria verified"
   ```
4. **Close the phase on the RTM.**
   ```bash
   harness report rtm     # catches designed-but-not-implemented / implemented-but-not-verified
   ```
   Every `F-x` must show implemented **and** verified before the build track ends. Then
   `harness phase set P10` opens the ship track.

## Gate

**Automatic — user summoned only on critical events.** P9 does not stop for a human unless a wave
fails three times in a row (the P8↔P9 loop threshold). Otherwise the RTM being clean is the gate.

## Pitfalls

- **Visual evidence is created directly, not by a harness command.** Put the 2x screenshot into
  `.harness/evidence/<wave-id>/` yourself — the hand-edit ban covers only core/policy files, so
  adding evidence there is not a breach. A text file or a 1x1 PNG will not open the UX gate.
- **A revised design node re-opens its waves.** If verification exposes a design defect, do not patch
  around it — `harness backtrack <phase> --reason "..."`, revise, and the referencing waves are
  marked STALE for re-verification. `harness node bump <id>` on a node propagates STALE the same way.
- **A wave that will not `complete`** almost always references a `UX-` node without real 2x evidence
  in its evidence directory. That is the gate doing its job.

## Companion skills (optional)

- `oh-my-claudecode:verifier` / `superpowers:verification-before-completion` — evidence-based
  completion checks and test adequacy, before you call a wave verified.
- `oh-my-claudecode:code-reviewer` — severity-rated review of the wave's diff as part of QA.
- `oh-my-claudecode:designer` — a designer's eye on the visual comparison (spacing, hierarchy, slop).
