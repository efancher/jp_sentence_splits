-- Grammar-learning system foundation (docs/AI_OVERVIEW.md, Phase 1 of the
-- grammar-learning plan). Purely additive: three new tables, one widened
-- check constraint on the existing study_items.subject_type. No existing
-- table is altered destructively.
--
-- grammar_patterns  = the reusable Japanese construction, canonical across
--                      the corpus (mirrors vocabulary_items).
-- sentence_grammar  = one encounter with a pattern in one sentence (mirrors
--                      sentence_vocabulary).
-- grammar_relationships = a typed edge between two patterns — structurally
--                      mirrors vocabulary_confusions (canonicalized pair,
--                      get-or-create, observed_count) but is its own table,
--                      not a reuse: vocabulary_confusions' item_a_id/item_b_id
--                      are non-polymorphic FKs into vocabulary_items and its
--                      confusion_type values don't apply to grammar. Unlike
--                      vocabulary_confusions, more than one relationship row
--                      can exist for the same pair (one per distinct
--                      relationship_type), so the unique index/ownership
--                      check below include relationship_type.

-- ---------------------------------------------------------------------------
-- analyses: grammar suggestions (embedded, mirrors vocabulary_selections —
-- not a table, see GrammarSuggestion in src/domain/types.ts).
-- ---------------------------------------------------------------------------
alter table public.analyses
  add column grammar_suggestions jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- Grammar patterns
-- ---------------------------------------------------------------------------
create table public.grammar_patterns (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  canonical_name text not null,
  normalized_key text not null,
  aliases jsonb not null default '[]'::jsonb,
  short_meaning text not null default '',
  structural_template text,
  explanation text,
  structural_notes text,
  family text,
  notes text,
  provenance text not null check (provenance in ('manual', 'ai_suggested')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index grammar_patterns_owner_id_idx on public.grammar_patterns (owner_id);
-- Dedup key mirrors ensureGrammarPattern's Dexie lookup (normalizedKey,
-- src/lib/grammarPatterns.ts) — exact match modulo tilde/whitespace, not
-- kanji/kana-variant-aware (see the doc comment there).
create unique index grammar_patterns_owner_normalized_key_uidx
  on public.grammar_patterns (owner_id, normalized_key)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Sentence <-> grammar-pattern encounters
-- ---------------------------------------------------------------------------
create table public.sentence_grammar (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  sentence_id text not null references public.sentences (id) on delete cascade,
  grammar_pattern_id text not null references public.grammar_patterns (id) on delete cascade,
  chunk_id text,
  surface_form text,
  -- start/end -> *_index: `end` needs quoting as a Postgres identifier
  -- (reserved in CASE...END etc.), simplest to just avoid it — matches
  -- src/sync/mappers.ts's sentenceGrammarToRemote.
  start_index integer,
  end_index integer,
  occurrence_explanation text,
  confirmed_by_learner boolean not null default false,
  source text not null check (source in ('manual', 'ai_suggested')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index sentence_grammar_owner_id_idx on public.sentence_grammar (owner_id);
create index sentence_grammar_sentence_id_idx on public.sentence_grammar (sentence_id);
create index sentence_grammar_grammar_pattern_id_idx on public.sentence_grammar (grammar_pattern_id);
-- One occurrence row per (sentence, pattern) — matches ensureSentenceGrammar's
-- [sentenceId+grammarPatternId] Dexie index exactly; a pattern recurring
-- twice in one sentence collapses onto one row (accepted v1 simplification).
create unique index sentence_grammar_uidx
  on public.sentence_grammar (sentence_id, grammar_pattern_id)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Grammar-pattern relationships (typed edges)
-- ---------------------------------------------------------------------------
create table public.grammar_relationships (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  pattern_a_id text not null references public.grammar_patterns (id) on delete cascade,
  pattern_b_id text not null references public.grammar_patterns (id) on delete cascade,
  relationship_type text not null check (
    relationship_type in (
      'similar_meaning', 'contrast', 'commonly_confused', 'stronger_stance',
      'weaker_stance', 'formal_variant', 'structural_relative'
    )
  ),
  notes text,
  observed_count integer not null default 1,
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id),
  constraint grammar_relationships_ordered_pair check (pattern_a_id < pattern_b_id)
);

create index grammar_relationships_owner_id_idx on public.grammar_relationships (owner_id);
create index grammar_relationships_pattern_a_id_idx on public.grammar_relationships (pattern_a_id);
create index grammar_relationships_pattern_b_id_idx on public.grammar_relationships (pattern_b_id);
-- Unlike vocabulary_confusions_pair_uidx, this includes relationship_type:
-- the same pair may legitimately have more than one edge (e.g. both
-- structural_relative and, independently, commonly_confused).
create unique index grammar_relationships_pair_type_uidx
  on public.grammar_relationships (pattern_a_id, pattern_b_id, relationship_type)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Widen study_items.subject_type to accept 'grammarPattern' (same precedent
-- as the 'vocabularyConfusion' migration, 20260816010000).
-- ---------------------------------------------------------------------------
alter table public.study_items
  drop constraint study_items_subject_type_check;

alter table public.study_items
  add constraint study_items_subject_type_check
  check (subject_type in ('sentence', 'vocabularyItem', 'chunk', 'vocabularyConfusion', 'grammarPattern'));

-- ---------------------------------------------------------------------------
-- Triggers: reuse the existing sync_private helper functions verbatim.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'grammar_patterns', 'sentence_grammar', 'grammar_relationships'
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
-- RLS ownership helper (same "owner_id = auth.uid() alone isn't enough"
-- reasoning as owns_vocabulary_item/owns_kanji/owns_study_item, Phase 1
-- migration).
-- ---------------------------------------------------------------------------
create or replace function sync_private.owns_grammar_pattern(p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.grammar_patterns g
    where g.id = p_id and g.owner_id = auth.uid() and g.deleted_at is null
  );
$$;

grant execute on function sync_private.owns_grammar_pattern to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.grammar_patterns enable row level security;
alter table public.sentence_grammar enable row level security;
alter table public.grammar_relationships enable row level security;

create policy grammar_patterns_all on public.grammar_patterns
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- sentence_id ownership reuses sentence_editable() (sentences can already be
-- shared via book membership), same pattern as sentence_vocabulary;
-- grammar_pattern_id is owner-only, since grammar_patterns has no sharing
-- model yet.
create policy sentence_grammar_select on public.sentence_grammar
  for select to authenticated
  using (owner_id = auth.uid());
create policy sentence_grammar_insert on public.sentence_grammar
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and sync_private.sentence_editable(sentence_id)
    and sync_private.owns_grammar_pattern(grammar_pattern_id)
  );
create policy sentence_grammar_update on public.sentence_grammar
  for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and sync_private.sentence_editable(sentence_id)
    and sync_private.owns_grammar_pattern(grammar_pattern_id)
  );
create policy sentence_grammar_delete on public.sentence_grammar
  for delete to authenticated
  using (owner_id = auth.uid());

-- Same ownership-of-references pattern as vocabulary_confusions: both
-- referenced grammar_patterns must belong to the same owner.
create policy grammar_relationships_select on public.grammar_relationships
  for select to authenticated
  using (owner_id = auth.uid());
create policy grammar_relationships_insert on public.grammar_relationships
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and sync_private.owns_grammar_pattern(pattern_a_id)
    and sync_private.owns_grammar_pattern(pattern_b_id)
  );
create policy grammar_relationships_update on public.grammar_relationships
  for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and sync_private.owns_grammar_pattern(pattern_a_id)
    and sync_private.owns_grammar_pattern(pattern_b_id)
  );
create policy grammar_relationships_delete on public.grammar_relationships
  for delete to authenticated
  using (owner_id = auth.uid());
