---
name: phase-p4-experience
description: Use when driving P4 (EXPERIENCE) of the harness design track — closing the design-foundation decision (ADR), and producing the UX scenarios, the four-layer design system, the Claude Design canvas and the interactive HTML of record before putting them up for the gate. Triggers - "let's design the screens", harness phase set P4, submitting the P4 gate, 04-experience.md, UX-x nodes, DS-TOK/PRIM/COMP/DCOMP, design tokens, the design system of record.
---

# P4 EXPERIENCE — UX + design system

## Overview

The heaviest phase of the design track. It produces one decision (ADR-3) and three artifacts.

| Artifact | Path | Character |
|---|---|---|
| UX / design document | `.harness/design/04-experience.md` | The record humans read |
| Interactive HTML of record | `.harness/design/design-system.html` | **What the P4 gate actually reviews** |
| Token origin | `.harness/design/tokens/design-tokens.json` | The single source of visual tone |

## Decision point: the design foundation (ADR-3)

```bash
harness adr propose --id ADR-3 --phase P4 --question "what do we build the design on" \
  --option lib:"open-source library + token overlay" \
  --option own:"fully in-house" \
  --option hybrid:"hybrid (headless components + our own styling)" \
  --recommend lib
harness adr decide ADR-3 --choose lib --rationale "<grounds>" \
  --reject own:"<reason>" --reject hybrid:"<reason>"
```

Whichever road you take, **the single-source-of-truth invariant for tokens is the same**. Choose a
library and M0 becomes install → token bridge → gallery verification. The per-option trade-off table
goes in `04-experience.md` (the CLI carries only the title).

## Ledger nodes

| Prefix | What | Example |
|---|---|---|
| `UX-x` | One screen or scenario | `UX-7 Checkout screen` — `--parent F-x` |
| `DS-TOK-x` | L1 semantic tokens | Colour, type, spacing, radius, shadow, motion, breakpoints |
| `DS-PRIM-x` | L2 primitives | Box, Stack, Grid, Text, Icon |
| `DS-COMP-x` | L3 base components | Button, Input, Card, Modal, Table |
| `DS-DCOMP-x` | L4 domain components | Product-specific — `--parent D-x` or `F-x` |

References point **downward only**. If L3 knows about L4, the layering is broken.

## Layout templates

**Approve** in P4 the set that fits the product — app-shell, list-detail, form-page, dashboard, and so
on. Every `UX-x` declares exactly one template. If you need a structure no template has, that is a new
template, and a new template is a design revision.

## The Claude Design canvas

Build the canvas with the `design` skill. **One artboard = one UX node**, named like
`"UX-7 Checkout screen"`. Keep design-system artboards (token sheet, component gallery) separate.

Link the canvas to the ledger with `harness design link --ux UX-7 --url <canvas-url>
[--artboard <name>]`.

**Pulling a canvas change back is one flow you drive.** The core never touches the network (so that
the enforcement hook stays local and fast — see the `king-wjang-harness` driver) — the fetch is
*your* job as the agent, and the core only ever sees the file you hand it:

```bash
# 1. Fetch the canvas HTML yourself — WebFetch on the canvas URL — and save the body to a file,
#    e.g. .harness/design/_canvas/UX-7.html
# 2. Hand that body to the core; it diffs against the approved hash, revises, and records:
harness design sync UX-7 --from .harness/design/_canvas/UX-7.html
```

Run this whenever the canvas is edited. On an **approved** node a changed canvas is a formal
revision — `sync` bumps the node's version and propagates STALE to every referencing wave
automatically. On a **draft** node (still inside P4) it simply records the new hash. Either way the
core stays local.

`harness design baseline UX-7 --png <file>` records the reference screenshot the P9 verifier compares
against. Where the canvas and the HTML of record disagree, **the HTML wins** (the canvas is a visual
expression of it).

## The interactive HTML of record

What the gate reviews is not a picture but **self-contained HTML you can click**. It contains:

- The token CSS-variable block — this block *is* the origin of `design-tokens.json` (the same thing)

### The shape of `design-tokens.json`

The core never invents defaults, so this file must exist before `harness tokens gen` runs.
`harness tokens --help` prints the same shape — copy it, then replace the values.

```json
{
  "schemaVersion": 1,
  "color":      { "text.primary": { "light": "#111111", "dark": "#f5f5f5" } },
  "space":      { "md": "16px" },
  "type":       { "family": { "sans": "Inter, system-ui, sans-serif" },
                  "size":   { "md": "16px" },
                  "weight": { "regular": "400" },
                  "lineHeight": { "normal": "1.5" } },
  "radius":     { "md": "8px" },
  "shadow":     { "md": "0 1px 2px rgba(0,0,0,.08)" },
  "motion":     { "duration": { "fast": "120ms" },
                  "easing":   { "standard": "cubic-bezier(.2,0,0,1)" } },
  "breakpoint": { "md": "768px" }
}
```

schemaVersion: 1 · color.<name> = { light, dark? } · space/radius/shadow/breakpoint = name → string · type = family/size/weight/lineHeight · motion = duration/easing. A value that is entirely `{other.token.path}` is an alias.
- A gallery of **every component state** (default/hover/focus/active/disabled/error)
- Two or three representative screens as page demos (on an approved layout template)
- Working interactions: modal, tabs, form validation states, light/dark toggle

Publish it with the `Artifact` tool. External requests are blocked by CSP, so inline all CSS, JS, and
images (`data:` URIs).

## Procedure

```bash
harness node upsert --id UX-7 --title "Checkout screen" --parent F-12 --anchor "04-experience.md#ux-7-checkout-screen"
harness node upsert --id DS-TOK-1 --title "Colour tokens" --anchor "04-experience.md#tokens"
harness doc upsert --id DOC-P4 --path .harness/design/04-experience.md --phase P4 \
  --refs UX-7,DS-TOK-1,DS-COMP-1,ADR-3
harness doc upsert --id DOC-P4-DS --path .harness/design/design-system.html --phase P4 \
  --refs DS-TOK-1,DS-PRIM-1,DS-COMP-1,DS-DCOMP-1
harness doc url DOC-P4 https://claude.ai/public/artifacts/<id>
harness doc url DOC-P4-DS https://claude.ai/public/artifacts/<id>
harness doc submit DOC-P4 && harness doc submit DOC-P4-DS    # both refused without artifact_url
harness gate submit P4 --evidence claimed \
  --paths .harness/design/04-experience.md,.harness/design/design-system.html,.harness/design/tokens/design-tokens.json
# → present .harness/packets/P4.md → wait for the user's approval
harness doc approve DOC-P4 && harness doc approve DOC-P4-DS
harness phase set P5
```

## Approval is a human's

**An agent does not run `harness gate approve P4`.** Give the artifact URL of the HTML of record
first and let the user actually click through it. P4 is a gate that is approved with the eyes.

## Pitfalls

- **A wave that references a `UX-x` will not `complete` without visual evidence.** In P8~P9 there must
  be a file of size > 0 (a 2x screenshot) in `.harness/evidence/<wave-id>/`. Creating a UX node here
  places that obligation on a later wave — one node per screen, and no proliferation.
- **The ban on raw values starts at P4.** Even inside the HTML of record, never put hex or px magic
  numbers directly on a component — everything references a CSS variable. `text.primary` is fine;
  `blue.500` is not.
- **The token origin is one file.** The CSS variables, TS constants, and Tailwind config are all
  generated; no manual duplication. `harness tokens lint` catches raw values, and
  `harness tokens swap --with <theme>` is the drill that proves the single source really is single.
- **After the P4 approval the design-system directory is frozen.** PreToolUse catches an attempt to
  add a component that is not in the ledger — if you need one, revise it properly through a backtrack.
- **Reviewer comments come back through `harness gate feedback <P>`** (`--from <file>` to ingest a
  collected file). A canvas change still has to be **promoted** to a revision — re-run
  `harness design sync UX-x --from <file>` (it bumps an approved node automatically), or if you
  revised the design without a canvas sync, `harness node bump UX-x` by hand. Without one of the two,
  STALE never propagates.

## Companion skills (optional)

These are separate skill packages, not part of this harness. The `king-wjang-harness` driver checks
for them and offers to install any that are missing.

- `frontend-design` — distinctive, intentional visual direction for the UX scenarios and design system.
- `oh-my-claudecode:designer` — building the interactive HTML canonical that becomes the P9 baseline.
