# Status

Last updated: 2026-08-13.

## Phase 0 — Repository analysis: done

`docs/UNIFIED_APP_ARCHITECTURE.md` complete. Canonical repo confirmed as
this one. Reviewed with the user; two clarifications incorporated (Anki
migration is one-time only, no ongoing interop; WK/JMDict ingestion must be
native and web-based, not routed through Anki).

## Phase 1 — Unified data model: done, verified

Added, purely additively (nothing existing was touched):

- `src/domain/types.ts` — `Source`, `VocabularyItem`, `SentenceVocabulary`,
  `Kanji`, `VocabularyKanji`, `StudyItem`, `FsrsState`, `Review`,
  `ReviewRating`, `ErrorClassification`.
- `src/domain/schemas.ts` — matching Zod schemas. Not yet part of
  `backupSchema` (deferred until these tables carry real data worth backing
  up).
- `src/db/database.ts` — Dexie schema v6, seven new empty stores
  (`sources`, `vocabularyItems`, `sentenceVocabulary`, `kanji`,
  `vocabularyKanji`, `studyItems`, `reviews`).
- `supabase/migrations/20260813000000_unified_study_model.sql` — matching
  Postgres tables, RLS (owner-only), and the existing
  `set_updated_at`/`bump_version`/`append_sync_event` triggers. **Applied to
  the live Supabase project** (2026-08-13, via Dashboard SQL Editor paste;
  ran clean, no errors).
- `supabase/tests/rls_expectations.md`, `supabase/README.md` — updated to
  document the new tables.
- `tests/migration.test.ts` — new test opens at schema v6 and round-trips a
  row through each new table.

**Verified**: `npm run check` (typecheck + vitest) — 123 passed, 2 skipped
(pre-existing, unrelated — the personal-export smoke test needs a private
CSV that isn't present), 0 failed. No existing test was modified.

**Code-reviewed** (medium-effort pass) before commit; three real findings, all
fixed: (1) RLS policies on `sentence_vocabulary`/`vocabulary_kanji`/`reviews`
now also verify referenced rows (`vocabulary_item_id`/`kanji_id`/
`study_item_id`/`sentence_id`) belong to the same owner, not just the row
being written — added `sync_private.owns_vocabulary_item`/`owns_kanji`/
`owns_study_item` helpers; `rls_expectations.md` corrected (it previously
claimed protection that didn't exist). `study_items.subject_id` ownership is
a documented, accepted gap (polymorphic, can't be a plain FK). (2)
`kanjiSchema.character` now checks Unicode code points, not UTF-16 length,
so astral-plane kanji (e.g. 𠮟) validate consistently with Postgres's
`char_length`. (3) `SentenceVocabulary`/`VocabularyKanji` TS types were
missing `createdAt`/`updatedAt` that the SQL tables already have — added.

**Deliberately not done yet** (documented, not forgotten):
- Sync engine wiring (`src/sync/mappers.ts`, `SyncEntity`) for the new
  tables — no UI writes to them yet, so there's nothing to sync.
- `backupSchema`/`buildBackupPayload` extension to cover the new tables.

## Phase 2 — Existing data migration: in progress

Scoped down from the original line item after discussion: JMDict is **not**
bulk-uploaded to Supabase. Inspecting `src/lib/vocabularySuggestions.ts`
confirmed nothing anywhere writes a confirmed suggestion into the new
normalized `vocabulary_items` table yet — that's genuinely Phase 5 work
("Build the UI for confirming `vocabularySuggestions`/spans into real
`sentence_vocabulary`/`vocabulary_kanji` links"), not Phase 2. So today's
JMDict piece is a local lookup tool only, for Phase 5 to consume later.

Added:
- `scripts/lib/wanikani.ts`, `scripts/import-wanikani-kanji.ts` — bulk
  imports/upserts the full non-hidden WaniKani kanji catalog into Supabase
  `kanji`. Idempotent on `character` (existing row ids are looked up and
  reused before upsert, so re-running doesn't churn primary keys that
  `vocabulary_kanji` will eventually FK to). Auth: signs in as the real user
  via the anon client (`SCRIPT_SUPABASE_EMAIL`/`SCRIPT_SUPABASE_PASSWORD`),
  same RLS path as the browser — no service-role key introduced.
- `scripts/lib/jmdict.ts`, `scripts/lookup-jmdict.ts` — downloads/caches the
  pinned jmdict-simplified release (`scripts/.cache/`, gitignored, ~110 MB),
  builds an (expression, reading) → gloss/POS/common lookup index correctly
  handling `kana[].appliesToKanji` so homophones like 週間/習慣 stay
  distinct. Local only — verified end-to-end against the real release
  (`npm run jmdict:lookup -- 先生` → correct gloss).
- `tsx`/`dotenv` added as devDependencies (first Node-side/non-Vite TS
  tooling in this repo); `scripts/` added to `tsconfig.node.json` so it's
  covered by `npm run typecheck`.
- `tests/wanikaniKanji.test.ts`, `tests/jmdict.test.ts` — pure
  parse/transform logic against fixtures, no network calls.

**Verified**: `npm run check` green (typecheck + vitest, including the two
new test files); `jmdict:lookup` run live against the real JMDict release.

**Code-reviewed** (medium-effort pass) before commit; three real findings, all
fixed: (1) the kanji upsert targeted `owner_id,character` for `ON CONFLICT`,
but `kanji_owner_character_uidx` is a partial index (`where deleted_at is
null`) — Postgres can't use a partial index as an arbiter without the
conflict clause repeating its predicate, which PostgREST's upsert has no way
to express, so every batch would have failed with error 42P10 on first live
run. Fixed by targeting `id` instead (the real, non-partial primary key),
relying on the existing character→id lookup to keep that a character-keyed
upsert in effect. (2) `readingsByType()` decided the primary-vs-all-readings
fallback globally across all three reading types combined, so a kanji with a
primary kunyomi but no primary onyomi would silently lose its onyomi
readings — fixed to decide the fallback per type. (3) The WK-catalog fetch
and the existing-rows Supabase fetch were unnecessarily sequential; changed
to `Promise.all`.

**Run against the live Supabase project** (2026-08-14): 2101 non-hidden
kanji subjects imported. Ran twice to confirm idempotency — second run
found all 2101 existing rows and reported `0 created, 2101 updated`, no
duplicates, no primary-key churn.

Hit one setup snag worth noting for next time: the account password in
`SCRIPT_SUPABASE_PASSWORD` contained a `#`, which an unquoted `.env` value
truncates as a comment (standard `.env` parsing, not a bug in the script) —
sign-in failed with a generic "Invalid login credentials" until the value
was wrapped in quotes. Worth adding a quoting note to `.env.example` if
this trips up anyone else.

WaniKani-kanji half of Phase 2 is now fully done. JMDict→`vocabulary_items`
remains deferred to Phase 5 as described above.

### One-time Anki sentence import: done

Added:
- `~/projects/anki/scripts/export_immersion_notes_for_glossbook.py` —
  read-only export of `WK Satori Immersion`/`WK Shadowing Immersion`/`WK
  Shadowing Candidate` note fields via `anki_headless` (never calls `push`).
  **Ran against a real synced collection** during development (501 notes:
  234 Satori, 236 Shadowing, 31 Candidate) to validate field-mapping
  assumptions before writing the TS side — this surfaced a real bug before
  it shipped (see below).
- `scripts/lib/ankiImport.ts`, `scripts/import-anki-sentences.ts` — maps
  notes into `Sentence`/`vocabulary_items`/`sentence_vocabulary`/inbox.
  Dry-run by default; `--apply` required to write. Idempotent: sentences
  dedup by normalized Japanese text (merging `sourceReferences`/
  `targetVocabulary`, not duplicating), vocabulary items dedup by
  `normalizeExpressionKey(expression, reading)` (NFC-normalized, matching
  the same key `csvImport.ts` already uses — not a raw string join).
  Confirmed with the user: lands in the **inbox** (same default as other
  importers), all three note types included.
- `tests/ankiImport.test.ts` — 16 tests against fixtures, no real Anki/
  Supabase needed.

**Real-data finding that changed the design**: `Glossary` is not a gloss
field. Verified against the live export: for Satori/Shadowing Immersion
it's a real JMDict POS tag (`adj-i`, `v5k; vi`); for Shadowing Immersion
specifically every single note had the literal value `auto-caption`; for
Shadowing Candidate it's always a `POS: <label>` placeholder (`POS:
unknown`, `POS: colloquial-compound`) from the candidate pipeline, never an
English gloss. The original plan's fallback chain (`WkMeaning || Glossary
|| HintGlossary`) would have written this junk into `vocabulary_items.meaning`
for every Shadowing/Candidate word. Fixed: `meaning` only ever comes from
`WkMeaning`/`HintGlossary`; `Glossary` is used for `partOfSpeech` only, and
only when it isn't one of the known junk patterns.

**Code-reviewed** (medium-effort pass) before commit; two real findings, both
fixed: (1) merging a re-imported sentence into an existing one overwrote
`firstOccurrenceIndex` with this run's note index instead of preserving the
original — would have silently reshuffled first-occurrence-sorted lists
for any sentence also touched by this import; the existing CSV importer's
own reimport path (`mergeSentenceOnReimport`) already establishes the
correct behavior (preserve it), so this now matches. (2) `Expression`/
`Reading`/`Furigana` were only `.trim()`'d instead of going through the
same `displayJapanese` normalization as `Sentence`/`Translation`, and the
vocabulary dedup key was a raw string join instead of the codebase's own
`normalizeExpressionKey` — both fixed, closing a path to duplicate/garbled
`vocabulary_items` rows for non-NFC or HTML-entity-bearing fields.

**Verified**: `npm run check` green (155 passed).

**Run against the live Supabase project** (2026-08-14): 501 notes read (234
Satori, 236 Shadowing, 31 Candidate), 0 skipped. Result: 16 new sentences,
142 merged into sentences that already existed from prior CSV imports (this
codebase's two Satori-import paths overlap, as expected), 332 new
vocabulary items, 500 new sentence links (500/501 notes had a usable
`Expression`), 158 new inbox entries. Ran dry-run again immediately after
to confirm idempotency — reported `0 new sentences / 0 new vocabulary
items / 0 new sentence links / 0 new inbox entries`, all 158 sentences
correctly reported as already-touched merges.

Phase 2 is now **fully done**: both sub-tasks (WaniKani kanji catalog,
one-time Anki sentence import) are live. JMDict→`vocabulary_items` bulk
import remains out of scope by design, deferred to Phase 5.

## Phase 3 onward: not started

See `docs/ROADMAP.md`.
