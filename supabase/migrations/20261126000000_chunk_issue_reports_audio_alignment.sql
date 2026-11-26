-- Learners can flag a sentence clip whose audio doesn't line up with its text
-- ("audio_alignment"), from any audio button; the report's `chunks` holds a
-- one-element JSON diagnostics snapshot.
alter table public.chunk_issue_reports
  drop constraint chunk_issue_reports_source_check;
alter table public.chunk_issue_reports
  add constraint chunk_issue_reports_source_check
  check (source in ('particle_checks', 'meaning_checks', 'audio_alignment'));
