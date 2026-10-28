---
name: security-verify
description: Use when a version needs its security check — running the per-version security round (dependency audit, security headers, ZAP baseline and authenticated active scan, authorization-denial sweep, manual scenarios), triaging false positives, and producing the results workbook that the P10/P12 gates and harness ship verdict require. Triggers - "run the security check", "security results for this version", "DAST", "ZAP scan", "permission sweep", a gate refusal that says it needs a passing security result, a version bump before shipping, .harness/profile/security.yaml.
---

# security-verify — one security round per version

## Overview

The ship track will not open without a passing security result **for the current version**:
`harness gate approve P10`, `harness gate approve P12` and `harness ship verdict` all read the same
condition. Bump the version and the gates block again until the round is run for the new version.
This is deliberate — a check that ran on the previous version says nothing about this one.

The pass criteria are fixed in the core and cannot be configured:

| Criterion | Pass |
|---|---|
| Unresolved High | 0 — a High closes only by a fix or an evidenced false positive |
| Unaddressed Medium | 0 — fixed, false positive, or accepted with a named approver |
| Authorization denial | 100% of unprivileged-role calls on the selected routes are refused |
| Results workbook | `security-results-<version>.xlsx` exists and was built from the current results |

Plus: every step (deps, headers, authz, manual, zap-baseline, zap-active) must have completed.
"No result" is not a pass.

## Where things live

| Path | Who writes it | What |
|---|---|---|
| `.harness/profile/security.yaml` | **A human** (policy area — the hook blocks agent writes, `doctor` watches its hash) | Targets, roles, route command, stack commands, ZAP image |
| `.harness/security/<version>/` | The runner and `harness security report` | One folder per version: raw results, workbook, `summary.json`, `defects.md` |
| `.harness/security/<version>/triage.yaml` | The agent, reviewed by a human | False-positive and acceptance decisions with reason and evidence |

If the configuration is missing, **ask the user to create it** from the template below — do not try to
write it yourself (the hook refuses, and it should: the allowlist is the safety device).

## Configuration template

```yaml
# .harness/profile/security.yaml
version_from: package.json            # a .json file's "version", or the first line of a text file
# results_dir: .harness/security       # default
allow_hosts: [127.0.0.1, localhost]    # loopback, private ranges and test names only
allow_ports: [9911]                    # recommended: pin the isolated stack's ports
targets:
  - { name: web, url: "http://127.0.0.1:9911" }
stack:                                 # isolated stack — never the owner's dev or production servers
  up: "PORT=9911 node server.js"
  down: ""                             # optional; the runner also stops the process group it started
  ready_url: "http://127.0.0.1:9911/health"
  ready_timeout_s: 60
roles:                                 # passwords only through ${ENV}; literal passwords are refused
  - name: viewer
    login: { method: POST, url: "http://127.0.0.1:9911/api/login",
             body: '{"user":"viewer","password":"${SEC_PW_VIEWER}"}',
             token_from: "json:token", use: "Authorization: Bearer {token}" }
  - { name: anonymous, deny: ["^/api/"] }  # no login = unauthenticated caller; `deny` overrides routes.include for this role
  - name: admin
    privileged: true                   # excluded from the denial sweep; usable for the active scan
    login: { url: "http://127.0.0.1:9911/api/login", body: '{"user":"admin","password":"${SEC_PW_ADMIN}"}',
             token_from: "json:token", use: "Authorization: Bearer {token}" }
routes:
  command: "node scripts/list-routes.mjs"   # prints OpenAPI JSON, a JSON list, or "METHOD /path" lines
  include: ["^/api/admin"]                  # routes every unprivileged role must be refused on
  exclude: []
  deny_status: [401, 403, 404]
manual: { file: security/scenarios.json }
zap:
  image: "zaproxy/zap-stable@sha256:<digest>"  # pinned; find it with docker image inspect --format '{{json .RepoDigests}}'
  baseline: [web]
  baseline_minutes: 1
  active: { target: web, role: admin, openapi: docs/openapi.json, max_minutes: 10 }
  network: auto                        # linux: host network · elsewhere: host.docker.internal
deps: {}                               # or { command: "pnpm audit --prod --json" }
headers: { targets: [web] }            # optional: require: [content-security-policy, ...]
e2e_ledger: docs/e2e/*.cases.json      # optional: adds the E2E security cases sheet
```

A product with no network surface writes `applies: false` and a `reason` instead. That is recorded and
visible to the approver — an opt-out without a reason is refused.

Manual scenario file — each entry is one request and the statuses that count as "blocked as intended":

```json
[{ "id": "M-01", "category": "auth bypass", "scenario": "no session on a private API",
   "method": "GET", "path": "/api/me", "expect": [401] },
 { "id": "M-02", "category": "workspace boundary", "scenario": "viewer edits another workspace",
   "role": "viewer", "method": "PATCH", "path": "/api/ws/other", "body": {}, "expect": [403, 404] }]
```

## Procedure

```bash
harness security target http://127.0.0.1:9911/       # sanity-check the allowlist first (exit 2 = refused)
SEC_PW_VIEWER=... SEC_PW_ADMIN=... \
  node "${CLAUDE_PLUGIN_ROOT}/core/dist/security-run.js"      # all steps; exit 0 passed · 2 not passed · 1 error
# re-run selected steps only: --only headers,authz   ·   skip: --skip zap-active
harness security verdict                             # what still blocks, by name
harness security defects                             # unresolved High/Medium as `ship defect add` lines
```

Then, for each finding:

1. **Real defect** → register it with the printed `harness ship defect add` line, fix it within the
   defect ledger's scope, and **re-run the round** (`--only <step>`). A fix is a claim; the re-run is the
   observation.
2. **False positive** → add a decision to `triage.yaml` with the reason and evidence (`file:line`,
   commit, or a re-run log), then `harness security report`:
   ```yaml
   decisions:
     - key: zap:90003            # the Key column of the Findings sheet
       status: false-positive    # fixed | false-positive | accepted
       reason: the flagged tag is an example snippet shown to users, not a loaded script
       evidence: src/embed/codegen.ts:68
   ```
3. **Risk to accept (Medium/Low only)** → `status: accepted` with `approved_by: <person>`. That is the
   user's decision, not yours: ask, and record who decided. A High cannot be accepted.

Finally attach the folder to the gate:
`harness gate submit P10 --evidence measured --paths .harness/ship/readiness.md,.harness/security/<version>/summary.json`.

## Safety rules

- **Only the isolated stack.** Every request and every ZAP target goes through the allowlist check
  first; anything outside stops the run before a single request is sent. Production and external hosts
  cannot be put on the allowlist, not even by configuration.
- **Never point the round at a server someone else is using** (the owner's dev server, a shared
  preview). Start your own stack on your own ports via `stack.up`.
- **Secrets stay out of the results.** Passwords come from environment variables; the runner redacts
  them and every issued token from the whole round folder at the end. Do not paste tokens into
  `triage.yaml` or the defect ledger.
- **The ZAP image is pinned** (tag or digest) and runs with external callbacks (OAST) and update checks
  off. Containers are named `kwh-sec-<pid>-<n>` with label `kwh-security=1`; if a run is killed, remove
  leftovers by name (`docker rm -f <name>`), and stop stray stack processes by PID — never by pattern.
- **Browsers, if a scenario needs one, run headless.**

## Pitfalls

- **Do not edit the raw results to make a finding disappear.** The verdict re-judges the raw files on
  every call and checks that the workbook was built from them; the honest paths are a fix plus re-run, or
  a triage decision with evidence.
- **The workbook goes stale.** Changing `triage.yaml` after `harness security report` makes the verdict
  say so — run the report again.
- **The route command is the coverage.** A new API that the command does not print is not swept. Prefer
  a command that reads the router or the OpenAPI document over a hand-kept list.
- **This is a self-assessment.** The workbook cover says it does not replace a third-party assessment —
  keep that line when you present the results.
