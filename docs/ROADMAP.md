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
  signal, pronunciation history, ground-truth pitch-accent scoring,
  progressive/guided practice mode) plus the **cross-sentence learner
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
- [x] **WaniKani mnemonics on review cards.** Vocab + kanji mnemonic/hint
  slices + a script-only `wanikani_subjects` Supabase cache + deferral
  fall-through. Deployed 2026-08-29/30/31 (303 vocab, 2101 kanji). Detail
  in STATUS.md.
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
  available. `comprehension` unchanged. Closes the Phase 4 gap.
- [x] **Audio-less pitch-accent production drill.** (2026-09-01)
  `PitchAccentDrillPage` (`/pitch-accent`, Home shortcut) +
  `getPitchAccentDrillSentences` — a non-SRS practice loop over Satori
  sentences with confirmed pitch-accent-bearing vocabulary, no reference
  recording, and words already reviewed to proficiency (same
  `getSentenceFullReviewReadiness` gate as shadowing candidates). Record
  the sentence; `buildPitchAccentShapeObservations` scores each target
  word's realized contour against the dictionary shape using only the
  learner's own forced alignment + pitch. Nothing saved or scheduled.
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

- [ ] **Native-clip measured pitch overlay.** Under the sentence text on
  the `listening` / `word_listening` review reveals and the shadowing
  surfaces, overlay the *measured* YIN pitch track of the **reference**
  recording (real signal via the existing `extractPitch` +
  `loadOrComputeAlignment` cache), not a predicted contour — a genuine
  sentence-level pitch view with no prosody-model guesswork, complementing
  the per-word dictionary H/L marks. Needs a persisted per-clip reference
  pitch track (mirrors what `AnalysisPanel` already computes for the
  learner's own take). Prompted by the 2026-09-02 pitch-accent pass.

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
  - **Spectrogram overlay in `AnalysisPanel`** — reference vs. attempt,
    time-aligned off the existing `loadOrComputeAlignment` cache. Canvas
    FFT, no new backend, no new dep. Pair with the sound guide — reading a
    spectrogram is a learned skill and is noise without guidance.
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
