# Supabase schema and Edge Functions

Apply root guidance. Paths below are relative to `supabase/`; npm commands run
from the repository root.

- Add a new ordered SQL migration for schema/policy changes. Existing migrations
  may already have run on deployed databases, so editing an old file alone does
  not upgrade deployed databases. Keep local types, schemas, backups and sync
  mappers compatible with the resulting server shape.
- Preserve RLS ownership and book-sharing semantics, version/update triggers,
  sync events and tombstones. Use [tests/rls_expectations.md](tests/rls_expectations.md)
  and actual migrations to identify allowed operations rather than assuming
  every table has the same ownership rules.
- Run `npm run test:pg` for schema/constraint/policy changes. See
  [tests/AGENTS.md](../tests/AGENTS.md) for container ownership and
  [the harness README](../tests/pgIntegration/README.md). Add assertions for
  allowed and denied access where the policy changes.
- `functions/*/index.ts` are Deno Edge Functions, outside the Vite application
  coverage metric. Preserve caller authentication, request validation and CORS;
  keep service/provider secrets server-side. Validate the changed function's
  behavior separately instead of treating an app build as an Edge Function test.
- Assistant output remains a suggestion/draft in the appropriate client flow.
  Preserve response positions and error reporting for batched translation or
  realignment; dropping blank rows can assign translations to the wrong sentence.
- A committed migration or successful Pages deployment does not prove server
  schema or Edge Function deployment. When deployment is in scope, verify the
  outcome; `npm run check:migrations-applied` is the read-only schema diagnostic.
  Do not present it as complete verification of policies or function versions.

Setup details: [README.md](README.md) and
[docs/supabase-setup.md](../docs/supabase-setup.md). Check current deployment
configuration before relying on historical operational notes.
