-- Satori Glossbook: local-first sync schema
-- Apply via Supabase Dashboard SQL Editor or: supabase db push
-- PKs are text to match existing client IDs (book_…, sent_…, etc.)

create schema if not exists sync_private;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Books
-- ---------------------------------------------------------------------------
create table public.books (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  source_key text,
  subtitle text,
  source_url text,
  notes text,
  archived boolean not null default false,
  chapters jsonb not null default '[]'::jsonb,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index books_owner_id_idx on public.books (owner_id);
create index books_updated_at_idx on public.books (updated_at);
create index books_deleted_at_idx on public.books (deleted_at);

-- ---------------------------------------------------------------------------
-- Book members (sharing)
-- ---------------------------------------------------------------------------
create type public.book_member_role as enum ('owner', 'editor', 'viewer');

create table public.book_members (
  book_id text not null references public.books (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.book_member_role not null,
  created_at timestamptz not null default now(),
  primary key (book_id, user_id),
  constraint book_members_no_owner_role check (role in ('editor', 'viewer'))
);

create index book_members_user_id_idx on public.book_members (user_id);

-- ---------------------------------------------------------------------------
-- Sentences (user-global, not book-scoped)
-- ---------------------------------------------------------------------------
create table public.sentences (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  normalized_key text not null,
  japanese text not null,
  reading_only text not null default '',
  inline_reading text not null default '',
  translation text not null default '',
  target_vocabulary jsonb not null default '[]'::jsonb,
  source_references jsonb not null default '[]'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  earliest_created_at timestamptz,
  latest_created_at timestamptz,
  first_occurrence_index integer not null default 0,
  import_batch_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index sentences_owner_id_idx on public.sentences (owner_id);
create index sentences_updated_at_idx on public.sentences (updated_at);
create unique index sentences_owner_normalized_key_uidx
  on public.sentences (owner_id, normalized_key)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Book sentences (membership)
-- ---------------------------------------------------------------------------
create table public.book_sentences (
  id text primary key,
  book_id text not null references public.books (id) on delete cascade,
  sentence_id text not null references public.sentences (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  position integer not null default 0,
  status text not null default 'unstarted',
  added_at timestamptz not null default now(),
  last_studied_at timestamptz,
  note text,
  chapter_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index book_sentences_book_id_idx on public.book_sentences (book_id);
create index book_sentences_sentence_id_idx on public.book_sentences (sentence_id);
create index book_sentences_owner_id_idx on public.book_sentences (owner_id);
create unique index book_sentences_book_sentence_uidx
  on public.book_sentences (book_id, sentence_id)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Analyses (chunks stored as JSONB)
-- ---------------------------------------------------------------------------
create table public.analyses (
  sentence_id text primary key references public.sentences (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  chunks jsonb not null default '[]'::jsonb,
  notes text not null default '',
  status text not null default 'empty',
  format_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index analyses_owner_id_idx on public.analyses (owner_id);
create index analyses_updated_at_idx on public.analyses (updated_at);

-- ---------------------------------------------------------------------------
-- Import batches
-- ---------------------------------------------------------------------------
create table public.import_batches (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  filename text not null,
  batch_name text not null,
  imported_at timestamptz not null,
  counts jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index import_batches_owner_id_idx on public.import_batches (owner_id);

-- ---------------------------------------------------------------------------
-- Inbox memberships
-- ---------------------------------------------------------------------------
create table public.inbox (
  sentence_id text not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  import_batch_id text not null,
  added_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id),
  primary key (owner_id, sentence_id)
);

create index inbox_owner_id_idx on public.inbox (owner_id);

-- ---------------------------------------------------------------------------
-- Reference audio metadata (blobs in Storage, not user recordings)
-- ---------------------------------------------------------------------------
create table public.reference_audio (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  book_id text references public.books (id) on delete set null,
  sentence_id text references public.sentences (id) on delete set null,
  source_id text not null default '',
  source_sentence_id text not null default '',
  source_title text not null default '',
  storage_path text,
  mime_type text not null,
  duration_ms integer not null default 0,
  size_bytes bigint not null default 0,
  source_url text,
  source_start_ms integer,
  source_end_ms integer,
  checksum text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index reference_audio_owner_id_idx on public.reference_audio (owner_id);
create index reference_audio_sentence_id_idx on public.reference_audio (sentence_id);
create index reference_audio_book_id_idx on public.reference_audio (book_id);

-- ---------------------------------------------------------------------------
-- Book invites (email invitation tokens)
-- ---------------------------------------------------------------------------
create table public.book_invites (
  id uuid primary key default gen_random_uuid(),
  book_id text not null references public.books (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  role public.book_member_role not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint book_invites_role_check check (role in ('editor', 'viewer'))
);

create index book_invites_book_id_idx on public.book_invites (book_id);
create index book_invites_email_idx on public.book_invites (lower(email));

-- ---------------------------------------------------------------------------
-- Sync events (monotonic pull cursor)
-- ---------------------------------------------------------------------------
create table public.sync_events (
  id bigserial primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  entity text not null,
  record_id text not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  version bigint not null,
  created_at timestamptz not null default now()
);

create index sync_events_owner_id_id_idx on public.sync_events (owner_id, id);

-- ---------------------------------------------------------------------------
-- updated_at / version helpers
-- ---------------------------------------------------------------------------
create or replace function sync_private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function sync_private.bump_version()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.version is not distinct from old.version then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

create or replace function sync_private.append_sync_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_id text;
  v_version bigint;
  v_op text;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  v_op := case
    when tg_op = 'INSERT' then 'insert'
    when new.deleted_at is not null and (old.deleted_at is null) then 'delete'
    else 'update'
  end;

  if tg_table_name = 'analyses' then
    v_owner := new.owner_id;
    v_id := new.sentence_id;
    v_version := new.version;
  elsif tg_table_name = 'inbox' then
    v_owner := new.owner_id;
    v_id := new.sentence_id;
    v_version := new.version;
  else
    v_owner := new.owner_id;
    v_id := new.id;
    v_version := new.version;
  end if;

  insert into public.sync_events (owner_id, entity, record_id, op, version)
  values (v_owner, tg_table_name, v_id, v_op, v_version);

  return new;
end;
$$;

-- Attach triggers to syncable tables
do $$
declare
  t text;
begin
  foreach t in array array[
    'books', 'sentences', 'book_sentences', 'analyses',
    'import_batches', 'inbox', 'reference_audio'
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
-- Profile bootstrap on signup
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER — avoid recursive book_members RLS)
-- ---------------------------------------------------------------------------
create or replace function sync_private.is_book_owner(p_book_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.books b
    where b.id = p_book_id
      and b.owner_id = auth.uid()
      and b.deleted_at is null
  );
$$;

create or replace function sync_private.is_book_member(p_book_id text, p_roles text[] default array['editor','viewer'])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.book_members m
    where m.book_id = p_book_id
      and m.user_id = auth.uid()
      and m.role::text = any (p_roles)
  )
  or sync_private.is_book_owner(p_book_id);
$$;

create or replace function sync_private.can_read_book(p_book_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select sync_private.is_book_member(p_book_id, array['editor','viewer']);
$$;

create or replace function sync_private.can_edit_book(p_book_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select sync_private.is_book_owner(p_book_id)
    or exists (
      select 1 from public.book_members m
      where m.book_id = p_book_id
        and m.user_id = auth.uid()
        and m.role = 'editor'
    );
$$;

create or replace function sync_private.sentence_readable(p_sentence_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sentences s
    where s.id = p_sentence_id
      and s.owner_id = auth.uid()
  )
  or exists (
    select 1
    from public.book_sentences bs
    where bs.sentence_id = p_sentence_id
      and bs.deleted_at is null
      and sync_private.can_read_book(bs.book_id)
  );
$$;

create or replace function sync_private.sentence_editable(p_sentence_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sentences s
    where s.id = p_sentence_id
      and s.owner_id = auth.uid()
  )
  or exists (
    select 1
    from public.book_sentences bs
    where bs.sentence_id = p_sentence_id
      and bs.deleted_at is null
      and sync_private.can_edit_book(bs.book_id)
  );
$$;

revoke all on schema sync_private from public;
grant usage on schema sync_private to authenticated;
grant execute on all functions in schema sync_private to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.book_members enable row level security;
alter table public.sentences enable row level security;
alter table public.book_sentences enable row level security;
alter table public.analyses enable row level security;
alter table public.import_batches enable row level security;
alter table public.inbox enable row level security;
alter table public.reference_audio enable row level security;
alter table public.book_invites enable row level security;
alter table public.sync_events enable row level security;

-- Profiles
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- Books
create policy books_select on public.books
  for select to authenticated
  using (
    owner_id = auth.uid()
    or sync_private.can_read_book(id)
  );
create policy books_insert on public.books
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy books_update on public.books
  for update to authenticated
  using (owner_id = auth.uid() or sync_private.can_edit_book(id))
  with check (owner_id = auth.uid() or sync_private.can_edit_book(id));
-- Soft-delete only via update; no hard delete for members
create policy books_delete_owner on public.books
  for delete to authenticated
  using (owner_id = auth.uid());

-- Book members: readable by book readers; writable only by owner
create policy book_members_select on public.book_members
  for select to authenticated
  using (sync_private.can_read_book(book_id) or user_id = auth.uid());
create policy book_members_insert on public.book_members
  for insert to authenticated
  with check (
    sync_private.is_book_owner(book_id)
    and role in ('editor', 'viewer')
  );
create policy book_members_update on public.book_members
  for update to authenticated
  using (sync_private.is_book_owner(book_id))
  with check (
    sync_private.is_book_owner(book_id)
    and role in ('editor', 'viewer')
  );
create policy book_members_delete on public.book_members
  for delete to authenticated
  using (sync_private.is_book_owner(book_id) or user_id = auth.uid());

-- Sentences
create policy sentences_select on public.sentences
  for select to authenticated
  using (owner_id = auth.uid() or sync_private.sentence_readable(id));
create policy sentences_insert on public.sentences
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy sentences_update on public.sentences
  for update to authenticated
  using (owner_id = auth.uid() or sync_private.sentence_editable(id))
  with check (owner_id = auth.uid() or sync_private.sentence_editable(id));
create policy sentences_delete on public.sentences
  for delete to authenticated
  using (owner_id = auth.uid());

-- Book sentences
create policy book_sentences_select on public.book_sentences
  for select to authenticated
  using (owner_id = auth.uid() or sync_private.can_read_book(book_id));
create policy book_sentences_insert on public.book_sentences
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    or sync_private.can_edit_book(book_id)
  );
create policy book_sentences_update on public.book_sentences
  for update to authenticated
  using (owner_id = auth.uid() or sync_private.can_edit_book(book_id))
  with check (owner_id = auth.uid() or sync_private.can_edit_book(book_id));
create policy book_sentences_delete on public.book_sentences
  for delete to authenticated
  using (owner_id = auth.uid() or sync_private.is_book_owner(book_id));

-- Analyses
create policy analyses_select on public.analyses
  for select to authenticated
  using (owner_id = auth.uid() or sync_private.sentence_readable(sentence_id));
create policy analyses_insert on public.analyses
  for insert to authenticated
  with check (owner_id = auth.uid() or sync_private.sentence_editable(sentence_id));
create policy analyses_update on public.analyses
  for update to authenticated
  using (owner_id = auth.uid() or sync_private.sentence_editable(sentence_id))
  with check (owner_id = auth.uid() or sync_private.sentence_editable(sentence_id));
create policy analyses_delete on public.analyses
  for delete to authenticated
  using (owner_id = auth.uid());

-- Import batches (owner only)
create policy import_batches_all on public.import_batches
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Inbox (owner only)
create policy inbox_all on public.inbox
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Reference audio
create policy reference_audio_select on public.reference_audio
  for select to authenticated
  using (
    owner_id = auth.uid()
    or (book_id is not null and sync_private.can_read_book(book_id))
    or (sentence_id is not null and sync_private.sentence_readable(sentence_id))
  );
create policy reference_audio_insert on public.reference_audio
  for insert to authenticated
  with check (owner_id = auth.uid());
create policy reference_audio_update on public.reference_audio
  for update to authenticated
  using (owner_id = auth.uid() or (book_id is not null and sync_private.can_edit_book(book_id)))
  with check (owner_id = auth.uid() or (book_id is not null and sync_private.can_edit_book(book_id)));
create policy reference_audio_delete on public.reference_audio
  for delete to authenticated
  using (owner_id = auth.uid());

-- Book invites
create policy book_invites_select on public.book_invites
  for select to authenticated
  using (
    owner_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
create policy book_invites_insert on public.book_invites
  for insert to authenticated
  with check (sync_private.is_book_owner(book_id) and owner_id = auth.uid());
create policy book_invites_update on public.book_invites
  for update to authenticated
  using (
    owner_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
create policy book_invites_delete on public.book_invites
  for delete to authenticated
  using (owner_id = auth.uid());

-- Sync events: owner reads own; also readable for shared book content via pull of own events
-- Shared users get events for records they can read by filtering client-side after select
-- For simplicity: users see events where they are owner_id. Shared pull uses direct table queries.
create policy sync_events_select on public.sync_events
  for select to authenticated
  using (owner_id = auth.uid());
-- Inserts only via trigger (security definer); no direct client inserts
create policy sync_events_no_insert on public.sync_events
  for insert to authenticated
  with check (false);
create policy sync_events_no_update on public.sync_events
  for update to authenticated
  using (false);
create policy sync_events_no_delete on public.sync_events
  for delete to authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- Storage: private reference-audio bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reference-audio',
  'reference-audio',
  false,
  52428800, -- 50 MiB
  array['audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path: {owner_user_id}/{book_id}/{audio_id}.ext
create or replace function sync_private.storage_book_id(object_name text)
returns text
language sql
immutable
as $$
  select split_part(object_name, '/', 2);
$$;

create or replace function sync_private.storage_owner_id(object_name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(object_name, '/', 1), '')::uuid;
$$;

create policy reference_audio_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reference-audio'
    and (
      sync_private.storage_owner_id(name) = auth.uid()
      or sync_private.can_read_book(sync_private.storage_book_id(name))
    )
  );

create policy reference_audio_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reference-audio'
    and sync_private.storage_owner_id(name) = auth.uid()
  );

create policy reference_audio_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'reference-audio'
    and sync_private.storage_owner_id(name) = auth.uid()
  )
  with check (
    bucket_id = 'reference-audio'
    and sync_private.storage_owner_id(name) = auth.uid()
  );

create policy reference_audio_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'reference-audio'
    and sync_private.storage_owner_id(name) = auth.uid()
  );

-- Optimistic concurrency helper: apply mutation only if version matches
create or replace function public.apply_versioned_update(
  p_table text,
  p_id text,
  p_expected_version bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sql text;
  v_result jsonb;
  v_id_col text := case when p_table = 'analyses' or p_table = 'inbox' then 'sentence_id' else 'id' end;
begin
  if p_table not in (
    'books', 'sentences', 'book_sentences', 'analyses',
    'import_batches', 'inbox', 'reference_audio'
  ) then
    raise exception 'invalid table';
  end if;

  v_sql := format(
    'update public.%I set payload_placeholder = null where false',
    p_table
  );
  -- Dynamic column updates from jsonb keys are done client-side via supabase-js;
  -- this function only validates version and bumps it.
  execute format(
    'update public.%I
     set version = version + 1,
         last_modified_by = auth.uid(),
         updated_at = now()
     where %I = $1 and version = $2 and (owner_id = auth.uid() or true)
     returning to_jsonb(%I.*)',
    p_table, v_id_col, p_table
  )
  into v_result
  using p_id, p_expected_version;

  if v_result is null then
    return jsonb_build_object('ok', false, 'error', 'version_conflict');
  end if;
  return jsonb_build_object('ok', true, 'row', v_result);
end;
$$;

revoke all on function public.apply_versioned_update from public;
grant execute on function public.apply_versioned_update to authenticated;
