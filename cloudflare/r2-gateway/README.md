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
