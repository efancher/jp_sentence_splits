# Supabase usage budget report

`npm run report:supabase-budget` reads a local dashboard snapshot and reports
used/remaining allowance, period-end projections and reserved-headroom warnings.
It writes no cloud data and makes no network requests. It is a usage forecast
for the configured resources, not a price estimate or a change to Supabase's
limits/spend cap. No actual account assessment has been made yet: the user
requested a template because a current snapshot is not available.

## Run

Copy [the template](../fixtures/performance/supabase-budget.template.json) into
an ignored local directory such as `test-results/performance/account/`, then
fill its values from the organization's Usage and Billing pages. Keep private
snapshots and reports out of git. Run from the repository root:

```bash
npm run report:supabase-budget -- \
  --input test-results/performance/account/snapshot.json \
  --output test-results/performance/account/report
```

Without `--output`, the report prints Markdown. With it, the directory receives
`report.md` and `report.json`. Add `--check` for exit status 2 when a configured
budget is exceeded, reserved headroom is reached, or data is incomplete/stale.
Invalid input exits 1. Default report mode exits 0 for a valid report even when
it contains warnings. `--check` checks supplied data; it does not refresh it.

To try the synthetic example, with a fixed report time:

```bash
npm run report:supabase-budget -- \
  --input fixtures/performance/supabase-budget.example.json \
  --now 2026-10-16T00:00:00Z \
  --output test-results/performance/budget-example
```

The example deliberately predicts an egress overrun. Its allowances are
illustrative, not plan defaults. It remains visibly labelled EXAMPLE DATA and
cannot pass `--check`, even if edited to show low usage. The blank template
produces INCOMPLETE, not zero usage or a healthy-account claim.

## Fill the snapshot

- `organization`, `plan`: your organization and current plan label. No plan
  quotas are hardcoded; confirm each `allowance` from the dashboard.
- `allProjectsIncluded`: true only when the organization-level totals include
  every project and other app/consumer sharing those allowances. False/null
  leaves the assessment incomplete.
- `periodStart`, `periodEnd`: exact billing boundaries, with an exclusive end.
  Use ISO timestamps with timezones, such as `2026-10-05T00:00:00Z`; a cycle
  need not match the calendar month.
- `capturedAt`: when you copied the figures. `usageThrough`: the cutoff those
  figures cover. Keep reporting lag explicit; projections start at that cutoff.
- `headroomPercent`: reserve, default 20%. This is an engineering preference,
  not a Supabase quota. `maxAgeHours` defaults to 48; stale captures or usage
  cutoffs are flagged. `minimumElapsedHours` defaults to 24 before deriving
  a daily rate from cumulative usage.
- `null` means unknown; numeric 0 means confirmed zero. Keep unknowns null.

All sizes are **bytes**, with decimal GB = 1,000,000,000 bytes. Counts are raw
invocations. Convert dashboard units before entering them. For fields below,
`allowance` is in the same units as `used`.

| Resource | Scope | `used` | Forecast inputs |
| --- | --- | --- | --- |
| `uncached_egress` | Organization | Cumulative downloaded bytes this period | `dailyUsage`, `additionalUsage` |
| `cached_egress` | Organization | Cumulative cached downloaded bytes | `dailyUsage`, `additionalUsage` |
| `edge_function_invocations` | Organization | Cumulative invocations | `dailyUsage`, `additionalUsage` |
| `storage_size` | Organization | Period-to-date **average** stored bytes | `currentSize`, `growthPerDay` |
| `database_size` | Named project | Current database bytes | `growthPerDay` |
| `disk_size` | Named project | Period-to-date **average provisioned** disk bytes | `currentSize`, `growthPerDay` |

For cumulative resources, null `dailyUsage` derives a rate from the observed
period. A number replaces that rate for future days. `additionalUsage` adds
only extra work expected before this period ends, such as an additional device
restore. Avoid adding ordinary activity already represented by the daily rate.
These are explicit usage assumptions, not automatic conversions of HTTP test
bytes into billed egress. There is no generic request-count quota.

For storage/disk, `used` is the average over the elapsed observation window;
`currentSize` is the live stored/provisioned size at its cutoff. If the dashboard
provides GB-hours instead, convert usage to bytes-hours and divide by **elapsed
hours**. If its allowance is in GB-hours, convert and divide by **full-period
hours**. Never put a GB-hour total directly into an average-bytes field.

`growthPerDay` is future bytes added per day. Enter 0 explicitly for a constant
size assumption; null withholds the projection. Negative growth is unsupported;
refresh the observations after removals. With elapsed days E, remaining days R
and total days T, storage/disk projection is:

`(used × E + currentSize × R + growthPerDay × R² / 2) / T`

Database capacity projects `used + growthPerDay × R`; it does not reset when
the billing cycle rolls over. Keep the applicable database/disk rows for the
plan, remove the inapplicable template row, and repeat them for other projects.
Free-plan database capacity and paid provisioned-disk usage are distinct.
Duplicate resource/project entries are rejected to prevent double counting.

Warnings consider both observed usage and projection. Missing data stays
visible even alongside a known overrun. At the reset boundary the old snapshot
is flagged as ended; the tool neither invents a new cycle nor resets usage.
Resources absent from the input are **not assessed**. Compute, MAUs, Realtime,
logs, add-ons, credits, taxes and provider enforcement are outside this slice.

## Sources and validation

Meter semantics were checked against official Supabase documentation on
2026-10-18: [organization billing](https://supabase.com/docs/guides/platform/billing-on-supabase),
[egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress),
[storage size](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size),
and [disk size](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size).
The documented [API request counts](https://supabase.com/docs/reference/api/v1-get-project-usage-api-count)
are not a substitute for the organization's billed resource usage. This first
version consumes a manually supplied snapshot; automatic account retrieval is
still open.

Run `npm run test:usage` and `npx tsc -p tsconfig.performance.json --pretty false`.
The performance workflow includes these checks and triggers on report-code/test
changes. Tests use synthetic data and cover dates, zero/missing values, lag,
scope, cumulative/capacity/weighted projections, warnings and report output.
See [PERFORMANCE.md](PERFORMANCE.md) for the broader roadmap work.
