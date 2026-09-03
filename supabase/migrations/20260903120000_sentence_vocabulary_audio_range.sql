-- Hand-corrected span of a vocabulary occurrence's word inside its
-- sentence's reference recording (SegmentLoopPlayer's "Adjust" editor —
-- see docs/STATUS.md). Additive, nullable: when unset the isolate-and-loop
-- control falls back to the forced-alignment guess, exactly as before.
alter table public.sentence_vocabulary
  add column audio_start_ms integer,
  add column audio_end_ms integer;
