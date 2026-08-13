-- Unified study model: sources, vocabulary/kanji relationships, FSRS study
-- items, and append-only review history. See docs/UNIFIED_APP_ARCHITECTURE.md
-- §8/§15 Phase 1. Purely additive — no existing table is altered.
--
-- All new tables are owner-only (no book-sharing extension yet, mirroring
-- import_batches/inbox rather than the book-shared sentences/analyses
-- pattern) — simplest option that satisfies today's needs; sharing can be
-- added later without a breaking change if it turns out to matter.

-- ---------------------------------------------------------------------------
-- Sources
-- ---------------------------------------------------------------------------
create table public.sources (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  type text not null check (type in ('satori', 'youtube', 'podcast', 'manual', 'other')),
  creator text,
  url text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index sources_owner_id_idx on public.sources (owner_id);
create unique index sources_owner_external_id_uidx
  on public.sources (owner_id, external_id)
  where deleted_at is null and external_id is not null;

-- ---------------------------------------------------------------------------
-- Vocabulary items
-- ---------------------------------------------------------------------------
create table public.vocabulary_items (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  expression text not null,
  reading text not null default '',
  meaning text not null default '',
  part_of_speech text,
  notes text,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index vocabulary_items_owner_id_idx on public.vocabulary_items (owner_id);
create index vocabulary_items_expression_idx on public.vocabulary_items (expression);
-- Deliberately unique on (expression, reading), not expression alone —
-- homophones (e.g. 週間/習慣) must stay distinct.
create unique index vocabulary_items_owner_expr_reading_uidx
  on public.vocabulary_items (owner_id, expression, reading)
  where deleted_at is null;
create unique index vocabulary_items_owner_external_id_uidx
  on public.vocabulary_items (owner_id, external_id)
  where deleted_at is null and external_id is not null;

-- ---------------------------------------------------------------------------
-- Sentence <-> vocabulary links
-- ---------------------------------------------------------------------------
create table public.sentence_vocabulary (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  sentence_id text not null references public.sentences (id) on delete cascade,
  vocabulary_item_id text not null references public.vocabulary_items (id) on delete cascade,
  chunk_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index sentence_vocabulary_owner_id_idx on public.sentence_vocabulary (owner_id);
create index sentence_vocabulary_sentence_id_idx on public.sentence_vocabulary (sentence_id);
create index sentence_vocabulary_vocabulary_item_id_idx on public.sentence_vocabulary (vocabulary_item_id);
create unique index sentence_vocabulary_uidx
  on public.sentence_vocabulary (sentence_id, vocabulary_item_id, coalesce(chunk_id, ''))
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Kanji
-- ---------------------------------------------------------------------------
create table public.kanji (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  character text not null,
  meanings jsonb not null default '[]'::jsonb,
  onyomi jsonb not null default '[]'::jsonb,
  kunyomi jsonb not null default '[]'::jsonb,
  nanori jsonb not null default '[]'::jsonb,
  notes text,
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id),
  constraint kanji_character_single_char check (char_length(character) = 1)
);

create index kanji_owner_id_idx on public.kanji (owner_id);
create unique index kanji_owner_character_uidx
  on public.kanji (owner_id, character)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Vocabulary <-> kanji links (which kanji, at which position, in a word)
-- ---------------------------------------------------------------------------
create table public.vocabulary_kanji (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  vocabulary_item_id text not null references public.vocabulary_items (id) on delete cascade,
  kanji_id text not null references public.kanji (id) on delete cascade,
  position_in_word integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index vocabulary_kanji_owner_id_idx on public.vocabulary_kanji (owner_id);
create index vocabulary_kanji_vocabulary_item_id_idx on public.vocabulary_kanji (vocabulary_item_id);
create index vocabulary_kanji_kanji_id_idx on public.vocabulary_kanji (kanji_id);
create unique index vocabulary_kanji_uidx
  on public.vocabulary_kanji (vocabulary_item_id, kanji_id, position_in_word)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Study items (FSRS scheduling state; activity_type is free-form, additive)
-- ---------------------------------------------------------------------------
create table public.study_items (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  subject_type text not null check (subject_type in ('sentence', 'vocabularyItem', 'chunk')),
  subject_id text not null,
  activity_type text not null,
  fsrs_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index study_items_owner_id_idx on public.study_items (owner_id);
create index study_items_subject_idx on public.study_items (subject_type, subject_id);
create unique index study_items_uidx
  on public.study_items (owner_id, subject_type, subject_id, activity_type)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Reviews (append-only; never updated after insert)
-- ---------------------------------------------------------------------------
create table public.reviews (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  study_item_id text not null references public.study_items (id) on delete cascade,
  "timestamp" timestamptz not null default now(),
  rating text not null check (rating in ('again', 'hard', 'good', 'easy')),
  response_raw text,
  expected_answer text,
  elapsed_ms integer,
  error_classification jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index reviews_owner_id_idx on public.reviews (owner_id);
create index reviews_study_item_id_idx on public.reviews (study_item_id, "timestamp");

-- ---------------------------------------------------------------------------
-- Triggers: reuse the existing sync_private helper functions verbatim
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'sources', 'vocabulary_items', 'sentence_vocabulary',
    'kanji', 'vocabulary_kanji', 'study_items', 'reviews'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I
       for each row execute function sync_private.set_updated_at()',
      t, t
    );
    execute format(
      'create trigger %I_bump_version before update on public.%I
       for each row execute function sync_private.bump_version()',
      t, t
    );
    execute format(
      'create trigger %I_sync_event after insert or update on public.%I
       for each row execute function sync_private.append_sync_event()',
      t, t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS ownership helpers for cross-table references.
--
-- owner_id = auth.uid() on the row being written is NOT enough by itself:
-- without also checking that *referenced* rows (vocabulary_item_id,
-- kanji_id, sentence_id, study_item_id) belong to the same owner, a caller
-- could insert e.g. a sentence_vocabulary/reviews row under their own
-- owner_id that points at someone else's vocabulary_item/study_item —
-- nonsensical cross-owner references that the simple "owner_id = auth.uid()"
-- check alone does not prevent.
-- ---------------------------------------------------------------------------
create or replace function sync_private.owns_vocabulary_item(p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.vocabulary_items v
    where v.id = p_id and v.owner_id = auth.uid() and v.deleted_at is null
  );
$$;

create or replace function sync_private.owns_kanji(p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.kanji k
    where k.id = p_id and k.owner_id = auth.uid() and k.deleted_at is null
  );
$$;

create or replace function sync_private.owns_study_item(p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.study_items s
    where s.id = p_id and s.owner_id = auth.uid() and s.deleted_at is null
  );
$$;

grant execute on function sync_private.owns_vocabulary_item to authenticated;
grant execute on function sync_private.owns_kanji to authenticated;
grant execute on function sync_private.owns_study_item to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: owner-only on every new table (no book-sharing extension yet)
-- ---------------------------------------------------------------------------
alter table public.sources enable row level security;
alter table public.vocabulary_items enable row level security;
alter table public.sentence_vocabulary enable row level security;
alter table public.kanji enable row level security;
alter table public.vocabulary_kanji enable row level security;
alter table public.study_items enable row level security;
alter table public.reviews enable row level security;

create policy sources_all on public.sources
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy vocabulary_items_all on public.vocabulary_items
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- sentence_id ownership reuses the existing sentence_editable() helper
-- (sentences can already be shared via book membership) rather than a
-- strict-ownership check, so a book editor can link vocabulary on a shared
-- sentence; vocabulary_item_id is owner-only, since vocabulary_items has no
-- sharing model yet.
create policy sentence_vocabulary_select on public.sentence_vocabulary
  for select to authenticated
  using (owner_id = auth.uid());
create policy sentence_vocabulary_insert on public.sentence_vocabulary
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and sync_private.sentence_editable(sentence_id)
    and sync_private.owns_vocabulary_item(vocabulary_item_id)
  );
create policy sentence_vocabulary_update on public.sentence_vocabulary
  for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and sync_private.sentence_editable(sentence_id)
    and sync_private.owns_vocabulary_item(vocabulary_item_id)
  );
create policy sentence_vocabulary_delete on public.sentence_vocabulary
  for delete to authenticated
  using (owner_id = auth.uid());

create policy kanji_all on public.kanji
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy vocabulary_kanji_select on public.vocabulary_kanji
  for select to authenticated
  using (owner_id = auth.uid());
create policy vocabulary_kanji_insert on public.vocabulary_kanji
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and sync_private.owns_vocabulary_item(vocabulary_item_id)
    and sync_private.owns_kanji(kanji_id)
  );
create policy vocabulary_kanji_update on public.vocabulary_kanji
  for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and sync_private.owns_vocabulary_item(vocabulary_item_id)
    and sync_private.owns_kanji(kanji_id)
  );
create policy vocabulary_kanji_delete on public.vocabulary_kanji
  for delete to authenticated
  using (owner_id = auth.uid());

-- study_items.subject_id is polymorphic (sentence | vocabularyItem | chunk,
-- selected by subject_type) so it cannot be a plain FK or checked by a
-- single helper the way the tables above are; ownership of the referenced
-- subject is not verified at the database layer for this table. Acceptable
-- for now (single-user in practice; nothing reads across owners), but this
-- is a known, narrower version of the same class of gap fixed elsewhere in
-- this migration — revisit if study_items ever needs to be trusted in a
-- multi-user context.
create policy study_items_all on public.study_items
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Reviews: insert/select only — no update/delete, matching its append-only
-- design intent (the set_updated_at/bump_version triggers above are harmless
-- no-ops since nothing ever issues an UPDATE against this table).
create policy reviews_select on public.reviews
  for select to authenticated
  using (owner_id = auth.uid());
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and sync_private.owns_study_item(study_item_id)
  );
