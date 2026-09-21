-- Pitch-accent drill takes: the raw material behind each scored take, kept so the
-- grader can be replayed and judged against the learner's own labels
-- (docs/STATUS.md 2026-09-21). Until now only the per-word verdicts were logged
-- (`pitch_drill_attempts`), so a grader change could not be checked against
-- what was actually said.
--
-- One row per take (a take can score several words). Written and read directly
-- by the client, not through the sync-event engine — same treatment as
-- `reference_alignment` and the reference-audio blobs: owner-scoped, derived,
-- recomputable. Holds the learner's own voice, so the bucket is private and
-- every policy is owner-only.
--
-- Columns:
--   alignment  the learner's forced-alignment words (what the grader consumes)
--   pitch      the measured YIN pitch payload (frames), so a new grader can be
--              replayed without re-processing audio
--   targets    the scored words: surfaceForm, reading, accent positions,
--              followingMora, vocabularyItemId, contextSentenceId
--   results    what the grader said at the time, per target
--   labels     the learner's own after-take verdicts, {surfaceForm: 'right'|'off'}
--   grader     which grading logic produced `results`

create table public.pitch_drill_takes (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  taken_at timestamptz not null default now(),
  mode text not null check (mode in ('sentence', 'word')),
  transcript text not null,
  focus_triggered boolean not null default false,
  audio_path text,
  mime_type text,
  duration_ms integer,
  alignment jsonb,
  pitch jsonb,
  targets jsonb not null default '[]'::jsonb,
  results jsonb not null default '[]'::jsonb,
  labels jsonb not null default '{}'::jsonb,
  grader text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pitch_drill_takes_owner_taken_idx on public.pitch_drill_takes (owner_id, taken_at desc);

create trigger pitch_drill_takes_set_updated_at before update on public.pitch_drill_takes
  for each row execute function sync_private.set_updated_at();

alter table public.pitch_drill_takes enable row level security;

create policy pitch_drill_takes_select on public.pitch_drill_takes
  for select to authenticated
  using (owner_id = auth.uid());
create policy pitch_drill_takes_insert on public.pitch_drill_takes
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy pitch_drill_takes_update on public.pitch_drill_takes
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy pitch_drill_takes_delete on public.pitch_drill_takes
  for delete to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Storage: private drill-takes bucket. Path: {owner_user_id}/{take_id}.ext
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'drill-takes',
  'drill-takes',
  false,
  10485760, -- 10 MiB; a take is a few seconds
  array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy drill_takes_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'drill-takes' and sync_private.storage_owner_id(name) = auth.uid());

create policy drill_takes_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'drill-takes' and sync_private.storage_owner_id(name) = auth.uid());

create policy drill_takes_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'drill-takes' and sync_private.storage_owner_id(name) = auth.uid())
  with check (bucket_id = 'drill-takes' and sync_private.storage_owner_id(name) = auth.uid());

create policy drill_takes_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'drill-takes' and sync_private.storage_owner_id(name) = auth.uid());
