-- Sync issue reports: a learner-authored free-text flag raised from the
-- sync UI (ConflictPanel / Account & sync settings) when sync behavior
-- looks wrong ("seeing way more conflicts than expected"), paired with a
-- diagnostics snapshot (src/sync/logger.ts's buildDiagnosticsSnapshot) so
-- it can be triaged later without the reporter needing to paste anything
-- into a Claude session by hand. Mirrors card_issue_reports (batched,
-- reviewed later) but has no study_item FK — sync trouble isn't always
-- tied to one card, and may span multiple entities/records. See
-- docs/STATUS.md.
create table public.sync_issue_reports (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  note text not null,
  diagnostics_snapshot text not null,
  conflict_entity text,
  conflict_record_id text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index sync_issue_reports_owner_id_idx on public.sync_issue_reports (owner_id);
create index sync_issue_reports_status_idx on public.sync_issue_reports (owner_id, status);

create trigger sync_issue_reports_set_updated_at before update on public.sync_issue_reports
  for each row execute function sync_private.set_updated_at();
create trigger sync_issue_reports_bump_version before update on public.sync_issue_reports
  for each row execute function sync_private.bump_version();
create trigger sync_issue_reports_sync_event after insert or update on public.sync_issue_reports
  for each row execute function sync_private.append_sync_event();

alter table public.sync_issue_reports enable row level security;

-- No cross-table ownership check needed (no FK into learner data) — plain
-- owner_id = auth.uid() is sufficient, unlike card_issue_reports.
create policy sync_issue_reports_select on public.sync_issue_reports
  for select to authenticated
  using (owner_id = auth.uid());
create policy sync_issue_reports_insert on public.sync_issue_reports
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy sync_issue_reports_update on public.sync_issue_reports
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy sync_issue_reports_delete on public.sync_issue_reports
  for delete to authenticated
  using (owner_id = auth.uid());
