-- Vocabulary review fields for Glossbook → Anki mining export.
-- Additive / nullable-friendly so older clients keep working.

alter table public.sentences
  add column if not exists vocabulary_suggestions jsonb not null default '[]'::jsonb;

alter table public.analyses
  add column if not exists vocabulary_review_status text not null default 'unreviewed',
  add column if not exists vocabulary_selections jsonb not null default '[]'::jsonb;
