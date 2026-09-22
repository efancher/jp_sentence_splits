-- How far apart a citation-form occurrence's native clip actually holds its
-- dictionary-expected high vs. low morae, in semitones (measureNativeWord's
-- separationSemitones — scripts/backfill-pitch-cue-strength.ts). Additive,
-- nullable: null means "not measured," which the pitch_accent review card
-- treats as unknown, not weak (docs/ROADMAP.md "Gate/rank pitch_accent
-- cards by measured cue strength").
alter table public.sentence_vocabulary
  add column pitch_cue_separation_semitones real;
