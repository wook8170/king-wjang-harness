# Difficulty → model rubric (P8 parallel orchestration)

The orchestrator scores each wave by rule table (no ML), then picks the implementer and verifier
models. On 3 consecutive failures of a wave, promote it one tier (spec §4); a wave that keeps
failing after promotion summons the user (spec §5 3-strike).

| Difficulty | Signals | Implementer | Verifier |
|---|---|---|---|
| **Trivial / mechanical** | scope 1–2 files · no high-impact file touched · spec fully fixed | Haiku 4.5 | **Sonnet 5** (floor) |
| **Clear-spec** | small–medium · within a single module · acceptance criteria clear · low novelty | Sonnet 5 | Sonnet 5 |
| **Multi-file / integration / subtle** | multi-file · multi-module · touches a high-impact file · subtle logic · high novelty | Opus 4.8 | Opus 4.8 |

- Orchestrator model = **Fable 5** (fall back to **Opus 4.8** when Fable is exhausted).
- **Verifier floor = Sonnet.** Verification is a judgement task and CLAUDE.md's rule is "when in doubt, Sonnet." Do not give disproof-oriented verification to Haiku, even for a trivial wave.
- High-impact files come from `.codesight` (most-imported / dependency graph). Touching one lifts the wave to the Multi-file tier regardless of file count.
- The verifier is always a fresh context, different from the implementer (OPS-74), prompted to **disprove** the acceptance criteria.
