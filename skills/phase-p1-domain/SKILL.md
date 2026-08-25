---
name: phase-p1-domain
description: Use when driving P1 (DOMAIN) of the harness design track — decomposing the concept into domains, settling the domain model, the boundaries and the per-domain requirements, and putting them up for the gate. Triggers - "let's split this into domains", harness phase set P1, submitting the P1 gate, 01-domain.md, registering D-x nodes, domain boundaries.
---

# P1 DOMAIN — domain decomposition

## Overview

**Split P0's concept (`C-x`) into domains.** The artifact is `.harness/design/01-domain.md` and the
ledger nodes are `D-x`. Every `D-x` points with `--parent` at the `C-x` it came from.

The boundaries you draw here decide the P2 module boundaries and the P5 schema ownership. Blurred
boundaries get caught by the P6 audit's "logical coherence" lens, and everything backtracks to P1.

## Artifact structure (`01-domain.md`)

| Section | Node | Must contain |
|---|---|---|
| Domain map | — | The list of domains with a one-line responsibility each. One table should show the whole picture |
| Domain detail | `D-1`, `D-2`… | Responsibility, core concepts (entities, vocabulary), **what it pushes outside its boundary** |
| Relations between domains | — | Which domain **calls** which (directed arrows). No cycles |
| Per-domain requirements | children of `D-x` | What that domain must satisfy — the raw material for P3 features |
| Ubiquitous language | — | A glossary, so the same thing is never called by two names |

## Deciding a boundary

| Question | Yes → | No → |
|---|---|---|
| Can you state the responsibility in one sentence? | one domain | split it |
| Do two domains **write** the same data? | pick an owner (the other one reads) | leave it |
| Are calls between domains bidirectional? | that is a cycle — add a higher domain or break it with an event | leave it |
| Could this ever split along team or deployment lines? | boundary candidate | merging is fine |

## Procedure

```bash
harness node upsert --id D-1 --title "Orders" --parent C-1 --anchor "01-domain.md#orders"
harness doc upsert --id DOC-P1 --path .harness/design/01-domain.md --phase P1 --refs D-1,D-2,D-3
harness doc url DOC-P1 https://claude.ai/public/artifacts/<id>   # publish first, then register the URL
harness doc submit DOC-P1                                        # refused without artifact_url
harness gate submit P1 --paths .harness/design/01-domain.md --evidence claimed
# → the review packet appears at .harness/packets/P1.md → present it to the user and wait
harness doc approve DOC-P1     # after the user has finished gate approve P1
harness phase set P2
```

## Approval is a human's

**An agent never runs `harness gate approve P1`.** Present the review packet path and the artifact
URL, and wait for the user's approval. Without it, `harness phase set P2` is refused — a phase
transition happens on "artifact approved", never on "work finished".

## Pitfalls

- **Leaving out `--parent` breaks the traceability chain.** The `C-x → D-x → F-x → wave → commit`
  chain is the skeleton of the RTM. A parentless domain cannot answer "why does this exist".
- **Do not edit the P0 document here.** If the concept is wrong, that is a revision — backtrack
  formally with `harness backtrack P0 --reason "<reason>"`, fix it, and raise the node's version with
  `harness node bump C-x` (STALE propagates to the waves that reference it).
- **Never rename a node id afterwards.** Documents, waves, and commit trailers are tied together by
  id. If the name is wrong, change only the title:
  `harness node upsert --id D-1 --title "<new title>"` (the version is preserved).
- **No hand-editing the ledger.** The hook blocks direct edits to `.harness/design/ledger.yaml` —
  change it only through `harness node` commands.

## Companion skills (optional)

These are separate skill packages, not part of this harness. The `king-wjang-harness` driver checks
for them and offers to install any that are missing.

- `superpowers:brainstorming` — explore the domain decomposition and where the boundaries fall before committing them.
