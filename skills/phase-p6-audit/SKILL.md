---
name: phase-p6-audit
description: Use when driving P6 (AUDIT) of the harness design track — re-auditing all of P0~P5 with design-auditor, backtracking to fix the findings in their owning phase, and obtaining the final design approval. P7 opens only at HIGH 0 — every round re-audited, every revision carrying a reconciliation table. Triggers - "audit the design", harness phase set P6, submitting the P6 gate, audit-rN.md, reconcile-rN.md, the four-lens audit, HIGH 0, re-audit after a revision, backtrack, final design approval, before implementation starts.
---

# P6 AUDIT — the full design audit

## Overview

**The author does not verify their own work.** The main session wrote P0~P5, so the audit is done by
the read-only `design-auditor` subagent in a fresh context. The artifact is
`.harness/audit/audit-rN.md` (one per round — the first audit is `audit-r1.md`, the re-audit after
fixes is `audit-r2.md`).

**Until the P6 gate is approved, the hook physically blocks writing implementation code and running
build or deploy commands.** "Let's just build a bit and see" does not work here — you pass this gate
to reach P7.

## The four-lens parallel audit

Dispatch `design-auditor` **once per lens, all at once**. Mixing lenses lets one perspective eat another.

| Lens | What it asks |
|---|---|
| Logical coherence | Where the node chain (`C→D→M→F→UX/API/SCH`) breaks or contradicts itself. Circular dependencies. Ownership conflicts |
| Ambiguity | Sentences two people could read differently. Acceptance criteria that cannot be verified |
| Blockers / feasibility | What the ADR constraints (budget, staffing, regulation) make impossible. Gaps in external dependencies and credentials |
| UX walkthrough | A chosen persona's real task scenarios walked from the first screen to the end on the P4 canvas and mockups, judged on the nine UX axes below |

**Every finding must carry a ledger node id or `file:line`.** A remark with no evidence is not
adopted. Prefer findings that two or more lenses independently landed on.

**The auditor checks the code, not only the sentences.** Wherever a design document cites existing
code (a file, function, table, route, setting, migration — common when the product already exists),
the auditor opens that place and compares it with what the design says. A design claim about code
that the auditor could not open is listed under "Unresolved", never assumed true.

**The auditor is a strong model in a fresh, read-only context** (`design-auditor` runs on `opus`; a
stronger model may be passed, never a weaker one). It must not be the session that wrote P0~P5.

### The nine UX axes (UX walkthrough lens)

The UX walkthrough is not a design-system check. The auditor first names the personas (who comes to
each screen and why — for example a first-time business user, an administrator, a viewer with few
permissions), writes the real task scenarios each one would do, walks every scenario end to end, and
on every screen writes one line: what this person has understood so far and what they are about to do
next. Findings are sorted into these axes, and every axis is reported — with its findings, or with
"checked, no finding" and the scenarios that covered it.

| Axis | What it asks |
|---|---|
| 1 Logic errors | Do behaviour and state transitions agree? Finished work left "in progress", an impossible combination that can be chosen, a cancel that is still applied |
| 2 Information consistency | Is the same value (number, unit, name, status wording) the same on every screen? Do summary and detail agree? Do tables, badges and wording match the data contract (SCH/API)? |
| 3 User context | Who comes here and why (role, experience)? Is what they need visible, and is internal information they do not need hidden? |
| 4 Flow context | What did the user just do and where do they go next? Any break in the middle of a flow, or a place with no way back? |
| 5 First-time user getting lost | Where a first-time user is stuck, stops at an unknown term, or meets an empty state with no first step |
| 6 The next action | Is "what to do now" visible on every screen? One clear primary action? Does each button's name match its result? |
| 7 A way out of errors and exceptions | Failure, no permission, a limit reached: are the cause and the fix shown? |
| 8 Accessibility, narrow width, dark theme | Keyboard and screen reader (name and role of every control), narrow width, dark theme |
| 9 Design system visual comparison | Spacing, line height, type size and weight, table row height, button and badge size against the P4 design system |

## The audit report (`audit-rN.md`)

| Section | Content |
|---|---|
| Verdict | `pass` / `needs revision` — exactly one. Any open HIGH makes it `needs revision` |
| Findings | Severity (HIGH/MED/LOW) × evidence (node id or file:line, and the cited code's `file:line`) × owning phase × direction of the fix |
| Owner decisions | Points the design cannot settle without the user (scope, wording on screen, a trade-off) — collected here, never decided by the auditor or the main session |
| Cross-checks | Which lenses pointed at the same thing |
| New risks of this revision | From round 2 on: what the changed paragraphs and the code they now cite introduced |
| Unresolved | What the audit could not judge, and why (never hidden) |
| Last line | `HIGH N` — the open HIGH findings of this round. Always the last line |

## HIGH 0 before P7

**P7 opens only when the newest round ends with `HIGH 0`.** Do not submit the P6 gate on a round with
an open HIGH, and do not present one for approval. MED and LOW findings are either applied or written
into the reconciliation table with a reason — a MED left without either is an open item the approval
packet must show.

## Revisions and the reconciliation table

Each fix round produces a new revision of the design documents (`harness node bump` /
`harness doc revise` give the version numbers). For every revision:

- mark every changed paragraph with its round, for example `[r2]`, so the next auditor can find it;
- write `.harness/audit/reconcile-rN.md` — one row per finding of `audit-rN.md`:

  | Finding | Severity | Decision | Applied at | Reason (when not accepted) |
  |---|---|---|---|---|
  | HIGH-2 | HIGH | accepted | F-12 · 03-feature.md:88 [r2] | |
  | MED-4 | MED | not accepted | — | the cited path is test-only (tests/fx.ts:12); production already covers it at src/count.ts:40 |

  A "not accepted" without a reason the next auditor can check counts as open;
- re-audit with fresh `design-auditor` dispatches (a new round, `audit-r(N+1).md`).

**A short re-audit is allowed for a revision that only fixed HIGH findings**: the auditors check those
findings alone, plus — always — the new risks of the revision (the changed paragraphs, the code they
now cite, and whatever depends on them). A revision that changed anything else gets all four lenses again.

## Owner decisions

Owner decisions collected in the audit are put to the user as one list, before the P6 gate is
submitted. Their answers go into the owning phase document as a revision (and the reconciliation
table), so the next round audits the decided text.

## After implementation — the conformance audit (input to P9 and P10)

The design audit has a second half. When the build track has implemented the design, a fresh
`design-auditor` with the **implementation conformance** lens reads the changed code against the
approved design: every invariant the design states (permissions, data integrity, ordering, limits,
compatibility, state transitions) is located in the code as `file:line` and marked holds or breaks.
It ends with `HIGH N` like any round. P9 runs it before the build track closes and P10 takes it as a
mandatory input — see those phases.

## Finding → backtrack → re-audit

```bash
harness backtrack P3 --reason "F-12 acceptance criteria are unverifiable (audit-r1 HIGH-2)"
# → edit that phase's document
harness node bump F-12                 # revised node → version++ · STALE propagates
harness doc revise DOC-P3              # new version (draft), artifact_url carries over
# → republish the artifact at the same URL → harness doc submit DOC-P3
harness gate submit P3 --paths .harness/design/03-feature.md --evidence claimed
# → user re-approves → harness doc approve DOC-P3
harness backtrack clear
# → dispatch design-auditor again → audit-r2.md
```

When findings span several phases, fix **from the highest phase down**. Fixing P1 changes P3 with it.

## Procedure (once the audit passes)

```bash
harness doc upsert --id DOC-P6 --path .harness/audit/audit-r2.md --phase P6 --refs F-12,UX-7
harness doc url DOC-P6 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P6              # refused without artifact_url
# P6 is the final approval of the whole design — put every design document under review so their hashes are pinned
# the newest audit round ends with "HIGH 0"; every reconcile-rN.md goes with it
harness gate submit P6 --evidence claimed --paths .harness/audit/audit-r2.md,.harness/audit/reconcile-r1.md,\
.harness/design/00-concept.md,.harness/design/01-domain.md,.harness/design/02-module.md,\
.harness/design/03-feature.md,.harness/design/04-experience.md,.harness/design/05-contract.md
# → present .harness/packets/P6.md → wait for the user's final design approval
harness doc approve DOC-P6
harness phase set P7                   # source writing opens from here
```

Run `harness report rtm` and `harness gate sweep` before submitting — they catch uncovered stretches
and tampered approved documents **before** you ask for approval.

## Approval is a human's

**An agent never approves P6 on its own — the user types `/king-wjang-harness:approve P6`.** This is the "design done, start building" button
and it is the most expensive one to undo. Summarise the audit verdict, `HIGH N` per round, the
reconciliation tables, the owner decisions and their answers, the unresolved items, and the uncovered
stretches of the RTM honestly, and let the user approve it themselves.

## Pitfalls

- **Never give the audit agent write access.** `design-auditor` is read-only. Fixing findings is the
  main session's job, and if the fixer re-audits, the confirmation bias comes straight back.
- **Never pass without a re-audit.** If you got `needs revision` and fixed it, run a new round
  (`audit-r2.md`). Reusing a round number erases what was looked at and when.
- **Never reach HIGH 0 by editing the count.** A HIGH leaves the count only by being applied, or by
  "not accepted" with a reason in the reconciliation table that the next round's auditor accepts.
  Lowering a severity is not a fix.
- **A short re-audit still looks for new risks.** Checking only "was HIGH-2 fixed" misses the risk the
  fix introduced; that is the most common way a second-round HIGH ships.
- **Several files in `--paths` are comma-separated with no spaces.** If you need to wrap the line, join
  it with `\` and break after a comma. If even one file cannot be read, the submission itself is refused.
- **`gate approve` is refused if a file changed after submission.** Do not touch the documents after
  requesting approval — if you did, resubmit.
- **During a backtrack, editing `.harness/design/` is open.** Always run `harness backtrack clear` when
  you are done. Walk into P7 with it still open and the build track's protection of the design
  documents stays disabled.

## Companion skills (optional)

These are separate skill packages, not part of this harness. The `king-wjang-harness` driver checks
for them and offers to install any that are missing.

- `oh-my-claudecode:critic` — a structured, multi-perspective review of the whole design before the final gate.
- `oh-my-claudecode:code-reviewer` — severity-rated review of any design artifact that carries logic.

## Writing rule — four forms to avoid in Korean prose

Every Korean sentence you write (design documents, reports, findings, replies, screen text) avoids four hard-to-read forms:
(1) Missing connecting words — when sentences relate by reason, result, contrast, order or condition, say so ("so", "but", "only if").
(2) Over-personified things — do not give code or features human actions (swallow, chase its tail, wake up); write what actually happens.
(3) Three or more nouns in a row without particles — unpack them. Fixed names such as product names are exempt.
(4) Paired words kept far apart — do not put a long phrase between subject and verb or between a modifier and what it modifies; split the sentence.
Source: `~/.claude/rules/REPORT_WRITING_RULES.md` section 15 and the `readable-korean` skill, when present.
