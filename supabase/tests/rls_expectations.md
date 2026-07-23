# RLS expectations (multi-user)

Run after creating two users (`owner` and `peer`) and one book owned by
`owner`. Replace UUIDs/IDs with real values. Execute as each role using
`set local role authenticated` and `request.jwt.claim.sub` in a SQL test
harness, or use the Supabase client signed in as each user.

## Script outline

```sql
-- As owner: insert book succeeds
-- As peer: select that book fails until membership
-- As owner: insert book_members (peer, viewer)
-- As peer: select book succeeds; update book title fails for viewer
-- As owner: update member role to editor
-- As peer editor: update analyses for a sentence in the book succeeds
-- As peer: insert book_members for a third user fails
-- As peer: update own role to owner fails (check constraint + policy)
-- As peer: select sync_events for owner's id fails (owner_id filter)
```

## Automated client checks

```bash
# With .env pointed at a throwaway project:
npm run test -- tests/sync.test.ts
```

Unit tests cover queue/conflict/migration helpers. Live RLS verification is
manual or via the SQL outline above against a staging project.

## File

Optional SQL helper for Dashboard paste:

```sql
-- Verify policies exist
select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```
