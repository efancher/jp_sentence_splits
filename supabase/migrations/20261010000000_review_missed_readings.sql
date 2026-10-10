-- Surface forms the learner flagged "Missed reading" after revealing a
-- reading_in_context card. Additive and nullable: never affects scheduling.
alter table public.reviews
  add column missed_readings jsonb;
