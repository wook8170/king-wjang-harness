# P7 SKELETON — nextjs-prisma guidance

There is one target state: **"an empty shell passes deployment."** No features, live pipeline.

## Completion conditions in this stack

- `npm run build` green (`commands.yaml: build`)
- `npm test` green — the test count must not be zero. Even one smoke test has to actually run, so
  that "passed" is distinguishable from "never executed".
- `npx playwright test` green — every **shell** of the 1:1 UX-node-to-scenario conversion exists.
  Each scenario only checks that the screen renders, and stays marked `test.fixme`. Without the
  files there is no way to count what is missing at P9.
- The lint rule pack (`rules/raw-values.yaml`) is wired into CI and can actually go red.
- Migrations run from scratch on an empty DB (`prisma migrate deploy` on clean).

## What the skeleton must contain

```
app/layout.tsx          # import tokens.css once, here
app/page.tsx            # minimal render
prisma/schema.prisma    # the P5 contract as-is
e2e/                    # one scenario shell per UX node
src/lib/db.ts           # PrismaClient singleton (prevents dev HMR re-creation)
```

## Traps

- **new PrismaClient() per module** lets dev-server HMR keep adding connections until the pool dries
  up. Nail the global singleton pattern in at the skeleton stage. Fixing it later means 20 places
  have already rolled their own.
- **Playwright racing the dev server** — let Playwright start it via the `webServer` config, and keep
  its port separate from the `dev-server` command. A setup that attaches to a server a human left
  running dies only in CI.
- **No environment-variable defaults** — if `DATABASE_URL` is missing, the build must fail. A silent
  default is the standard route to production pointing at the development database.
- **Committed generated files** — `src/styles/tokens.css`, `src/lib/tokens.ts` and
  `tailwind.config.ts` are generated but still committed. Putting them in `.gitignore` kills CI's
  "regenerate, expect no diff" check.
- **Put `prisma generate` in postinstall.** Leaving it out breaks types only on a clean clone.
