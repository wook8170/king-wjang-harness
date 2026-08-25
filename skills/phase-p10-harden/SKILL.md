---
name: phase-p10-harden
description: Use when driving P10 (HARDEN) of the harness ship track — getting the first readiness verdict, standing up the defect ledger, running the fix → re-verdict loop, and closing the token swap drill, security, performance and operational readiness on measured evidence. Triggers - "get ready to ship", "readiness verdict", harness phase set P10, submitting the P10 gate, the defect ledger, defects.yaml, readiness.md, the token swap drill, re-measurement.
---

# P10 HARDEN — the readiness verdict and the defect ledger

## Overview

The first phase of the ship track. **From here, a gate only passes on `measured` evidence**
(Iron Rule, §3-4) — the core refuses `harness gate approve P10` if the evidence is `claimed` or
`code`. Without a real run and real measurement, the ship track does not open.

The verdict comes from `readiness-auditor` driving the `verifying-production-readiness` skill. The
author does not verify their own work — it is a read-only auditor in a fresh context, not the session
that drove the build track.

**The blocking matrix changes (§4-2).** In P10~P12, the source edits allowed are **limited to items on
the defect ledger.** The hook blocks new feature code — a feature slipped in right before shipping is
the most expensive kind of accident.

## The defect ledger — the yaml is of record, readiness.md is a rendered copy

| File | What | Who writes it |
|---|---|---|
| `.harness/ship/defects.yaml` | **The machine record.** Where `harness ship verdict` reads from | `harness ship defect` only |
| `.harness/ship/readiness.md` | The **rendered copy** humans read and publish as an artifact | The core re-renders it on every change |

**Never hand-edit `readiness.md`** — the next `harness ship defect` run overwrites it wholesale.
Register everything the auditor hands back through the CLI.

| Field | Rule |
|---|---|
| `severity` | `blocker` / `high` / `medium` / `low`. **It may be raised, never lowered** — to lower it, record the reason |
| `evidence` | `file:line` (`src/auth.ts:88`), or a reproduction command or evidence path. Without it the core refuses the registration |
| `status` | `open` → `fixed` → `verified`. **`fixed` is a claim; `verified` is an observation** |
| `deferReason` | **Mandatory** to leave something `deferred`. A deferral without a reason is not a deferral, it is concealment (the core refuses) |

A `blocker` blocks the P12 verdict until it is `verified` — being stuck at `fixed` blocks it too.

## The fix → re-measure loop

```bash
harness ship defect add --id SEC-01 --severity blocker \
  --title "session tokens end up in the logs" --evidence "src/auth.ts:88"
# → fix, limited to items on the defect ledger (the hook blocks new feature code)
harness ship defect update SEC-01 --status fixed
# → run the same measurement again. A fix reveals the next defect (Iron Rule 4)
harness ship defect update SEC-01 --status verified --evidence ".harness/ship/evidence/e2e.log"
```

Promoting something to `verified` without re-measuring after the fix fills the ledger with lies.
Get the re-verdict by **dispatching readiness-auditor afresh** (a session does not approve its own fix).

## Mandatory items — these three close on `measured` in P10

| Item | How | Basis |
|---|---|---|
| Token swap drill | `harness tokens swap --with <alternate-theme.json>` → recapture every screen headless at 2x → **a screen that did not change is a hardcoded screen** | §7, the third enforcement |
| E2E run evidence | `harness evidence check <wave>` passes for every UX-referencing wave (2x screenshots) | §3-5 |
| Operational readiness | Walk the operations ADR's decisions (hosting, backup/DR, observability, rollback) one by one with `harness adr show <ops ADR>` | §5, the P2 decision |

The swap drill is the device that **turns the claim "we can change it all at once" into measured
evidence**. Close P10 without the drill and the single source of truth for tokens exists only in a document.

## Procedure

```bash
harness ship verdict                    # first, see what is currently blocking
# → dispatch readiness-auditor (drives verifying-production-readiness, read-only)
# → register every finding with harness ship defect add → fix → re-measure → verified
harness ship verdict                    # 0 open blockers · UX wave evidence confirmed
harness doc upsert --id DOC-P10 --path .harness/ship/readiness.md --phase P10 --refs F-12,UX-7
harness doc url DOC-P10 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P10              # refused without artifact_url
harness gate submit P10 --evidence measured \
  --paths .harness/ship/readiness.md,.harness/ship/defects.yaml
# → present .harness/packets/P10.md → wait for the user's approval
harness doc approve DOC-P10
harness phase set P11
```

## Approval is a human's

**A human presses `harness gate approve P10`. An agent never approves on their behalf.** Summarise
the verdict, the unresolved items, and the deferral reasons honestly, and wait. If the evidence grade
is not `measured` the core refuses first — do not try to route around that refusal.

## Pitfalls

- **Never give the auditor write access.** `readiness-auditor` is read-only. Fixing is the main
  session's job, and if the fixer renders the verdict, the confirmation bias comes straight back.
- **Fix the gates numerically first (Iron Rule 1).** Lowering a threshold after seeing the result is
  not a verdict, it is after-the-fact approval. If a gate must be relaxed, record **the change, the
  time, and the reason** in the ledger.
- **`deferred` is refused at registration without a reason.** Do not dodge it by dropping the severity
  to `low` — lowering severity is not a fix.
- **An empty ledger means "not looked at yet", not "no defects".** Submit P10 without running the
  verdict and the review packet says exactly that.
- **The hook blocks new feature code.** An improvement you feel like making during ship prep is backlog,
  not a defect. If it really is a design change, backtrack formally:
  `harness backtrack <phase> --reason "<reason>"`.

## Companion skills (optional)

These are separate skill packages, not part of this harness. The `king-wjang-harness` driver checks
for them and offers to install any that are missing.

- `verifying-production-readiness` — the readiness rubric the `readiness-auditor` drives for the first verdict.
- `oh-my-claudecode:security-reviewer` — OWASP-oriented vulnerability pass feeding the defect ledger.
