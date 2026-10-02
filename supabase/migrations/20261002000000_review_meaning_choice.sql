-- The meaning choices exactly as displayed (shuffled, sampled from the
-- sentence's distractor bank) plus the picked answer, and whether the pick
-- was a qualifying first attempt for sequential study unlocking. Additive and
-- nullable: existing rows stay unset and never affect scheduling.
alter table public.reviews
  add column meaning_choice jsonb;
