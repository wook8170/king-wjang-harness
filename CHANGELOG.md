# Changelog

All notable changes to king-wjang-harness are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`harness --version` prints the version below — include it in bug reports.

## [Unreleased]

Nothing yet.

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
