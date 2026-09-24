-- Context-aware comprehension check for reading_in_context (docs/ROADMAP.md
-- "Context-aware comprehension check…") and the pitch-accent production
-- review card (docs/ROADMAP.md "Pull the pitch-accent production drill into
-- a review card…"). Additive/nullable throughout — existing rows stay unset.

alter table public.analyses
  add column comprehension_check jsonb;

alter table public.reviews
  add column comprehension_check_correct boolean,
  add column comprehension_check_chosen_index integer,
  add column pitch_production_measured_count integer,
  add column pitch_production_mismatch_count integer;
