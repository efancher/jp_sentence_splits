-- Contextual particle questions for the glossing check (src/lib/particleChecks.ts).
-- Additive/nullable: existing rows stay unset and fall back to generic relations.

alter table public.analyses
  add column particle_checks jsonb;
