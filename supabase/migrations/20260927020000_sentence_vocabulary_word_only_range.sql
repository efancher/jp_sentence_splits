-- Hand-corrected *strict* word-only span (no particle, no pad) for a
-- vocabulary occurrence, distinct from audio_start_ms/audio_end_ms (which is
-- padded and often deliberately includes a following particle for the
-- pitch/word-listening cards). Consulted by isolatedWordSpans' `wordOnly`
-- guess, so a correction here reaches every clip built from it: Odd Ear Out,
-- Speaker Match. Additive, nullable: unset keeps the current
-- forced-alignment guess.
alter table public.sentence_vocabulary
  add column word_only_start_ms integer,
  add column word_only_end_ms integer;
