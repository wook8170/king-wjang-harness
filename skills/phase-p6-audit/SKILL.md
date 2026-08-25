---
name: phase-p6-audit
description: Use when driving P6 (AUDIT) of the harness design track — re-auditing all of P0~P5 with design-auditor, backtracking to fix the findings in their owning phase, and obtaining the final design approval. Triggers - "audit the design", harness phase set P6, submitting the P6 gate, audit-rN.md, the four-lens audit, backtrack, final design approval, before implementation starts.
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
| UX walkthrough | Actually walking the scenarios — unreachable screens, UX that calls an API that does not exist |

**Every finding must carry a ledger node id or `file:line`.** A remark with no evidence is not
adopted. Prefer findings that two or more lenses independently landed on.

## The audit report (`audit-rN.md`)

| Section | Content |
|---|---|
| Verdict | `pass` / `needs revision` — exactly one |
| Findings | Severity (HIGH/MED/LOW) × evidence (node id or file:line) × owning phase × suggestion |
| Cross-checks | Which lenses pointed at the same thing |
| Unresolved | What the audit could not judge, and why (never hidden) |

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
harness gate submit P6 --evidence claimed --paths .harness/audit/audit-r2.md,\
.harness/design/00-concept.md,.harness/design/01-domain.md,.harness/design/02-module.md,\
.harness/design/03-feature.md,.harness/design/04-experience.md,.harness/design/05-contract.md
# → present .harness/packets/P6.md → wait for the user's final design approval
harness doc approve DOC-P6
harness phase set P7                   # source writing opens from here
```

Run `harness report rtm` and `harness gate sweep` before submitting — they catch uncovered stretches
and tampered approved documents **before** you ask for approval.

## Approval is a human's

**An agent never runs `harness gate approve P6`.** This is the "design done, start building" button
and it is the most expensive one to undo. Summarise the audit verdict, the unresolved items, and the
uncovered stretches of the RTM honestly, and let the user approve it themselves.

## Pitfalls

- **Never give the audit agent write access.** `design-auditor` is read-only. Fixing findings is the
  main session's job, and if the fixer re-audits, the confirmation bias comes straight back.
- **Never pass without a re-audit.** If you got `needs revision` and fixed it, run a new round
  (`audit-r2.md`). Reusing a round number erases what was looked at and when.
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
