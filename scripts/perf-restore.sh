#!/usr/bin/env bash
# Real-browser fresh-device restore measurement (docs/PERFORMANCE.md).
#
# Starts the disposable Postgres + PostgREST containers (same names as pg-test.sh,
# so do not run it alongside `npm run test:pg`), builds the app against a local API
# proxy, serves it, seeds a study library, and runs Chromium and iPhone-emulated
# WebKit in the Playwright container. Each browser starts with an empty IndexedDB and
# a signed-in session, and we time how long the app's own sync takes to restore the
# data. The database it wipes and seeds is the throwaway container, never Supabase.
#
# Usage: [RESTORE_PROJECT=chromium-desktop|webkit-phone] scripts/perf-restore.sh [small|medium|large ...]   (default: small)
# Results: test-results/performance/restore/<size>-<project>.json
# Needs Docker and the Playwright image matching the installed @playwright/test.
set -euo pipefail
cd "$(dirname "$0")/.."

SIZES=("$@")
[ ${#SIZES[@]} -gt 0 ] || SIZES=(small)
APP_PORT=4184
PROXY_PORT=54331
IMAGE="mcr.microsoft.com/playwright:v$(node -p "require('@playwright/test/package.json').version")-jammy"
DIST=$(mktemp -d)
PREVIEW_PID=""

cleanup() {
  [ -z "$PREVIEW_PID" ] || kill "$PREVIEW_PID" 2>/dev/null || true
  docker rm -f rlspg rlsrest >/dev/null 2>&1 || true
  rm -rf "$DIST"
}
trap cleanup EXIT

KEEP=1 PG_TEST_SETUP_ONLY=1 bash scripts/pg-test.sh

echo "building the app against the local API proxy..."
GITHUB_ACTIONS=false VITE_DEPLOY=0 \
  VITE_SUPABASE_URL="http://127.0.0.1:$PROXY_PORT" VITE_SUPABASE_ANON_KEY=restore-measurement-anon-key \
  npx vite build --outDir "$DIST" --emptyOutDir --logLevel error

# Run vite directly (not via npx) so PREVIEW_PID is the server itself and the trap really stops it.
if ss -ltn 2>/dev/null | grep -q ":$APP_PORT "; then echo "port $APP_PORT is already in use; stop the old preview first" >&2; exit 1; fi
node node_modules/vite/bin/vite.js preview --outDir "$DIST" --host 127.0.0.1 --port "$APP_PORT" --strictPort >/dev/null 2>&1 &
PREVIEW_PID=$!
for _ in $(seq 1 30); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APP_PORT/" || true)" = 200 ] && break
  sleep 1
done

for size in "${SIZES[@]}"; do
  npx tsx scripts/seed-restore-library.ts "$size"
  docker run --rm --network host --user "$(id -u):$(id -g)" \
    -e RESTORE_SIZE="$size" -e RESTORE_PROFILE="${RESTORE_PROFILE:-}" -e RESTORE_ROUTE="${RESTORE_ROUTE:-}" -e RESTORE_APP_URL="http://127.0.0.1:$APP_PORT" -e RESTORE_PROXY_PORT="$PROXY_PORT" \
    -v "$PWD:/work" -v "$(realpath node_modules):$(realpath node_modules):ro" \
    -w /work "$IMAGE" \
    node node_modules/@playwright/test/cli.js test --config=playwright.restore.config.ts ${RESTORE_PROJECT:+--project=$RESTORE_PROJECT}
done
