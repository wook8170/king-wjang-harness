---
name: phase-p5-contract
description: Use when driving P5 (CONTRACT) of the harness design track — settling the database schema and the API contract (endpoints, types, error conventions) as SCH-x/API-x nodes and putting them up for the gate. Triggers - "let's design the schema", "the API contract", harness phase set P5, submitting the P5 gate, 05-contract.md, SCH-x, API-x, error conventions.
---

# P5 CONTRACT — schema + API contract

## Overview

The last **producing** phase of the design track (P6 is the audit). The contracts settled here are the
input to the P7 skeleton and the P8 implementation. The artifact is `.harness/design/05-contract.md`.

**A contract is not an implementation.** Do not write migration SQL or create router files — until the
P6 approval the hook physically blocks writing implementation code. What you write here is a document.

## Ledger nodes

| Prefix | What | Parent |
|---|---|---|
| `SCH-x` | One table or entity | `--parent D-x` (the owning domain — the owner you settled in P1) |
| `API-x` | One endpoint | `--parent F-x` (the feature that needs that API) |

If one feature uses three APIs, all three of `API-3,API-4,API-5` take `--parent F-12`.

## The minimum a schema node (`SCH-x`) carries

| Item | Rule |
|---|---|
| Fields | Name, type, nullability, default. Write types in the type system of the ADR-1 stack |
| Keys and indexes | PK, unique constraints, and indexes justified by an access pattern |
| Relations | Cardinality plus an explicit delete policy (cascade/restrict). "Decide later" is banned |
| Owning domain | The one domain with write rights. Everyone else reads |
| Lifecycle | Soft delete or not, retention period, whether it is PII |

## The minimum an API contract (`API-x`) carries

| Item | Rule |
|---|---|
| Method and path | `POST /orders` — declare the path convention once at the top of the document and let everything follow it |
| Request and response types | Field by field. No `any`, no "an object" |
| Error convention | The code scheme plus its HTTP status mapping. **Write the convention shared by every endpoint first**, then list only the exceptions |
| Authorisation | Who may call it (in the roles from P0 `C-2`) |
| Idempotency | Whether a retry is safe. Mandatory to state for payment and creation endpoints |

Write the error convention separately per endpoint and the P6 audit catches it under "logical
coherence" — one shared table.

## Procedure

```bash
harness node upsert --id SCH-1 --title "orders" --parent D-1 --anchor "05-contract.md#sch-1-orders"
harness node upsert --id API-3 --title "POST /orders" --parent F-12 --anchor "05-contract.md#api-3-post-orders"
harness doc upsert --id DOC-P5 --path .harness/design/05-contract.md --phase P5 \
  --refs SCH-1,SCH-2,API-3,API-4
harness doc url DOC-P5 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P5          # refused without artifact_url
harness gate submit P5 --paths .harness/design/05-contract.md --evidence claimed
# → present .harness/packets/P5.md → wait for the user's approval
harness doc approve DOC-P5
harness phase set P6
```

## Approval is a human's

**An agent does not run `harness gate approve P5`.** Present the review packet and the artifact URL,
then wait. Without approval, `harness phase set P6` is refused.

## Pitfalls

- **Check the coverage yourself.** Does every `F-x` become at least one `API-x` or `UX-x`? Does every
  `UX-x` have an API to fetch the data it needs? `harness report rtm` shows the uncovered stretches as
  a table — look at it here, before handing anything to P6.
- **Do not touch the P1~P4 documents.** If writing the contract reveals a hole in the design above, that
  is a backtrack: `harness backtrack P3 --reason "<reason>"` → fix → `harness node bump F-x` → resubmit
  → `backtrack clear`.
- **`gate submit` only passes if the document files really exist** — if a `--paths` file cannot be read,
  it is refused at the hashing step. Catch path typos here.
- **Do not pin types to a stack's syntax.** A contract needs a language-neutral description plus one
  line mapping it to the ADR-1 stack. P7 generates the code from this document.
