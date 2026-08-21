---
name: phase-p11-deploy
description: Use when driving P11 (DEPLOY) of the harness ship track — running the production deployment, verifying it with a real smoke and canary run, then registering the deployment record with harness ship deploy and putting it up for the gate. Triggers - "let's deploy", "push it to production", harness phase set P11, submitting the P11 gate, smoke tests, canary, deployment records, deployments.yaml, rollback.
---

# P11 DEPLOY — deployment and verification by real use

## Overview

**Until P10 is approved, deploy commands are blocked by the hook** (§4-2). There are three things to
do here: deploy → verify with a real smoke and canary run → **register the deployment record**.

A deployment record exists not as a log but for **traceability back** (§3-7) — to answer "which
deployment carried this requirement", the commit SHA, version, environment, and verification evidence
have to sit on one line together. An unrecorded deployment leaves the deployment column of the RTM
empty forever.

## Before deploying

```bash
harness ship verdict          # re-confirm the P10 approval and 0 open blockers here
harness gate verify P10       # confirm the approved artifacts have not been tampered with
harness profile cmd deploy    # the deploy command comes from the profile — do not hand-roll it
```

| Check | Why |
|---|---|
| Rollback path | Whether the rollback procedure the operations ADR settled is **actually callable**. "There is a rollback button" is not measured until you press it |
| The commit being deployed | `git rev-parse HEAD` — the SHA you pin in the record must be **the commit that actually went out** |
| Environment | `production` / `staging`. The ledger must be able to say which environment the smoke evidence came from |

## Smoke · canary

Verification right after a deployment is **a real run.** Quiet logs are silence, not verification.

- Walk the core user scenarios **through the product, end to end** (Iron Rule 3). Do not substitute a
  static check.
- If there is a UI, capture it **headless at `deviceScaleFactor: 2`**. A visible window steals focus
  from the user's own screen, and at 1x the text smears in a remote review, so a regression cannot be
  caught by eye.
- Take the canary **within a range you can undo** first. Full cutover comes after the canary is observed.
- The smoke log and capture paths become the `--evidence` values of the deployment record.

## Procedure

```bash
$(harness profile cmd deploy)           # the deploy command the profile gives
# → real smoke and canary run → leave the logs and captures in .harness/ship/evidence/
harness ship deploy --version v1.2.0 --sha "$(git rev-parse HEAD)" --env production \
  --evidence .harness/ship/evidence/smoke.log,.harness/ship/evidence/canary.png
harness doc upsert --id DOC-P11 --path .harness/ship/deployments.yaml --phase P11 --refs F-12
harness doc url DOC-P11 https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P11              # refused without artifact_url
harness gate submit P11 --evidence measured \
  --paths .harness/ship/deployments.yaml,.harness/ship/evidence/smoke.log
# → present .harness/packets/P11.md → wait for the user's approval
harness doc approve DOC-P11
harness phase set P12
```

An empty commit SHA, environment, or version is refused by the core — a record you cannot trace back
through is not a record.

## Approval is a human's

**A human presses `harness gate approve P11`. An agent never approves on their behalf.** Deploying is
the most expensive action to undo. Present the smoke and canary results and the rollback path, then
wait. If the evidence grade is not `measured`, the core refuses first.

## Pitfalls

- **Deploy without recording it and P12 is blocked.** The checklist's deployment column stays empty and
  the RTM cannot answer "which deployment carried this". Run `harness ship deploy` immediately after
  deploying — batch it up for later and you lose the SHA.
- **A redeployment is a new record.** Do not edit the existing line. Even the same version is a
  different deployment if the SHA or the time differs.
- **A failed smoke sends you back to the defect ledger.** Register it with `harness ship defect add` and
  run the P10 loop again. Never carry a failure forward into P12.
- **Never leave `--evidence` empty.** A deployment record with no evidence is only the claim "it went
  out", and it cannot stand as evidence in the P12 verdict.
- **An improvement you spot mid-deployment is new feature code — the hook blocks it.** If it is not a
  ledger item, send it to the backlog.
