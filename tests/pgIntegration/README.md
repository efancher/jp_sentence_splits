# Real-Postgres sync tests

`npm run test:pg` (needs Docker) starts `supabase/postgres` with the project's
actual `supabase/migrations/*.sql` applied and PostgREST in front of it, then runs
the push path (`pushMutations`) against it with a real supabase-js client and real
JWTs. Unique indexes, foreign keys and RLS policies are the production ones — the
hand-written fake in `tests/syncPushIncident.test.ts` can only model what we
already know about; this catches what we don't (constraint/policy behaviour, the
shape of real error codes, request counts).

- `bootstrap.sql` — shims for what GoTrue / storage-api normally provide
  (`auth.jwt()`, `auth.uid()` from PostgREST's claims, storage columns). It does
  not touch any project table or policy.
- `harness.ts` — SQL access (`docker exec psql`, as superuser), JWT signing, and a
  supabase-js client acting as a given user.
- Tests are skipped unless `SYNC_PG_TEST` is set, so plain `npm test` / `npm run
  check` never need Docker. `KEEP=1 npm run test:pg` leaves the containers up; then
  `SYNC_PG_TEST=1 npx vitest run --no-file-parallelism tests/pgIntegration` reruns in seconds.
- Each test simulates a *device* with `device(userId)` (a fresh local Dexie signed
  in as that user), so multi-device scenarios are two `device()` calls.
- New migration? It is applied automatically; if it needs a new Supabase-provided
  object, add a shim to `bootstrap.sql`.
