-- Server-side cache of raw WaniKani subject payloads, so the ingestion
-- scripts (scripts/import-wanikani-kanji.ts,
-- scripts/backfill-wanikani-mnemonics.ts) don't re-page the whole WaniKani
-- catalog on every run. After the first populate each run is an incremental
-- `updated_after` pull (usually zero rows) keyed on the newest
-- `data_updated_at` already cached.
--
-- Script-only: NOT wired into the TypeScript sync engine, Dexie, or JSON
-- backup — the browser app never reads this, it only ever sees the derived
-- `kanji` / `vocabulary_items` rows. Owner-scoped to match every other
-- table's RLS (the per-user duplication of a shared catalog is theoretical
-- at one user). Hidden subjects are stored too (filtered on read) so the
-- incremental cursor stays correct when a subject becomes hidden.
create table public.wanikani_subjects (
  owner_id uuid not null references auth.users (id) on delete cascade,
  wk_id integer not null,
  object text not null,
  data jsonb not null,
  data_updated_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  primary key (owner_id, wk_id)
);

create index wanikani_subjects_owner_object_idx
  on public.wanikani_subjects (owner_id, object);
create index wanikani_subjects_owner_data_updated_at_idx
  on public.wanikani_subjects (owner_id, data_updated_at desc);

alter table public.wanikani_subjects enable row level security;

create policy wanikani_subjects_all_own on public.wanikani_subjects
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
