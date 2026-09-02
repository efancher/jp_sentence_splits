-- Grammar-noticing pass status for a sentence, mirroring
-- vocabulary_review_status (20260725120000_vocabulary_review.sql).
-- Additive / default so older clients keep working; apply before deploying
-- the frontend change that writes this column.

alter table public.analyses
  add column if not exists grammar_review_status text not null default 'unreviewed';
