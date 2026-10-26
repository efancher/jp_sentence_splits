-- One row per mined episode/video: what was mined, where the import was
-- headed (series feed / target book) and how far it got. Mining jobs live on
-- the box (/tmp, 6-48h TTL) and the browser only kept a job id in
-- localStorage, so a reloaded or resumed page lost the destination and a
-- podcast episode could be committed as a standalone book instead of a
-- chapter of its series (Slow Japanese #64/#69/#74/#78, 2026-10-24..26). This
-- row carries that context across reloads and devices and records which
-- episodes are already imported or in flight.
--
-- id is deterministic from the canonical source id, so every device writing
-- the same episode converges on one row; the partial unique index is the
-- backstop. Re-importing deliberately reuses the row (status resets).
-- Conflict policy is last-write-wins (src/sync/engine.ts
-- LAST_WRITE_WINS_ENTITIES): this is import bookkeeping, not durable content.
-- book_id/chapter_id/target_book_id are deliberately NOT foreign keys so the
-- history survives a book being deleted or merged.
create table public.mining_imports (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  source_id text not null,
  source_type text not null check (source_type in ('podcast', 'youtube', 'nhk_easy')),
  title text not null,
  job_id text,
  status text not null default 'mining' check (status in ('mining', 'ready', 'committed', 'failed')),
  series_id text,
  series_title text,
  series_url text,
  target_book_id text,
  source_date text,
  book_id text,
  chapter_id text,
  sentence_count integer,
  error text,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index mining_imports_owner_id_idx on public.mining_imports (owner_id);
create index mining_imports_owner_job_idx on public.mining_imports (owner_id, job_id);
create unique index mining_imports_owner_source_uidx
  on public.mining_imports (owner_id, source_id) where deleted_at is null;

create trigger mining_imports_set_updated_at before update on public.mining_imports
  for each row execute function sync_private.set_updated_at();
create trigger mining_imports_bump_version before update on public.mining_imports
  for each row execute function sync_private.bump_version();
create trigger mining_imports_sync_event after insert or update on public.mining_imports
  for each row execute function sync_private.append_sync_event();

alter table public.mining_imports enable row level security;

create policy mining_imports_select on public.mining_imports
  for select to authenticated
  using (owner_id = auth.uid());
create policy mining_imports_insert on public.mining_imports
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy mining_imports_update on public.mining_imports
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy mining_imports_delete on public.mining_imports
  for delete to authenticated
  using (owner_id = auth.uid());
