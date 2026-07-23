# Supabase assets

| Path | Purpose |
| --- | --- |
| `migrations/20260722000000_sync_schema.sql` | Tables, triggers, RLS, Storage bucket |
| `functions/invite-book-member/` | Edge Function for email invites |
| `tests/rls_expectations.md` | Multi-user RLS verification outline |

Apply migrations via the Dashboard SQL Editor or `supabase db push`.

Setup guide: [`docs/supabase-setup.md`](../docs/supabase-setup.md).
