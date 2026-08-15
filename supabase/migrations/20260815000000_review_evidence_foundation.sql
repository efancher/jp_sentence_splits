-- Evidence-model foundation for the review system (Phase 7.1). See
-- docs/STATUS.md and docs/UNIFIED_APP_ARCHITECTURE.md. Purely additive: new
-- nullable columns on reviews, plus a new vocabulary_confusions table. No
-- existing table is altered in a breaking way.

-- ---------------------------------------------------------------------------
-- reviews: assistance / source / context-sentence tracking (brief §9/§17)
-- ---------------------------------------------------------------------------
-- context_sentence_id uses on delete set null (not cascade) so a sentence
-- deletion never removes review evidence, matching reviews' append-only,
-- never-delete design intent. Nothing writes this column yet in this phase
-- (Phase 7.4 is the first writer) — worth re-checking then whether Postgres
-- RLS on `reviews` (insert/select only, no update policy) interacts oddly
-- with the implicit UPDATE this FK action performs on sentence deletion.
alter table public.reviews
  add column assistance jsonb,
  add column source text check (source in ('scheduled_review', 'natural_encounter')),
  add column context_sentence_id text references public.sentences (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Vocabulary confusions (brief §10): an undirected pair of vocabulary items
-- the learner tends to confuse. itemAId/itemBId are canonicalized
-- (itemAId < itemBId as text) by the application before insert, so a pair is
-- never stored twice in both directions — enforced here too.
-- ---------------------------------------------------------------------------
create table public.vocabulary_confusions (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  item_a_id text not null references public.vocabulary_items (id) on delete cascade,
  item_b_id text not null references public.vocabulary_items (id) on delete cascade,
  confusion_type text not null check (
    confusion_type in ('reading', 'kanji', 'meaning', 'transitivity', 'synonym', 'grammar', 'other')
  ),
  observed_count integer not null default 1,
  last_observed_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id),
  constraint vocabulary_confusions_ordered_pair check (item_a_id < item_b_id)
);

create index vocabulary_confusions_owner_id_idx on public.vocabulary_confusions (owner_id);
create index vocabulary_confusions_item_a_id_idx on public.vocabulary_confusions (item_a_id);
create index vocabulary_confusions_item_b_id_idx on public.vocabulary_confusions (item_b_id);
create unique index vocabulary_confusions_pair_uidx
  on public.vocabulary_confusions (item_a_id, item_b_id)
  where deleted_at is null;

create trigger vocabulary_confusions_set_updated_at before update on public.vocabulary_confusions
  for each row execute function sync_private.set_updated_at();
create trigger vocabulary_confusions_bump_version before update on public.vocabulary_confusions
  for each row execute function sync_private.bump_version();
create trigger vocabulary_confusions_sync_event after insert or update on public.vocabulary_confusions
  for each row execute function sync_private.append_sync_event();

alter table public.vocabulary_confusions enable row level security;

-- Same ownership-of-references pattern as sentence_vocabulary/vocabulary_kanji
-- in the Phase 1 migration: owner_id = auth.uid() alone isn't enough, both
-- referenced vocabulary_items must also belong to the same owner.
create policy vocabulary_confusions_select on public.vocabulary_confusions
  for select to authenticated
  using (owner_id = auth.uid());
create policy vocabulary_confusions_insert on public.vocabulary_confusions
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and sync_private.owns_vocabulary_item(item_a_id)
    and sync_private.owns_vocabulary_item(item_b_id)
  );
create policy vocabulary_confusions_update on public.vocabulary_confusions
  for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and sync_private.owns_vocabulary_item(item_a_id)
    and sync_private.owns_vocabulary_item(item_b_id)
  );
create policy vocabulary_confusions_delete on public.vocabulary_confusions
  for delete to authenticated
  using (owner_id = auth.uid());
