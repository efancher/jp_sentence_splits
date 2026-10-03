-- Chunk issue reports: chunk-boundary problems the external assistant flags
-- while writing particle checks (e.g. "ありが | とう" splits one word). Filed on
-- import so a later session can fix the chunker via `npm run issues:list-chunks`.
-- Same shape as sync_issue_reports (no cross-table FK; plain owner check).
create table public.chunk_issue_reports (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  sentence_id text not null,
  chunks jsonb not null default '[]'::jsonb,
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

create index chunk_issue_reports_owner_id_idx on public.chunk_issue_reports (owner_id);
create index chunk_issue_reports_status_idx on public.chunk_issue_reports (owner_id, status);

create trigger chunk_issue_reports_set_updated_at before update on public.chunk_issue_reports
  for each row execute function sync_private.set_updated_at();
create trigger chunk_issue_reports_bump_version before update on public.chunk_issue_reports
  for each row execute function sync_private.bump_version();
create trigger chunk_issue_reports_sync_event after insert or update on public.chunk_issue_reports
  for each row execute function sync_private.append_sync_event();

alter table public.chunk_issue_reports enable row level security;

create policy chunk_issue_reports_select on public.chunk_issue_reports
  for select to authenticated
  using (owner_id = auth.uid());
create policy chunk_issue_reports_insert on public.chunk_issue_reports
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy chunk_issue_reports_update on public.chunk_issue_reports
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy chunk_issue_reports_delete on public.chunk_issue_reports
  for delete to authenticated
  using (owner_id = auth.uid());
