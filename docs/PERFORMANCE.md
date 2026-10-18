# Performance baselines and usage budgets

The browser/HTTP suite measures local screen readiness and enforces repeatable
request/body budgets. A separate [Supabase budget report](SUPABASE_BUDGET.md)
forecasts configured resources from a dated dashboard snapshot, with a blank
template and an explicitly synthetic example. A real account snapshot has not
yet been supplied. UI timing limits remain uncalibrated. Tests need no production
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
- Add complete import/commit and full-cloud-restore scenarios, mixed entities,
  conflict/token recovery, delayed downloads and cancellation. The existing
  timeout races do not cancel the underlying audio request; that behavior is
  not fixed or covered by these immediate-error retry checks.
- Benchmark server query plans at realistic sizes under the authenticated role.
- Test a genuinely cold offline PWA start and physical-device performance.
- Populate and review the snapshot-based budget report with actual account
  usage, plan allowances and reset dates; automatic retrieval remains open.
  Extend workload estimates for study, imports, cache losses and multiple
  devices, avoiding double counting observed activity. Include other
  consumers/projects sharing the organization. Reconcile independently metered
  resources, not one generic request quota: cached/uncached egress, database
  capacity, bucket storage and function invocations. Storage billing uses
  time-weighted size; disk provisioning depends on the plan. See the official
  [billing scope](https://supabase.com/docs/guides/platform/billing-on-supabase),
  [storage measurement](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)
  and [disk measurement](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size).
