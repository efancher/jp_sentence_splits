#!/usr/bin/env bash
# Runs the real-Postgres sync tests (tests/pgIntegration) against throwaway
# containers: supabase/postgres with the project's actual migrations applied,
# plus PostgREST in front of it — so unique indexes and RLS policies are the real
# ones. Needs Docker. Extra args go to vitest, e.g.
#   npm run test:pg -- -t "converge"
# KEEP=1 leaves the containers up afterwards (faster reruns: SYNC_PG_TEST=1 npx vitest run tests/pgIntegration).
set -euo pipefail
cd "$(dirname "$0")/.."

PG=rlspg
REST=rlsrest
PG_PORT=54329
REST_PORT=54330
JWT_SECRET='super-secret-jwt-token-with-at-least-32-characters'
PSQL=(docker exec -i "$PG" psql -U supabase_admin -h localhost -d postgres -v ON_ERROR_STOP=1 -q)

cleanup() { [ "${KEEP:-}" = 1 ] || docker rm -f "$PG" "$REST" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker rm -f "$PG" "$REST" >/dev/null 2>&1 || true

docker run -d --name "$PG" -e POSTGRES_PASSWORD=postgres -p "$PG_PORT:5432" supabase/postgres:15.8.1.060 >/dev/null
echo "waiting for postgres…"
for _ in $(seq 1 60); do
  if docker exec "$PG" psql -U supabase_admin -h localhost -d postgres -tAc 'select 1' >/dev/null 2>&1; then break; fi
  sleep 2
done
# The image's init scripts restart the server once, so "ready" can be a false
# start: retry the first real command until the restart has finished.
for attempt in 1 2 3 4 5 6; do
  if "${PSQL[@]}" < tests/pgIntegration/bootstrap.sql 2>/dev/null; then break; fi
  [ "$attempt" = 6 ] && { echo "postgres never became ready" >&2; exit 1; }
  sleep 4
done
for f in supabase/migrations/*.sql; do
  "${PSQL[@]}" < "$f" || { echo "migration failed: $f" >&2; exit 1; }
done
"${PSQL[@]}" -c "alter role authenticator with password 'postgres'"

docker run -d --name "$REST" --network host \
  -e PGRST_DB_URI="postgres://authenticator:postgres@127.0.0.1:$PG_PORT/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$JWT_SECRET" -e PGRST_SERVER_PORT="$REST_PORT" \
  postgrest/postgrest:v12.2.3 >/dev/null
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$REST_PORT/" || true)
  [ "$code" != 000 ] && break
  sleep 1
done

SYNC_PG_TEST=1 npx vitest run tests/pgIntegration "$@"
