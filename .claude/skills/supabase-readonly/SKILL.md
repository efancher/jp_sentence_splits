---
name: supabase-readonly
description: Read-only queries against the production Supabase database (study_items, sentences, books, sentence_learning_events, ...). Use when diagnosing "why is X empty/missing/stuck" questions that need real synced data rather than guesses from code.
---

# Read-only Supabase queries

`npm run db:query -- <table> [options]` runs a single `select` through
`scripts/db-query.ts`. It signs in as the script user (`SCRIPT_SUPABASE_EMAIL` /
`SCRIPT_SUPABASE_PASSWORD` from `.env`), so RLS scopes rows to that owner. The
file only calls `.select()` — there is no insert/update/delete/rpc path. Never
print `.env`. For anything that writes, use a dedicated script and ask first.

## Options

| flag | meaning |
| --- | --- |
| `--select a,b` | columns (default `*`) |
| `--eq/--neq col=val` | equality / inequality (repeatable) |
| `--lt/--lte/--gt/--gte col=val` | comparisons; JSON paths work: `"fsrs_state->>due=2026-10-02T00:00:00Z"` |
| `--in col=a,b,c` | membership |
| `--like col=%pat%` | case-insensitive match |
| `--is-null col` / `--not-null col` | null checks |
| `--order col[:desc]` | sort (repeatable) |
| `--limit N` | default 50, max 1000 |
| `--count` | print only the row count |
| `--include-deleted` | by default rows with `deleted_at` set are hidden |

Tables are allowlisted (see `TABLES` in the script). Columns are snake_case;
`study_items.fsrs_state` is a JSON column (`due`, `state`, `reps`, ...) with no
separate due column. Some tables have no `deleted_at` — the error says so;
retry with `--include-deleted`. A wrong column name errors with the real one in
the message, which is the quickest way to discover schema.

## Examples

```bash
# Sentence cards due by end of today
npm run -s db:query -- study_items --eq subject_type=sentence --lt "fsrs_state->>due=2026-10-03T00:00:00Z" --count

# Sentences the gloss walkthrough was completed on, newest first
npm run -s db:query -- sentence_learning_events --eq action=walkthrough_completed --select sentence_id,created_at --order created_at:desc

# Which books are suspended
npm run -s db:query -- books --select id,title,suspended_at

# Do a set of sentences have any study items?
npm run -s db:query -- study_items --in subject_id=sent_a,sent_b --select subject_id,activity_type
```

## Caveats

- This is the cloud copy. The app reads local Dexie (IndexedDB); rows not yet
  synced, or logic that runs only client-side (queue building, readiness
  gates), will not show up here. Use it to check data, not UI behavior.
- Output is JSON on stdout and a row-count line on stderr; pipe through
  `head`/`grep` for long results.
