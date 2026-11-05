---
name: phase-p9-verify
description: Use when driving P9 (VERIFY) of the harness build track — verifying each wave with tests, QA and visual comparison against the P4 baseline, looping back to P8 on failure, and using the RTM to catch anything designed-but-not-verified before the ship track. The build track closes only after a post-implementation adversarial conformance audit (design-auditor, implementation conformance lens) reaches HIGH 0. Triggers - "verify this wave", "conformance audit", "QA the build", harness phase set P9, dispatching wave-verifier, visual comparison, harness evidence packet, harness design baseline, the P8 to P9 loop, harness report rtm, a wave that will not complete.
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
   Every `F-x` must show implemented **and** verified before the build track ends.
5. **Adversarial conformance audit of the implementation.** Dispatch a fresh `design-auditor` with
   the **implementation conformance** lens (see P6, "After implementation"). It reads the changed code
   against the approved design and locates every design invariant as `file:line`, holds or breaks,
   and ends with `HIGH N`. Write it to `.harness/audit/conformance-rN.md`. A HIGH loops back to P8
   (or, when the design itself is wrong, `harness backtrack`); re-audit in a new round with a
   reconciliation table, as in P6. Only at `HIGH 0` does `harness phase set P10` open the ship track,
   and the report goes to P10 as a mandatory input.

## Gate

**Automatic — user summoned only on critical events.** P9 does not stop for a human unless a wave
fails three times in a row (the P8↔P9 loop threshold). Otherwise the RTM being clean is the gate.

## Pitfalls

- **Wave verification is not the conformance audit.** `wave-verifier` checks one wave's acceptance
  criteria; the conformance audit reads the whole change against the design's invariants. An invariant
  that spans waves (a permission rule, a count that must agree on two screens) is visible only to the second.

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
- `lanekeeper:quality-ux-adversarial` — the pre-ship adversarial UX review (if the lanekeeper plugin (formerly wb) is absent, apply the same criteria through the project's own brief).

## Writing rule — four forms to avoid in Korean prose

Every Korean sentence you write (design documents, reports, findings, replies, screen text) avoids four hard-to-read forms:
(1) Missing connecting words — when sentences relate by reason, result, contrast, order or condition, say so ("so", "but", "only if").
(2) Over-personified things — do not give code or features human actions (swallow, chase its tail, wake up); write what actually happens.
(3) Three or more nouns in a row without particles — unpack them. Fixed names such as product names are exempt.
(4) Paired words kept far apart — do not put a long phrase between subject and verb or between a modifier and what it modifies; split the sentence.
Source: `~/.claude/rules/REPORT_WRITING_RULES.md` section 15 and the `readable-korean` skill, when present.
