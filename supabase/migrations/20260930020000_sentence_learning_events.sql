-- Sentence-first lesson evidence (docs/SENTENCE_FIRST_LEARNING_PLAN.md, Phase 2).
-- Append-only log of walkthrough openings, in-sentence target practice and
-- Compare uses views. Same shape/policies as pitch_drill_attempts: insert/select
-- only, never a review, never read by FSRS. book_id / chapter_id / sentence_id
-- are deliberately NOT foreign keys: an event is evidence of what the learner
-- saw, and must still sync if its sentence or chapter is later removed.

create table public.sentence_learning_events (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  "timestamp" timestamptz not null default now(),
  visit_id text not null,
  action text not null check (action in
    ('walkthrough_opened', 'walkthrough_completed', 'target_practice', 'compare_uses_viewed')),
  book_id text not null,
  chapter_id text,
  sentence_id text not null,
  target_kind text,
  target_key text,
  target_label text,
  support text check (support in ('explanation_hidden')),
  outcome text check (outcome in ('got_it', 'needed_help')),
  assessment_source text check (assessment_source in ('self')),
  exposed_sentence_id text,
  quiet_mode boolean,
  inventory_revision text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index sentence_learning_events_owner_id_idx on public.sentence_learning_events (owner_id);
create index sentence_learning_events_book_id_idx on public.sentence_learning_events (book_id);
create index sentence_learning_events_timestamp_idx on public.sentence_learning_events ("timestamp");

create trigger sentence_learning_events_set_updated_at before update on public.sentence_learning_events
  for each row execute function sync_private.set_updated_at();
create trigger sentence_learning_events_bump_version before update on public.sentence_learning_events
  for each row execute function sync_private.bump_version();
create trigger sentence_learning_events_sync_event after insert or update on public.sentence_learning_events
  for each row execute function sync_private.append_sync_event();

alter table public.sentence_learning_events enable row level security;

create policy sentence_learning_events_select on public.sentence_learning_events
  for select to authenticated
  using (owner_id = auth.uid());
create policy sentence_learning_events_insert on public.sentence_learning_events
  for insert to authenticated
  with check (owner_id = auth.uid());
