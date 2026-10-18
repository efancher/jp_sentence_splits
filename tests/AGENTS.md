# Unit, component and database tests

Apply root guidance. Run npm commands from the repository root. Vitest includes
this directory and colocated `src/` tests via `vite.config.ts`.

- Reuse `src/test/setup.ts`: it installs fake IndexedDB and owns component/DB
  cleanup. Start fresh database fixtures with `resetDbForTests()` and use
  `ensureSettings()` when settings are needed. Do not add competing teardown
  hooks that close/delete the singleton while asynchronous writes are pending.
- Use `withAppProviders` from `src/test/providers.tsx` when the component needs
  auth/sync context, plus an appropriate memory router for route behavior.
  Keep external services mocked; use the real repository for persistence tests.
- Leave sentence-led mode enabled for default-flow tests. Tests of the legacy
  word/grammar flow must explicitly disable `sentenceLedFlow` in settings.
  Include introduced-sentence evidence when testing a gated activity.
- Assert user-visible outcomes and stored records. Wait for observable state
  with `findBy*`/`waitFor`; await writes before a test ends. A timing failure
  warrants checking the race before raising global timeouts or adding sleeps.
- Keep personal exports and real private chapter data out of committed fixtures.
  Optional-input skips are intentional; record them when reporting results.

Target a test with `npm test -- tests/audioReviewLadder.test.tsx` (substitute the
relevant path). Use `npm run test:coverage -- --maxWorkers=2` for the broad
application report; retain the inclusion of unimported source modules.

## Real Postgres

`npm run test:pg` applies actual migrations in disposable Docker containers.
The script uses fixed names `rlspg`/`rlsrest`, removes them on startup and normally
on exit, and binds ports 54329/54330. Check that another session is not using
them before starting; concurrent runs are not isolated from each other.

The tests share one database and must run with file parallelism disabled, as
the script already does. Keep `bootstrap.sql` limited to Supabase-provided
objects needed by the harness; project schema and policies come from migrations.
See [pgIntegration/README.md](pgIntegration/README.md) for `SYNC_PG_TEST` and
`KEEP=1` reruns. Ordinary `npm test` intentionally skips these cases.
