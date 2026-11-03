---
name: phase-p10-harden
description: Use when driving P10 (HARDEN) of the harness ship track — getting the first readiness verdict, standing up the defect ledger, running the fix → re-verdict loop, and closing the token swap drill, security, performance and operational readiness on measured evidence. Two adversarial reviews are mandatory inputs to the verdict: the implementation conformance audit and the changed-screen UX adversarial review with design system visual comparison; an open blocker or high finding from either stops the gate. Triggers - "get ready to ship", "readiness verdict", "UX adversarial review", "changed screens", harness phase set P10, submitting the P10 gate, the defect ledger, defects.yaml, readiness.md, the token swap drill, re-measurement.
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

A `blocker` or `high` defect blocks the P12 verdict until it is `verified` — being stuck at `fixed` blocks it too. The core also refuses `harness gate submit P10` while one is `open` or `fixed`. Only `verified`, or `deferred` with the owner's reason, closes it.

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

## Mandatory inputs to the verdict — two adversarial reviews

The readiness verdict is not dispatched until both exist for the current commit. Lane tests, the token
swap drill and a design lint baseline do not replace them: none of them sees wording a first-time user
misreads, a dead end, or spacing that touches.

| Input | Who | What | Where |
|---|---|---|---|
| Implementation conformance audit | fresh `design-auditor`, implementation conformance lens (P9 step 5) | every design invariant located in the code, holds or breaks; ends with `HIGH N` | `.harness/audit/conformance-rN.md` |
| Changed-screen UX adversarial review | a checker from a context that did not build the screens (`wb:quality-ux-adversarial` when the wb plugin is installed; otherwise the same criteria in the project's own brief) | see below | `.harness/ship/evidence/ux-adversarial/` |

**The changed-screen UX adversarial review.**

1. Scope: every screen and flow the release changed (the UX nodes of this release's waves, and the
   screen files changed since the previous release).
2. The checker starts the product in isolation (the project's e2e harness or an isolated stack — never
   the working database or the owner's ports) and walks each changed flow in a **headless** browser,
   leaving **2x** captures.
3. Method: it names the personas first (who comes to each screen and why — a first-time business user,
   an administrator, a viewer with few permissions), does their real task scenarios from the first
   screen to the end, and on every screen writes what the persona has understood and is about to do.
4. It reports on all nine UX axes (each one with findings or "checked, no finding"): 1 logic errors ·
   2 information consistency · 3 user context · 4 flow context · 5 first-time user getting lost ·
   6 the next action · 7 a way out of errors and exceptions · 8 accessibility (keyboard, screen
   reader), narrow width, dark theme · 9 **design system visual comparison** measured on the page
   against the P4 design system: spacing that touches, line height too tight, type sizes or weights
   mixed in one block, table row heights, button and badge sizes.
5. Every finding has a severity (`blocker` / `high` / `medium` / `low`), an axis, a reproduction and a
   2x capture as evidence.

**Into the defect ledger.** Findings of both reviews are registered with `harness ship defect add`
(ids such as `UXA-03` and `CONF-02`, evidence = capture path or `file:line`). An open or only fixed
`blocker` or `high` blocks `harness ship verdict`, and the core refuses `harness gate submit P10` while
one is left — fix, re-check with a fresh reviewer, promote to `verified`, or record the owner's decision
with `--status deferred --defer-reason`.

**Screen changes need the owner first.** Findings whose fix changes a screen (layout, wording, flow)
are collected and put to the user in one artifact — the findings table with the 2x captures, viewable
remotely — and fixed only after the user confirms them. A fix inside the ledger scope that restores the
intended design is a defect fix; anything else is a design change and goes through `harness backtrack`.

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
# → .harness/audit/conformance-rN.md ends with HIGH 0 (P9 step 5)
# → changed-screen UX adversarial review done; findings registered; screen changes confirmed by the user
# → dispatch readiness-auditor with both reports as inputs (drives verifying-production-readiness, read-only)
# → register every finding with harness ship defect add → fix → re-measure → verified
harness ship verdict                    # 0 open blockers · UX wave evidence confirmed
harness doc upsert --id DOC-P10 --path .harness/ship/readiness.md --phase P10 --refs F-12,UX-7
harness doc url DOC-P10 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P10              # refused without artifact_url
harness gate submit P10 --evidence measured \
  --paths .harness/ship/readiness.md,.harness/ship/defects.yaml,.harness/audit/conformance-r2.md,\
.harness/ship/evidence/ux-adversarial/findings.md
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
- `wb:quality-ux-adversarial` — the changed-screen UX adversarial review above (nine axes, persona task scenarios, isolated stack, headless 2x). If the wb plugin is absent, apply the same criteria through the project's own brief. Its findings go onto the defect ledger; an open high blocks the P10 gate.

## Writing rule — four forms to avoid in Korean prose

Every Korean sentence you write (design documents, reports, findings, replies, screen text) avoids four hard-to-read forms:
(1) Missing connecting words — when sentences relate by reason, result, contrast, order or condition, say so ("so", "but", "only if").
(2) Over-personified things — do not give code or features human actions (swallow, chase its tail, wake up); write what actually happens.
(3) Three or more nouns in a row without particles — unpack them. Fixed names such as product names are exempt.
(4) Paired words kept far apart — do not put a long phrase between subject and verb or between a modifier and what it modifies; split the sentence.
Source: `~/.claude/rules/REPORT_WRITING_RULES.md` section 15 and the `readable-korean` skill, when present.
