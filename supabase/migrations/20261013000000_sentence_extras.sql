-- Per-sentence AI-drafted extras (chunk structure draft, construction layers,
-- context walkthrough) split out of books.chapters[*]. Embedding them made the
-- "Slow Japanese" book row ~4 MB, so every re-order/rename/suspend re-pushed and
-- re-pulled the whole thing and concurrent edits conflicted constantly.
--
-- id IS the sentence id (one row per sentence), so the generic `id` plumbing in
-- sync_private.append_sync_event applies unchanged. Deliberately no FK to
-- sentences: these are drafts, and a push must never fail on parent ordering.

create table public.sentence_extras (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  book_id text,
  chapter_id text,
  structure_draft jsonb,
  construction_draft jsonb,
  context_walkthrough jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index sentence_extras_owner_id_idx on public.sentence_extras (owner_id);
create index sentence_extras_book_id_idx on public.sentence_extras (book_id);

create trigger sentence_extras_set_updated_at before update on public.sentence_extras
  for each row execute function sync_private.set_updated_at();
create trigger sentence_extras_bump_version before update on public.sentence_extras
  for each row execute function sync_private.bump_version();
create trigger sentence_extras_sync_event after insert or update on public.sentence_extras
  for each row execute function sync_private.append_sync_event();

alter table public.sentence_extras enable row level security;

create policy sentence_extras_all on public.sentence_extras
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
