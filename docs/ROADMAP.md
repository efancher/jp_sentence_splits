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
  5. **Difficulty screening checkpoint** (folds in the 2026-09-13 heuristic-
     grading idea) — a show's RSS metadata is only a title/description, no
     Japanese body text, so an episode can't be graded before it's mined;
     the real checkpoint is right after the wizard's **Transcript** stage
     produces real text (caption or ASR), before spending time on
     Segment/Translate/Commit. A small shared utility — tokenize with the
     existing UniDic pipeline, score % JMDict `common: true` lemmas +
     average sentence length (+ morae/second from ASR word timings when
     available) — surfaced as a rough "looks beginner/intermediate/
     advanced" readout on that stage, so a too-hard episode can be
     abandoned early. Not podcast-specific: the same utility slots into
     YouTube mining's Transcript stage and the future NHK Easy import for
     free, so build it as one shared function rather than three copies.
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

- [ ] **"Ready to read" difficulty/coverage scoring.** (2026-09-13,
  promoted from "Possibilities" below) The direct answer to "I have several
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
  3. **Feed `findExploreCandidates`** (session planner's `continue_book`
     candidate ranking) with the same coverage number as a secondary sort
     key, so an easier caught-up book edges out a harder one when neglect
     scores are close — a light touch on top of the existing vocab-first
     gating, not a rewrite of it. **Not done** — deferred; `BooksPage`'s
     manual sort already answers "which book is easiest" for a learner who
     asks, and the planner already has its own vocab-readiness gate, so this
     is a nice-to-have ranking nudge, not a gap.
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
- [x] **"Ready to read" coverage** — promoted to "Planned" 2026-09-13 as
  "'Ready to read' difficulty/coverage scoring," see above.
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
