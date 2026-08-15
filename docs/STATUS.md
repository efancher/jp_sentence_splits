# Status

Last updated: 2026-08-15 (Phase 5).

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
