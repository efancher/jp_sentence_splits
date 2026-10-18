# Diagnostics and maintenance scripts

Apply root guidance. These scripts include live database operations, local
asset generators and experiments; inspect the entry point's flags and effects
before running it. A repair script is not a test command.

- Reuse `lib/env.ts`, `lib/scriptSupabaseClient.ts` and `lib/scriptHelpers.ts`.
  Database maintenance normally signs in as a real user with the anon client,
  preserving RLS. Keep credentials in the existing environment mechanism.
- New repair scripts should default to a read-only proposal with explicit
  `--apply` behavior, scoped to the intended owner/book/records. Include enough
  before/after evidence to review the operation. Do not assume every older
  script already supports dry-run; read its implementation first.
- Reuse paginated reads with a stable key and bounded writes. A single Supabase
  select can truncate a large inventory. Respect soft deletion and partial
  unique indexes; `insertBatched` and `upsertBatched` serve different cases.
- For direct maintenance upserts, omit server-managed version/timestamp fields
  with `withoutVersionAndTimestamps`. Resetting a version breaks the sync
  protocol. Preserve source-specific order and distinct homograph readings.
- Keep reusable planning/parsing logic testable without live credentials.
  Validate the proposed changes before applying an authorized repair, and verify
  the affected invariants afterward. Do not infer production execution from a
  successful local test or from a historical comment saying "applied".
- Keep migration/repair tools and research experiments unless they are proven
  obsolete; rare execution or low test coverage alone is not dead-code evidence.

Npm entry points are in the root `package.json`. `npm run db:query` and the
`check:*`/`diagnose:*` scripts are discovery starting points after inspecting
their usage. For the Docker harness in `pg-test.sh`, follow
[tests/AGENTS.md](../tests/AGENTS.md) before using its fixed container names.
