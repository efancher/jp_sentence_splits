# Supabase security review — Satori Glossbook

Date: 2026-07-22

## Checklist

| Requirement | Status |
| --- | --- |
| Service-role key never in frontend | Pass — only anon/publishable via `VITE_*` |
| Secrets not committed | Pass — `.env` gitignored; `.env.example` placeholders only |
| RLS on all exposed tables | Pass — migration enables RLS + policies |
| Private Storage bucket | Pass — `reference-audio` public=false |
| Ownership enforced in policies | Pass — owner + `sync_private` membership helpers |
| No searchable user directory | Pass — invites by email / Edge Function |
| Auth tokens not stored in app tables | Pass — supabase-js session handling |
| Soft deletes for sync propagation | Pass — `deleted_at` + sync_events |
| User recordings not synced | Pass — no user-recording feature; reference audio opt-in only |
| Persistent session warning | Pass — Settings copy for shared devices |

## Known residual risks

1. **JWT freshness**: membership changes apply on next request; short-lived JWTs refresh via supabase-js.
2. **Edge Function `listUsers`**: invite function may page users to match email — acceptable for small projects; prefer Admin `getUserByEmail` when available in your CLI version.
3. **Shared device sessions**: persistent localStorage sessions remain until sign-out.
4. **Anon key in Pages build**: expected for static hosting; RLS is mandatory.

## Advisors

After applying migrations, run Supabase security advisors in the Dashboard
(or `supabase db advisors` on CLI ≥ 2.81.3) and resolve any HIGH findings.
