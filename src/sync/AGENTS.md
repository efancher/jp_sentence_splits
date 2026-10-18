# Optional cloud sync

Apply the root and `src/` guidance. Paths below are relative to this directory.

- Preserve optimistic locking against the last acknowledged cloud version,
  tombstones and the sync-event cursor. A newer local edit made during an
  in-flight push must survive its acknowledgement; use the queue's settling
  logic instead of unconditionally deleting the queued record.
- Keep parent-before-child push ordering, bounded requests and existing
  deterministic-id/duplicate-adoption behavior. When adopting a remote id,
  remap dependent records and every queued reference, not only the first one.
- Preserve manual conflict handling for durable content. `planner_sessions`
  is the explicit last-write-wins exception; do not generalize that policy to
  books, sentences or analyses to make a conflict disappear.
- New synced entities require coordinated types, mappers, queue tracking,
  push/pull/delete handling and SQL/RLS changes. Check local-only entities
  deliberately: game rounds are not currently synced.
- Auth and transfer failures must leave local study usable and recoverable.
  Preserve the signed-out reminder/offline choice and avoid logging credentials
  or access tokens when adding diagnostics.

Run relevant colocated tests and the root `tests/sync*.test.ts` cases. Add a
regression that reproduces the actual race or failure, rather than just matching
helper calls. For push/schema/RLS changes, run `npm run test:pg` from the root:
[the harness](../../tests/pgIntegration/README.md) exercises actual migrations
and policies. Fake clients alone cannot verify database constraint behavior.
Follow [tests guidance](../../tests/AGENTS.md) for shared-container ownership.
