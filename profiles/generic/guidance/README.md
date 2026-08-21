# generic profile guidance

This profile is **an honest statement that the stack is unknown.** There is no stack-specific
guidance to inject into the phase skills — pretending otherwise would make that guidance wrong.

## What to do in P2 (MODULE)

Once the tech-stack ADR is settled, pick one of two options.

1. If a bundled profile fits, change `profile:` in `.harness/config.yaml` to its name
   (bundled today: `nextjs-prisma`, `generic`).
2. If the stack is outside the bundles, model this directory to build a **project-local
   profile** (spec §5).

```
.harness/profile/
  profile.yaml     # source_globs / deploy_commands / design_system_roots
  commands.yaml    # test / build / deploy / e2e / dev-server
  guidance/        # stack-specific guidance for phase-skill injection (optional)
  rules/           # lint rule packs (optional)
```

If `.harness/profile/` exists it **always wins over the bundled profile.** Delete the directory
to fall back to the bundle.

## What happens if you leave it unfilled (honest notice, spec §12)

- If `source_globs` does not match the real source layout, the design-track (P0–P6) source-write
  block (§4-2) develops a hole — or, the other way round, writing design documents gets blocked.
- If `deploy_commands` is empty, a deploy with an unapproved gate walks straight past the hook.
- If `commands.yaml` is empty, every P7–P9 test/build decision becomes "undefined" and falls to a human.
