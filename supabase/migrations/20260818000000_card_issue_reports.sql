-- Card issue reports: a learner-authored free-text flag on a review card
-- ("this reading looks wrong", "translation doesn't match"), referencing
-- the study item (and, where available, the sentence) it was raised
-- against. Meant to be batched: reported during review, reviewed/resolved
-- later in one sitting. Purely additive. See docs/STATUS.md.
create table public.card_issue_reports (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  study_item_id text not null references public.study_items (id) on delete cascade,
  sentence_id text references public.sentences (id) on delete set null,
  activity_type text not null,
  note text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index card_issue_reports_owner_id_idx on public.card_issue_reports (owner_id);
create index card_issue_reports_study_item_id_idx on public.card_issue_reports (study_item_id);
create index card_issue_reports_status_idx on public.card_issue_reports (owner_id, status);

create trigger card_issue_reports_set_updated_at before update on public.card_issue_reports
  for each row execute function sync_private.set_updated_at();
create trigger card_issue_reports_bump_version before update on public.card_issue_reports
  for each row execute function sync_private.bump_version();
create trigger card_issue_reports_sync_event after insert or update on public.card_issue_reports
  for each row execute function sync_private.append_sync_event();

alter table public.card_issue_reports enable row level security;

-- Same ownership-of-references pattern as reviews: owner_id = auth.uid()
-- alone isn't enough, the referenced study_item must also belong to the
-- same owner (sync_private.owns_study_item, defined in the Phase 1
-- migration).
create policy card_issue_reports_select on public.card_issue_reports
  for select to authenticated
  using (owner_id = auth.uid());
create policy card_issue_reports_insert on public.card_issue_reports
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and sync_private.owns_study_item(study_item_id)
  );
create policy card_issue_reports_update on public.card_issue_reports
  for update to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and sync_private.owns_study_item(study_item_id)
  );
create policy card_issue_reports_delete on public.card_issue_reports
  for delete to authenticated
  using (owner_id = auth.uid());
