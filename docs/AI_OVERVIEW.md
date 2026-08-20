# Satori Glossbook — Product & Architecture Reference

*Prepared as context for an outside AI assistant (e.g. pasted into ChatGPT)
to reason about new features. Present-tense, system-oriented — not a
changelog. For chronology and implementation detail behind any claim here,
see `docs/STATUS.md`; for the original cross-repo planning analysis, see
`docs/UNIFIED_APP_ARCHITECTURE.md`; for the short living architecture
summary, see `docs/ARCHITECTURE.md`. This document is a snapshot — verify
specific file/function names against the code before relying on them for
an edit, the same way any memory of this codebase should be checked.*

## Elevator pitch

Satori Glossbook (repo `jp_sentence_splits`, package `satori-glossbook`) is
a personal, single-user (with optional light multi-user sharing) Japanese-
study progressive web app. It centers on **sentences**, not decks of
isolated flashcards: every study activity — vocabulary, kanji, grammar
comprehension, listening, shadowing/pronunciation — is generated from and
traceable back to a specific sentence the user actually encountered (via
Satori Reader CSV exports, YouTube/podcast "shadowing" clips, or hand
import). Its most distinctive piece is a **Cure-Dolly-style structural
analysis engine**: sentences are broken into ordered "chunks" with
grammatical roles (topic, subject, object, verb, particle, etc.), including
synthetic zero-が (∅ subject) chunks, rendered as visual "puzzle piece"
shapes that make Japanese clause structure legible rather than just
glossed. On top of that sentence-analysis workspace, the app has grown a
full **unified spaced-repetition system** (FSRS via `ts-fsrs`) that
schedules many distinct activity types — sentence comprehension,
reading-in-context, listening, cloze/reading-retrieval/reading-production/
sentence-transformation on individual vocabulary items, contrastive-pair
drills for confusable words — all sharing one due-queue and one evidence
log, plus a from-scratch **shadowing/pronunciation-practice** feature
(record yourself, compare to reference audio, get ranked
pronunciation-timing/pitch feedback backed by a self-hosted forced-alignment
service). It is offline-first (IndexedDB/Dexie is the real source of truth)
with optional Supabase cloud sync and basic book-sharing (invite
collaborators as editor/viewer).

## Tech stack & deployment

- **Frontend**: React 19 + TypeScript 6 + Vite 8, `react-router-dom` v7
  using `HashRouter` (required for GitHub Pages' static, non-rewrite-
  capable hosting). No state-management library, no UI component library —
  hand-rolled CSS.
- **Local storage**: Dexie 4 (IndexedDB wrapper), read reactively in
  components via `dexie-react-hooks`' `useLiveQuery`. Dexie is the
  **only** read/write path the UI ever talks to — 12 schema versions to
  date (`src/db/database.ts`), each additive.
- **Cloud sync (optional)**: `@supabase/supabase-js` against a single
  shared Supabase Postgres project (also shared, via table-prefix
  isolation, with a sibling now-retired `shadowing` repo). App is fully
  usable local-only with no Supabase env vars configured.
- **Validation**: Zod v4 (`src/domain/schemas.ts`) — used for JSON
  backup/restore and import parsing, not for general runtime validation.
- **PWA**: `vite-plugin-pwa` (manifest, Workbox precache, iOS home-screen
  meta tags) — genuinely installable, not aspirational. Known caveat:
  `window.prompt`/`window.confirm` silently no-op on an installed iOS
  Safari PWA, so all new UI uses inline controls instead.
- **Other libs**: `@dnd-kit` (drag-and-drop reordering), `papaparse` (CSV),
  `fflate` (zip read/write for `.shadowing.zip` packages), Web Speech API
  (device TTS, no cloud TTS), Web Audio API (recording, YIN pitch
  detection, waveform).
- **Testing**: Vitest (unit + component, jsdom + `fake-indexeddb`), 600+
  tests as of the latest status update; Playwright for a WebKit e2e happy
  path.
- **Hosting/CI**: `.github/workflows/deploy.yml` — on push to `main`, runs
  `npm run check` (typecheck + full unit suite) then `npm run build:pages`
  and publishes `dist/` to GitHub Pages. Several other workflows
  (`backfill-*.yml`) exist purely to let one-off maintenance scripts (see
  below) be triggered from the Actions tab instead of requiring local
  Python/Node setup.
- **Node-side tooling**: a `scripts/` directory (run via `tsx`, not part of
  the browser bundle) for content ingestion and backfills — first non-Vite
  TypeScript tooling introduced specifically for this.

## Core data model (entity graph)

Two model "eras" coexist, both live in `src/domain/types.ts`:

**Original sentence/analysis model** (stable, pre-dates the SRS work):
- `Book` → embeds `BookChapter[]` → joined to `Sentence` via `BookSentence`
  (position, per-book study status, optional chapter assignment). A
  `Sentence` is **user-global and reusable across books** — not duplicated
  per book.
- `Sentence` carries `japanese`/`readingOnly`/`inlineReading`/`translation`,
  `targetVocabulary` (Satori-CSV-derived vocab chips),
  `vocabularySuggestions` (tokenizer-derived, clickable, used by the
  vocabulary picker), `sourceReferences` (provenance from Anki-era
  imports), `conflicts` (merge conflicts across repeated imports).
- `SentenceAnalysis` (1:1 with `Sentence`, keyed on `sentenceId`) holds the
  Cure-Dolly `chunks: AnalysisChunk[]` (each: japanese text, `role`,
  `literalEnglish`, `kind: 'surface' | 'zero_ga'`), analysis `notes`, and —
  bridging into the SRS side — `vocabularyReviewStatus`
  (`unreviewed`/`confirmed`) plus `vocabularySelections` (the user's
  confirmed picks from the picker).
- `SentenceAudio` — imported reference/native audio clips (from
  `.shadowing.zip`), tied to a sentence.
- `ImportBatch` / `InboxMembership` — every import lands in a batch;
  sentences not yet filed into a book sit in the "Inbox."

**Unified study model** (additive, `docs/UNIFIED_APP_ARCHITECTURE.md` §8,
built out Phases 1–9):
- `Source` — a promoted, first-class version of what used to be
  `Book.sourceKey`/`sourceUrl` (satori/youtube/podcast/manual/other).
  Exists in the schema but is not yet the primary way sources are tracked
  in the UI (books still carry `sourceKey` directly).
- `VocabularyItem` — a normalized word, unique on `(expression, reading)`
  (deliberately not unique on expression alone, so homophones like
  週間/習慣 stay distinct). Has `meaning`, `partOfSpeech`, optional
  `externalId` (`wk:{id}`/`jmdict:{id}`) for idempotent re-import.
- `SentenceVocabulary` — join table linking a sentence (optionally a
  specific chunk) to a canonical `VocabularyItem`, carrying `surfaceForm`
  (the exact inflected text as it appeared, e.g. 表れていた for
  dictionary-form 表れる) — this is what makes word-in-context review
  targets possible.
- `Kanji` — character + meanings/onyomi/kunyomi/nanori, seeded from the
  WaniKani catalog.
- `VocabularyKanji` — join recording which kanji appear in which word, at
  which position (supports "reading of the word in context," not isolated
  kanji drilling).
- `StudyItem` — the SRS scheduling unit: `subjectType`
  (`sentence | vocabularyItem | chunk | vocabularyConfusion`), `subjectId`,
  `activityType` (free-form string, additive by design — see Feature
  Walkthrough), `fsrsState` (opaque blob shaped to match `ts-fsrs`'s
  `Card`: due, stability, difficulty, reps, lapses, state,
  learningSteps).
- `Review` — **append-only**, never updated after insert (sync-
  conflict-free by construction): `studyItemId`, `rating`
  (again/hard/good/easy), optional `responseRaw`/`expectedAnswer`/
  `elapsedMs`/`errorClassification`/`assistance[]` (furigana_shown,
  mnemonic_shown, audio_replayed, etc.)/`source`
  (`scheduled_review` | `natural_encounter`)/`contextSentenceId`.
- `VocabularyConfusion` — an undirected pair of `VocabularyItem`s the
  learner tends to mix up (`confusionType`: reading/kanji/meaning/
  transitivity/synonym/grammar/other), with `observedCount`/
  `lastObservedAt`. Seeded partly by a ported verb-pair-detection
  algorithm, partly by live natural-encounter/confusion-observation logic.
- `Attempt` — a shadowing (recorded speech) attempt at a sentence: blob,
  duration, manual A/B rating, favorite flag, notes. **Local-only, never
  synced** (raw audio blobs are large and this data is explicitly excluded
  from cloud sync and JSON backup by design).
- `ReferenceAlignment` / `AttemptAlignment` / `AttemptTranscription` /
  `AttemptAnalysisSummary` — cached, recomputable-on-demand derived data
  from the forced-alignment/ASR services (all local-only, keyed by version
  numbers so stale caches can be invalidated).
- `CardIssueReport` — a learner-authored free-text flag on a review card
  ("this reading looks wrong"), `status: open | resolved`, synced to
  Supabase specifically so a future AI/scripting session can triage a
  batch via `scripts/list-card-issues.ts`.
- **Grammar-learning system** (new; Phases 1-5 — schema/repository/sync/
  backup foundation, manual annotation from Analyze, the `/grammar`
  browser/detail UI, AI-assisted suggestion/explanation, and
  `grammar_comprehension`/`grammar_completion` review cards, see the
  Feature walkthrough below — are all done): a second layer on top of the
  Cure-Dolly structural analysis, answering "what reusable
  construction is operating here" rather than "how is this sentence
  assembled" (`SentenceAnalysis.chunks` is untouched). `GrammarPattern` —
  the canonical construction (e.g. ～わけがない), corpus-wide, deduped on a
  normalized key (`src/lib/grammarPatterns.ts` strips leading/trailing
  tilde/wave-dash and whitespace, NFC-normalizes; kanji/kana variants like
  訳がない are *not* auto-merged in v1). `SentenceGrammar` — one encounter
  with a pattern in one sentence (mirrors `SentenceVocabulary`, including
  its "chunkId isn't a real FK" limitation), carrying
  `confirmedByLearner`/`source` so a passively-AI-suggested occurrence is
  distinguishable from one the learner actually acted on.
  `GrammarRelationship` — a *typed* edge between two patterns
  (`similar_meaning`/`contrast`/`commonly_confused`/`stronger_stance`/
  `weaker_stance`/`formal_variant`/`structural_relative`); structurally
  mirrors `VocabularyConfusion`'s canonicalized-pair get-or-create shape but
  is its own table (not a reuse) and, unlike `VocabularyConfusion`, allows
  more than one row per pair — one per distinct `relationshipType`, since
  two patterns can be both `structural_relative` and independently
  `commonly_confused`. `StudySubjectType` gained `'grammarPattern'`, so
  grammar review reuses `StudyItem`/`Review`/FSRS/`natural_encounter`
  unchanged — no parallel scheduler is planned. `GrammarSuggestion` is
  embedded on `SentenceAnalysis.grammarSuggestions` (not a table),
  mirroring `VocabularySuggestion`'s provisional-until-confirmed shape, but
  lives on `SentenceAnalysis` rather than `Sentence` since grammar
  detection is an analysis-time concern, not an import-time tokenizer
  artifact. No `GrammarPattern` rows are seeded — every one is created from
  a real encounter, matching this app's native-media-first principle at
  the pattern level, not just the example-sentence level.
- `AppSettings` (singleton) — theme, TTS voice/rate, `newCardsPerSessionLimit`
  (session planner cap on new-subject introduction),
  `graduationMinScheduledDays` (retirement threshold from the due
  rotation).

Sync/queue-internal tables (`syncMeta`, `syncQueue`, `syncRecordMeta`,
`syncConflicts`) are infrastructure, not domain data.

## Feature walkthrough

### 1. Content import & organization
- **CSV import** (`src/lib/csvImport.ts`, `ImportPage.tsx`) — parses
  Satori Reader vocabulary CSV exports; dedupes/merges sentences on
  re-import (`mergeSentenceOnReimport`), preserving `firstOccurrenceIndex`
  and merging `sourceReferences`/`targetVocabulary` rather than
  duplicating.
- **`.shadowing.zip` import** (`src/lib/shadowingImport.ts`) — consumes
  packages produced by the separate `shadowmine` Python CLI (YouTube/
  podcast mining tool, lives in the sibling `shadowing` repo, not part of
  this codebase). Creates/refreshes one book per source, imports Japanese/
  reading/English/native audio clips per sentence, idempotent on re-import
  (matches by source ID, doesn't duplicate the book).
- **Books/Chapters** (`BooksPage.tsx`, `BookDetailPage.tsx`) — sentences
  organize into named books with ordered chapters; drag-and-drop reorder
  (`@dnd-kit`), "Order from paste" (reorders a book to match pasted Satori
  chapter text, `src/lib/pasteOrder.ts`), move/copy sentences between
  books, archive books.
- **Inbox** (`InboxPage.tsx`) — sentences land here by default until filed
  into a book; `ImportBatchPage.tsx` lets you review/organize everything
  from one import run at once.
- **Search** (`SearchPage.tsx`) — full-text-ish search across sentences
  with facet filters (unassigned, by study status, has-warning,
  multi-vocab, missing translation/analysis); results can be bulk-added to
  a book or exported as a worksheet.

### 2. Structural (Cure-Dolly) analysis — `AnalyzePage.tsx`,
`src/lib/chunking.ts`/`clauseBands.ts`/`stickyEnglish.ts`/`puzzleShapes.ts`
The core, most-differentiated feature. A sentence is split into an ordered
list of `AnalysisChunk`s, each assigned a grammatical role (topic/subject/
object/verb/particle/etc. — see `ROLE_PRESETS` in `appConfig.ts` and
`src/lib/roleGuide.tsx` for the full taxonomy) and a "literal English"
gloss (sticky/word-for-word, not fluent translation — no MT dependency
anywhere in the app). Supports synthetic zero-が chunks for Japanese's
frequent implicit subject. Chunks render as visually distinct "puzzle
piece" shapes (`puzzleShapes.ts`/`puzzlePiecePath.ts`) whose edge shape
encodes grammatical fit, so structure is visually scannable.
`lintAnalysis` (`analysisSuggestions.ts`) flags likely mistakes (e.g.
discarded annotations, chunk/source mismatches). This is where
**vocabulary confirmation** also happens — the `VocabularyPicker`
component lets the user tap tokenizer-derived `vocabularySuggestions` (or
add manually) and "confirm" them, which is the single UI action that
materializes real `VocabularyItem`/`SentenceVocabulary`/`Kanji`/
`VocabularyKanji` rows (`materializeVocabularySelections` in
`repository.ts`) — this is the load-bearing bridge between the
sentence-analysis world and the SRS world. Sentence translation and
confirmed vocabulary meanings are directly editable inline (textarea/
input, autosave). Just below it, a **"Grammar noticed" panel**
(`GrammarPicker.tsx`) is the entry point for the grammar-learning system's
second layer: search-existing-or-create-new pattern tagging (autocomplete
against every `GrammarPattern` already in the corpus), with three
per-occurrence actions — **Got it** (confirms the occurrence,
`SentenceGrammar.confirmedByLearner`, no SRS involvement), **Track**
(confirms *and* seeds a `grammarPattern`-subject `StudyItem`, entering the
pattern into the same FSRS due-queue vocabulary/sentences use), and
**Explain** (an inline, no-modal edit form for the pattern's meaning/
structural notes and this occurrence's own context-specific explanation).
Unlike `VocabularyPicker`, this panel is deliberately decoupled from the
page's autosave/chunks state — every action is an immediate repository
write, not a debounced draft. A **"Suggest grammar (AI)"** button (panel
header) and a **"Suggest explanation (AI)"** button (inside Explain) call a
`grammar-assist` Supabase Edge Function (Claude Haiku, `src/lib/
grammarAssist.ts`) — suggestions render as Add/Dismiss chips (never
auto-materialized into a `GrammarPattern`/`SentenceGrammar` row), and a
drafted explanation only pre-fills the same editable fields Explain already
has, saved by the same button as a manual entry. Both degrade to an inline
"unavailable" message (signed out, offline, function not deployed) with the
manual flow completely unaffected.

### 3. Practice & Build modes (lightweight, non-SRS study)
- **Practice** (`PracticePage.tsx`) — reveal-based drilling scoped to a
  book/chapter/status filter; deterministic shuffle, staged reveals, TTS
  playback, "Complete & Next"/"Needs Review & Next," desktop arrow-key
  nav. Also hosts a "Recognized these without hints?" panel that lets the
  user self-report natural encounters with vocabulary outside the formal
  review queue (`recordNaturalEncounter`, feeds `Review.source =
  'natural_encounter'`).
- **Build mode** (`BuildPage.tsx`, `src/lib/buildMode.ts`) — inverse of
  Analyze: shows the English prompt, learner reassembles the Japanese
  sentence from shuffled chunk tiles using saved analysis chunks as the
  answer key; layered hint escalation (vocabulary → sticky English →
  roles/shapes → full Japanese).

Both are explicitly *not* SRS-scheduled — separate from the Review system
below, framed in the README as "not a spaced-repetition system" for this
original layer (the SRS layer was added later, additively).

### 4. Spaced-repetition review system — `ReviewPage.tsx`,
`src/lib/scheduling.ts`, `src/db/repository.ts`
The unified FSRS-based SRS, at `/review` (global) and
`/books/:bookId/review` (scoped). Uses `ts-fsrs` (FSRS-6) via a thin,
content-agnostic wrapper (`scheduling.ts` only ever sees `FsrsState` + a
rating). One `StudyItem` exists per `(subjectType, subjectId,
activityType)` triple; multiple activity types can exist for the same
subject. Activity types currently wired, grouped by subject/eligibility:
- **Sentence subject**: `comprehension`, `reading_in_context` (currently
  share one interaction — see JP, reveal EN+vocab, self-rate; deliberate
  "start small," real differentiation deferred).
- **Sentence subject, audio-gated**: `listening` — only eligible for
  sentences with a `SentenceAudio` row; audio plays first, Japanese text
  stays hidden until reveal.
- **VocabularyItem subject** (all three require a `surfaceForm`-bearing
  `SentenceVocabulary` link, i.e. only vocab confirmed via the picker
  after `surfaceForm` was added): `reading_retrieval` (show word, hide
  reading), `cloze` (hide the word entirely in its sentence),
  `reading_production` (show the word, type the reading — typed-answer
  checked via `isReadingAnswerCorrect`), `sentence_transformation`
  (conjugate a word to a per-word-hashed target form — 13 verb/10
  adjective forms via `src/lib/conjugation.ts`, a ported/validated
  engine).
- **VocabularyConfusion subject**: `contrastive` — one StudyItem per
  confusable pair (not per word), quizzing "can you tell these two
  apart," fed by `getConfusionPairCandidates`.
- **GrammarPattern subject** (grammar-learning system Phase 5):
  `grammar_comprehension` (show a sentence containing the tracked pattern,
  reveal what it contributes) and `grammar_completion` (multiple choice
  among the pattern and up to 3 distractors from the corpus, blanking the
  sentence when the pattern's canonical name happens to appear in it
  verbatim — `blankPatternInSentence`, `src/lib/grammarPatterns.ts`).
  Uniquely among activity types, **never lazily seeded by `ReviewPage`
  itself** — only "Track" in `GrammarPicker.tsx` creates these study
  items (both together), and only in the global `/review` queue, never
  book-scoped (a tracked pattern isn't "of" one book).

**Gating and mnemonic/assistance tracking**: a sentence's full-sentence
cards (`comprehension`/`reading_in_context`) are deliberately withheld
until its linked vocabulary is both *confirmed*
(`SentenceAnalysis.vocabularyReviewStatus`) and *shown proficient* (FSRS
state has graduated past "new/learning" for every reviewable vocabulary
item in that sentence) — `getSentenceFullReviewReadiness`/
`isSentenceReadyForFullReview`/`deferUnreadySentenceReviews` implement
this, applied both as an ongoing filter on the due queue and defensively
against lazily-seeded new items so nothing bypasses the gate.
Mnemonic-shown/audio-replayed/etc. assistance flags are recorded on
`Review.assistance` without penalizing the score — informational only for
future planning. A **session planner** caps new-subject introduction per
sitting (`AppSettings.newCardsPerSessionLimit`) without capping
already-due reviews, and interleaves activity categories round-robin
rather than draining one category first. **Graduation** (`isGraduated`,
`AppSettings.graduationMinScheduledDays`, default 180) retires a study
item from the due rotation once its FSRS interval crosses the threshold;
surfaced as "Graduated" badges on `BookDetailPage.tsx` and
`VocabularyListPage.tsx`. **Auto error-classification**
(`classifyReviewError`) fills `Review.errorClassification` only from
concrete evidence (a wrong typed answer, a failed contrastive pair) — bare
self-ratings on comprehension/listening stay unclassified on purpose. A
**"Report issue"** button on the current card lets the learner flag a bad
card inline without breaking the review flow (see §7).

**Explainability**: `getStudyItemDebugInfo` + `/study-items/:studyItemId`
(`StudyItemDebugPage.tsx`, linked via a "Why?" link on the current review
card) surfaces raw FSRS state, full review history (source/assistance/
response), and computed maturity level for vocabulary subjects.
`/study-items` (`StudyItemsListPage.tsx`) is a top-level browsable list of
every study item, sorted by due date.

### 5. Vocabulary & kanji browsing — `VocabularyListPage.tsx`
(`/vocabulary`), `KanjiDetailPage.tsx` (`/kanji/:character`)
Lists every confirmed `VocabularyItem` across all books, with search-by-
meaning and inline meaning editing; graduated badges via
`computeGraduatedSubjectIds`. Kanji detail shows a character's readings
and every confirmed word that contains it (via `VocabularyKanji`), i.e.
"this kanji occurs in these words" — but not the reverse ("this reading
occurs across these kanji") drill described in the original design brief,
which remains unbuilt.

### 5a. Grammar browsing — `GrammarListPage.tsx` (`/grammar`),
`GrammarPatternDetailPage.tsx` (`/grammar/:patternId`)
Same shape as vocabulary/kanji browsing, one layer up. The list sorts by
encounter count (most-encountered-in-your-reading first, not alphabetical)
— closer to "what's actually showing up" than a dictionary. The detail
page is where "Your encounters" (design brief §5/§6 — "where else have I
seen this?") actually lives: every sentence a pattern has been tagged in,
via `listSentenceGrammarForPattern`, each linking into
`/books/:bookId/analyze/:sentenceId` when a book membership exists (plain
text otherwise), with native audio playback (`NativeAudioButton`) when the
sentence has `SentenceAudio`. The pattern's own `shortMeaning`/
`structuralNotes`/`explanation`/`family` are editable inline — currently
the only way to fill them in, same caveat as `GrammarPicker`'s Explain
panel (no AI yet). No `GrammarRelationship` (contrast/family) browsing UI
yet — deliberately deferred (Phase 8 of the grammar-learning plan).

### 6. Shadowing & pronunciation feedback — `ShadowPage.tsx`
(`/books/:bookId/shadow/:sentenceId`)
A full practice loop ported/rebuilt from a now-retired standalone
`shadowing/web` app, then substantially extended beyond the original with
a self-hosted pronunciation-analysis backend. Capabilities:
- Record → save → preview → rate (4-way manual A/B rating against
  reference audio) → delete, with a persistent per-sentence attempt
  history.
- Playback-speed control, Alternate (A/B) and Dual-ear (binaural)
  reference-vs-attempt comparison.
- **Practice-target isolation**: manual "mark start"/"mark end" loop-point
  marking on a scrubbable reference player; loops just that range and
  scopes comparisons to it.
- **Shadow mode**: live mic-calibrated play-along recording (reference
  plays while recording) with a live waveform overlay, sharing one
  `AudioContext` for mic analysis + reference playback.
- **Live pitch-contour overlay** during recording (YIN pitch detection,
  `src/lib/pitch.ts`, validated against synthetic tones — no fixtures
  existed in the source repo for this).
- **Post-hoc `AnalysisPanel`**: reference-vs-saved-attempt comparison
  combining several signal sources into one ranked "Fix One Thing"
  recommendation (`src/lib/feedbackRanking.ts`'s `rankObservations`/
  `selectPrimaryObservation`):
  - Mora-unit segmentation (`src/lib/mora.ts`) as the common unit of
    analysis.
  - **Forced alignment** via a self-hosted service (see External Services
    below) → phone/word timing feedback (`wordTimingObservations.ts` —
    っ/long-vowel/word-pace) and pitch-movement timing feedback
    (`pitchTimingObservations.ts`), cached per-sentence/per-attempt.
  - **ASR** (faster-whisper, `base` model) as a secondary, non-
    authoritative diagnostic signal (`asrObservations.ts`).
  - Cross-recording "Focus on this" comparison — a re-record can say
    "closer than last time" or "different issue now"
    (`compareObservations`).
  - A collapsed "show all candidates" disclosure under the winning "Focus
    on this" pick (partial substitute for a dedicated debug view that was
    deliberately not built separately).
  - **Pronunciation history** (`pronunciationHistory.ts`) — lightweight
    trend labels ("close"/"needs work"/"improving"/"much closer") per
    sentence over time, not full detail forever (recomputable on demand
    from cached alignment).
- **Practice-mode variants**: "Delayed shadow" (listen in full, then
  auto-record after a configurable 0.5–2.0s gap) and "Show meaning
  instead" (swap Japanese transcript for English translation, forcing
  production from meaning — disabled when no translation exists).
- Graceful fallback everywhere the forced-alignment service is
  unreachable (falls back to an onset/cross-correlation heuristic) — the
  app must keep working with the service off the tailnet.

This whole feature area is **local-only**: `Attempt` blobs, alignment
caches, ASR transcriptions, and analysis summaries never sync to Supabase
or JSON backup (deliberate — audio blobs are large and this data is
reconstructible/re-recordable).

### 7. Card issue reporting — `CardIssuesPage.tsx` (`/issues`)
A "report a problem with this card" flow (bad reading, wrong translation,
etc.) from `ReviewPage`, designed for batch triage rather than immediate
fix-in-place: reports sync to Supabase specifically so a future AI/Claude
session can read them via `scripts/list-card-issues.ts` and fix a batch at
once. `/issues` lists open (and optionally resolved) reports with sentence
context and a one-way "Mark resolved" action; no delete/reopen/edit-in-
place by design.

### 8. Sync, conflict resolution & sharing — `src/sync/`
- **Engine** (`engine.ts`): per-record optimistic concurrency (`version` +
  compare-and-swap on push), soft deletes (`deleted_at`), an append-only
  `sync_events` table as the pull cursor. Push failures surface as a
  visible sync-status badge (`SyncStatusBadge.tsx`) rather than retrying
  silently forever.
- **Conflict resolution** (`resolveConflict.ts`, `ConflictPanel.tsx`):
  manual keep-local / keep-remote / duplicate UI when two devices edit the
  same record. `reviews` (append-only) sidesteps conflicts entirely by
  design — inserts only, no CAS needed.
- **Duplicate-row self-heal**: `kanji`/`vocabulary_items` get-or-create
  logic dedupes only against the *local* Dexie cache; when a device's
  local cache is missing a row that exists remotely, the naive insert used
  to hit a remote unique-key violation and retry forever.
  `adoptRemoteDuplicate`/`remapDuplicateEntityId` now detect this, adopt
  the remote row's id, and repoint every local FK (including already-
  queued pending pushes) to the correct id.
- **Reference-audio self-heal**: a known Safari IndexedDB bug can corrupt
  a locally-stored Blob on one device only (metadata intact, bytes
  unresolvable); `repairSentenceAudio` re-downloads the original from
  Supabase Storage and overwrites the local copy, wired into both
  native-audio and shadowing reference playback paths.
- **Book sharing** (`src/sync/sharing.ts`, `BookSharingPanel.tsx`, Postgres
  `book_members` table): invite collaborators to a specific book as
  `editor` or `viewer` via email + accept-token flow — the one multi-user
  feature in an otherwise single-user app.
- **What's synced vs. local-only**: books/sentences/analyses/import
  batches/inbox/reference audio/study_items/reviews/vocabulary_items/
  sentence_vocabulary/kanji/vocabulary_kanji/vocabulary_confusions/
  card_issue_reports/grammar_patterns/sentence_grammar/
  grammar_relationships all sync (`grammar_patterns`/`sentence_grammar`
  now have a real writer, `GrammarPicker.tsx`; `grammar_relationships`
  remains schema-only, no writer yet). `sources` exists in
  Dexie/Postgres but has no writer/reader wired into the sync engine yet
  (schema-ready only). `attempts` and all shadowing-analysis caches
  (alignment, transcription, summaries) are local-only by design.

### 9. Settings, backup & TTS — `SettingsPage.tsx`
Theme, default import destination, text-display mode (plain/furigana/
reading), TTS voice/rate/pitch/volume (Web Speech API only, no cloud TTS),
session-planner and graduation thresholds, native-audio cache size/clear,
Supabase auth/sync controls (`AuthAndSyncSettings.tsx`). **JSON backup/
restore** (`src/lib/backup.ts`, Zod-validated, checksummed) is a full-
fidelity independent safety net alongside cloud sync — but does **not**
currently cover `Source`, `Attempt`, or any shadowing-analysis-cache
tables (deliberately deferred — those either have no real data yet or
aren't JSON-serializable/aren't worth backing up).

## Current known gaps / deliberately-deferred items

- **Sentence/vocabulary-card real UI differentiation**: `comprehension`
  vs `reading_in_context` still share one interaction; no activity type
  currently shows surrounding chapter context, changes UI by type, etc. —
  a real, still-open gap from Phase 4.
- **`sources` table** is schema-ready (Dexie + Postgres + RLS) but has no
  writer/reader anywhere; `Book.sourceKey`/`sourceUrl` remain the de facto
  source-tracking mechanism.
- **JMDict is not bulk-imported** into `vocabulary_items` — it's a local
  CLI lookup tool (`npm run jmdict:lookup`) used only to back backfill
  scripts; `vocabulary_items` holds only what the user has actually
  confirmed via the picker (plus what the one-time Anki import and various
  backfills seeded).
- **Anki review history was never migrated** — a permanent, explicitly-
  accepted gap; the FSRS scheduler starts from zero prior signal for words
  the user studied for years in Anki before this app existed.
- **No cross-sentence learner profile** (aggregate pronunciation/error
  trends across all sentences, not just per-sentence history) — flagged
  repeatedly as the one fully open item from the Phase 9 pronunciation-
  feedback brief.
- **No dedicated shadowing debug/diagnostic view** — most of the raw
  signal (alignment, phone timing, pitch movement, ASR output) is already
  visible inline in `AnalysisPanel`, but there's no single view of the
  full ranked-candidate list *before* the "Fix One Thing" pick is made (a
  collapsed disclosure partially closes this).
- **PASQA** (a CC0 pitch-accent speech-quality model) was investigated for
  pronunciation scoring and found technically viable but not integrated —
  needs PyTorch + s3prl, judged too heavy for the memory-constrained host
  running the forced-alignment/ASR services alongside it. Architecture is
  left ready (mirrors the existing alignment/ASR service pattern) if
  resources change.
- **Named practice-mode taxonomy** from the original design brief
  (Listen/Echo/Delayed shadowing/Close shadowing/Independent production/
  Meaning→production) is only partially built as distinct named toggles —
  most map onto existing controls implicitly (e.g. "Independent
  production" = just not pressing play first); "Delayed shadowing" and
  "Meaning→production" are now real explicit toggles, added late.
- **Reading-in-context grammar drills, kanji-reading-in-isolation drills,
  and "which words share a reading" browsing** (the reverse of
  `KanjiDetailPage`'s current "this kanji occurs in these words" view) are
  not built.
- **No manual "un-graduate" action** — graduation is purely threshold-
  driven, no override.
- **`AnalysisChunk[]` is one JSONB blob per sentence** (not per-chunk
  rows) — a known, accepted limitation: two devices editing different
  chunks of the same sentence offline produce one conflicting record, not
  a mergeable per-chunk diff. Becomes more visible as `sentence_vocabulary`
  links start pointing at specific chunks.
- **`study_items.subject_id` has no enforced FK** at the Postgres level
  (documented, accepted gap — it's polymorphic across sentence/
  vocabularyItem/chunk/vocabularyConfusion subject types, can't be a plain
  FK).
- Several recent features (card issue reports, translation/meaning
  editing, delayed-shadowing/meaning-production toggles, the duplicate-row
  sync self-heal, the reference-audio self-heal) are **not yet manually
  verified in a real browser** at time of writing — verified only via unit/
  component tests and code review, per repeated notes in `docs/STATUS.md`
  that browser automation tooling isn't available in the development
  sandbox.
- **No export-back-to-Anki path**, and none planned — migration away from
  Anki was a deliberate one-way decision.

## External services & dependencies

- **Supabase** — Postgres (all synced tables + RLS via `owner_id =
  auth.uid()`), Auth, and Storage (`reference-audio` bucket for opt-in
  native/reference audio cloud sync). Shared with the now-mostly-retired
  `shadowing` repo via table-prefix isolation (`shadowing_*` tables
  coexist, unused going forward). Entirely optional — the app is fully
  functional local-only without it. Also hosts `supabase/functions/
  invite-book-member/` and (new) `supabase/functions/grammar-assist/` —
  Deno Edge Functions, the only server-side (non-browser, non-Dexie) code
  in this app.
- **Anthropic API** (new, via `supabase/functions/grammar-assist/`) — the
  first and only LLM/AI integration anywhere in this codebase. Called
  server-side only, from the Edge Function, using `claude-haiku-4-5` with
  forced structured tool output (`strict: true`); the API key is an Edge
  Function secret (`ANTHROPIC_API_KEY`), never shipped to the browser.
  Deliberately not routed through `shadowing-analysis-api` below — a
  different kind of workload on an already memory-constrained host.
  Entirely optional and additive: every AI-assisted surface
  (`src/lib/grammarAssist.ts`) degrades to an inline "unavailable" message
  if the function isn't deployed, the key isn't configured, or the network
  is unreachable — nothing in the grammar-learning system depends on it
  being present.
- **`~/projects/shadowing-analysis-api`** — a self-hosted forced-alignment/
  ASR service (separate sibling git repo, not part of this codebase),
  running under `systemd --user` on the user's Hetzner box, exposed only
  over the user's Tailscale tailnet (`tailscale serve`, no public/
  CORS-open endpoint). Backed by MFA (Montreal Forced Aligner, Kaldi-
  based, no deep-learning framework) for word/phone-level alignment and
  faster-whisper (`base` model, CTranslate2 inference) for ASR — both
  deliberately chosen to be lightweight given the host's tight memory
  budget (~1–1.5 GB free even before ASR was added; the alignment service
  alone runs ~2.4 GB RSS warm). The frontend (`src/lib/analysisApi.ts`)
  requires a working fallback path when this service is unreachable.
- **WaniKani API** — one-time/re-runnable bulk catalog import
  (`scripts/import-wanikani-kanji.ts`, `npm run import:wanikani-kanji`) of
  the full non-hidden kanji catalog (readings/meanings) into Supabase
  `kanji`; not a live SRS/progress sync, catalog content only.
- **JMDict** (`jmdict-simplified` release) — downloaded/cached locally
  (`scripts/.cache/`, ~110 MB, gitignored) and used only as a local lookup
  index (`scripts/lib/jmdict.ts`) backing the `npm run jmdict:lookup` CLI
  and several backfill scripts (vocabulary meanings, suggestion glosses);
  never bulk-uploaded wholesale to Supabase.
- **`~/projects/shadowing` (CLI, `shadowmine`)** — a separate Python tool
  (Typer CLI, fugashi/UniDic, yt-dlp, ffmpeg) that mines YouTube/podcast
  sources into `.shadowing.zip` packages; invoked externally, its output
  consumed by this app's importer. Its own web practice UI has been ported
  into this app and the standalone deployment retired. Its morphology
  tokenizer (fugashi/UniDic) is also invoked directly by
  `scripts/backfill-vocabulary-suggestions.ts` (via a local Python venv or
  GitHub Actions) to backfill `vocabularySuggestions` for CSV-imported
  sentences, which the CSV import path itself never populates.
- **`~/projects/anki`** (archived on GitHub) — used exactly once,
  historically, via `anki_headless/` (an official-API-based headless
  AnkiWeb sync bridge built in that repo) to pull already-mined `WK Satori
  Immersion`/`WK Shadowing Immersion`/`WK Shadowing Candidate` notes into
  this app's inbox. No ongoing relationship; also the origin of a ported
  verb-pair-detection algorithm (`scripts/lib/verbPairs.ts`) used to seed
  `vocabulary_confusions`.
- **PASQA** — investigated (see Gaps section), not integrated, no live
  dependency.
