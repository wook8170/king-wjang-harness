# P5 CONTRACT — nextjs-prisma guidance

## The DB schema IS `prisma/schema.prisma`

The P5 artifact is not a document, it is **the schema file itself**. Writing it out a second
time in a separate document makes the two diverge, and the moment they diverge nobody knows
which one is the contract. Have the ledger's schema node point at the file, and keep only the
**reasoning** in the document (boundaries, invariants, deletion policy).

What you must decide:

- Deletion rules on relations (`onDelete: Cascade` / `Restrict` / `SetNull`) — do not leave these
  to the default.
- Unique constraints (`@@unique`) and lookup indexes (`@@index`) — derive them backwards from the
  list-query filters in the API contract.
- The ID strategy (cuid / uuid / autoincrement), and whether it is exposed in URLs.
- Timezone handling for `DateTime` — Prisma stores UTC. State explicitly who converts at display time.

## A migration is a deploy command

`prisma migrate deploy` is in this profile's `deploy_commands` — with an unapproved gate the hook
physically blocks it. Iterate on the schema during development with `prisma migrate dev` (not blocked).

Irreversible migrations (dropping a column, narrowing a type) go into the P11 deploy plan as a
**separate item**. They are the one class where rolling back is not just reverting the code.

## The API contract

Under App Router there are two surfaces. Settle which one you use at P5 — mixing them gives you
two sets of error conventions.

- Route Handler (`app/api/**/route.ts`) — for external clients and webhooks.
- Server Action — for form submissions inside the same app.

Define **one** error convention: the shape (`{ error: { code, message, details? } }` or similar),
the HTTP status mapping, and how validation failures are expressed per field. Pin down date and
decimal representation in success responses here too.

## Do not leak Prisma types straight into API types

Returning the result of `prisma.user.findMany()` as-is makes every schema change an API breaking
change. Map explicitly at the boundary — that mapped type is the source of truth for the P5 contract.
