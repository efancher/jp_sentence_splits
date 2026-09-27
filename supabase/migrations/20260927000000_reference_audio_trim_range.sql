-- Hand-corrected playback trim within a reference clip's own blob (the
-- "Adjust" editor on NativeAudioButton — see docs/STATUS.md). Additive,
-- nullable: unset means play the whole clip, exactly as before. Distinct
-- from source_start_ms/source_end_ms, which are the source-video cut points
-- and only change via a re-cut (recutSentenceAudioFromSource) — this never
-- touches the stored blob.
alter table public.reference_audio
  add column trim_start_ms integer,
  add column trim_end_ms integer;
