---
name: phase-p3-feature
description: Use when driving P3 (FEATURE) of the harness design track — settling per-feature user stories, scenarios and acceptance criteria as F-x nodes and putting them up for the gate. Triggers - "let's write the feature spec", harness phase set P3, submitting the P3 gate, 03-feature.md, registering F-x nodes, user stories, acceptance criteria, RTM rows.
---

# P3 FEATURE — feature specification

## Overview

Write what the modules (`M-x`) actually do for someone, one **feature** (`F-x`) at a time. The
artifact is `.harness/design/03-feature.md`.

**An `F-x` is a row of the RTM (requirements traceability matrix).** One feature = one node = one RTM
line. A feature without an id is not tracked, and an untracked feature disappears from the
implementation-coverage verdict. That id is exactly what lets `harness report rtm` catch "designed
but not implemented / implemented but not verified".

## The minimum a feature carries

| Item | Rule |
|---|---|
| id | `F-1`, `F-2`… sequential. Never reused, never renumbered |
| parent | `--parent M-x` (its module). A feature without a module cannot exist |
| user story | `As a <role>, in order to <purpose>, I <action>` — the role must be a target from P0 `C-2` |
| scenarios | The happy path plus **at least one exception path**. A spec without exceptions is half a spec |
| acceptance criteria | N verifiable statements. Each one goes straight into a P8 wave's `--accept` |
| priority | The input to milestone assignment (milestones are fixed once P6 passes) |

**How to write an acceptance criterion**: "it is fast" ✗ / "a 200-row list renders within 1s" ○.
If two people can disagree about the verdict, it is not a criterion yet.

## Procedure

```bash
harness node upsert --id F-1 --title "Create order" --parent M-1 --anchor "03-feature.md#f-1-create-order"
harness node upsert --id F-2 --title "Cancel order" --parent M-1 --anchor "03-feature.md#f-2-cancel-order"
harness doc upsert --id DOC-P3 --path .harness/design/03-feature.md --phase P3 --refs F-1,F-2,F-3
harness doc url DOC-P3 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P3          # refused without artifact_url
harness gate submit P3 --paths .harness/design/03-feature.md --evidence claimed
# → present .harness/packets/P3.md → wait for the user's approval
harness doc approve DOC-P3
harness phase set P4
```

`--refs` is comma-separated, **with no spaces**. If there are many features, list them all — the
ledger-node table in the review packet *is* the scope of the review, and a node left out is a node
never reviewed.

## Approval is a human's

**An agent does not run `harness gate approve P3`.** Summarise the feature count, the number of
acceptance criteria, and any missing exception paths, then wait for the user's approval.

## Pitfalls

- **Do not leave acceptance criteria blank "for later".** A P8 wave takes these sentences verbatim
  through `harness wave create --accept`. Leave them empty and the wave starts with no definition of
  what "done" satisfies.
- **Merging or splitting a feature is a revision.** To split `F-3` in two after approval:
  `harness backtrack P3 --reason "<reason>"` → edit → `harness node bump F-3` (STALE propagates to
  referencing waves) → resubmit.
- **`node bump` reports a partial failure as exit 1** — if you see "STALE propagation incomplete",
  check those waves by hand. Let it slide and a wave implemented against a stale design survives.
- **UX belongs to P4.** Do not settle screens or components here — `UX-x` are P4 nodes. P3 goes as far
  as "what"; "how it looks" is P4.

## Companion skills (optional)

These are separate skill packages, not part of this harness. The `king-wjang-harness` driver checks
for them and offers to install any that are missing.

- `product-management:write-spec` — shape each feature into a spec with verifiable acceptance criteria.
- `superpowers:writing-plans` — the acceptance criteria you settle here become the plan the P8 waves execute.
