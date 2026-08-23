---
name: phase-p12-ship
description: Use when driving P12 (SHIP) of the harness ship track — re-rendering the final go/no-go with harness ship verdict, producing the release notes and the final checklist (with the RTM attached), and obtaining the last approval. Triggers - "let's ship", "go/no-go", "release notes", harness phase set P12, submitting the P12 gate, the ship checklist, the final verdict.
---

# P12 SHIP — the final go/no-go

## Overview

The last phase. What you do here is **re-render the verdict** — not looking again because you already
looked in P10 is the standard route to a shipping accident. The P11 deployment changed the state, so
the verdict is produced fresh.

**No shipping without `measured` evidence.** This is not guidance but a core rule —
`harness gate approve P12` is refused when the evidence is `claimed` or `code` (Iron Rule, §3-4).

## The final verdict — `harness ship verdict`

The machine checks four blocking conditions. Any one of them left standing is a NO-GO, and the reason
names **what to close and how**.

| Blocking condition | How to close it |
|---|---|
| An open `blocker` defect | Fix → **re-measure** → `harness ship defect update <id> --status verified` |
| A `blocker` stuck at `fixed` | "Fixed" is a claim. Run it again, observe it, then promote to `verified` |
| The P10 or P11 gate is not approved | Go back to that phase, submit the artifacts, and get the user's approval |
| A ship-track gate whose evidence is not `measured` | Attach real-run and measurement evidence and resubmit |
| A UX-referencing wave with no real-run capture | `harness evidence check <wave>` → leave headless 2x screenshots |

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
# → present .harness/packets/P12.md → wait for the user's final ship approval
harness doc approve DOC-P12
harness report hub                      # refresh the hub artifact — the user's bookmark points at the latest
```

Run `harness gate sweep` once before submitting — it catches artifacts tampered with after approval
**before** you ask for approval.

## Approval is a human's

**A human presses `harness gate approve P12`. An agent never approves on their behalf.** This is the
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
