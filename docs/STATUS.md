# Status

Last updated: 2026-08-17 (Phase 9 Milestone 8 done).

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

## Phase 4 remaining: not started

See `docs/ROADMAP.md`.

## Phase 5 — Vocabulary/kanji relationships: materialization + browsing UI done

Scoped with the user before starting: this pass covers both wiring the
existing `VocabularyPicker` confirm action to real normalized rows *and*
the first browsing UI ("this kanji occurs in these words"), rather than
splitting them across two passes. Two follow-up items were explicitly
deferred to "Phase 5 part 2" (confirmed with the user, not an oversight):
JMDict-based meaning backfill, and retroactive materialization for
sentences confirmed before this feature shipped (see below).

Added:
- `src/db/repository.ts` — `ensureVocabularyItem`/`ensureKanji` (get-or-
  create, deduped on `[expression+reading]`/`character` respectively,
  mirroring `ensureStudyItem`'s existing shape; never overwrite an existing
  row) and `materializeVocabularySelections` (wholesale-replaces a
  sentence's `sentenceVocabulary` links on every confirm — adds newly
  selected, removes deselected; never deletes `VocabularyItem`/`Kanji` rows
  themselves since other sentences may reference them). Kanji breakdown
  (`VocabularyKanji` rows, one per Han character in the expression,
  `positionInWord` = code-point index) is computed once, only when a
  `VocabularyItem` is first created — detection via `src/lib/kanji.ts`'s
  `isHanCharacter` (`\p{Script=Han}`, code-point safe for astral-plane
  kanji like 𠮟), shared with the browsing pages.
- `src/pages/AnalyzePage.tsx` — the existing `onConfirmAndNext` handler
  (previously only wrote the `SentenceAnalysis.vocabularySelections` blob)
  now also calls `materializeVocabularySelections` after `saveAnalysis`.
  Autosave/`onChange` are unchanged — materialization only fires on
  explicit confirm, not on every keystroke-level edit.
- Sync wiring (`src/sync/types.ts`, `src/sync/mappers.ts`,
  `src/sync/engine.ts`) for all four tables — first real UI writes, so
  first real sync wiring, mirroring the `study_items`/`reviews` pattern
  exactly (`applyRemoteDelete`/`applyRemoteUpsert`, `uploadAllLocalData`,
  `replaceLocalWithCloud`). Enqueue/pull order: `kanji`/`vocabularyItems`
  (either order) before `sentenceVocabulary`/`vocabularyKanji` (both
  depend on the parents) — the one dependency-ordering mechanism this
  codebase has (call order, no dependency graph), same as `study_items`
  before `reviews`.
- `backupSchema`/`buildBackupPayload`/`exportFullBackup`/`exportBookBackup`/
  `restoreBackup` extended to cover the four tables (Phase 1 deferred this
  "until these tables carry real data" — they now do). Unlike
  `studyItems`/`reviews` (Phase 4, not defaulted), these four fields use
  `.default([])`/`.default(0)` in `backupSchema` so a backup exported
  before this change (missing these keys entirely) still restores
  correctly instead of failing `safeParse` — caught in code review; noting
  here since `studyItems`/`reviews` still have this exact gap, unfixed,
  from Phase 4 (a pre-existing pattern, not touched in this pass).
- `src/pages/VocabularyListPage.tsx` (`/vocabulary`) — searchable list of
  every confirmed `VocabularyItem` (expression/reading/meaning/POS);
  kanji characters in the expression render as links to `/kanji/:character`.
  `src/pages/KanjiDetailPage.tsx` (`/kanji/:character`) — meanings/
  onyomi/kunyomi/nanori for the kanji, plus every word containing it
  (deduped by `vocabularyItemId`, since a word can use the same kanji more
  than once — e.g. 主 twice in 民主主義 — caught in code review). Both
  follow `ReviewPage`'s pattern (component-local state + `useLiveQuery` +
  direct repository/Dexie reads), lazy-loaded route + `AppShell` nav entry
  ("Words") like every other page.
- Ships "this kanji occurs in these words" only, not "this *reading* of
  this kanji occurs in these words" — deliberately scoped down (would need
  aligning a word's reading substring to onyomi/kunyomi per kanji, real
  NLP work not justified yet).

**Deliberately not done yet** (documented, confirmed with the user, not
forgotten — "Phase 5 part 2"):
- JMDict-based meaning backfill for `VocabularyItem`s with a blank
  `meaning` (`scripts/lookup-jmdict.ts` already exists as a local lookup
  tool; turning it into a backfill script against production is separate,
  independently-schedulable work).
- Retroactive materialization for sentences whose `vocabularySelections`
  were confirmed *before* this feature shipped — materialization only
  fires from the confirm button going forward, so those sentences won't
  automatically produce `VocabularyItem`/`sentenceVocabulary` rows unless
  re-confirmed.

**Code-reviewed** (medium-effort pass) before commit; two real findings,
both fixed: (1) `KanjiDetailPage`'s word list wasn't deduped by
`vocabularyItemId`, so a word with a repeated kanji (e.g. 民主主義 on the
主 detail page) rendered as duplicate cards — fixed, with a regression
test. (2) `src/lib/kanji.ts` exported an unused `kanjiCharactersOf` helper
that nothing called — removed, keeping only `isHanCharacter`.

**Known, pre-existing-pattern risk, not introduced by this pass**:
`ensureVocabularyItem`/`ensureKanji` do a read-then-write dedup check with
no locking across the `await` boundary, so two concurrent calls for the
same `(expression, reading)`/character (e.g. a rapid double-click on
"Confirm and next") could each pass the "not found" check and create a
duplicate row. This mirrors `ensureStudyItem`'s identical, already-shipped
race (Phase 4) — flagged for awareness, not fixed here, since fixing it
would mean introducing a new locking pattern this codebase doesn't use
anywhere else.

**Verified**: `npm run check` (typecheck + vitest) green — 219 tests
passed, 2 pre-existing skips (unrelated). `npm run build` green;
`VocabularyListPage`/`KanjiDetailPage` code-split into their own chunks.
**Not yet manually verified in a real browser** — this pass covered
logic/component tests only, same caveat as Phase 3/4 initially shipped
with.

**Important for manual verification**: the WaniKani kanji catalog (2101
rows) and the one-time Anki vocabulary import (332 items, 500 links)
already live in Supabase from Phase 2. For a device whose sync cursor
(`lastPullEventId`, local/per-device) is still behind those imports'
`sync_events` rows (true for any device that hasn't completed a full sync
cycle since before 2026-08-14), the ordinary incremental pull now delivers
them correctly — see the pull-performance fix below. A device that *did*
complete a full sync cycle between 2026-08-14 and this fix landing would
have silently skipped writing that data locally (its cursor already
advanced past those `kanji`/`vocabulary_items`/etc. events on code that
didn't recognize those entities yet) and has no current way to force a
re-pull — there's no general "replace local with cloud" settings action
(only a one-time migration-choice modal, gated on `migrationChoice` being
unset, which won't reappear for an already-migrated account/device). Not
building a manual resync action now — flagged as a possible follow-up if
this residual gap actually affects a real device.

### Post-deploy fix: pull hung indefinitely on a large sync_events backlog

Found live, right after this phase's initial deploy: a user's phone
(iOS Safari PWA, last successful sync 2026-08-01, so its cursor predated
the 2026-08-14 WaniKani/Anki imports — ~2,900 backlogged `sync_events`
rows) got stuck at `status: "syncing"` indefinitely, with a stale
`lastError: "Transaction aborted"` left over from an earlier, different
failure. Diagnosis: `pendingCount: 0` and a `"Pushing 0 mutations"` log
line confirmed push had succeeded; nothing further logged after that,
meaning `pullChanges` was the stuck step.

Root cause: `pullChanges`/`applyRemoteEvent` fetched each changed remote
row individually (`supabase.from(entity).select('*').eq(idCol,
recordId).maybeSingle()`) — one network round-trip per `sync_events` row.
A ~2,900-row backlog is ~2,900 sequential round-trips; slow enough on a
mobile connection to look permanently stuck, and iOS aggressively
suspends a backgrounded PWA's JS execution (screen lock, app-switch),
plausibly freezing the loop mid-page indefinitely. Pre-existing gap, not
introduced by this phase — just never exercised at this scale before
(the two one-time production imports are what created a backlog this
large for a stale device).

Fix (`src/sync/engine.ts`): split the per-event skip checks (pending-
local-mutation / open-conflict / already-applied-version — all cheap
local Dexie reads) from the remote fetch. `pullChanges` now calls a new
`applyRemoteEventsBatch`, which runs the skip checks for a whole page
first, then groups the events that survive by entity and does one
`.in(idCol, recordIds)` query per entity present in the page — collapsing
up to 100 round-trips per page into a handful. `applyRemoteEvent` (the
single-event path, kept for its existing test and as a public API) and
the batched path now share one `applyFetchedRemote` decision function
(delete-vs-upsert), so they can't silently diverge — a real duplication
risk caught in code review before this fix, along with an unused `op`
field being threaded through the batch for no reason (both fixed).

Grouping by entity (rather than strict event-id order) is safe for this
schema's fixed, type-level dependency graph (kanji/vocabulary_items
before sentence_vocabulary/vocabulary_kanji, study_items before reviews):
an entity's first occurrence in a page still follows real event order, so
every parent-entity event in a page is applied before any child-entity
event — at least as strict as strict chronological order, never looser.

**Test coverage note**: this codebase has no Supabase-mocking test
harness anywhere (`pullChanges`/`pushMutations`/`applyRemoteEvent` early-
return in the test environment since `getSupabase()` returns null without
env vars) — the existing conflict-guard test for `applyRemoteEvent`
already relied on that early-return rather than truly exercising the
network path. Added direct tests for the extracted `shouldApplyRemoteEvent`
decision function (now exported) instead — pending-mutation skip, already-
applied-version skip, delete-always-applies — since the local-only
decision logic is unit-testable without mocking Supabase, but the actual
batched-fetch/network path is not, matching this file's existing
(unwritten) testing boundary rather than introducing a new mocking
pattern for this one fix.

**Verified**: `npm run check`/`npm run build` green. CI's initial deploy
for this phase failed on the pre-existing flaky `shadowPage.test.tsx`
delete-attempt test (documented in Phase 3/4 notes); a second, previously
undocumented flaky test (`ui.test.tsx`, a timing-based `waitFor`) also
surfaced across several `npm run check` runs today — both pass reliably
standalone, fail intermittently under the full suite, consistent with
test-isolation/ordering flakiness rather than a real regression (confirmed
by rerunning; CI's rerun of the same commit passed and deployed cleanly).
Worth a dedicated pass on full-suite test isolation at some point — not
done here, out of scope for this fix.

### New tool: backfill vocabulary suggestions for CSV-imported sentences

Prompted by live testing: a CSV-imported book ("Easy Japanese Drama: After
Work") renders a fully flat, chip-less `VocabularyPicker` — CSV imports
never populate `vocabularySuggestions` (`src/lib/csvImport.ts:268` sets it
to `[]`); only Shadowmine `.zip` package imports run a tokenizer
(`src/lib/shadowingImport.ts`). The real tokenizer (fugashi/UniDic) is
Python-only, in the separate `shadowing` repo — no in-app fix was possible
without either a new client-side JS tokenizer (rejected: different engine
than Shadowmine, several MB added to a ~1MB-precache PWA) or reusing the
trusted engine via a script (chosen).

Added:
- `scripts/tokenize_sentences.py` — thin bridge, JSON-in/JSON-out, calling
  `shadowmine.morphology.tokenize_japanese` (imported from a `shadowing`
  checkout, not copied — avoids a second, drifting tokenizer
  implementation). Owns no Supabase/selection logic.
- `scripts/backfill-vocabulary-suggestions.ts` — matches
  `import-wanikani-kanji.ts`/`import-anki-sentences.ts`'s conventions
  exactly (`createScriptSupabaseClient`, dry-run by default, `--apply` to
  write, printed counts). Reuses the existing, tested
  `suggestionsFromTokens()` for the `selectedByDefault`/POS-prefix decision
  — Python does only what JS can't. Idempotent by construction: only
  sentences with an empty `vocabularySuggestions` array are selected.
- `.github/workflows/backfill-vocabulary-suggestions.yml` —
  `workflow_dispatch`-only (checkbox input for `--apply` vs. dry run), no
  `push`/`schedule` trigger. Checks out both `jp_sentence_splits` and the
  public `efancher/shadowing` repo (plain checkout, no PAT needed) to reuse
  its tokenizer. Scoped with the user before building: explicitly not a
  cron/scheduled job (secrets in an unattended job, silent failures), but
  also not a "SSH into a machine" workflow — Actions `workflow_dispatch`
  (a button in the GitHub UI, or `gh workflow run`, from any browser) hits
  both constraints.
- `README.md` — new section: GitHub Actions path (preferred, no local
  setup) plus a local venv alternative (mirrors the `anki` repo's
  `.venv-headless` pattern). Also fixed a stale line claiming the
  suggestion-confirmation UI wasn't built yet (it has been, since Phase 5).

**Requires manual, one-time setup before the Actions path works**: the
user needs to add `SCRIPT_SUPABASE_EMAIL`/`SCRIPT_SUPABASE_PASSWORD` as
repo secrets (`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` already exist,
used by `deploy.yml`) — not done by this change, since it requires the
user's actual credential values; flagged explicitly rather than assumed.

**Code-reviewed** before commit; three real findings, two fixed: (1)
`TOKENIZE_SCRIPT_PATH` used `.pathname` instead of `fileURLToPath()` —
would leave percent-encoding (e.g. `%20`) in place for a repo checked out
under a path with spaces, breaking the subprocess call; fixed. (2) Python's
`tokenize_japanese` reports Unicode code-point offsets, but
`validateSpan()`/`.slice()` on the TS side operate on UTF-16 code units —
diverge for any sentence with an astral-plane character (e.g. 𠮟) before a
token, silently dropping every suggestion after it; fixed with a
`codePointToUtf16Offsets` conversion applied before
`suggestionsFromTokens()`. (3) This STATUS.md entry itself, added in
response to the review flagging that a materially new operational
capability wasn't documented.

**Verified**: `npm run typecheck` clean. Ran the full pipeline for real,
twice (before and after the two fixes above), via a local venv (`pip
install -e ../shadowing/cli`) against production: found 173 sentences with
empty `vocabularySuggestions`, tokenized and schema-validated all 173, 0
failures both times — including the exact sentence that prompted this
("同い年" now tokenizes as its own content-word token, lemma 同い年, reading
おないどし). Dry-run only — **not yet run with `--apply`**, and the GitHub
Actions workflow itself hasn't been triggered yet (blocked on the user
adding the two new repo secrets).

## Phase 6 — Anki interoperability cleanup: verified, `anki` archived

Scoped down from ROADMAP.md's original wording before acting: "archive
it" was a Phase 0 planning assumption. Session memory flagged that `anki`
was — as of that memory's last update — still being described as actively
used/extended day-to-day independent of this migration; surfaced that
conflict to the user directly rather than archiving on the ROADMAP text
alone. User confirmed: go ahead and archive, they're done using `anki`
independently now that Glossbook covers their needs.

Verification before archiving: `anki`'s git log has no commits since
2026-08-14 (`fedad55`/`8ea7164` — the same day the one-time export/import
tooling was built and run), and the last real content-development commit
(`dfca1e8`, "Enrich Shadowing candidates with JMDict...") predates that,
2026-08-06 — no Anki-side activity since the migration landed. Combined
with Phase 2's already-documented clean run (501 notes read, 0 skipped,
idempotency-verified re-running dry), there's nothing further to pull.
Anki review history remains a deliberate, accepted gap (confirmed by the
user in Phase 0, not migrated by design).

Archived `efancher/anki` on GitHub (`gh repo archive`) — read-only from
here on, not deleted, reversible via GitHub settings if ever needed.

## Phase 5 part 2: JMDict meaning backfill + retroactive materialization — done

Both gaps deferred at Phase 5 shipping time, tackled now per user request.

Added:
- `scripts/backfill-vocabulary-meanings.ts` — reuses `scripts/lib/jmdict.ts`
  unmodified (the existing local-only `npm run jmdict:lookup` tool) and is
  the first thing that actually writes JMDict results to Supabase: fills
  `vocabulary_items.meaning` (and `part_of_speech` if also blank) for items
  with no meaning yet. Pure TypeScript, no Python needed.
- `scripts/backfill-confirmed-vocabulary-links.ts` — retroactively
  materializes `vocabulary_items`/`sentence_vocabulary`/`kanji`/
  `vocabulary_kanji` for sentences confirmed via `VocabularyPicker` before
  Phase 5 shipped (materialization only fires from the confirm button going
  forward). Deliberately narrow: only sentences with zero existing
  `sentence_vocabulary` links — never reconciles or overwrites an
  already-materialized sentence. Mirrors `import-anki-sentences.ts`'s
  get-or-create shape for `vocabulary_items`, and Phase 5's own
  `ensureVocabularyItem` kanji-breakdown logic, reimplemented against
  Supabase directly (Node script, not the browser's Dexie).
- `scripts/lib/scriptHelpers.ts` (new) — `fetchAll`/`withoutVersionAndTimestamps`/
  `upsertBatched`/`parseApplyFlag`/`requireAuthedUser`, extracted out of
  `import-anki-sentences.ts` (which now imports them instead of defining
  its own copies) so this is the third script sharing one implementation,
  not a third copy.
- Two new `workflow_dispatch`-only GitHub Actions workflows (same rationale
  as the suggestions-backfill workflow: manual, logged, no SSH, no
  scheduled/unattended runs), neither needing the `shadowing` cross-repo
  checkout — both scripts are pure TypeScript.
- `README.md` — new sections for both, next to the existing backfill docs.

**Code-reviewed** (multi-angle pass) before commit; real findings, fixed:
(1) `fetchAll`'s `.range()` pagination had no `.order()`, so page
boundaries weren't guaranteed stable under concurrent writes (a row could
shift between an already-fetched page and the next, getting silently
skipped) — fixed by ordering on each table's real primary key, which
turned up a second, more serious near-miss while fixing it: `analyses` and
`inbox` have **no `id` column at all** (their primary keys are
`sentence_id`/`(owner_id, sentence_id)` respectively) — hardcoding
`.order('id')` would have broken both call sites outright; `fetchAll` now
takes the order column as a parameter (default `'id'`), with `inbox`'s and
`analyses`' call sites passing `'sentence_id'` explicitly. (2)
`vocabulary_kanji` links were only ever created for a vocabulary item
classified "new" in that run — a prior run crashing between the
`vocabulary_items` and `vocabulary_kanji` writes (network drop, process
killed) would leave that item permanently unlinked, since it's no longer
"new" on a later run; fixed by reconciling kanji links against a fetched
`vocabulary_kanji` snapshot for *every* item touched each run, not just
new ones. (3) `fetchBlankMeaningItems` and `upsertBatched` duplicated logic
`scriptHelpers.ts` was created in this very diff to share — both now reuse
the shared versions. (4) Minor efficiency: JMDict loading now runs
concurrently with the Supabase fetch (independent operations); the
`kanji`/`vocabulary_items` upserts (no ordering constraint between them,
only children depend on both) now run concurrently too.

**Known, accepted limitation, not fixed**: the confirmed-links backfill's
read snapshot isn't a single atomic transaction, so a live confirm for the
same word landing mid-run can independently mint a duplicate
`vocabulary_items` row, surfacing as a unique-constraint error on that
batch. This mirrors `import-anki-sentences.ts`'s existing, already-shipped
pattern (not a new risk introduced here) — deliberately not solved with
locking/retry machinery, since the workflow is manual/occasional (never
scheduled) and a failed run is safely re-runnable. Documented in the
script's own top comment. Similarly left as-is: the backfill's
`normalizeExpressionKey`-based dedup differs from the live browser path's
exact-string dedup — matches `import-anki-sentences.ts`'s existing
convention (arguably more correct, not less, since it catches NFC/
whitespace variants the live path's raw index misses) rather than a
regression.

**Verified**: `npm run typecheck`/`vitest run` green (221 tests, 2
pre-existing skips). Both scripts dry-run against production, twice each
(before and after the code-review fixes, identical results both times):
meanings backfill found 31 blank-meaning items, matched 10 real JMDict
glosses (バイト → "part-time job", マジ → "serious", etc.), 21 had no match
(mostly proper nouns, expected). Confirmed-links backfill found 71
confirmed sentences total, only 1 not yet materialized — the rest were
already correctly materialized by today's own Phase 5 live testing.

**Run for real (2026-08-15)**, both via GitHub Actions `--apply` (user
triggered): meanings backfill updated 10 items; confirmed-links backfill
materialized the 1 pending sentence. No errors, matched the dry-run counts
exactly.

### Follow-up fix: HTML-entity-encoded vocabulary meanings

Found live by the user immediately after the meanings backfill, browsing
`/vocabulary`: でしょ's meaning rendered as `don&#x27;t you agree?...`
instead of `don't you agree?...`. Root cause predates today entirely —
`scripts/lib/ankiImport.ts`'s `vocabularyMeaning()` (reads Anki's
`WkMeaning`/`HintGlossary` fields, which Anki stores as HTML) never
decoded HTML entities, unlike every other free-text field in that file
(`Expression`/`Reading`/`Translation`), which already went through
`displayJapanese` (`src/lib/normalize.ts`, entity-decoding + tag-stripping
already built and tested). Not caused by today's JMDict backfill — verified
でしょ wasn't even among the 10 items that backfill touched.

Fixed `vocabularyMeaning()` to use `displayJapanese` like every other field
in that file. Checked production directly before deciding scope: 6 of 334
`vocabulary_items.meaning` rows affected; `sentences.target_vocabulary[].english`
is populated by the same function (so equally exposed to the bug in
principle) but checking all 206 sentences / 571 targetVocabulary entries
found 0 actually-affected rows — nothing to correct there, not because a
different code path protected it.

Added `scripts/fix-html-entity-meanings.ts` — one-time correction, not a
recurring backfill (no GitHub Actions workflow; the bug is fixed at the
source, this only corrects historical data). Dry-run/`--apply`, same
conventions as the other scripts. Added a regression test to
`tests/ankiImport.test.ts` for entity decoding.

**Verified**: dry-run and real `--apply` run against production, found and
fixed exactly the 6 known-affected rows, 0 errors.

### Test-suite flakiness fix

Three different tests (`shadowPage.test.tsx` ×2, `ui.test.tsx`) had each
failed CI at least once earlier today, always passing standalone — noted
as a known issue, then investigated properly at the user's request.
Reproduced locally at a ~35% full-suite failure rate (vs. 0% standalone or
in small subsets), enough to iterate on directly rather than guess.

Two distinct, unrelated root causes found and fixed:

1. **Deterministic Blob corruption** (`shadowPage.test.tsx`, the more
   severe one — a hard `TypeError`, not a timeout). `fake-indexeddb`
   clones every value on insertion via the *global* `structuredClone()`
   (its own `cloneValueForInsertion` source), which is Node's
   implementation — but jsdom ships its own distinct `Blob` class, and
   verified directly (`structuredClone(new Blob(['x'])) instanceof Blob`
   → `false`, deterministically, no test framework involved) that Node's
   `structuredClone` doesn't recognize it, silently degrading the clone to
   a plain object. Any Blob field read back after a Dexie round-trip in
   this test environment loses its prototype — never happens in a real
   browser. `shadowPage.test.tsx` already knew about this (its own
   comment) and worked around it with a per-test
   `Object.defineProperty`-in-`beforeEach`/`delete`-in-`afterEach` mock of
   `URL.createObjectURL`/`revokeObjectURL` — but that pattern raced
   against the global setup file's own `afterEach` across nested hook
   ordering, explaining the intermittency. Replaced with a permanent,
   global patch in `src/test/setup.ts`: delegate to the real
   implementation for genuine Blobs, fall back to a stable fake URL
   otherwise. Removed the now-redundant per-file mock/unmock.
2. **A real race in `tests/ui.test.tsx`** (a `waitFor` timeout, not a hard
   error — but raising the timeout alone didn't fix it, confirming it
   wasn't purely a CPU-margin issue). The test clicked Next then
   immediately Previous with no wait in between; navigating to sentence B
   loads its chunks/notes into state, which is itself a `value` change for
   `useAutosave`, scheduling a debounced (redundant, self-)save — clicking
   Previous immediately left that timer still pending while navigating
   back to sentence A. Fixed in the test only (not production autosave/
   navigation code, which wasn't touched, given the mechanism wasn't
   proven with full certainty): wait for the post-Next autosave cycle to
   settle before clicking Previous.

Also, while investigating: found and fixed a real (if minor, previously
undiscovered) resource-leak bug in the global `afterEach`
(`src/test/setup.ts`) — it created and deleted an unrelated, freshly
random-named throwaway database instead of closing the one the test
actually used, which left the real one open until the *next* test's
`beforeEach` implicitly closed it. Fixed to close+delete the actual
just-used db directly; added `hasDbInstanceForTests()`/
`clearDbInstanceForTests()` to `src/db/database.ts` so this also skips
entirely for tests that never touch the db (most of `tests/tts.test.ts`,
etc.) and leaves a valid fresh instance behind for any test that calls
`getDb()` without its own `resetDbForTests()`.

**Code-reviewed** (two passes) before commit; real findings, both
addressed: the settle-tick before closing the db is a heuristic, not a
guarantee (documented as such, not oversold); `asyncUtilTimeout` was
dialed back from an initial 5000ms to 3000ms, since the real fix for the
worst offender was closing the actual race in the test, not just waiting
longer — a large global timeout mostly just makes a genuinely broken
assertion elsewhere take longer to fail.

**Verified empirically**: 35 consecutive full-suite runs, 0 failures
(previously ~35% failure rate reproduced over the same sample size before
these fixes).

### New tool: backfill JMDict glosses onto vocabulary suggestions

Found manually testing Phase 5: a CSV-imported lyrics book (GLIM SPANKY -
「怒りをくれよ」, no translation column in the source) has no sentence
translation and no Anki-sourced `target_vocabulary` — expected, not a bug
(confirmed `sentence.translation` has no edit UI anywhere in the app). But
its `vocabularySuggestions` (from today's tokenize backfill) never carried
an English gloss — fugashi only produces surface/reading/POS.

Turned out the domain model already anticipated this:
`VocabularySuggestion.english` (`src/lib/vocabularySuggestions.ts`) is an
existing, previously-always-empty optional field, and
`selectionFromSuggestion` already copies it into the resulting
`VocabularySelection.english` the moment a user taps a suggestion — which
is exactly what pre-fills `VocabularyPicker`'s "Meaning (optional)" field
and, downstream, `ensureVocabularyItem`'s initial meaning on confirm. That
whole pipeline already existed; the only missing piece was actually
populating `.english`. **No UI changes needed.**

Added `scripts/backfill-vocabulary-suggestion-glosses.ts` — mirrors
`backfill-vocabulary-meanings.ts` closely (same JMDict reuse, same
scriptHelpers reuse) but operates on `sentences.vocabulary_suggestions`
(a jsonb array) instead of `vocabulary_items.meaning` (a scalar). Scoped to
`selectedByDefault: true` (content-word) suggestions only — particles/
punctuation are skipped, matching this codebase's own existing definition
of "worth studying." Complementary to (not a replacement for) the meanings
backfill: that one fixes already-confirmed items retroactively; this one
improves the picker's UX for future confirms by pre-filling the gloss
before the word is even tapped. `.github/workflows/backfill-vocabulary-
suggestion-glosses.yml`, same `workflow_dispatch`-only pattern as the other
three backfills.

**Code-reviewed**: no findings.

**Verified**: `npm run check` green. Dry-run against production found the
exact motivating case (鈍感→"thickheaded", ほら→"look!", 調子→"tune",
乗る→"to get on" — all four content words from the GLIM SPANKY sentence
that started this) plus 200 sentences total, 773 suggestions matched, 235
had no JMDict match (retried harmlessly next run).

## Phase 7.1 — Evidence-model foundation: done

Sub-phasing of the "Phase 7 — Adaptive learning" roadmap line, following a
detailed comparison of the user's Japanese-review-system design brief
against this codebase (see the plan discussion; not itself checked in as a
doc). Key finding from that inspection: most of the brief's requested
architecture — sentence-centric learning, shared/deduped vocabulary
entities, an append-only evidence log separate from derived state,
extensible per-dimension study items (`StudyItem.subjectType` already
includes `'vocabularyItem'`, `activityType` is already a free string) —
already exists from Phases 1–5. This pass is purely additive schema +
repository primitives for the two pieces that didn't exist at all yet
(assistance/natural-encounter evidence tracking, confusion/interference
pairs), with **no UI changes** — `ReviewPage.tsx`'s two live activity types
keep working exactly as before.

Added:
- `Review`: three new optional fields — `assistance?: ReviewAssistance[]`
  (furigana_shown/translation_shown/mnemonic_shown/audio_replayed/
  chunks_shown/hint_shown/multiple_choice), `source?: 'scheduled_review' |
  'natural_encounter'` (absent = scheduled, the only kind recorded today),
  `contextSentenceId?: string` (the sentence the evidence actually came
  from, which may differ from a study item's originally-seeded sentence).
  Nothing populates these yet — schema-first, matching how
  `errorClassification` was left unpopulated when it was added in Phase 4.
- New table **`vocabulary_confusions`** (`src/domain/types.ts`) — an
  undirected pair of vocabulary items the learner tends to confuse
  (`itemAId`/`itemBId`, canonicalized `itemAId < itemBId` so a pair can
  never be stored twice in both directions — enforced both in
  `src/db/repository.ts` and as a Postgres check constraint),
  `confusionType` (reading/kanji/meaning/transitivity/synonym/grammar/
  other), `observedCount`, `lastObservedAt`, optional `notes`.
- `src/db/repository.ts` — `ensureVocabularyConfusion`/
  `recordConfusionObservation` (get-or-create / increment, mirroring
  `ensureVocabularyItem`/`ensureKanji`'s shape exactly, including their
  same known, accepted, unlocked read-then-write race under concurrent
  calls); `ensureVocabularyStudyItem` (thin wrapper making
  `StudyItem.subjectType: 'vocabularyItem'` actually usable — the
  capability existed since Phase 1 but had no caller); and
  `pickContextSentenceForVocabularyItem` (most-recently-linked sentence for
  a vocabulary item, via `sentence_vocabulary` — needed by any future
  vocabulary-level review UI, useful and testable standalone today).
- `src/lib/maturity.ts` — `computeContextDiversity`/`computeMaturityLevel`,
  pure functions (no Dexie coupling) implementing the brief's
  fragile → established → generalized → mature ladder. Diversity counting
  is scoped to what the schema can actually answer today: a sentence's
  "source" is the sourceKey (or id) of any `Book` containing it, since
  `Sentence` has no direct link to the `sources` table yet (that table
  still has no writer — a pre-existing, documented gap from Phase 1, not
  something this pass changes). Thresholds are a starting heuristic
  (documented in the file), not derived from a model — matches the brief's
  explicit warning against over-engineered precision here.
- Dexie schema v8 (`vocabularyConfusions` store, indexed on
  `[itemAId+itemBId]`) and a matching Postgres migration
  (`supabase/migrations/20260815000000_review_evidence_foundation.sql`):
  the `vocabulary_confusions` table (RLS via the existing
  `sync_private.owns_vocabulary_item` helper on both `item_a_id`/
  `item_b_id`, same cross-reference-ownership pattern as
  `sentence_vocabulary`/`vocabulary_kanji`) plus three new nullable columns
  on `reviews`. `context_sentence_id` uses `on delete set null` (not
  cascade), so a sentence deletion never removes review evidence.
- Sync wiring for `vocabulary_confusions` (`src/sync/mappers.ts`,
  `SyncEntity` in `src/sync/types.ts`, push/pull/first-login-upload/
  replace-with-cloud in `src/sync/engine.ts`) — mirrors exactly how
  `study_items`/`reviews` got wired in Phase 4. `reviews`' three new fields
  needed no new sync-entity wiring, just extending the existing
  `reviewToRemote`/`remoteToReview` mappers.
- Tests: `tests/migration.test.ts` (schema v8 round-trip, both the new
  table and the new `reviews` fields), `tests/maturity.test.ts` (pure
  function coverage for both the diversity counter and the maturity
  ladder), and a new `describe` block in `tests/data.test.ts` covering
  `ensureVocabularyStudyItem`, `pickContextSentenceForVocabularyItem`, and
  confusion-pair canonicalization/increment/sync-enqueue.

**Deliberately not done yet** (this is schema + repository primitives only,
per the user's explicit "don't implement everything simultaneously"
instruction):
- No review-experience UI differentiation, no session planner, no
  confusion-detection heuristics (manual/future data only — same
  "don't overbuild automatic classification yet" precedent as Phase 4's
  `errorClassification`), no conjugation/transformation engine, no
  natural-encounter capture UI, no debug/inspector view. `ReviewPage.tsx`
  is untouched.
- `vocabulary_confusions` is not added to `backupSchema`/
  `buildBackupPayload`/`src/lib/backup.ts` — no UI writes to it yet, same
  reasoning Phase 1 used to defer `sources`' backup coverage until it had a
  real writer. Add it alongside whatever UI first writes confusion rows
  (planned for Phase 7.4).
- `docs/UNIFIED_APP_ARCHITECTURE.md` §15's phase list is not renumbered;
  this and the following sub-phases (7.2–7.6, see `docs/ROADMAP.md`) are
  tracked as a detailed sub-phasing of its existing "Phase 7 — Adaptive
  learning" line rather than a rewrite of that document.

**Confirmed during the comparison that informed this phase** (inspecting
the archived `~/projects/anki` repo, since the brief specifically asked
whether its confusable/leech/verb-pair/mnemonic/conjugation data should be
reused rather than re-derived): `kanji_contrast_groups.json` (17 curated
kanji-confusion groups) and `wk_decks.py`'s `find_verb_pairs()` (a
suffix-swap algorithm, e.g. `("れる","す")`, that pairs transitive/
intransitive verbs by reading — a direct algorithmic fit for seeding
`vocabulary_confusions` rows of type `transitivity`, planned for Phase 7.4)
are real, reusable, not-yet-ported assets. `wk_decks.py::conjugate_vocab_form()`
(86 tested fixture rows, godan/ichidan/suru/irregular/i-adjective/
na-adjective, most common forms except volitional/たい) is a mature engine
worth porting for Phase 7.6's sentence transformations. None of this has
been ported into this repo yet — confirmed by grep, not assumed.

**Verified**: `npm run check` (typecheck + full vitest suite) green — 240
tests passed (up from 221), 2 pre-existing skips (unrelated), 0 existing
test modified. `npm run build` green.

**Applied to the live Supabase project (2026-08-15)**, via Dashboard SQL
editor paste, same as every prior migration in this repo's history.

**Note found while working, unrelated to this phase**: the working tree
already had uncommitted changes before this session started —
`scripts/refresh-unreviewed-vocabulary-selections.ts`, a matching
`.github/workflows/` file, and a `package.json` script entry — not created
by this pass and not touched by it. Left as-is (not staged, not reverted);
flagged here so it isn't mistaken for part of Phase 7.1 or silently lost.

## Phase 7.2 — Reading retrieval review experience: done

First real differentiated review experience (docs brief §5B/§6), and the
first real consumer of Phase 7.1's `vocabularyItem`-subject study items.
Scoped to exactly one new experience (not cloze/audio/production too),
matching the user's own stated priority order (reading retrieval ranked
directly after contextual comprehension) and the explicit "don't do it all
at once" instruction.

**Prerequisite data gap found while planning**: highlighting a specific
vocabulary occurrence in a displayed sentence needs its exact conjugated
surface text (e.g. a sentence contains 表れていた, not the dictionary form
表れる) — `sentence_vocabulary` didn't store this, only `sentenceId`/
`vocabularyItemId`/`chunkId?`. `VocabularySelection.surface`
(`src/lib/vocabularySuggestions.ts`) already computed and validated exactly
this (`validateSpan` guarantees `japanese.slice(start,end) === surface` at
confirm time) — it was just discarded when `materializeVocabularySelections`
wrote the `SentenceVocabulary` row.

Added:
- `SentenceVocabulary.surfaceForm?: string` (`src/domain/types.ts`,
  `schemas.ts`) — additive field, no Dexie version bump needed (unindexed
  field on an existing store, same precedent as `FsrsState.learningSteps`
  in Phase 4). Postgres: nullable `sentence_vocabulary.surface_form text`
  (`supabase/migrations/20260816000000_sentence_vocabulary_surface_form.sql`).
  `src/sync/mappers.ts`'s existing `sentenceVocabularyToRemote`/
  `remoteToSentenceVocabulary` extended for it — no new `SyncEntity`, the
  table was already wired since Phase 5.
- `src/db/repository.ts` — `materializeVocabularySelections` now passes
  `selection.surface` through to newly-created `SentenceVocabulary` rows
  (first selection's surface wins if duplicates collapse onto one
  vocabulary item). Existing links are not backfilled/updated — no
  backfill script in this pass, same "don't backfill until there's a
  proven need" call as Phase 5's original scoping; links created before
  this change (or via the one-time Anki import, which doesn't go through
  the picker) simply aren't reading-retrieval-eligible yet.
- `pickContextSentenceForVocabularyItem` (Phase 7.1) changed return shape
  from `Sentence | undefined` to `{ sentence: Sentence; surfaceForm?:
  string } | undefined` — the one real consumer (this phase) needs the
  specific link's surface form for the sentence it picked, not just the
  sentence; updated its existing test.
- New `getReadingRetrievalCandidates(sentenceIds)` — vocabulary items
  (restricted to sentences in scope) with a `surfaceForm`-bearing link, one
  candidate per distinct vocabulary item (first qualifying link), not one
  per sentence×word pair — this is what seeds/backs the new activity type,
  and what keeps it naturally bounded by vocabulary size rather than
  sentence count.
- `src/pages/ReviewPage.tsx` — added `'reading_retrieval'` as a second,
  vocabulary-item-subject activity type alongside the two existing
  sentence-subject ones (`comprehension`, `reading_in_context`). Required
  generalizing what was previously sentence-subject-only logic throughout
  the page: `QueueCard` gained an optional `target: { vocabularyItem,
  surfaceForm }`; the pending-seed pool is now a discriminated union
  (`kind: 'sentence' | 'vocabulary'`) so the lazy per-batch seeding effect
  can seed either kind; the due-queue fetch calls `getDueStudyItems` twice
  (sentence-subject types over sentence ids, `reading_retrieval` over
  vocabulary-item ids) and merges/sorts the results together by
  `fsrsState.due`, so both kinds interleave in one queue exactly like the
  brief's "one unified session, not six mandatory cards" principle (§14).
  Render: a new `ReadingRetrievalCard` shows the sentence with the target
  `surfaceForm` substring highlighted (`<mark>`, exact match — `surfaceForm`
  is captured directly from that sentence's text, so `indexOf` is
  guaranteed to find it) and the reading hidden; "Reveal reading" shows the
  vocabulary item's reading + meaning; then the existing 4-way self-rate,
  shared across both card types.
- Tests: `tests/data.test.ts` — updated `pickContextSentenceForVocabularyItem`
  test for the new return shape, new coverage for `materializeVocabularySelections`
  surface capture and `getReadingRetrievalCandidates` (surfaceForm-present
  vs. absent, one-per-vocabulary-item dedup, empty input). `tests/reviewPage.test.tsx`
  — new end-to-end test seeding a reading_retrieval study item, rendering
  the highlighted card, revealing, rating, and confirming the review was
  recorded — alongside the five pre-existing tests, all still passing
  unmodified.

**Deliberately not done yet** (per the phased plan, moved to Phase 7.3):
contextual cloze, audio comprehension, mnemonic maturity-gating,
`comprehension`/`reading_in_context` differentiation (still the same open
gap from Phase 4), any assistance-flag recording (no optional-help
affordance exists yet for any card type — the reveal step in every review
type so far *is* the exercise, not optional help beyond it), review
planner. No typed input for reading retrieval either — reveal + self-rate,
matching the brief's "keep reviews fast" preference and the existing two
activity types' pattern; typed retrieval is a production-ladder concern
(brief §12), not reading retrieval.

**Verified**: `npm run check` (typecheck + full vitest suite) green — 245
tests passed (up from 240), 2 pre-existing skips (unrelated), 0 existing
test behavior changed. `npm run build` green.

**Applied to the live Supabase project (2026-08-16)**, via Dashboard SQL
editor paste, same as every prior migration.

**Not yet manually verified in a real browser** — this pass covered
logic/component tests only, same caveat Phase 3/4/5 initially shipped
with. Manual check: confirm vocabulary on a sentence via the picker
(produces a `surfaceForm`-bearing link), then visit `/review` and confirm a
reading-retrieval card appears for that word with the correct substring
highlighted and the correct reading on reveal.

## Phase 7.3 — Contextual cloze review experience: done

Scoped to exactly one new experience (not cloze + audio comprehension +
mnemonic gating all at once, which the original phase list bundled) —
matches how Phase 7.2 was itself narrowed from a four-experience bundle
down to one, and the user's own "don't do it all at once" instruction.
Chosen first of the three because it reuses Phase 7.2's infrastructure
almost directly: cloze needs exactly the same eligibility condition as
reading retrieval (a `surfaceForm`-bearing vocabulary link), just renders
the target differently (blanked, not highlighted-with-hidden-reading).

Added:
- `src/db/repository.ts` — renamed `getReadingRetrievalCandidates`/
  `ReadingRetrievalCandidate` to `getVocabularyTargetCandidates`/
  `VocabularyTargetCandidate`, since the function now backs two activity
  types, not one; behavior unchanged, only the name (and its tests) needed
  updating — same kind of iterate-on-a-signature-once-a-second-consumer-
  exists precedent as `pickContextSentenceForVocabularyItem`'s Phase 7.2
  change.
- `src/pages/ReviewPage.tsx` — `VOCABULARY_ACTIVITY_TYPES` now includes
  `'cloze'` alongside `'reading_retrieval'`; both are seeded per eligible
  vocabulary item (so a word gets two independent, independently-FSRS-
  scheduled study items, one per dimension) — mirrors the existing
  precedent of `comprehension`/`reading_in_context` both being seeded for
  every sentence, not a new pattern. Render: `ReadingRetrievalCard` was
  generalized into `VocabularyTargetCard(activityType, ...)`, shared by
  both card types — `reading_retrieval` shows the target word highlighted
  and hides the reading; `cloze` blanks the target word entirely (`_____`)
  and reveals both the word and its reading together, a harder recall step
  since there's no visible word to anchor against.
- Tests: `tests/data.test.ts` renamed along with the function (no behavior
  changes to verify beyond the rename). `tests/reviewPage.test.tsx` — the
  Phase 7.2 test was extended (not duplicated) to also drive the cloze card
  through blank → reveal → rate for the same target word, confirming both
  study items seed independently and both reviews get recorded.

**Deliberately not done yet** (moved to Phase 7.4): audio comprehension,
mnemonic maturity-gating, `comprehension`/`reading_in_context`
differentiation (still the same open Phase-4 gap), any assistance-flag
recording (still no optional-help affordance on any card type — cloze's
reveal step is the exercise itself, not optional help), review planner. No
typed input for cloze either, same "keep reviews fast" rationale as reading
retrieval.

**Verified**: `npm run check` (typecheck + full vitest suite) green — 245
tests passed (same total as Phase 7.2 — one existing test extended, not a
new file added), 2 pre-existing skips (unrelated), 0 existing test
behavior changed beyond the deliberate reading_retrieval-test extension.
`npm run build` green.

No schema/migration changes in this phase — cloze reuses
`SentenceVocabulary.surfaceForm` and the existing `vocabulary_items` fields
as-is.

**Not yet manually verified in a real browser** — same caveat as every
prior UI-facing phase.

## Phase 7.4 — Audio comprehension review experience: done

Narrowed further from the original "Phase 7.4 — audio comprehension,
mnemonic gating, assistance tracking" bundle down to audio comprehension
alone, continuing the one-experience-per-pass discipline established in
7.2/7.3. Mnemonic gating and assistance tracking move to a follow-up
(7.5) — assistance tracking specifically needs a real optional-help
affordance to attach to, and audio replay-after-reveal is a natural first
one, but that's still future work, not this pass.

Added:
- `src/pages/ReviewPage.tsx` — new `AUDIO_ACTIVITY_TYPES = ['listening']`,
  a third independently-seeded activity-type category alongside the
  existing unconditional sentence types (`comprehension`,
  `reading_in_context`) and the vocabulary-target types
  (`reading_retrieval`, `cloze`). Unlike those, `listening` is
  sentence-subject but *conditionally* eligible — only for sentences with
  at least one `SentenceAudio` row, mirroring how vocabulary-target types
  are conditional on a `surfaceForm`-bearing link. `PendingSeed` gained a
  third `kind: 'listening'` variant; the due-queue fetch now does three
  parallel `getDueStudyItems` calls (sentence/vocabulary/audio) merged and
  sorted together, same pattern as 7.2/7.3 established for two.
  `QueueCard` gained an optional `audio?: SentenceAudio` field. New
  `AudioComprehensionCard`: plays the reference audio via the existing
  `NativeAudioButton` (`src/components/NativeAudioButton.tsx`, already
  built for `PracticePage`/`ShadowPage`, no changes needed) with the
  Japanese text, translation, and vocab chips all hidden until reveal —
  the audio button itself stays visible/replayable both before and after
  reveal, matching the brief's §5D flow (play → self-check → reveal →
  replay allowed → normal analysis).
- Audio-per-sentence lookup is a direct `db.sentenceAudio.where('sentenceId').anyOf(...)`
  query inside `ReviewPage`'s own `scope`, not a new repository function —
  matches the existing precedent of `PracticePage` querying
  `sentenceAudio` directly rather than through a wrapper. Picks the first
  available recording per sentence; **does not** replicate `PracticePage`'s
  book-sourceKey audio-preference matching (deliberately scoped down — flag
  if this turns out to matter in practice, since `/review`'s global mode
  has no single book to prefer against anyway).
- Tests: `tests/reviewPage.test.tsx` — two new tests: a sentence with
  `SentenceAudio` seeds and renders a listening card (Japanese hidden
  pre-reveal, shown + rated after), and a sentence with no `SentenceAudio`
  never gets one (study item count stays at the baseline two).

**Deliberately not done yet** (moved to Phase 7.5): mnemonic
(`VocabularyItem.notes`) maturity-gating on the vocabulary-target cards
using `computeMaturityLevel` (Phase 7.1); any assistance-flag recording;
`comprehension`/`reading_in_context` differentiation (still the same open
Phase-4 gap).

**Worth flagging for whoever picks up Phase 7.8 (session planner)**: this
phase is the third independently-seeded/due-fetched activity-type category
hand-duplicated in `ReviewPage.tsx` (unconditional-sentence /
vocabulary-target / conditional-sentence-with-audio). Still tractable at
three, but a fourth would be a good trigger to generalize this into a real
"activity descriptor" abstraction (eligibility predicate + seed function +
render function per activity type) rather than continuing to copy the
pattern by hand — noted here rather than pre-building an abstraction this
phase doesn't need yet.

**Verified**: `npm run check` (typecheck + full vitest suite) green — 247
tests passed (up from 245), 2 pre-existing skips (unrelated), 0 existing
test behavior changed. `npm run build` green.

No schema/migration changes — `listening` reuses the existing
`SentenceAudio` table and `NativeAudioButton` component as-is.

**Not yet manually verified in a real browser** — same caveat as every
prior UI-facing phase.

## Phase 7.5 — Mnemonic gating & assistance tracking: done

The last piece of the original "Phase 7.4" bundle, now that 7.4 shipped a
real optional-help affordance (audio replay) for assistance to attach to.
Two related but separable changes, shipped together since both are small
refinements to already-existing cards rather than new review experiences.

Added:
- `src/db/repository.ts` — `computeVocabularyContextDiversity(vocabularyItemId)`:
  the Dexie-querying half of maturity computation (fetches
  `sentence_vocabulary` → distinct sentence ids → `book_sentences` →
  distinct book ids → `books`, builds the `sourceKeysBySentenceId` map
  `src/lib/maturity.ts`'s pure `computeContextDiversity` needs), kept
  separate from that pure ladder logic per Phase 7.1's original design.
- `src/pages/ReviewPage.tsx` — on a vocabulary-target card
  (`reading_retrieval`/`cloze`), a new effect computes the word's maturity
  (`computeVocabularyContextDiversity` + `computeMaturityLevel`, using the
  *current card's own* `fsrsState` for the "long-interval success"
  evidence, not an aggregate across dimensions — per-dimension memory
  strength decides its own scaffolding, matching brief §4's philosophy).
  If `fragile`, `VocabularyItem.notes` (the mnemonic) auto-shows; otherwise
  it's still available behind a "Show mnemonic" button. Wrapped in
  try/catch (a soft, best-effort UI enhancement — if the query fails
  because the page unmounted mid-query, there's nothing to recover, and an
  uncaught rejection there was actually causing test-suite noise, caught
  and fixed during this pass, see below).
- `recordReview` (`src/db/repository.ts`) gained an optional `assistance?:
  ReviewAssistance[]` parameter, now actually populated — the first writer
  of the field Phase 7.1 reserved on `Review`.
- `src/components/NativeAudioButton.tsx` — new optional `onPlay?: () =>
  void` prop, called each time playback actually starts (not on stop).
  Additive, backward-compatible — `PracticePage`/`ShadowPage` (its other
  callers) are unaffected since they don't pass it.
- `ReviewPage`'s new `assistanceUsed` state (a `Set<ReviewAssistance>`,
  reset per card) accumulates flags from two sources so far: opening the
  mnemonic (`mnemonic_shown`) and replaying audio on a listening card
  after the first play (`audio_replayed` — the *first* play is the
  exercise itself, not assistance, tracked via a `playCountRef` in the new
  `AudioComprehensionCard` replay handler). Passed to `recordReview` on
  rate; omitted (not an empty array) when nothing was used, so the vast
  majority of reviews stay exactly as compact as before.
- Tests: `tests/data.test.ts` — `computeVocabularyContextDiversity`
  coverage (no links, single-source, two-distinct-sources). `tests/reviewPage.test.tsx`
  — mnemonic auto-show (fragile) vs. button-gated (multi-source,
  non-fragile) with `mnemonic_shown` assistance recorded on open; audio
  replay recording `audio_replayed` only on a genuine second play, not the
  first (using a `MockAudio` fake, mirroring `tests/nativeAudio.test.ts`'s
  own pattern, since real jsdom `HTMLMediaElement` playback isn't
  reliable) — plus a new shared `nativeAudioController.stop()` reset in
  this test file's `afterEach`, needed once a test actually started real
  (mocked) playback: the controller is a module-level singleton, and a
  "still playing" state was leaking from one test into the next.

**Real bug found and fixed during this pass, not present before it**: the
mnemonic-maturity effect's async IIFE had no error handling — in the test
suite, unmounting the page mid-query (between tests) turned a routine
`DatabaseClosedError` into an unhandled promise rejection. Fixed with a
try/catch around the query (documented above); flagging here since it's
exactly the class of async-effect-vs-teardown race the Phase 6
test-flakiness fix already dealt with once for a different effect — this
is a second, independent instance, not a regression of that fix.

**Deliberately not done yet**: `comprehension`/`reading_in_context`
differentiation (still the same open Phase-4 gap); no other assistance
flags (`furigana_shown`, `translation_shown`, `chunks_shown`,
`hint_shown`, `multiple_choice` all remain schema-reserved, unpopulated —
no card has an affordance for them yet).

**Verified**: `npm run check` (typecheck + full vitest suite) green — 254
tests passed (up from 247), 2 pre-existing skips (unrelated), 0 existing
test behavior changed. `npm run build` green.

No schema/migration changes — reuses `Review.assistance` (reserved since
Phase 7.1) and `VocabularyItem.notes` (existing field) as-is.

**Not yet manually verified in a real browser** — same caveat as every
prior UI-facing phase.

## Phase 7.6 — Interference detection foundation: done

Split further from the roadmap's original bundled "interference/contrastive
review" phase, same discipline as every prior split this effort has used:
this pass is data/schema only (mirrors Phase 7.1's own "foundation first,
no UI" shape) — the contrastive review *experience* itself moves to Phase
7.7, once real confusion data actually exists to review against.

**Algorithm port**: `anki/wk_decks.py` (archived repo, still readable
locally at `~/projects/anki`) lines 599–619 (`PAIR_RULES`,
`CURATED_READING_PAIRS`) and 2596–2610/5731 (`is_probably_verb`,
`candidate_pair_from_reading`, `find_verb_pairs`) — a suffix-swap table
(e.g. `("れる","す")`, matching 表れる/表す) plus 8 curated exceptions
(あく/あける, etc.), applied to vocabulary sharing a derived reading pair.

Added:
- `scripts/lib/verbPairs.ts` — pure port (`isProbablyVerb`,
  `candidatePairFromReading`, `findVerbPairs`), no Supabase/IO, mirroring
  `scripts/lib/wanikani.ts`/`scripts/lib/jmdict.ts`'s existing "pure lib
  module, thin script wrapper" convention. `tests/verbPairs.test.ts` (13
  tests) covers it directly, independent of any database.
- `scripts/backfill-verb-pair-confusions.ts` — same shape as
  `scripts/backfill-vocabulary-meanings.ts` (dry-run default, `--apply` to
  write, `createScriptSupabaseClient`/`fetchAll`/`parseApplyFlag`/
  `requireAuthedUser`). Fetches all `vocabulary_items`, runs
  `findVerbPairs`, canonicalizes each pair's ids the same way
  `ensureVocabularyConfusion` does, fetches existing `vocabulary_confusions`
  pairs to dedupe against, and **inserts** (not upserts —
  `vocabulary_confusions_pair_uidx` is a partial unique index, the same
  `ON CONFLICT` limitation already hit and fixed for the kanji importer in
  Phase 2) only genuinely new pairs, `confusionType: 'transitivity'`.
- `scripts/lib/scriptHelpers.ts` — new `insertBatched`, an insert-only
  sibling to the existing `upsertBatched`, for tables like this one where
  the natural key is only a partial unique index.
- `package.json` (`backfill:verb-pair-confusions`),
  `.github/workflows/backfill-verb-pair-confusions.yml`
  (`workflow_dispatch`-only, same template as the other four backfill
  workflows), `README.md` — new section, same conventions as every other
  backfill script.
- `StudySubjectType` (`src/domain/types.ts`, `studySubjectTypeSchema` in
  `schemas.ts`) extended with `'vocabularyConfusion'` — reserved ahead of
  its first real consumer (Phase 7.7), same precedent as `'vocabularyItem'`
  being reserved in Phase 1 before Phase 7.2 became its first consumer.
  New migration (`supabase/migrations/20260816010000_study_item_vocabulary_confusion_subject.sql`)
  drops and re-adds `study_items`' `subject_type` check constraint to widen
  it — the only real schema change this phase needed; Dexie itself needs
  no version bump, since `studyItems.subjectType` isn't constrained at the
  Dexie layer, only Postgres enforces the enum. No code elsewhere had an
  exhaustive switch over `StudySubjectType` that this would break (checked
  by grep — every existing usage is an `=== 'sentence'`/`'vocabularyItem'`
  filter, not an exhaustiveness check).

**Real subtlety caught while writing the tests, not a bug in the original
Python** — worth flagging since it shaped the test suite: `is_probably_verb`
requires *either* a る-ending expression *or* an English "to ..." gloss in
the meaning; a reading alone matching a `PAIR_RULES` suffix (e.g. 大学's
だいがく ending in く, or だいがく-shaped readings generally) does **not**
make something a verb — `candidatePairFromReading` is a pure suffix
transform with no verb-awareness of its own, and relies entirely on
`findVerbPairs`'s upstream `isProbablyVerb` filter to avoid false positives
like pairing a noun. First test drafts got this wrong (used vocabulary
items with empty/no English meaning that don't end in る, so they were
silently filtered out before ever reaching the pairing logic) — fixed by
giving every non-る-ending test verb an English gloss containing a
recognized marker (`"to open (intransitive)"`, etc.), matching what a real
JMDict-sourced `meaning` field would actually contain.

**Deliberately not done yet** (moved to Phase 7.7): no contrastive review
UI, no manual confusion-entry UI, no automatic confusion detection from
review failures (`errorClassification` stays unpopulated, same
"don't overbuild automatic classification" call as every prior phase).
`ReviewPage.tsx` is untouched.

**Verified**: `npm run check` (typecheck + full vitest suite) green — 267
tests passed (up from 254), 2 pre-existing skips (unrelated), 0 existing
test behavior changed. `npm run build` green.

**Migration applied** (2026-08-16): `20260816010000_study_item_vocabulary_confusion_subject.sql`
pasted into the Dashboard SQL editor — `study_items.subject_type` now
accepts `'vocabularyConfusion'` in production.

**Backfill run against production** (2026-08-16): dry run via GitHub
Actions ("Backfill verb-pair confusions" → "Run workflow") found 4
candidate pairs, all correct transitive/intransitive readings — 付く/付ける,
変わる/変える, 見せる/見る, 出る/出す. Re-run with `apply: true`: all 4
inserted into `vocabulary_confusions`, 0 already present. Phase 7.6 is now
fully done end-to-end, migration included.

## Phase 7.7 — Contrastive pair review: done

The first consumer of Phase 7.6's `vocabulary_confusions` data, and the
last of the 7.x sub-phases split from the roadmap's original bundled
"interference/contrastive review" line. One StudyItem per confusion pair
(not per word), `subjectType: 'vocabularyConfusion'`, subjectId a
`VocabularyConfusion.id` — the evidence being scored is "can this learner
tell these two apart," which is distinct from either word's own recall
(already covered by reading_retrieval/cloze).

Added:
- `src/db/repository.ts` — `getConfusionPairCandidates(vocabularyTargetCandidates)`:
  a confusion pair is eligible only if *both* members are themselves
  vocabulary-target candidates (a surfaceForm-bearing sentence link within
  the current review scope) — reuses `getVocabularyTargetCandidates`'s
  output rather than re-querying, so a pair only shows up in a book's queue
  when both words actually appear there, and each member arrives with its
  own highlighted sentence for free.
- `src/pages/ReviewPage.tsx` — new `CONFUSION_ACTIVITY_TYPES = ['contrastive']`,
  wired into the scope query, due-queue merge, pending-seed pool, and
  seeding batch exactly like the three existing activity-type groups
  (sentence/vocabulary/audio). `QueueCard` gained an optional
  `confusionPair` field; `PendingSeed` a `'confusion'` kind.
- `ContrastivePairCard` (`src/pages/ReviewPage.tsx`): renders both
  confusable words together, each highlighted (not blanked — visible, same
  convention as reading_retrieval) in its own sentence. One shared "Reveal"
  shows both readings/meanings at once, so the learner has to hold both in
  mind and check for mix-ups, then rates the pair as a whole.
- `tests/reviewPage.test.tsx` — `suppressVocabularyActivityTypes` helper
  (mirrors `suppressUnconditionalSentenceActivityTypes`, for isolating the
  contrastive card in tests from its two members' own reading_retrieval/cloze
  cards) plus a new test seeding a real 付く/付ける pair across two
  sentences, verifying the seeded study item's subjectType/activityType,
  pre-reveal hiding of both readings, and post-reveal display of both
  readings and meanings together.

**Deliberately not done yet**: no explicit "which is which" quiz or typed
answer — just juxtaposition, matching every prior review experience's
minimal self-rate interaction; no manual confusion-pair entry UI; no
automatic confusion detection from review failures
(`errorClassification` stays unpopulated); no assistance flags specific to
this card type. `vocabulary_confusions` still isn't in `backupSchema`/
`buildBackupPayload` — this phase only *reads* existing confusion rows, it
doesn't write new ones, so the "add it alongside whatever UI first writes
confusion rows" gap noted in Phase 7.1 still stands.

**Verified**: `npm run check` (typecheck + full vitest suite) green — 268
tests passed (up from 267), 2 pre-existing skips (unrelated), 0 existing
test behavior changed. `npm run build` green.

**Not yet manually verified in a real browser** — same caveat as every
prior UI-facing phase; only 4 confusion pairs exist in production today
(the Phase 7.6 backfill's output), so a real check should confirm at least
one of them actually surfaces in a real book's review queue.

This completes the "Phase 7 — Adaptive learning" sub-phasing's originally
bundled 7.6/7.7 interference-review line (see docs/ROADMAP.md). Remaining
Phase 7 sub-phases: 7.8 (natural-encounter evidence), 7.9 (production
ladder/sentence transformations), 7.10 (session planner, graduation,
explainability, debug view).

## Phase 7.8 — Natural-encounter evidence: done

The first real writer of `Review.source`/`Review.contextSentenceId`
(reserved, unpopulated, since Phase 7.1). Distinguishes "I recognized this
word while just reading, not in a review session" from a scheduled-review
answer — both feed the same FSRS schedule, but as separate evidence.

Added:
- `src/db/repository.ts` — `recordReview`'s input gained optional `source?:
  ReviewSource` and `contextSentenceId?: string`, threaded straight into
  the `Review` it builds; no other behavior changed (both stay `undefined`
  for every existing caller, so a scheduled review is still recorded
  exactly as before). New `recordNaturalEncounter({ vocabularyItemId,
  sentenceId, rating })`: get-or-creates the word's `reading_retrieval`
  study item (the same one ReviewPage's reading_retrieval card would use)
  via the existing `ensureVocabularyStudyItem`, then calls `recordReview`
  with `source: 'natural_encounter'` and `contextSentenceId: sentenceId` —
  deliberately one fixed activity type, not a choice between
  reading_retrieval/cloze, to keep the opportunistic capture UI a single
  quick action rather than a menu.
- `src/pages/PracticePage.tsx` (the free-reading/practice flow, distinct
  from ReviewPage's queue): fetches `getVocabularyTargetCandidates([sentenceId])`
  for the sentence currently on screen (the same eligibility — a
  surfaceForm-bearing `sentence_vocabulary` link — reading_retrieval/cloze
  already use) and, when any exist, renders a "Recognized these without
  hints?" panel below the existing vocab chips. Each materialized word gets
  a `NaturalEncounterRow`: word + reading + meaning shown openly (no
  hide/reveal — the learner has already read the full sentence with
  translation available, so there's nothing to test, only to self-report)
  plus the same four-point rating buttons as everywhere else. Rating
  disables that row for the rest of the sentence visit (`encounteredVocabularyItemIds`,
  reset alongside the existing `reveal`/`attempt` state on sentence change)
  — one encounter recorded per visit, not per click; revisiting the word in
  a later sentence is a separate, legitimate encounter.
- Tests: `tests/data.test.ts` — `recordNaturalEncounter` creates/reuses the
  right study item and tags source/contextSentenceId correctly; a plain
  `recordReview` still leaves both fields undefined. New
  `tests/practicePage.test.tsx` (PracticePage had no test file before this
  phase) — panel absent with no materialized vocabulary; panel present,
  rating recorded, row disabled after rating, for a sentence with one
  materialized word.

**Deliberately not done yet**: no UI on PracticePage to *choose* which
study item/activity type an encounter counts toward (always
reading_retrieval); no natural-encounter capture from ShadowPage or
AnalyzePage, only PracticePage (the one page that's genuinely
free-reading rather than a structured exercise); no surfacing of
`source`/`contextSentenceId` anywhere in review history or a debug view
(planned for 7.10); no batching/undo for an accidental rating.

**Verified**: `npm run check` (typecheck + full vitest suite) green — 273
tests passed (up from 268), 2 pre-existing skips (unrelated), 0 existing
test behavior changed. `npm run build` green.

**Not yet manually verified in a real browser.**

## Phase 7.9a — Reading production (production ladder, first slice): done

Phase 7.9 was originally scoped as one bundled "production ladder/sentence
transformations" line; split per this effort's established discipline
(confirmed with the user before starting) into typed production first,
sentence-transformation conjugation quizzing (porting `anki/wk_decks.py`'s
`conjugate_vocab_form()`) as a later, separate slice.

Added:
- New `'reading_production'` vocabulary-item-subject activity type,
  third alongside `reading_retrieval`/`cloze` in `VOCABULARY_ACTIVITY_TYPES`
  (`src/pages/ReviewPage.tsx`) — same eligibility (a surfaceForm-bearing
  `sentence_vocabulary` link), so every existing reading_retrieval/cloze
  candidate now also gets a reading_production card seeded automatically.
  Recognition vs. production is a separate axis from what's hidden, so this
  is a genuinely new rung on the same word rather than a variant of
  reading_retrieval.
- `ReadingProductionCard` (`src/pages/ReviewPage.tsx`): shows the word
  highlighted in its sentence (visible, like reading_retrieval), a text
  input + "Check" button instead of a reveal button. Checking compares the
  typed value against the vocabulary item's reading via a new
  `isReadingAnswerCorrect` (NFC + whitespace-insensitive, reusing
  `normalizeSentenceKey`'s existing behavior rather than writing a second
  normalizer), shows ✓/✗ feedback plus the correct reading/meaning, then
  the same shared four-point self-rate every other card type uses —
  correctness is recorded as evidence, not used to auto-pick a rating,
  matching the "self-rate is the real signal" convention everywhere else.
  `key={current.studyItem.id}` on its render (new — no other card in this
  file needed one, since none had local input state that could leak
  between two same-type cards rendered back-to-back without a remount).
- `recordReview` (`src/db/repository.ts`) unchanged in shape — it already
  accepted `responseRaw`/`expectedAnswer` (reserved since Phase 4, never
  populated). `ReviewPage.tsx` is the first real caller to pass them,
  threaded through a new `typedResponse` state (reset alongside
  `revealed`/`assistanceUsed` on card change) that `handleRate` forwards as
  `responseRaw`/`expectedAnswer` only when non-empty — every other card
  type's `recordReview` call is unaffected.
- Tests: `tests/reviewPage.test.tsx` — extended the existing
  reading_retrieval/cloze walkthrough test to also seed/render/rate the new
  reading_production card and assert `responseRaw`/`expectedAnswer` on the
  resulting review; new test for the incorrect-answer path (✗ feedback,
  evidence still recorded, learner can still rate "Again"). Updated
  `suppressVocabularyActivityTypes` (added in Phase 7.7's own test file) to
  suppress all three vocabulary activity types, not two, so the
  contrastive-pair test still isolates correctly now that a third one
  exists.

**Deliberately not done yet** (moved to a later 7.9 slice): no sentence
transformations / conjugation quizzing (the `conjugate_vocab_form()` port);
no kana-conversion-aware answer matching (e.g. typing a katakana or
half-width variant of a hiragana reading won't match — NFC-normalize only,
no script conversion); no typed-meaning production (English), only reading;
no IME-specific input affordances beyond a plain text input.

**Verified**: `npm run check` (typecheck + full vitest suite) green — 274
tests passed (up from 273), 2 pre-existing skips (unrelated), 0 existing
test behavior changed. `npm run build` green.

**Not yet manually verified in a real browser.**

## Phase 7.9b — Sentence transformations (production ladder, second slice): done

The second and final slice of the roadmap's originally bundled "production
ladder/sentence transformations" line — completes Phase 7.9. Ports
`~/projects/anki/wk_decks.py`'s `conjugate_vocab_form()` (godan/ichidan/
suru/kuru/i-adjective/na-adjective, ~lines 2953-3510) and wires it into a
new review card.

**Word-class detection differs from the source on purpose**: the Python
code classified words from WaniKani-subject `parts_of_speech` strings
(e.g. `"godan verb"`), which this app's data doesn't have. Checked real
production data first (207 `vocabulary_items` rows with a non-null
`part_of_speech`, sampled via a throwaway script, not committed): the field
holds JMDict tags instead (`v5r; vt`, `adj-i`, `n,vs,vi` — note both `;`
and `,` appear as delimiters across rows), populated by the JMDict-backfill
and Anki-import pipelines. Wrote a new classifier for that shape
(`conjugationWordClassFromPartOfSpeech`) rather than porting the
WaniKani-string one, which doesn't apply here. The actual conjugation math
(stem-splitting, suffix tables, the いく/いい/くる irregulars) is ported
as-is and needed no adaptation.

Added:
- `src/lib/conjugation.ts` — pure port: `conjugate(expression, reading,
  wordClass, formKey)`, `conjugationWordClassFromPartOfSpeech`,
  `conjugationFormsForWordClass`. No Dexie/Supabase coupling, mirroring
  `src/lib/maturity.ts`/`src/lib/scheduling.ts`'s existing "pure domain
  lib" convention.
- `fixtures/conjugation-fixtures.json` — the same 86 fixture rows
  `~/projects/anki/conjugation_fixtures.json` used to validate the
  original Python engine (field names adapted: `word_class` values
  `irregular_verb`/`suru_verb` renamed to this port's `kuru`/`suru`, which
  split what the Python `irregular_verb` bucket lumped together). `tests/conjugation.test.ts`
  runs `conjugate()` against all 86 as `it.each` cases — **all 86 passed
  on the first run**, i.e. the port matches the source exactly against its
  own ground truth. Plus classifier tests (JMDict tag → word class,
  comma/semicolon delimiter handling, null cases) and a few conjugate()
  edge cases (form not offered by the class, empty input, mismatched word
  shape).
- New `'sentence_transformation'` activity type (`src/pages/ReviewPage.tsx`),
  a fourth activity type for `subjectType: 'vocabularyItem'` (distinct
  StudyItem tuple from reading_retrieval/cloze/reading_production, no
  schema change needed) — but with narrower eligibility than those three:
  `getSentenceTransformationCandidates` (pure filter, no DB call — unlike
  `getConfusionPairCandidates`, everything it needs is already on each
  `VocabularyTargetCandidate`) keeps only words whose `partOfSpeech` maps
  to a word class *and* whose conjugated form actually differs from the
  dictionary form. Fixed to a single form for this slice —
  `TRANSFORMATION_FORM_KEY = 'plain_past'` — rather than cycling through
  all 13 verb/10 adjective forms per word; wired as its own due-queue/
  pending-seed category, same shape as the confusion-pair category Phase
  7.7 added.
- `SentenceTransformationCard`: shows the sentence with the *dictionary*
  form highlighted plus a "Conjugate to: Plain past" prompt, a typed-reading
  input (reusing `isReadingAnswerCorrect` from Phase 7.9a), and on reveal
  shows both the conjugated expression and reading (unlike
  reading_production, the conjugated kanji form itself is part of the
  answer, not already visible) plus meaning. `responseRaw`/`expectedAnswer`
  threaded through the same `typedResponse` state Phase 7.9a added;
  `handleRate` now picks `expectedAnswer` from either
  `current.transformation.target.reading` or `current.target.vocabularyItem.reading`
  depending on which card type is active.
- Tests: `tests/reviewPage.test.tsx` — new end-to-end test seeding a real
  godan verb (話す/はなす, `partOfSpeech: 'v5s; vt'`), rendering the card,
  typing the conjugated reading (はなした), checking, and confirming both
  the review's `responseRaw`/`expectedAnswer` and the seeded study item's
  `subjectType`/`activityType`; a second test confirming a non-conjugable
  word (plain noun, `partOfSpeech: 'n'`) never seeds a
  `sentence_transformation` study item at all.

**Deliberately not done yet**: only `plain_past` is quizzed, not the other
12 verb/9 adjective forms (`conjugationFormsForWordClass` is exported and
ready for that, just not consumed yet); no per-word-class distribution
control (a word gets exactly one sentence_transformation card, same
"start small" scope as reading_production's one card per word); no
`errorClassification` population from conjugation mismatches; only ~207
production `vocabulary_items` rows currently have any `partOfSpeech` at
all, so this card type's real-world queue presence is small until more of
the JMDict-meaning backfill/Anki-import pipeline's `partOfSpeech` coverage
grows (a pre-existing, separate gap, not something this phase changes).

**Verified**: `npm run check` (typecheck + full vitest suite) green — 371
tests passed (up from 274 — the conjugation fixture suite alone added 95),
2 pre-existing skips (unrelated), 0 existing test behavior changed.
`npm run build` green.

**Not yet manually verified in a real browser** — worth specifically
checking against a real conjugable word once one is due, given how thin
current `partOfSpeech` coverage is.

This completes Phase 7.9 (both slices). Remaining Phase 7 sub-phase: 7.10
(session planner, graduation, explainability, debug view).

## Phase 7.10a — Explainability/debug view: done

First slice of Phase 7.10's four bundled pieces (session planner,
graduation, explainability, debug view) — combines "explainability" and
"debug view" into one, since both are the same underlying need: a
read-only page showing why a study item is scheduled the way it is, and
everything recorded about it. Purely additive — no change to `ReviewPage`'s
queue-building logic itself, so unlike the session-planner piece (still
not started) this needed no interaction with that file's now-five
hand-duplicated activity-type categories (flagged as due for a real
"activity descriptor" abstraction back in Phase 7.4's notes — still true,
still not this phase's job).

Added:
- `getStudyItemDebugInfo(studyItemId)` (`src/db/repository.ts`): given a
  study item, returns its raw `fsrsState`, every `Review` for it
  (most-recent-first — finally surfacing `source`/`assistance`/
  `responseRaw`/`expectedAnswer`, recorded since Phases 7.1/7.8/7.9 but
  never shown anywhere before this), each review's `contextSentenceId`
  resolved to a `Sentence` (keyed in a `Map` for lookup), and a `subject`
  discriminated union (`sentence` / `vocabularyItem` — with its computed
  maturity level, reusing `computeVocabularyContextDiversity`/
  `computeMaturityLevel` from Phase 7.1/7.5 — / `vocabularyConfusion` /
  `unknown`) describing whatever the study item is actually about.
- `StudyItemDebugPage` (`src/pages/StudyItemDebugPage.tsx`), new route
  `/study-items/:studyItemId`: subject summary, scheduling-state fields
  (state/due/stability/difficulty/interval/reps/lapses/last review),
  maturity block for a vocabulary-item subject, and the full review list
  with source/assistance/typed-response/context-sentence per review.
  `Back` uses `navigate(-1)` rather than a fixed link, since this page can
  be reached from any review-scope (global or per-book).
- `ReviewPage.tsx` gained a "Why?" link on the current card's header,
  pointing at `/study-items/:id` for whichever study item is showing — the
  natural in-context discovery path (a learner wondering "why is this here
  / why did it rate this way" mid-session), rather than a separate
  top-level browsable list of every study item (deferred — lower value
  than answering the question for a card you're already looking at).
- Tests: `tests/data.test.ts` — `getStudyItemDebugInfo` coverage for all
  three known subject kinds (sentence, vocabularyItem with maturity,
  vocabularyConfusion with both members) plus the unknown-id case.
  `tests/studyItemDebugPage.test.tsx` (new file) — not-found state,
  sentence-subject rendering, vocabulary-item maturity rendering, and a
  natural-encounter review's typed response + context sentence rendering.
  `tests/reviewPage.test.tsx` — one new test confirming the "Why?" link's
  `href` matches the currently-showing card's actual study item id.

**Deliberately not done yet**: no top-level browsable list of all study
items (see above); no editing/deletion from this view (read-only, matches
`reviews`' append-only design intent); no visualization (chart/timeline)
of the review history, just a plain list; `errorClassification` is shown
as raw `JSON.stringify` output since nothing populates it yet (same
"don't overbuild for data that doesn't exist" call as everywhere else this
has come up).

**Verified**: `npm run check` (typecheck + full vitest suite) green — 381
tests passed (up from 371), 2 pre-existing skips (unrelated), 0 existing
test behavior changed. `npm run build` green.

**Manually verified in a real browser** (2026-08-16, this session) —
see the note at the end of Phase 7.10b below; this covers 7.10a too.

## Phase 7.10b — Activity-descriptor refactor + session planner (new-card cap): done

Two pieces, done together at the user's direction: the refactor Phase 7.4's
notes flagged (`ReviewPage.tsx` hand-duplicating five parallel
activity-type categories) was a real prerequisite for building the session
planner cleanly — a planner needs to reason about "how many new subjects
have I introduced" uniformly across all five categories, not five
separately-copy-pasted counters.

**Refactor** (`src/pages/ReviewPage.tsx`): introduced an `ActivityDescriptor`
type — `{ key, activityTypes, candidates, existingItems, subjectId,
buildCard, ensure }` — one per category (sentence/vocabulary/listening/
confusion/transformation), built by `buildActivityDescriptors(scope)` from
the same `ReviewScope` data the old code already computed (only the audio
category's shape changed, from a `Map` to an array of `{ sentence, audio }`
candidates, since a descriptor needs a flat candidate list). The due-queue
fetch/merge, the pending-seed computation, and the lazy seeding-batch
effect are now each a single generic loop over `descriptors` instead of
five near-identical blocks; `pendingSeedKey()` is gone entirely (`subjectId`
is computed once and carried on `PendingSeed`, doing double duty as the
seeding-batch key). `defineActivityDescriptor<C>()` is a small
generic-to-non-generic constructor — the only `as unknown as` cast in the
file (and the only place this codebase has one at all), needed because an
array holding descriptors of different candidate types `C` requires a
common non-generic shape; each call site is still fully typed. Card
rendering (the `current.target ? ... : current.audio ? ...` dispatch and
the five card components) is untouched — the duplication was entirely in
the data layer, not rendering.

**Session planner** (docs brief, "session planner" bullet of Phase 7.10):
new `AppSettings.newCardsPerSessionLimit` (default 20, additive in the
backup schema same as every prior settings field) caps how many *new*
subjects (not already-due reviews) `ReviewPage` introduces per sitting —
tracked via a `newCardsIntroduced` state counter, incremented once per
seeded batch (a word's reading_retrieval+cloze+reading_production seeding
together still counts once, matching the "new cards today" mental model
other SRS apps use, not a per-card count). The lazy-seeding effect now
also gates on `newCardsIntroduced < settings.newCardsPerSessionLimit`;
already-due reviews are never affected. When the cap stops new seeding
before the pool is empty, the empty state now distinguishes this from
genuine "nothing left" — "New-card limit reached for this session (N of
LIMIT introduced) — M more waiting next time," computed from
`pool`'s remaining distinct `(descriptorKey, subjectId)` pairs. New number
input on `SettingsPage.tsx` ("New cards per review session").

Tests: `tests/reviewPage.test.tsx` — one new end-to-end test (cap=1, three
sentences, confirms only the first seeds, the other two never do, and the
limit-reached message shows the right counts) plus zero changes needed to
any of the 17 pre-existing tests (confirming the refactor is behavior-
preserving — same 381→383 count delta is purely additive). New
`tests/settingsPage.test.tsx` (first test coverage for this page) for the
new control. `npm run check` green — 383 tests passed (up from 381
after the refactor's zero-net-change verification), 2 pre-existing skips,
`npm run build` green.

**Manually verified in a real browser** (2026-08-16): no `chromium-cli`
in this environment, so used a small Playwright driver instead (browser
binaries + shared libs installed user-locally via `apt-get download` +
`dpkg-deb -x`, no root available). Seeded IndexedDB directly (bypassing
Dexie's own change-tracking, which doesn't see writes from a second raw
connection — a page reload was needed after seeding for `useLiveQuery` to
pick them up) and drove the full review flow end-to-end:
comprehension → reading_production (typed a wrong answer on purpose,
confirmed "✗ Not quite" plus the correct answer, still rateable) →
sentence_transformation (typed はなした for 話す's plain past, got
"✓ Correct" with 話した/はなした shown) → contrastive pair (both
付く/付ける sentences shown together, revealed both readings) →
reading_retrieval → "All caught up," matching next-due timestamp. Also
verified separately: PracticePage's natural-encounter panel (rate a word,
row becomes "Recorded"); `/study-items/:id` both empty (no reviews yet)
and populated (state advanced to `learning`, review history showing
rating/timestamp/source) after rating a card; and this phase's own
new-card cap (`newCardsPerSessionLimit: 1` in Settings, seeded 3 new
sentences, confirmed only one seeded and the "New-card limit reached ...
2 more waiting next time" message appeared). One environment-only
caveat: this container has no CJK fonts, so Japanese text rendered as
tofu boxes in screenshots — confirmed via DOM text extraction (not just
visually) that the actual text content was correct throughout, so this is
a sandbox display artifact, not an app bug.

This is the last done slice of Phase 7's sub-phasing so far. **"Graduation"
is still not built** — the fourth item in Phase 7.10's original bundled
line ("session planner, graduation, explainability, debug view"), not yet
scoped or started. The maturity ladder (Phase 7.1/7.5:
fragile→established→generalized→mature, surfaced read-only on the
`StudyItemDebugPage`) is related but isn't itself a graduation
*mechanic* — nothing currently acts on maturity level (e.g. retiring a
mature item from regular rotation, moving it to a lighter-touch review
cadence, or marking it "learned"). Needs scoping with the user before
starting: it's not clear from context alone what "graduation" should
mean here.

## Real-data gap found during the user's own manual check, and its backfill

The user's own manual browser check (after this session's automated one)
found that review only ever showed plain sentences — no reading_retrieval/
cloze/reading_production/sentence_transformation/contrastive-pair cards,
and no natural-encounter panel on PracticePage. Root cause, confirmed
directly against production: **0 of 503** `sentence_vocabulary` rows had
`surface_form` set. Every one of those card types (Phase 7.2/7.3/7.5/7.7/
7.8/7.9a/7.9b) correctly gates eligibility on a surfaceForm-bearing link
(`getVocabularyTargetCandidates`) — working exactly as designed, just
against data that didn't exist yet. `surface_form` is written by exactly
one path, `materializeVocabularySelections`, called only from
`AnalyzePage.tsx`'s interactive vocabulary-picker confirm action — every
real link so far came from the one-time Anki import (Phase 2), which
predates and bypasses that field entirely, and the confirm flow hadn't
been used live since Phase 5 shipped it.

Added `scripts/backfill-vocabulary-surface-forms.ts` (+
`.github/workflows/backfill-vocabulary-surface-forms.yml`, same
dry-run-by-default/`--apply`/manual-`workflow_dispatch`-only shape as
every other backfill script here) to retroactively infer `surface_form`
for existing links: exact substring match of the vocabulary item's
dictionary `expression` against its sentence's text first, then — for
items with a `partOfSpeech` JMDict tag — every conjugated form via
`src/lib/conjugation.ts` (the same engine Phase 7.9b's card uses),
first substring match wins. Run against production (2026-08-16):
**385 of 498** links matched and updated (113 had no match — mostly
conjugation forms this engine doesn't cover, e.g. volitional/たい, or a
handful of pre-existing garbled `expression` values from the Anki import,
not something this script can or should fix). Spot-checked the conjugated
matches by hand — all grammatically correct (働く→働いて, 分かる→分かった/
分からない, 青い→青くて, 言う→言いました, etc.). Confirmed post-run: 2 of
the 4 confusion pairs now have both members eligible and will actually
surface as contrastive-pair cards; the other 2 still won't (their other
member never got a surfaceForm match) — expected, not a bug.

Idempotent and re-runnable (only null-`surface_form` links are selected),
so running it again later after more of the Anki-imported vocabulary gets
a `partOfSpeech` tag (via `backfill:vocabulary-meanings`) will pick up
more conjugation-based matches than this first pass could.

## Real-data gap #2: sentence-major pending-seed order buried vocabulary cards

Even after the surface_form backfill, the user still only saw plain
sentences in Review. Second root cause, found by checking production
directly: their book has **206 sentences**; only 14 `study_items` existed
so far (7 sentences' worth), **0** of them `vocabularyItem`-subject.

The bug: `ReviewPage.tsx`'s pending-seed pool was built category-major —
every sentence's pendingSeeds first, *then* every vocabulary item's, then
listening/confusion/transformation — and the lazy-seeding effect only ever
seeds `pool[0]`'s batch once the queue empties. With 206 sentences, that
meant clicking through roughly 400 sentence-subject cards before the pool
array ever reached a single vocabulary-based entry — technically correct,
practically invisible. Same underlying mechanism the Phase 7.2 due-queue
merge already solved for *due* cards (interleaving all categories by
`fsrsState.due` instead of listing them separately, "one unified session,
not six mandatory cards") — this was the same problem in the *pending-seed*
half of the queue, never fixed there.

Fix (`src/pages/ReviewPage.tsx`): the pending-seed list is now built per
descriptor first (unchanged logic), then merged round-robin across
descriptors instead of concatenated — one entry from each non-empty
descriptor's list per round, cycling until all are drained. Seeding-batch
selection was already a `pool.filter(...)` over the *whole* pool by
`(descriptorKey, subjectId)`, not a positional slice, so a candidate's
several activity types (e.g. a word's reading_retrieval/cloze/
reading_production) still seed together as one batch even when their
entries end up scattered non-adjacently by the interleave — no change
needed there.

New test (`tests/reviewPage.test.tsx`): three sentences plus one
vocabulary item linked only to the first sentence — confirms the
vocabulary item's three cards seed as the *second* batch (right after the
first sentence's own two cards), not after all three sentences are
exhausted. All 19 pre-existing tests in that file still pass unchanged
(they seed too few subjects, or explicitly suppress the categories they
don't want, for the interleave to change their observed order).

**Verified**: `npm run check` green — 384 tests passed (up from 383), 2
pre-existing skips, `npm run build` green. **Confirmed fixed by the user**
against real production data (2026-08-16) — vocabulary-based cards now
appear within the first few clicks of a review session, as intended.

## Phase 7.10c — Graduation: done

The last piece of Phase 7.10's original bundled line. Scoped with the
user directly (the ambiguity flagged when 7.10a/b shipped): "eventually
if it seems like I've learned it well enough, items should stop being
quizzed." Landed as a configurable threshold on FSRS's own interval
signal, not a separate tracked concept.

Added:
- `isGraduated(fsrsState, minScheduledDays)` (`src/lib/scheduling.ts`):
  a study item is graduated once its interval (`scheduledDays`) reaches
  `minScheduledDays` while in the stable `review` state (not `learning`/
  `relearning`/`new`, so an item that just lapsed and is being relearned
  is never mistaken for graduated even if its *pre-lapse* interval had
  been long). `minScheduledDays <= 0` disables graduation entirely —
  nothing about the FSRS math changes, only whether it's ever surfaced,
  so raising or lowering the threshold later immediately (un)graduates
  items with no migration or backfill needed.
- New `AppSettings.graduationMinScheduledDays` (default 180 — about six
  months; deliberately a much higher bar than the existing 21-day
  `MATURE_MIN_SCHEDULED_DAYS` maturity-ladder threshold from Phase 7.1/7.5,
  which only gates the mnemonic-auto-show behavior and was never meant to
  mean "stop reviewing"), additive in the backup schema like every other
  settings field. New number input on `SettingsPage.tsx` next to the
  new-cards-per-session control, with matching "0 disables" convention.
- `getDueStudyItems` (`src/db/repository.ts`) gained an optional
  `graduationMinScheduledDays` option, filtering with `isGraduated` —
  the same "single source of truth for due-ness" function every activity
  category already goes through, so this is one filter, not five.
  `ReviewPage.tsx` now waits for settings to load before building the
  queue (previously only the seeding effect needed settings, for the
  new-card cap) and passes the threshold into every descriptor's due-fetch
  call.
- `StudyItemDebugPage.tsx` shows a new "Graduated" field (Yes/No, with a
  one-line explanation) — ties directly into 7.10a's explainability goal:
  now "why don't I see this word anymore" has a direct answer.
- Tests: `tests/scheduling.test.ts` (`isGraduated` — disabled, under
  threshold, at/over threshold, and every non-`review` state). `tests/data.test.ts`
  (`getDueStudyItems` excludes a graduated item, includes it again with no
  threshold passed). `tests/reviewPage.test.tsx` (a graduated and a
  non-graduated item due at the same time — only the non-graduated one
  ever shows; queue correctly reports "All caught up" once it's rated,
  never surfacing the graduated one). `tests/settingsPage.test.tsx` and
  `tests/studyItemDebugPage.test.tsx` for the new controls/field.

**Deliberately not done yet**: no manual "un-graduate" action (the only
way to bring an item back today is lowering or disabling the setting,
which un-graduates everything above the new bar at once, not one item at
a time); no visual indicator of graduated items outside the debug page
(no "graduated" badge on `/vocabulary` or book pages); graduation isn't
itself a new evidence/event (no `Review` row, no sync entity) — it's
purely a derived read of existing FSRS state, so there's nothing to sync
or migrate.

**Verified**: `npm run check` green — 393 tests passed (up from 384), 2
pre-existing skips, `npm run build` green. **Manually verified in a real
browser** (2026-08-16, same Playwright-driver approach as the rest of this
session): seeded one graduated and one non-graduated study item both due
now — only the non-graduated one ever appeared; after rating it, "All
caught up" with the graduated item's own (correctly far-future, unrelated)
due date shown; `/study-items/:id` for the graduated item correctly
showed "Graduated: Yes."

This completes Phase 7's full sub-phasing (7.1 through 7.10c) and, with
it, every phase in the original roadmap (`docs/UNIFIED_APP_ARCHITECTURE.md`
§15 — Phase 0 through Phase 7).

## Phase 7.11 — Full-sentence review gating: done (user request, 2026-08-16)

Added well after Phase 7 was otherwise complete, directly from the user:
"full sentences for the review should wait until the user shows they are
remembering the vocabulary in the sentence... the next reviewer for those
pieces should be at least a week away," followed by "reset the current
review status, since it's mostly full sentences I haven't shown the
proficiency for the vocabulary in them yet." Shipped in two passes — the
first version had a real bug the user caught before it went further; both
are documented here since the fix changed the core rule, not just an edge
case.

**Proficiency signal** (unchanged across both passes): a vocabulary item
counts as "shown proficiency" once its FSRS state reaches `review` (or,
after a later lapse, `relearning` — reaching `relearning` requires having
passed through `review` first, so it still implies a successful recall
happened at some point). `new`/`learning` mean it's never been
successfully recalled. `isVocabularyItemProficient` (`src/lib/scheduling.ts`).

**First pass (bug, corrected same day)**: gated a sentence's full-sentence
cards (`comprehension`/`reading_in_context`) on every *linked* reviewable
vocabulary item being proficient, but treated a sentence with **zero**
vocabulary links as "nothing to gate on" and let it through immediately.
The user caught this: "if I add a new sentence it will automatically go
into the review list unless I select the vocabulary for review for it?"
— exactly right. A brand-new, never-analyzed sentence has zero links (not
because its vocabulary is known, but because nobody's looked at it yet),
so the first pass let every new sentence skip straight to the front of
the line, which is backwards from the actual goal.

**Corrected rule**: a sentence is ready for full-sentence review only if
`SentenceAnalysis.vocabularyReviewStatus === 'confirmed'` (set by the
`VocabularyPicker` on `AnalyzePage.tsx` when the user finishes reviewing
that sentence's vocabulary — already existed since Phase 5/7.6, just never
consulted by review scheduling before this) **and**, once confirmed,
every surfaceForm-bearing `sentence_vocabulary` link is itself proficient.
No `analyses` row at all (the default for a freshly imported sentence)
means `vocabularyReviewStatus` is `undefined`, which fails the first check
— gated, not passed through. A sentence confirmed with zero vocabulary
links (a short sentence with nothing worth tracking) has nothing left to
check and is ready. New pure functions in `src/lib/scheduling.ts`:
`isSentenceVocabularyReady` (the "are the confirmed links proficient"
half, kept from the first pass) and `isSentenceReadyForFullReview` (wraps
it with the `vocabularyReviewStatus` precondition) — both unit-tested
directly (`tests/scheduling.test.ts`).

**Second bug, found while fixing the first**: even after correcting the
rule, a *lazily-seeded* sentence card (an activity type — e.g.
`reading_in_context` — with no `study_item` yet, created on demand the
first time the queue runs dry) bypassed the gate entirely, because lazy
seeding builds and queues a card directly rather than going through
`getDueStudyItems`/`deferUnreadySentenceReviews`. Fixed by extracting the
readiness computation into a shared `getSentenceFullReviewReadiness`
(`src/db/repository.ts`) and filtering `ReviewPage.tsx`'s pending-seed
pool through it for the `sentence` descriptor specifically — a not-ready
sentence never gets a *new* study item lazily created in the first place
(existing due ones are still handled by `deferUnreadySentenceReviews`).

**`src/db/repository.ts`**: `getReviewableVocabularyItemIdsBySentence`
(batched sentence→vocabulary-item-id lookup, surfaceForm-bearing links
only), `getSentenceFullReviewReadiness` (batched per-sentence readiness,
shared by both call sites above), and `deferUnreadySentenceReviews` (for
every currently-due sentence-subject study item among the given activity
types, checks readiness and, if not ready, pushes `fsrsState.due` out to
`max(currentDue, now + 7 days)`; never pulls a due date earlier).
`ReviewPage.tsx` calls `deferUnreadySentenceReviews(SENTENCE_ACTIVITY_TYPES)`
once at the start of every queue-build (for existing items) and filters
pending seeds through `getSentenceFullReviewReadiness` (for items that
don't exist yet) — so the gate covers both paths, not just one.

**Book-page visibility** (user's follow-up ask: "we might need some
manual way to gate those so I can go through them... it's not very clear
to me what that process should be"): `BookDetailPage.tsx`'s per-sentence
row already had a chunking-status pill; added a second pill next to it
showing `vocab: needs review` (warning color) or `vocab: confirmed`
(success color), reading `row.analysis?.vocabularyReviewStatus` directly
— no new query, that data was already loaded. The row's existing
"Analyze" button is already the direct fix action. New CSS:
`.status-pill.confirmed`/`.status-pill.unreviewed` (`src/styles/global.css`).
Scoped down deliberately: no new dedicated "needs vocabulary" filter/list
page yet — the user's own framing of the full sentence pipeline (acquire
→ sort into books/chapters → order → chunk + mark vocabulary, the last
two independent/parallel not sequential per `SentenceAnalysis`'s own
existing fields) is a bigger conversation than this pass, noted here for
whenever that's picked up again.

**One-time production reset**: `scripts/defer-unready-sentence-reviews.ts`
(dry-run by default, `--apply` to write) applies the identical gating
logic — imports `isSentenceReadyForFullReview`/`isVocabularyItemProficient`
directly from `src/lib/scheduling.ts` rather than reimplementing them,
matching this repo's established precedent (e.g. the conjugation-engine
reuse in `backfill-vocabulary-surface-forms.ts`) — to whatever's already
due in production, since the ongoing in-app gate only affects sentences
whose queue gets rebuilt *after* this session, not the backlog already
sitting due. **Run twice** against production 2026-08-16, once per pass:
first pass deferred 12 of 18 due full-sentence items (21 `study_items`
total — still an early, small dataset), leaving 6 no-vocab-link items
alone (the since-fixed bug); after the rule correction, a second run
found those same 6 — all with `vocabularyReviewStatus` never confirmed —
and deferred them too, leaving 0 due full-sentence items. A follow-up dry
run after each pass confirmed idempotency (0 more to defer both times).

**Manually verified in a real browser** (chromium) at each stage: a due
sentence with an unready-but-linked vocab item correctly hidden from the
queue with its due date pushed exactly 7 days out; after the fix, a
brand-new sentence (no `analyses` row) correctly produces zero
`study_items` at all (not seeded, not shown, "All caught up" instead of
appearing) rather than sneaking through via lazy seeding; the book-page
vocab pill renders both states with correct color-coding.

New/updated tests: `tests/scheduling.test.ts` (`isSentenceReadyForFullReview`
directly). `tests/data.test.ts`'s `deferUnreadySentenceReviews` describe
block reworked around a `confirmVocabularyReview` helper — covers a
never-reviewed sentence (gated), confirmed-with-nothing-linked (ready),
defers an unready confirmed item, leaves a fully-proficient one alone,
requires *every* linked item proficient not just one, ignores a
surfaceForm-less link, never pulls a due date earlier than it already
was. `tests/reviewPage.test.tsx` gained a dedicated regression test for
the lazy-seed bypass bug, plus `vocabularyReviewStatus: 'confirmed'`
seeding added to `seedBookWithSentence()` and three other tests whose
sentences needed to stay ungated to test what they were actually about
(graduation, the new-card cap, pending-seed interleaving — the
interleaving test also had to relink its vocabulary candidate from
sent-1 to sent-2, since linking it to sent-1 would have gated sent-1
itself, which that test wasn't testing). `npm run check` — 471 passed, 2
skipped (pre-existing), 0 failed.

## Phase 8 — Shadowing feature parity: fully complete (8.1-8.5)

### 8.1 — Playback speed control: done, verified

Ported `PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25]` (`src/lib/recording.ts`) and
wired a `speed` control into `ShadowPage.tsx`, applied to every kind of
playback the page does:

- **Reference audio** (`NativeAudioButton`): added an optional
  `playbackRate` prop, threaded through `useNativeAudio` →
  `NativeAudioController.play(record, playbackRate)`, which sets
  `audio.playbackRate`/`audio.preservesPitch = true` on the underlying
  `Audio` object before playing.
- **Alternate comparison** (`PlaybackCoordinator.alternate`): added a 4th
  `playbackRate` param (positional, defaulting to 1, so the existing
  `recording.test.ts` calls that only pass `gapMs` stay valid) — sets both
  the reference and learner `<audio>` elements' `playbackRate`/
  `preservesPitch` before playing. Threaded through
  `ShadowingController.playAlternate` and `useShadowing`.
  `PlaybackCoordinator.dualEar`/`playDualEar` already supported
  `options.playbackRate` from Phase 3 — just needed `ShadowPage.tsx` to
  pass `{ playbackRate: speed }` through.

New unit tests: `PlaybackCoordinator.alternate` applies rate/pitch to both
elements (`recording.test.ts`), `NativeAudioController.play` applies a
custom rate and defaults to 1 (`nativeAudio.test.ts`), and
`ShadowingController.playAlternate` passes a custom rate through
(`shadowing.test.ts`). `npm run check` — 397 passed, 2 skipped
(pre-existing), 0 failed.

**Manually verified in a real browser** (chromium via a throwaway
Playwright driver, not committed — same approach as the 7.6–7.10b session,
see that entry in `unified_app_migration` memory for the IndexedDB-seeding
gotcha). Seeded a book/sentence/reference-audio/attempt directly via a raw
`indexedDB.open()` connection, reloaded, opened Shadow, confirmed: the
"Playback speed" `<select>` renders all four options
(`0.5×`/`0.75×`/`1× (normal)`/`1.25×`); selecting `0.75×` then clicking
Alternate sets `playbackRate: 0.75` and `preservesPitch: true` on both the
hidden reference and attempt `<audio>` elements; zero console errors. This
environment's chromium binary was missing `libnspr4`/`libnss3`/
`libnssutil3` shared libs — resolved the same no-root way as before
(`apt-get download` + `dpkg-deb -x` into a local prefix, `LD_LIBRARY_PATH`
pointed at it), this time via apt directly rather than a full Playwright
browser-deps install.

### 8.2 — Practice-target isolation: done, verified

New code (not a port). Learner marks an arbitrary sub-range of the
reference clip and can loop just that range, or scope Alternate/Dual-ear
comparisons to it — the "manual loop-point marking" first cut this doc
recommended, using the simpler "mark start/end while listening" variant
rather than draggable timeline handles.

**UI (`ShadowPage.tsx`)**: replaced the old `NativeAudioButton`
tap-to-play reference control with a real, scrubbable
`<audio controls>` element (`referenceAudioRef`, now always visible when
reference audio exists, reused for Alternate playback too — no second
audio element). Added "Mark start"/"Mark end" buttons that read the
player's current `currentTime`; a "Target: Xs–Ys" readout; "Loop
target"/"Stop loop"; "Clear target". Speed control now applies via an
effect on this same element instead of through `NativeAudioButton`.

**Lib (`src/lib/recording.ts`)**:
- `PlaybackCoordinator.loopRange(audio, range, playbackRate)` — new
  primitive, loops an element within a `TimeRangeMs` until cancelled
  (`timeupdate` listener resets `currentTime` back to the range start).
  Catches `play()` rejection (e.g. unsupported source) and resolves
  rather than leaving an unhandled rejection — a real bug a first
  real-browser pass caught that unit tests (whose fake `play()` mock
  never rejects) missed.
- `playUntilEnded` gained an optional `range` param (used by `alternate`)
  — seeks to `range.startMs` and resolves early via `timeupdate` once
  `range.endMs` is crossed, instead of only ever waiting for the file's
  natural `ended` event. Backward-compatible: omitting `range` is
  identical to the old whole-clip behavior.
- `PlaybackCoordinator.alternate` gained an optional 5th
  `referenceRange` param, threaded straight to `playUntilEnded` for the
  reference side only — the learner/attempt side always plays in full.
- `DualEarOptions` gained `referenceRange`; `playDualEar` seeds the
  reference `Audio` element's `currentTime` to the range start and adds
  its own `timeupdate` listener that pauses + counts as "ended" once the
  range end is crossed, so completion still only resolves once both
  sides are done — the learner side is untouched.

Threaded `referenceRange`/`targetRange` through
`ShadowingController.playAlternate` and `useShadowing`, matching the
existing `playbackRate` threading from 8.1.

New unit tests: `loopRange` seeks/loops/applies rate/handles a rejected
`play()`/isn't affected by a superseded loop (`recording.test.ts`);
`alternate` and `dualEar` each get a test confirming only the reference
side is trimmed while the learner/attempt plays in full. `shadowPage.test.tsx`'s
existing smoke test was updated for the new visible player (was asserting
on the now-removed `NativeAudioButton`); added a component test that
marks a range via the real `<audio>` element's `currentTime` and confirms
the UI shows/clears it. `npm run check` — 404 passed, 2 skipped
(pre-existing), 0 failed.

**Manually verified in a real browser** (chromium, same throwaway-driver
approach as 8.1, not committed) — twice, since the fake-bytes blob used
for a first pass surfaced the `play()`-rejection bug above; a second pass
used a real (silent) synthesized WAV blob so playback actually runs.
Confirmed: marking a 0.5s–2.3s range and looping it produces a real
observed wraparound in `currentTime` (samples like `2.18 → 0.53`) and
stays within the range; stopping the loop pauses the element; on a
separate 6s reference clip with a 1s–3s target, both Alternate and
Dual-ear stop the reference side right around 3.0s instead of continuing
to 6s, while the learner/attempt clip plays in full; zero console errors
in the clean run.

### 8.3 — Shadow mode (mic calibration + play-along recording + live waveform): done, verified

Scoped down from the original line item: the live waveform ported here is
**amplitude-only**. The original `LiveShadowWaveform.tsx` also draws a
live pitch contour, but that half depends on the pitch-detection DSP
(`analysis/pitch.ts`, plus the pitch-bucket half of `analysis/waveform.ts`)
that's Phase 8.4's scope, not yet ported — pulling it forward here would
have meant doing most of 8.4's work early and defeating the doc's own
"read the simpler audio code in 8.3 first" sequencing rationale. The
pitch-contour overlay is deferred to land with 8.4 instead.

**Ported into `src/lib/recording.ts`** (previously flagged "not ported" in
that file's own header comment, now updated): `calibrateMicrophone`
(records ambient + speech RMS/peak over 2.5s via a throwaway
`AudioContext`+`AnalyserNode`, returns guidance strings), `SHADOW_AUDIO_SETTLE_MS`,
`playReferenceForShadowing`, and `ShadowReferencePlayer` — the key piece:
one `AudioContext` shared between the mic's `AnalyserNode` (for live
waveform sampling) and the reference clip's playback (`createMediaElementSource`
routed through the *same* context), specifically so a second `AudioContext`
can't chop the recording's opening sound — a real ordering constraint the
original source noted from experience, preserved as-is.

**New `src/lib/waveform.ts`** — amplitude-only subset ported from the
source app's `analysis/{audio,waveform}.ts` + `services/media.ts`:
`decodeAudioBuffer`, `canonicalizeAudioBuffer` (downmix + resample to
16kHz), `computePeaks`/`peaksFromBlob` (static reference waveform),
`mergeLivePeak`/`emptyLivePeaks` (live mic envelope), `peaksToPolyline`
(SVG rendering). Left out: `energyEnvelope`/`detectOnsetSeconds`/
`crossCorrelateOffset` (alignment helpers for 8.4's `AnalysisPanel`, not
needed yet) and all pitch-bucket functions (8.4).

**New `src/components/LiveShadowWaveform.tsx`** — ported (amplitude-only)
from the source's component of the same name. One adaptation: takes a
`referenceBlob` prop directly instead of a `referenceAssetId` DB lookup,
since this app stores shadowing reference audio inline on
`SentenceAudio.blob` rather than through a separate assets service.
Renders the static reference waveform plus a live-updating polyline built
from `requestAnimationFrame`-driven peak samples off the shared analyser,
with a playhead line driven by the shadow player's own media clock
(`getShadowMediaTime`), shifted by `SHADOW_OUTPUT_LATENCY_SECONDS` to
track what's actually audible over Bluetooth headphones.

**`src/lib/shadowing.ts` (`ShadowingController`)**: added a
`shadowPlayer: ShadowReferencePlayer` field and a new `shadowActive`
snapshot flag (true only once the graph is actually up, not just
requested). `startRecording` gained an optional `shadowReference: { blob,
playbackRate }` param — when `micMode === 'shadow'` and a reference is
given, starts the shadow player on the *same* mic `MediaStream` the
recorder is already using (no second `getUserMedia` call). A shadow-player
start failure is treated as non-fatal — the mic recording itself
continues; only the play-along/waveform side is affected — matching how
comparison-playback errors are already handled elsewhere in this
controller. `stopRecording`/`cancelRecording` both stop the shadow player.
New `getShadowAnalyser`/`getShadowMediaTime` getters, threaded through
`useShadowing`.

**`ShadowPage.tsx`**: new "Shadow mode (play reference while recording)"
checkbox (disabled without reference audio or mid-recording), a
"Calibrate mic" button rendering the returned guidance list, and the
`LiveShadowWaveform` rendered only while `isRecording && shadowing.shadowActive`.
Record button passes `'shadow'` micMode + `{ blob: referenceAudio.blob,
playbackRate: speed }` when shadow mode is checked.

New unit tests: `tests/waveform.test.ts` covers the pure bucket/polyline
math directly. `tests/shadowing.test.ts` gained a
"ShadowingController shadow mode" block mocking `ShadowReferencePlayer`
(via `vi.mock`/`vi.hoisted`, since real `AudioContext`/mic graphs aren't
meaningfully fakeable at the unit level) to verify the *orchestration*:
starts the player with the recording stream/blob/rate only in shadow
mode, sets/clears `shadowActive` correctly across start/stop/cancel, and
treats a player-start failure as non-fatal. `shadowPage.test.tsx` gained
an assertion that the new checkbox/button render and the checkbox starts
enabled (reference audio present). `npm run check` — 418 passed, 2
skipped (pre-existing), 0 failed.

**Manually verified in a real browser** (chromium, same throwaway-driver
approach as 8.1/8.2) — this time launched with
`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` and
`context.grantPermissions(['microphone'])` so mic access works
headlessly without a real device. Confirmed: clicking "Calibrate mic"
returns real guidance text after ~2.5s (the fake device's synthetic tone
correctly triggered the clipping-guidance branch — expected given a
full-scale test signal, not a bug); enabling shadow mode and clicking
Record shows the live waveform section immediately and it disappears
again on Stop, landing in the normal pending-attempt Save/Discard state;
zero console errors throughout, meaning the shared-`AudioContext` graph
(mic analyser + reference `createMediaElementSource`, both feeding one
context) built and tore down cleanly. Whether the reference clip was
*audibly* correct isn't something browser automation can check directly,
but the absence of any construction/playback errors across the whole
graph is strong indirect evidence, consistent with how this class of
check has been done throughout Phase 8.

### 8.4a — Pitch-detection DSP + live pitch-contour overlay: done, verified

First half of the original Phase 8's item 4 ("pitch/waveform comparison
analysis"), split out because it's genuinely two different pieces:
real-time pitch tracking for the *live* shadow waveform (8.3's explicitly
deferred half) vs. a *post-hoc* comparison panel for saved attempts
(8.4b, still to come). Doing the DSP port once and using it for both is
the point of this split, not a scope cut.

**New `src/lib/pitch.ts`** — full port of `analysis/pitch.ts`'s YIN
pitch-detection algorithm (`estimateFramePitch`, `extractPitch`,
`hzToRelativeSemitones`). **No source-repo test fixtures exist for this
module** (unlike Phase 7.9b's conjugation-engine port, which validated
against the source's own 86-row fixture set) — checked first per
STATUS.md's own advice, found none. Validated instead against synthetic
pure-tone signals of known frequency (`tests/pitch.test.ts`): detects
220Hz/400Hz sine tones within ~5Hz, correctly reports silence and pure
noise as unvoiced, `extractPitch` tracks a steady tone with >80% voiced
ratio and a correct median, and correctly detects an octave jump between
two halves of a synthetic clip. This is a stronger correctness bar than
"looks right in the browser" for DSP code, given there was nothing to
diff against.

**`src/lib/waveform.ts`** gained the pitch-bucket functions skipped in
8.3 (`emptyLivePitchBuckets`, `pitchFramesToBucketSemitones`,
`pitchBucketsToPolyline`) plus the display-range constants. Unit-tested
directly (`tests/waveform.test.ts`).

**`LiveShadowWaveform.tsx`** now renders the second SVG panel from the
original component — a live pitch contour (gold) against the reference
contour (decoded once via `extractPitch` when the reference blob loads),
speaker-normalized to relative semitones off the reference's own median
Hz, sampled every other animation frame off the same shared analyser the
amplitude waveform already used (no new AudioContext). Needed threading
`ShadowingController`/`useShadowing`'s existing `getShadowAnalyser`/
`getShadowMediaTime` pair with a new `getShadowSampleRate` (the
underlying `ShadowReferencePlayer.getSampleRate()` existed since 8.3 but
wasn't exposed through the controller yet — an oversight from that
phase, fixed here).

New unit tests: `tests/pitch.test.ts` (10 tests, synthetic-tone
validation as above), `tests/waveform.test.ts` gained 6 more for the
pitch-bucket functions, `tests/shadowing.test.ts`'s shadow-player getter
test extended to cover `getShadowSampleRate`. `npm run check` — 433
passed, 2 skipped (pre-existing), 0 failed.

**Manually verified in a real browser** (chromium, fake mic device, same
approach as 8.3) — seeded a real 220Hz synthetic-tone WAV as the
reference clip (not silence, so there'd be something for `extractPitch`
to actually detect) and confirmed: the pitch-overlay section renders
with a "ref median ~220 Hz" label, and the reference contour polyline has
184 real points (matching genuine per-frame pitch detection across the
clip, not a placeholder). The live contour only picked up 1 point from
the fake mic device's synthetic signal over a 1.5s recording — plausible
given Chromium's fake-device audio isn't a clean periodic tone at
speech-relevant levels, and not checked further since real voice input
isn't reproducible in this harness; the important thing verified is that
the whole live-estimation pipeline (analyser sampling → YIN → semitone
conversion → bucket → polyline) ran end-to-end with zero console errors.

### 8.4b — Post-hoc analysis panel: done, verified

Second half of Phase 8's original item 4 — a saved-attempt-vs-reference
comparison panel, split from 8.4a because it's a different UI (post-hoc,
not live) built on the same pitch DSP. This closes out Phase 8's entire
original item 4 and, with it, the full original planning-doc scope —
only 8.5 (polish bundle) is left.

**`src/lib/waveform.ts`** gained the alignment DSP from the source's
`analysis/audio.ts` (`energyEnvelope`, `detectOnsetSeconds`,
`crossCorrelateOffset`) plus `analyzeAlignment` — a simplified,
**uncached** port of the source's `AnalysisService.analyzeAlignment`
(the source persisted results to a `derivedAnalyses` table plus sync
tracking this app doesn't have; clips are short enough to just recompute
each time the panel opens). Also added `sliceCanonicalAudio` (new, not
ported — trims decoded audio to a millisecond range) so the reference
side can honor Phase 8.2's `targetRange` when one is set, exactly as
that phase's own notes said 8.4 should.

**New `src/lib/timingObservations.ts`** — ported `confidenceFromSignal`/
`buildTimingObservations` from `analysis/japanese.ts`. Dropped the
`morae`-driven sokuon/long-vowel observation lines: this app has no mora
timing guide yet (still deferred per Phase 8.2's notes) — the function
just never gets passed `morae`, so those two observation lines simply
never appear, a graceful degradation rather than a stub.

**New `src/components/AnalysisPanel.tsx`** — ported from the source
component of the same name. Adaptations: takes `referenceBlob`/
`learnerBlob` directly (the established Phase 8 pattern since 8.3, no
asset-id/DB lookup), a new `targetRange` prop threaded to
`analyzeAlignment` and to the reference side's pitch extraction (via
`sliceCanonicalAudio`), and no `AnalysisService` caching layer per
`waveform.ts`'s note above. Styling swapped from the source's dedicated
CSS classes (`.analysis-panel`, `.peak-waveform`, `.button-row`, etc. —
none of which exist in this app) for the `stack`/`row`/`muted`
inline-style conventions already used throughout `ShadowPage.tsx`/
`LiveShadowWaveform.tsx`.

**Wired into `ShadowPage.tsx`**: each past attempt gets an "Analyze"
toggle button (next to Alternate/Dual-ear) that opens the panel inline
below that attempt's row; `hasReading` derived from
`sentence.readingOnly`/`inlineReading`; passes the page's current
`targetRange` state through automatically.

New unit tests: `tests/waveform.test.ts` gained coverage for
`energyEnvelope`/`detectOnsetSeconds`/`crossCorrelateOffset` — validated
against synthetic silence/tone-burst signals with a known onset time and
a known cross-correlation lag (a pure constant-amplitude tone turned out
to be a bad test signal for the *energy-envelope*-based correlation,
since it has no distinctive energy structure to align against — caught
by an initial failing test, fixed by using a burst signal instead, not a
bug in the ported algorithm itself). `tests/timingObservations.test.ts`
covers the confidence/observation-building logic directly.
`tests/shadowPage.test.tsx` gained a test that opens/closes the panel.
`npm run check` — 449 passed, 2 skipped (pre-existing), 0 failed.

**Manually verified in a real browser** (chromium, no fake-device flags
needed this time since there's no mic involved) — seeded a 3s/220Hz
reference tone and a 2.5s/260Hz attempt tone, each with a real silent
onset (200ms silence before the tone) so onset detection had something
genuine to find. Opening the panel produced a correct, verifiable
result: duration ratio computed as 0.83, exactly matching 2.5s ÷ 3s;
switching to onset-aligned mode correctly reduced the offset to ~0.00s
(both clips share the same 200ms silence prefix, so their onsets should
align); 2 observation articles rendered (duration-ratio, since 0.83
differs from 1 by more than the 12% threshold; pitch-register, since
both clips had a detectable median pitch); switching pitch display mode
and alignment mode both re-ran cleanly; zero console errors throughout.
This is stronger evidence than prior Phase 8 browser checks — the
computed numbers themselves matched known ground truth, not just "no
errors."

### 8.5 — Polish bundle: done, verified — **Phase 8 fully complete**

The last item of Phase 8's original plan. Small and additive, done
together per the plan's own note rather than split further.

- **`isFavorite?: boolean`** added to the `Attempt` type — no Dexie
  schema/migration needed (the `attempts` store already wasn't indexed on
  this field's siblings like `notes`; additive fields on a local-only
  table are free). New `setAttemptFavorite` repository function mirrors
  the existing `rateAttempt` pattern. "Favorite"/"Unfavorite" button per
  attempt row; a ★ marker next to favorited attempts' timestamp.
- **Notes on save**: `saveAttempt` already accepted an optional `notes`
  field (present in the `Attempt` type since Phase 3, just never wired to
  any input) — added a "Notes (optional)" text input on the draft-attempt
  preview, passed through on save, cleared on save/discard/sentence
  change. Saved notes render under the attempt's timestamp/duration line.
- **Hide/show transcript**: a toggle button swaps the Japanese sentence
  display for an "Audio-only practice" placeholder — lets a learner
  practice by ear only, without seeing the text.
- **Not ported**: the source's "default comparison to the favorited (or
  else most-recent) attempt" behavior. That only makes sense for the
  source app's UI shape (pick one attempt from a dropdown, then act on
  "the selected attempt") — this app's `ShadowPage.tsx` already lets you
  trigger Alternate/Dual-ear/Analyze on *any* attempt row directly, so
  there's no single "current attempt" to default. Skipped as
  inapplicable rather than force-fit.

New unit tests: `tests/data.test.ts` gained `setAttemptFavorite`
toggle/unknown-id coverage and a notes-persistence test.
`tests/shadowPage.test.tsx` gained tests for the transcript toggle and
the favorite/unfavorite flow, plus the existing smoke test now also
asserts a saved note renders. `npm run check` — 453 passed, 2 skipped
(pre-existing), 0 failed. **Manually verified in a real browser**
(chromium, no special flags needed): hide transcript correctly swapped
the display and back; favoriting/unfavoriting correctly toggled the
button label and ★ marker; zero console errors.

**Phase 8 — Shadowing feature parity + practice-target isolation — is
now fully complete** (8.1 through 8.5, all manually verified in a real
browser). The two items flagged throughout as deliberately deferred
stretch goals (word/mora-precise practice-target isolation via a revived
mora timing guide; the source's per-page "default comparison attempt"
concept, ruled inapplicable above) remain open but don't block anything
— revisit only if a concrete need shows up.

### Background (planning done 2026-08-16, before 8.1 started)

The user flagged that Phase 3 (2026-08-14) shipped a narrower shadowing
practice experience than the original standalone `~/projects/shadowing/web`
app it was ported from, and asked for feature parity plus improvements.
This section is the result of a direct file-by-file comparison
(2026-08-16) — read before starting any of 8.x so the research doesn't
need repeating.

**Compared**: `~/projects/shadowing/web/src/pages/SentencePage.tsx` (653
lines, the original app's practice page) against this repo's
`src/pages/ShadowPage.tsx` (300 lines). Phase 3's own notes already flagged
two of the gaps below as deliberately deferred ("to be ported together
with their consumer once the core loop is in daily use") — the other gaps
were only found by this pass's closer read.

**Missing, worth porting, recommended order**:

1. **Playback speed control** (`SpeedControl` in the original;
   `PLAYBACK_SPEEDS` constant in `shadowing/web/src/services`). Applies to
   reference and comparison playback (`audio.playbackRate`, with
   `preservesPitch = true` so slowing down doesn't drop pitch — matters
   for a pitch-accent-relevant app). Small, self-contained, good first
   slice to re-familiarize with this code.
2. **Practice-target isolation** (new — not a port, added 2026-08-16 at
   the user's request: "the ability to isolate smaller phrases or words to
   practice and compare shadowing against smaller targets... helpful as a
   beginner"). Neither app has this ready-made; two design options,
   investigated against `shadowing/web`'s existing building blocks:
   - **Recommended first cut — manual loop-point marking**: let the
     learner drag/tap two handles on the reference clip's own timeline
     (or play-and-tap "mark start"/"mark end" while listening) to carve
     out an arbitrary sub-range, no forced alignment or word-boundary
     data needed. Loop reference playback within that range; scope the
     next recording + comparison (alternate/dual-ear, and 8.4's pitch
     panel once it exists) to just that range too. Small: a start/end
     time pair is the only new state, plausibly not even persisted at
     first (recompute per session) or stored as two optional fields on
     `Attempt` (`targetStartMs`/`targetEndMs`) if remembering the last
     target per sentence turns out to matter. Entirely new code, not a
     port — no dependency on anything else in this phase.
   - **Deferred, more precise option — word/mora-level selection**: the
     original's **mora timing guide** (`TimingGuideService`,
     `seedMoraUnits` in `analysis/japanese.ts`) turns out to be exactly
     the missing piece for *word*-boundary-precise isolation, which this
     doc's first pass wrongly dismissed as low-value (see the reversed
     note in "recommended against porting" below) — each mora gets a
     start/end time, so a word/phrase's range is just its component
     morae's span. The catch: `seedMoraUnits` only heuristically
     estimates timing (uniform slice = `duration / moraCount`, no real
     forced alignment), accurate enough only after the learner manually
     drags each marker into place while listening — real but nontrivial
     per-sentence setup cost. Worth doing later if manual loop-marking
     turns out too coarse or fiddly for consistently hitting a specific
     word; skip unless that need actually shows up.
3. **Live shadow waveform + shadow-mode recording + mic calibration**.
   Not ported at all in Phase 3 (`src/lib/recording.ts`'s port comment
   lists exactly what was skipped: `calibrateMicrophone`,
   `playReferenceForShadowing`, `ShadowReferencePlayer`,
   `stopShadowReference` — all in
   `~/projects/shadowing/web/src/services/recording.ts`). Also needs
   `~/projects/shadowing/web/src/components/LiveShadowWaveform.tsx` (242
   lines) ported as a new component. Mechanism: build one Web Audio graph
   (mic `AnalyserNode` + reference playback) *before* drawing, so a
   second `AudioContext` can't chop the recording's opening sound — see
   `SentencePage.tsx`'s `startRecording()` comment on this exact ordering
   requirement, it's a real gotcha, not incidental structure. Also add a
   "Calibrate mic" button (`calibrateMicrophone()` returns a guidance
   string list to render). No dependency on item 4.
4. **Pitch/waveform comparison analysis** (`AnalysisPanel.tsx`, 216
   lines) — the biggest single piece. Needs
   `~/projects/shadowing/web/src/analysis/{pitch,japanese,waveform,audio}.ts`
   (102–134 lines each, real audio DSP — pitch-contour extraction/
   comparison) ported to `src/lib/`. Renders reference-vs-attempt pitch
   contours after a comparison playback. Independent of item 3
   (`AnalysisPanel` takes `referenceAssetId`/`learnerAssetId` and loads
   its own buffers) — only sequenced after it here because re-reading the
   simpler audio code in item 3 first should make this DSP port less
   error-prone, mirroring how Phase 7.9b's conjugation port went
   smoothly after several earlier phases' worth of familiarity with this
   codebase's conventions. If item 2's practice-target isolation landed
   first, this should honor the selected sub-range too (compare pitch
   contours over just that window), not just whole-sentence audio.
   **Before starting**: check whether `shadowing/web` has its own tests
   for these analysis functions (`tests/` in that repo) — Phase 7.9b's
   conjugation port validated cleanly against the source's own fixture
   set on the first try; the same approach (port + validate against
   existing fixtures, don't re-derive correctness from scratch) should
   apply here if fixtures exist.
5. **Polish bundle** (small, low-risk, do together): hide/show transcript
   (audio-only practice toggle), a notes field on a draft attempt before
   saving, favorite-marking on saved attempts, and defaulting comparison
   to the favorited (or else most-recent) attempt. All straightforward
   UI-state additions to `ShadowPage.tsx`/`Attempt`
   (`isFavorite`/`notes` fields would need adding to the `Attempt` type
   and Dexie schema — check `~/projects/shadowing/web/src/types.ts`'s
   `Attempt` shape for the exact fields to add, additive/no migration
   risk since `attempts` is already a local-only, non-synced table per
   Phase 3's notes).

**Deliberately recommended against porting** (flag to the user again
before building if this judgment turns out wrong):
- **Chunk practice** (pipe-separated text chunks, `saveChunks`/
  `practiceChunks` in the original) — this app already has a much richer
  chunk/role structural-analysis engine (Cure Dolly chunks, `AnalyzePage`/
  `ChunkPuzzleStrip`); porting a second, unrelated "chunk" concept under
  the same name would likely confuse rather than help.
- **Mora timing guide** (editable per-mora timing markers,
  `TimingGuideService`) — **reversed 2026-08-16**: this doc originally
  called it low-value with no integration point; it turns out to be the
  natural foundation for word-precise practice-target isolation (item 2
  above). Still not recommended as a *first* build — start with item 2's
  simpler manual loop-marking, and only port this if that turns out too
  imprecise for reliably targeting a specific word.
- **Manual reference-audio attach/replace/remove from the practice page**
  (`ReferenceAudioService.attach`/`remove`, file upload UI) — in the
  original app this was the *only* way to get reference audio onto a
  sentence; here, reference audio already arrives via the shadowing-ZIP
  import pipeline (Phase 2/3) for the sentences that have it. Worth
  reconsidering only if it turns out learners want to add ad-hoc
  reference clips to sentences that weren't imported with one.

This was planning only at the time it was written, done at the user's
request so a fresh session could pick it up without re-deriving the
comparison above — see the "8.1" through "8.4b" entries earlier in this
Phase 8 section for what's actually been built so far. **Phase 8's
entire original planning scope (items 1-4) is now done** — only 8.5
(polish bundle: hide/show transcript, attempt notes, favorite-marking)
remains, plus the two deliberately-deferred stretch items (word/mora-
precise practice-target isolation via a revived mora timing guide) noted
throughout this section, neither of which blocks anything.

## Phase 9 — Shadowing pronunciation/prosody feedback: Milestone 1 done

New work, from a detailed user design brief: after shadowing a native
recording, identify the single most useful reference-vs-learner difference
(timing, pitch, rhythm) and let the user immediately practice just that
segment, reusing the existing shadowing UI rather than building a second
parallel system. Full brief covers 9 milestones (forced alignment, mora/pitch
comparison, ranked "fix one thing" feedback, ASR, history, PASQA); this pass
is Milestone 1 only, per the brief's own instruction to ship small,
reviewable increments rather than one giant change.

**Investigation before building** (per the brief's explicit Phase-1
requirement to inspect first): this repo's shadowing module was already far
more built out than the brief assumed — Phase 3 + Phase 8 (above) already
ship recording, mic calibration, alternate/dual-ear A/B comparison,
pitch-preserving playback speed, manual loop-point marking (`targetRange` in
`ShadowPage.tsx`) that scopes both playback and analysis to a sub-range, YIN
pitch extraction already speaker-normalized to semitones (`src/lib/pitch.ts`),
onset-detection/cross-correlation alignment (`src/lib/waveform.ts`,
`analyzeAlignment`), and a `TimingObservation[]` feedback model with
high/medium/low confidence and hedged language (`src/lib/timingObservations.ts`,
rendered in `src/components/AnalysisPanel.tsx`). The brief's philosophy
(confidence levels, no fake precision scores, normalized pitch) was already
largely in place. Missing relative to the brief: mora-unit segmentation
(explicitly deferred in existing code comments), real forced-alignment time
boundaries, ranked/prioritized feedback, ASR, pronunciation history, PASQA.

**Architecture decision** (confirmed with the user this session): the
repo's documented architecture is "no new backend service, static hosting +
Supabase only" (`docs/UNIFIED_APP_ARCHITECTURE.md`), but the brief assumes a
Hetzner server for the heavier analysis (forced alignment, ASR). Asked the
user directly; confirmed **the machine this session runs on is that Hetzner
server** — a 4 vCPU / 7.6 GB RAM / 57 GB-free-disk Ubuntu 24.04 vServer,
already running personal infrastructure for this app ecosystem: VOICEVOX TTS
(Docker) fronted by a small FastAPI wrapper
(`~/projects/voicevox-tts-api`, `uvicorn` on `127.0.0.1:8001`), exposed to
the user's **Tailscale tailnet only** via `tailscale serve` at
`https://codex-dev.tailfbd89c.ts.net` (confirmed tailnet-only, not a public
Funnel; the user's iPhone is already an active tailnet member). This is the
pattern later milestones will extend for a new pronunciation-analysis
service, rather than inventing new infrastructure — see the roadmap below.
Researched MFA and faster-whisper Japanese feasibility on this box before
committing to the path: MFA has real pretrained Japanese acoustic models
(`japanese_mfa` v2/v3, CC BY 4.0) and a matching dictionary; faster-whisper's
`small` model runs in ~2 GB RAM at ~6x real-time on CPU. Both fit this box's
budget for single-user, occasional use. Also researched PASQA (a
pitch-accent-focused Japanese speech quality model): real code + weights
exist (`github.com/lycorp-jp/PASQA`, CC0), standalone learner-audio scoring
with an auxiliary accent-error-localization signal, CPU-capable, needs a
katakana mora sequence as input — a real candidate for a later, feature-flagged
milestone, not blocking anything now.

**Key simplification found while scoping Milestone 1**: the brief's core
Japanese-specific requirement — mora-unit segmentation (ちょっと →
ちょ|っ|と, not one-kana-one-unit) — turns out to need no server at all,
because this app already stores a kana reading for most sentences
(`Sentence.inlineReading` Satori-style `小鳥[ことり]` markup, already parsed
by `src/lib/parseInlineReadings.ts` for furigana rendering; or
`Sentence.readingOnly`, a whole-sentence reading string).
`AnalysisPanel.tsx`/`ShadowPage.tsx` already gate confidence on
`hasReading = Boolean(sentence.readingOnly || sentence.inlineReading)`. Mora
segmentation from an existing reading is a deterministic pure function, so
Milestone 1 shipped as a small, fully client-side, immediately-testable
change with no new infrastructure.

Added:
- `src/lib/mora.ts` — `segmentIntoMorae(reading)`, standard Japanese mora
  rules: small y-kana/vowel-kana (ゃゅょ/ゎ and katakana equivalents, plus
  small vowels used in loanword combinations like ファ/ティ) merge into the
  *preceding* unit; everything else (including っ/ッ, ん/ン, and long-vowel
  ー) naturally becomes its own unit under "one kana starts one unit unless
  it's a small kana". Reproduces the brief's own worked examples exactly:
  ちょっと → ちょ|っ|と, がっこう → が|っ|こ|う, きょう → きょ|う. Each unit
  is tagged `sokuon`/`moraic-n`/`long-vowel-mark`/`normal` so later
  milestones can target messages at the right units (e.g. "your っ was
  short"). Non-kana characters (punctuation, stray kanji) are skipped, not
  thrown on. `getSentenceReadingForMora(sentence)` resolves the best
  available reading — prefers `inlineReading` (parsed via the existing
  `parseInlineReadings`, preserving real word boundaries as `wordIndex` on
  each mora unit — useful for a later milestone's "propose a sensible loop
  range around this word"), falls back to `readingOnly`, returns `null` when
  neither exists (same gating precedent as `hasReading` elsewhere).
  `MORA_SEGMENTATION_VERSION` — a plain version constant, the minimal honest
  start on the brief's `analysis_version` requirement. Deliberately no Dexie
  table/caching yet: mora segmentation is cheap and deterministic
  (recompute on render), matching `AnalysisPanel.tsx`'s existing precedent
  of recomputing short-clip analysis on demand rather than persisting it.
  Caching starts earning its complexity in Milestone 2, once a real,
  network-dependent, expensive alignment result needs to survive across
  renders.
- `src/pages/ShadowPage.tsx` — a `MoraBreakdown` row renders the sentence's
  mora chips next to the transcript (hidden together with it under "Hide
  transcript", since showing it would defeat audio-only practice; absent
  entirely when the sentence has no reading data, no empty-state clutter).
  `src/styles/global.css` — two small CSS rules distinguishing
  sokuon/moraic-n/long-vowel chips by style (`data-kind` attribute selector,
  no legend needed, glanceable on a phone).
- Tests: `tests/mora.test.ts` (new, pure — the brief's own worked examples
  plus ん-final, long-vowel, katakana small-vowel-merge, punctuation, and
  empty-input edge cases; `getSentenceReadingForMora` precedence/fallback
  cases). `tests/shadowPage.test.tsx` gained coverage for the mora row
  appearing with reading data, hiding with the transcript, and being absent
  without reading data.

**Verified**: `npm run check` (typecheck + vitest) green — 486 tests passed,
2 pre-existing skips (unrelated), including 13 new `mora.test.ts` tests and
2 new `shadowPage.test.tsx` tests. **Not manually verified in a real
browser** this session — no browser available in this environment (same
constraint noted in earlier phases); the `npm run dev` server itself was
smoke-tested (starts cleanly, serves the page). Real-browser check still
recommended before considering Milestone 1 fully proven, consistent with
this project's existing practice.

## Phase 9 Milestone 2a — forced-alignment service (server-side only): done

Stood up the new sibling service, `~/projects/shadowing-analysis-api`, on
the Hetzner box identified in Milestone 1. Server-side only in this pass —
no `jp_sentence_splits` frontend code touched (no fetch client, no Dexie
caching, no `ShadowPage.tsx`/`AnalysisPanel.tsx` wiring). That's Milestone
2b, a deliberate follow-up once this service was proven to actually work.

**Real, hands-on findings that changed the design from what was planned**:
- MFA genuinely needs conda (Kaldi bindings/`kalpy` and `pynini` aren't
  portable pip wheels) — installed Miniforge to `~/miniforge3` (user-level,
  no root) and created a `mfa` conda env with `montreal-forced-aligner`,
  `openfst` (had to be installed explicitly — `mfa align` initially failed
  with `ThirdpartyError: fstcompile` even though the conda package was
  present, because the CLI wasn't being invoked through an activated
  environment), and `spacy`/`sudachipy`/`sudachidict-core` (MFA's own
  Japanese tokenizer, which turned out to handle raw untokenized Japanese
  text correctly — no separate fugashi/UniDic tokenization step needed in
  this service after all, simpler than Milestone 1's roadmap note assumed).
  Downloaded `japanese_mfa` acoustic model (v3_0_0) and matching dictionary.
- **The originally-planned "shell out to `mfa align` per request" design
  was measured and rejected**: a full `mfa align` corpus run costs
  ~155-165s per invocation regardless of clip length (corpus/database
  setup, lexicon FST compilation, worker spin-up, all fixed overhead); the
  lighter `mfa align_one` (no corpus database) is still ~45-50s. Both are
  unusable for an interactive "record, then see feedback" loop. Found and
  switched to `montreal_forced_aligner.online.alignment
  .align_utterance_online` — a lower-level, warm, in-process API meant for
  single-utterance alignment. Loading the acoustic model + compiled lexicon
  + tokenizer once costs ~40s (dominated by lexicon FST compilation);
  every alignment after that is **~1-3s**. This is the single biggest
  design change from the approved plan, discovered during the plan's own
  "spike, go/no-go" step — confirmed as a strict improvement (same output,
  far less latency), not a scope change, so implementation continued
  without pausing for new sign-off.
- Alignment quality on a self-synthesized test sentence
  (`今日はちょっと寒いですね`, via the already-running `voicevox-tts-api`)
  looks genuinely good: plausible word boundaries for all six words, and
  the phone tier correctly shows a held consonant (`tː`, IPA length mark)
  for っ in ちょっと — direct, ready-to-use evidence for exactly the kind
  of feedback the brief wants ("your っ is shorter than the reference").
  **Go decision confirmed** — proceeded to build the service.

Added (`~/projects/shadowing-analysis-api`, new sibling git repo, not yet
committed):
- `app/aligner.py` — the warm, lazy-loaded (on first `/align` call, not at
  process start, so `systemd` startup itself stays fast) aligner. A
  `threading.Lock` serializes both lazy construction and every `align()`
  call — kalpy's aligner/lexicon aren't documented as safe for concurrent
  use, and for a single-user personal service serialized ~1-3s alignments
  cost nothing real. Strips kalpy's internal position-dependent phone
  disambiguation suffix (e.g. `tɕ(46)` → `tɕ`) before returning.
- `app/audio.py` — `ffmpeg` subprocess transcode (any container → 16 kHz
  mono WAV); `ffmpeg`/`ffprobe` were already installed on this host, no new
  system dependency.
- `app/main.py` — `GET /health` (cheap — file-existence + in-memory-loaded
  checks, never forces a model load) and `POST /align` (multipart
  audio + transcript → word intervals with nested phone intervals, JSON).
  No CORS/auth yet (documented `TODO`, deferred to Milestone 2b when the
  real frontend origin is known); safe only because of tailnet-only network
  exposure (below).
- Tests (`~/miniforge3/envs/mfa/bin/python3 -m pytest`, mirroring
  `voicevox-tts-api`'s monkeypatch-the-boundary convention): 12 fast tests
  (`test_health.py`, `test_align.py` mocking `app.aligner`/`app.audio`,
  `test_audio.py` against real `ffmpeg` with a tiny synthetic WAV) run in
  ~2.6s with no MFA models needed. One `slow`-marked real end-to-end test
  (`test_integration_alignment.py`) synthesizes its own fixture via
  `voicevox-tts-api` (no checked-in audio) and asserts the exact expected
  word sequence plus the っ length-mark signal; skips automatically if
  models/VOICEVOX aren't available. **All 13 tests pass** (fast suite
  2.61s; the slow test 45.69s, matching the ~40s one-time load).
- `~/.config/systemd/user/shadowing-analysis-api.service` (also checked
  into the repo) — a **user-level** unit, not system-wide: I do not have
  passwordless `sudo` on this host, which rules out a root-owned
  `systemd` service. `systemctl --user enable --now` works without root.
  Verified running (`systemctl --user status`) and serving real requests
  end-to-end over HTTP (curl), first request 42.5s (cold load), second
  request 1.58s (warm) — matches the in-process spike measurements exactly.
  Boot persistence needs `loginctl enable-linger`, which does need root —
  documented in the new repo's README as a one-line command for the user
  to run themselves, not attempted here.
- `README.md` in the new repo, mirroring `voicevox-tts-api/README.md`'s
  structure (why conda not pip, why warm in-process not CLI-subprocess,
  install/run/config/API docs, tailnet-only exposure note).

**Tailnet exposure — done.** Writing the `tailscale serve` config needed
either root or being the tailscale "operator" (reading status, tried
earlier, needed neither — a different permission tier than writing). The
user ran `sudo tailscale set --operator=ed` once; after that,
`tailscale serve --bg --set-path /shadowing-analysis http://127.0.0.1:8002`
succeeded and coexists with the existing `/` → 8001 VOICEVOX mount
(confirmed via `tailscale serve status`, both listed). Verified over the
real tailnet HTTPS hostname, not just localhost:
`curl https://codex-dev.tailfbd89c.ts.net/shadowing-analysis/health` and
the existing `.../health` (VOICEVOX) both respond correctly side by side.

**Phase 9 Milestone 2a is now fully done.**

**Resource footprint observed** (Phase 20's requirement to document this
per new dependency): `mfa` conda env + models, roughly a few GB on disk
(exact size not yet measured precisely — worth a follow-up `du -sh` note);
CPU-only throughout (no GPU used or required); the running service's RSS
after the models are loaded was ~189 MB at idle in the `systemctl --user
status` output above (before the first `/align` call — will grow once the
acoustic model/lexicon are actually loaded into memory, not yet measured
post-load). All well within this box's 7.6 GB RAM / 4 vCPU / 57 GB-free
budget, alongside the existing VOICEVOX Docker container and TTS wrapper.

**Not done in this pass, still open**: git commit for the new repo (not
requested yet); Milestone 2b (`jp_sentence_splits` frontend wiring — fetch
client, offline fallback, Dexie caching, `ShadowPage.tsx`/`AnalysisPanel.tsx`
integration, CORS).

## Phase 9 Milestone 2b — frontend wiring: done

Wires the `shadowing-analysis-api` service (Milestone 2a) into the actual
shadowing UI. Scope deliberately kept tight, matching every prior
milestone: fetch + cache real word/phone alignment for both the reference
clip and a learner attempt, surface it minimally in `AnalysisPanel.tsx` as
proof it works end-to-end. Turning alignment into ranked feedback messages
is still Milestone 3, not started.

Added:
- `src/appConfig.ts` — `SHADOWING_ANALYSIS_API_BASE`, a hardcoded constant
  (not an env var) pointing at the tailnet-only service, following the
  exact precedent of the existing `ICHI_MOE_BASE` — it's not a secret and
  doesn't differ between dev/prod.
- `src/lib/analysisApi.ts` — `alignAudio(blob, transcript)`, a `FormData`
  multipart POST to `/align` with a 60s `AbortController` timeout (covers
  the ~45s cold-load case measured in Milestone 2a with margin). **Never
  throws** — returns `null` on any failure (network error, non-200, bad
  JSON, unexpected shape, timeout) so every caller can treat an
  unreachable server as the ordinary, expected condition it is, not an
  error state. `ALIGNMENT_VERSION = 1`, the same versioning precedent as
  Milestone 1's `MORA_SEGMENTATION_VERSION`.
- `src/domain/types.ts` — `PhoneAlignment`/`WordAlignment`/`AlignmentResult`
  (mirroring the service's JSON exactly — it already returns camelCase, no
  transform layer needed) and the two cache-row types,
  `ReferenceAlignment`/`AttemptAlignment` (local-only, same precedent as
  `Attempt` — derived/recomputable data, not worth syncing).
- `src/db/database.ts` — schema `version(9)`: `referenceAlignments: 'id'`,
  `attemptAlignments: 'id'`. This is the first genuinely expensive,
  network-dependent analysis step in this app, so — per the Milestone 1
  plan's own reasoning — the first one where a real persistent cache earns
  its complexity (`AnalysisPanel`'s existing local pitch/waveform analysis
  deliberately still recomputes on every open; that precedent is
  unchanged).
- `src/db/repository.ts` — `getReferenceAlignment`/`saveReferenceAlignment`,
  `getAttemptAlignment`/`saveAttemptAlignment`. A mismatched
  `alignmentVersion` is treated identically to a cache miss (Phase 19's
  versioning requirement) — callers can't tell the difference between
  "never computed" and "stale," which is the correct behavior since both
  cases need a refetch.
- `src/components/AnalysisPanel.tsx` — new required `referenceAudioId`/
  `attemptId`/`transcript` props. A **separate** `useEffect` from the
  existing local-analysis one, so a slow/cold/unreachable server call
  never delays the already-fast local pitch/waveform results from
  rendering (verified manually — see below). Checks the Dexie cache first,
  calls `alignAudio` on a miss, saves a successful result. Renders a
  "Word timing (server)" section — a chip row per word with its duration
  (`WordTimingRow`), reusing `ShadowPage.tsx`'s Milestone-1 `MoraBreakdown`
  chip styling rather than inventing a new visual pattern; silence
  intervals (`<eps>`) are filtered out of the visible row. Renders nothing
  at all when the server alignment is `unavailable` — no error banner, no
  alarming state, matching the plan's explicit "required graceful
  fallback" rule (an unreachable service is expected, not exceptional).
- `src/pages/ShadowPage.tsx` — passes `referenceAudioId`/`attemptId`/
  `transcript={sentence.japanese}` through to `AnalysisPanel`. `/align`'s
  `transcript` takes plain Japanese text directly — no reading/
  tokenization needed client-side, since MFA's own tokenizer handles raw
  text (confirmed in the Milestone 2a spike).
- `~/projects/shadowing-analysis-api` — added `CORSMiddleware`
  (`app/config.py`'s new `ALLOWED_ORIGINS`, `app/main.py`), allow-listing
  the real deployed frontend origin (`https://efancher.github.io`,
  confirmed via `gh api repos/efancher/jp_sentence_splits/pages`) plus
  local dev origins. Restarted the `systemd --user` service to pick up the
  change; verified live over the tailnet with `curl -H "Origin:
  https://efancher.github.io"` against both `/health` and a real `/align`
  call — `Access-Control-Allow-Origin` present on both. New
  `tests/test_cors.py` (allowed origin gets the header, an unlisted origin
  doesn't).

Tests: `tests/analysisApi.test.ts` (new — mocked `fetch`: success,
non-200, network-error, malformed-JSON, unexpected-shape, and
aborted/timeout cases all handled, confirming `alignAudio` never throws).
`tests/data.test.ts` — round-trip + staleness tests for the four new
repository functions. `tests/migration.test.ts` — v9 round-trip for both
new stores. `tests/shadowPage.test.tsx` — mocks `analysisApi.alignAudio`
directly (via `vi.mock`, matching this file's established pattern from
other externally-dependent modules) to assert the "Word timing (server)"
section appears when the service resolves and stays completely absent
(with the rest of the panel — local pitch/waveform analysis — working
exactly as before) when it resolves to `null`, proving the required
fallback behavior at the component level, not just the fetch-client level.

**Verified**: `npm run check` (typecheck + vitest) green — 498 tests
passed, 2 pre-existing skips (unrelated), including all new/extended
tests above. Real end-to-end verification against the live service (not
just mocks): `curl`'d `/align` directly against
`https://codex-dev.tailfbd89c.ts.net/shadowing-analysis` with a real
VOICEVOX-synthesized clip and got back real word/phone timing with CORS
headers present for the deployed origin. **Not manually verified in a
real browser** — no browser available in this environment (same
constraint noted throughout this project); the actual UI round-trip
(open Shadow view, Analyze, see the "Word timing (server)" chips appear)
still needs a real-browser check before this is considered fully proven,
consistent with this project's existing practice for UI-facing changes.

## Phase 9 Milestone 3 — mora/rhythm timing feedback: done

Turns Milestone 2b's raw word/phone timing into the kind of specific,
actionable message the whole project is about — "Your 「っ」 in 「ちょっと」
is much shorter than the reference," not a score.

**Design finding that simplified this milestone**: originally assumed
this would need cross-referencing Milestone 1's mora-unit segmentation
(keyed to the sentence's *reading*) against MFA's per-word phone data.
That turns out to be unreliable — MFA's word tier returns words in their
**original orthographic form** (confirmed from real output: `今日`, `は`,
`ちょっと`, not readings), tokenized by MFA's own Sudachi-based tokenizer,
a different segmentation than Satori's furigana-word segments Milestone
1's `wordIndex` is keyed to. The two tokenizations don't reliably line up
word-for-word. **Better approach, needs no cross-tokenization at all**:
MFA's phone labels already mark phonetic length directly with an IPA
length mark (`ː`) — a held/geminate consonant (the actual acoustic
realization of っ, which has no phone symbol of its own) or a long vowel,
distinguishable by a small known vowel-symbol set
(`src/lib/wordTimingObservations.ts`'s `isVowelPhoneBase`). No mora
alignment, reading, or orthography needed — more robust, and arguably
more honest than a fragile syllable-split, since gemination is genuinely
ambiguous about which mora it "belongs to" phonetically.

Added:
- `src/lib/wordTimingObservations.ts` — `findLongPhones` (classifies
  length-marked phones as vowel/consonant), `pairWords` (pairs reference
  and learner words after filtering silence; pairs by index in the common
  case of matching counts, falls back to a short-lookahead resync walk
  when a word was inserted/dropped, so one mismatch doesn't throw off
  every pair after it), `buildWordTimingObservations` (reuses the
  existing `TimingObservation` type from `timingObservations.ts` rather
  than inventing a parallel one). Two observation kinds: whole-word
  duration ratio (`word-duration`, notable only above both a relative
  *and* absolute threshold — avoids flagging tiny particles where a small
  absolute difference produces a large ratio), and long-phone duration
  comparison (`sokuon_timing`/`long_vowel_timing`, matched by kind and
  position-within-kind between reference and learner). Confidence is
  `'high'` for a stark ratio (matching the brief's own Phase 12 example of
  a measured-duration claim being high-confidence) and `'medium'`
  otherwise; near-matches produce no observation at all (silence, not a
  "this is fine" note — with several words per sentence, spelling out
  every close match would be noisy).
- `src/components/AnalysisPanel.tsx` — a new "Segment timing" section,
  populated once both reference/learner server alignment are ready,
  visually separate from the existing local-analysis observations list.
  Milestone 5/6 (ranking / "Fix One Thing") is what eventually merges
  everything into one prioritized view; this milestone stays additive,
  matching every prior one's scope discipline.

Tests: `tests/wordTimingObservations.test.ts` (new, pure) — the brief's
own worked example reconstructed from real observed `japanese_mfa` phone
labels (ちょっと as `tɕ/o/tː/o`), both confidence tiers for the long-phone
case, the word-duration-ratio case, the tiny-particle-noise-suppression
case, the near-match-produces-nothing case, and the resync-past-an-
inserted-word pairing case. `tests/shadowPage.test.tsx` — pre-seeds the
Dexie alignment cache directly with distinct reference/learner results
(rather than trying to distinguish an `alignAudio` mock call by blob
content — Dexie-round-tripped Blobs in this test environment lose their
real methods, a pre-existing, documented quirk) and asserts the exact
"Your 「っ」... is much shorter" message renders.

**Verified**: `npm run check` green — 509 tests passed, 2 pre-existing
skips (unrelated). `npm run build` clean. **Not manually verified in a
real browser** — no browser available in this environment, same
constraint noted throughout this project.

## Phase 9 Milestone 4 — pitch-contour timing feedback: done

Compares *where in time* pitch movement happens, word by word, using
Milestone 2b/3's real word alignment to scope each word's pitch frames —
not just the aggregate median-register comparison
`timingObservations.ts` already did (that comparison is unchanged and
still runs). Directly implements the brief's flagship example: "Your
pitch drop occurs later than the reference around 「見に」."

Added `src/lib/pitchTimingObservations.ts`:
- `classifyTrend` — per word, per side: average the first third vs. last
  third of voiced, in-range pitch frames (`relativeSemitones`, already
  speaker-normalized by `pitch.ts`); a word with fewer than 4 voiced
  frames is `'unclear'` and produces no observation (mirrors this app's
  existing signal-strength gating elsewhere, e.g.
  `confidenceFromSignal`'s `voicedRatio` check). A difference under 1
  semitone is `'flat'`.
- When reference and learner **agree** on trend direction (both falling
  or both rising), find each side's turning point (the peak for a fall,
  the trough for a rise — specifically the *last* frame at the extreme
  value, so a brief plateau at the peak is measured as "just before it
  fell," not "the first moment it happened to reach that height" — a
  real bug caught by this milestone's own tests before being fixed) as a
  0-1 fraction of the word's voiced span, and flag a >0.25 fraction
  offset as `"Your pitch {drop/rise} occurs {later/earlier} than the
  reference around 「word」."`, confidence `'medium'` (matches the
  brief's own Phase 12 example of this exact message being
  medium-confidence).
- When trends **disagree** in direction, a lower-confidence, more
  general `"Your pitch {falls/rises/stays level} during 「word」 where the
  reference {falls/rises/stays level}."`, confidence `'low'` — per the
  brief's explicit caution to hedge here rather than imply a linguistic
  pitch-accent judgment.
- Handles `targetRange`-sliced reference audio correctly: reference word
  timestamps are in the *full clip's* time base, but reference pitch may
  have been extracted from a `targetRange`-sliced clip (Phase 8.2) whose
  own clock starts at 0 — `referenceTimeOffsetSeconds` (`AnalysisPanel`
  passes `targetRange.startMs / 1000`) translates between the two.
  Learner audio is never sliced, so it needs no offset. Getting this
  coordinate-space mismatch right (rather than silently comparing frames
  from the wrong time ranges) was worth the extra parameter — a version
  of this milestone that ignored `targetRange` entirely would have
  silently produced wrong results for a common use case (practicing an
  isolated sub-phrase) rather than an obviously-broken one.

`src/components/AnalysisPanel.tsx` — new "Pitch movement" section,
additive alongside "Segment timing" and the existing local-analysis
observations (same scope discipline as every prior milestone — ranking
everything together is Milestone 5/6).

Tests: `tests/pitchTimingObservations.test.ts` (new, pure) — later/
earlier drop detection, the shape-mismatch case, the
close-enough/no-observation case for both matching-trend and
both-flat pairs, the too-few-frames case, and the `targetRange` offset
case. No new integration test in `shadowPage.test.tsx`: the existing
local pitch/waveform analysis effect already silently fails under this
project's test environment (no real `AudioContext`/`decodeAudioData` in
jsdom — a pre-existing, documented boundary, not something this
milestone introduced), so `referencePitch`/`learnerPitch` never populate
in that test run today; asserting a "Pitch movement" section render
would be testing environment behavior, not this feature's logic. Real
coverage is the 7 unit tests plus a real-browser check (not yet done,
same recurring caveat as every UI-facing change in this project).

**Verified**: `npm run check` green — 516 tests passed, 2 pre-existing
skips (unrelated). `npm run build` clean.

## Phase 9 Milestone 5/6 — feedback ranking + "Fix One Thing": done

The brief's own centerpiece: rank the (potentially half a dozen)
observations from Milestones 1-4 and surface **one** "Focus on this"
issue, with practicing it one tap away — reusing the existing loop/A-B
mechanism (`targetRange`, Phase 8.2) rather than a second practice
workflow, per the brief's explicit instruction.

Deliberately scoped down: automatic "✓ Much closer" comparison after a
re-record is **not** included — that needs persisted attempt history to
compare against, which is Milestone 8's territory. This pass: rank →
surface one → one-tap practice segment.

Added:
- `TimingObservation` (`src/lib/timingObservations.ts`) gained two
  optional fields: `severity?: number` (0-1; absent/0 means "never a
  Focus-on-this candidate" — e.g. a reassuring "close to reference" note
  or an informational pitch-register comparison, which stays informational
  rather than being misrepresented as an issue) and `segment?: { startMs,
  endMs }` (reference-clip, full-clip time base — exactly what
  `targetRange` needs). Populated at each observation's source:
  `timingObservations.ts`'s whole-clip duration ratio; both
  `wordTimingObservations.ts` cases (word-duration linear, long-phone
  **log-ratio-based** — symmetric between "half as long" and "twice as
  long", unlike a plain `|ratio - 1|`, which would otherwise score those
  very differently despite being equally notable); both
  `pitchTimingObservations.ts` cases (timing-offset magnitude; shape
  mismatch gets a fixed, modest severity — already the lower-confidence
  category, kept as a low-priority candidate rather than excluded
  entirely).
- `src/lib/feedbackRanking.ts` — `rankObservations` (severity × a
  confidence weight — high/medium/low — not confidence alone, so a severe
  medium-confidence finding outranks a barely-noticeable high-confidence
  one) and `selectPrimaryObservation` (ranks only observations with real
  severity, so an all-informational set correctly yields no primary
  candidate rather than presenting a reassurance note as "the" issue to
  fix).
- `src/components/AnalysisPanel.tsx` — new "FOCUS ON THIS" callout at the
  **top** of the panel (combines all three observation sources, picks the
  primary one) with a "Practice this part" button when a `segment` is
  available; a short "Nothing stands out this time" note when analysis
  has run but found nothing severity-worthy (the brief's "observant coach,
  not examiner" framing — silence would read as broken, a score would
  overclaim). New `onProposeSegment` prop.
- `src/pages/ShadowPage.tsx` — passes `onProposeSegment={setTargetRange}`,
  the exact same setter `handleMarkStart`/`handleMarkEnd` already call.
  Once set, the **already-existing** "Loop target"/"Clear target"
  controls and `targetRange`-scoped Alternate/Dual-ear comparisons (Phase
  8.2) work immediately — genuinely no new playback code, confirmed by a
  test that clicks "Practice this part" and asserts the existing
  `Target: 0.5s–0.8s` display and "Loop target" button (both
  `handleMarkStart`/`handleMarkEnd`'s own UI) actually update, not just
  that a button renders.

Tests: `tests/feedbackRanking.test.ts` (new, pure) — severity×confidence
ordering, the "severity beats raw confidence" case, all-informational
yields no primary, empty-list case. Extended
`wordTimingObservations.test.ts`/`pitchTimingObservations.test.ts`'s
existing cases with `severity`/`segment` assertions rather than adding
parallel test cases. `shadowPage.test.tsx` — extended the existing
Milestone-3 segment-timing test (already seeds a clear っ difference) to
also assert the callout renders the same message and that clicking
"Practice this part" drives the real, pre-existing target-range UI.

**Verified**: `npm run check` green — 523 tests passed, 2 pre-existing
skips (unrelated). `npm run build` clean.

## Phase 9 Milestone 7 — ASR as a secondary diagnostic signal: done

Adds Japanese speech recognition on the **learner's** recording only —
the reference transcript is already known and more reliable than an
open-vocabulary recognizer's guess, so ASR here is explicitly a
secondary, non-authoritative signal, never ground truth. "Possible
pronunciation difference around 「word」," never "You pronounced 「word」
incorrectly" — this distinction was the brief's explicit, repeated
instruction for this milestone.

**Resource check done before building** (Phase 20's requirement to
document this for every new dependency): the alignment service alone was
already using ~2.4 GB RSS warm, and this shared personal box had only
~1.5 GB genuinely free (several unrelated Claude/Codex sessions also
running). The originally-researched `small` Whisper model (~2 GB
estimated) was too risky to add on top of that — switched to `base`
(int8-quantized) and **measured actual RSS before committing**, matching
the Milestone 2a spike pattern rather than trusting the estimate: `base`
uses **~270 MB RSS** and transcribed a self-synthesized test clip
**exactly right** in ~2s. Real go/no-go, not a guess.

Added (`~/projects/shadowing-analysis-api`):
- `app/asr.py` — mirrors `aligner.py`'s lazy-singleton-behind-a-lock
  shape exactly (loads on first `/transcribe` call, not at process start,
  keeping `systemd` startup fast). Passes the known sentence text as
  Whisper's `initial_prompt` — a standard bias-decoding technique,
  usable here specifically because the transcript is already known
  (the whole premise of this project).
- `app/main.py` — new `POST /transcribe` (multipart `audio` + optional
  `prompt`), same validation/error-status conventions as `/align`; a
  shared `_read_and_validate_audio` helper extracted so the two endpoints
  don't duplicate that logic. `GET /health` gained an `asr` sub-object
  mirroring `mfa`'s shape.
- Tests: `tests/test_asr.py` (8 cases, mirrors `test_align.py`'s
  validation/error-path coverage, mocked — no real model needed for the
  fast suite) and `tests/test_integration_asr.py` (real end-to-end,
  synthesizes its own clip via `voicevox-tts-api`, same pattern as the
  alignment integration test). **Verified**: 23 fast tests pass (2.4s);
  both real integration tests (alignment + ASR) pass (44s total, matching
  the ~40s one-time MFA lexicon load). Restarted `systemd --user`, live
  `curl` against `https://codex-dev.tailfbd89c.ts.net/shadowing-analysis/transcribe`
  over the real tailnet returned the exact expected text with the
  deployed origin's CORS header present.

Added (`jp_sentence_splits`):
- `src/lib/analysisApi.ts` — `transcribeAudio(blob, prompt?)`, same
  never-throws contract as `alignAudio`. `TRANSCRIPTION_VERSION`
  constant, same precedent as `ALIGNMENT_VERSION`.
- `src/lib/asrObservations.ts` — a small O(n·m) LCS-based character diff
  (no library needed for ~10-30 character strings) between the ASR text
  and the **reference alignment's own word texts concatenated** (not the
  raw `sentence.japanese` string — guarantees exact character-offset
  correspondence to the word list; the raw sentence can carry punctuation
  the alignment doesn't). Both sides normalized (strip whitespace and
  `、。！？「」`) first so formatting differences aren't mistaken for
  pronunciation differences. Unmatched character runs map back to the
  specific reference word(s) they fall within — one observation per
  distinct affected word, not one blob message for the whole sentence.
  Always `confidence: 'low'` and a fixed, modest `severity` — a candidate
  for "Focus on this" (Milestone 5/6), but naturally outranked by more
  certain measured-duration/phonetic-timing findings from Milestones 3/4,
  with zero special-casing needed (the existing ranking logic already
  handles this correctly by design).
- `AttemptTranscription` (`src/domain/types.ts`), Dexie `version(10)`
  (`attemptTranscriptions: 'id'`), `getAttemptTranscription`/
  `saveAttemptTranscription` (`src/db/repository.ts`) — cached per
  learner attempt only (no reference-side equivalent needed). Same
  local-only precedent as the alignment cache tables.
- `src/components/AnalysisPanel.tsx` — a third independent effect (learner
  blob only, no dual reference/learner fetch this time — reference
  transcript is already known) so a slow/unreachable ASR call never
  blocks the alignment or local-analysis sections. New "Possible
  pronunciation differences" section, folded into the same combined
  observation list already feeding `selectPrimaryObservation` — no
  changes needed to the ranking logic itself.

Tests: `tests/asrObservations.test.ts` (new, pure) — exact match and
punctuation-only differences produce nothing (confirms normalization
works), a substitution flags the specific right word, multiple affected
words each get their own message rather than one blob. Extended
`tests/analysisApi.test.ts` with `transcribeAudio` cases mirroring
`alignAudio`'s. `tests/data.test.ts`/`tests/migration.test.ts` —
round-trip + staleness + v10 schema tests. `tests/shadowPage.test.tsx` —
a real component-level integration test (unlike Milestone 4's pitch
work, ASR doesn't need local Web Audio decode, only the mocked fetch, so
this one *is* meaningfully testable end-to-end) confirming the section
renders and is hedged at low confidence, not presented as a definite
error.

**Verified**: `npm run check` green — 538 tests passed, 2 pre-existing
skips (unrelated). `npm run build` clean.

## Phase 9 Milestone 8 — pronunciation history: done

Stores a lightweight per-attempt analysis summary and shows a trend label
per category next to each attempt, e.g. "Timing: needs work" ->
"improving" -> "close" — the brief's own worked example (Phase 14),
finally closing the "✓ Much closer" cross-recording comparison
deliberately deferred from Milestone 5/6.

Deliberately **not** every derived observation forever: a summary is just
two severity numbers (timing/pitch), the primary issue's kind/message,
and a version — the full detail is already recomputable on demand from
the cached alignment/transcription (Milestones 2b/7). Also **not**
included: the brief's Phase 15 cross-sentence learner *profile*
("っ timing: recurring issue" aggregated across many sentences) — that's
a materially different aggregation (across sentences, not across
attempts of one sentence) and a natural follow-on once per-sentence
history is live and in daily use, not part of this milestone's scope.

Added:
- `src/lib/pronunciationHistory.ts` — `categorizeObservations` (max
  severity within the brief's own two example categories: `duration`/
  `word-duration`/`sokuon_timing`/`long_vowel_timing` → Timing;
  `pitch`/`pitch_timing`/`pitch_shape` → Pitch; ASR/meta observations
  belong to neither, matching the brief's own two-category example
  exactly rather than inventing more). `trendLabel(current, previous)` —
  `'close'` when nothing notable is left; `'needs work'` for a first-time
  or non-improved issue; `'improving'`/`'much closer'` when meaningfully
  better than the previous attempt (a large jump down to a low absolute
  severity gets the stronger label, matching the brief's own "Aug 14
  improving" -> "Aug 16 much closer" progression). `buildHistoryDisplay`
  sorts a sentence's summaries oldest-first and labels each relative to
  its true predecessor, not just adjacent array order.
- `AttemptAnalysisSummary` (`src/domain/types.ts`), Dexie `version(11)`
  (`attemptAnalysisSummaries: 'id, sentenceId, createdAt'` — indexed on
  `sentenceId`, mirroring `attempts`' own indexing convention, for the
  "all history for this sentence" query), `saveAttemptAnalysisSummary`/
  `listAttemptAnalysisSummariesForSentence` (`src/db/repository.ts`) — a
  stale `analysisSummaryVersion` is filtered out entirely rather than
  returned, same "stale = missing" precedent as the alignment/
  transcription caches.
- `src/components/AnalysisPanel.tsx` — new required `sentenceId`/
  `attemptCreatedAt` props (history is grouped by sentence and ordered by
  when the attempt was *recorded*, not when it happened to be analyzed).
  A new effect saves the summary once every source has settled (local
  analysis, server alignment, and ASR all independently — a new
  `analysisSettled` derived flag combining all three); redundant re-saves
  on later renders are harmless (a single Dexie `put` on the same key).
- `src/pages/ShadowPage.tsx` — queries summaries for the sentence
  alongside attempts (already-existing `useLiveQuery`), builds the
  history display, and renders each attempt's "Timing: X · Pitch: Y"
  line under its existing notes — no new section, fits the existing
  attempt-row density per the brief's "avoid dense tables" mobile
  requirement.

Tests: `tests/pronunciationHistory.test.ts` (new, pure) — category
max-severity grouping, exclusion of ASR/meta kinds, all six
`trendLabel` cases (close/needs-work/improving/much-closer/no-change/
regression), and a chronological multi-entry sequence confirming each
entry compares to its *true* predecessor after sorting, not raw array
order. `tests/data.test.ts`/`tests/migration.test.ts` — round-trip,
stale-version exclusion, cross-sentence isolation, v11 schema test.
`tests/shadowPage.test.tsx` — a real end-to-end scenario: seed two
attempts with different severities, analyze both in turn, and confirm
the older attempt's row shows "needs work" while the newer one shows
"improving" — proving the whole chain (analysis -> summary save ->
`useLiveQuery` re-render -> trend labeling) actually works together, not
just each piece in isolation.

**Verified**: `npm run check` green — 553 tests passed, 2 pre-existing
skips (unrelated). `npm run build` clean, `npm run lint` shows no new
warnings.

## Phase 9 roadmap (Milestone 9, not started)

Recorded here so a future session doesn't need to re-derive the
architecture decision or the researched facts above.

- **Milestone 2a — forced-alignment service: fully done**, see above.
  `~/projects/shadowing-analysis-api` is live under `systemd --user`,
  exposed tailnet-only via `tailscale serve`, producing real word/phone
  time boundaries in ~1-3s per request once warm.
- **Milestone 2b — frontend wiring (separate change, not started)**: a
  fetch client in `jp_sentence_splits` calling the new service's `/align`
  for both the reference clip and each attempt, mapping the returned word
  boundaries onto Milestone 1's mora units. Requires a **required** graceful
  fallback to today's onset/cross-correlation heuristic when the API isn't
  reachable (phone off the tailnet, etc.) — the app must keep working
  exactly as it does today when the server is unreachable. CORS
  configuration on the service (deferred from 2a, needs the real frontend
  origin). This is the point where a real Dexie cache table +
  `analysis_version` earns its complexity (reference-audio alignment
  cached permanently; learner-attempt alignment cached per attempt).
- **Milestone 3 — mora/rhythm timing feedback: done**, see above.
- **Milestone 4 — pitch-contour timing feedback: done**, see above.
- **Milestone 5/6 — feedback ranking + "Fix One Thing": done**, see
  above. Cross-recording "✓ Much closer" comparison after a re-record
  remains deliberately deferred to Milestone 8 (needs persisted attempt
  history to compare against).
- **Milestone 7 — ASR as a secondary signal: done**, see above (used
  `base`, not `small`, after a real memory check on this host).
- **Milestone 8 — pronunciation history: done**, see above. Cross-sentence
  learner *profile* (Phase 15) remains a deliberate, separate follow-on.
- **Milestone 9 — PASQA (experimental, feature-flagged)**: prototype now
  that Milestones 2-4 give a real baseline to compare it against.
