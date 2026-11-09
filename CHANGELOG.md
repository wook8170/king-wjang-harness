# Changelog

All notable changes to king-wjang-harness are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`harness --version` prints the version below — include it in bug reports.

## [Unreleased]

### Changed — the confirmation dialog for gate approval

The dialog path added in 0.1.8 is now the main way to ask for approval from the main session, and its guards are tighter.

- `harness gate submit` now names the dialog next to the slash command.
- **`auto` no longer raises the dialog.** That mode can run with nobody at the prompt, so the hook refuses and points to the slash command. Only `default` and `acceptEdits` raise it.
- The dialog opens with what is being approved and what happens next, on one line. The agent's own description and other tool input no longer reach the dialog.
- A dialog ticket lasts 10 minutes (it was 30), is claimed atomically, and the command now carries `--project`, so it opens the gate that the dialog showed.

### Changed — fewer things for the owner to do

- After `gate submit`, the guidance tells the agent to run `harness gate approve <P>` itself, so the owner only answers the dialog. Skills, MCP messages and refusals say the same. The slash command stays as the fallback when a dialog cannot appear.
- Refusals name the exact next line: the plain command, `gate submit` first, or `phase set` when the gate is already approved.
- After approval the CLI prints the `harness phase set <next>` line and tells the agent to carry on without asking again.
- A dialog that was just raised and not allowed is not raised again with the same content for two minutes.
- `loop critical clear` no longer asks the owner to type it. The owner gives the decision and the agent clears the escalation.

### Fixed — ways to approve without a person

- **A TTY made by a program counted as a person.** A `python3` pty around `harness gate approve P0` passed the hook, and the CLI approved the gate with `via: terminal`. The terminal path and `HARNESS_APPROVE_NO_TTY` now refuse inside a Claude Code tool call (`CLAUDECODE` or `CLAUDE_CODE_ENTRYPOINT` set), and the hook refuses commands that type the approval for a person or make a terminal for it (`script`, `expect`, `tmux`, `screen`, `osascript`, `orca`, `paseo`, `pty`).
- **Names that differ only by case** reached the approval ticket and the journal on a case-insensitive disk (`.harness/.runtime/APPROVE-TICKET`). They are now judged as the same file.
- **Unpacking and copying over the project** could put `.harness/state.json` or the ticket in place without naming them. The hook now refuses an archive holding `.harness` unpacked over the root or a parent, an archive it cannot read there, any unpacking inside `.harness`, and copies that cover `.harness` (`cp -R x/. .`, `rsync -a x/ ./`, `ditto x .`, `git clone x .`). An archive without `.harness` can still be unpacked at the root.
- **Writes run from inside `.harness/.runtime`** could name the ticket indirectly (`curl -O`). Only read-only commands pass there now.

### Behavior to expect

- A person who sets `HARNESS_APPROVE_NO_TTY=1` at the Claude Code prompt (`!`) is refused. Use the slash command. A real terminal or CI outside Claude Code still works.
- `tar -xf a.tar` at the project root now reads the archive first, for up to 3 seconds. An archive that cannot be read in time is refused, so unpack it into a subfolder.

The P6 design audit now has an end condition and a limit on how often it repeats, and the gate checks them.
Real projects ran 16 and 7 rounds with four auditors in each, because the only exit was "newest round HIGH 0",
and fixing a MED or LOW finding forced another four-lens round.

### Changed — when the P6 audit ends

- **HIGH 0 ends it.** MED and LOW go into the reconciliation table. If documents changed at that point, only
  the changed paragraphs get a short re-audit.
- **HIGH is narrower.** A finding is HIGH only when it blocks implementation or would be hard to reverse (public
  contract or stored format, data loss or migration, security or permission boundary, product scope conflict), and
  has checkable evidence: `path:line`, `repro:`, or a document citation with a scenario step for UX findings.
- **Short re-audits** are allowed for any revision that keeps the structure. `skills/phase-p6-audit/SKILL.md` lists
  what counts as structural, and the short round's auditor writes `structural change: yes|no`.
- **At most three full audits, counted over the whole project.** `audit_full_round_cap` in `.harness/config.yaml` changes
  the number, and only a value matching the pinned policy baseline is used. With HIGH findings left at the cap, the owner
  picks for each: fix and re-audit, accept the risk, or approve another full audit. This is not an automatic pass.
- **Closed items stay closed.** The auditor reads closed decisions from `harness audit closed`, and nothing about the
  design's reasoning or HIGH trend. A closed item can return only when its text or code changed, or with new evidence at `path:line`. Owner
  decisions are not overturned; they can only be flagged for the owner.
- **Runtime doubts go to tests.** Deadlocks, races and timing become `test-transfer` items instead of more revisions,
  unless the text alone proves the design cannot work.
- **Carry-over ledger.** `carried` and `test-transfer` rows are collected by `harness audit status`. Their `AUD-r…` tokens
  go in wave acceptance criteria, and the RTM marks the open ones. `carried` items are only shown.
- **Reversal conflicts** stop the fixing and go to the owner, who picks one side.
- **Application check.** Confirmed fixes are compared with the revised text sentence by sentence before a re-audit.

### Added

- `harness audit status` (read-only) prints the rounds, the full audit count, the ledger, what blocks the gate and the next step.
  `harness audit closed` prints what the next auditor receives.
- `state.json` records the audit format. A project started with `harness init` needs `Audit-Kind:` on every round.
- `harness gate submit P6` and the approval now refuse a round with open HIGH findings, a last line that disagrees with the
  findings table, a lowered severity, a full audit beyond the cap, a finding with no reconciliation row, a HIGH with no
  checkable evidence, an unresolved reversal conflict, or a missing application check. P6 also needs at least one audit round
  in `.harness/audit/` now.
- HIGH findings cannot be carried. A HIGH moved to testing stays open until the next round's auditor upholds it under
  `## Classification check`; an overturned move must return as a HIGH.
- `owner-accepted` and `owner-decided` rows take effect only with the owner's P6 approval. They appear in the review packet
  and the approval dialog, and the approval event records them as `auditAcceptedHighs` and `auditOwnerDecisions`. The slash
  command and the terminal list them and refuse until `--accept-risk` is given. No new approval path was added.
- An `## Owner re-check needed` item must name a real owner row, or it counts as an open HIGH.
- `harness ship verdict` refuses a HIGH moved to testing until the newest verdict across the `conformance-rN.md` files marks its token `holds`, and a
  `test-transfer` MED or LOW until a completed wave carries its token.

### Upgrading with rounds in progress

An older project records, once, the last round that exists at its next session start or P6 submission. Those rounds are read
as they are: no `Audit-Kind:` line means a full audit, and `HIGH N` comes from the last line. They count toward the cap. Later
rounds need the line. An approved P6 gate is not reopened. A resubmission whose newest old round has no `HIGH N` line is refused
until the last line reads `HIGH N`; the rule is to run a short re-audit, but old rounds are trusted as they stand, so the gate cannot
tell a re-audit from an added line. A P6 submitted before the upgrade is judged at approval and may need resubmitting.

### Known limits

The main session writes the merged round file, so the code cannot prove that an auditor wrote an `upheld` line or that every
lens finding was copied, and a round edited consistently before submission is not detected. The `holds` row is written the same
way. Old rounds are trusted as they stand. `harness audit closed` prints reason cells unfiltered, so keeping arguments out of them
rests on the written rule. Typing `--accept-risk` the first time skips the list on the slash path. Short re-audits have no cap. The gate cannot judge whether a revision is truly non-structural; that line comes from the
auditor.

### Planned

- One place for each fact: a canonical location plus a mechanical check for duplicates, so that one fix does not
  have to spread across documents (the cause of rounds r8 and r9 in the measured project). Not in this change.
- Comparing lens reports with the merged round file, so that a HIGH cannot be dropped while merging. Not in this change.

## [0.1.8] — 2026-11-06

Gate approval no longer requires typing a versioned cache path into a terminal.

### Added — two approval paths

- `/king-wjang-harness:approve <P>`: a user-only skill (`disable-model-invocation: true`). A new
  `UserPromptExpansion` hook issues a short-lived ticket when the user types it.
- Confirmation dialog: when an agent runs `harness gate approve <P>` alone on one line, the hook returns
  `permissionDecision: "ask"`. The dialog shows the phase, the artifacts, the evidence grade and the hash.
  `updatedInput` adds a single-use ticket; only its hash is stored.
- The hook refuses the dialog in modes other than `default`, `acceptEdits` and `auto`, in `-p` and SDK
  sessions, for subagents, for chained or altered commands, and when an allow rule covers the command.
- `gate-approved` events record `via`: `terminal`, `dialog`, `slash` or `no-tty`.
- `harness doctor` warns when a `permissions.allow` rule covers `harness gate approve`.

### Changed

- Guidance no longer prints the absolute path, which contains the plugin version. Approval points to the
  slash command. Other human-only commands print `!harness …`, which runs at the Claude Code prompt.
- `harness_gate_approve` over MCP still refuses; its message now names the slash command.
- `.harness/.runtime/approve-ticket` is protected like other harness-owned files.

### Known limits

The approval paths do not prove that a person is the caller: Claude Code receives the dialog's answer and
the hook never sees it. A declined dialog leaves no record. Remote Control was not reproduced.

## [0.1.7] — 2026-11-05

Prepares the plugin for Anthropic's plugin directory. No hook, CLI or MCP behavior changes.

### Fixed — the directory could not validate the repository

`.gitattributes` used `export-ignore`, and the directory stops validating any repository whose
`.gitattributes` holds `export-ignore`, `export-subst` or `filter`. The lines are gone. They never
took effect for Claude Code users anyway: Claude Code installs the plugin with `git clone`, and the
installed copies of 0.1.2 to 0.1.5 contain `progress.md` and `.github/`. A new test (`DIR-01`) keeps
those attributes out. The superseded audit `docs/release-readiness/readiness.md` now says at its top
that it ships with the repository.

### Fixed — two test files read as binary

`core/test/design.test.ts` and `core/test/tokens.test.ts` held literal NUL bytes inside string
literals. The directory treats such files as binary and holds them for review. They now use the
`\x00` escape, which gives the same string. A new test fails if any tracked text file holds a NUL byte.

### Changed — listing metadata and disclosures

- `plugin.json` gains `displayName`, `license`, `homepage`, `repository`, `icon`,
  `documentationUrl`, `supportUrl` and `privacyPolicyUrl`. The author name is written in one script
  (`Wook Jang`), as the directory requires.
- README (English and Korean) gains a "What it runs, sends, and fetches" section, and `PRIVACY.md`
  states that the plugin collects and sends no data.
- The `king-wjang-harness` skill now asks the user before it installs a companion plugin, instead
  of installing missing companions on activation.
- The companion table points to the `wook8170-plugins` marketplace for
  `verifying-production-readiness` (it is not an Anthropic plugin), and to
  `lanekeeper:quality-ux-adversarial`, the new name of the wb plugin's review skill.

## [0.1.6] — 2026-11-05

### Added — plugin icon

`.claude-plugin/icon.svg` and `.claude-plugin/icon.png` (1024 px, rendered from the SVG with
`rsvg-convert`). The icon follows the same family as the wb icon: a dark slate rounded square with
one accent color and no text. It shows a staircase of phases that stops at one gate bar.
`claude plugin validate --strict` no longer reports `ICON_MISSING`.

### Changed — the two design specs read more plainly in Korean

`docs/superpowers/specs/2026-08-20-king-harness-design.md` and
`docs/superpowers/specs/2026-08-26-multiagent-p8-design.md` were rewritten sentence by sentence to
drop the four hard-to-read forms (missing connecting words, over-personified things, three or more
nouns in a row, long gaps between paired words). Meaning, figures and identifiers are unchanged.
Every line was edited in place, so line numbers still match; the P8 plan cites
`sed -n '70,80p'` of the P8 spec and still points at §4. Documentation only; no command or hook
behavior changes.

## [0.1.5] — 2026-11-03

### Changed — four hard-to-read Korean sentence forms are banned in produced prose

The main skill, the phase skills that write documents or reports (P0~P6, P9, P10, P12) and the
four agents that return written findings (`design-auditor`, `readiness-auditor`, `researcher`,
`wave-verifier`) now end with a writing rule: no missing connecting words, no over-personified
things, no three or more nouns in a row, no long gap between paired words. Instruction text only;
no command or hook behavior changes.

## [0.1.4] — 2026-11-02

Strengthens the adversarial reviews at both ends of the build: the design audit before P7 and the
ship verdict after it, and makes the core block high defects the same way it blocks blockers.

### Changed — `harness ship verdict` and the P10 submission block high defects

A `high` defect ("certain to become a problem right after shipping") used to have no effect on the
verdict, so a high finding of the pre-ship UX review could sit on the ledger while the verdict said GO.
Now `high` follows the blocker rule: `open` and `fixed` both block, and only `verified` or a `deferred`
with a reason closes it. The same rule (`shipBlockingDefects`) also refuses `harness gate submit P10`
while such a defect is left, naming each id with its severity and status. `medium` and `low` do not
block. Regression tests: open high, fixed high, verified/deferred high with medium and low (GO), and
the P10 refusal — the open-high, fixed-high and P10 tests fail on 0.1.3.

### Changed — P6 enters P7 only at HIGH 0

- `design-auditor` checks the code a design cites, not only its sentences, and gives both locations as
  evidence. Every report ends with the line `HIGH N`.
- Each fix round marks its changed paragraphs (`[rN]`) and carries `.harness/audit/reconcile-rN.md`
  (finding → accepted or not → where applied, with a checkable reason when not accepted), and is
  re-audited in a new round. A round that only fixed HIGH findings may be re-audited on those
  findings, but the new risks of the revision are always checked.
- The P6 gate is submitted only on a round that ends with `HIGH 0`. Owner decisions found by the audit
  are collected and confirmed before the gate.
- The UX walkthrough lens names personas, walks their real task scenarios end to end, records on each
  screen what the persona understood and is about to do, and reports all nine UX axes: logic errors,
  information consistency, user context, flow context, first-time user getting lost, the next action,
  a way out of errors and exceptions, accessibility with narrow width and dark theme, design system
  visual comparison.

### Added — the post-implementation conformance audit (P9 → P10)

- A fifth `design-auditor` lens, implementation conformance: the changed code read against the approved
  design, every invariant located as `file:line`, holds or breaks, ending with `HIGH N`. P9 runs it
  before the build track closes (`.harness/audit/conformance-rN.md`); a HIGH loops back to P8.

### Changed — P10 and P12 take two adversarial reviews as mandatory inputs

- P10: the conformance audit and a changed-screen UX adversarial review (a checker from another
  context, isolated stack, headless 2x captures, persona task scenarios, the nine axes including design
  system visual comparison — touching spacing, tight line height, mixed type size or weight, table row
  height, button and badge size) are required before `readiness-auditor` is dispatched. Findings go onto
  the defect ledger (`UXA-*`, `CONF-*`); an open or only fixed `high` blocks the P10 gate. Findings that
  change a screen are put to the user in one remotely viewable artifact (table and captures) before any fix.
- P12: both inputs are re-checked for the shipping commit (re-run on screens and code changed after
  P10); a missing input or an open high is a NO-GO. The release notes carry the review results.
- `readiness-auditor` adds the axis "adversarial inputs" and returns "not ready" when one is missing or
  has an open blocker or high.

## [0.1.3] — 2026-10-31

Ships the changes held under Unreleased since 0.1.2, plus a reference to an external UX review
skill. The version moves so that `claude plugin update` picks the release up — it compares version
strings, not commits.

### Added — P9 and P10 point to the adversarial UX review in the wb plugin

The pre-ship adversarial UX review lives in the wb plugin as `wb:quality-ux-adversarial`; this
harness does not keep a second copy of its criteria. P9 and P10 name it among their companion skills
(when the wb plugin is absent, the same criteria go into the project's own brief), and the driver
skill's companion table gives its install command.

### Changed — exit codes now separate "the verdict is no" from "the command did not run" ([API-05])

Both used to be `1`. A release script running `harness ship verdict` could not tell
"the product is not ready" apart from "you typo'd the subcommand" or "you ran it in
the wrong directory". The contract is now:

| Code | Meaning |
|---|---|
| `0` | Success / the verdict is yes |
| `1` | Usage or environment error |
| `2` | **The verdict is no** — `ship verdict` NO-GO · `doctor` diagnosis failed · `gate verify` drift · `evidence check` short |

Anything non-zero still trips `cmd || exit 1`, so existing scripts keep working —
the only change is that they *can* now tell the two apart. Written into the tail of
`harness --help` and all four READMEs.

### Changed — the shell rule now blocks execution, not mention ([API-01])

The rule used to deny a command that merely *named* a harness path, including inside a
closed quote or a heredoc body — pinned in `policy.test.ts` as "deliberate over-blocking",
on the premise that narrowing it would open `bash -c "..."`. That premise was disproved by
measurement: with the rule narrowed, all 20 bypass shapes (`bash -c`, `eval`, backticks,
`$()`, `xargs`, newline and prefix forms, absolute paths, direct core invocation) still
fail closed. The contract is now **execution is blocked, recording is not**.

Changed: `echo "run harness doctor --accept-policy" >> README.md` goes from deny to allow.
Unchanged: command substitution is execution even inside quotes, so it is still denied.
This is a security-contract change — the evidence is `evidence/probe-approve.js`
(20 bypasses × 7 legitimate commands).

### Fixed — the MCP schema advertised `goal` as optional and then refused the call ([API-11])

`harness_wave_create` declared no `required` array, so a client reading the schema
could build a call the implementation rejected with `isError: true`. A machine-readable
schema is an advertisement; this one did not match the product. `goal` is now declared
required, and `core/test/mcp.test.ts` pins the schema against the implementation's
actual refusal so the two cannot drift apart again.

## [0.1.2] — 2026-08-26

Ultragoal ship-readiness loop, story G001 (effectiveness axis). Sweep 10 —
a fresh independent adversarial pass — found a critical bypass the previous
nine rounds missed.

### Fixed — a backslash or mid-token quote hid the write target ([SEC-300])

`echo x >> .harness/events\.jsonl` landed on the real journal, but the hook
parsed the target only up to the backslash — `.harness/events` — which slipped
past the exact-name check. Mid-token quotes did the same. This defeated core,
policy, and source protection in every phase, end-to-end (a forged
`gate-approved` event opened `npm publish` without human approval). `tokenize`
is now the single authority that resolves shell quoting and escaping, and the
redirect scanner runs its target through it, so the hook judges the path the
shell will actually write to. Pinned in `bypass-corpus.test.ts`.

## [0.1.1] — 2026-08-26

Round 3-R appraisal-confirmation, sweeps 8 through 9-2. The MCP-write target
extractor was hardened after two independent adversarial rounds each broke the
prior fix — the whole point of implementer-≠-appraiser (OPS-74 §3).

### Fixed — a named write field could hide a second target ([SEC-299])

The hook infers a write tool's target from path-shaped arguments. It looked at
only the top-level string fields, and — worse — short-circuited on `file_path`/
`notebook_path`, so `{file_path: "ok.md", path: ".harness/state.json"}` slipped a
core-file write past every earlier defense. The extractor now recurses into
arrays and nested objects and judges **every** collected target; core/policy
files are checked on all of them, while the design-track source rule applies to
the primary target only so a source-referencing side field no longer over-blocks
a normal document write. The F1/F2/F4 vectors are pinned in
`bypass-corpus.test.ts` and re-measured on every run.

## [0.1.0] — 2026-08-23

First cut of the core engine. Rounds 3-I through 3-L of the release-readiness audit;
independent adversarial appraisers, one per axis, each writing their own checklist.

### Fixed — the same soft spot, eight notations

Writing to a harness-owned file (the event journal, the state cache, the policy file)
was blocked when the path was written out literally — and open under eight other spellings.
Each round closed one and the next round found another:

| Notation | Example |
|---|---|
| literal | `tee .harness/events.jsonl` (blocked from the start) |
| `cd` prefix | `cd .harness && tee events.jsonl` |
| glob | `printf x >> .harness/e*.jsonl` |
| variable in the path | `D=.harness; echo x >> $D/events.jsonl` |
| copying the harness binary | `cp cli.js /tmp/x.js` then running it under a PTY |
| command substitution / braces | `echo x >> $(echo .harness)/events.jsonl` |
| assembled file name | `a=events; b=.jsonl; echo x >> .harness/$a$b` |
| encoded path | `p=$(base64 -d <<< …); printf x >> $p` |

The last three changed the approach rather than the list. The hook now **detects that target
extraction failed** rather than enumerating spellings: if a harness-owned name appears in the
text and no extracted target accounts for it, or if a write target cannot be resolved at all,
the call is refused. Static assignments and known environment variables are expanded first, so
ordinary work (`LOG=build/out.log; echo x >> $LOG`) still goes through the normal judgement.

### Fixed — over-blocking

- Reading the journal was refused. `sed -n`, `awk`, `perl` and `cp <journal> /tmp/backup` are
  reads, not writes; only in-place editing (`-i`) counts. The refusal text also said the command
  "changes" a file it only read.
- Container image references, URLs and scoped package names (`docker push registry.io/app:v1`,
  `@types/node`) were treated as file paths, so a deploy was refused *after* its gate was approved.
- Going back a phase pointed at `harness backtrack`, which pointed back at `harness phase set` —
  the round trip never completed. It does now, and `harness backtrack clear` is discoverable.

### Fixed — one rule, one place

The shell list that decides "what does `-c` mean here" existed in four copies and had already
drifted: `fish -c 'npm publish'` bypassed the deploy block. Hash discipline, build-command
detection, and argument parsing had the same problem. Each is now derived from a single source,
with tests that fail when a copy reappears.

### Added

- `npm run bench:hook` — reproduce the latency numbers from the installed package. It synthesises
  100k-entry journals in three shapes, times the real hook process, prints your machine's `node`
  startup floor next to the table, warns when the machine is busy, and exits non-zero on a real
  regression.
- The UX evidence gate now requires an actual visual artifact. A text file no longer opens it.

### Changed

- Gate G9 measures the cost the replay fallback *adds* (< 50 ms p95) rather than an absolute
  wall-clock threshold, and measures it across journal shapes rather than one friendly sample.
  An absolute threshold on wall-clock measures the machine underneath, not this tool.
- Corrupted journals no longer throw once per line in the replay fallback: 573 ms → 12 ms p95
  on a 100k-entry journal, measured before and after in the same process.

### Known limits

- Enforcement is agent-lane discipline, not a security boundary. A person at their own terminal
  can always edit files directly.
- A freshly installed copy of the package can be run under another name; the final defence there
  is your host's permission dialog.
- The release-readiness verdict is still **not-ready**. The ledger is in the repository.

### Fixed — earlier in the same release (round 3-I)

- An agent could write files with tools that were not on the write-tool list
  (`xxd`, `openssl`, `csplit`, `split` with a positional target), bypassing every write rule.
  The default is now inverted: only known read-only commands are exempt.
- The same hole let an agent overwrite `.harness/config.yaml` and **disarm enforcement entirely**.
- Scripts larger than 64 KB were not read at all before being judged, so padding a script
  past that cap made its contents invisible to the hook. What cannot be read is now refused.
- `harness gate approve` had a single hook-level lock that trivial obfuscation defeated.
  Approval now also requires a TTY — an agent's tool call does not have one.
- `NotebookEdit` targets were never judged (the path lives in `notebook_path`, not `file_path`).
- A dangling symlink hid its target from judgement.
- Bundled profiles (which define what the hook blocks, for every project on the machine)
  could be written because they sit outside the project root.

### Fixed — verdicts that were not true

- A 1×1 PNG opened the UX evidence gate. Evidence is now measured by **dimensions**, not bytes.
- Gate evidence and submission timestamps survive `doctor --repair`; a repaired project now
  reports `ok` from the state **after** the repair instead of before it.
- Latency claims now state the measurement surface. Measured at the time of this change: 2.6 ms p95
  in-process (18.9 ms on the journal-replay fallback with a 100k-entry journal); end-to-end
  wall-clock adds your machine's Node startup, which dominates the number and is not a property of
  this tool. **Absolute figures belong to the machine that produced them** — run `npm run
  bench:hook` for yours. The README quotes the most recent run, so the two differ by design.

### Fixed — messages

- Refusals now name the real cause and a command you can actually type: a missing file is no
  longer reported as "outside the project", `profile cmd` points at the project-local profile
  instead of the bundled one, and phase arguments no longer leak `undefined`.
- `usage tier` records downgrades, so a one-off measurement no longer injects stale guidance
  into every future session.

### Added — earlier in the same release (round 3-I)

- A configuration section in all four READMEs covering every `.harness/config.yaml` key,
  including the four that decide what the hook blocks.
- MCP tool documentation in all four READMEs.
- This changelog.

## [0.0.1]

First release. Core engine, 13 phase gates, design/build/ship tracks, hooks, MCP server,
and the design-system toolchain. See `README.md` for what it does and what it deliberately
does not do.
