-- Hand-labelled word-boundary checks for the word-audio ground-truth tool
-- (`/label-word-audio`, docs/ROADMAP.md "Word-audio ground truth").
--
-- APPLY BY HAND in the Supabase Dashboard SQL editor (the dev environment has no
-- DDL credentials). The app does not depend on this table: labels are stored
-- locally first and uploaded best-effort, so the labelling screen works before
-- this runs and simply keeps them pending until it does.
--
-- Deliberately NOT wired into the sync-event engine (same precedent as
-- reference_alignment): append-mostly analysis data that only scripts and the
-- labelling page read. `payload` holds the whole WordBoundaryLabel JSON so its
-- shape can evolve without another migration.
create table public.word_boundary_labels (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  sentence_vocabulary_id text not null,
  sentence_audio_id text not null,
  verdict text not null check (verdict in ('clean', 'corrected', 'skipped')),
  sample_kind text not null check (sample_kind in ('random', 'targeted')),
  span_version text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index word_boundary_labels_owner_id_idx on public.word_boundary_labels (owner_id);
create index word_boundary_labels_link_idx on public.word_boundary_labels (sentence_vocabulary_id);

create trigger word_boundary_labels_set_updated_at before update on public.word_boundary_labels
  for each row execute function sync_private.set_updated_at();

alter table public.word_boundary_labels enable row level security;

create policy word_boundary_labels_select on public.word_boundary_labels
  for select to authenticated using (owner_id = auth.uid());
create policy word_boundary_labels_insert on public.word_boundary_labels
  for insert to authenticated with check (owner_id = auth.uid());
-- Upsert (retrying an upload) needs update; a corrected relabel replaces the row.
create policy word_boundary_labels_update on public.word_boundary_labels
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy word_boundary_labels_delete on public.word_boundary_labels
  for delete to authenticated using (owner_id = auth.uid());
