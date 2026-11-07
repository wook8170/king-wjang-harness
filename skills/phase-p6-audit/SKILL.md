---
name: phase-p6-audit
description: Use when driving P6 (AUDIT) of the harness design track — re-auditing all of P0~P5 with design-auditor, backtracking to fix the findings in their owning phase, and obtaining the final design approval. P7 opens at HIGH 0, with at most three full audits by default, short re-audits for revisions that keep the structure, and owner decisions for what remains. Triggers - "audit the design", harness phase set P6, harness audit status, submitting the P6 gate, audit-rN.md, reconcile-rN.md, the four-lens audit, HIGH 0, short re-audit, carry-over ledger, moving a finding to testing, reversal conflict, re-audit after a revision, backtrack, final design approval, before implementation starts.
---

# P6 AUDIT — the full design audit

## Overview

**The author does not verify their own work.** The main session wrote P0~P5, so the audit is done by
the read-only `design-auditor` subagent in a fresh context. The artifact is
`.harness/audit/audit-rN.md` (one per round — the first audit is `audit-r1.md`, the re-audit after
fixes is `audit-r2.md`). `harness audit status` prints the rounds, the full audit count, what blocks
the gate and the next step. `harness gate submit P6` and the approval both apply the same check.

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
adopted, and a HIGH needs the stronger evidence defined below. Prefer findings that two or more lenses independently landed on.

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

## What counts as HIGH

A finding is HIGH only when both of these hold.

1. **Impact.** Implementing the text as written is blocked, or the result would be hard to reverse once
   built. Hard to reverse means one of: a public contract or a stored format, data loss or a migration,
   a security or permission boundary, a conflict in the product scope.
2. **Evidence.** The auditor reproduced it (`repro: <what was run and what happened>`), or can cite it as
   `path:line`. A UX walkthrough finding cites the document (`04-experience.md:120`) and the scenario step
   (`S2-3`). When the canvas has no line numbers, the node and the step stand in (`UX-7 · S2-3`). The short form
   for a design document, `02:42`, also counts. A node id alone is not evidence for a HIGH.

Everything else is MED or LOW: a doubt without evidence, wording, and any defect that a later change can
repair without touching a contract or stored data. The gate refuses a newest round with a HIGH that has
no such evidence. The fix is a new judgement from an auditor, not an edit by the main session.

## The audit report (`audit-rN.md`)

The lines and headings in `code` are read by the gate, so they stay in English exactly as written.

| Section | Content |
|---|---|
| `Audit-Kind: full` or `Audit-Kind: short` | The kind of round. A round without this line is an old-format round and counts as a full audit |
| `Lenses: logical coherence, ambiguity, blockers, UX walkthrough` | Full audits only: the four lenses that ran |
| Verdict | `pass` / `needs revision` — exactly one. Any open HIGH makes it `needs revision` |
| `## Findings` | Every section whose heading starts this way is counted. One table row per finding: id (`HIGH-1`, `MED-4`) × severity × evidence (node id or file:line, and the cited code's `file:line`) × owning phase × what × direction of the fix. The id and the severity come first |
| Owner decisions | Points the design cannot settle without the user (scope, wording on screen, a trade-off) — collected here, never decided by the auditor or the main session |
| `## Owner re-check needed` | A closed owner decision that seems to create a new risk or a real contradiction in numbers or safety. One line per item, naming the decision as `r3/RC-1`, with evidence. Not counted as HIGH, but an item whose reference is not an `owner-decided` or `owner-accepted` row counts as an open HIGH |
| `## Reversal conflicts` | Table rows `RC-1 · the closed decision · the new direction · evidence on both sides`. Not counted as HIGH; see "Reversal conflicts" |
| `## Classification check` | From round 2 on, when items were moved: table rows `id · upheld or overturned · why` |
| Cross-checks | Which lenses pointed at the same thing |
| `## New risks of this revision` | From round 2 on: what the changed paragraphs and the code they now cite introduced |
| `structural change: yes` or `no` | Short re-audits only: one line written by the auditor, with its reason |
| `Re-raised and filtered: N` | How many closed items the auditor set aside under "Closed items". The owner uses this line to see whether the filter is too wide |
| Unresolved | What the audit could not judge, and why (never hidden) |
| Last line | `HIGH N` — the HIGH rows of this round's findings tables. Always the last line |

The severity cell is read without regard to case and by its start, so `high` and `HIGH (provisional)` are both HIGH.
The main session merges the four lens reports into this file and copies every HIGH as written. Any later round, short
or full, mentions by id each HIGH of the round before it, except those the owner accepted.

## When the audit ends

**P7 opens when the newest round ends with `HIGH 0`.** MED and LOW findings then go into the
reconciliation table and the P6 gate comes next. No new four-lens round is needed for them. If the
main session changed a design document at that point, only the changed paragraphs get a short re-audit.
A HIGH from a short re-audit is fixed and looked at again in another short round.

## Short re-audit or all four lenses

A short re-audit is allowed for any revision that keeps the structure of the design, whichever severity
it fixed. It covers the findings that were fixed and, always, the new risks of the revision: the changed
paragraphs, the code they now cite, and whatever depends on them.

**A revision is a structural change, and gets all four lenses, when it does any of these:**

- adds or removes a requirement, a persona or a screen flow, or otherwise changes the product scope;
- adds, removes or re-parents a ledger node of the chain `C→D→M→F`;
- changes a module boundary, a dependency direction or who owns a piece of data;
- adds or changes an ADR decision;
- adds or removes an API endpoint or a table, or changes a contract that two or more features depend on.

**These are not structural:** rewording, a corrected number or term, a measurable acceptance criterion in
place of a vague one, a state or error case added inside an existing flow, one field added or corrected
on one consumer's contract, and carrying one decision into the documents that repeat it.

The main session proposes the kind of round. The short re-audit's auditor reads the revision and writes
`structural change: yes` or `no`. On `yes` the gate refuses that round, and the revision needs a full
audit. The code cannot judge this itself, so the auditor's line is the check.

## The cap on full audits

**At most three rounds run all four lenses.** `audit_full_round_cap` in `.harness/config.yaml` changes the
number, and that file is closed to agents. Old-format rounds count toward the cap. Short re-audits do not,
and they stay available after the cap.

When three full audits have run and HIGH findings remain, do not dispatch another full audit. Give the
owner the remaining HIGH findings as a list, and the owner picks one of these for each:

| Choice | What happens next |
|---|---|
| (a) Fix it and re-audit | The fix goes through a short re-audit |
| (b) Accept the risk | The row reads `owner-accepted` with the owner's reason (see below) |
| (c) One more full audit | The owner raises `audit_full_round_cap` in `.harness/config.yaml` and re-pins the policy with `HARNESS_ACCEPT_POLICY=1 harness doctor --accept-policy`. Until it is re-pinned the gate uses the default of 3 and refuses |

**This is not an automatic pass.** A HIGH closes only by being fixed and re-audited, by the next auditor
upholding its move to testing, or by the owner's approval of P6. A full audit beyond the cap is refused at the gate
even when it ends with `HIGH 0`. The cap counts the whole project and does not reset with a design revision.

**Owner rows take effect only at P6 approval.** `owner-accepted` and `owner-decided` rows are proposals until then.
The owner may accept a risk before the cap too, so a single HIGH does not need more full audits. Both kinds, with their
reasons, appear in the review packet and the approval dialog. The slash command has no dialog, so its first use lists
them and refuses; the owner types `/king-wjang-harness:approve P6 --accept-risk` after reading them. A person who types the
flag the first time approves without seeing that list, as the review packet is then the only place it was shown. The approval event
records them as `auditAcceptedHighs` and `auditOwnerDecisions`.

## Revisions and the reconciliation table

Each fix round produces a new revision of the design documents (`harness node bump` /
`harness doc revise` give the version numbers). For every revision:

- mark every changed paragraph with its round, for example `[r2]`, so the next auditor can find it;
- write `.harness/audit/reconcile-rN.md` — one row per finding of `audit-rN.md`. The severity is copied
  from the audit; only an auditor can change it:

  | Finding | Severity | Decision | Applied at | Reason (when not accepted) |
  |---|---|---|---|---|
  | HIGH-2 | HIGH | accepted | F-12 · 03-feature.md:88 [r2] | |
  | MED-4 | MED | not accepted | — | the cited path is test-only (tests/fx.ts:12); production already covers it at src/count.ts:40 |
  | MED-5 | MED | carried | F-7 | both readings work; settled reading: the count excludes drafts |
  | HIGH-3 | HIGH | test-transfer | F-16 acceptance criterion 4 | whether two writers deadlock shows only in a run; nothing in the text rules it out |
  | RC-1 | CONFLICT | owner-decided | 05-contract.md:40 [r2] | the owner keeps the row |
  | HIGH-4 | HIGH | owner-accepted | — | the owner accepts this until v2: the limit is unreachable at launch volume |

  Decision is one of `accepted`, `not accepted`, `owner-decided`, `owner-accepted`, `carried`,
  `test-transfer`. Any decision except `accepted` needs a reason. Write it as checkable evidence (`path:line`
  and one line), not as an argument, because the next auditor reads it;
- when the table has `accepted` or `owner-decided` rows, add the application check below, then re-audit in a
  new round (`audit-r(N+1).md`). The same re-audit applies to any row whose "Applied at" carries an `[rN]` mark,
  such as a finding moved into an acceptance criterion. Rows that only record a decision need no new round.

### The application check

Before the re-audit, turn each confirmed fix into its sentences and compare them with the revised text one
by one. A keyword search is not a comparison. The table lives in the same `reconcile-rN.md`:

```markdown
## Application check
| Item | Sentence | Result |
|---|---|---|
| HIGH-2.1 | The count excludes deleted rows. | applied |
| HIGH-2.2 | The total comes from the same query. | missing |
```

The last column is `applied` or `missing`. A `missing` sentence is an application gap, not a new HIGH: apply
it and correct the row. A fix for a HIGH does not close while any of its sentences is missing. The table goes
to the short re-audit as an input, and the auditor compares the sentences again independently.

## Closed items

From round 2 on, the auditor runs `harness audit closed`. It prints the closed decisions from the reconciliation
tables, the items moved in the newest round, and the application check, so nothing has to be copied by hand. Each
entry has only the finding id, the decision, the evidence and where it was applied.

**The auditor stays independent.** That output is what it receives about earlier rounds, and it does not open
`audit-r*.md`, `reconcile-r*.md`, `decisions-*` or lens reports. The dispatch adds no account of why the design is the
way it is, no argument from the side that fixed it, and no trend of HIGH counts. Paragraphs it has not seen, and
anything outside the list, get a fresh look as before.

The auditor may raise a closed item again in only two cases: the paragraph or the cited code changed after
the decision, or new evidence at `path:line` overturns the decision's grounds. It names the item and what
differs. Anything else is not counted as a finding, and the report gives the number on one line.

**The auditor does not overturn an owner decision.** A new risk from a decision goes under `## Owner re-check
needed`, not HIGH, and a real contradiction in numbers or safety goes there with its evidence for the owner. The gate
checks that each item names a real owner row, so a decision the owner never made cannot silence a finding.

## Runtime behaviour goes to tests

Deadlocks, races, state transitions over time, timing and retries show only in a run. Do not keep revising the
document to settle a doubt of that kind. Record it as `test-transfer`, move it to the F-x acceptance criterion,
P7 scenario or P9 check that will exercise it, and write that place under "Applied at".

**It stays HIGH when the text alone proves that the design cannot work:**

| Move to testing | Stays HIGH |
|---|---|
| Two writers might deadlock on the lock order | The schema has no column for a value F-3 must show (`05-contract.md:40`, `03-feature.md:88`) |
| A retry could overload the service during an outage | The lease is 15 seconds and the heartbeat every 30, so every lease expires (`05-contract.md:12`) |
| A state change might arrive before the record it updates | Two documents make different roles the owner of the same data |

## The carry-over ledger

MED and LOW findings that implementation can settle are recorded as `carried`, with the settled reading in the
Reason cell and the target node under "Applied at". The ledger is the set of `carried` and `test-transfer` rows;
`harness audit status` prints it as `carryItems`, each with a token such as `AUD-r3-MED-5`. There is no second
file to keep in step. From P7 on:

1. P7 puts each token in the plan of the wave that will handle it.
2. P8 writes the token in that wave's acceptance criteria: `harness wave create --accept "AUD-r3-MED-5 drafts stay out of the count"`.
3. P9 verifies it like any other criterion. `harness report rtm` lists every token and marks the open ones. The P9 and
   P10 review packets show them as blockers.

**A HIGH moved to testing closes differently.** A completed wave does not close it, because a wave completion records no
verification. It closes only when the newest verdict for its token across the `conformance-rN.md` files is a table row with `holds`. Until then
`harness ship verdict` refuses to pass. A `test-transfer` MED or LOW needs a completed wave, or the verdict refuses as well.
A `carried` item is only shown; it never blocks shipping.

## Who judges a move

The side that fixes the design only proposes a move, so the gate holds it to these rules:

- A HIGH cannot be `carried`. Carrying is for MED and LOW, and the gate refuses a table that lowers a severity.
- A HIGH recorded as `test-transfer` stays open in that round. The next round's auditor judges it under
  `## Classification check`. With `upheld` it leaves the count and stays visible in the review packet, and P9 closes it
  as above. With `overturned` it must be a HIGH row of that round's findings table.
- Both `carried` and `test-transfer` need a reason and a target.
- The auditor may also overturn a moved MED or LOW by raising it as a HIGH with evidence.

## Reversal conflicts

Stop fixing and go to the owner when a decision on one topic is being reversed for the second time, or when the
direction of a new finding's fix collides with a closed decision or an earlier round's fix. Show both sides'
evidence together, and let the owner pick one. The answer is a closed decision and follows "Closed items".

The main session watches for this when it writes the reconciliation table. The auditor reports it as `RC-n` under
`## Reversal conflicts` and does not count it as HIGH. The gate refuses a round until each `RC-n` has an
`owner-decided` row with the reason. Because that row means the document changed, a short re-audit follows.

## Moving to this version with rounds in progress

`harness init` starts a project on the new format. An older project records, once, the last round that existed when the
new version first saw it: at the next session start, or at P6 submission at the latest. Rounds up to that number stay as
they are: without an `Audit-Kind:` line they count as full audits, `HIGH N` comes from the last line, and the format checks
do not apply. Every later round needs the line. The number is kept in `state.json` and the journal, which agents cannot write.

The cap counts old rounds, so a project already past three needs the owner's decision for another full audit, while short
re-audits stay open. An approved P6 gate is not reopened by the upgrade. If the newest old round has no `HIGH N` line, a
resubmission needs a short re-audit first, by this rule; the gate only reads the file as it stands. If it has open HIGH findings, the owner can accept them with one `owner-accepted`
row per HIGH in that round's table, or a short re-audit can follow.

## Known limits

The main session writes the merged round file, so the code cannot prove that an auditor wrote an `upheld` line or copied every
lens finding, and a round edited consistently before submission is not detected. Old rounds are trusted as they stand: the
format record fixes their numbers, not their content, so adding a `HIGH 0` line to an old round is not detected. Short re-audits
have no cap. The gate cannot judge whether a revision is truly non-structural; that line comes from the auditor. `harness audit
closed` prints the reason cell as evidence, so keeping arguments out of that cell rests on the table rule above; the code does
not filter it.

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
mandatory input — see those phases. The cap, risk acceptance and moves to testing above belong to the design
audit; the conformance audit still needs `HIGH 0`.

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
# → application check in reconcile-r1.md → dispatch design-auditor again → audit-r2.md
```

When findings span several phases, fix **from the highest phase down**. Fixing P1 changes P3 with it.

## Procedure (once the audit passes)

```bash
harness doc upsert --id DOC-P6 --path .harness/audit/audit-r2.md --phase P6 --refs F-12,UX-7
harness doc url DOC-P6 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P6              # refused without artifact_url
# P6 is the final approval of the whole design — put every design document under review so their hashes are pinned
# the newest audit round ends with "HIGH 0" and every reconcile-rN.md goes with it, or the gate refuses;
# `harness audit status` shows what is missing
harness gate submit P6 --evidence claimed --paths .harness/audit/audit-r2.md,.harness/audit/reconcile-r1.md,\
.harness/design/00-concept.md,.harness/design/01-domain.md,.harness/design/02-module.md,\
.harness/design/03-feature.md,.harness/design/04-experience.md,.harness/design/05-contract.md
# → present .harness/packets/P6.md → raise the dialog for the final design approval
harness doc approve DOC-P6
harness phase set P7                   # source writing opens from here
```

Run `harness report rtm` and `harness gate sweep` before submitting — they catch uncovered stretches
and tampered approved documents **before** you ask for approval.

## Approval is a human's

**An agent never approves P6 on its own.** Run `harness gate approve P6` alone on one line from the main session: the hook raises a confirmation dialog and the user answers it. Do not ask the user to type anything; only if the hook refuses the dialog, the user types `/king-wjang-harness:approve P6`. Once it is allowed, run `harness phase set <next>` and carry on without asking again. This is the "design done, start building" button
and it is the most expensive one to undo. Summarise the audit verdict, `HIGH N` per round, the
reconciliation tables, the owner decisions and their answers, every HIGH whose risk this approval accepts,
every HIGH moved to testing, the carry-over ledger, the re-raised count, the unresolved items, and the
uncovered stretches of the RTM honestly, and let the user approve it themselves.

## Pitfalls

- **Never give the audit agent write access.** `design-auditor` is read-only. Fixing findings is the
  main session's job, and if the fixer re-audits, the confirmation bias comes straight back.
- **Never pass without a re-audit.** If you got `needs revision` and fixed it, run a new round
  (`audit-r2.md`), short or full by the rules above. Reusing a round number erases what was looked at and when.
- **Never reach HIGH 0 by editing the count.** A HIGH leaves the count only by being applied, by
  "not accepted" with a reason in the reconciliation table that the next round's auditor accepts, by a move
  to testing that the next auditor upholds, or by the owner's approval. Lowering a severity is not a fix. The
  gate compares the last line with the findings table and the table with the audit.
- **A short re-audit still looks for new risks.** Checking only "was HIGH-2 fixed" misses the risk the
  fix introduced; that is the most common way a second-round HIGH ships.
- **Several files in `--paths` are comma-separated with no spaces.** If you need to wrap the line, join
  it with `\` and break after a comma. If even one file cannot be read, the submission itself is refused.
- **`gate approve` is refused if a file changed after submission, or if a new round appeared.** Do not touch the documents after
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
