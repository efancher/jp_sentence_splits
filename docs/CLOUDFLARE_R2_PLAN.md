# Cloudflare R2 migration and usage controls

Proposal updated 2026-10-19. The user has created an R2 bucket and requires
storage monitoring and overage protection as part of the migration. The account
has not been connected to this agent. Confirm the account and bucket identifiers
when connecting; do not assume an empty bucket or zero account usage.

**Decision (2026-10-19): a Cloudflare Worker gateway, not presigned URLs.** A
Worker bound to the bucket verifies the Supabase login and proxies every read,
write and delete, so size checks and the ledger limits below apply to each
request. Workers Free is sufficient for this use.

**Implemented in the repository, behind a flag, not deployed:**
[the Worker](../cloudflare/r2-gateway/README.md) (auth, owner/book-reader
rules, type and size checks, Durable Object ledger with atomic reservations,
Class A/B counters, seeding, emergency switch, admin usage endpoint) and the
client adapter `src/sync/audioStorage.ts` used by `src/sync/audioSync.ts`,
enabled only when `VITE_R2_GATEWAY_URL` is set. With the flag set, uploads go to
R2 only; reads try R2 first and fall back to Supabase only on 404 or an
unreachable/5xx gateway, never on a refusal. Covered by unit tests with fakes
(`tests/r2Gateway.test.ts`, `tests/audioStorage.test.ts`); no real R2, Durable
Object or deployed-Worker behavior has been exercised.

**Deployed 2026-10-19** at `satori-r2-gateway.edwardfancher.workers.dev`
(secrets set, ledger seeded at 0 bytes for the empty bucket, app flag still
off). A live smoke test with one 1 KiB object passed: 401 without a token, 400 for
a malformed key, 415 for a wrong type, 403 writing another owner's path, CORS
limited to the app origin, then upload, byte-identical read-back, delete and 404.
The first deploy exposed a bug the fake-`fetch` tests missed (the global `fetch`
was passed as an object property, which Workers reject), now covered by a test.
Not yet exercised live: book-member reads, limit refusals, and the ledger under
load. Deploy with the real `SUPABASE_URL` and `ALLOWED_ORIGINS`; deploying the
committed template overwrites them with placeholders (use `--var`).

**Migration script** `scripts/migrate-reference-audio-to-r2.ts` (dry run by
default; `--apply`, `--limit`, `--no-readback`; rules in `scripts/lib/r2Migration.ts`,
tested with fakes in `tests/r2Migration.test.ts`): skips existing objects, never
overwrites an R2 object whose size differs, never touches Supabase, verifies size
and a SHA-256 read-back, and stops on any gateway refusal. A live dry run on
2026-10-19 found all 2,847 live clips (693.5 MB) valid and absent; a 20-clip batch
copied and verified (6.7 MB) and a re-run saw them as present. The full run
(interrupted once by a background time limit, then resumed) copied the rest, and a
final dry run reported all 2,847 live clips present in R2 with matching sizes
(about 693.5 MB; each copy was also hash-verified by read-back). The ledger
counts only traffic through the gateway, so its figures should match the
seeded 0 plus these uploads. Supabase still holds its copies.

**Flag enabled 2026-10-20:** the repository variable `VITE_R2_GATEWAY_URL` is set
and `.github/workflows/deploy.yml` passes it to the Pages build; the deployed
bundle contains the gateway address, and the app's own storage code passed a live
check (R2-only upload, R2-first read matching the Supabase original, clean
failure for a missing path). A catch-up dry run found nothing new to copy. Browsers
still running the previous build keep writing to Supabase until they reload, so
re-run the copy script once more after a few days. Not yet exercised live: reading
a clip from a second account that is a book member (a single-user library today),
and the limit refusals.

**Live user checks (2026-10-21):** an import of 279 new clips (40.3 MB) landed in R2
only (a 12-clip sample was absent from Supabase), and all 3,126 live clips matched
R2 objects. A full "clear audio cache" and re-sync on a device played without
issues and the usage report showed the downloads as R2 reads: 35,434 to 38,342
Class B operations (about +2,900) with no new writes.

**Supabase copy cleanup (applied by the user 2026-10-21):** a follow-up dry run
found 0 eligible objects, 294 objects left in the Supabase bucket (the soft-deleted
and other files never copied), and all 3,126 live clips present in R2 (733.9 MB,
usage report OK). R2 is now the only copy of the live reference clips, so there is
no second store to fall back to; the Supabase dashboard figure should drop as its
hourly usage data catches up. Details of the script and its safeguards:
`scripts/delete-supabase-reference-audio-copies.ts` (decision rules in
`scripts/lib/supabaseCopyCleanup.ts`, tested in `tests/supabaseCopyCleanup.test.ts`)
deletes from Supabase Storage only, and only objects whose live row is valid,
whose Supabase object exists and whose R2 twin has the identical size; it
hash-compares a sample first and refuses to delete if any differ. Dry run on
2026-10-21: 3,126 live rows; 2,847 objects (693.5 MB) eligible; 279 post-switch clips
correctly kept (R2 only); sample 30/30 byte-identical; about 294 other Supabase
objects (mostly soft-deleted clips never copied to R2) are left alone. The
assistant's `--apply` attempt was blocked by the session's permission classifier as
a bulk storage delete; the user ran it. It is irreversible.

**Maintenance scripts moved (2026-10-20):** the 13 scripts that read, wrote or
deleted reference-audio objects now go through `scripts/lib/referenceAudioStorage.ts`
(shared rules in `src/sync/audioStorageCore.ts`): reads try R2 first, writes go to
R2 only, and deletes clear both stores so a stale Supabase copy cannot be read
back. The gateway address comes from `R2_GATEWAY_URL` in `.env` (added; without it
scripts warn and use Supabase only). Checked live with one throwaway object
(R2-only upload, identical read-back, delete from both). Typecheck passes; the
scripts themselves were not run end to end. The source-episode and drill-take
buckets are separate and unchanged.

**Monitor scheduling:** systemd user units are in
`cloudflare/r2-gateway/deploy/` with install steps in the gateway README. They are
not installed: the main checkout needs a pull first.

**Still open:** removing the Supabase copies (needs explicit approval, and an
exact list first); installing the monitor timer; the Cloudflare budget alert (a
billing setting only the account owner can create); showing monitor results in the
app's storage settings (not started; analytics would need a server-side feed, not
the admin token in the browser); moving the source-episode and drill-take buckets
onto the gateway (optional, they hold about 200 MB); and the acceptance tests
listed below that need a real Worker or a second account.

**Usage monitor (written 2026-10-20; first live run the same day returned OK):**
storage 693,556,176 bytes across 2,847 objects (matching the migration), 2,963
Class A and 28,184 Class B operations month to date, 0 pending multipart uploads,
against the 10 GB / 1M / 10M free tier. Two dashboard-style operation names
(`GetBucketNotificationConfiguration`, `GetBucketSippyConfiguration`) are not on
Cloudflare's published class lists, so they are reported as unclassified rather
than counted. An account-owned token verifies at
`/accounts/{id}/tokens/verify`; `/user/tokens/verify` rejects it. The gateway
ledger comparison has not been run (it needs `R2_ADMIN_TOKEN`).
`npm run report:r2-usage` (`scripts/report-r2-usage.ts`, logic in
`scripts/lib/r2Usage.ts`, tested with fake GraphQL responses in
`tests/r2Usage.test.ts`). It reads the account's R2 operations and the bucket's
storage from Cloudflare's GraphQL Analytics API, classifies operations per the
published Class A/B/free lists, averages daily storage peaks (R2's billing basis)
and reports ok/warning/exceeded/unknown against the free allowances, with the
gateway's own ledger compared when `R2_GATEWAY_URL` and `R2_ADMIN_TOKEN` are set.
Truncated, stale, missing or failed data is unknown, never zero; `--check` exits 2
unless everything is ok. To run it you need `CLOUDFLARE_ACCOUNT_ID` and an
analytics token limited to **Account Analytics: Read** (create it in the Cloudflare
dashboard under My Profile, API Tokens, Custom token), kept in `.env` or the shell
and never committed or shared. The default period starts on the first of the UTC
month; pass `--period-start` to match the dashboard's billing cycle. The GraphQL
queries follow Cloudflare's published R2 analytics examples and worked against the
live API.

## Scope and migration

Start with reference-audio clips, copying their original bytes. Keep metadata
and owner/book-sharing permissions in Supabase. Implement a shared storage
adapter for `src/sync/audioSync.ts` and the maintenance scripts; source-episode
mirrors and drill takes have separate paths and can follow later. A server
endpoint must authorize access before granting an R2 operation. Preserve the
actual Storage permissions: reference-audio reads allow the owner or readable
book members; blob writes currently require the owner. Metadata-row permissions
alone are not an exact replacement for the Storage policies.

Inventory the current objects and writers, copy with resumable verification,
then test playback, shared access, imports, cache repair and a fresh-device
restore. During transition, select the verified current copy; do not silently
serve an obsolete Supabase object after an R2 overwrite. Keep Supabase copies
until migration verification and approved cleanup. Storage space is reclaimed
only after those copies are removed. Old clients and maintenance scripts must
not keep writing unnoticed to the old destination.

## Provider controls and their limits

Cloudflare's [budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)
notify on account-wide usage-based spend. They do not pause usage or enforce a
spending cap. Configure a low acceptable dollar threshold under
Manage Account → Billing → Billable Usage → Create budget alert. An alert after spending begins
cannot guarantee a zero bill. No configurable R2 hard spending cap was found in
the reviewed official documentation; the [R2 limits](https://developers.cloudflare.com/r2/platform/limits/)
page lists unlimited storage per bucket.

The [Standard tier](https://developers.cloudflare.com/r2/pricing/) currently
includes 10 GB-month of storage, 1 million Class A operations and 10 million
Class B operations monthly. Egress is free; reads/writes are still metered.
Treat the allowance as shared account capacity. Store dated configurable terms,
not assumptions that each bucket gets its own free tier. R2 storage billing uses
daily peaks averaged over its billing period, unlike the Supabase GB-hour model.
Keep storage classes separate; Infrequent Access does not receive this free tier.

## Monitoring requirements

- Read account and per-bucket usage through Cloudflare's
  [analytics API](https://developers.cloudflare.com/r2/platform/metrics-analytics/),
  with a separate read-only analytics credential. Bucket S3 credentials alone
  do not establish access to that API; verify the required permissions.
- Report latest storage bytes, object count, pending multipart uploads, growth,
  projected billing-period storage, and Class A/B operations. Include other
  buckets, migration/verification requests, retries and maintenance tools.
- Show collection time and the usage cutoff. Missing, stale, partial or
  truncated responses must remain unknown, not healthy zero usage. Split API
  windows when necessary; the documented maximum query range is 31 days.
- Poll on a modest schedule and show the latest result in the app's storage
  settings. Compare forecasts with the billable-usage dashboard. Analytics is
  observational data, not an instantaneous billing or admission-control counter.
- Do not infer exact transfer totals from the bandwidth dataset: it omits
  transfers smaller than 100 KiB. Storage and operation budgets are the relevant
  R2 cost controls; downloaded bytes remain a diagnostic metric.

## Application-enforced limits

Proposed initial thresholds, configurable and not yet active:

| Resource | Warning | Stop admitting new work |
| --- | --- | --- |
| Account storage, including reserved uploads | 8 GB | Before exceeding 9 GB |
| Monthly Class A operations | 500,000 | 800,000 |
| Monthly Class B operations | 5,000,000 | 8,000,000 |

These reserve headroom below the current free allowances. The live storage
ceiling is conservative engineering policy, separate from the billed average;
it does not erase usage already incurred earlier in the period.

- Enforce admission on the server for every app and script write. Atomically
  reserve bytes before concurrent uploads, validate the permitted object size,
  reconcile completed/abandoned uploads and count overwrites correctly.
- Retain reservations while an issued grant or in-flight write can still add
  bytes. A timeout does not prove that the remote upload failed. Block new
  uploads when accounting cannot be trusted; preserve local files for retry.
- Bound retries and parallel transfers. Add request budgets and an emergency
  switch to stop new remote grants; existing local cached playback can continue.
- Short-lived signed URLs can be reused until expiry. Counting URL issuance
  does not cap the number of underlying R2 requests, and refusing new URLs
  does not revoke existing ones. An enforced per-request ceiling requires a
  controlled gateway for every request, with its own service limits/costs
  evaluated. Choose and document this tradeoff before calling any limit hard.
- Out-of-band dashboard/API writes, other buckets, outstanding grants and
  delayed usage data can bypass app limits. Do not promise a provider-wide
  spending cap or guaranteed zero overages from these controls.

Acceptance tests must include concurrent uploads at the boundary, oversized
payloads, unknown/stale usage, retries/timeouts, replayed grants, failed
completion, overwrite/deletion accounting, cross-user access and billing-cycle
rollover. Stored bytes persist across cycles. Monitor and admission-control
verification are required before moving routine uploads to R2.

## Immediate setup remaining

Confirm the private Standard bucket and account, provision scoped server-side
storage credentials plus read-only analytics access, and configure the provider
budget alert. Keep credentials out of chat, git and browser bundles. Then build
the integration and tests; bucket creation alone does not enable these controls.
