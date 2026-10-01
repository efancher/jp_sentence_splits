-- How a review card was presented (chapter vs sentence layout, whether the
-- source document actually loaded, whether the learner switched layouts) —
-- sentence-first plan Phase 0 evidence. Additive/nullable: existing rows stay
-- unset; it never influences scheduling.
alter table public.reviews
  add column presentation jsonb;
