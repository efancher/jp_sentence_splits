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
  progressive/guided practice mode). One milestone still open — see
  **Cross-sentence shadowing learner profile** below. Detail in
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
  activity type (one card per surface-form occurrence, loops just that
  word's audio span) gated behind reading proficiency; full-sentence
  `listening` gated behind every `word_listening` occurrence. Done
  2026-08-30, not yet browser-verified.
- [x] **Grammar-learning system.** Phases 1–9-Contrast-slice: schema/
  repository/sync foundation, manual annotation from Analyze, `/grammar`
  browser + personalized curriculum dashboard, AI-assisted suggestion/
  explanation, `grammar_comprehension`/`grammar_completion`/
  `grammar_contrast` review cards, derived learner-state ladder,
  `GrammarRelationship` browsing/creation. Prediction/transformation/
  production activity types deliberately not started — see **Grammar
  production ladder** below.

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

Ordered by value. Detail/rationale for each in `docs/STATUS.md`'s "Open /
deferred" section and the notes below.

- [ ] **Review new-card backlog fix.** ~193 confirmed vocab words have no
  SRS card; the session planner is blind to the backlog (sizes the review
  bucket from existing due `study_items` only), seeds too slowly (only
  after the due queue drains, `newCardsPerSessionLimit`/session), and the
  `due_review_batch` step auto-settles at its `targetCount` before seeding
  starts. Fix: make the planner count the never-introduced backlog, reserve
  review-bucket minutes for a bounded slice of it, and fold that slice into
  the review step's `targetCount` so it doesn't auto-advance early.
  Actively undermines the core loop — do first. Related:
  `scripts/analyze-due-by-book.ts`.
- [ ] **Re-mine the 3 auto-caption-fragmented sources.** After Work, First
  Day at Work, GLIM SPANKY were systemically mis-segmented (pre-2026-08-23,
  auto-captions, no punctuation). The ASR pipeline + `ResegmentSourcePage`
  + audio carry-across now exist; this is mostly mechanical. Content
  quality on material studied daily.
- [ ] **Cross-sentence shadowing learner profile.** The one open Phase 9
  milestone (brief's Phase 15). Aggregate the per-sentence pronunciation/
  timing/pitch-accent signal already captured into a durable profile —
  "you consistently short っ", "odaka words are your weak accent class",
  "word-pace improving over 3 weeks" — so feedback becomes cumulative
  instead of per-attempt. Synthesis of data already logged; inherently
  explainable.
- [ ] **Grammar production ladder.** The grammar system stops at
  recognition (`grammar_comprehension`/`completion`/`contrast`) while the
  vocab side has a real production ladder. Add a produce-a-sentence-using-
  this-pattern drill (Build-mode-adjacent), gated on the pattern reaching
  `distinguished`. Closes a visible asymmetry. Bigger build.

### Smaller / opportunistic

- [ ] **Audio-less pitch-accent production drill.** Practice pitch accent
  on Satori-imported sentences that have no reference audio, using
  `VocabularyItem.pitchAccentPositions` + the learner's own alignment
  (which is all `pitchAccentObservations.ts` already needs). Extends a
  strong feature to the majority of the corpus. Distinct from the shipped
  passive `pitch_accent` SRS card.
- [ ] **`comprehension` vs `reading_in_context` differentiation.** Open
  since Phase 4 — the two still share one interaction. Give each a distinct
  UI (e.g. `reading_in_context` shows surrounding chapter context). Low
  urgency; current behavior works.
- [ ] **Retention / progress-over-time view.** One honest "how am I doing"
  screen — words learned over time, retention rate, grammar patterns
  matured, shadowing trend — from the evidence data already logged. Home's
  14-day balance meters are the only aggregate view today. Deliberately
  minimal (dedicated debug/diagnostic views have been declined before).

## Not planned (deliberate)

- No export-back-to-Anki path; migration away from Anki was one-way.
- No Anki review-history migration — FSRS starts from zero prior signal for
  pre-app words (permanent, accepted).
- **PASQA** speech-quality model — investigated, architecture left ready,
  blocked on PyTorch + s3prl footprint on the memory-constrained analysis
  host.
- "Which words share a reading" kanji drill (reverse of
  `KanjiDetailPage`'s current view) — not built, low value.
