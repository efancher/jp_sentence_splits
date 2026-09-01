# Satori Glossbook — Product & Architecture Reference

*Prepared as context for an outside AI assistant (e.g. pasted into ChatGPT)
to reason about new features. Present-tense, system-oriented — not a
changelog. For current implementation state see `docs/STATUS.md`, and for
the chronological detail behind any claim here `docs/STATUS_ARCHIVE.md`;
for the original cross-repo planning analysis, see
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
reading-in-context, listening, cloze/reading-retrieval/reading-production
on individual vocabulary items, contextual conjugation drills per
word-occurrence, contrastive-pair
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
  - `inlineReading` is Satori-style `漢字[かな]` markup, parsed by
    `src/lib/parseInlineReadings.ts` (ruby base = the run's first kanji
    onward, keeping interior/trailing okurigana). For mining / re-segmented
    sentences it's built from morphology tokens by
    `src/lib/inlineReadingFromTokens.ts`, which fuses an Arabic numeral with
    its counter into one ruby span via `src/lib/japaneseNumberReading.ts`
    (`2人[ふたり]`, `1ヶ月[いっかげつ]`); `src/lib/fixNumeralReadings.ts`
    repairs the same in already-stored strings (import path + `npm run
    fix:numeral-readings`). Non-speech caption cues (`[音楽]`, `♪`) are
    stripped at subtitle-parse time and by `npm run fix:caption-artifacts`.
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
  `externalId` (`wk:{id}`/`jmdict:{id}`) for idempotent re-import, and
  optional `pitchAccentPositions` (mora index of the dictionary accent
  drop, from Kanjium via `scripts/backfill-pitch-accent.ts`) feeding the
  shadowing feature's ground-truth pitch-accent scoring (§6).
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
  numbers so stale caches can be invalidated). `ReferenceAlignment` is
  shared between the shadowing-analysis flow (`AnalysisPanel.tsx`) and the
  `listening` review card's karaoke highlighting
  (`KaraokeSentenceText.tsx`) — both call the same
  `loadOrComputeAlignment` (`src/lib/alignmentCache.ts`), so whichever
  triggers alignment for a given `SentenceAudio` clip first, the other
  reuses the cached result.
- `CardIssueReport` — a learner-authored free-text flag on a review card
  ("this reading looks wrong"), `status: open | resolved`, synced to
  Supabase specifically so a future AI/scripting session can triage a
  batch via `scripts/list-card-issues.ts`.
- **Grammar-learning system** (new; Phases 1-8 plus a Contrast slice of
  Phase 9 — schema/repository/sync/backup foundation, manual annotation
  from Analyze, the `/grammar` browser/detail UI, AI-assisted suggestion/
  explanation, `grammar_comprehension`/`grammar_completion`/
  `grammar_contrast` review cards, a derived learner-state ladder, a
  personalized `/grammar` curriculum dashboard, and `GrammarRelationship`
  browsing/creation, see the Feature walkthrough below — are all done, plus
  a `grammar_production` card (2026-09-01, the output rung — produce a
  sentence using a recognized pattern, self-rated); prediction/
  transformation activity types deliberately not started — see
  `docs/STATUS.md`): a second layer on top of the
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
- `PlannerSession` (Learning Orchestrator; syncs, last-write-wins conflicts) — one
  **calendar day's** recommended session, keyed by local `date`
  (`YYYY-MM-DD`, at most one per day, found via `getTodayPlannerSession`):
  `targetMinutes` (grows with each top-up), the mode `allocation` and prose
  `explanation` the planner produced (one entry appended per top-up, not
  overwritten), and an embedded ordered `steps: PlannerSessionStep[]`
  (mirrors `AnalysisChunk[]`'s "small list, not a join table" shape)
  tracking each step's status (`pending`/`active`/`completed`/`skipped`/
  `replaced`) and timestamps. Not to be confused with
  `AppSettings.newCardsPerSessionLimit` — an older, unrelated "session
  planner" (the per-sitting new-card cap on `ReviewPage`).

Sync/queue-internal tables (`syncMeta`, `syncQueue`, `syncRecordMeta`,
`syncConflicts`) are infrastructure, not domain data. `wanikani_subjects`
(Supabase-only, no Dexie counterpart) is a script-side cache of raw
WaniKani API responses — see External interop.

## Feature walkthrough

### 0. Learning Orchestrator — `HomePage.tsx` (`/`, the index route),
`SessionRunnerPage.tsx` (`/session/:sessionId`)
Answers "what should I do?" instead of leaving the learner to notice the
Review queue's due count and default to clearing it. Models study activity
across four concrete **activity buckets** (`SessionBucket`,
`src/domain/types.ts`) — **glossing** (structural analysis + vocab
confirmation on new sentences), **grammar** (examining not-yet-tracked
patterns), **shadowing** (pronunciation practice), **review** (every FSRS
due card — comprehension, cloze, production, grammar drills, etc. — one
shared due-queue, one bucket regardless of activity type) — a
scheduling/analytics lens layered on top of existing activity types, not a
new content model or a forced re-categorization of every feature. (Reworked
2026-08-26 from an earlier abstract Explore/Understand/Practice/Retain
taxonomy — `retain`'s due-batch and `practice`'s due-batch merged into the
one `review` bucket, and `shadowing` was promoted out of `practice` into its
own top-level bucket, per user feedback that the old taxonomy wasn't
concrete enough to set percentages against directly.) This app has no
continuous native-media player (audio is per-sentence clips, not a stream),
so glossing steps point at the next not-yet-studied sentences in a
recently-opened book instead of "continue watching." Each unstarted
sentence gets a `vocabulary_review` step (`VocabularyReviewPage`) and,
*separately*, a `continue_book` step (structural analysis, `AnalyzePage`) —
rather than one step bundling a whole book's worth of new sentences into a
single "N new sentences" line (follow-up, 2026-08-22). The two are no
longer always paired in the same pass (vocabulary-first reorder, user
request, 2026-08-27): a not-yet-confirmed sentence gets only
`vocabulary_review`; `continue_book` is withheld until the sentence's
vocabulary is both confirmed (`SentenceAnalysis.vocabularyReviewStatus`)
*and* every linked vocabulary item has itself reached FSRS proficiency
(`buildExploreSteps`'s `vocabularyReady`, reusing the same
`isSentenceReadyForFullReview` rule that gates full-sentence review cards,
§4) — so structural analysis/grammar glossing never surfaces before the
learner has actually demonstrated recall of the sentence's words, typically
landing a day or more after the vocabulary step once a review cycle has
passed. A sentence whose vocabulary is confirmed but not yet proficient
gets no glossing step at all that pass; the planner moves on to the next
sentence rather than blocking the book on it. Within the glossing bucket,
vocabulary confirmations get first claim on the minutes (user request,
2026-08-29): `buildExploreSteps` runs two passes — pass 1 spends up to
`VOCAB_CONFIRM_MIN_GLOSSING_SHARE` (0.6) of the bucket on `vocabulary_review`
steps across *every* candidate book before pass 2 drafts a single
`continue_book`, so a confirmation backlog never sits behind structural
analysis of sentences confirmed earlier in the reading order; pass 2 then
fills the rest of the bucket in reading order with both step kinds (it's a
floor on confirmations, not a cap — they can take more, and with no backlog
the reserve is zero and structural analysis uses the whole bucket).
`findExploreCandidates` reinforces this by floating books whose next
sentences still need vocabulary confirmed above fully-confirmed books
(recency order preserved within each group) before the candidate-slot slice,
so a slightly-older book with a backlog isn't dropped for a caught-up newer
one. The same rule extends to the
shadowing bucket (2026-08-27 follow-up, same user request): `findShadowCandidates`
(`src/db/repository.ts`) only pools sentences whose vocabulary is confirmed
and proficient before ranking by fewest existing attempts, so a sentence
never gets recommended for pronunciation practice while its words still
need conscious recall — the point of shadowing being free to focus on
pronunciation, not split attention with vocabulary retrieval. Unlike
glossing's not-ready sentences (which fall back to a `vocabulary_review`
step), an unready sentence simply isn't a shadow candidate at all — there's
no shadow-adjacent activity to substitute in, so `buildShadowSteps` needed
no change.

**Planner** (`src/lib/sessionPlanner.ts`) — pure, no Dexie access, same
convention as `scheduling.ts`/`maturity.ts`, so the whole decision process
is inspectable and unit-tested (`tests/sessionPlanner.test.ts`) without a
browser: recent-activity distribution over a rolling 14-day window ->
per-bucket **neglect scores** (linear, clamped, deliberately not an
exponential decay curve) -> **review-priority ranking**
(`scoreReviewPriority`, generalizing `grammarPatterns.ts`'s
`computeGrammarPriorityBucket`/`explainGrammarPriority` explainable-bucket
pattern across every subject type — forgetting risk x usefulness x
re-encounter freshness, plus a standalone weakness term, additive rather
than the source brief's literal product so a fresh single-context item
never scores to zero; the old two-pool retain/practice ranking is now one
combined ranked list, since the score doesn't care which pool an item came
from and `ReviewPage` itself doesn't distinguish them either) -> **time
allocation** across the four buckets (a 35/15/15/35
glossing/grammar/shadowing/review baseline nudged toward neglected buckets,
then clamped two ways: against how much each bucket's own candidate list can
actually absorb — `review` never gets padded with low-value reviews, and
neither `shadowing`/`grammar`/`glossing` get padded past their candidate
count — and against `REDISTRIBUTION_MAX_SHARE_MULTIPLE` x each bucket's own
fair share, so minutes freed by a thin bucket can't pile into one
down-weighted bucket that still has candidates and invert the learner's
split; whatever no bucket can absorb goes idle and the session simply comes
back shorter, with an explanation line saying so) -> concrete step
selection (the baseline itself is
`settings.sessionAllocation`, defaulting to `BASELINE_SESSION_ALLOCATION`
but user-editable directly on Home, see below), bounded to the best 10-15
due items rather than the whole queue. The `review` step is packed by
walking the combined ranked list and summing each item's own per-item cost
(retain-style recognition cards are quicker than practice-style production
cards) rather than a uniform count-based pack, since the merged pool is
heterogeneous — the chosen count is stored on the step as `targetCount` for
`ReviewPage`'s own tracking (see below). The review bucket also reserves
minutes for the **new-card backlog** (2026-08-31) — confirmed vocabulary
with no `vocabularyItem` study item yet, invisible to the due-item scan:
`countNewVocabularyCardBacklog` feeds `newCardBacklogCount`, and
`buildReviewBatchStep` adds `min(backlog, newCardsPerSessionLimit)`
retain-costed minutes plus the same count into `targetCount` and the label
("Review N due + introduce M new"), so a big first-review backlog no longer
loses its minutes to glossing. `ReviewPage` separately holds the review
step open (no auto-advance) while its pending-seed pool still has
never-introduced words and the per-session cap isn't reached -> **coherent-chain grouping**
(steps that share a sentence id, e.g. a grammar pattern and a shadowing
candidate from the same sentence, run back to back) -> a short
human-readable explanation ("You haven't touched shadowing in 6 days, so
this session emphasizes it."). `src/db/repository.ts`'s "Learning
Orchestrator" section is the only Dexie-touching half — it adapts live
`StudyItem`/`Review`/`Attempt`/`SentenceGrammar`/`bookSentences` data into
the planner's plain input types, batched (not N+1) the same way
`listGrammarPatternSummaries` already is.

**One growing daily session, not fixed Quick/Normal/Deep sittings**
(follow-up, 2026-08-21): `PlannerSession` is keyed one-per-local-day
(`date`), not one-per-"Start Session"-click — real usage is closer to "an
hour or so a day, picked up in small pieces" than one uninterrupted
sitting, and shadowing in particular is often only practical at certain
times (quiet room, mic). `addMinutesToTodaySession(minutes)` is the single
action behind both starting today's list (first call of the day) and
topping it up ("+20 min"/"+30 min" on Home, or the same default-minutes
button again) — it re-plans only against the newly added minutes, excludes
any sentence/book/grammar pattern already sitting anywhere in today's step
list (regardless of status) so a top-up doesn't re-suggest the same thing,
and leaves an already-`pending` due-review batch step alone rather than
duplicating it (its own live due-queue link already reflects the larger
budget in practice). A settled (`completed`/`ended_early`) session reopens
to `in_progress` only if a top-up actually finds something new to
recommend — finding nothing just leaves "all done for now" standing.
`explanation` accumulates one block per top-up ("Added 20 more minutes:
...") rather than being overwritten, so it reads as the day's story.
`getSessionPlannerInput`'s `exclude` param (sentence/book/grammar-pattern
id sets, derived from the existing session's steps) is the only new
surface on the otherwise-unchanged pure planner — `buildRecommendedSession`
itself just takes a plain `totalMinutes: number` now (the old
`SessionLength`/`SESSION_LENGTH_MINUTES` quick/normal/deep enum is gone).

**`HomePage`** — the index route (`BooksPage` moved to `/books`). Shows
today's session if one exists (`targetMinutes` so far, the accumulated
explanation, the full step list with a status badge per step) plus
"Start"/"+more time" buttons (`settings.dailyBudgetMinutes`, defaulting to
`DEFAULT_DAILY_BUDGET_MINUTES` = 60 and user-editable on the Settings page,
as the default add amount; `TOP_UP_INCREMENTS_MINUTES` = [20, 30], fixed,
for the smaller top-ups; both constants live in `sessionPlannerConfig.ts`)
and a "Continue today's session" link to the runner whenever a step is
still pending/active. A "Customize split" section (2026-08-26 follow-up, a
plain `<details>`, no native dialog; **open by default** as of 2026-08-27 —
was collapsed, but the user kept forgetting it was there to adjust before
starting) sits right above those buttons — four number inputs, one per
`SessionBucket`, defaulting to `settings.sessionAllocation`; editing one and
then Start/+time applies that split to just that call
(`addMinutesToTodaySession`'s optional `baselineOverride` param) and
persists it back as the new saved default. This **replaces** Settings'
old "Activity mix" panel rather than sitting alongside it — the split is
only editable here now. A "Clear today's session" button (2026-08-27,
below the step list) deletes today's `PlannerSession` outright
(`deleteTodayPlannerSession`, `src/db/repository.ts`) via an inline
confirm (no native dialog) — the fix for "I started with the wrong split
and there was no way to undo it," since only *newly-added* minutes could
ever pick up a corrected split otherwise; real underlying progress
(analyses, vocab confirmations, reviews) is untouched, only the session's
own step-list bookkeeping is discarded. Below that, the same compact
rolling-14-day
balance view as before (four `.progress-bar` meters — reusing the existing
CSS component rather than a charting dependency — fill = how recently each
bucket was touched) and a direct-access shortcut row
(Books/Grammar/Review/Words/Pronunciation/Pitch-accent drill/Progress/
Search), so the recommendation guides without gating. The **`ProgressPage`**
(`/progress`, also in the AppShell nav) is the standalone "how am I doing"
screen the 14-day meters don't give: `buildProgressReport` (pure) folds
`Review` rows + `StudyItem` FSRS state + the shadowing analysis summaries
into a vocabulary ladder (tracked / proficient / mature / first-recalled
recently), an FSRS recall-success rate (rating ≠ Again over scheduled
reviews, 30d + all-time), grammar tracked/recognized, the shadowing
timing/pitch trend, and an 8-week reviews-per-week + cumulative-words-learned
trend on the same `.progress-bar` meter. Read-only, recomputed on load,
nothing stored. **`SessionRunnerPage`** sequences today's steps, deep-linking into
the existing Analyze/Vocabulary/Grammar-detail/Shadow/Review pages for the
actual activity rather than reimplementing any of them — start/skip/
end-early are real, tracked actions. A step settles **only by an explicit
action**: the runner's own "Mark complete"/"Skip", `SessionBar`'s "Mark
complete", `ReviewPage`'s target-count auto-advance (once its live count of
reviews done this sitting reaches the step's `targetCount`, 2026-08-26), or
`endPlannerSessionEarly`. Doing the underlying work in place —
`confirmSentenceVocabulary`, `setBookSentenceStatus('complete')` — records
its own domain state but does **not** touch any session step (2026-08-27,
reverting the 2026-08-22 `autoCompleteSessionSteps` "real completion
auto-settles" path). That auto-settle was a footgun: after doing the work,
tapping the bar's "Mark complete" would settle and skip the *next*,
unstarted step. So the session step is a day-plan checklist item the
learner ticks off, layered over the real progress (analyses, vocabulary
confirmations, reviews) — never its source of truth, and the planner's
vocabulary-first gating reads that real state, not step status. A step
opened and left is never counted as done. "Replace an
activity" was deliberately not built for v1 (Skip plus a
later top-up covers the same need) — see `docs/STATUS_ARCHIVE.md`'s
2026-08-20 and 2026-08-21 entries for this and other known limitations (no time-tracking
infrastructure — glossing/grammar activity is inferred from existing row
timestamps). `PlannerSession` syncs to Supabase (2026-08-25 follow-up,
so the SessionBar "continue where you left off" state follows the learner
across devices) with last-write-wins conflict resolution rather than the
usual manual keep-local/keep-remote/duplicate panel — session-execution
bookkeeping, not durable content, so silently letting the most-recently-
pushing device win is an acceptable simplification. Since the deep-linked pages
themselves have no idea a session is running, a persistent **`SessionBar`**
(`src/components/SessionBar.tsx`, `useActiveSession` hook, mounted once in
`layouts/AppShell.tsx`) shows on every route whenever a session is
`in_progress` — progress, plus one action, so the learner is never
stranded on Analyze/Review/Shadow with no way back. That action is
**scoped to the page on screen** (2026-08-27): `useActiveSession` compares
each pending/active step's `sessionStepTargetPath` to the current route and
exposes `routeStep` (the step whose page this is) alongside `currentStep`
(the oldest unfinished). When `routeStep` exists the bar names it and "Mark
complete" settles *exactly that step*; otherwise it shows "Next: <label>"
and a plain **"Resume"** that only navigates to `currentStep`'s page —
never a settle. The earlier version always settled `currentStep` regardless
of the page, so "Mark complete" could quietly finish a step the learner had
jumped past without looking at. (2026-08-26 follow-up: Skip and a
standalone "Session" button were dropped from the bar — found cluttered/
hard to hold in mind mid-session, same reasoning as the earlier Record/Stop
single-control change; the full step list, where Skip still lives
unchanged, stays reachable via the "Session · X/Y" text, a plain link.)
"Mark complete" auto-advances: `settleSessionStep(sessionId, stepId,
status)` settles the given step, looks up the next pending/active step
after it in `session.steps`, marks it `active`, and returns it so the
caller can navigate to its `sessionStepTargetPath` — shared by `SessionBar`
and (2026-08-26 follow-up) `ReviewPage`'s own target-count auto-advance, so
neither hand-rolls the "find the next step, activate it" lookup.
`SessionRunnerPage`'s list-row "Mark complete" is unchanged (stays on the
list; the reactive `activeIndex` just shifts to the next row).
Relatedly, `VocabularyPicker` has a single "Confirm vocabulary" button that
saves without navigating (the earlier "Confirm and next →" was removed
2026-08-27 — moving through a session is "Mark complete"'s job); `PracticePage`
keeps its own book-level "Complete & next" / "Needs review & next" buttons
for paging through a book outside a session. `ReviewPage`'s
rating-button-driven due-card queue is otherwise unchanged by design —
advancing to the next due card on rating is normal review-flow behavior,
not a session-tracking gap. What *is* new (2026-08-26 follow-up):
`ReviewPage` now checks whether the active session's current step is a
`review` batch step and, if so, shows a live "Reviews this step: X / N"
line (`countReviewsSince`, a new `repository.ts` helper — timestamp-based
off `Review` rows created since the step went `active`, not component
state, so progress survives leaving and returning to the page) and, once N
is reached, calls `settleSessionStep` and navigates to the next step —
this is the one place a deep-linked page is deliberately made
session-aware, since the `review` step's count otherwise had no way to be
observed from outside `ReviewPage`'s own due-queue state.

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
- **Import from YouTube** (`YouTubeMinePage.tsx`, route
  `/import/youtube`) — an in-app alternative to the `.shadowing.zip`
  upload above that needs no separate CLI. Paste a YouTube URL and the
  self-hosted `server/youtube-mining/` service downloads audio +
  subtitles + runs ASR, then a **4-step wizard** walks the job's
  re-runnable `stage` machine (`docs/mining-wizard-spec.md`):
  **Transcript** (correct the ASR/caption segments against per-segment
  audio, with low-confidence flags and coarse merge/split — plus a
  **"Segment with AI help"** panel that formats the fragments as a
  copy-pasteable `[m:ss] text` prompt for an external assistant and parses
  its `[m:ss] sentence` reply back into segments, for when the transcript
  fell back to punctuation-free auto-captions; `formatTranscriptForAI` /
  `parseAiSegmentedTranscript` in `src/lib/miningTranscript.ts`, manual
  copy/paste, no Edge Function) → **Segment**
  (`<SegmentationEditor>` — sentence rows, each playing its span, above a
  waveform whose per-boundary handles drag onto pauses, "Snap to pauses")
  → **Translate** (EN per row, editable, "Auto-fill translations (AI)"
  reuses `sentence-realign`, grouped by transcript-segment provenance) →
  **Commit** (one `POST /jobs/{id}/commit` clips every row from source
  with audio inline; preview + vocab-suggestion count). Back/forward +
  per-stage re-run. The in-flight job id is persisted to `localStorage`
  (`ytmine.activeJob`, ignored past the server's 6h job TTL) so a refresh /
  accidental nav / phone tab-unload **reconnects** by rehydrating from the
  job's server-side `stage` rather than restarting a 20-minute mine — the
  job is no longer deleted on plain unmount (TTL sweep + explicit
  Start-over/Cancel/finish handle cleanup). During the long download/ASR
  step the panel shows a live `N:NN elapsed` (`job.message_started_at` →
  `elapsedSeconds` in the status response) with a soft per-step ETA.
  Finishing assembles the same
  `ShadowingImportPreview` (`buildShadowingPreview()`) and commits through
  the identical `commitShadowingPackageImport()` — same book-per-source,
  idempotent-on-reimport behavior; only how the preview gets built
  differs.
- **Re-segment captions** (`ResegmentSourcePage.tsx`, route
  `/books/:bookId/resegment`, button on `BookDetailPage` for
  `sourceKey` starting `shadowing:`) — rebuilds a source's sentences on
  real sentence boundaries after the fact, for imports that predate the
  resegmentation pass. Calls the stateless `POST /resegment` on
  `server/youtube-mining` (re-segment + kana + tokens, no re-download;
  `merge:false split:false` = annotate-only for song lyrics), lets the
  user merge/split/edit in a review step (`SegmentationEditor.tsx`, a pure
  row-list component shared with the mining wizard's segment stage — with
  the same boundary-drag waveform when the book has a `sourceUrl`, fed by
  `POST /source-audio/range`), then `applyResegmentation()`
  (`src/db/repository.ts`) creates the new sentences, retires the old
  ones (`deleteSentenceCascade`; soft delete, never raw DELETE), carries
  study progress onto the
  best-text-overlap replacement (`src/lib/resegmentPlan.ts`), and repoints
  surviving vocabulary links. Chunk analysis is offset-bound and dropped.
  A split sentence seeds its English from the old translation; an
  "Auto-fill translations (AI)" button (`sentence-realign` Edge Function,
  Claude Haiku) *redistributes the existing human translation* across the
  new pieces rather than translating from scratch. The review list shows
  in full only the sentences a study card is migrating onto (the rest
  collapse behind a "Show all" toggle) so a 90-sentence source is a
  handful of rows to check. Reference audio is carried across too: each
  new sentence's clip is re-cut from the old per-fragment clips it
  overlaps in the video timeline via a stateless `POST /reclip`
  (concatenate + ffmpeg cut + optional silence-trim, no re-download);
  best-effort, so a re-segment still lands if the mining service is
  unreachable.
- **Books/Chapters** (`BooksPage.tsx`, `BookDetailPage.tsx`) — sentences
  organize into named books with ordered chapters; drag-and-drop reorder
  (`@dnd-kit`), "Order from paste" (reorders a book to match pasted Satori
  chapter text, `src/lib/pasteOrder.ts`), move/copy sentences between
  books, archive books. Two book-delete buttons: "Delete book" drops the
  book but leaves its sentences in the library; "Delete book + sentences"
  (`deleteBookCascade`, two-step inline confirm) also retires every
  sentence the book would orphan, keeping any shared with another book.
  A single sentence is deleted from the "Danger zone" at the bottom of
  `AnalyzePage` (`deleteSentenceCascade`, two-step confirm) — both cascade
  paths soft-delete via the normal queued `delete`, never raw DELETE, and
  leave confirmed vocabulary/kanji in the library.
- **Inbox** (`InboxPage.tsx`) — sentences land here by default until filed
  into a book; `ImportBatchPage.tsx` lets you review/organize everything
  from one import run at once.
- **Search** (`SearchPage.tsx`) — full-text-ish search across sentences
  with facet filters (in inbox, not in a book, by study status,
  has-warning, multi-vocab, missing translation/analysis); results can be
  bulk-added to a book or exported as a worksheet. "In inbox" keys off the
  `inbox` table (import → "Leave in Inbox"); "Not in a book" catches every
  sentence with zero `bookSentences` rows, including ones removed from
  their only book.

### 2. Structural (Cure-Dolly) analysis — `AnalyzePage.tsx`,
`src/lib/chunking.ts`/`clauseBands.ts`/`stickyEnglish.ts`/`puzzleShapes.ts`
The core, most-differentiated feature. A sentence is split into an ordered
list of `AnalysisChunk`s, each assigned a grammatical role (topic/subject/
object/verb/particle/etc. — see `ROLE_PRESETS` in `appConfig.ts` and
`src/lib/roleGuide.tsx` for the full taxonomy) and a "literal English"
gloss (sticky/word-for-word, not fluent translation — a local heuristic,
never machine translation; the two Claude Edge Functions only ever pre-fill
*editable* fields, never the chunk/sentence sticky English). Supports
synthetic zero-が chunks for Japanese's
frequent implicit subject. Chunks render as visually distinct "puzzle
piece" shapes (`puzzleShapes.ts`/`puzzlePiecePath.ts`) whose edge shape
encodes grammatical fit, so structure is visually scannable.
`lintAnalysis` (`analysisSuggestions.ts`) flags likely mistakes (e.g.
discarded annotations, chunk/source mismatches). Sentence translation is
directly editable inline (textarea, autosave). A **"Grammar noticed" panel**
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

**Vocabulary confirmation — `VocabularyReviewPage.tsx`** (`/books/:bookId/
vocabulary/:sentenceId`, follow-up, 2026-08-22): split out of `AnalyzePage`
into its own page so the Learning Orchestrator can sequence/track it
independently of structural analysis (see below). The `VocabularyPicker`
component itself is unchanged and fully self-contained (no dependency on
`AnalyzePage`'s chunk/notes state) — it just moved pages. It lets the user
tap tokenizer-derived `vocabularySuggestions` (or add manually) and
"confirm" them via the new `confirmSentenceVocabulary` repository helper,
which materializes real `VocabularyItem`/`SentenceVocabulary`/`Kanji`/
`VocabularyKanji` rows (`materializeVocabularySelections`) — this is the
load-bearing bridge between the sentence-analysis world and the SRS world.
`AnalyzePage` and `VocabularyReviewPage` cross-link (a "Vocabulary" button
on `AnalyzePage`'s header and on each `BookDetailPage` sentence row; an
"Analyze" link back from the vocabulary page).

**Vocabulary meaning glossing.** The fugashi/UniDic tokenizer gives every
suggestion a surface/lemma/reading/POS but never an English gloss, so
YouTube-mined vocabulary arrives with the "Meaning (optional)" field blank.
Two things fill it: (1) `VocabularyReviewPage` fires one `vocab-assist` Edge
Function call (Claude Haiku, `src/lib/vocabAssist.ts`) the first time it
opens a sentence whose content words have no meaning yet — glossing them
*in sentence context* (which resolves homophones/senses JMDict can't:
する, 先), persisting the result onto the sentence's suggestions
(`updateSentenceVocabularySuggestions`) and any blank selections; (2) a
per-word **"Suggest (AI)"** button in the `VocabularyPicker` edit view for
one-off fills. Both only pre-fill the still-editable field and degrade
silently offline/signed-out. Offline, the deterministic path is the
`backfill:vocabulary-suggestion-glosses` / `backfill:vocabulary-meanings`
scripts — POS-aware JMDict lookup (`scripts/lib/jmdict.ts` takes the
tokenizer POS to disambiguate homophone clusters) with a JMnedict
fallback (`scripts/lib/jmnedict.ts`) for proper nouns.

### 3. Practice & Build modes (lightweight, non-SRS study)
- **Practice** (`PracticePage.tsx`) — reveal-based drilling scoped to a
  book/chapter/status filter; deterministic shuffle, staged reveals, TTS
  playback, "Complete & Next"/"Needs Review & Next," desktop arrow-key
  nav. Also hosts a "Recognized these without hints?" panel that lets the
  user self-report natural encounters with vocabulary outside the formal
  review queue (`recordNaturalEncounter`, feeds `Review.source =
  'natural_encounter'`), and (Phase 6/7/8 of the grammar-learning system)
  an analogous "Recognized this grammar without hints?" panel — only for
  patterns already tracked (a `grammarPattern` study item exists) and
  linked to the current sentence via `SentenceGrammar`, feeding
  `recordGrammarNaturalEncounter`.
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
- **Sentence subject**: `comprehension` (JP in isolation, reveal EN+vocab,
  self-rate) and `reading_in_context` (same reveal flow, but the sentence
  is framed by its reading-order neighbours — preceding sentences shown
  untranslated above it, the following sentence folded into the reveal, via
  `src/lib/readingContext.ts`'s `buildReadingContextMap` +
  `ReadingInContextCard`; falls back to the isolated layout when no context
  is available).
- **Sentence subject, audio-gated**: `listening` — only eligible for
  sentences with a `SentenceAudio` row; audio plays first, Japanese text
  stays hidden until reveal. A playback-speed `<select>` (same
  `PLAYBACK_SPEEDS` as ShadowPage) sits next to the play button. Reveal is
  staged in two steps, not one: "Reveal text" shows only the Japanese (so
  the learner can check whether they parsed the audio correctly, separate
  from whether they know the vocabulary), then "Reveal translation" shows
  the translation and vocab chips; only the second step satisfies the
  parent `revealed` gate that unlocks the FSRS rating buttons. On text
  reveal, the sentence renders via `KaraokeSentenceText`
  (`src/components/KaraokeSentenceText.tsx`): the **real** `sentence.japanese`,
  split into tokens on its `vocabularySuggestions`' char offsets
  (`buildSentenceTokens`, exported + unit-tested in
  `tests/karaokeSentenceText.test.ts`) — not the aligner's own
  dictionary-normalized transcript, which can diverge (kanji where the audio
  was kana, literal `<unk>` where it couldn't be placed). It lazily
  computes/caches a `ReferenceAlignment` for the clip (via
  `loadOrComputeAlignment`, same cache the shadowing-analysis flow uses);
  during playback a `requestAnimationFrame` loop highlights whichever token
  the playhead sits in, mapped through the aligner's word timings by a
  forward `indexOf` resync (`alignmentCharPositions`), and a popup shows
  that token's English gloss. Falls back to plain static text when alignment
  isn't cached and the service is unreachable. The gloss is the suggestion's
  own `english` or a `targetVocabulary` entry matched by the suggestion's
  dictionary `expression`/`reading` (so a conjugated token still resolves).
  A smaller kana line (`sentence.readingOnly`) underneath is the separate
  pronunciation guide. This full-sentence `listening` card is **tier 2 of a
  listening ladder**: withheld until every `word_listening` card (below) for
  the sentence's vocabulary occurrences is FSRS-proficient
  (`getSentenceListeningReadiness`), on top of the usual
  vocab-confirmed-and-proficient gate — so the learner has heard each
  content word in isolation before being asked to parse the whole clip.
- **SentenceVocabulary subject, audio-gated**: `word_listening` — tier 1 of
  that ladder. One card **per surface-form occurrence** of a word in a
  sentence that has a `SentenceAudio` row (like the contextual conjugation
  card; subjectId a `SentenceVocabulary.id`). The card loops just that
  word's span of the recording via `SegmentLoopPlayer`
  (`src/components/SegmentLoopPlayer.tsx` — the isolate-a-range-and-loop
  control extracted from `PitchAccentNativeAudio`, using
  `isolatedWordRange` + `PlaybackCoordinator.loopRange`, with a
  whole-sentence fallback when forced alignment can't isolate the word) and
  asks the learner to recall its reading/meaning, then self-rate. Eligible
  only once the word's own reading is FSRS-proficient
  (`getProficientVocabularyItemIds`, via the new
  `ActivityDescriptor.isReady` hook) — so the ladder is cloze/reading →
  word listening → sentence listening. Words with no separate vocabulary
  entry (particles, function words) get no tier-1 card and are only ever
  tested inside the full sentence. Like the conjugation card, neither tier
  has a `deferUnreadySentenceReviews` pass — the `isGatedOut` filter keeps
  gated items out of both the due queue and the pending-seed pool.
- **VocabularyItem subject** (all three require a `surfaceForm`-bearing
  `SentenceVocabulary` link, i.e. only vocab confirmed via the picker
  after `surfaceForm` was added): `reading_retrieval` (show word, hide
  reading), `cloze` (hide the word entirely in its sentence, showing the
  sentence translation as a pre-reveal hint so the blank isn't otherwise
  under-constrained),
  `reading_production` (show the word, type the reading — typed-answer
  checked via `isReadingAnswerCorrect` in `src/lib/readingAnswer.ts`, which
  is whitespace/kana-form lenient: accepts romaji typed without a Japanese
  IME and katakana-vs-hiragana differences; the same helper backs
  `classifyReviewError` so an accepted answer isn't logged as an error;
  both `reading_production` and `sentence_transformation` echo the
  learner's own typed answer back on an incorrect reveal. When the word
  appears inflected in the sentence (頑張って for 頑張る) the card names the
  dictionary form explicitly ("Dictionary form: 頑張る", label becomes "Type
  the dictionary reading") — since `sentence_transformation` is the card
  that tests producing the inflected form — *and* also accepts the
  in-context inflected reading pulled from `inlineReading`
  (`surfaceReadingFromInline`), recording whichever reading it actually
  graded against as `Review.expectedAnswer` so `classifyReviewError` stays
  consistent; `reading_retrieval` gets the same dictionary-form label, `cloze`
  does not since it would spoil the blanked word),
  `pitch_accent` (narrower eligibility than the other three — only
  words with dictionary pitch-accent data (`VocabularyItem.pitchAccentPositions`)
  *and* whose context sentence has a native reference recording
  (`SentenceAudio`) to model the accent on the reveal; a
  dictionary-contour-only card was dropped as not worth its queue slot —
  multiple choice among the pitch-accent categories actually
  distinguishable at the word's own mora count,
  `possiblePitchPatternsForMoraCount` in `src/lib/pitchAccentShape.ts`; the
  reveal draws the mora-by-mora H/L contour via `PitchAccentDiagram`
  (`src/components/PitchAccentDiagram.tsx`), an SVG render of the same
  `expectedPitchShape` the scoring path uses, with a trailing
  following-particle node so heiban reads apart from odaka. Below the
  diagram, `explainPitchAccent` (`src/lib/pitchAccentRules.ts`) adds a
  plain-language gloss of the contour plus, for the rule-governed cases
  only — loanwords, pre-accenting suffix compounds (〜的/〜性/〜化/〜学/〜者),
  and the verb / i-adjective two-class system — a "why this pattern" note,
  each cross-checked against the word's real Kanjium position and
  suppressed on disagreement; plain native nouns get a "memorized, no
  rule" fallback). The reveal also renders `PitchAccentNativeAudio`
  (`src/components/PitchAccentNativeAudio.tsx`) — a "Loop native word"
  toggle that plays just the target word's span on repeat as a model of
  the real realization next to the dictionary contour, with a
  pitch-preserving speed control and a whole-sentence button for context.
  The word's span is located by forced alignment (`isolatedWordRange` in
  `src/lib/isolatedWordRange.ts` — character-proportion mapping like
  `SyncedShadowText`, folding in a following ≤2-char case particle so the
  post-word pitch is audible); it falls back to whole-sentence-only
  playback when alignment is unavailable or the word can't be located.
  Plays through a local `<audio>` + `PlaybackCoordinator`, not the
  `nativeAudioController` singleton (no range support there). The reveal
  also shows `SentencePitchAccentRow` (see below) for the whole sentence,
  with the card's target word highlighted.
- **SentenceVocabulary subject**: `sentence_transformation` (activity-type
  string kept for continuity; label displays as "Conjugation in context").
  One StudyItem **per occurrence** of a conjugable word in a sentence
  (subjectId a `SentenceVocabulary.id`), not per word. Quizzes the
  conjugation form *that sentence actually used* — a verb read in a te-form
  sentence and a conditional sentence gets a separate card for each, and a
  form never encountered in the corpus is never drilled. The form is
  recognized by `identifyConjugationForm` (`src/lib/conjugation.ts`), the
  reverse of `conjugate`: it conjugates the dictionary form to every form
  the word class offers (13 verb / 10 adjective) and returns the one the
  surface reproduces, or null — so stacked/compound surfaces (話している,
  食べられなかった) and bare dictionary-form occurrences get no card. The card
  is a cloze: sentence with the verb blanked, "Dictionary form: X" +
  "Produce: {form}", type the reading (accepts the in-context inflected
  reading via `surfaceReadingFromInline` or the engine's own). Candidates
  come from `getVocabularyOccurrenceCandidates` (one entry per surface-form
  link, unlike `getVocabularyTargetCandidates`) → `getSentenceConjugationCandidates`.
  Subject to the same Phase 7.11 full-sentence gate as the sentence's own
  cards (via `ActivityDescriptor.gateSentenceId`): withheld until the
  sentence's vocabulary is confirmed and proficient.
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
  `grammar_completion`'s distractor pool ranks `GrammarRelationship`-linked
  patterns first (Phase 8, `buildGrammarCompletionChoices`'s
  `relatedPatternIds` param) — a distractor the learner flagged as
  confusable via the detail page is a more useful contrast than a random
  one from the corpus. `grammar_contrast` (Phase 9 Contrast slice, design
  brief §11C): "can you tell these two apart," specifically for a
  `GrammarRelationship`-linked pair — always exactly two choices, the
  full unblanked sentence (blanking would risk erasing the very
  distinction under test), auto-graded via the same typed-response funnel
  as `grammar_completion`. Its eligibility is narrower than the other two
  grammar activity types (needs a relationship, not just tracking), so
  **it's the one grammar activity type that can get lazily seeded by
  `ReviewPage`'s generic pending-seed pool** — the moment a relationship
  makes a candidate available for an already-tracked pattern, no
  `GrammarPicker.tsx` change needed. Reaching FSRS proficiency on this
  study item is what lets `computeGrammarLearnerState` return
  `'distinguished'`, one rung above `'recognized'`.
  `grammar_production` (docs/ROADMAP.md, 2026-09-01 — the output rung the
  grammar system was missing; every other grammar card asks the learner to
  *identify* a construction, this asks them to *use* one): shows the
  pattern's meaning, takes a free-form sentence, then reveals a model (one
  of the learner's own tagged encounters, `pickContextSentenceForGrammarPattern`)
  to self-rate against. `grammarPatternUsedIn` (`src/lib/grammarPatterns.ts`)
  is a weak "did you actually use it" hint on reveal (every wave-dash-
  separated fragment of the tilde-stripped canonical name present, any
  order) — meaning and naturalness are the learner's own call, so unlike
  `grammar_completion`/`grammar_contrast` this is **self-rated with no
  `expectedAnswer`** and `classifyReviewError` leaves it unclassified.
  Eligibility is narrower than plain grammar review — only a tracked
  pattern whose `grammar_comprehension` item is FSRS-proficient (learner
  state `recognized`+), mirroring `reading_retrieval` → `reading_production`
  — and like `grammar_contrast` it can be lazily seeded by the generic
  pending-seed pool once a pattern crosses that bar. `computeGrammarLearnerState`
  is unchanged (no `productive` rung yet).

**Gating and mnemonic/assistance tracking**: a sentence's full-sentence
cards (`comprehension`/`reading_in_context`) are deliberately withheld
until its linked vocabulary is both *confirmed*
(`SentenceAnalysis.vocabularyReviewStatus`) and *shown proficient* (FSRS
state has graduated past "new/learning" for every reviewable vocabulary
item in that sentence) — `getSentenceFullReviewReadiness`/
`isSentenceReadyForFullReview`/`deferUnreadySentenceReviews` implement
this, applied both as an ongoing filter on the due queue and defensively
against lazily-seeded new items so nothing bypasses the gate. The
`listening` card adds a second layer on top (the listening ladder, §4
above): `getSentenceListeningReadiness` also requires every
`word_listening` occurrence for the sentence to be proficient, and
`word_listening` itself is gated behind the word's reading proficiency —
both via the generic `ActivityDescriptor.isReady` hook rather than a
`deferUnreadySentenceReviews` pass. The same
readiness rule gates which sentence a grammar review card shows, too
(2026-08-27 follow-up): `pickContextSentenceForGrammarPattern` — which
`ReviewPage` uses to choose which of a tracked pattern's sentence encounters
to show for `grammar_comprehension`/`grammar_completion`/`grammar_contrast`
— skips any encounter whose vocabulary isn't confirmed+proficient,
preferring an older-but-ready encounter over the most recent unready one,
and simply not offering the pattern as a review candidate at all if none of
its encounters qualify (no due-date push needed here, unlike
`deferUnreadySentenceReviews`, since a `grammarPattern`-subject StudyItem
has no single fixed sentence to defer against).
Mnemonic-shown/audio-replayed/etc. assistance flags are recorded on
`Review.assistance` without penalizing the score — informational only for
future planning. The "Show mnemonic" scaffolding on vocabulary-target
cards (`CardMnemonic` in `ReviewPage.tsx`) has three source tiers, in
order: (1) the learner's own `VocabularyItem.notes`; (2) WaniKani's
meaning/reading mnemonic for the word itself
(`VocabularyItem.meaningMnemonic`/`readingMnemonic`, backfilled by
`scripts/backfill-wanikani-mnemonics.ts`, ~6.5k WK-catalog words) —
*unless* it's one of WaniKani's "you already know the component kanji"
placeholders (`isDeferralMnemonic`, `src/lib/wanikaniMnemonic.ts`), which
is useless if the learner doesn't, so those fall through to tier 3 and
render only as an italic lead-in above it; (3) WaniKani's mnemonics **and
hints** for the word's component kanji
(`Kanji.meaningMnemonic`/`meaningHint`/`readingMnemonic`/`readingHint`,
filled by re-running `scripts/import-wanikani-kanji.ts`; ~2k kanji, so
mined words that miss tier 2 often land here) — one block per kanji, the
hint on a dimmer line. Hints exist only on WaniKani kanji subjects, never
vocabulary. Reading-focused cards use the reading mnemonic; `cloze` uses
the meaning mnemonic. All rendered through `src/components/MnemonicText.tsx`,
which parses WaniKani's inline `<radical>`/`<kanji>`/`<vocabulary>`/
`<reading>`/`<ja>` markup into colour-coded spans (no HTML injection). Not
surfaced anywhere outside review cards. A **session planner** caps new-subject introduction per
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
A personalized curriculum dashboard (Phase 7), not a flat browsable list:
`/grammar` groups tagged patterns into four explainable priority buckets
(`GRAMMAR_PRIORITY_BUCKET_ORDER` — Worth learning now / Developing /
Recently encountered / Strong, via `computeGrammarPriorityBucket`), each
pattern showing a prose explanation of its own bucket
(`explainGrammarPriority`, e.g. "Encountered 3 times, across 2 sources,
needed help on 1 of the last 5 reviews.") rather than a bare number or an
opaque score — closer to "what's actually showing up, and how well do you
know it" than a dictionary or a JLPT-ordered syllabus. The detail page
shows a derived learner-state badge (`GrammarLearnerState` — Encountered /
Noticed / Recognized / Distinguished (the last requires FSRS proficiency
on the pattern's own `grammar_contrast` study item, Phase 9 Contrast
slice), `computeGrammarLearnerState`, Phase 6; never manually set)
alongside "Your encounters" (design brief §5/§6 — "where
else have I seen this?"): every sentence a pattern has been tagged in, via
`listSentenceGrammarForPattern`, each linking into
`/books/:bookId/analyze/:sentenceId` when a book membership exists (plain
text otherwise), with native audio playback (`NativeAudioButton`) when the
sentence has `SentenceAudio`. The pattern's own `shortMeaning`/
`structuralNotes`/`explanation`/`family` are editable inline — currently
the only way to fill them in, same caveat as `GrammarPicker`'s Explain
panel (no AI yet). A **"Related patterns"** section (Phase 8) lists
existing `GrammarRelationship` edges via `listGrammarRelationshipsForPattern`
(each linking to the other pattern's own detail page) and an inline picker
(relationship-type + pattern selects, no native dialogs) to create new
ones via `ensureGrammarRelationship`.

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
  `AudioContext` for mic analysis + reference playback. The live amplitude
  waveform applies a gentle `sqrt`-curve auto-gain (`gentleLiveGain` in
  `src/lib/waveform.ts`) toward the reference's peak level so a quiet
  speaker still reads as a comparable shape (never to full parity — a
  loudness cue is kept).
- **Live pitch-contour overlay** during recording (YIN pitch detection,
  `src/lib/pitch.ts`, validated against synthetic tones — no fixtures
  existed in the source repo for this). Both the reference and the live
  contour are normalized to their *own* running median pitch (`medianHz`),
  so a baritone matching a higher-pitched reference compares contour
  *shape* on a shared 0 line rather than being pushed off the display.
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
  - **Ground-truth pitch-accent feedback** (`pitchAccentShape.ts`/
    `pitchAccentObservations.ts`) — unlike every other signal above, this
    compares the learner's own recording against a dictionary-predicted
    pitch shape (Kanjium data, via `scripts/backfill-pitch-accent.ts` →
    `VocabularyItem.pitchAccentPositions`) rather than a reference
    recording, so it needs no reference clip/`SentenceAudio` at all —
    only the sentence's confirmed vocabulary and the learner's own
    alignment. Deliberately collapses the odaka/heiban distinction (both
    produce an identical shape within a single word's own span) rather
    than guessing at it. Renders as its own "Pitch accent (dictionary)"
    section in `AnalysisPanel.tsx` and feeds the same ranking as every
    other observation kind. The same `pitchAccentPositions` data also
    feeds two other, independent consumers — the `pitch_accent` SRS review
    activity type (§4), and the **audio-less pitch-accent drill**
    (`PitchAccentDrillPage` at `/pitch-accent`, `getPitchAccentDrillSentences`):
    a lightweight non-SRS practice loop over Satori sentences that have
    confirmed pitch-accent-bearing vocabulary, no reference recording, and
    proficient words — record the sentence, get each target word's realized
    contour scored against the dictionary shape (same
    `buildPitchAccentShapeObservations`, learner alignment only), nothing
    saved. So a word's pitch-accent data backs passive shadowing feedback,
    an active-recall flashcard, and a recording drill.
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
  - **Cross-sentence pronunciation profile** (`pronunciationProfile.ts`,
    `PronunciationProfilePage` at `/pronunciation`) — the aggregate view
    the per-sentence history can't give: `buildPronunciationProfile` folds
    every `AttemptAnalysisSummary` across every sentence into a ranked
    recurring-focus-area list (which `primaryIssueKind` leads most often,
    over how many distinct sentences, with an improving/worsening/steady
    trend from the recent vs earlier half of attempts) plus overall
    timing/pitch trend lines and a one-line headline. All-time / 30d / 90d
    window. Built only from severities (already per-speaker-normalized
    upstream), so it never compares absolute pitch or loudness. Linked from
    Home's shortcut row and ShadowPage's "Past attempts" header. Closes
    Phase 9's one open milestone (brief's Phase 15).
- **Word-synced text/mora highlighting during reference playback**
  (`SyncedShadowText.tsx`, a shared component): as the clip plays, the
  currently-spoken portion of the Japanese sentence and the mora/hiragana
  row underneath it highlight together. Reuses the same alignment fetch as
  `AnalysisPanel`, but ticks off the caller's own `<audio>` element
  directly rather than the `nativeAudioController` singleton
  `KaraokeSentenceText` (§4) relies on, since shadowing plays through a
  separate `PlaybackCoordinator`-managed element. Highlight boundaries are
  proportional (aligned word's character-length fraction of the transcript
  applied to both `sentence.japanese` and the mora sequence), not exact
  text-matched, since the aligner's tokenization, `sentence.japanese`, and
  `inlineReading`'s word boundaries aren't guaranteed to agree. Falls back
  to the old static text + `MoraBreakdown` rendering when alignment isn't
  available. Rendered in two places: at the top of `ShadowPage` (hidden
  while guided mode is active, to avoid a duplicate), and inside
  `ProgressiveShadowingPanel` directly above every stage's action
  buttons — kept close to the buttons deliberately, so the text being
  practiced stays in view while pressing Shadow along/Hear that
  back/Compare/Retry, not just while reading.
- **Per-word pitch-accent H/L marks** (`SentencePitchAccentRow.tsx`,
  `sentencePitchAccent.ts`): beneath `SyncedShadowText`, and in
  `AnalysisPanel`'s pitch-accent section, a compact "H"/"L"-per-mora
  contour for each confirmed sentence word that carries Kanjium/UniDic
  accent data, plus a following-particle mark. Deliberately one
  independent contour per word (from that word's dictionary reading), not
  a joined sentence line — Japanese compound/cross-word accent isn't
  computed anywhere in this codebase (see `pitchAccentRules.ts`). Words
  with no accent data and particles are simply absent; renders nothing
  when the sentence has no accented words. Word order under the sentence
  is by first unclaimed `indexOf` of the surface form.
- **Practice-mode variants**: "Delayed shadow" (listen in full, then
  auto-record after a configurable 0.5–2.0s gap) and "Show meaning
  instead" (swap Japanese transcript for English translation, forcing
  production from meaning — disabled when no translation exists).
- Graceful fallback everywhere the forced-alignment service is
  unreachable (falls back to an onset/cross-correlation heuristic) — the
  app must keep working with the service off the tailnet.
- **Guided/progressive practice** (`ProgressiveShadowingPanel.tsx`, toggled
  via a "Start guided practice" button, only shown when reference audio
  exists) — a low-friction, single-screen alternative to the free-form
  controls above, for learners who find "record vs. stop vs. shadow-mode vs.
  delay vs. calibrate, all visible at once" too much to hold in mind while
  practicing. Walks Listen → Pause & Repeat → Delayed Shadow → Close
  Shadow → Record & Compare, with Back/Skip/Restart always available (the
  learner controls pacing, not a rigid rep count — soft on-screen tips like
  "try this once or twice" are text only, never enforced). Deliberately
  built as a thin orchestration layer, not a new audio engine:
  - Every stage reuses existing primitives: Listen/Repeat use the same
    `<audio>` element + `PlaybackCoordinator` (now with a `playRange` method
    alongside `alternate`/`dualEar`/`loopRange`, for a single range-bounded
    playthrough — recording.ts). **Delayed Shadow and Close Shadow are the
    same underlying mechanism** — both call `startRecording('shadow', ...)`
    (the existing shadow-mode play-along recording) — the only difference
    between the two stages is the on-screen coaching text ("trail a beat
    behind" vs. "stay as close as you can"). No artificial audio-delay
    mixing was built; the trailing behavior is coached, not engineered.
    Both also have a **"Loop shadow reps" toggle** — hands-free practice
    that plays the native audio on a loop while the mic records, giving
    one ephemeral take per rep (replaces the stage's take each time, so
    "Hear that back"/"Compare" reflect the latest; nothing persisted).
    `ShadowingController.startShadowLoop` is a distinct path from
    `startRecording('shadow')` run repeatedly: **all the user-gesture-gated
    calls happen once, under the starting tap** — `getUserMedia`,
    `AudioContext.resume()`, the first reference `play()` — after which the
    reference `<audio loop>` re-plays itself and only `MediaRecorder`
    cycling runs. On its 100 ms tick the controller watches the reference's
    `currentTime` (it does *not* `notify()` per tick — that 10 Hz churn
    re-rendered the panel + waveform enough to scroll on mobile); when
    `currentTime` jumps back past half the clip (a loop wrap) it calls
    `RecordingService.cycleRecorder()` — stop + fresh `MediaRecorder` on
    the *same* held-open stream — so each rep is a separate blob. This
    once-under-the-tap structure is what it takes on **iOS Safari**, where
    those three calls need a transient activation that lapses seconds after
    the tap — two earlier per-*rep*-setup versions reliably died ~6 reps in
    with "the request is not allowed by the user agent or platform." The
    shared mic analyser stays up, so the **live waveform runs during the
    loop**. `stopShadowLoop()` captures the final rep and tears down; a
    dead-mic cycle failure ends the loop via `endShadowLoop()` rather than
    spinning; stage change / unmount go through `cancelRecording()`. The
    panel's Delayed/Close action area has a reserved `minHeight` so the
    controls swapping (record ↔ loop ↔ stop) don't reflow the sentence
    out of view.
  - Recording auto-stops shortly after the reference clip's expected
    duration (with a fixed trailing buffer), but the single
    `RecordToggleButton` (`src/components/RecordToggleButton.tsx`, also now
    used by the free-form Record/Stop control) always lets the learner stop
    early — one button whose label/action flips between "start" and "●
    Recording… tap to stop," never two separate buttons on screen at once.
  - **Only the final "Record & Compare" take is persisted.** Stages 1-4 are
    ephemeral: an in-memory blob for instant self-playback and an
    `Alternate`-style "compare to native," discarded on Retry/Next/segment
    change. This keeps "Past attempts" from filling up with every rep of a
    2-5s phrase — matches the pedagogical framing ("copy the speaker, not
    just the words," shown as coaching text, not graded per-word).
  - State sequencing lives in `useProgressiveShadowing.ts`, a plain
    `useReducer` (stage index, session id, the current stage's ephemeral
    take) — deliberately *not* a new external-store controller like
    `ShadowingController`, since this is page-local UI orchestration, not
    shared cross-component state. A `resetKey` (sentence id + selected
    segment) drives an automatic restart when the practiced segment changes.
  - `Attempt` gained two optional fields for this: `practiceStage?: 'final'`
    (only ever written by this flow) and `practiceSessionId?: string` (one
    `crypto.randomUUID()` per guided-practice run, to group/filter later) —
    no Dexie version bump needed, same precedent as `notes`/`manualRating`.
  - Known limitation: Delayed/Close Shadow's shadow-mode mechanism always
    plays the *entire* reference clip (a pre-existing constraint of
    `ShadowReferencePlayer`, which has no range-cropping support) even if a
    shorter target range is marked — Listen/Repeat/Compare do respect the
    marked range via `playRange`/segment-duration heuristics, but Delayed/
    Close do not. Not fixed here; would require changing
    `ShadowReferencePlayer`'s carefully-shared-AudioContext internals.

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
- **Reference-audio cross-device pull** (2026-08-29): when "Sync reference
  audio" is on, a `reference_audio` row that arrives from another device (or
  a re-segmentation backfill) now materializes as a blob-less local
  `sentenceAudio` row (`applyRemoteUpsert`, plus a full-table pull in
  `replaceLocalWithCloud`); `hydrateMissingReferenceAudio` (every sync
  cycle) and a play-time fetch in `nativeAudio.ts` download the blobs,
  Wi-Fi-setting-aware. A "Download all reference audio now" button
  (`resyncReferenceAudio`) force-pulls the whole set, bypassing the
  incremental cursor — the recovery path after "Clear audio cache".
- **Book sharing** (`src/sync/sharing.ts`, `BookSharingPanel.tsx`, Postgres
  `book_members` table): invite collaborators to a specific book as
  `editor` or `viewer` via email + accept-token flow — the one multi-user
  feature in an otherwise single-user app.
- **What's synced vs. local-only**: books/sentences/analyses/import
  batches/inbox/reference audio (metadata; blobs stream from Storage, opt-in
  toggle)/study_items/reviews/vocabulary_items/
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

- **Sentence/vocabulary-card real UI differentiation**: `reading_in_context`
  now differs from `comprehension` (it shows the surrounding passage — see
  the activity-type list above). Other same-subject pairs still share an
  interaction, but this specific Phase 4 gap is closed.
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
  Meaning→production) is now substantially closed: the guided/progressive
  practice mode (§6 above, `ProgressiveShadowingPanel.tsx`) sequences
  Listen/Pause&Repeat/Delayed Shadow/Close Shadow/Record&Compare as one
  continuous flow, and "Meaning→production" remains available as the
  free-form "Show meaning instead" toggle. "Independent production" is
  still only implicit (not pressing play first), not a named mode.
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
- **Learning Orchestrator known limitations** (see docs/STATUS_ARCHIVE.md's
  2026-08-20, 2026-08-21, 2026-08-22, and 2026-08-26 entries for full
  detail): no "replace this activity" action; `dailyBudgetMinutes` is
  user-editable on the Settings page (2026-08-22), and
  `sessionAllocation` (the glossing/grammar/shadowing/review split,
  renamed from `modeAllocation`) moved from Settings to a hideable section
  on Home (2026-08-26), but `TOP_UP_INCREMENTS_MINUTES` and the rest of
  `sessionPlannerConfig.ts`'s
  tuning constants (neglect window, review-priority weights, per-item time
  estimates) are still code-only; `PlannerSession` now syncs (2026-08-25),
  so a top-up on a second device continues the same daily session rather
  than starting a separate one — except if both devices start today's
  first session while offline before either syncs, which still creates
  two separate rows for the same date (no dedup-on-create for this
  entity, unlike the `kanji`/`vocabulary_items` get-or-create pattern).
  The old "no 'continue longer'
  extend-in-place action" limitation is now resolved — that's what the
  daily top-up model *is*. Browser automation is usually unavailable in
  this sandbox (Playwright Chromium/WebKit fail to launch on missing
  system libraries, no passwordless sudo to install them) — occasionally
  worked around per-session by pointing `LD_LIBRARY_PATH` at a manually
  pre-extracted lib directory when one happens to already exist, but that's
  not a standing dependency, so most features are still verified only via
  unit/component tests plus code review.

## External services & dependencies

- **Supabase** — Postgres (all synced tables + RLS via `owner_id =
  auth.uid()`), Auth, and Storage (`reference-audio` bucket for opt-in
  native/reference audio cloud sync). Shared with the now-mostly-retired
  `shadowing` repo via table-prefix isolation (`shadowing_*` tables
  coexist, unused going forward). Entirely optional — the app is fully
  functional local-only without it. Also hosts `supabase/functions/
  invite-book-member/`, `supabase/functions/grammar-assist/`, and
  `supabase/functions/vocab-assist/` — Deno Edge Functions, one of two kinds
  of server-side (non-browser, non-Dexie) code in this app (the other is
  `server/youtube-mining/`, below).
- **Anthropic API** (via `supabase/functions/grammar-assist/` and
  `supabase/functions/vocab-assist/`) — the LLM/AI integrations in this
  codebase. Called server-side only, from the Edge Functions, using
  `claude-haiku-4-5` with forced structured tool output (`strict: true`);
  the API key is an Edge Function secret (`ANTHROPIC_API_KEY`), never
  shipped to the browser. Deliberately not routed through
  `shadowing-analysis-api` below — a different kind of workload on an
  already memory-constrained host. Entirely optional and additive: every
  AI-assisted surface (`src/lib/grammarAssist.ts`, `src/lib/vocabAssist.ts`)
  degrades to an inline "unavailable" message / silently leaves a field
  blank if the function isn't deployed, the key isn't configured, or the
  network is unreachable. `grammar-assist` suggests/explains grammar
  patterns; `vocab-assist` glosses vocabulary meanings in sentence context
  (both a just-in-time pass on `VocabularyReviewPage` and a per-word
  "Suggest (AI)" button).
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
- **`server/youtube-mining/`** — unlike everything else in this section,
  this one *is* part of this codebase (Python + FastAPI), not a sibling
  repo — see the "Import from YouTube" feature section above. Deployed
  the same tailnet-only way as `shadowing-analysis-api` (own systemd unit
  + tailscale path, separate process/port), called from
  `src/lib/miningApi.ts`. Given a YouTube URL, downloads audio + subtitles
  (yt-dlp), runs ASR, and clips per-sentence audio (ffmpeg) as the user
  drives the 4-step wizard in `YouTubeMinePage.tsx`. Ported from the
  sibling `shadowmine` CLI below —
  copied, not imported, so this app has no runtime dependency on that
  repo for this feature. YouTube bot-blocks the datacenter host's IP;
  `app/exit_node.py` works around it by routing each download through a
  Tailscale exit node advertised by a personal device on the tailnet
  (`MINING_EXIT_NODE` / `_FALLBACK`), with cookie auth
  (`MINING_YTDLP_COOKIES_FILE`) as the fallback — see the service README.
  The cue text comes from an ASR transcript of the audio
  (`app/asr_client.py` → `shadowing-analysis-api` `POST /transcribe-source`,
  Whisper `small`), not YouTube's punctuation-free Japanese auto-captions;
  captions are the fallback. Every mined source is also kept as a
  compressed Opus (`app/source_cache.py`) so re-cuts come from the
  original. Tokenization (`app/morphology.py`, fugashi/UniDic-lite) emits
  dictionary-form reading + accent directly and overrides a proper-noun
  token's reading from a shipped JMnedict name table
  (`app/name_readings.py`) when UniDic-lite disagrees. A job carries a
  re-runnable `stage` state machine
  (`fetching`→`transcript`→`segment`→`translate`→`ready`) the wizard
  drives: `POST /jobs/{id}/segment` accepts a corrected transcript and
  re-resegments, `POST /jobs/{id}/translate` re-aligns EN,
  `GET /jobs/{id}/audio?startMs&endMs` streams any span of the cached
  source for inline playback, `POST /jobs/{id}/commit` clips every
  reviewed row in one request (audio inline). `POST /source-audio/range`
  is the equivalent span stream for an already-imported book's source
  (the re-segment page's waveform). `_run_job` still auto-advances every
  stage on creation as a fallback.
  Full design + what's-still-open: `docs/mining-pipeline-v2.md`,
  `docs/mining-wizard-spec.md`.
- **WaniKani API** — one-time/re-runnable bulk catalog import
  (`scripts/import-wanikani-kanji.ts`, `npm run import:wanikani-kanji`,
  manual-dispatch `import-wanikani-kanji.yml`) of the full non-hidden
  kanji catalog into Supabase `kanji`: readings/meanings **and**
  meaning/reading mnemonics + hints (`kanji.meaning_mnemonic` etc.), the
  latter refreshed on every re-run. Not a live SRS/progress sync, catalog
  content only. Also `scripts/backfill-wanikani-mnemonics.ts` (`npm run
  backfill:wanikani-mnemonics`, manual-dispatch
  `backfill-wanikani-mnemonics.yml`) which fills
  `vocabulary_items.meaning_mnemonic`/`reading_mnemonic` from WK
  `vocabulary`/`kana_vocabulary` subjects, matched on expression (reading
  as homophone tiebreaker). Vocab subjects have no `*_hint` — hints are
  kanji-only. All of it surfaced only on `ReviewPage`'s "Show mnemonic".
  Everything needs a `WANIKANI_API_TOKEN`. Tofugu's mnemonic content stays
  in the user's private Supabase/IndexedDB, never the repo or public
  build. Both scripts pull raw WaniKani subject payloads through a
  script-only `wanikani_subjects` cache table
  (`scripts/lib/wanikaniCache.ts`) — an incremental `updated_after` pull
  keyed on the newest cached `data_updated_at`, so a re-run (or the usual
  dry-run→`--apply`) fetches only what WaniKani changed. The cache is
  **not** synced to the client; `--skip-wk-sync` reads it with no API call.
- **JMDict** (`jmdict-simplified` release) — downloaded/cached locally
  (`scripts/.cache/`, ~110 MB, gitignored) and used only as a local lookup
  index (`scripts/lib/jmdict.ts`) backing the `npm run jmdict:lookup` CLI
  and several backfill scripts (vocabulary meanings, suggestion glosses);
  never bulk-uploaded wholesale to Supabase.
- **`~/projects/shadowing` (CLI, `shadowmine`)** — a separate Python tool
  (Typer CLI, fugashi/UniDic, yt-dlp, ffmpeg) that mines YouTube/podcast
  sources into `.shadowing.zip` packages. Its own web practice UI was
  already ported into this app (Phase 8); the mining pipeline itself has
  now also been ported (`server/youtube-mining/`, above) — this CLI is no
  longer the primary way to mine a video, but is untouched and still
  works standalone if needed. Its morphology tokenizer (fugashi/UniDic)
  is also invoked directly by `scripts/backfill-vocabulary-suggestions.ts`
  (via a local Python venv or GitHub Actions) to backfill
  `vocabularySuggestions` for CSV-imported sentences, which the CSV import
  path itself never populates — that script still shells out to this
  sibling repo rather than `server/youtube-mining/`'s copy.
- **`~/projects/anki`** (archived on GitHub) — used exactly once,
  historically, via `anki_headless/` (an official-API-based headless
  AnkiWeb sync bridge built in that repo) to pull already-mined `WK Satori
  Immersion`/`WK Shadowing Immersion`/`WK Shadowing Candidate` notes into
  this app's inbox. No ongoing relationship; also the origin of a ported
  verb-pair-detection algorithm (`scripts/lib/verbPairs.ts`) used to seed
  `vocabulary_confusions`.
- **PASQA** — investigated (see Gaps section), not integrated, no live
  dependency.
