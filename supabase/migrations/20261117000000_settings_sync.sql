-- Study values from AppSettings now follow the learner across signed-in
-- devices: one row per owner keyed 'settings', `data` holding only the synced
-- subset (src/lib/settingsSync.ts SYNCED_SETTINGS_KEYS — study toggles,
-- planner numbers, unlock/fresh-try/snooze records). Per-device fields
-- (theme, tts, quiet mode, last-opened book, shadowing note) never leave the
-- device, so the pull path merges rather than replaces. Last-write-wins:
-- see LAST_WRITE_WINS_ENTITIES in src/sync/engine.ts. The composite primary
-- key keeps id='settings' unique per owner while RLS isolates rows.
create table public.settings (
  id text not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id),
  primary key (owner_id, id)
);

create index settings_owner_id_idx on public.settings (owner_id);

create trigger settings_set_updated_at before update on public.settings
  for each row execute function sync_private.set_updated_at();
create trigger settings_bump_version before update on public.settings
  for each row execute function sync_private.bump_version();
create trigger settings_sync_event after insert or update on public.settings
  for each row execute function sync_private.append_sync_event();

alter table public.settings enable row level security;

create policy settings_select on public.settings
  for select to authenticated
  using (owner_id = auth.uid());
create policy settings_insert on public.settings
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy settings_update on public.settings
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
-- No delete policy: the settings row is never tombstoned; the sync engine
-- never issues deletes for it.
