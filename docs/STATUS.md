# Status

Last updated: 2026-08-15.

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

## Phase 3 — Unified shadowing: core loop done and verified, live overlay/analysis deferred

Scoped down after discussion: this pass ports only the record → save → compare
→ rate loop from `~/projects/shadowing/web`. The live waveform-while-recording
overlay and offline pitch/waveform comparison view (`analysis/pitch.ts`,
`analysis/japanese.ts`, `ShadowReferencePlayer`, `AnalysisPanel`-equivalent)
are explicitly deferred to a follow-up pass, to be ported together with their
consumer once the core loop is in daily use.

Added:
- `src/lib/recording.ts` — ported `RecordingService`, `PlaybackCoordinator`
  (`alternate`/`dualEar` only — `playSequence` dropped, unused),
  `micConstraintsForRecording`, `playDualEar` from
  `shadowing/web/src/services/recording.ts`. Zero source-repo imports in the
  original, so this is a near-verbatim copy. Not ported: `calibrateMicrophone`,
  `playReferenceForShadowing`, `ShadowReferencePlayer`, `stopShadowReference`
  (all live-overlay-specific).
- `src/lib/shadowing.ts`, `src/hooks/useShadowing.ts` — new
  `ShadowingController`, modeled on `nativeAudio.ts`'s external-store pattern
  as a sibling, not a reuse (materially different state: recording progress,
  comparison mode). Auto-stops recording at `MAX_RECORDING_DURATION_MS`.
- `src/domain/types.ts` — `Attempt`, `AttemptRating`. Blob stored inline,
  matching `SentenceAudio`'s existing pattern (no separate asset table,
  since each attempt's blob is 1:1 and never reused). No Zod schema and not
  part of `backupSchema` — same precedent as `SentenceAudio` (blobs aren't
  JSON-serializable for backup/export).
- `src/db/database.ts` — Dexie schema v7, one new store (`attempts`).
- `src/db/repository.ts` — `saveAttempt`/`listAttemptsForSentence`/
  `deleteAttempt`/`rateAttempt`. Local-only by design (§18) — none of these
  call `notifySync`/`notifySyncMany`; no Supabase migration or Storage bucket
  added in this pass.
- `src/pages/ShadowPage.tsx` — new `books/:bookId/shadow/:sentenceId` route,
  linked from a "Shadow" button next to "Analyze" on `PracticePage`. Record →
  stop → preview → save/discard; past-attempts list with Alternate/Dual-ear
  comparison playback against the sentence's reference audio, 4-way manual
  rating, delete (with confirm). Works without reference audio too (record/
  save only, comparison playback disabled).
- Tests: `tests/recording.test.ts` (ported the 3 existing shadowing/web tests
  plus new coverage — `start`/`stop` happy path, both `stop()` error paths,
  `cancel()`, `alternate()` happy path + cancellation, `dualEar()` happy path
  — closing the architecture doc's Phase 3 gate that shadowing/web itself
  lacked this coverage), `tests/shadowing.test.ts` (controller state machine,
  fake-timer-driven auto-stop, comparison state), `tests/data.test.ts`
  (attempt CRUD, plus a regression guard asserting `syncRecordMeta`/
  `syncQueue` stay empty), `tests/migration.test.ts` (v7 round-trip),
  `tests/shadowPage.test.tsx` (RTL: renders reference clip + record control +
  attempt list, delete with/without confirmation).

**Verified**: `npm run check` green (182 tests, 2 pre-existing skips), `npm run
build` green (`ShadowPage` code-splits into its own chunk). Attempted an
automated real-browser smoke test (Playwright + Chromium with
`--use-fake-device-for-media-stream` to simulate a mic) to exercise record →
save → alternate → dual-ear → rate → delete end-to-end; blocked by missing
system shared libraries (`libnspr4.so` etc.) that require root to install,
which wasn't available in this environment. **Manual verification in a real
browser (`npm run dev`, grant mic permission) is still needed** before
considering this phase's UI fully proven — automated coverage above verifies
the logic and component wiring, not real `MediaRecorder`/`getUserMedia`
behavior end-to-end.

**Manually verified (2026-08-14)**: user tested record and the various
playback options (alternate, dual-ear) in a real browser on their Mac —
passed. Phase 3's core loop is now fully done and confirmed, not just
logic-tested.

## Phase 3 remaining: not started

Live waveform-while-recording overlay and offline pitch/waveform comparison
view remain deferred, see Phase 3 above.

## Phase 4 — FSRS: comprehension + reading_in_context done, remaining activity types not started

Scoped with the user before starting: entry points are both a global
`/review` queue (all books) and a per-book `/books/:bookId/review` queue
(confirmed "both" over picking one); study_items are seeded lazily, the
first time a subject is actually encountered in a review session, not via
any batch migration step (confirmed "lazy, on first review" — no seeding
script, no risk of creating study_items for content the user never
studies).

Added:
- `ts-fsrs` (`^5.4.1`, FSRS-6) as a dependency — the same library the
  architecture doc researched and picked in Phase 1 planning.
- `src/domain/types.ts`/`schemas.ts` — added `learningSteps: number` to
  `FsrsState`. Not in the original Phase 1 design; ts-fsrs 6's `Card` type
  requires it for correct short-term (same-day re-learning) scheduling, and
  the doc's own framing of `FsrsState` as "shaped to match ts-fsrs's own
  Card" meant leaving it out would have been a latent bug (every card
  restarting its within-day learning-step counter on every load). Purely
  additive — no Dexie/SQL migration needed, since `fsrs_state` is an
  unindexed jsonb blob at both layers. Also reordered `fsrsStateSchema`/
  `studyItemSchema`/`reviewSchema` (and `studySubjectTypeSchema`, moved
  alongside them) to sit before `backupSchema` in `schemas.ts`, since
  `backupSchema` now references them and `const` bindings can't be
  forward-referenced across a module's top-level evaluation order.
- `src/lib/scheduling.ts` — thin, pure wrapper around ts-fsrs
  (`createInitialFsrsState`, `scheduleReview`), exactly matching §10's
  "cleanly separated from UI and linguistic content" requirement: it knows
  nothing about sentences, vocabulary, or React. `tests/scheduling.test.ts`
  covers state transitions (new → learning/review, lapse → relearning) and
  a full round-trip through all four `FsrsState.state` values, independent
  of any UI (satisfies the architecture doc's Phase 4 gate).
- `src/db/repository.ts` — `ensureStudyItem` (lazy get-or-create, keyed on
  the existing `[subjectType+subjectId+activityType]` Dexie index),
  `getDueStudyItems` (activityType + optional subjectId scoping, due-date
  filter/sort — deliberately the single place "due" is decided, see below),
  `recordReview` (inserts the append-only `Review`, calls `scheduleReview`,
  updates the `StudyItem`'s `fsrsState` in the same Dexie transaction).
- Sync wiring for `study_items`/`reviews` (`src/sync/types.ts`,
  `src/sync/mappers.ts`, `src/sync/engine.ts`) — these are the first of the
  Phase 1 unified-study tables to get real UI writes, so this is the first
  time they're wired into push/pull/first-login-upload/replace-with-cloud.
  RLS was already correct from Phase 1's own code-review pass
  (`sync_private.owns_study_item`), so no SQL migration was needed here.
- `backupSchema`/`buildBackupPayload`/`exportFullBackup`/`exportBookBackup`/
  `restoreBackup` extended to cover `studyItems`/`reviews` (Phase 1 deferred
  this "until these tables carry real data" — they now do).
- `src/pages/ReviewPage.tsx` — new `/review` (global) and
  `/books/:bookId/review` (scoped) routes, `Review` nav entry, `Review`
  button on `BookDetailPage`. Session queue = due `study_items` (via
  `getDueStudyItems`) plus a lazily-seeded pool of never-seen
  (sentence, activityType) pairs, seeded a whole sentence's missing
  activity types at a time as the due queue runs dry. Card interaction: see
  the Japanese sentence, reveal translation + target vocabulary, self-rate
  4-way (again/hard/good/easy) — the same interaction for both activity
  types in this pass. `tests/reviewPage.test.tsx` covers lazy seeding, the
  rate → advance → record-review flow, a partial-seed recovery case
  (comprehension existed, reading_in_context didn't — confirms the missing
  one still gets picked up, not skipped forever), a rapid-double-click
  re-entrancy guard, and the empty state.

**Deliberately scoped down / not done yet** (per the architecture doc's own
"start small" instruction, and this session's discussion with the user):
- Only two `StudyActivityType`s are wired up: `comprehension` and
  `reading_in_context`. They currently share one interaction (see JP,
  reveal EN + vocab, self-rate) — no real differentiation yet (e.g.
  `reading_in_context` doesn't yet show surrounding chapter context). Real
  differentiation, and any further activity types (`listening`,
  `vocab_in_context`, `cloze`, `build`, `shadowing`), are follow-up work.
- `reviews.errorClassification` is populated by nothing yet — matches the
  architecture doc's explicit instruction not to overbuild automatic
  classification in this phase; the schema already supports it (Phase 1).
- No "new cards per session" cap — the lazy-seed pool seeds one sentence's
  worth of study_items at a time as the queue empties, with no upper bound
  on how many new sentences a single session can pull in. Low risk at
  current content volume; worth revisiting if session length becomes a
  complaint.

**Code-reviewed** (medium-effort pass) before commit; three real findings,
all fixed: (1) `handleRate` had no re-entrancy guard, so a rapid
double-click/double-tap could call `recordReview` twice for one user
action before the queue re-rendered past the card — added a `submitting`
state guard and disabled the rating buttons while a review is in flight.
(2) `ReviewPage` reimplemented the due-item filter/sort inline instead of
calling `getDueStudyItems`, risking the two definitions of "due" silently
drifting apart — now calls the repository function instead. (3) The
lazy-seed pool tracked "already seen" per-sentence, so a sentence left with
only some activity types seeded (e.g. an interrupted write) would be
skipped forever instead of having the missing activity type picked up —
now tracks pending seeds per (sentence, activityType) pair.

**Verified**: `npm run check` green (197 tests, 2 pre-existing skips — one
of which, `shadowPage.test.tsx`'s delete-attempt test, is flaky under the
full suite run but passes standalone; confirmed pre-existing and unrelated
to this work by reproducing it before touching anything). `npm run build`
green, `ReviewPage` code-splits into its own chunk. **Not yet manually
verified in a real browser** — this pass covered logic/component tests
only, following the same caveat Phase 3 initially shipped with.

## Phase 4 remaining / Phase 5 onward: not started

See `docs/ROADMAP.md`.
