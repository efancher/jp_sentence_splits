-- Progressive glossing observations (structural decisions made in the sentence
-- walkthrough). Append-only like sentence_learning_events: insert/select only,
-- never a review, never read by FSRS. Holds observations only; the learner's
-- per-skill support level is recomputed from these on read. sentence_id /
-- book_id are deliberately NOT foreign keys so evidence survives removal.

create table public.gloss_decisions (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  "timestamp" timestamptz not null default now(),
  visit_id text not null,
  book_id text not null,
  sentence_id text not null,
  skill text not null check (skill in ('predicate', 'particle')),
  subskill text not null check (subskill in ('predicate', 'case', 'topic')),
  rule_key text not null,
  target_text text not null,
  level_shown smallint not null check (level_shown between 1 and 4),
  first_response text,
  first_correct boolean,
  reference_value text not null,
  reference_confidence text not null check (reference_confidence in ('settled', 'alternative', 'compare')),
  hint_max_step smallint not null check (hint_max_step between 0 and 3),
  explanation_opened boolean not null default false,
  blocker text check (blocker in ('word', 'form', 'structure', 'unsure')),
  vocab_helped boolean not null default false,
  translation_level smallint not null check (translation_level between 0 and 3),
  outcome text not null check (outcome in
    ('independent_correct', 'assisted_correct', 'unresolved', 'skipped', 'disputed', 'ungraded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index gloss_decisions_owner_id_idx on public.gloss_decisions (owner_id);
create index gloss_decisions_sentence_id_idx on public.gloss_decisions (sentence_id);
create index gloss_decisions_timestamp_idx on public.gloss_decisions ("timestamp");

create trigger gloss_decisions_set_updated_at before update on public.gloss_decisions
  for each row execute function sync_private.set_updated_at();
create trigger gloss_decisions_bump_version before update on public.gloss_decisions
  for each row execute function sync_private.bump_version();
create trigger gloss_decisions_sync_event after insert or update on public.gloss_decisions
  for each row execute function sync_private.append_sync_event();

alter table public.gloss_decisions enable row level security;

create policy gloss_decisions_select on public.gloss_decisions
  for select to authenticated
  using (owner_id = auth.uid());
create policy gloss_decisions_insert on public.gloss_decisions
  for insert to authenticated
  with check (owner_id = auth.uid());
