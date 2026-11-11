# Performance baselines and usage budgets

The browser/HTTP suite measures local screen readiness and enforces repeatable
request/body budgets. A separate [Supabase budget report](SUPABASE_BUDGET.md)
forecasts configured resources from a dated dashboard snapshot, with a blank
template and an explicitly synthetic example. A first real snapshot was
assessed on 2026-10-19 (all resources OK; storage is the one to watch). UI timing limits remain uncalibrated. Tests need no production
account.

The [2026-10-18 baseline](PERFORMANCE_BASELINE.md) records the first complete
local run and its raw observations. Global Review was the clearest scaling
concern in that synthetic workload. The [Review follow-up](PERFORMANCE_REVIEW_FOLLOWUP.md)
measures the first fix: fetching history only for the active card.

## Run and inspect

```bash
npm run test:usage
npm run test:pg
npx tsc -p tsconfig.performance.json --pretty false
npm run test:performance
```

The browser command builds a local-only production app on port 4183, then runs
Chromium desktop and iPhone 13-emulated WebKit sequentially. It uses a separate
config, so the ordinary functional browser suite does not repeat the benchmark.
See [browser setup](../e2e/README.md) if host browser libraries are unavailable.

Outputs, all under ignored `test-results/performance/`:

- `baseline.md`: median/max timing table and failures.
- `baseline.json`: raw samples, browser versions, fixture shape, injected
  latency, revision and overall status. Do not compare a failed/partial run as
  though it were a complete baseline.
- `usage/*.json`: HTTP counts and decoded body bytes, enabled by setting
  `PERF_USAGE_REPORT_DIR=test-results/performance/usage` for either usage or
  Postgres tests. Reports contain no credentials, URLs or request/response data.

For a longer timing run or an asset-latency experiment:

```bash
PERF_SAMPLES=20 npm run test:performance
PERF_SAMPLES=5 PERF_LATENCY_MS=100 npm run test:performance
```

Default is five observations per screen/profile/library/mode. Only runs with
at least 20 observations report an empirical nearest-rank p95; even then this
is an exploratory tail estimate, not a precise service-level target. Keep
runner, browser version, build, fixture and latency settings fixed when
comparing runs. Run with one worker and avoid concurrent builds/database tests.

On this host, build and start an unchanged preview on 4183 before the container:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4183 --strictPort
```

Then, from a second shell in this worktree:

```bash
docker run --rm --network host --user "$(id -u):$(id -g)" \
  -e PERF_REUSE_SERVER=1 -e PERF_SAMPLES=5 \
  -e PERF_REVISION="$(git rev-parse --short HEAD)-worktree" \
  -v "$PWD:/work" \
  -v "$(realpath node_modules):$(realpath node_modules):ro" \
  -w /work mcr.microsoft.com/playwright:v1.61.1-jammy \
  node node_modules/@playwright/test/cli.js test --config=playwright.performance.config.ts
```

Use a build without Supabase env variables. Tests block all external requests
and fail if any are attempted. The explicit reuse flag avoids accidentally
benchmarking someone else's preview. `PERF_REVISION` supplies the source label
when the container cannot see the worktree's external git metadata.

## What the browser baseline measures

| Fixture | Books | Sentences | Review history | Target chapter |
| --- | ---: | ---: | ---: | ---: |
| Small | 2 | 200 | 1,000 | 50 sentences |
| Large | 20 | 4,000 | 20,000 | 200 sentences |

Every sentence has a due sentence card, a meaning-choice check and a separately
stored walkthrough with a substantial explanation. Fixtures retain the default
sentence-led flow, with no vocabulary confirmation or word cards. They contain
no audio blobs: binary transfer is tested independently. The fixtures are
synthetic workloads, not measurements of the current personal library.

Home waits for the start control and loaded balance/session data; Books waits
for populated book controls; Reader waits for its sentence toolbar; global
Review waits for the meaning question and an enabled answer. Each timing ends
after two additional animation frames. It includes application work plus some
browser automation overhead; it does not claim to be a Core Web Vital.

- **Document:** new document and JavaScript runtime, existing seeded IndexedDB,
  browser HTTP cache disabled and service worker blocked. This is a cold app
  boot with local data, not a first install or a cold operating-system disk cache.
- **Warm:** navigate from Settings to a previously opened screen in the same
  runtime. Already imported modules remain in memory.
- **Offline:** the same primed navigation with the network disabled. It does
  not establish that the PWA can start from scratch offline.

Fixture creation finishes before measurement. `seedCommitMs` is separate
diagnostic metadata for one synthetic IndexedDB transaction, not an application
import benchmark. Repetitions do not grade cards or complete walkthroughs.
Added latency delays each local asset request; it is not bandwidth or CPU
throttling. Phone emulation is not a physical-iPhone measurement.

## Deterministic usage gates

Limits live in [usage-budgets.json](../fixtures/performance/usage-budgets.json).
They are per synthetic scenario, not monthly plan allowances. Request counts
pin current batching/cache behavior; JSON byte ceilings leave measured headroom
for timestamps/metadata. Update a limit only after examining a changed report
and the associated stored outcomes, not simply to make a regression green.

Real Postgres/PostgREST tests apply production migrations and authenticated RLS:

- Initial incremental pull from cursor zero: 120 book rows over two event pages.
- Unchanged sync: one request and the two-byte empty JSON array.
- One remote edit: two requests, preserving the edited local title.
- Reconnect backlog: 120 remote edits while the device was not syncing.
- Mixed-entity restore: a second device with an empty database pulls 40 words,
  41 kanji and 80 links (161 rows) pushed from another device in six requests,
  then idles in one request and pulls one remote edit in two.
- Study-library restore: an empty device pulls 4 books, 400 sentences with
  membership, 400 sentence cards, 1,200 reviews and 400 walkthrough events
  (2,804 rows) in 63 requests and about 2.3 MB of decoded response bodies, then
  idles in one request and pulls one new review in two requests (947 bytes). A
  twice-as-large library (800 sentences, 5,604 rows) takes 119 requests and about
  4.7 MB. In a one-off probe the same restore took 231 requests and about 9.3 MB at
  11,204 rows. That is about 2.1 to 2.3 requests per 100 rows (event pages plus
  record fetches) and about 830 bytes per row: linear growth. Extrapolating the same
  ratio, a restore at the 36,020 rows of the "large" fixture shape (4,000 sentences,
  20,000 reviews) would need roughly 800 requests and 30 MB; that is an
  extrapolation, not a measurement.
  **Do not read this suite's wall-clock times as app latency.** Restore time in this
  harness grows much faster than linearly (about 6 s at 2,804 rows, 17 s at 5,604,
  90 s at 11,204 and over 10 minutes at 36,020), and a CPU profile put about 60% of
  the run in one `fake-indexeddb` function that rescans its list of queued
  transactions after each one finishes. Real browser IndexedDB does not do that, so
  the 36,020-row scenario was dropped from the suite. HTTP time was only about 13%
  of the run (2.2 s of 17 s at 5,604 rows), with late requests slower than early
  ones (about 150 ms against 6 ms at 11,204 rows), which is a smaller effect worth
  examining separately.
- Bulk push: 120 complete book records, followed by a sync with no repeated
  payload. This isolates the batch protocol; it is not a full mining import.

Audio tests use the real Supabase client and application cache code with a
synthetic HTTP transport. They check a concurrent four-clip restoration,
zero-transfer warm playback/sync, retrying only one failed clip, reusing a
source episode and disabled audio sync. They do not validate Storage RLS or
real server behavior. Failed attempts are counted, including error bodies.

Body measurements include UTF-8 JSON and binary bytes in both directions.
They exclude headers, compression, TLS, redirects/internal service traffic and
CDN cache classification. An upload is not treated as download egress. See
[Supabase's egress definition](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
before comparing these engineering budgets with the dashboard.

## Fresh-device restore in a real browser (2026-11-10 to 11)

`scripts/perf-restore.sh [small|medium|large ...]` measures how long the app's own
sync takes to rebuild a library on a device with an empty IndexedDB. It starts the
disposable Postgres and PostgREST containers (the names `pg-test.sh` uses, so do not
run both at once), builds the app against a local API proxy, seeds a study library
(`tests/helpers/librarySeed.ts`; the same seed as the Postgres usage tests), and
runs `playwright.restore.config.ts` in the Playwright container: desktop Chromium
and iPhone-emulated WebKit, each with a signed-in session injected and no other
state. Results go to `test-results/performance/restore/<size>[-route]-<project>.json`
with request counts, bytes, per-request time and per-page apply time.
Options: `RESTORE_PROJECT=chromium-desktop|webkit-phone`, `RESTORE_DEADLINE_MS`
(default 800 s; raise it for slow runs), `RESTORE_ROUTE='/#/help'` (the route the app
sits on during the restore), `RESTORE_PROFILE=1` (a Chromium CPU profile) and
`RESTORE_IDB_TRACE=1` (counts of IndexedDB reads per store, which is what found the
cause below). The database it wipes is the throwaway container, never Supabase.

Restore time with the landing page open (the page a new device opens on):

| Library | Rows | Before, Chromium | Before, WebKit | After, Chromium | After, WebKit |
| --- | ---: | ---: | ---: | ---: | ---: |
| small | 2,804 | 27 to 29 s | 21 to 24 s | 5.7 s | 8.5 s |
| medium | 11,204 | 242 to 297 s | 164 s | 27.4 s | 32.9 s |
| large | 36,020 | 3,338 s (55.6 min) | 1,918 s (32 min) | 142 s | 125 s |

"Before" is the code at `ac23d1e`; "after" is the fix described below. Requests and
bytes are unchanged (63, 231 and 727 requests; 2.3, 9.4 and 31 MB) and match the
Postgres suite, and each request takes 5 to 10 ms, so the server and network were
never the cost on localhost. These runs had no network latency and no CPU
throttling; a phone on a mobile connection will be slower. Emulated WebKit is not a
physical iPhone. The seed puts all 20,000 reviews inside the 14-day window the
landing page counts (the worst case for that query); real libraries have fewer.

- **What was wrong.** Before, the reviews phase took 98 percent of the large Chromium
  restore, and its cost per 100-event page grew in a straight line with the reviews
  already stored (5.5 s per page rising to 27.3 s), so the total grew with the square
  of the review count. Other record types applied at a steady 3 to 4 ms per event. On
  the Help page the same 11,204-row restore took 36 s, which pointed at the landing
  page. An IndexedDB read trace of a 2,804-row restore showed what the landing page
  added: its learning-balance query ran `reviews#timestamp.count` 2,408 times and
  scanned all book memberships 713 times, against none of that on the Help page. The
  sync engine committed every pulled record in its own transaction, so Dexie re-ran the
  page's live queries after nearly every record, and each re-run costs more as the
  tables grow.
- **A first guess that mostly did not help.** `getRecentActivityEvents` built one array
  entry per recent review. Replacing that with one counted entry per table (kept, with
  tests) only moved the medium restore from 242 to 297 s to 230 s: the cost was the
  number of re-runs, not the size of each result.
- **The fix.** `applyRemoteEventsBatch` (`src/sync/engine.ts`) now applies each
  entity group of a pulled page in a single Dexie transaction (the network fetch stays
  outside it), so a page of 100 records re-runs live queries about once instead of about
  100 times. Everything inside is plain database work and data mapping. A failure rolls
  the group back and the pull retries it, as before. `tests/pgIntegration/syncUsage.pg.test.ts`
  now fails if a live query re-runs more than about 4 times per page during a restore:
  with the old code it re-ran 1,201 times for 2,804 records.
- **What is left.** Review pages still rise mildly (Chromium 346 to 629 ms per page over
  the large run, WebKit 327 to 444), so the restore is not perfectly linear in Chromium (time
  grew 4.8 times for 4 times the rows from small to medium, and 5.2 times for 3.2 times
  the rows from medium to large; WebKit 3.9 and 3.8 times). The engine still does several separate reads per pulled event (the open-conflict
  list is read about 2,800 times for 2,804 records) and the restore shows no progress on
  screen. Both are in the roadmap as follow-ups.
- **Reproduction pitfalls fixed in the harness:** the preview server is started
  directly (not through `npx`) so the cleanup trap actually stops it; a stale preview
  on port 4184 otherwise serves a deleted directory and the browser makes no
  requests. The script refuses to start if that port is busy.

## CI and remaining work

`performance-tests.yml` runs the usage checks, typechecks the harness and
retains browser reports/traces for 14 days. Functional failures, unexpected
external traffic and usage-budget failures fail their jobs. Timing values are
report-only; the 30-second readiness timeout is a functional stall guard.
`sync-pg-tests.yml` separately retains Postgres usage reports. Neither workflow
is a Pages deployment dependency; branch protection is configured separately.

Remaining roadmap work:

- Calibrate timing regression limits with repeated runs on a stable runner;
  add IndexedDB operation counts/profiling to explain slow screens.
- Add complete import/commit scenarios, restore of the remaining entities
  (analyses, vocabulary links for sentences, gloss decisions, planner sessions and
  audio metadata; words, kanji, sentences, cards, reviews and learning events are
  covered), the remaining restore follow-ups (per-event reads, progress display; see
  the roadmap), whether larger event pages would cut the roughly 2 requests per 100 rows,
  conflict/token recovery, delayed downloads and cancellation. The existing
  timeout races do not cancel the underlying audio request; that behavior is
  not fixed or covered by these immediate-error retry checks.
- Benchmark server query plans at realistic sizes under the authenticated role.
- Test a genuinely cold offline PWA start and physical-device performance.
- Refresh the snapshot-based budget report each cycle (first populated
  2026-10-19); automatic retrieval remains open.
- **Storage headroom (open, decide before heavy imports; next cycle starts
  23 Oct).** Storage is about 893 MB of the 1 GB Free allowance. The Oct 4-17
  growth (461 MB) was newly imported podcast episodes, clipped at roughly
  25 KB/s (about 192 kbps AAC; `scripts/lib/audioClipHelpers.ts` uses 128k,
  several recut/remine scripts 192k). Candidate levers:
  (1) re-encode live clips at a lower bitrate (64k would save about 450 MB) after
  checking whether pitch scoring, alignment or shadowing analysis read clip
  audio; trial a small batch, listen, then ask before the full run;
  (2) older duplicate clips, 201 across 144 sentences (37 MB), and 56 MB of
  soft-deleted rows whose bucket files may remain (unchecked; the orphan
  cleanup script finds nothing and its `--delete-blobs` option is destructive);
  (3) moving reference clips to Cloudflare R2. The user has now created a bucket
  and requested storage monitoring and overage protection as part of this move;
  see the [R2 migration and usage-control plan](CLOUDFLARE_R2_PLAN.md).
  Integration, monitoring and admission limits remain unimplemented. No
  production audio has been changed or deleted by this work.
  **Trial result (2026-10-19, 20 clips sampled across the library, local files
  only; originals are stereo 48 kHz at about 197 kbps):** re-encoded sizes
  were 34% of the original at 64k (stereo or mono), 42% at mono 80k and 51% at
  stereo 96k. Decoded start offset was 0 ms for every variant. Using the app's
  real `extractPitch`, mono 64k gave median clip mean pitch difference 0.02
  semitones (worst clip 0.16 st, at most 1.2% of frames off by more than 3 st);
  stereo 64k was worse (worst clip 0.76 st, 6.3% of frames off) and stereo 96k
  and mono 80k both stayed under 0.13 st. Recommended: mono AAC at 64-80k (about
  450 MB saved). Not yet checked: forced alignment on re-encoded clips, listening
  by ear, other devices' cached copies, and the 4 MB of wav clips. The full run
  would overwrite about 2,800 stored files and needs your explicit go-ahead.
  Extend workload estimates for study, imports, cache losses and multiple
  devices, avoiding double counting observed activity. Include other
  consumers/projects sharing the organization. Reconcile independently metered
  resources, not one generic request quota: cached/uncached egress, database
  capacity, bucket storage and function invocations. Storage billing uses
  time-weighted size; disk provisioning depends on the plan. See the official
  [billing scope](https://supabase.com/docs/guides/platform/billing-on-supabase),
  [storage measurement](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)
  and [disk measurement](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size).
