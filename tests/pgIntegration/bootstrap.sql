-- Shims for pieces GoTrue / storage-api normally provide, so the project's real
-- migrations apply to the bare supabase/postgres image. RLS and table logic
-- under test come from the migrations themselves — nothing here weakens them.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
-- PostgREST sets request.jwt.claims (JSON); read the subject from there.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (auth.jwt() ->> 'sub')
  )::uuid
$$;
alter table storage.buckets
  add column if not exists public boolean default false,
  add column if not exists file_size_limit bigint,
  add column if not exists allowed_mime_types text[];
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$ select string_to_array(name, '/') $$;
alter table storage.objects enable row level security;
