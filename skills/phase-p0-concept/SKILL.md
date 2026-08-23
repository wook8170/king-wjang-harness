---
name: phase-p0-concept
description: Use when driving P0 (CONCEPT) of the harness design track — settling the product concept, vision, target users and success metrics through conversation with the user plus supplied background material, and putting it up for the gate. Triggers - "let's nail the concept", harness phase set P0, submitting the P0 gate, 00-concept.md, registering C-x nodes, analysing attachments.
---

# P0 CONCEPT — settling the product concept

## Overview

The first phase of the design track. **The conversation with the user is the primary source**;
background material and attachments are supporting evidence. There is one artifact,
`.harness/design/00-concept.md`, and the ledger nodes are `C-x`.

P0 is not the place to imagine. What the user has not said, you **ask**. A concept filled in with
guesses comes back in full as "ambiguity" in the P6 audit.

## Artifact structure (`00-concept.md`)

| Section | Node | Must contain |
|---|---|---|
| Vision / problem | `C-1` | Whose pain, and which pain, this removes. One paragraph. |
| Target users | `C-2` | Primary and secondary users, usage context, assumptions about scale |
| Value proposition | `C-3` | What is different from the alternatives (competitors, the status quo) |
| Success metrics | `C-4` | Measurable numbers. "It gets better" is banned |
| Scope / non-scope | `C-5` | Write down **what you are not building** — the input to the P1 domain boundary |
| Constraints | `C-6` | Scale, traffic, team, budget, operational capacity, regulation → **the input to the P2 ADR recommendation** |

Each section heading becomes the node's `--anchor`. Write the constraints (`C-6`) carelessly and the
P2 technology-stack ADR turns into a taste argument with no grounds.

## Using researcher

Hand attachments, background material, and competitor research to the `researcher` subagent
(read-only, sonnet). When you do, state **what you want established** — "have a look" comes back as
a summary.

```
researcher: from the 3 attachments extract (a) the user types stated, (b) the numeric targets,
(c) the constraints mentioned, each with file:line evidence. Report anything absent from the
documents as "absent".
```

## Procedure

```bash
# 1. Nodes first — if a document references an id the ledger does not have, the review packet flags a blocker
harness node upsert --id C-1 --title "Vision / problem" --anchor "00-concept.md#vision--problem"
# 2. Register the document in the registry
harness doc upsert --id DOC-P0 --path .harness/design/00-concept.md --phase P0 \
  --refs C-1,C-2,C-3,C-4,C-5,C-6
# 3. Publish as a claude.ai artifact → register the URL (submit is refused without artifact_url)
harness doc url DOC-P0 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P0
# 4. Submit the gate — the review packet is generated at .harness/packets/P0.md
harness gate submit P0 --paths .harness/design/00-concept.md --evidence claimed
# 5. User approval — see "Approval is a human's" below
# 6. After approval
harness doc approve DOC-P0
harness phase set P1
```

## Approval is a human's

**Never run `harness gate approve P0` on the user's behalf.** That command is deliberately routed
through the permission dialog, and the final approving click is always a human's. The agent's part
ends here:

1. Present the path of the review packet (`.harness/packets/P0.md`) and the artifact URL.
2. Check whether the packet's blocker list is empty, and report it.
3. **Wait** for the user to approve. Without approval, `harness phase set P1` is refused.

## Pitfalls

- **`doc submit` only passes from the `draft` state.** To revise a document that is already submitted,
  create a new version with `harness doc revise DOC-P0` (v+1, draft), then publish and submit it. The
  artifact_url carries over to the revision, so republishing at the same URL is fine.
- **Editing the document between submit and approve gets the approval refused** — the hash no longer
  matches. If you edited it, run `harness gate submit P0` again (a resubmission also reopens an
  approved gate).
- **A gate needs real artifacts.** `gate submit` rejects empty or placeholder files, a submission set
  under 80 non-whitespace characters, and content that already opened another gate.
- **In the design track the hook physically blocks writing implementation code.** Documents, assets,
  configuration, and files *named* as tests are writable, as are `.harness/`, the configured allow
  prefixes, and root `*.md`. There is no reason to touch code in P0 — if you were blocked, it is the
  judgement that was wrong, not the phase.
- **The evidence grade is `claimed`.** `claimed`/`code` is enough for the design track. `measured` is
  for the ship track (P10~P12); there is nothing to measure here.
