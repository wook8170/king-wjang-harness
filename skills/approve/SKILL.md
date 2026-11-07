---
name: approve
description: Approve a submitted harness gate. Only the user can invoke this, by typing /king-wjang-harness:approve <P0..P12> [--accept-risk].
disable-model-invocation: true
argument-hint: "<P0..P12> [--accept-risk]"
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/harness gate approve *)
---

!`"${CLAUDE_PLUGIN_ROOT}/bin/harness" gate approve $ARGUMENTS --via slash --project "${CLAUDE_PROJECT_DIR}"`

The line above is the result of the user's gate approval. Report it to the user in one short sentence.
If it was refused with a list of owner decisions and accepted risks, show that whole list to the user word for word,
and tell them to type the command with `--accept-risk` once they have read it. Do not decide for them.
A user who types `--accept-risk` the first time approves without that list, so the review packet `.harness/packets/P6.md` is the only place it was shown.
Do not run `harness gate approve` again. If the gate opened, tell the user which phase comes next.
