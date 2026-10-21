# R2 gateway Worker (not deployed)

A Cloudflare Worker that fronts the private `satori-reference-audio` R2 bucket.
Design and limits: [CLOUDFLARE_R2_PLAN.md](../../docs/CLOUDFLARE_R2_PLAN.md).
The app uses it only when `VITE_R2_GATEWAY_URL` is set; without it, reference
audio stays on Supabase Storage.

## What it does

- `GET|HEAD|PUT|DELETE /v1/objects/{ownerId}/{bookId}/{audioId}.{opus|mp3|wav|m4a}`
  with `Authorization: Bearer <Supabase access token>`. The token is verified
  against Supabase Auth. The path owner may read, write and delete; other
  readers of the book may read (checked through the `books` RLS under the
  caller's own token), mirroring the Storage policies.
- Uploads need an allowed audio type, a `Content-Length` of at most 50 MiB and
  a successful reservation in a Durable Object ledger (storage ceiling plus
  monthly Class A/B operation ceilings). The ledger refuses uploads until
  seeded, so the bucket's existing size is never assumed to be zero.
- `GET /v1/admin/usage` and `POST /v1/admin/seed` (`{"baselineBytes": n}`)
  require `ADMIN_TOKEN`. `GATEWAY_DISABLED=1` refuses all non-admin requests.

Limits cover only traffic through this Worker. Writes made in the Cloudflare
dashboard or with other credentials, and delayed provider usage data, are not
visible to it, and it does not cap provider billing. Keep a Cloudflare budget
alert configured.

## Deploy checklist (user actions; nothing here has been run)

1. Edit `wrangler.toml`: set `SUPABASE_URL` and `ALLOWED_ORIGINS`.
2. `npx wrangler secret put SUPABASE_ANON_KEY` and `npx wrangler secret put ADMIN_TOKEN`
   (a long random value). Do not commit or paste either.
3. `npx wrangler deploy` from this directory, then call `/v1/admin/seed` with the
   bucket's real current size (0 only if you confirmed the bucket is empty).
4. Set `VITE_R2_GATEWAY_URL` for the app build (a build variable, not a secret),
   after the migration copy has been verified.

Verify CORS, an owner upload/download, a book-member download and a refused
stranger on a deployed Worker; the unit tests use fakes and do not prove
Cloudflare behavior (`tests/r2Gateway.test.ts`).

Deploy with the real `SUPABASE_URL` and `ALLOWED_ORIGINS`. Deploying this
template as committed replaces them with placeholders; pass
`--var SUPABASE_URL:... --var ALLOWED_ORIGINS:...` or edit a local copy first.

## Daily usage report (optional)

`deploy/r2-usage-report.{service,timer}` run `npm run report:r2-usage` daily on
the box as systemd user units, in the same style as the mining service's
`box-metrics` timer. With `--check`, a warning, exceeded or unknown result makes
the unit fail, which shows in `systemctl --user --failed`. Install, after pulling
this repository into `~/projects/jp_sentence_splits` and setting
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_ANALYTICS_TOKEN` in its `.env`:

```bash
mkdir -p ~/.config/systemd/user
cp cloudflare/r2-gateway/deploy/r2-usage-report.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user start r2-usage-report.service   # run once now
systemctl --user status r2-usage-report.service  # "exited 0" means everything is ok
systemctl --user enable --now r2-usage-report.timer
```

The latest report is written to `test-results/performance/account/r2/`.

## Local backup of the clips

R2 holds the only copy of live reference-audio clips, so
`npm run backup:r2-audio` mirrors them to `~/backups/r2-reference-audio`
(`--dir` or `R2_BACKUP_DIR` to change it). It signs in as the script user, lists
live `reference_audio` rows, and downloads each clip through the gateway,
checking the size against the row and writing atomically. A dry run is the
default; add `--apply` to download. It is resumable and additive: files of the
right size are skipped and nothing is ever deleted from the mirror, so a clip
removed or lost in R2 stays recoverable. It exits 1 if any clip failed or is
missing in R2. Reads count as Class B operations in the gateway ledger.

Restore is the reverse: PUT each file back to
`/v1/objects/<owner>/<book>/<clip>.<ext>` (the mirror keeps the key paths).
No restore script exists yet; the first full mirror was taken 2026-10-21 (3,126
clips, about 707 MB). The mirror is on the same box as the services, so it
guards against R2 or account loss, not loss of the box itself. A daily timer is
not installed yet.
