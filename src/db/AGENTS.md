# Local persistence

Apply the root and `src/` guidance. Paths below are relative to this directory.

- `database.ts` defines Dexie schemas and upgrades; `repository.ts` coordinates
  study mutations. Add a new schema version for an index/store change instead
  of rewriting an upgrade that existing installations have already run.
- For persisted fields, check `../domain/types.ts`, `../domain/schemas.ts`,
  `../lib/backup.ts`, and the relevant sync mapper/migration together. Older
  backups and records need deliberate defaults or migration behavior.
- A sentence is reusable across books and chapters. Membership/order belongs
  to `BookSentence` and its chapter/source context; do not infer episode order
  from a globally deduplicated sentence's `firstOccurrenceIndex`.
- Sentence extras are stored separately. Use the existing extras save path;
  `getBookWithExtras` / `withChapterExtras` produce read-only overlays for
  compatibility. Never persist an overlaid book back into the books table.
- Keep related local writes atomic and notify the existing sync path for synced
  entities. Sync failure must not invalidate a successful local edit. Preserve
  remote tombstones for synced deletes and the existing dependent-row handling.
- Reviews are append-only. Test the persisted rating/evidence and ensure a
  double submission cannot produce duplicate reviews.

Use real Dexie with the shared fake-IndexedDB setup in repository tests. For
schema/backup work, exercise both older input and a round trip. Changes affecting
remote constraints also need `npm run test:pg` from the repository root; see
[the Postgres harness](../../tests/pgIntegration/README.md).
