-- Pitch-accent drill usage tracking + shape-level miss data (docs/STATUS.md).
-- Two additive pieces, purely for later analysis (a report script, or a
-- future conversation querying directly) — nothing here changes FSRS
-- scheduling or gates the free drill, which stays ungated practice.
--
-- 1. reviews: two nullable columns carrying the pitch_accent SRS card's
--    dictionary vs. chosen H/L shape (e.g. "lhhl" vs "lhll"), so shape-level
--    confusions can be mined out of ordinary review history without a
--    separate table. Populated only for activity_type = 'pitch_accent'.
-- 2. pitch_drill_attempts: an append-only log of the free, ungated
--    PitchAccentDrillPage practice — one row per scored target word per
--    take. Mirrors reviews' append-only shape (insert/select only, no
--    update/delete policy).

alter table public.reviews
  add column pitch_expected_shape text,
  add column pitch_chosen_shape text;

create table public.pitch_drill_attempts (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  "timestamp" timestamptz not null default now(),
  mode text not null check (mode in ('sentence', 'word')),
  -- Nullable: a take whose word couldn't be resolved back to a vocabulary
  -- item is still worth logging for overall usage volume.
  vocabulary_item_id text references public.vocabulary_items (id) on delete set null,
  surface_form text not null,
  reading text not null,
  context_sentence_id text not null references public.sentences (id) on delete cascade,
  measured boolean not null default false,
  mismatch boolean not null default false,
  confidence text check (confidence in ('low', 'medium', 'high')),
  expected_shape text,
  measured_shape text,
  focus_triggered boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index pitch_drill_attempts_owner_id_idx on public.pitch_drill_attempts (owner_id);
create index pitch_drill_attempts_vocabulary_item_id_idx
  on public.pitch_drill_attempts (vocabulary_item_id);
create index pitch_drill_attempts_timestamp_idx on public.pitch_drill_attempts ("timestamp");

create trigger pitch_drill_attempts_set_updated_at before update on public.pitch_drill_attempts
  for each row execute function sync_private.set_updated_at();
create trigger pitch_drill_attempts_bump_version before update on public.pitch_drill_attempts
  for each row execute function sync_private.bump_version();
create trigger pitch_drill_attempts_sync_event after insert or update on public.pitch_drill_attempts
  for each row execute function sync_private.append_sync_event();

alter table public.pitch_drill_attempts enable row level security;

-- Append-only, same as reviews: insert/select only, no update/delete policy
-- (the triggers above are harmless no-ops since nothing ever issues an
-- UPDATE against this table). vocabulary_item_id ownership reuses the
-- existing sync_private.owns_vocabulary_item helper when present.
create policy pitch_drill_attempts_select on public.pitch_drill_attempts
  for select to authenticated
  using (owner_id = auth.uid());
create policy pitch_drill_attempts_insert on public.pitch_drill_attempts
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (vocabulary_item_id is null or sync_private.owns_vocabulary_item(vocabulary_item_id))
  );
