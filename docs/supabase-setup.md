# Supabase setup for Satori Glossbook

This guide configures authenticated, local-first sync without running your own
server. The browser only uses the **project URL** and **anon/publishable key**.
Row Level Security (RLS) enforces access. Never put the **service role** key in
frontend code or GitHub Actions client secrets beyond what Edge Functions need
in the Supabase dashboard.

## 1. Create a Supabase account

1. Open [https://supabase.com](https://supabase.com) and sign up / sign in.
2. Create an organization if prompted.

## 2. Create a free project

1. **New project** → choose org, name (e.g. `satori-glossbook`), region near you.
2. Generate a strong **database password** and store it in a password manager.
   You need it for direct Postgres access; the app itself uses the anon key.

## 3. Retain the database password

Save the DB password offline. Rotating it later is possible from Project
Settings → Database, but plan for downtime of direct connections.

## 4. Project URL and public client key

Project Settings → **API**:

| Value | Env var |
| --- | --- |
| Project URL | `VITE_SUPABASE_URL` |
| `anon` `public` key (or publishable key) | `VITE_SUPABASE_ANON_KEY` |

These are **public** in a static site. Security comes from RLS, not key secrecy.

## 5. Local environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
```

Restart `npm run dev` after changes. Without these vars the app stays
**local only**.

## 6. Run SQL migrations

1. Open SQL Editor in the Supabase Dashboard.
2. Paste the full contents of
   [`supabase/migrations/20260722000000_sync_schema.sql`](../supabase/migrations/20260722000000_sync_schema.sql).
3. Run it once.

Or with Supabase CLI (optional):

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

## 7. Verify RLS is enabled

SQL Editor:

```sql
select relname, relrowsecurity
from pg_class
join pg_namespace on pg_namespace.oid = pg_class.relnamespace
where nspname = 'public'
  and relname in (
    'profiles', 'books', 'book_members', 'sentences', 'book_sentences',
    'analyses', 'import_batches', 'inbox', 'reference_audio',
    'book_invites', 'sync_events'
  );
```

Every row should show `relrowsecurity = true`.

## 8. Authentication email settings

Authentication → Providers → **Email**: enable Email.

Authentication → **Email Templates**: optional branding.

For local testing you may disable “Confirm email” temporarily; for production
keep confirmation enabled.

## 9. Site URL and redirect URLs

Authentication → URL Configuration:

**Site URL (local):**

```text
http://localhost:5173/
```

**Redirect URLs** (add all that apply):

```text
http://localhost:5173/
http://localhost:5173/#/settings
http://127.0.0.1:5173/
http://127.0.0.1:5173/#/settings
```

## 10. GitHub Pages redirect URLs

If the app is at `https://<user>.github.io/jp_sentence_splits/`:

**Site URL (production):**

```text
https://<user>.github.io/jp_sentence_splits/
```

**Additional redirect URLs:**

```text
https://<user>.github.io/jp_sentence_splits/
https://<user>.github.io/jp_sentence_splits/#/settings
https://<user>.github.io/jp_sentence_splits/index.html
https://<user>.github.io/jp_sentence_splits/index.html#/settings
```

The app uses **HashRouter**, so auth redirects land on `#/settings`.

### GitHub Actions secrets

Repository → Settings → Secrets → Actions:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The deploy workflow injects them at build time into the static bundle.

## 11. Reference-audio bucket

The migration creates a private bucket `reference-audio` with MIME and size
limits. Confirm under Storage:

- Bucket is **private** (not public).
- Policies exist for authenticated select/insert/update/delete.

Paths look like `{owner_user_id}/{book_id}/{audio_id}.opus`.

## 12. Create a test user

1. Authentication → Users → Add user, or
2. In the app: Settings → Create account with email/password.
3. Confirm email if required, then Sign in.

## 13. Verify sync between two browsers

1. Browser A: sign in, create a book, analyze a sentence, wait for **Synced**.
2. Browser B (or private window): sign in as the **same** user.
3. On first login with empty local data, choose **Replace local with cloud**
   (or upload if B had unrelated data).
4. Confirm the book and analysis appear.
5. Edit on B; refresh A (or Sync now) and confirm the change.

## 14. Verify viewer / editor sharing

1. Create a second user (email B).
2. As owner (email A), open a book → Sharing → invite email B as **viewer**.
3. Deploy the Edge Function for auto-membership (optional but recommended):

```bash
npx supabase functions deploy invite-book-member
```

4. Sign in as B, accept invite token if needed.
5. Viewer can read; editor can modify analyses / memberships content.
6. Confirm B cannot escalate to owner or invite others.

Manual RLS checks: [`supabase/tests/rls_expectations.md`](../supabase/tests/rls_expectations.md).

## 15. Export and restore a backup

Settings → **Export all data** → JSON file.

On another device or after clear: Import backup → Merge or Replace.

Audio blobs are omitted from JSON; keep shadowing ZIPs or enable reference
audio sync separately.

## 16. Diagnose common errors

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| 401 on Auth | Wrong URL/key, expired session | Check `.env`, sign out/in |
| 403 / empty rows | RLS denied | Confirm `owner_id`, membership, policies applied |
| Redirect loop / stuck | Redirect URL not allow-listed | Add exact Pages/local URLs including hash paths |
| Sync error badge | Network or version conflict | Sync now; open Conflicts in Settings |
| Storage upload fails | MIME/size or path owner mismatch | Use allowed MIME; path must start with your user id |
| “Supabase is not configured” | Missing env at build/dev | Set `VITE_*` and restart / rebuild |

Settings → **Copy diagnostics** for a sanitized snapshot (no tokens).

## Schema notes (deviations from a naive book-scoped model)

- Sentences are **user-global**, linked via `book_sentences`.
- Chunks live as JSONB on `analyses`.
- Chapters live as JSONB on `books`.
- Primary keys are **text** matching existing Dexie IDs.
- Pull cursor uses monotonic `sync_events.id`, not client clocks.
