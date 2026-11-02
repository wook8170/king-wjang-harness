# Changelog

All notable changes to king-wjang-harness are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`harness --version` prints the version below — include it in bug reports.

## [Unreleased]

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
