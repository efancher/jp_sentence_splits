-- Ground-truth pitch-accent scoring for shadowing (docs/STATUS.md): the
-- mora index of the pitch-accent drop for a vocabulary item's expression +
-- reading, backfilled from the Kanjium dictionary
-- (scripts/backfill-pitch-accent.ts). Array because a word can have more
-- than one accepted accent. Additive, nullable — existing rows are simply
-- unscored until the backfill runs.
alter table public.vocabulary_items
  add column pitch_accent_positions integer[];
