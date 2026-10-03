-- chunk_issue_reports also holds problems flagged by the meaning-check prompt
-- (translation mismatch, garbled ASR, mid-sentence cut-off), so record which
-- authoring prompt raised each report.
alter table public.chunk_issue_reports
  add column source text not null default 'particle_checks'
  check (source in ('particle_checks', 'meaning_checks'));
