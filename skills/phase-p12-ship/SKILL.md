---
name: phase-p12-ship
description: Use when driving P12 (SHIP) of the harness ship track — re-rendering the final go/no-go with harness ship verdict, producing the release notes and the final checklist (with the RTM attached), and obtaining the last approval. The verdict takes the two adversarial reviews from P10 as mandatory inputs and re-checks screens changed since then. Triggers - "let's ship", "go/no-go", "release notes", harness phase set P12, submitting the P12 gate, the ship checklist, the final verdict.
---

# P12 SHIP — the final go/no-go

## Overview

The last phase. What you do here is **re-render the verdict** — not looking again because you already
looked in P10 is the standard route to a shipping accident. The P11 deployment changed the state, so
the verdict is produced fresh.

**No shipping without `measured` evidence.** This is not guidance but a core rule —
`harness gate approve P12` is refused when the evidence is `claimed` or `code` (Iron Rule, §3-4).

## The final verdict — `harness ship verdict`

The machine checks the blocking conditions below. Any one of them left standing is a NO-GO, and the reason
names **what to close and how**.

| Blocking condition | How to close it |
|---|---|
| An open `blocker` or `high` defect | Fix → **re-measure** → `harness ship defect update <id> --status verified` |
| A `blocker` or `high` stuck at `fixed` | "Fixed" is a claim. Run it again, observe it, then promote to `verified` |
| The P10 or P11 gate is not approved | Go back to that phase, submit the artifacts, and get the user's approval |
| A ship-track gate whose evidence is not `measured` | Attach real-run and measurement evidence and resubmit |
| A UX-referencing wave with no real-run capture | `harness evidence check <wave>` → leave headless 2x screenshots |
| The release security check (`release-security-check` in the profile) has no pass on the current commit, or the profile requires it and no command is set | `harness ship security` — it runs the project's gate once and records it; a commit that already passed is not run again. P12 approval is refused until it passes |

**Two adversarial inputs, checked before the verdict.** The machine verdict above blocks open or
unverified blocker and high defects, but it cannot see a review that was never run. Before running
`harness ship verdict`, confirm:

- the implementation conformance audit (`.harness/audit/conformance-rN.md`) of the shipping commit ends
  with `HIGH 0` — if code changed after P10 (ledger fixes, P11 changes), dispatch a fresh round on the change;
- the changed-screen UX adversarial review (nine axes, persona task scenarios, design system visual
  comparison, headless 2x in an isolated stack) covers every screen changed since it ran — re-run it on
  screens changed after P10;
- no `UXA-*` or `CONF-*` defect of severity `blocker` or `high` is `open` or `fixed`.

Any of these unmet is a NO-GO, reported the same way as a machine reason: what is missing and how to
close it. Screen changes those reviews ask for go to the user first, as in P10.

The verdict is decided from what is on disk alone — the same state gives the same verdict. **There is
no path around a NO-GO.** To pass the verdict, change the state; do not change the verdict.

`deferred` is not a blocking condition — **which is exactly why it is dangerous.** Move a blocker to
`deferred` and the verdict flips to GO. That has not closed the defect, it has **handed it to a
person**, so stand in front of the approver with the reason (see Pitfalls).

## The final checklist

`harness ship checklist` renders the verdict, the defect-ledger summary, the deployment records, and
**the full RTM** on one page. Attach the RTM as it is rather than transcribing a summary (§3-7) — the
moment you transcribe it, two documents diverge, and the looser one gets read. Uncovered stretches of
the RTM are **not a NO-GO reason but information the approver must see**: a person decides what it
means that this release has requirements designed but not implemented.

## Release notes

| Section | Content |
|---|---|
| What shipped | Per requirement (F-x) in this deployment. Must match the RTM's deployment column |
| Known limitations | Every `deferred` defect plus its reason. Hide them and the next person rediscovers the same thing |
| Not examined | The axes left out of the verdict, and why. Leaving one out is itself information |
| Adversarial reviews | `HIGH N` of the last conformance round; UX adversarial counts by severity and axis, with the link to the findings artifact (table and captures) |
| Deployment coordinates | Version · commit SHA · environment (exactly as `harness ship deploy` recorded them) |

## Procedure

```bash
harness ship verdict                    # re-render the verdict — stop here on a NO-GO
harness ship checklist > .harness/ship/release-checklist.md
# → write the release notes (.harness/ship/release-notes.md)
harness doc upsert --id DOC-P12 --path .harness/ship/release-checklist.md --phase P12 --refs F-12,UX-7
harness doc url DOC-P12 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P12              # refused without artifact_url
harness gate submit P12 --evidence measured \
  --paths .harness/ship/release-checklist.md,.harness/ship/release-notes.md,.harness/ship/defects.yaml
# → present .harness/packets/P12.md → raise the dialog for the final ship approval
harness doc approve DOC-P12
harness report hub                      # refresh the hub artifact — the user's bookmark points at the latest
```

Run `harness gate sweep` once before submitting — it catches artifacts tampered with after approval
**before** you ask for approval.

## Approval is a human's

**A human answers the dialog for P12. An agent never approves on their behalf.** Run `harness gate approve P12` alone on one line from the main session: the hook raises a confirmation dialog and the user answers it. Do not ask the user to type anything; only if the hook refuses the dialog, the user types `/king-wjang-harness:approve P12`. Once it is allowed, run `harness phase set <next>` and carry on without asking again. This is the
"ship" button and it is the most expensive one to undo. Present the verdict, the deferred list, and
the uncovered stretches of the RTM exactly as they are, and let the user approve themselves. A GO is
not the approval — it is **the input to the approval review**.

## Pitfalls

- **Do not reuse the P10 verdict.** The deployment changed the state. Shipping without re-rendering it
  approves today with yesterday's observation.
- **Do not summarise a NO-GO reason.** A one-liner like "not ready" tells the next person nothing. Show
  the user the reason the verdict produced, verbatim.
- **A NO-GO flipped by a deferral is not a GO.** Move a blocker to `deferred` instead of fixing it and
  the verdict passes while the defect ships. The core refuses a deferral without a reason
  (`--defer-reason` is mandatory) and **keeps deferred items on the checklist** — what is built to be
  unhideable is meant not to be hidden. A deferral is not "we fixed it", it is the request
  **"we intend to ship without fixing this, for this reason"**.
- **Do not leave `deferred` items out of the release notes.** A limitation you do not write down stops
  being a limitation and becomes an incident.
- **The checklist is only an artifact once published (requirement 16).** A document that exists only
  locally cannot go up for the gate — `harness doc submit` refuses a missing artifact_url.
- **A finding after shipping is a new cycle.** If something needs fixing after the P12 approval,
  backtrack formally with `harness backtrack`. Quietly editing an approved artifact invalidates the
  gate automatically (§4-3).

## Companion skills (optional)

These are separate skill packages, not part of this harness. The `king-wjang-harness` driver checks
for them and offers to install any that are missing.

- `superpowers:finishing-a-development-branch` — the structured merge / PR / cleanup options once the go verdict is in.

## Writing rule — four forms to avoid in Korean prose

Every Korean sentence you write (design documents, reports, findings, replies, screen text) avoids four hard-to-read forms:
(1) Missing connecting words — when sentences relate by reason, result, contrast, order or condition, say so ("so", "but", "only if").
(2) Over-personified things — do not give code or features human actions (swallow, chase its tail, wake up); write what actually happens.
(3) Three or more nouns in a row without particles — unpack them. Fixed names such as product names are exempt.
(4) Paired words kept far apart — do not put a long phrase between subject and verb or between a modifier and what it modifies; split the sentence.
Source: `~/.claude/rules/REPORT_WRITING_RULES.md` section 15 and the `readable-korean` skill, when present.
