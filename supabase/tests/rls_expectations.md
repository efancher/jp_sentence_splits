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

## Unified study model tables (owner-only, no sharing)

`sources`, `vocabulary_items`, `sentence_vocabulary`, `kanji`,
`vocabulary_kanji`, `study_items`, `reviews`, `vocabulary_confusions`,
`grammar_patterns`, `sentence_grammar`, `grammar_relationships` — simpler
than the book-shared tables above, since none of them support sharing yet.

`sentence_vocabulary`/`vocabulary_kanji`/`reviews`/`vocabulary_confusions`/
`sentence_grammar`/`grammar_relationships` additionally check that
*referenced* rows (`vocabulary_item_id`, `kanji_id`, `study_item_id`,
`sentence_id`, `item_a_id`/`item_b_id`, `grammar_pattern_id`,
`pattern_a_id`/`pattern_b_id`) belong to the same owner
(`sync_private.owns_vocabulary_item`/`owns_kanji`/`owns_study_item`/
`owns_grammar_pattern`/`sentence_editable`) — `owner_id = auth.uid()` on the
row being written is not sufficient by itself, since it doesn't prevent a
caller from pointing their own row at someone else's referenced record.

`grammar_relationships` mirrors `vocabulary_confusions`' `item_a_id <
item_b_id` check constraint (`pattern_a_id < pattern_b_id`), but — unlike
`vocabulary_confusions` — its unique index is on `(pattern_a_id,
pattern_b_id, relationship_type)`, not just the pair: two patterns may
legitimately have more than one relationship row (e.g. both
`structural_relative` and, independently, `commonly_confused`).

`vocabulary_confusions` additionally enforces `item_a_id < item_b_id` at the
database layer (a check constraint, not just application-level
canonicalization), so a pair can never be stored in both directions even if
a caller sends them unordered.

```sql
-- As owner: insert a vocabulary_items row succeeds
-- As peer: select that row returns zero rows (owner_id filter, no book membership path)
-- As peer: update/delete that row affects zero rows
-- As owner: insert a reviews row succeeds
-- As owner: update that reviews row fails (no update policy — insert/select only)
-- As peer: insert a reviews row (owner_id = peer) whose study_item_id belongs to
--   owner fails (owns_study_item check in the with-check clause blocks it)
-- As peer: insert a sentence_vocabulary row (owner_id = peer) whose
--   vocabulary_item_id belongs to owner fails (owns_vocabulary_item check)
```

Known, documented gap (not fixed here — see the migration file's comment
above the `study_items_all` policy): `study_items.subject_id` is polymorphic
(sentence | vocabularyItem | chunk) and its ownership is *not* verified at
the database layer, unlike the tables above. Low practical risk while this
is a single-user app; revisit before any multi-user use of study data.

## File

Optional SQL helper for Dashboard paste:

```sql
-- Verify policies exist
select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```
