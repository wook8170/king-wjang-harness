# Changelog

All notable changes to king-wjang-harness are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`harness --version` prints the version below — include it in bug reports.

## [Unreleased]

Round 3-I of the release-readiness audit. The full defect ledger lives in
`docs/release-readiness/2026-08-21/ledger.md` (not shipped in the package).

### Fixed — enforcement

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
- Latency claims now state the measurement surface. In-process p95 is 2.6 ms (18.9 ms on the
  journal-replay fallback with a 100k-entry journal); end-to-end wall-clock adds your machine's
  Node startup, which dominates the number and is not a property of this tool.

### Fixed — messages

- Refusals now name the real cause and a command you can actually type: a missing file is no
  longer reported as "outside the project", `profile cmd` points at the project-local profile
  instead of the bundled one, and phase arguments no longer leak `undefined`.
- `usage tier` records downgrades, so a one-off measurement no longer injects stale guidance
  into every future session.

### Added

- A configuration section in all four READMEs covering every `.harness/config.yaml` key,
  including the four that decide what the hook blocks.
- MCP tool documentation in all four READMEs.
- This changelog.

## [0.0.1]

First release. Core engine, 13 phase gates, design/build/ship tracks, hooks, MCP server,
and the design-system toolchain. See `README.md` for what it does and what it deliberately
does not do.
