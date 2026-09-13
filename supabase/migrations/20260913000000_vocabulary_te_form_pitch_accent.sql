-- Per-word te-form pitch-accent downstep (docs/STATUS.md 2026-09-13):
-- unlike the citation-form accent, an accented word's te-form can retract
-- to a different mora depending on the specific word (or not), so it
-- can't be derived by formula from pitch_accent_positions — it needs real
-- per-word data, sourced from Wiktionary's conjugation table
-- (scripts/backfill-te-form-pitch-accent-wiktionary.ts). Also covers
-- plain_past/tara_form, both derived from this same value
-- (src/lib/pitchAccentShift.ts). Additive, nullable — existing rows are
-- simply unscored until the backfill runs.
alter table public.vocabulary_items
  add column te_form_accent_position integer;
