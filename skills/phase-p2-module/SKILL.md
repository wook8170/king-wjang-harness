---
name: phase-p2-module
description: Use when driving P2 (MODULE) of the harness design track — settling module boundaries, interfaces and the dependency graph, and closing the two decision points (technology stack, and operations/deployment/scaling) as ADRs before putting them up for the gate. Triggers - "let's split this into modules", harness phase set P2, submitting the P2 gate, 02-module.md, M-x nodes, proposing an ADR, choosing a stack, choosing how to deploy.
---

# P2 MODULE — module design + two decision points

## Overview

Drop the domains (`D-x`) into **implementable modules** (`M-x`), and record permanently, as ADRs, the
two decisions that can only be made in this phase. The artifact is `.harness/design/02-module.md`.

| Decision point | ADR | What it settles |
|---|---|---|
| Technology stack | `ADR-1` | Language, runtime, framework, ORM, test harness |
| Operations / deployment / scaling | `ADR-2` | Hosting, CI/CD, scaling, observability, backup & DR, cost |

Both ADRs **parameterise the P7 skeleton, the P10 checks, and the P11 deploy commands.** Defer them
here and you pay for the change later in backtracking and STALE propagation.

## Artifact structure (`02-module.md`)

| Section | Node | Must contain |
|---|---|---|
| Module map | `M-x` | The module list with its domain (`--parent D-x`) and a one-line responsibility |
| Module interfaces | children of `M-x` | Only what the module **exposes**. Nothing about its internals |
| Dependency graph | — | Directed edges. Cycles get caught here, not in P6 |
| Decision rationale tables | `ADR-1`, `ADR-2` | The trade-off table per option — **this is where what the CLI cannot hold lives** |

## The ADR flow

**Recommendation packet → the user adopts or overrides → rejection reasons are mandatory.** Do not
skip a step.

```bash
# 1. Propose — 2 to 4 options (one option is not a decision, it is an announcement).
#    --recommend takes one of the option ids
harness adr propose --id ADR-1 --phase P2 --question "which technology stack do we go with" \
  --option a:"Next.js + Prisma + Postgres" \
  --option b:"Fastify + Drizzle + Postgres" \
  --option c:"Go + sqlc" \
  --recommend a
# → the recommendation packet renders to stdout. Present it to the user together with the
#   trade-off table and wait for their answer.

# 2. Adopt — it only passes when **every** option not adopted has a rejection reason
harness adr decide ADR-1 --choose a --rationale "team fluency, single full-stack deployment, the P0 C-6 budget constraint" \
  --reject b:"cannot sustain a separate BFF without operations staff" --reject c:"zero Go experience on the team"

harness adr show ADR-1     # check the record
harness adr list           # the whole list
```

- **User override**: pass a free-form string to `--choose` instead of an option id and it is absorbed
  and recorded as a `custom` option. In that case **every original option** needs a `--reject` reason.
- `adr propose` registers the `ADR-x` ledger node for you — no separate `harness node upsert`.
- To change a decision, do not overwrite it: `harness adr revise ADR-1 --question "<new question>"`,
  which bumps the version and propagates STALE.

## Procedure

```bash
harness node upsert --id M-1 --title "Order API" --parent D-1 --anchor "02-module.md#order-api"
harness doc upsert --id DOC-P2 --path .harness/design/02-module.md --phase P2 \
  --refs M-1,M-2,ADR-1,ADR-2
harness doc url DOC-P2 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P2          # refused without artifact_url
harness gate submit P2 --paths .harness/design/02-module.md --evidence claimed
# → present .harness/packets/P2.md → wait for the user's approval
harness doc approve DOC-P2
harness phase set P3
```

## Approval is a human's

**An agent does not run `harness gate approve P2`.** Check and report that both ADRs are `accepted`
and that the review packet has no blockers, then wait.

## Pitfalls

- **`--option` carries only `<id>:<title>` — there is no way to put pros/cons or trade-offs in
  through the CLI.** Write the comparison table in the "decision rationale" section of
  `02-module.md`, and show that section alongside the packet. The ADR record preserves *why* you
  chose; the depth of *what you compared it against* lives in the document.
- **Quote a title that contains spaces** — `--option a:"Next.js + Prisma"`. Without quotes the next
  token is cut off.
- **Re-proposing the same id is refused** — an existing ADR cannot be overwritten. Revise with
  `adr revise`.
- **`adr decide` only passes from the `proposed` state.** Trying to decide something already decided
  is blocked.
- **A settled stack is not permission to write code.** Until the P6 approval the hook blocks writing
  implementation code.

## Companion skills (optional)

These are separate skill packages, not part of this harness. The `king-wjang-harness` driver checks
for them and offers to install any that are missing.

- `oh-my-claudecode:architect` — a read-only advisor for the module boundaries, dependency graph and the ADR stack decision.
- `superpowers:writing-plans` — turn the module design into a written plan the build track executes.
