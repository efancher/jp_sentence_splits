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

- [ ] **Re-mine "After Work".** (2026-09-01 re-check: First Day at Work is
  clean now; GLIM SPANKY is a song, annotate-only — both need no action.)
  "After Work" (`FkX4A-ZLBrc`, 116 sentences, **zero study progress**) is
  still broken after the 2026-08-29 re-segment: garbled name ASR
  (翔吾→"し吾"), human translations scrambled across sentences, gap
  positions. Fix: fresh re-mine through the YouTubeMinePage wizard (ASR
  `large-v3-turbo` → review segmentation → translate → commit into the
  existing book, idempotent on `source_key`). Browser + human
  translation-review — not safe to headless against production. Mac exit
  node is up.


- [ ] **Real-audio pitch-perception bridge.** Follow-on to the
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
  - **Word-alone vs. word-in-phrase** — play the isolated word span, then
    the word + following particle span, ask "did the drop land before the
    particle?" The odaka-vs-heiban bridge, which no isolated view can teach.
  - **Same/different + ABX on near-minimal pairs** — same mora count +
    reading shape, different accent position; same-speaker first, then
    cross-speaker. 3–5 trials, not a scored drill.
  - **Not** an F0-resynthesis pipeline (ChatGPT's centre-piece): real
    near-minimal pairs from the corpus get most of the perceptual benefit
    without a PSOLA/WORLD service on the memory-constrained analysis host
    (same footprint constraint that parked PASQA).

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

- [ ] **Grammar SRS: noticing + in-context reading vs. the isolated drill
  ladder.** Open design question from a 2026-09-09 discussion (conjugation
  coverage → vocab/grammar recommender boundary). The
  `grammar_comprehension` / `grammar_completion` / `grammar_contrast` /
  `grammar_production` ladder is the part of the system that most resembles
  a siloed metalabel drill — the same shape the user has trimmed elsewhere
  (comprehension retired for `reading_in_context`; "prefer in-context over
  isolated"; "skill over metalabel quiz"). External precedent: jpdb ships a
  strong tool with **no grammar SRS at all** (deconjugation + graded
  reading only); the immersion/sentence-mining tradition treats a grammar
  point as just another i+1 target on one card type, not its own ladder;
  Bunpro keeps a full grammar ladder but merges it into one review queue.
  Conjugation is explicitly *not* in scope here — it rides on vocab
  (deconjugation is part of knowing the word) and that half is settled.
  The question is only whether tracked grammar patterns should drive
  `reading_in_context` selection + a lightweight "did you notice it"
  check + ambient reveal highlighting, rather than four dedicated card
  types. Not scheduled; would want a real look at how the current grammar
  cards are actually performing (leech rate, self-rating calibration)
  before committing either way.

## Possibilities (analytics & cross-activity coherence)

From a 2026-09-08 discussion on measuring performance, surfacing what to
learn next, and making the review card types + shadowing reinforce each
other instead of running as silos. **Blind-spot surfacing**, the
**error-mix view**, and the **shadowing → SRS evidence bridge** shipped
2026-09-08 — see "Analytics pass 1" under Done. The rest are unscheduled
possibilities, kept here so the thinking isn't lost:

- [ ] **Leech list** — rank study items by lapses + the planner's existing
  `weakness` term, show the `errorClassification` reason, offer a real
  intervention per item (re-gloss / shadow / contrastive pair / track the
  grammar), never a leech drill. Overlaps the error-mix view.
- [ ] **Skill-imbalance metric** — of reading-proficient words, what
  fraction are `word_listening`-proficient? `reading_production`-proficient?
  A "listening trails reading by ~N words" line to steer bucket allocation
  by *skill gap*, not just the neglect score's *recency*.
- [ ] **Self-rating calibration** — compare self-rated cards
  (`reading_in_context`, `listening`, `grammar_production`) against
  objectively-graded ones (`cloze`, `reading_production`,
  `grammar_completion`) on overlapping subjects; flag over-confidence
  (rated "good", failed the graded card).
- [ ] **"Ready to read" coverage** — proficient-word coverage per
  book/chapter ("Episode 4 is 96% known-word coverage — read it straight
  through"), to direct which native material to pick up next. The planner
  currently only points at the next unstudied sentence.
- [ ] **FSRS calibration surfacing** — predicted retrievability vs actual
  pass-rate on `/progress`, plus an explicit desired-retention knob, so
  over/under-reviewing is visible.
- [ ] **Velocity / ETA** — surface the new-card-backlog drain rate
  (`report:new-card-backlog` already computes it) and ~words/week.
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
