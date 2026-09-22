-- Continuous fall-timing/magnitude comparison against a real native clip of
-- the same word (compareFallToNative, src/lib/pitchContinuousScore.ts),
-- alongside the existing categorical expected_shape/measured_shape columns.
-- Additive, nullable: null means "no native clip was available to compare
-- against," not zero (docs/ROADMAP.md "Continuous scoring in the drill").
alter table public.pitch_drill_attempts
  add column fall_timing_error_morae real,
  add column fall_magnitude_ratio real;
