#!/bin/bash
# Applies every migration in order to a throwaway local supabase/postgres (no prod access).
cd "$(git rev-parse --show-toplevel)" || exit 1
P="docker exec -i mig-rehearsal psql -q -U supabase_admin -h 127.0.0.1 -d postgres"
docker rm -f mig-rehearsal >/dev/null 2>&1
docker run -d --rm --name mig-rehearsal -e POSTGRES_PASSWORD=pw -p 127.0.0.1:54399:5432 supabase/postgres:15.8.1.060 >/dev/null
for i in $(seq 1 60); do docker exec mig-rehearsal psql -U supabase_admin -h 127.0.0.1 -d postgres -c "select 1 from storage.buckets limit 1" >/dev/null 2>&1 && break; sleep 2; done
$P <<'SQL'
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
create or replace function auth.email() returns text language sql stable as $$ select auth.jwt()->>'email' $$;
alter table storage.buckets add column if not exists public boolean default false, add column if not exists file_size_limit bigint, add column if not exists allowed_mime_types text[];
SQL
for f in supabase/migrations/*.sql; do
  out=$($P -v ON_ERROR_STOP=1 < "$f" 2>&1) || { echo "FAIL $f"; echo "$out" | head -8; exit 1; }
done
echo "ALL $(ls supabase/migrations/*.sql | wc -l) MIGRATIONS APPLIED"
