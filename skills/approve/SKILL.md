---
name: approve
description: Approve a submitted harness gate. Only the user can invoke this, by typing /king-wjang-harness:approve <P0..P12>.
disable-model-invocation: true
argument-hint: "<P0..P12>"
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/harness gate approve *)
---

!`"${CLAUDE_PLUGIN_ROOT}/bin/harness" gate approve $ARGUMENTS --via slash --project "${CLAUDE_PROJECT_DIR}"`

The line above is the result of the user's gate approval. Report it to the user in one short sentence.
Do not run `harness gate approve` again. If the gate opened, tell the user which phase comes next.
