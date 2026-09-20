# Roadmap

At-a-glance list. `STATUS.md` is the current-state snapshot,
`STATUS_ARCHIVE.md` the frozen chronological detail (files touched, test
counts, production-run logs), `AI_OVERVIEW.md` the feature-oriented
reference. Each entry here is one or two lines — follow the pointer for the
rest. Update the checkbox and the one-line note when a phase's status
changes.

Original phases match `docs/UNIFIED_APP_ARCHITECTURE.md` §15.

## Done

- [x] **Phase 0 — Repository analysis.** `docs/UNIFIED_APP_ARCHITECTURE.md`.
- [x] **Phase 1 — Unified data model.** Additive Dexie/Postgres tables;
  migration live on Supabase 2026-08-13.
- [x] **Phase 2 — Existing data migration.** WaniKani kanji catalog (2101
  rows) + one-time Anki note import (16 new sentences, 332 vocab items, 500
  links) run against production. JMDict scoped to a local lookup tool
  (`npm run jmdict:lookup`), not bulk-imported — see STATUS.md.
- [x] **Phase 3 — Unified shadowing.** Record/save/compare/rate loop,
  `attempts` table, `ShadowPage`. Live overlay + pitch analysis delivered
  later under Phase 8.
- [x] **Phase 4 — FSRS.** `ts-fsrs` integrated (`src/lib/scheduling.ts`);
  `/review` (global) + `/books/:bookId/review` (scoped) queue. Real
  per-activity-type UI differentiation still deferred (see STATUS.md gaps).
- [~] **Phase 5 — Vocabulary/kanji relationships.** `VocabularyPicker`
  confirm materializes `vocabulary_items`/`sentence_vocabulary`/`kanji`/
  `vocabulary_kanji` (all sync-wired); `/vocabulary` + `/kanji/:character`
  browsing. Part 2 (JMDict meaning backfill + retroactive materialization)
  run against production 2026-08-15. **Still unverified**: the interactive
  confirm-vocabulary flow itself (`AnalyzePage.tsx`/`VocabularyReviewPage`)
  — see STATUS.md.
- [x] **Phase 6 — Anki interoperability cleanup.** Verified no further
  content needed; `efancher/anki` archived. No export-back planned.
- [x] **Phase 7 — Adaptive learning.** All slices 7.1–7.11 done and
  verified against production (evidence model, reading retrieval, contextual
  cloze, audio comprehension, mnemonic gating, interference detection,
  contrastive pairs, natural-encounter evidence, production ladder, session
  planner/graduation/explainability, full-sentence review gating). Slice
  detail in STATUS_ARCHIVE.md.
- [x] **Phase 8 — Shadowing feature parity + practice-target isolation.**
  8.1–8.5 done, browser-verified (playback speed, loop-point marking, mic
  calibration + shadow-mode recording + live waveform, pitch/waveform
  comparison analysis, polish). Detail in STATUS_ARCHIVE.md.
- [x] **Phase 9 — Shadowing pronunciation/prosody feedback.** All 9
  milestones (mora segmentation, forced-alignment service, phone/pitch
  timing feedback, ranked "fix one thing" + one-tap practice, ASR secondary
  signal, pronunciation history, ground-truth pitch-accent scoring; the
  standalone 5-stage guided/progressive practice panel was folded away
  2026-09-09 — `ShadowPage` now leads with the hands-free close-shadow loop
  above the free-form record-and-analyze controls) plus the **cross-sentence learner
  profile** (2026-08-31, brief's Phase 15) — `pronunciationProfile.ts` +
  `/pronunciation`, a ranked recurring-focus-area view + timing/pitch trend
  aggregated across every analyzed attempt. Detail in STATUS.md /
  STATUS_ARCHIVE.md.
- [x] **Learning Orchestrator.** "What should I do?" planner — four learning
  modes, neglect-aware allocation, review-priority scoring, `HomePage`
  dashboard, `SessionRunnerPage`. Reworked to one growing **daily** session;
  vocabulary confirmations get first claim on the glossing bucket. Detail
  in STATUS.md's 2026-08-20 / 2026-08-21 / 2026-08-29 entries.
- [x] **Re-segment an existing shadowing source.** `ResegmentSourcePage`,
  `/books/:bookId/resegment` — rebuild a source's sentences on real
  boundaries for pre-`resegment.py` imports; carries study progress + audio
  across. Run against "After Work" 2026-08-29. Detail in STATUS.md.
- [x] **Vocabulary meaning glossing.** POS-aware JMDict + JMnedict matcher
  for offline backfill scripts, plus a runtime `vocab-assist` Claude Haiku
  Edge Function that glosses in sentence context. Detail in STATUS.md's
  2026-08-28 entry.
- [x] **WaniKani mnemonics on review cards.** ~~Vocab + kanji mnemonic/hint
  slices + a script-only `wanikani_subjects` Supabase cache + deferral
  fall-through. Deployed 2026-08-29/30/31 (303 vocab, 2101 kanji).~~
  **Removed 2026-09-02** — learning-in-context replaced it; feature,
  importers, cache table, and columns all gone. Detail in STATUS.md.
- [x] **Contextual conjugation cards.** `sentence_transformation` reworked
  to one card per word-in-sentence occurrence, quizzing the form that
  sentence actually used. Migration `20260901000000_...` live 2026-08-30.
  Not yet browser-verified.
- [x] **Progressive listening (two-tier ladder).** `word_listening`
  activity type (one card per surface-form occurrence) gated behind reading
  proficiency; full-sentence `listening` gated behind every `word_listening`
  occurrence. Done 2026-08-30. Reworked 2026-09-02 from an isolated-word
  loop into an audio cloze (whole clip → sentence with target blanked +
  translation → answer; isolated loop demoted to optional scaffolding) —
  the isolated card was an unfair vacuum test for short function words and
  degraded badly when forced alignment couldn't isolate the word. Not yet
  browser-verified.
- [x] **Grammar-learning system.** Phases 1–9-Contrast-slice: schema/
  repository/sync foundation, manual annotation from Analyze, `/grammar`
  browser + personalized curriculum dashboard, AI-assisted suggestion/
  explanation, `grammar_comprehension`/`grammar_completion`/
  `grammar_contrast` review cards, derived learner-state ladder,
  `GrammarRelationship` browsing/creation, plus a `grammar_production` card
  (2026-09-01, the output rung — see below). Prediction/transformation
  activity types deliberately not started.
- [x] **Review new-card backlog fix.** (2026-08-31) The session planner
  counts confirmed-but-never-introduced vocabulary
  (`countNewVocabularyCardBacklog`), reserves `min(backlog, session limit)`
  retain-costed minutes in the review bucket, folds that slice into the
  review step's `targetCount`/label, and `ReviewPage` holds the review step
  open through seeding. Backlog still drains at `newCardsPerSessionLimit`
  (default 20) per daily session by design. Detail in STATUS.md.
- [x] **Cross-sentence shadowing learner profile.** (2026-08-31)
  `src/lib/pronunciationProfile.ts` + `PronunciationProfilePage`
  (`/pronunciation`) — ranked recurring focus areas (which
  `primaryIssueKind` leads most often, over how many sentences, with an
  improving/worsening/steady trend) + overall timing/pitch trend,
  aggregated across every analyzed attempt. Closes Phase 9's last
  milestone. Future extension: finer-grained per-word accent-class stats
  need more persisted in `AttemptAnalysisSummary` than v1 stores.
- [x] **Grammar production ladder.** (2026-09-01) `grammar_production`
  review card — produce a sentence using a recognized pattern, reveal a
  model to self-rate against; gated on `grammar_comprehension` FSRS
  proficiency. Weak `grammarPatternUsedIn` hint; self-rated. No
  `GrammarLearnerState` `productive` rung yet. Detail in STATUS.md.
- [x] **`comprehension` vs `reading_in_context` differentiation.** (2026-09-01)
  `reading_in_context` now frames the sentence under test with its
  reading-order neighbours (`src/lib/readingContext.ts` +
  `ReadingInContextCard`): preceding sentences shown untranslated above it,
  the following sentence's translation folded into the reveal, a "In
  context · <book>" caption. Home book = the sentence's most recently
  opened book. Degrades to the isolated layout when no context is
  available. Closes the Phase 4 gap.
  **Superseded 2026-09-08:** the isolated `comprehension` card was retired
  entirely (user: "always better to learn in context if possible") —
  `reading_in_context` is the only sentence-subject card now, existing
  `comprehension` items migrated to it
  (`scripts/migrate-comprehension-to-reading-in-context.ts`). Detail in
  STATUS.md.
- [x] **Audio-less pitch-accent production drill.** (2026-09-01)
  `PitchAccentDrillPage` (`/pitch-accent`, Home shortcut) +
  `getPitchAccentDrillSentences` — a non-SRS practice loop over Satori
  sentences with confirmed pitch-accent-bearing vocabulary, no reference
  recording, and words already reviewed to proficiency (same
  `getSentenceFullReviewReadiness` gate as shadowing candidates). Record
  the sentence; `buildPitchAccentShapeObservations` scores each target
  word's realized contour against the dictionary shape using only the
  learner's own forced alignment + pitch. Nothing saved or scheduled.
  **2026-09-06:** briefly opened each sentence on a "predict-the-drop"
  perceptual step. **2026-09-07:** that step was removed (user request) —
  the drill is now purely "say it and get the pitch checked". Added a
  **Single words** mode alongside Full sentence: one proficient,
  pitch-carrying word at a time (`getPitchAccentDrillWords`, *not* gated on
  the example sentence lacking audio, so a much larger pool), record just
  the word (+ any trailing bunsetsu particle — it carries the phrase-final
  fall), same dictionary-shape check. Quiet mode no longer touches this
  page. Also 2026-09-07: the scorer itself now measures that following
  particle (`expectedPitchShape`'s 3rd arg + `classifyLearnerMorae`), so
  odaka vs heiban is finally graded, not collapsed — both in the drill and
  in `AnalysisPanel` shadowing feedback. **2026-09-11:** every take is now
  logged (`PitchDrillAttempt`) — see the usage-tracking entry below; the
  drill itself is still ungated, nothing here blocks or reorders practice.
- [x] **Retention / progress-over-time view.** (2026-09-01)
  `src/lib/progressReport.ts` (`buildProgressReport`, pure) +
  `ProgressPage` (`/progress`, in the nav + Home shortcut row): vocabulary
  ladder counts (tracked / proficient / mature / first-recalled-recently),
  FSRS recall-success rate (30d + all-time, natural encounters excluded),
  grammar tracked/recognized, shadowing attempt count + timing/pitch trend
  (reuses `getPronunciationProfile`), and an 8-week reviews-per-week +
  cumulative-words-learned trend rendered with the existing `.progress-bar`
  meter (no charting dep). All recomputed from `Review`/`StudyItem`/
  analysis-summary evidence — nothing seeded or stored.
- [x] **Native-clip measured pitch overlay.** (2026-09-03) The *measured*
  YIN pitch track of the **reference** recording, drawn under the sentence on
  the `listening` / `word_listening` review reveals and the shadowing
  surfaces (`MeasuredPitchContour` + `SyncedShadowText`) — not a predicted
  contour, complementing the per-word dictionary H/L marks. Persisted
  per-clip in the new local-only `referencePitchTracks` Dexie cache (DB v16)
  via `src/lib/referencePitchCache.ts`; `AnalysisPanel` warms it. Detail in
  STATUS.md.
- [x] **Quiet mode.** (2026-09-06) `settings.quietMode` (per-device, toggle
  on Settings + Home) pauses every speak-aloud activity: the session planner
  withholds all `shadowCandidates` (minutes flow to the other buckets,
  nothing consumed) and `/shadow` shows a non-blocking banner. For noisy
  environments / working somewhere you can't talk. Detail in STATUS.md.
  (2026-09-07: no longer affects the pitch-accent drill.)
- [x] **Analytics pass 1: blind spots, error mix, shadowing→SRS bridge.**
  (2026-09-08) Two new `/progress` panels + the first link between the
  shadowing world and the SRS world:
  - **Blind spots** (`src/lib/blindSpots.ts`, `getBlindSpots`) — vocabulary
    (tokenizer + Satori suggestions) and grammar (`worth_learning_now`
    bucket) that recur across books the learner has worked but were never
    confirmed / tracked.
  - **What to work on** (`src/lib/errorMix.ts`, `getErrorMix`) — aggregates
    `Review.errorClassification` into a ranked breakdown with a next-action
    per category + a 30/90/all window toggle, plus a pronunciation block
    from the shadowing side.
  - **Shadowing → SRS bridge** — a `better`/`same` A/B rating on a shadow
    attempt logs one `natural_encounter` review against the sentence's
    existing `reading_in_context` card (`recordShadowingEncounter`, no-op if
    the card doesn't exist, deduped per cycle); per-word pitch-accent
    mismatches persist on `AttemptAnalysisSummary.wordIssues` and feed a
    read-only "weak words" signal (`buildShadowingWeakWords`) named in the
    error-mix pronunciation block. Detail in STATUS.md.
- [x] **Word-audio isolation stops depending on the tailnet at review time.**
  (2026-09-10) From "why aren't `pitch_accent` cards showing word-level
  playback" (`で、なんか結構怖がってたりもしてね、最近は`). Three parts:
  - `isolatedWordRange` bails to whole-sentence when an `<unk>` (OOV
    contraction) precedes the target — the proportional char→time map is
    unreliable past a token whose characters left the basis but whose
    airtime didn't.
  - `SegmentLoopPlayer`'s "Adjust" editor is reachable even when forced
    alignment produced no span, seeded with a duration-proportional guess;
    never looped or persisted until the learner commits a drag.
  - **Alignment is now stored + shared.** `loadOrComputeAlignment` resolves
    in three tiers — local Dexie cache → the owner-scoped
    `reference_alignment` Supabase table (`src/sync/alignmentRemote.ts`,
    direct query, *not* the sync-event engine — same treatment as the
    reference-audio blobs) → the tailnet MFA service. A fresh service result
    is pushed to the table opportunistically;
    `scripts/backfill-reference-alignment.ts` (run on codex-dev, localhost
    aligner) covers the existing corpus. Migration
    `20260910000000_reference_alignment.sql`. Off-tailnet clients now get
    word spans for anything aligned once elsewhere. Detail in STATUS.md;
    §18 exception noted in ARCHITECTURE.md.
- [x] **Pitch-accent misses carry a corrective "Try this:" hint.**
  (2026-09-10) `pitchAccentCorrections.ts` classifies the H/L divergence
  (first-mora-high, held-high, early-drop, no-downstep, final-fall,
  particle-fall, flat) and returns a practice cue, several naming the
  English-transfer cause. The scorer also now flags a correct drop with
  the wrong shape around it (medium/low confidence, measured morae only).
  Detail in STATUS.md.
- [x] **Suspend a too-hard book.** (2026-09-11) New `Book.suspendedAt`,
  distinct from `archived`: shelves a book that's currently too hard — out of
  session-planner rotation *and* its exclusive review cards held back from the
  global queue (only when every book a word/sentence belongs to is suspended —
  `src/lib/suspendedBooks.ts`). Resume spreads now-overdue held-back cards over
  the next week. `BookDetailPage` "Suspend studying" / "Resume studying" toggle;
  "Resume" jump button renamed "Continue". Detail in STATUS.md.
- [x] **Pitch-accent drill usage tracking + SRS-miss-triggered extra
  practice + H/L shape tracking.** (2026-09-11) User asked whether the free
  drill is actually helping their pitch perception — three additive pieces,
  none of them touch the `pitch_accent` SRS card's FSRS scheduling:
  1. **Usage log** — `PitchDrillAttempt` (new table, `logPitchDrillAttempt`),
     one row per scored target word per take on `PitchAccentDrillPage`
     (both modes): `measured`/`mismatch`/`confidence`, plus the dictionary
     vs. measured H/L shape strings (`expectedShape`/`measuredShape`).
  2. **"Missed in review" focus queue** — `getPitchAccentFocusWords`: a word
     whose `pitch_accent` card's last 2 reviews were both `again`/`hard`
     surfaces in a new banner on `PitchAccentDrillPage`; "Start extra
     practice" walks just that list in single-word mode. Clears the moment
     any drill attempt is logged for the word (any outcome — it's practice,
     not a retest), reappears on a fresh 2-miss streak. Implements the
     "Shadowing weak words → pitch-accent drill" idea's sibling for SRS
     misses, and a pitch-specific slice of "Cross-activity error routing"
     below.
  3. **H/L shape tracking on the SRS card too** — `Review` gained
     `pitchExpectedShape`/`pitchChosenShape` (both `'h'/'l'` strings from
     `expectedPitchShape`), populated on `pitch_accent` card grading.
  4. **Query path** — `scripts/report-pitch-drill-effectiveness.ts`: drill
     usage over time, weekly `pitch_accent` pass-rate, drill-volume-vs-
     pass-rate, and the most common H/L shape confusions across both the
     drill and the SRS card. Point-and-run, no export/import. Migration
     `20260911010000_pitch_drill_attempts.sql` to apply. Detail in
     STATUS.md.
- [x] **Grammar SRS: 4-card ladder collapsed to one context-rich
  `grammar_completion` card.** (2026-09-15) Resolves the 2026-09-09 open
  question. A performance check (`scripts/report-grammar-card-performance.ts`)
  found the ladder essentially never fired — of 74 tracked patterns only 2
  had ever produced a study item — because `pickContextSentenceForGrammarPattern`
  gated every card on the same strict "vocab already proficient" rule
  `reading_in_context` uses. First attempt collapsed all four types into
  an ambient "noticing" strip shown under every review card; tried in real
  use, that "makes the review cards clunky and doesn't help with learning"
  (user) — reverted. Second attempt, kept:
  - **One surviving card, `grammar_completion`** — `grammar_comprehension`/
    `grammar_contrast`/`grammar_production` retired outright, not rebuilt.
  - **Gated the same as vocabulary** — `pickContextSentenceForGrammarPattern`
    dropped its full-sentence-readiness requirement entirely, mirroring
    `pickContextSentenceForVocabularyItem` (just needs a linked sentence,
    nothing about the rest of that sentence's vocabulary).
  - **Translation shown up front, not behind reveal** — it's the input
    signal for picking the right construct, the same idea as giving the
    audio in a pitch-accent card and asking for the shape.
  - **Passage context** — the target sentence is framed by its
    reading-order neighbours, same convention `reading_in_context` uses
    (`ReadingContext` from `src/lib/readingContext.ts`), resolved via a
    new bounded per-sentence query (`getReadingContextForSentence` in
    repository.ts) rather than the shared scope-wide context map, since
    grammar patterns are global-scope and can reference a sentence from
    any book.
  - Learner-state ladder simplified back to 3 rungs (encountered/noticed/
    recognized) — `recognized` now reads FSRS proficiency off
    `grammar_completion` instead of the retired `grammar_comprehension`.
  - `scripts/retire-non-completion-grammar-items.ts` soft-deleted the 3
    non-`grammar_completion` items across the 2 tracked patterns; both
    patterns' `grammar_completion` items kept their FSRS state untouched.
    Detail in STATUS.md.
- [x] **`grammar_completion`: multiple choice → typed recall.** (2026-09-17,
  card issue triage — "not sure if the way this card type is setup is
  helpful, it's just kind of a search and find.") With the translation
  always visible, multiple choice let a learner eliminate options by
  grammatical shape alone without ever recalling the construct from its
  meaning — user's own framing: "what should the card be teaching me to
  retain?" Replaced with a typed answer (same shape as
  SentenceConjugationCard/ReadingProductionCard), graded via the new
  `isGrammarPatternAnswerCorrect` (`src/lib/grammarPatterns.ts` —
  tilde/annotation/whitespace-insensitive, reusing
  `normalizeGrammarPatternKey`). `buildGrammarCompletionChoices`/
  `GRAMMAR_COMPLETION_CHOICE_COUNT` and the `GrammarRelationship`-ranked-
  distractor logic are deleted, not just unused — see git history if the
  discrimination-card idea below wants them back. Also removes the old
  "fewer than 2 choices" degenerate case: every tracked pattern gets the
  same card now, even a lone one with nothing to contrast against.
- [x] **Real-audio pitch-perception bridge.** Follow-on to the
  pitch-accent drill and the synthetic `pitch-ear-trainer` /
  `relative-pitch-trainer`. Prompted by the 2026-09-06 ChatGPT pitch-ear
  discussion: the learner passes synthetic-tone discrimination but still
  misses lexical accent in real speech, so the gap is the Japanese-specific
  layer (mora timing, voicing cues, per-speaker normalization, phrase-level
  downstep), which only *real* audio trains. Two exercises, both built from
  the existing native-clip corpus (`SentenceAudio` + per-word alignment +
  dictionary `pitchAccentPositions`), staged as an optional warm-up **inside
  the drill**, not a standalone module (keeps the "skill over metalabel
  quiz" principle):
  - [x] **Word-alone vs. word-in-phrase.** (2026-09-14) Play the isolated
    word span, then the word + following particle span, ask "did the drop
    land before the particle?" The odaka-vs-heiban bridge, which no
    isolated view can teach. Shipped as `PitchWordPhraseWarmup` inside the
    `pitch_accent` SRS card, gated to heiban/odaka candidates where forced
    alignment locates both spans; ungraded, local state only. Detail in
    STATUS.md.
  - [x] **Same/different + ABX on near-minimal pairs.** (2026-09-18) Shipped
    as `PitchAccentMinimalPairWarmup` on `PitchAccentDrillPage` —
    same-reading, different-accent-position word pairs (true homophones,
    e.g. 箸/橋) played from real clips via `isolatedWordRange`, guessed
    before reveal. Up to 5 trials, same-book (same-speaker proxy) first
    then cross-book if available — no per-clip speaker identity exists in
    this corpus, so `Book.id` stands in for it (see STATUS.md's 2026-09-18
    entry for the caveat). Corpus currently thin (two "Nihongo con Teppei
    (Beginners)" episodes mined in as a known single-narrator source, after
    confirming NHK Easy publishes no narrator metadata to check by) — pool
    grows as more single-speaker content is mined.
  - **Not** an F0-resynthesis pipeline (ChatGPT's centre-piece): real
    near-minimal pairs from the corpus get most of the perceptual benefit
    without a PSOLA/WORLD service on the memory-constrained analysis host
    (same footprint constraint that parked PASQA).

## In progress

- [ ] **Mining pipeline v2.** Staged, re-runnable YouTube mining
  (transcript → segment → translate → commit, audio at every stage) fixing
  the auto-caption-as-source-of-truth quality issue. Slices A (ASR
  transcript), B (full UniDic form/reading/accent + JMnedict proper-noun
  check), C (retained source audio), and the wizard W1–W6 + deferred-polish
  pass **all landed 2026-08-31**. Full design in
  `docs/mining-pipeline-v2.md` / `docs/mining-wizard-spec.md`.
  - Still deferred: a `source_audio` Supabase table + Storage mirror for
    cache durability (blocked on a Supabase-creds decision for the Python
    service; recommendation on file is box-level backups of the cache dir
    instead).

## Planned

Detail/rationale in `docs/STATUS.md`'s "Open / deferred" section and the
note below. Six items from the earlier list shipped 2026-08-31/09-01 — see
**Review new-card backlog fix**, **Cross-sentence learner profile**,
**Grammar production ladder**, **Audio-less pitch-accent production drill**,
**`comprehension` vs `reading_in_context` differentiation**, and
**Retention / progress-over-time view** under Done above.

- [x] **Deterministic ids for get-or-create sync entities + real-Postgres sync tests.**
  (2026-09-20, shipped) `kanji`, `vocabulary_items`, `grammar_patterns`,
  `sentence_grammar`, `grammar_relationships` and `vocabulary_kanji` ids are now derived
  from owner + natural key (`deterministicId`, `mintGetOrCreateId`), so two devices minting
  the same word make the same row. Signed-out devices and existing rows keep their ids;
  the adopt/remap machinery stays for those. `npm run test:pg` runs the push path against
  the real migrations + RLS (Docker). Follow-ups if wanted: `study_items` (FSRS state;
  natural-key duplicates still rely on the unique index) and `sentence_vocabulary` ids
  are still random; run `test:pg` in the Deploy gate if the ~1 GB image pull becomes
  acceptable (it has its own non-gating workflow today).

- [ ] **Short games (`/play`).** (2026-09-19; **P1 shipped 2026-09-19** —
  see the Phases bullet) A few 60–180 s, non-arcade
  rounds that break up study while still training a skill, and — longer
  term — can be aimed at weaknesses or strengths. Came out of four
  parallel read-only design passes (audio / vocab / grammar / framework
  lenses); nothing built yet. Design rules the passes converged on:
  - Each game is its **own short activity** on a `/play` hub + Home chip —
    not an ambient strip on existing cards (that pattern was reverted
    2026-09-15, see the grammar-SRS entry). Tap-only UI (no drag, no
    `prompt`/`confirm`); any audio starts from a tap, never a timer (iOS).
  - **Games do not write FSRS in v1.** They're cued (hints, choices,
    pacing), so grading them would inflate the proficiency signals that
    gate `continue_book`/shadowing/listening (`getProficientVocabularyItemIds`).
    Results go to a **local-only append-only `game_rounds` log** modelled
    on `pitch_drill_attempts` (no Supabase migration at first — the
    migration-apply gap has bitten before; add sync once the games prove
    useful, and confirm the migration is applied to prod first). Any
    FSRS-adjacent write is opt-in and user-explicit (e.g. a result-screen
    "Queue misses for review" toggle that only seeds cards, never grades).
  - **Shared item picker** (`src/lib/gamePicker.ts`, pure):
    `pickItems({signal: weak|strong|stale|new|frontier, game, n, seed})`.
    Signals reuse `getLeechList`, `scoreReviewPriority`,
    `predictRetrievability`, `countNewVocabularyCardBacklog`,
    `bookCoverage.ts`. Every game ships an `eligible()` that runs
    **before** ranking; a too-thin pool hides the game/signal with a
    reason and falls back (weak → stale → any) rather than an empty round
    (the per-item-gate starvation lesson, 2026-09-16).
  - **GameShell** (`src/components/games/GameShell.tsx` + registry
    `src/games/registry.ts`): intro (signal chip + "why these items", the
    Start tap does the gesture-gated audio setup) → play (item-count-capped,
    a pace bar with no fail state) → result (per-item replay + one-line
    why, strength/weakness tag).
  - **Session integration is later and optional:** a `game`
    `PlannerStepTargetKind` (`types.ts`) with a query-free path
    (`/play/:gameId/:signal`, since `useActiveSession` matches by exact
    pathname), **no** fifth `SessionBucket` (it's a `Record` across
    allocation/settings/recap/Home), settled only via the SessionBar's
    "Mark complete". `game_*` activity types stay out of `recentActivity`
    neglect scoring; `stepUsefulness` gives skip-rate for free as the kill
    switch.
  - **Feasibility (prod, 2026-09-19, `scripts/report-game-feasibility.ts`,
    read-only):** *Word Detective* — 490 confirmed words, 194 with 2+
    sentences (121 with 2+ audio sentences); 41 lapsed, only 25 of them
    with 2+ sentences (thin weakness pool); 127 no-card backlog words have
    2+ sentences. *Odd Ear Out* — 209 pitch-carrying citation-form words,
    113 with aligned audio and 2+ morae; a 3+1 round is possible at 2/3/4/5
    morae (upper bound, proficiency **not** filtered). *Particle Puzzle* —
    994 of 1269 sentences have 2+ particle tokens (800 with 3+); all
    tokens are UniDic `morphology` source, so imports are not token-poor.
  - **Candidates (ranked by the design passes):**
    1. **Word Detective** (vocab, M) — a mystery word from your books,
       typed reading, clue ladder (blanked sentence → 2nd sentence →
       translation → audio → first kana), fewer clues = higher score.
       Weakness signal: leeches / lowest retrievability. Overlaps `cloze`
       and `reading_production`; the multi-context clue ladder is the
       differentiator.
    2. ~~**Odd Ear Out**~~ **[shipped 2026-09-19; playable after the 2026-09-19 `backfill:reference-alignment` refresh — see STATUS]** (pitch, M) — 4 native clips of same-length words,
       tap the odd accent shape, reveal the measured contours
       (`MeasuredPitchContour`). Reuses
       `getPitchAccentMinimalPairOccurrences` / `expectedPitchShape`; keep
       the heiban-vs-odaka exclusion. `Book.id` as speaker proxy.
    3. ~~**Verb Lego**~~ **[shipped 2026-09-19 — hybrid: real sentence chains + composed "monster" forms; follow-ups: 〜たくなかった / 〜でした pieces, a reverse "which piece is the passive?" mode]** (grammar, M) — stack suffix blocks to build stacked
       verb forms (食べさせられなかった); fills the gap the conjugation
       card skips (`identifyConjugationForm` ignores stacked surfaces).
       Needs an aux-lemma → label table; UniDic is inconsistent on
       causative/passive stems.
    4. ~~**Particle Puzzle**~~ **[shipped 2026-09-19]** (grammar, S–M) — fill 3–4 particle blanks from
       one shared chip bank (+1–2 decoys), translation hidden until check,
       accept curated equivalents (に/へ). Cheapest; per-particle-pair
       miss rate is the weakness signal.
    5. Later: **Keystone** ("which 5 words unlock the most of the next
       chapter" — front door to the no-card backlog), **Ear Tiles**
       (rebuild a heard sentence from chunk tiles), **Then & Now** (replay
       an old clip with then-unknown words ducked out — needs per-word
       alignment spans), **Draft Day** (choose which backlog words to
       adopt), **Pair Sort** (only if the error mix shows discrimination
       errors; unlocked by the discrimination-card item below).
    Skipped as overlapping an existing card or a sibling game: Connections,
    Furigana Fog (≈ `reading_in_context`), Gremlin Hunt (≈ Verb Lego),
    Ghost Run (largest build, most likely to feel like work).
  - **Phases:** **P1 — DONE 2026-09-19** (`GameShell`, `src/lib/gamePicker.ts`,
    `/play` hub + Home shortcut, local `gameRounds` log, **Word Detective**; see
    STATUS.md). **Particle Puzzle also shipped 2026-09-19** (candidate #4 below;
    142 confirmed playable sentences in prod after its conservative blanking
    rules, ~28 distinct rounds). Original scope: GameShell + picker (weak/stale/strong from existing
    data) + one game + `/play` + Home chip + local `game_rounds`, no sync,
    no session step. **P2** optional session interlude + recap line
    (`sessionRecap.ts`). **P3** `/progress` "Games" panel (accuracy by
    skill/signal, weak-item recovery rate, a "cued vs FSRS" check in the
    style of `selfRatingCalibration`) + adaptive difficulty from the last 3
    rounds. **P4** sync `game_rounds`; add "Queue misses". **P5** Keystone,
    then Then & Now. **P6** let game misses feed the planner's weakness
    term (riskiest, last).
  - **Decisions taken for P1 (2026-09-19, the recommended defaults):** games are
    strictly read-only w.r.t. FSRS (no "Queue misses" yet); standalone `/play`
    only, no session interlude; local-only data; no streak. Still open: whether
    game time should displace review minutes or be extra (only matters at P2).
    Original questions: (1) strictly read-only vs. opt-in "Queue misses";
    (2) standalone `/play` only vs. also a session interlude; (3) is a
    rolling "rounds this week" count enough, or any streak; (4) should
    game time displace review minutes or be extra; (5) local-only data
    acceptable at first (phone/desktop histories diverge until sync).
  - Manual test plan for P1: open `/play`, run a weak round, confirm the
    "why" line matches the leech list; confirm no `reviews`/`study_items`
    rows changed; confirm a too-small pool hides the game with a reason.

- [ ] **Grammar pattern discrimination card.** (2026-09-17, follow-up to
  the `grammar_completion` recall redesign above) A second retention target
  distinct from recall: not "can you produce this construction" but "can
  you tell it apart from the pattern you actually confuse it with" (e.g.
  〜わけがない vs 〜はずがない). `GrammarRelationship` (`commonly_confused` in
  particular) already models exactly this link, and the deleted
  `buildGrammarCompletionChoices`'s relationship-ranking logic is the
  natural starting point if this gets built — surface the two confusable
  sentences/translations side by side (or one sentence, "which of these two
  fits") rather than reviving free-form multiple choice. Unscheduled —
  try recall alone first and see whether discrimination errors still show
  up in the error-mix view before building a dedicated card for them.
- [ ] **Podcast mining.** (2026-09-13) Extend the existing YouTube-mining
  pipeline to podcast episodes rather than building a new one — the backend
  is already more source-agnostic than it looks: `POST /jobs` takes a raw
  URL with no YouTube-only gate, `youtube.fetch_audio`/`download_subtitles`
  (`server/youtube-mining/app/youtube.py`) are plain `yt-dlp` calls that
  already handle direct audio URLs and many non-YouTube hosts, and the
  no-captions **ASR fallback already built** for undercaptioned YouTube
  videos covers "podcast has no JA subtitle track" for free. Plan:
  1. ~~**Smoke-test first**~~ **Done 2026-09-13.** (Correction: this dev
     session turned out to be running directly on `codex-dev`, the same box
     the `youtube-mining-api` systemd service runs on — not a separate
     sandbox, per the unit file's `WorkingDirectory` pointing at this exact
     checkout.) Called `youtube.fetch_audio`/`inspect_url`/
     `download_subtitles` directly against a real live episode (Nihongo con
     Teppei #1581, a plain `media.blubrry.com` mp3 URL pulled from the
     show's real RSS feed). Download succeeded (7.4MB m4a, no exit-node/
     bot-blocking issue — that's YouTube-specific), and `download_subtitles`
     correctly found nothing, confirming the ASR fallback path would engage.
     Found `inspect_url`'s generic extractor has no page metadata for a bare
     mp3 URL (title comes back as the filename, duration as `None`) —
     motivated steps 2/4 below.
  2. ~~**RSS episode picker**~~ **Done 2026-09-13**, backend + UI + wiring,
     all verified live against the real production service (not just unit
     tests): `app/podcasts.py` (`parse_podcast_feed`/`fetch_podcast_feed`) +
     `POST /podcast-feed`; `fetchPodcastFeed` in `src/lib/miningApi.ts`; a
     collapsible "Or import a podcast episode" section on
     `YouTubeMinePage.tsx`'s idle screen (feed URL → episode list, capped at
     the latest 30 — some feeds run 1000+ episodes — → tap one to mine it).
     Restarted `youtube-mining-api.service` (checked `GET /jobs` was empty
     first, so nothing in flight got dropped) and ran a real episode through
     the live service end to end: downloaded, correctly found no captions,
     fell back to ASR, and produced 107 real sentence cues from actual
     speech (~5 min wall-clock for a 5:32 episode on this box — real
     evidence for step 3 below). Test job deleted after verifying. One
     real-world finding: Nihongo con Teppei's feed has no `<itunes:duration>`
     tags at all, so durations show blank for every episode there — the UI
     already treats the field as optional, not assumed present.
  3. **Long-episode ASR headroom** — `ASR_TIMEOUT_SECONDS` (1800s default)
     and the 8GB analysis box's memory ceiling (the same host the MFA
     aligner leaks memory on, per its weekly restart timer) may need a bump
     or chunked transcription past ~30 min; the recommended intermediate
     shows (Nihongo con Teppei, Miku Real Japanese, Sakura Tips) run
     10–20 min/episode, so this likely doesn't block v1. Real data point
     2026-09-13: a 5:32 episode took ~5 minutes wall-clock end to end
     (download + ASR) on this box — comfortably under the timeout, but not
     fast; a 20-min episode could plausibly approach it.
  3b. **Found + fixed while dogfooding this feature, not really podcast-
     specific**: "Auto-fill translations (AI)" silently shifted every
     translation down by one row on a real 162-sentence episode — the
     `sentence-realign` Edge Function dropped blank/whitespace rows from its
     reply array instead of preserving position, and separately its
     `MAX_GROUPS = 60` cap silently truncated anything past the first 60
     rows with no client-visible signal. Both are latent bugs in shared
     mining-wizard translate infrastructure that a long YouTube video could
     trip too — podcast mining just has a much higher rate of >60-row
     sources. Full writeup + fix in `docs/STATUS.md`'s 2026-09-13 entry.
     **Needs `supabase functions deploy sentence-realign` run by someone
     with Supabase CLI credentials before it's live** — not deployable from
     this session.
  4. ~~**Dedup/labeling polish**~~ **Partly done 2026-09-13** — the title
     half. `SourceInfo.type` widened to `Literal["youtube", "podcast"]`;
     `CreateJobRequest` gained `title`/`sourceType`, threaded through
     `create_job` → `Job.title_override`/`source_type` (checkpointed, so it
     survives a process restart mid-job) → applied onto `SourceInfo` once
     `info_to_source()` builds it. Verified live: the created book's title
     is the real RSS episode title, not yt-dlp's filename-derived one.
     Still open: `alreadyMined`'s "already imported" video-id matching
     (`src/lib/youtubeUrl.ts`) still only recognizes YouTube URLs — a
     re-mined podcast episode won't get the warning banner. Low priority,
     cosmetic only.
  5. ~~**Difficulty screening checkpoint**~~ **Done 2026-09-13** — see
     "Difficulty screening checkpoint" under Planned below (promoted out of
     this list since it ended up applying just as much to NHK Easy import
     as to podcast mining).
  - **Finding a show's RSS URL:** `https://itunes.apple.com/search?term=
    <show name>&media=podcast` returns a `feedUrl` field directly — verified
    2026-09-13 against Nihongo con Teppei
    (`feedUrl: http://nihongoconteppei.com/feed/podcast`, confirmed live).
    Most indie-hosted shows also link "RSS" directly on their own site.
    Spotify-exclusive shows generally have no public feed and won't work.

- [x] **NHK News Web Easy import.** (2026-09-13, plan corrected same day
  after verifying against the live sites — see below) Native narrated audio
  + furigana-graded text is a stronger comprehensible-input fit than YouTube
  auto-captions, and the text being already-correct makes the pipeline
  *simpler* in one way: forced-alignment instead of transcription.
  1. ~~**Scraper module** (direct NHK scrape)~~ **Abandoned 2026-09-13,
     verified live, not guessed:** `https://www3.nhk.or.jp/news/easy/`
     redirects to a rebuilt `news.web.nhk` Next.js SPA (part of the new
     "NHK ONE" platform) — the listing/article content isn't in the initial
     HTML at all, and its `api.web.nhk` backend 403s on a plain
     unauthenticated request. The OSS reference scrapers this plan
     originally cited (`nhk-easy-api`, `nhkeasy`) target the old static-HTML
     site and no longer apply. Direct NHK scraping is not practical right
     now.
  2. ~~**Sentence splitting off clean punctuation**~~ **Done differently,
     2026-09-13** — see below; turned out to need one real fix.
  - **Found instead, verified live:** https://nhkeasier.com — an existing
    third-party site that already republishes NHK Easy articles for
    learners specifically, as a **standard RSS feed**
    (`https://nhkeasier.com/feed/`, confirmed live, 50 items). Each item is
    exactly the same "podcast" shape `podcasts.py` (above) already parses —
    title, `pubDate`, and an `<enclosure>` pointing at the real NHK
    narration audio (hosted on nhkeasier.com's own media server, not
    NHK's) — **plus** a `<description>` containing the full article body as
    `<ruby>漢字<rt>かな</rt></ruby>` HTML, which is the piece a real podcast
    never has. This reframes the whole feature: it's not a bespoke scraper,
    it's **the existing podcast RSS path, plus one new module that pulls
    known text out of the description instead of transcribing the audio**.
  - **Done 2026-09-13**: `server/youtube-mining/app/nhk_easy.py` —
    `parse_nhkeasier_description()` converts `<ruby>` spans to this app's
    `漢字[かな]` `inlineReading` format and splits into sentences.
    `assign_sentence_spans()` maps `shadowing-analysis-api`'s `/align`
    word-level output back onto sentence boundaries, discovered/verified by
    actually calling the live aligner on real articles rather than assuming
    the shape of its output (see below). `app/align_client.py` calls
    `POST /align`. `POST /nhk-easy/import` (`main.py`) wires it all
    together: parse → fetch audio → align → cut per-sentence clips with the
    existing `clip.py` ffmpeg logic → degrade to text-only sentences
    (`audioAligned: false`) on any failure, never failing the whole import
    over the audio half. 23 tests (parsing + span-assignment against a real
    baked-in alignment fixture + the import endpoint with network/ffmpeg
    mocked), full backend suite green (127). Deployed and verified against
    the live service end to end on two different held-out real articles.
    Three real bugs found this way, not by unit tests against a
    hand-picked fixture:
    1. NHK Easy articles routinely report measurements like `350.5ミリ`/
       `36.5度`; a naive split on `.` (otherwise a legitimate sentence-end
       char) cut those mid-number. Fixed: `_is_decimal_point` guards any
       `.` flanked by digits.
    2. Sentence-final punctuation (`。`) is never itself a spoken/aligned
       word, so targeting a sentence's *full* length (including its
       trailing `。`) for the anchor lookup overshot into the next
       sentence's first matched word. Fixed: target the sentence's
       last *non-punctuation* character instead.
    3. Real prose routinely embeds a quoted title or reported speech
       *mid*-sentence (`「スター・ウォーズ」などたくさんの映画を監督してい
       ます。`; `区の人は「…」と話しています。`) — treating `」`/`』` as
       sentence-final (`subtitles.py`'s `SENTENCE_END_CHARS`, tuned for
       noisy ASR/caption text) cut 88 of 471 real sentences (19%) apart at
       the bracket. Fixed: `nhk_easy.py` now defines its own narrower
       `SENTENCE_END_CHARS` (drops the bracket chars) rather than reusing
       the ASR-tuned one — NHK Easy's edited-prose style always closes a
       real sentence with proper terminal punctuation even around a quote,
       so this costs no real splits.
  - **Blocked — a real constraint found by testing against the live
    service, not assumed:** `shadowing-analysis-api`'s `/align` rejects any
    transcript over `ANALYSIS_MAX_TRANSCRIPT_LENGTH` (default 200 chars,
    `422 transcript too long`) — a cap sized for its original per-sentence
    reference-alignment use case. **80% of the real 50-item corpus's
    articles exceed 200 characters** (median 239, max 335) once joined into
    one whole-article transcript, so most real NHK Easy articles fail
    alignment outright with the service as currently configured (they still
    import fine as text-only — `audioAligned: false` — this only blocks the
    audio half). Options, none implemented yet:
    1. **Raise the cap** (`ANALYSIS_MAX_TRANSCRIPT_LENGTH` env var on
       `shadowing-analysis-api`, e.g. to 500) — the direct fix, and
       probably safe (it's a defensive input-size limit, not a technical
       ceiling of the aligner itself; NHK Easy audio is still under a
       minute). **Not done because this crosses into a separate,
       already-live production service** (also backs real-time shadowing-
       practice grading, on the same memory-constrained box that needs
       weekly aligner restarts) — a config change there deserves a
       deliberate decision, not a silent edit from this session.
    2. Chunk by paragraph and align each chunk separately — doesn't
       actually work: alignment needs audio whose duration matches its
       given transcript, and there's no way to know where in the audio one
       paragraph ends and the next begins without already having aligned
       it (the exact problem this feature exists to solve).
    3. Silence-gap-based audio chunking (reusing `waveform.py`'s existing
       pause detection, already trusted elsewhere in this codebase for
       "Snap to pauses") matched to paragraph boundaries — plausible, but
       relies on the number of major pauses lining up with paragraph
       breaks, not guaranteed.
  - ~~**Not done — the wizard/commit UI**~~ **Done 2026-09-13**:
    `NhkEasyImportPage.tsx` (`/import/nhk-easy`, linked from `ImportPage`) —
    paste a feed URL (reuses `fetchPodcastFeed`/`POST /podcast-feed`, now
    carrying each item's `descriptionHtml`), pick an article (one
    `POST /nhk-easy/import` call, no job/polling/ASR since the text is
    already known-correct), "Auto-fill translations (AI)" (calls
    `realignTranslations` directly, one group per sentence — no
    provenance-grouping needed since there's no resegmentation happening),
    then the same `ShadowingPreviewCard` commit step the YouTube-mining
    wizard ends on. `NhkEasySentenceResult` also carries UniDic `tokens`
    now (`morphology.tokenize_japanese`, same as YouTube-mined sentences)
    so the vocabulary picker gets suggestions — but NHK's own furigana
    stays the committed `inlineReading` (overwritten after
    `buildShadowingPreview` runs, since that function otherwise re-derives
    it from tokens, which can differ on names/uncommon readings); the
    plain-kana `reading` field is similarly derived from NHK's furigana
    (`parseInlineReadings`) rather than left blank. Verified live
    end-to-end on a fresh, previously-untested article — 9 real sentences,
    real audio, correct furigana, real vocabulary tokens, all in one pass.
    **v1 of NHK Easy import is now feature-complete**: import → translate →
    commit all work. Remaining known gaps (per-chapter granularity for
    "Ready to read" scoring against these books, and the silence-gap
    audio-chunking idea above) are optional refinements, not blockers.
    **Manual test plan:** go to `/import` → "Import from NHK Easy News",
    paste `https://nhkeasier.com/feed/`, "Load articles," pick any article.
    Correct: a short wait, then a sentence list each with a real playable
    audio clip (native NHK narration) and an editable translation box.
    Click "Auto-fill translations (AI)" — every box should fill with a
    plausible English sentence (needs a signed-in, synced session; degrades
    to an inline "unavailable" note otherwise, same as the mining wizard's
    equivalent button). Click "Continue to review," then commit. Corruption
    spot-check: open the new book and confirm sentence text isn't garbled
    mid-word (the closing-bracket bug's old symptom) and that a couple of
    audio clips actually contain the right words, not silence or the wrong
    sentence.
  - Rights note: nhkeasier.com is itself a third-party redistribution of
    NHK's copyrighted news content for learners; using its feed for
    personal single-user study is the same posture as the existing
    YouTube-mining approach, just a different (and more permissive-in-
    intent) rights-holder relationship.
  - ~~One book per episode/article~~ **Changed 2026-09-13, per user
    request**: a podcast's episodes and every NHK Easy article now land in
    one shared book per series (one book overall for NHK Easy, one per
    podcast feed), each as its own chapter, kept chronological by publish
    date regardless of import-click order. New repository function
    `commitSeriesEpisodeImport` (`src/db/repository.ts`) — looks up the
    book by a series-level `sourceKey` (`podcast-series-<hash of feed URL>`
    or the fixed `nhk-easy-news`) instead of a per-episode one, dedups
    chapters by the episode's own `source.id` (a new `BookChapter.sourceId`
    field — matching by title alone would risk merging two differently-
    titled re-imports of the same episode, or duplicating on a title that
    changed upstream) so re-importing the same episode updates its chapter
    rather than duplicating it, and `reorderChaptersChronologically`
    cascades a new `BookChapter.sourceDate` field into
    `bookSentences.position` (chapter-major order) after every import.
    `ShadowingPreviewCard` gained an `onCommit` override (defaulting to the
    original one-book-per-source `commitShadowingPackageImport`, still used
    for plain YouTube videos and `.shadowing.zip` uploads) so both
    `YouTubeMinePage`'s podcast branch and `NhkEasyImportPage` route through
    the new series-aware path instead. 4 new repository tests. Deliberately
    scoped down from a fuller "bulk-import a whole feed" ask (would need
    real throttling/pause-resume design for a 1000+-episode feed) to just
    this structural change — still click episodes/articles one at a time.
    **Known gap**: any book already created under the old one-per-episode
    scheme before this change (e.g. an episode imported earlier today)
    stays a separate single-chapter book — not retroactively merged.
  - **Follow-up, same day, user request**: the episode/article picker now
    shows an "Imported" badge (via a new `getSeriesImportedSourceIds`
    lookup, matched against the same as-picked URL used as the chapter's
    `sourceId`) and the feed's own publish date next to each row — both
    pickers were silent about either before. Podcast duration still only
    shows when the feed's own `itunes:duration` tag is present (many don't,
    e.g. Nihongo con Teppei's); NHK Easy articles have no pre-import
    duration signal at all (the real clip lengths only exist after forced
    alignment), so that one stays blank by design, not a gap.

- [x] **Difficulty screening checkpoint.** (2026-09-13, was item 5 under
  Podcast mining above) `server/youtube-mining/app/difficulty.py`
  (`score_difficulty`) — content-word JMDict-common ratio + average
  sentence length + morae/second when timing's available, rendered as a
  rough beginner/intermediate/advanced readout. One shared function, two
  call sites: a new stateless `POST /difficulty` (wizard Transcript stage,
  a "Check difficulty" button on `TranscriptStage.tsx` — shared by both
  YouTube and podcast mining) and inline in NHK Easy import (reuses the
  tokens already attached to each sentence, no second tokenize pass).
  JMDict's "common" flag only lives on the Node/TS side and tokenization
  only in Python, so `scripts/generate-common-words-asset.ts`
  (`npm run generate:common-words-asset`) flattens it into a committed
  Python-side asset (38,360 entries). Detail + manual test plan in
  docs/STATUS.md's 2026-09-13 entry. **Not browser-verified** (this host
  has no browser libs installed) — shipped on the full test suite +
  typecheck + a direct curl against the live service instead.

- [x] **"Ready to read" difficulty/coverage scoring.** (2026-09-13,
  promoted from "Possibilities" below; step 3 closed 2026-09-17) The direct
  answer to "I have several
  books/sources now, which is the easiest one to pick up next" — and the
  natural companion to the two importers above: NHK Easy content is
  *labeled* easy by NHK, but Satori books, YouTube-mined books, and future
  podcast/NHK imports all need the same yardstick to be comparable. Plan:
  1. ~~**Per-book known-word coverage**~~ **Done 2026-09-13** —
     `src/lib/bookCoverage.ts` (`buildBookCoverage`, pure, 8 tests) reuses
     the exact same primitives `isSentenceReadyForFullReview` is built from
     (`getReviewableVocabularyItemIdsBySentence` /
     `getProficientVocabularyItemIds`) so "known" means the same thing here
     as everywhere else in the app — no new proficiency concept.
     `getBookVocabularyCoverage()` (`src/db/repository.ts`) batches this
     once across every book (one pass, not N+1), same convention as
     `getBlindSpots`. Ratio is `null` (not 0%) for a book with zero
     confirmed vocabulary yet — "not analyzed" is a different state from
     "read and found unfamiliar." **Per-chapter** breakdown not done —
     v1 is book-level only; a chapter's sentences aren't currently queried
     separately from the rest of the book's, so this would need a real slice
     of new code, not just a smaller reuse of the same function.
  2. ~~**Sort/filter by coverage**~~ **Done 2026-09-13** — `BooksPage.tsx`
     gained a "Recent" / "Easiest first" toggle (`SortMode`); easiest-first
     sorts by coverage ratio descending, with not-yet-analyzed books (null
     ratio) always last rather than sorting as 0%. Each book row shows
     "~NN% known vocabulary (X/Y words)" or "Vocabulary not confirmed yet."
     Not yet browser-verified — `BooksPage` has no existing test file to
     extend and the underlying `buildBookCoverage` logic is fully unit
     tested, so this follows the same "pure function tested, thin
     Dexie-reading page left for manual verification" convention as
     `getBlindSpots`/`/progress`'s other panels rather than a new component
     test. **Manual test plan:** open `/books` with at least one book whose
     vocabulary is partly confirmed+proficient and one that's unanalyzed;
     toggle "Easiest first" and confirm the higher-coverage book floats up
     and the unanalyzed one sorts to the bottom regardless of ratio.
  3. ~~**Feed `findExploreCandidates`**~~ **Done 2026-09-17** — among books
     that are otherwise tied (both caught up on vocabulary confirmation, the
     existing rank-0-vs-1 gate untouched), `getBookVocabularyCoverage()` now
     breaks the tie by coverage ratio descending before falling back to
     recency; unanalyzed books (`ratio: null`) still sort last, same
     convention as `BooksPage`'s "Easiest first" toggle. A light touch on
     top of the existing vocab-first gating, not a rewrite of it — verified
     with a repository test (`tests/sessionPlannerRepository.test.ts`) where
     a more-recently-opened harder book is deliberately outranked by an
     older, fully-known one.
  - Out of scope for v1: cross-book recommendation ("read X before Y") —
    just a per-book number the learner reads themselves.

- [ ] **Remaining inflected `pitch_accent` gaps.** 2026-09-12 extended
  coverage from godan-only to godan + ichidan + i-adjective + the -masu
  family (see docs/STATUS.md) — all verified against Wiktionary's
  `Module:ja-acc-table` live-rendered output, not summarized web search.
  What's still missing, and why each is a real limit rather than a "not
  yet ported" gap:
  - ~~**te-form/plain-past(た)/tara-form, godan/ichidan.**~~ **Closed
    2026-09-13** — `VocabularyItem.teFormAccentPosition`, backfilled
    per-word from Wiktionary's own conjugation table (not a formula; see
    docs/STATUS.md). Migration applied + backfill run against production
    2026-09-13: 96 of 134 candidate verbs matched. i-adjective
    te_form/plain_past/ba_form (kute/katta/kereba) still excluded — see
    below, same external-data problem but not yet extended to adjectives.
  - **Ichidan `plain_past_negative`.** Unlike godan (where なかった cleanly
    carries the negative form's value forward), this wasn't verified
    against real ichidan なかった data this pass — stays excluded until it
    is.
  - **Accented i-adjective `plain_negative`/`plain_past_negative`.** Not
    excluded out of caution — real data for 高くない shows a genuine
    two-accent realization (the く-stem's own downstep plus ない's own
    atamadaka accent) that isn't representable as a single position
    number in this model at all. Would need a different representation
    (two positions, or a richer contour type) to ever support, not just
    more verification.
  - **い-adjective te_form/plain_past/ba_form (kute/katta/kereba).**
    Same "external per-word data only" limit as verb te-form, for every
    accent class including heiban.

- [ ] **Heiban i-adjective predicate-position accent.** Side discovery
  from the 2026-09-12 pitch-accent work; investigated 2026-09-13, still
  not acted on. Confirmed real and general, not a 甘い one-off: live
  `Module:ja-acc-table` output for both 甘い and 赤い (both heiban, `acc=0`)
  shows the same thing — the "Terminal" (predicate) row renders *two*
  valid pronunciations, the plain heiban one and an alternate with a
  downstep at `moraCount - 1`, both dictionary-attested (SMK2/NHK/DJR),
  in free variation. This isn't isolated to bare-terminal position either:
  the same module already emits the downstep-2 form as the *only* value
  for くて/かった/ければ/です — i.e. `pitchAccentPositions` in this corpus's
  own data already carries exactly this kind of multi-value ambiguity for
  some words (e.g. 危ない, 怪しい are stored as `[0, 3]`), and
  `resolveInflectedPitchAccent`'s citation-form branch
  (`src/lib/pitchAccentShift.ts:230`) always takes `positions[0]` and
  silently discards the rest — same in the ambient display
  (`getSentencePitchAccentTargets`, `src/db/repository.ts`), which calls
  the same resolver. So the real gap is "no representation for a
  dictionary-attested alternate accent," not something specific to
  predicate position.
  `hasFollowingVoicedMora` (`src/pages/ReviewPage.tsx:426`) does not gate
  this case either — it's a bare `/^[ぁ-ゟ]/` check, not phonetic voicing,
  so です/よ/ね/か all count as "following voiced mora" and let the
  edge-accent skip pass through untouched.
  Currently latent, not live: of 39 `adj-i`/`adj-ix` vocabulary items in
  the corpus, only 2 (危ない, 怪しい) are heiban, and neither has a single
  `sentence_vocabulary` link — zero occurrences anywhere, predicate-final
  or otherwise. Not worth fixing today. Revisit when a heiban i-adjective
  actually gets mined into a sentence; at that point the fix is either
  (a) stop truncating to `positions[0]` and pick the entry that matches
  context, or (b) keep asserting the primary/first-cited pronunciation
  but only within the existing "never assert something false" gate — i.e.
  route to (a).

- [ ] **Segmental pronunciation feedback.** The missing half of Phase 9 —
  everything shipped there scores *timing* and *pitch*, nothing addresses
  "is my し / ら / ふ / つ / う the right sound vs. an English substitute".
  Prompted by 2026-09-02 shadowing discussion. Prerequisite: the user gets
  2–4 phonetics-focused tutor sessions first, to produce a real list of
  *their* segmental errors — the content below is scoped from that list,
  not a generic one. Then, in one phase:
  - **`reference`-type "sound guide" page** — per problem sound: an
    articulatory cue (tongue/lip position) + a native minimal-contrast
    clip (English allophone vs. Japanese target). Linked from `ShadowPage`.
    Mostly content authoring; near-zero new code. Can ship on its own
    ahead of the analysis work.
  - ~~**Spectrogram overlay in `AnalysisPanel`**~~ **[done 2026-09-03]** —
    "Show spectrogram" toggle draws the reference clip + learner attempt as
    stacked grayscale spectrograms (`src/lib/spectrogram.ts` hand-rolled
    radix-2 FFT + Hann STFT, `SpectrogramCanvas.tsx`), off the samples the
    panel already decodes. Short "how to read this" caption stands in for
    the sound guide until it's authored. Not time-warp-aligned to each
    other yet (both from t=0, shared px/sec).
  - **ASR kana-diff observation** — reuse the existing faster-whisper
    (`base`) secondary signal: a new observation kind
    (`asrObservations.ts` + `feedbackRanking.ts`) flagging morae where the
    ASR reading of the attempt diverges from target kana. Non-authoritative
    and clearly hedged — `base` is noisy.
  - **Not** a segmental scoring model — same host-footprint constraint that
    parked PASQA (see "Not planned"). Spectrogram + ASR-diff only.
  - Deliberately **not** a standalone blind-A/B perception quiz — cuts
    against the "skill over metalabel quiz" principle. Only revisit as a
    small gate inside an existing drill if the above ships and needs one.

- [x] **Daily practice panel.** (2026-09-19) A small set of non-SRS daily
  practice targets ("say 5 pitch-drill words", one Odd Ear Out round, one rotating
  game) as `DailyPracticePanel` on Home and the session page — counters read from
  the activity logs, not session steps (see STATUS 2026-09-19 for why). Possible
  follow-ups, unscheduled: a settings UI for the targets; per-device-agnostic game
  progress (needs `gameRounds` to sync, currently local-only by design); adaptive
  targets (e.g. more drill words while d′ on fall-vs-rise is ~0); adding the
  fall-or-rise binary drill and the calibrated continuous drill scoring
  (see "Pitch-accent: analysis tools") as panel items once built; a recap line
  ("practised 5 words, 1 round") in `SessionRecapPanel`.

- [ ] **Pitch-accent: analysis tools & practice ideas.** (2026-09-19; first
  pieces shipped) Prompted by the user doing well on the standalone pitch ear
  trainers yet still struggling with the `pitch_accent` card and the free drill.
  Prod data: 2-mora fall-vs-rise (`hl` vs `lh`) d′ = 0.19 (essentially no
  discrimination, criterion ≈ 0 so not a one-answer bias; 37 `hl` + 22 `lh`
  trials); across *all* shapes exact-match accuracy is ~50% vs ~27–31% chance, so
  the card is above chance overall and the fall-vs-rise contrast is the hard core.
  Recommendations, in the order proposed:
  - [x] **Reveal bridges** — measured native contour of the word beside the
    dictionary diagram, and a "what your pick sounds like" real same-length word
    after a miss (`WordPitchContour`, `PitchContrastExample`, `pickContrastClip`).
    Usage logged as review `assistance` values (no migration; a new `reviews`
    column would have risked the migration-apply gap failing every review push);
    pitch reviews now also record `contextSentenceId` (which clip was played).
    See STATUS 2026-09-19.
  - [x] **Native-clip audit + accuracy vs cue strength** —
    `scripts/audit-pitch-accent-clips.ts` (+ `src/lib/nativeClipPitchAudit.ts`):
    measures each native word clip with the *drill's own scoring rule*, reports
    dictionary agreement, cue strength (semitone separation of expected-high vs
    expected-low morae), the user's accuracy binned by cue strength vs chance, a
    voiceless-consonant split, and a weak/contradicting-clip list; per-clip TSV
    to `/tmp/pitch-audit-clips.tsv`. First full run (222 clips, 191 measurable):
    native clips agree with the dictionary shape only **37%** overall (2-mora
    `hl` 64% / `lh` 55%; 4-mora heiban `lhhh` **3%**, n=33; 3-mora `lhl` 12%),
    median cue 0.7 st, 57% weak. The user's accuracy does **not** rise with cue
    strength (≥3 st: 39% vs 27% chance; <0 st: 52% vs 28%), so weak clips are not
    the main cause of the misses; the "vowel/sonorant-only words are harder" hunch
    did not hold up (voiceless 53% vs voiced-only 48%). Caveats: reviews joined to
    the *mean over the word's clips* until reviews since 2026-09-19 accrue exact
    `contextSentenceId`s; the cue measure is itself noisy (equal-width buckets,
    YIN octave errors — some cues read −5…−11 st).
  - [x] **d′ / criterion in the report** — `signalDetection` in
    `nativeClipPitchAudit.ts`, printed by `report-pitch-drill-effectiveness.ts`.
  - [ ] **Calibrate the drill scorer against native clips** (*new, from the
    audit*). The audit is also a validity test of the free drill's grader: run on
    native speakers' own clips it disagrees with the dictionary ~63% of the time
    (4-mora heiban almost always), so it can mark a *correct* production wrong.
    Candidate fixes to try against this benchmark: detrend declination before
    bucketing, use median not mean, snap buckets to alignment phone/mora
    boundaries instead of equal widths, drop octave-error frames, and require ≥80%
    agreement on clean native clips before trusting a category. Until then treat
    drill "mismatch" verdicts on long/heiban words sceptically. Do this before
    building anything that leans on the same measurement (below).
  - [ ] **Gate/rank `pitch_accent` cards by measured cue strength** — only after
    the scorer is calibrated (the current measure is too noisy to gate on). Same
    principle as "gate cards missing support": don't show a card whose
    discriminating cue isn't in the clip; also gives an easy→hard ramp.
  - [ ] **Continuous scoring in the drill** — compare the learner's pitch line to
    the native one for the same word (fall timing error, fall magnitude relative
    to the native's, trend over time), normalized *per speaker* (never absolute
    pitch — user is a quiet baritone), so progress shows even while the high/low
    grade is still wrong. Depends on the scorer calibration above.
  - [ ] **Hear-vs-say per-word table** (perception from card reviews vs
    production from `pitch_drill_attempts`). Premature — only ~71 drill takes so
    far; revisit once there is volume.
  - [ ] **Practice ideas proposed, not built:** a high-volume binary fall-or-rise
    drill on 2-mora native clips with instant feedback (ear-trainer-style, then 3-
    and 4-mora) — check first whether the drill's minimal-pair ABX warm-up already
    gets used; an optional "hear the native word first" button in Single-words
    mode (must not reintroduce a guess gate before recording); resynthesized
    stimuli (one native clip with its contour flipped — biggest build, needs a
    pitch-manipulation step on the box). Off-app: say every practice word with a
    following particle (が/は) so heiban/odaka are audible; exaggerate and hum the
    contour; lean on the rule explanations the reveal already gives.
  - **Decision point:** after ~2 weeks of reviews with the new tracking, re-run
    both scripts. If contrast-played next-review pass-rate beats not-played, keep
    and extend the contrast idea; if d′ is still ~0, prioritize the binary
    fall/rise drill.

- [ ] **Port the aligner's day/month numeral expansion to TypeScript.**
  (2026-09-19, from the alignment session's review) `shadowing-analysis-api`
  expands `<digits>日` / `<digits>月` to hiragana before aligning
  (`app/numerals.py`, 43-entry table), so cached alignments' word texts differ
  from the sentence text `isolatedWordRange`'s `matchWord` measures against —
  every word's span in a sentence containing such a date is skewed. Porting the
  table so `matchWord` measures against the same expanded text would fix it for
  every word-audio consumer (pitch_accent / word_listening cards, karaoke text);
  cost is keeping the table in two languages. Odd Ear Out currently just skips
  those sentences (`hasAlignerNumeralExpansion`). Unscheduled.

## Possibilities (analytics & cross-activity coherence)

From a 2026-09-08 discussion on measuring performance, surfacing what to
learn next, and making the review card types + shadowing reinforce each
other instead of running as silos. **Blind-spot surfacing**, the
**error-mix view**, and the **shadowing → SRS evidence bridge** shipped
2026-09-08 — see "Analytics pass 1" under Done. The rest are unscheduled
possibilities, kept here so the thinking isn't lost:

- [x] **Leech list** — shipped 2026-09-17 as a `/progress` panel:
  `src/lib/leechList.ts` (`buildLeechList`) ranks every study item with a
  real FSRS `lapses > 0` by `lapses + weakness` (the same
  `recentAgainCount / recentReviewCount` term `sessionPlanner.ts`'s
  `scoreReviewPriority` uses), each row showing its most common recent
  `errorClassification` reason and a next action — reuses `errorMix.ts`'s
  `metaFor`/`classificationKey` (both exported for this) rather than a
  second label table, so the two views never disagree. Deliberately
  excludes items whose recent misses haven't produced a real lapse yet
  (a still-new item defaults to a nonzero `weakness` in the planner's own
  formula, which would otherwise leak in here too). `repository.ts#getLeechList`
  only fetches reviews for the lapsed subset, not the whole `reviews`
  table. Not a standalone drill — each row links to `/study-items/:id`
  (existing debug view) and, when classified, the same next-action route
  `errorMix` already points at.
- [x] **Skill-imbalance metric** — shipped 2026-09-16 as "Skill coverage"
  on `/progress`: of reading-*recognized* words (`reading_retrieval`/`cloze`
  proficient — the recognition-only denominator, deliberately excluding
  `reading_production`, a separate rung), what share have also reached
  production, pitch, and word-listening proficiency. `skillCoverage.ts` /
  `repository.ts#getSkillCoverage`.
- [x] **Self-rating calibration** — shipped 2026-09-16 as "Self-rating
  check" on `/progress`: global pass-rate comparison between self-rated
  activity types (`reading_retrieval`/`cloze`/`reading_in_context`/
  `listening`/`word_listening` — `grammar_production` from the original
  note no longer exists, retired 2026-09-15) and objectively-graded ones
  (`reading_production`/`sentence_transformation`/`grammar_completion`/
  `pitch_accent`/`contrastive`), plus a per-self-rated-activity-type
  breakdown. Deliberately a global comparison, not a same-subject join —
  see `selfRatingCalibration.ts`'s doc comment for why.
- [x] **"Ready to read" coverage** — promoted to "Planned" 2026-09-13 as
  "'Ready to read' difficulty/coverage scoring," see above.
- [x] **FSRS calibration surfacing** — shipped 2026-09-16, scoped down to
  the buildable half: "FSRS confidence" on `/progress` shows a live
  bucketed snapshot of every active study item's *current* predicted
  retrievability (`scheduling.ts#predictRetrievability`, wrapping
  ts-fsrs's own `get_retrievability` rather than reimplementing the
  formula). **Not** predicted-vs-actual validation or a desired-retention
  knob — both need the predicted retrievability logged on each `Review`
  row at grading time, which nothing does today; still open if wanted.
- [x] **Per-review predicted-retrievability logging.** (2026-09-17) The gap
  above is closed: `recordReview` (`repository.ts`) now calls
  `predictRetrievability` against the study item's FSRS state *before*
  scheduling and stores the result on the new `Review.predictedRetrievability`
  field (undefined for `new`-state items and any item without a real
  `lastReview` yet, matching the same guard the "FSRS confidence" panel
  uses — checking `state !== 'new'` alone isn't enough, ts-fsrs throws
  without a `lastReview` to diff against). Synced via a new nullable
  `predicted_retrievability` column (`supabase/migrations/
  20260917000000_review_predicted_retrievability.sql` — **not yet applied
  to prod**, see the migration-apply-gap note in STATUS.md) and
  `reviewToRemote`/`remoteToReview` in `src/sync/mappers.ts`. Only reviews
  recorded from this point on carry the value — historical rows stay
  unset, so predicted-vs-actual calibration and a desired-retention knob
  are both still open, now blocked on accumulating data rather than on
  missing plumbing.
- [x] **Step usefulness** (new, 2026-09-16) — `PlannerSessionStep.status`
  already recorded completed/skipped per step, but nothing rolled it up
  across sessions by `targetKind` — no way to see "which step kinds
  actually get done vs. quietly skipped every time" without a one-off
  script. Shipped as a `/progress` panel, 56-day window, sorted by skip
  rate. `stepUsefulness.ts` / `repository.ts#getStepUsefulness`.
- [x] **Gate funnel / "what's stuck"** (new, 2026-09-16) — every gate-
  starvation bug found earlier the same session (`continue_book`, shadow,
  listening) was caught by a one-off Node script against Supabase or a
  user report, not by anything the app itself surfaced. Shipped as a
  `/progress` panel: confirmed sentences whose words were never reviewed
  (`continue_book` backlog), and shadow-/listening-ready sentences blocked
  on specifically the pitch requirement. `repository.ts#getGateFunnelSnapshot`
  — no separate pure lib module, since the logic is mostly Dexie-side
  counting reusing the gate primitives directly.
- [x] **Velocity / ETA** — shipped 2026-09-17 as a "New-card backlog"
  `/progress` panel. `src/lib/velocity.ts` (`buildVelocityReport`) combines
  `countNewVocabularyCardBacklog()`'s raw count with the words-learned-per-
  week trend `buildProgressReport` already computes (`ProgressReport.weeks`)
  — no new Dexie reads, computed client-side in `ProgressPage` from data
  it's already fetching. Averages only *complete* weeks (the most recent
  bucket is the current, still-in-progress week and would understate the
  rate); reports "no estimate yet" rather than a divide-by-zero/infinity
  when the recent rate is 0.
- [ ] **Per-sentence mastery arc** — one ladder per encountered sentence
  (vocab confirmed → words reading-proficient → listening-proficient →
  conjugations → grammar noticed → `reading_in_context` mature → shadowed
  → pitch OK), a view plus a "finish sentence X — one rung left" planner
  step. Turns the flat multi-card queue into a visible arc.
- [ ] **Cross-activity error routing** — a `cloze` miss on word W in
  sentence S floats S up as a shadowing/reading target; a
  `sentence_transformation` miss surfaces the grammar pattern behind that
  form. Extends `preferCoherentChains` from within-plan grouping to
  miss-driven scheduling. The `pitch_accent` slice of this shipped
  2026-09-11 (`getPitchAccentFocusWords`, see Done) — this item is the
  rest: cloze/shadowing and sentence_transformation/grammar.
- [ ] **Ambient connective tissue in the reveal** — on a `cloze` reveal,
  "you've shadowed this sentence — replay?"; on `reading_in_context`,
  highlight the tracked grammar pattern in the passage. Matches the
  "ambient surfacing" feedback note. (The `pitch_accent` "missed in the
  drill twice too" case shipped 2026-09-11 as the focus-queue banner
  instead of an inline reveal note — see Done.)
- [ ] **Opt-in single-sentence deep dive** — an explicit focus block that
  walks one lagging sentence through recognition → production → listening →
  shadow back to back. Distinct from the default queue, which
  `spaceOutSiblingCards` deliberately keeps siblings apart in.
- [ ] **Shadowing weak words → pitch-accent drill** — `getShadowingWeakWords`
  already exists (feeds the `/progress` error-mix panel). Surface those
  words as a "focus" sub-list or badge on `PitchAccentDrillPage`; a
  repo-side sort bias won't work because the drill deliberately
  `seededShuffle`s its list. (2026-09-11 shipped the sibling feature for
  `pitch_accent` SRS misses, same UI slot — see Done. This item is still
  open for shadowing-specifically-weak words.)
- [ ] **Free-composition ("writing") skill node** (2026-09-16 discussion,
  card-type/skill graph mapping). `reading_production` only tests
  decode→encode of a word already placed in a sentence (type its reading);
  the user's actual "writing" goal is a level up — given an intent (an
  English prompt, or "how would you say X"), produce Japanese words *and*
  grammar from scratch. Nothing today tests that; it would sit above
  `reading_production`/`sentence_transformation`/`grammar_completion` as
  the point where their outputs get used together unprompted, rather than
  each being gated tightly by the others. Explicitly deferred — user:
  "once I can consistently and across a good range of sentences produce
  vocabulary in context, then I'll start looking at what else I might
  need." Revisit once `reading_production` mastery is broad, and pin down
  first whether "communicate what I want" means free-form text (hard to
  auto-grade) or something more constrained (translate this prompt,
  graded against expected structure).
- [ ] **Context-aware comprehension check for `reading_in_context`/`listening`**
  (2026-09-16 discussion). Both cards are currently pure self-rating — read
  or listen, reveal, self-rate Again/Hard/Good/Easy with no objective check
  that comprehension actually happened (`classifyReviewError` already
  documents this as a known gap: "a bare 'again' there could mean anything").
  Idea: reuse `reading_in_context`'s existing passage-context display (the
  `before`-sentences block, already shown pre-reveal) and add a 4-option
  "which English sentence best represents this sentence *in context*"
  pick before reveal — testing whether context actually resolved an
  ambiguity (dropped subject/pronoun referent, tense/aspect, register),
  not just general reading. A `listening`-side equivalent (play the
  Japanese audio, same 4-option pick) was also floated. Distractor
  authoring: the user asked whether this could reuse the "Segment with AI
  help" pattern (`formatTranscriptForAI`/`parseAiSegmentedTranscript` in
  `miningTranscript.ts` — build a copy-pasteable prompt, the learner pastes
  it into whatever external AI they already have open, pastes the reply
  back in to parse) rather than a server-side LLM call; the recipe for
  *good* distractors is "translate this sentence cold vs. with its
  preceding context — the cold-reading's plausible errors are the
  distractors," authored once per sentence and stored, not recomputed per
  review. User flagged wanting to think further about distractor
  *difficulty* selection specifically — if the learner is getting them
  consistently right, the distractors may need to get harder (closer
  near-misses) to stay useful, an adaptive-difficulty angle not yet
  designed. Open question left unresolved: does a wrong pick override the
  self-rating (e.g. force "again"), or just inform it (show ✓/✗ before the
  learner rates, rating stays theirs)? Explicitly parked — user: "sitting
  on it would be good."
- [ ] **Pull the pitch-accent production drill into a review card**
  (2026-09-16 discussion). `PitchAccentDrillPage` (`/pitch-accent`) already
  measures the learner's recording against the dictionary target per mora
  (`buildPitchAccentShapeObservations`/`learnerClassesBySurface`) — real
  scored data, not just a self-tap — and it's the *only* pitch-production
  surface that reaches most of the corpus, since it needs no reference
  recording (unlike the perception `pitch_accent` SRS card, which is
  reference-audio-gated and so only reaches a minority of sentences). Not
  a simple "add scheduling" move — two real blockers:
  1. **Rating derivation.** Every existing card gets a rating from a typed
     match or a self-tap; this one would need a policy for turning a noisy
     per-mora accuracy score into again/hard/good/easy, plus a fallback for
     the real fraction of takes that come back `unavailable` (alignment
     failed, no score at all). This is the actual unlock — worth designing
     before anything else here.
  2. **Cost model.** Record → upload → align → score takes real seconds per
     rep, unlike a tap — the planner's per-card time estimates and
     quiet-mode exclusion (shadowing already gets excluded since it needs
     speaking aloud) would need the same treatment, not the normal
     review-card assumptions.
  Direct consequence if this ships: shadowing's and listening's
  pitch-proficiency requirement (2026-09-16, this same session) currently
  points at the *perception* `pitch_accent` card specifically — would need
  a decision on whether it stays there, moves to the new production card,
  or requires both. Explicitly parked — user: "in the roadmap is fine."

## Not planned (deliberate)

- **Dictionary H/L marks on conjugation (`sentence_transformation`)
  cards** — the sentence's verb is inflected but `SentencePitchAccentRow`
  draws the citation-form contour, which would mislead on the surface under
  test. Deliberately excluded from the 2026-09-02 wider H/L surfacing.
- **Joined cross-word sentence pitch contour** — a single continuous line
  across words. Japanese cross-word downstep / particle attachment /
  rendaku shifts aren't synchronically rule-governed; a real version needs
  an OJAD-style prosody parser or per-sentence hand annotation. The
  per-word blocks are the honest ceiling (see `sentencePitchAccent.ts`).

- No export-back-to-Anki path; migration away from Anki was one-way.
- No Anki review-history migration — FSRS starts from zero prior signal for
  pre-app words (permanent, accepted).
- **PASQA** speech-quality model — investigated, architecture left ready,
  blocked on PyTorch + s3prl footprint on the memory-constrained analysis
  host.
- "Which words share a reading" kanji drill (reverse of
  `KanjiDetailPage`'s current view) — not built, low value.
