-- Persist per-book folded chapter/episode ids for the book sentence list.
alter table public.books
  add column if not exists collapsed_chapter_ids jsonb not null default '[]'::jsonb;
