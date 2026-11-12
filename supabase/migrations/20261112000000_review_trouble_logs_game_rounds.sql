-- Per-device evidence that now follows the learner between devices:
-- review trouble-tag logs and short-game rounds. Both are append-only usage
-- logs (insert/select only, no update/delete policy), shaped like
-- pitch_drill_attempts. Neither feeds FSRS or any gate.
--
-- study_item_id / sentence_id carry no foreign keys on purpose: they are
-- historical references, rows must still sync when the target was retired,
-- and a missing parent would otherwise stall the push queue.

create table public.review_trouble_logs (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  "timestamp" timestamptz not null default now(),
  study_item_id text not null,
  sentence_id text not null,
  rating text not null,
  tags jsonb not null default '[]'::jsonb,
  queued jsonb not null default '{"freshTry": false, "shadow": false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index review_trouble_logs_owner_id_idx on public.review_trouble_logs (owner_id);
create index review_trouble_logs_sentence_id_idx on public.review_trouble_logs (sentence_id);
create index review_trouble_logs_timestamp_idx on public.review_trouble_logs ("timestamp");

create trigger review_trouble_logs_set_updated_at before update on public.review_trouble_logs
  for each row execute function sync_private.set_updated_at();
create trigger review_trouble_logs_bump_version before update on public.review_trouble_logs
  for each row execute function sync_private.bump_version();
create trigger review_trouble_logs_sync_event after insert or update on public.review_trouble_logs
  for each row execute function sync_private.append_sync_event();

alter table public.review_trouble_logs enable row level security;

create policy review_trouble_logs_select on public.review_trouble_logs
  for select to authenticated
  using (owner_id = auth.uid());
create policy review_trouble_logs_insert on public.review_trouble_logs
  for insert to authenticated
  with check (owner_id = auth.uid());

create table public.game_rounds (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  "timestamp" timestamptz not null default now(),
  game_id text not null,
  signal text not null,
  pool_size integer not null default 0,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index game_rounds_owner_id_idx on public.game_rounds (owner_id);
create index game_rounds_game_id_idx on public.game_rounds (game_id);
create index game_rounds_timestamp_idx on public.game_rounds ("timestamp");

create trigger game_rounds_set_updated_at before update on public.game_rounds
  for each row execute function sync_private.set_updated_at();
create trigger game_rounds_bump_version before update on public.game_rounds
  for each row execute function sync_private.bump_version();
create trigger game_rounds_sync_event after insert or update on public.game_rounds
  for each row execute function sync_private.append_sync_event();

alter table public.game_rounds enable row level security;

create policy game_rounds_select on public.game_rounds
  for select to authenticated
  using (owner_id = auth.uid());
create policy game_rounds_insert on public.game_rounds
  for insert to authenticated
  with check (owner_id = auth.uid());
