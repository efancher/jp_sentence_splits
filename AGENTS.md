# Satori Glossbook

This repository is the Japanese learning app (`satori-glossbook`). Shared
instructions live here; `CLAUDE.md` imports this file. Before editing a subtree,
read the scoped `AGENTS.md` files below that apply to it. Paths and npm commands
in this file are relative to the repository root.

## Working context

- Before substantial changes, read [ARCHITECTURE](docs/ARCHITECTURE.md),
  [STATUS](docs/STATUS.md), [ROADMAP](docs/ROADMAP.md) and the relevant feature
  sections of [AI_OVERVIEW](docs/AI_OVERVIEW.md). Confirm historical claims
  against current code; dates and production inventories can become stale.
- Use an isolated git worktree for edits: the main checkout may be shared by
  other sessions. Continue in an existing task worktree when already isolated.
  Preserve unrelated changes and stage explicit paths. Commit logically related
  changes separately. If using agents that edit, give each its own worktree.
- Inspect existing implementations before extending them. Keep the app usable
  without Supabase or the mining/alignment services.
- Default learning is sentence-led (`settings.sentenceLedFlow`). New eligibility
  gates use introduced sentences (`getIntroducedSentenceIds` /
  `filterToIntroducedSentenceIds`), not paused vocabulary/grammar-card history.
  Preserve the optional older flow. Before changing a gate, check it against
  recently imported data using a read-only diagnostic when access is available;
  otherwise test representative fixtures and state that limitation.
- FSRS ratings are explicit learner choices. Typed-match feedback, walkthroughs
  and game results must not silently grade cards or credit related cards.

## Validation

Use npm and `package-lock.json`; Node 22 matches CI. For a fresh checkout, install
with `npm ci`. Select checks for the affected behavior:

| Change | Checks from the repository root |
| --- | --- |
| TypeScript/application code | `npm run typecheck`, `npm run lint`, relevant `npm test -- <test-path>` |
| Broad learning/data changes | `npm run test:coverage -- --maxWorkers=2` |
| Bundling/routing/dependencies | `npm run build` |
| Browser behavior | Follow [e2e guidance](e2e/AGENTS.md) |
| Sync constraints or SQL | `npm run test:pg` (Docker; see tests guidance) |
| Python backend | Follow [backend guidance](server/youtube-mining/AGENTS.md) |
| Documentation only | Verify paths, commands and consistency; `git diff --check` |

See [TESTING](docs/TESTING.md) for coverage scope and remaining gaps. Report
checks actually run, conditional skips and unresolved failures. A local check
does not establish that a production migration or service was deployed.

## Scoped guidance

| Location | Additional instructions |
| --- | --- |
| `src/` | [UI, learning and audio](src/AGENTS.md) |
| `src/db/` | [Persistence and schema changes](src/db/AGENTS.md) |
| `src/sync/` | [Sync protocol and race conditions](src/sync/AGENTS.md) |
| `tests/` | [Vitest fixtures and real-Postgres tests](tests/AGENTS.md) |
| `e2e/` | [Browser tests](e2e/AGENTS.md) |
| `scripts/` | [Diagnostics and data repair](scripts/AGENTS.md) |
| `server/youtube-mining/` | [Python mining backend](server/youtube-mining/AGENTS.md) |
| `supabase/` | [Migrations, RLS and Edge Functions](supabase/AGENTS.md) |
| `docs/` | [Living documentation and future plans](docs/AGENTS.md) |

Update STATUS and AI_OVERVIEW when behavior materially changes, ARCHITECTURE
when the design changes, and ROADMAP when milestone status changes. Preserve
unfinished work and possible future ideas when pruning completed entries.
