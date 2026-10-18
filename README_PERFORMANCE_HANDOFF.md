# Temporary performance roadmap handoff

This file lets an agent in a separate sandbox resume from the repository alone.
No access to the previous agent's host paths or `/tmp` files is required.

**Cleanup:** after reading this handoff and preserving any still-needed status
in the living docs, delete this file in your next work commit. The user requested
this temporary handoff and its subsequent removal. Keep the implementation,
templates, tests and permanent documentation.

## Start here

1. Work from the current `origin/main` of
   `https://github.com/efancher/jp_sentence_splits.git`. Follow [AGENTS.md](AGENTS.md)
   and applicable scoped instructions. Use an isolated worktree and preserve
   concurrent changes. Do not assume the earlier host's checkout is accessible.
2. Read [STATUS](docs/STATUS.md), [PERFORMANCE](docs/PERFORMANCE.md),
   [SUPABASE_BUDGET](docs/SUPABASE_BUDGET.md), and [ROADMAP](docs/ROADMAP.md).
   The performance roadmap item remains in progress.
3. Continue with broader import/restore and multi-device workload coverage using
   the existing TypeScript, Vitest, Playwright and Postgres harnesses. Inspect
   existing coverage before choosing the next scenario. Then assess timing gates
   from repeated comparable CI runs; do not invent a threshold from one run.
4. Run relevant checks and update the living status/roadmap docs. Commit logically
   related changes separately. Remove this handoff as described above.

## Published work and CI

The latest implementation handoff commit is
`d0a1aa2bd533f2c54cf9512601f33966b0519884`, pushed to `origin/main`.
All four workflows for that commit were verified successful on 2026-10-18:

- [Performance baseline and usage budgets](https://github.com/efancher/jp_sentence_splits/actions/runs/39177179653)
- [Sync tests (real Postgres)](https://github.com/efancher/jp_sentence_splits/actions/runs/39177179677)
- [Browser and backend tests](https://github.com/efancher/jp_sentence_splits/actions/runs/39177179707)
- [Deploy Satori Glossbook](https://github.com/efancher/jp_sentence_splits/actions/runs/39177179664)

Check newer main changes and their CI before continuing; this is a dated record.

- UI baselines cover Home/Books/Reader/Review, small/large synthetic libraries,
  Chromium/WebKit, and document/warm/offline navigation. Timing values remain
  report-only. See [the baseline](docs/PERFORMANCE_BASELINE.md).
- Sync/audio tests enforce configurable request and decoded-body-byte budgets.
- Review now reads indexed history for the active card only. Large-library warm
  medians improved from 3891.4 to 902.6 ms in Chromium and 7962 to 1943 ms in
  emulated WebKit. See [the comparison](docs/PERFORMANCE_REVIEW_FOLLOWUP.md).
- The Supabase reporter forecasts cumulative usage, database capacity, and
  time-weighted storage/disk usage. It reports headroom, stale/missing inputs,
  reporting lag and billing-cycle issues, and outputs Markdown/JSON locally.
  It makes no network requests and does not estimate monetary charges.

## Where to work

- Browser measurements: `e2e/performance/`, `playwright.performance.config.ts`.
- Sync workloads: `tests/pgIntegration/syncUsage.pg.test.ts`.
- Audio restoration/cache workloads: `tests/audioUsage.test.ts`.
- Usage meter and limits: `tests/helpers/usageMeter.ts`,
  `fixtures/performance/usage-budgets.json`.
- Snapshot report: `scripts/report-supabase-budget.ts`,
  `scripts/lib/supabaseBudget.ts`, `tests/supabaseBudget.test.ts`.
- CI: `.github/workflows/performance-tests.yml`,
  `.github/workflows/sync-pg-tests.yml`.

Current gaps include complete import/commit and cloud restoration, mixed entity
workloads, conflict/token recovery, delayed downloads/cancellation, and realistic
multi-device estimates. Browser fixture seeding is not an application import
benchmark. Phone emulation is not physical-device validation. Keep these
measurement boundaries explicit; see PERFORMANCE for the full remaining scope.

## Supabase account inputs

The user explicitly said **no real Usage/Billing snapshot is available; provide
a template**. The template and synthetic example are committed. Do not invent
account figures or block unrelated test work on their absence. No actual account
assessment or automatic billing-data retrieval has been completed.

When figures become available, copy
`fixtures/performance/supabase-budget.template.json` to an ignored local location
such as `test-results/performance/account/snapshot.json`. Follow SUPABASE_BUDGET
for dates, units, organization scope and actual plan allowances, then run:

```bash
npm run report:supabase-budget -- \
  --input test-results/performance/account/snapshot.json \
  --output test-results/performance/account/report
```

Keep private snapshots and reports out of git. To demonstrate the reporter, use
`fixtures/performance/supabase-budget.example.json` with
`--now 2026-10-16T00:00:00Z`. Its allowances are illustrative only. The blank
template reports INCOMPLETE; `--check` exits 2 for incomplete/headroom/exceeded
reports. HTTP body-byte measurements do not directly equal billed egress, and
public API request counts are not billing-resource usage totals.

## Last local validation

For the snapshot-report implementation: all 34 usage tests (26 budget tests),
application typechecking and performance-harness typechecking passed. Lint
passed with 36 existing warnings. Actual CLI runs verified the synthetic overrun
and incomplete template. `git diff --check` passed. Full browser/Postgres suites
were not rerun locally for that offline-tooling slice; the CI runs above passed.

Useful focused commands, from the repository root:

```bash
npm run test:usage
npm run typecheck
npx tsc -p tsconfig.performance.json --pretty false
npm run lint
```

For affected browser or sync behavior, follow the scoped instructions and run
`npm run test:performance` or `npm run test:pg` as appropriate. Timing calibration
needs repeated runs with consistent runner/browser/build/fixture settings.
