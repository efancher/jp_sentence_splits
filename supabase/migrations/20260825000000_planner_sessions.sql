-- Planner sessions: the Learning Orchestrator's per-calendar-day
-- recommended/executed session (src/lib/sessionPlanner.ts,
-- PlannerSession in domain/types.ts), previously local-only (Dexie only,
-- see docs/STATUS.md). Synced so the "continue where you left off"
-- SessionBar follows the learner across devices instead of each device
-- re-planning its own session for the day. `steps` embeds the ordered
-- step list (same "small embedded list, not a join table" precedent as
-- analyses.chunks) — no per-step foreign keys to enforce, since steps
-- reference sentences/books/grammar patterns/vocabulary items loosely
-- (a step can outlive or predate any of those being synced).
--
-- Conflict policy is last-write-wins, not the usual manual
-- keep-local/keep-remote/duplicate flow (src/sync/engine.ts's
-- forcePushOverwrite) — this is session execution bookkeeping, not
-- durable content, so silently letting the most recent device's push win
-- is an acceptable simplification the learner never has to resolve.
create table public.planner_sessions (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  date text not null,
  target_minutes integer not null,
  allocation jsonb not null default '{}'::jsonb,
  explanation jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'ended_early')),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index planner_sessions_owner_id_idx on public.planner_sessions (owner_id);
create index planner_sessions_owner_id_date_idx on public.planner_sessions (owner_id, date);

create trigger planner_sessions_set_updated_at before update on public.planner_sessions
  for each row execute function sync_private.set_updated_at();
create trigger planner_sessions_bump_version before update on public.planner_sessions
  for each row execute function sync_private.bump_version();
create trigger planner_sessions_sync_event after insert or update on public.planner_sessions
  for each row execute function sync_private.append_sync_event();

alter table public.planner_sessions enable row level security;

create policy planner_sessions_select on public.planner_sessions
  for select to authenticated
  using (owner_id = auth.uid());
create policy planner_sessions_insert on public.planner_sessions
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy planner_sessions_update on public.planner_sessions
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy planner_sessions_delete on public.planner_sessions
  for delete to authenticated
  using (owner_id = auth.uid());
