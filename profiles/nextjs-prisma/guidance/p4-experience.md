# P4 EXPERIENCE — nextjs-prisma guidance

## Holding the single token source in this stack (§7)

There is exactly **one** source: `.harness/design/tokens/design-tokens.json`. What gets
generated in this stack:

| Generated file | Generator | Where it is used |
|---|---|---|
| `src/styles/tokens.css` | `generateCss` | imported once from `app/layout.tsx` |
| `src/lib/tokens.ts` | `generateTs` | components that need token values at runtime |
| `tailwind.config.ts` | `generateTailwind` | Tailwind utilities |

**Commit all three, and never hand-edit them.** CI catches manual duplication by regenerating
and asserting there is no diff. The moment you hand-edit one, that check goes permanently red —
and a defeated check is no check at all.

## The fork by design-foundation ADR (§5)

- **(a) Open-source library + token overlay** — shadcn/ui is the default candidate. Components
  are **copied into** `components/ui/`, so those files arrive carrying raw values. M0 = install →
  CSS-variable bridge (map library variables such as `--background` onto our tokens) → verify in
  the gallery.
- **(b) Fully in-house** — you build `components/ui/` yourself. That means accessibility, focus
  rings and keyboard interaction all become your job. Get that cost explicitly approved at P4.
- **(c) Hybrid** — headless primitives (Radix and friends) plus your own styling. The most common
  choice in this stack.

Whichever path you take, the single token source does not change.

## Frozen paths

After the P4 approval, `src/components/ui/` and `components/ui/` freeze (profile.yaml,
`design_system_roots`). If you need a new component, backtracking is the official route.

## App Router-specific traps

- A server component without `'use client'` cannot take event handlers — if a UX scenario has
  interaction, decide at P4 where the client boundary sits for that screen.
- Load fonts with `next/font`, but **the family name's source of truth is the token.** Bridge the
  CSS variable that `next/font` produces onto the token variable once, and have components
  reference only the token side.
- Decide both `prefers-color-scheme` and an explicit toggle at P4. Bolting dark mode on later
  means re-auditing every colour already nailed down.
