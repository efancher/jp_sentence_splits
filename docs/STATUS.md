# Status

Current-state snapshot. For the chronological blow-by-blow (files touched,
test counts, code-review findings, production-run logs) see
`docs/STATUS_ARCHIVE.md` and git history. For the feature-oriented
reference see `docs/AI_OVERVIEW.md`; for the at-a-glance phase list see
`docs/ROADMAP.md`.

Last updated: 2026-09-02.

## Where things stand

The original roadmap (Phases 0–9) is complete. All numbered phases plus
the later standalone efforts (Learning Orchestrator, re-segmentation,
vocabulary glossing, WaniKani mnemonics, contextual conjugation cards,
progressive listening, grammar-learning system incl. `grammar_production`)
are shipped and, in almost every case, verified against production data by
the user directly. ~1117 TS tests, green.

**2026-09-01 pass** (see Recent changes): planner new-card-backlog
awareness, cross-sentence pronunciation profile (`/pronunciation`, closes
Phase 9's last milestone), grammar production ladder (`grammar_production`),
`reading_in_context` passage framing (closes the Phase 4 differentiation
gap), the retention/progress screen (`/progress`), the audio-less
pitch-accent drill (`/pitch-accent`), and a ROADMAP compaction. Only
remaining planned work: re-mine "After Work" (browser + human review).

**Mining pipeline v2** — slices A/B/C + wizard W1–W6 landed 2026-08-31;
what's left is one deferred durability item (below).

## Recent changes

(New detail lands here; swept into `STATUS_ARCHIVE.md` next time this file
is trimmed.)

- **2026-09-02 — VocabularyPicker flags selections with no meaning on
  confirm.** A blank `english`/meaning doesn't get a review card filtered
  from the queue (unlike the gate-cards-missing-support cases) — it just
  produces a quietly degraded card, so it was slipping through. The picker
  now shows an inline "No meaning set" marker per `SelectedCard` and folds a
  dismissible line into the existing pre-save heads-up `window.alert`
  (non-blocking, same as the combined-expression warning — a gloss comes
  from the AI or a later backfill script, so blank is a normal transient
  state, not an error to hard-block on like a missing dictionary
  expression). `selectionNeedsMeaning(pos)` in `vocabularySuggestions.ts`
  scopes the check: content words and POS-less "Add blank" selections need a
  gloss; particles/auxiliaries (助詞/助動詞) you deliberately added don't.
- **2026-09-02 — `word_listening` card: audio cloze, not isolated word.**
  Tier 1 of the listening ladder was "loop just this word's audio span,
  recall its reading/meaning" with all text hidden. Two problems the user
  hit: for a short high-frequency word in a grammatical frame (いい in
  `なんて呼んだらいい？`, the `〜たらいい` pattern) recognising it from a
  2-mora vacuum isn't a real skill; and when forced alignment couldn't
  isolate the span the card silently degraded to bare whole-sentence
  playback with a now-meaningless "recall the word on its own" prompt.
  Reworked into the listening analog of `cloze`, staged like `listening`:
  (1) whole clip plays, text hidden; (2) "Reveal sentence" shows the
  sentence with the target occurrence blanked (`_____`) + its
  translation as the constraint, recall from sound + context — the
  isolated-word loop (`SegmentLoopPlayer` new `wordOnly` prop, renders
  nothing when it can't isolate) sits here as optional scaffolding, not the
  test; (3) "Reveal answer" → word/reading/meaning/dict-form, self-rate.
  `WordListeningCard` now takes the shared `audioSpeed` state
  (`onReplay`/`playbackRate`/`onPlaybackRateChange`) like
  `AudioComprehensionCard`. Candidate generation, the tier-1 reading-
  proficiency gate, and the tier-2 `getSentenceListeningReadiness` gate are
  all unchanged. `reviewPage.test.tsx` word_listening tests updated to the
  new two-step reveal; 1135 TS tests green.
- **2026-09-02 — Pitch-accent card: audio-first, drop-position.** The
  `pitch_accent` SRS card no longer asks "which of heiban/atamadaka/
  nakadaka/odaka" — a 25–50% guess for an un-memorised fact, with the
  native clip only offered after answering. It now plays the native word
  first (`PitchAccentNativeAudio` moved above the question) and asks
  **where the pitch falls** — choices `0..moraCount`, each drawn as a whole
  contour in NHK/OJAD textbook notation (`PitchChoiceContour`: overline over
  the high morae dropping at the downstep, trailing particle dot) with a
  numbered caption ("Stays high (no fall)" / "Falls after mora 2" / …). This
  puts the ear before the metalabel and fully specifies the contour: a
  4-mora word now distinguishes a fall after mora 2 from mora 3, which the
  category card collapsed into one "nakadaka" answer.
  `getPitchAccentReviewCandidates`
  drops the pattern-shuffle; `PitchAccentReviewCandidate` carries `morae` +
  `correctPosition`. `onCheck` passes chosen/correct positions as strings,
  so a wrong drop point still classifies as `pronunciation_difficulty`.
  Reveal unchanged (`PitchAccentDiagram` + `SentencePitchAccentRow` +
  `explainPitchAccent` + category name). Eligibility unchanged (dictionary
  `pitchAccentPositions` + reference `SentenceAudio`). `possiblePitch-
  PatternsForMoraCount` is now unused by the card but kept (still
  unit-tested).
  Also: `SentencePitchAccentRow` now renders on **every** sentence-bearing
  review reveal (one shared insert before the rating buttons), not just the
  `pitch_accent` card — excluded only for `pitch_accent` itself (renders its
  own highlighted copy) and `sentence_transformation` (its verb is
  inflected; the row draws the citation-form contour). `/words`
  (`VocabularyListPage`) shows a `PitchAccentDiagram` under the reading for
  entries with dictionary data. `reviewPage.test.tsx` pitch tests rewritten.

- **2026-09-02 — Pitch-accent card: citation form only.** From a card
  issue report (`ござる` tested against `ありがとうございます。` audio):
  `getPitchAccentReviewCandidates` now skips any occurrence whose surface
  form isn't the dictionary form. The choices and ✓/✗ key off the
  dictionary reading's morae and downstep, so an inflected occurrence
  (`速く` for `速い`, `ございます` for `ござる`) makes the looped native audio's
  mora count and accent disagree with the "correct" answer — unanswerable
  by ear. A kana/kanji spelling difference for the same citation form is
  still allowed (matched via the in-context reading where `inlineReading`
  is present). Same principle as the `sentence_transformation` exclusion
  from `SentencePitchAccentRow`. `reviewPage.test.tsx`: +1 test.

- **2026-09-02 — Review: bury siblings for the session.** `ReviewPage`'s
  queue build now keeps at most one due card per `subjectType:subjectId`
  when that card is in the stable `review`/`relearning` state — the other
  due siblings (e.g. a word's `cloze` + `reading_production` alongside its
  `reading_retrieval`) are held for the next session rather than shown back
  to back. Graded alike each session they converge on near-identical FSRS
  due timestamps and sort adjacently, so the first card's reveal was
  turning the rest into a short-term echo test and inflating their
  intervals (Anki's default "bury siblings" behaviour). `new`/`learning`
  items are exempt — early-acquisition repetition is intended scaffolding,
  and the lazy-seed path still introduces a whole activity-type batch at
  once. Sessions can now run a little short of `targetCount` when the due
  set is sibling-heavy; the step just doesn't auto-settle (existing
  "not enough due" behaviour).

- **2026-09-01 — Import preview: conflict detail.** `ShadowingPreviewCard`
  now renders a collapsible list of the sentences whose repeated occurrences
  disagreed (kept value vs. dropped alternative, per field) instead of only
  the bare "N conflicting value(s)" pill — the shadowing-zip and mining
  commit stages share the card. Display-only; resolution is unchanged (first
  occurrence wins, edit post-import). `shadowingImport.test.ts` +1.

- **2026-09-01 — Mining wizard: chunked commit.** The commit stage's single
  `POST /jobs/{id}/commit` carrying every reviewed row (383 on a long video)
  ran ffmpeg serially past the tailnet proxy's response timeout — the browser
  surfaced a bare "Load failed" and the wizard never left the Translate
  stage. `commitMiningJob` now sends rows in batches of `COMMIT_CHUNK_SIZE`
  (30), accumulating into the same result (`commit_job` is incremental —
  appends to `Job.clips`, bumps `next_sentence_seq`), and calls `onProgress`
  after each batch so the wizard shows "Clipping sentences… N/total".
  Server-side, `commit_job` probes the constant source duration once instead
  of once per row (hundreds of redundant ffprobe spawns). `miningApi.test.ts`
  +1, `youtubeMine.test.tsx` +1 assertion. Server change needs redeploy on
  codex-dev to take effect; the client chunking alone fixes the hang.

- **2026-09-01 — Mining wizard: "Translate with AI help".** The Translate
  stage now has a copy/paste panel mirroring the transcript stage's "Segment
  with AI help": `formatRowsForTranslationAI` emits every sentence numbered
  with its current draft (`current: …` / `(none)`), `parseAiTranslations`
  reads a numbered `N. english` reply back by line number — fills blank rows
  and replaces weak/mis-scoped drafts, leaving rows the reply skipped
  untouched (all flagged `needsTranslationReview`). No Edge Function, for
  when the in-app "Auto-fill translations (AI)" isn't enough or the deploy
  key is unavailable. `src/lib/miningTranslate.ts` +
  `src/components/TranslateAiHelp.tsx`; `miningTranslate.test.ts` +8,
  `youtubeMine.test.tsx` walk-through +1 assertion block.

- **2026-09-01 — Mining jobs: disk checkpoints + cross-machine resume.** A
  job whose transcription ran past the 6h `JOB_TTL_SECONDS` was swept
  overnight (age from `created_at`, never bumped) — the next morning's
  "Apply & segment" 404'd with "Job not found". Fixed: (1) `JOB_TTL_SECONDS`
  is now an *idle* TTL — every client request bumps `Job.touched_at`, a job
  polling in an open wizard never ages out, and a job still mid-pipeline is
  never idle-swept (only the new `JOB_HARD_TTL_SECONDS`, 48h, reaps a wedged
  one). (2) `jobs._write_checkpoint` persists each stage transition to
  `JOBS_ROOT/checkpoints/<id>/` (state JSON + a copy of the subtitle tracks;
  source audio re-pulled from `source_cache` / lazily re-downloaded via
  `_ensure_source_audio`). `get_job` rehydrates from the checkpoint when the
  in-memory job is gone (restart *or* idle sweep), so the same job resumes
  after a process bounce. (3) `GET /jobs` lists resumable jobs (memory +
  checkpoints); `POST /jobs` reconnects to an existing non-errored job for
  the same URL/video instead of starting a duplicate mine. Wizard idle
  screen shows a "pick up an import already in progress" list
  (`listMiningJobs`) so a transcription kicked off on one device is finished
  on another; `ytmine.activeJob` local pointer max-age 6h → 48h.
  `test_jobs_api.py` +4, `youtubeMine.test.tsx` +1.

- **2026-09-01 — Mining: services retuned + "Segment with AI help".** A
  32-min Nakata source hit the mining client's 1800s ASR timeout and fell
  back to punctuation-free auto-captions — the word-timestamp DTW pass in
  `faster-whisper` is single-threaded Python and ~tripled the run on this
  4-core box. Fixed at the deploy layer: `ANALYSIS_SOURCE_WORD_TIMESTAMPS=0`
  on `shadowing-analysis-api` (the real speedup; wizard waveform editor +
  char-proportional split cover the loss) and `MINING_ASR_TIMEOUT_SECONDS=3600`
  on `youtube-mining-api` (both in the systemd units +
  `server/youtube-mining/deploy/`). Plus a **"Segment with AI help"**
  collapsible on the wizard's transcript stage: `formatTranscriptForAI`
  emits a `[m:ss] fragment` prompt to paste into any assistant,
  `parseAiSegmentedTranscript` reads the `[m:ss] sentence` reply back into
  `WizardTranscriptSeg[]` (manual copy/paste, no Edge Function).
  `miningTranscript.test.ts` +6. Also `deleteBookCascade`-equivalent
  soft-deletes run against production for "After Work" (172 sentences) and
  "GLIM SPANKY" (20) — vocab-level study items kept, sentence-level dropped
  per the user's call.

- **2026-09-01 — Mining wizard: resume on refresh + elapsed-time progress.**
  The wizard held the job id in React state only and deleted the job on
  unmount, so a refresh / phone tab-unload lost a 20-min mine. Now a
  `localStorage` `ytmine.activeJob` pointer (ignored past the server's 6h
  TTL) rehydrates on mount by the job's server-side `stage`; the unmount
  delete is gone (TTL sweep + explicit Start-over/Cancel/finish cover
  cleanup). Job gains `message_started_at` / `set_message` and the status
  response an `elapsedSeconds` → the "starting" panel shows a live `N:NN
  elapsed` + soft per-step ETA (transcription scales with video length) +
  a "you can leave this page" note. Both services redeployed.
  `test_jobs_api.py` +1 assertion, `youtubeMine.test.tsx` +1.

- **2026-09-01 — Audio-less pitch-accent production drill.** The
  `pitch_accent` SRS card and the shadowing analysis both need a
  `SentenceAudio` reference; `buildPitchAccentShapeObservations` never did
  (it scores the learner's realized contour against the Kanjium/UniDic
  dictionary shape from `VocabularyItem.pitchAccentPositions` using only
  the learner's own forced alignment + pitch). New
  `getPitchAccentDrillSentences` (`repository.ts`) — Satori sentences with
  a confirmed pitch-accent-bearing `sentence_vocabulary` link, **no**
  `SentenceAudio`, and passing `getSentenceFullReviewReadiness` (same
  vocab-confirmed-and-proficient gate as `findShadowCandidates`, per the
  vocab-before-glossing stance) — and `PitchAccentDrillPage`
  (`/pitch-accent`, Home shortcut row): shows the sentence + its dictionary
  `SentencePitchAccentRow` contour, records via `useShadowing`, calls
  `alignAudio` + `extractPitch` directly (no `Attempt`/cache — the take is
  ephemeral), and renders the per-word mismatch observations. Non-SRS
  practice loop, walks the list in reading order, nothing saved or
  scheduled. `pitchAccentDrill.test.ts` (5), `pitchAccentDrillPage.test.tsx`
  (2). Not browser-verified (no mic/AudioContext in the sandbox).

- **2026-09-01 — Retention / progress-over-time view.** Home's 14-day
  balance meters were the only aggregate view. New `/progress`
  (`ProgressPage`, in the AppShell nav + Home shortcut row) backed by
  `src/lib/progressReport.ts` (`buildProgressReport`, pure): vocabulary
  ladder counts (tracked / proficient / mature / first-recalled in the last
  30d — "learned" moment = the earliest passing review across a word's
  activities), FSRS recall-success rate (rating ≠ Again over scheduled
  reviews; 30d + all-time, natural encounters excluded), grammar
  tracked/recognized (`grammar_comprehension` proficiency), shadowing
  attempt count + timing/pitch trend (delegates to
  `getPronunciationProfile`), and an 8-week reviews-per-week +
  cumulative-words-learned trend rendered with the existing `.progress-bar`
  meter (no charting dependency — matches "deliberately minimal"). Every
  number recomputed on load from `Review`/`StudyItem`/`AttemptAnalysisSummary`
  rows; `getProgressReport` in `repository.ts` is the only fetch.
  `progressReport.test.ts` (7), `progressPage.test.tsx` (2). Not
  browser-verified.

- **2026-09-01 — `reading_in_context` vs `comprehension`.** Open since
  Phase 4 — the two sentence-subject activity types shared one interaction.
  `reading_in_context` now embeds the sentence in its passage:
  `src/lib/readingContext.ts` (`buildReadingContextMap`, pure) resolves each
  in-scope sentence's reading-order neighbours within its home book (most
  recently opened book containing it, `Book.lastOpenedAt`); `ReviewScope`
  carries `readingContextBySentenceId`, the sentence descriptor's `buildCard`
  attaches it for `reading_in_context` only, and a new `ReadingInContextCard`
  shows the preceding sentences untranslated above the target (scene without
  spoiler), folds the following sentence's translation into the reveal, and
  captions "In context · <book>". No context available (inbox-only sentence,
  or book-scoped queue whose neighbours aren't loaded) → falls back to the
  isolated layout. `comprehension` unchanged. `readingContext.test.ts` (5),
  `reviewPage.test.tsx` +1. Not browser-verified.

- **2026-09-01 — Grammar production ladder.** The grammar review system
  had only recognition cards (`grammar_comprehension`/`grammar_completion`/
  `grammar_contrast`) while the vocabulary side has reading→production. New
  `grammar_production` activity type (subjectType `grammarPattern`, global
  scope, in `PRACTICE_ACTIVITY_TYPES`): shows the pattern's meaning, takes a
  free-form sentence, reveals a model (`pickContextSentenceForGrammarPattern`
  — one of the learner's own tagged encounters) to self-rate against.
  Eligibility: only a tracked pattern whose `grammar_comprehension` item is
  FSRS-proficient (learner state `recognized`+) — production comes after
  recognition. Lazily seeded by the generic pending-seed pool once a pattern
  crosses that bar, like `grammar_contrast`. `grammarPatternUsedIn`
  (`src/lib/grammarPatterns.ts`) is a weak "did you use the construction"
  hint on reveal (every wave-dash fragment present); meaning/naturalness
  stay the learner's call, so it's self-rated with no `expectedAnswer` →
  `classifyReviewError` leaves it unclassified. `GrammarLearnerState`
  unchanged for now (no `productive` rung — `distinguished` already needs a
  relationship, so ordering is awkward; deferred). `grammarPatterns.test.ts`
  +5, `reviewPage.test.tsx` +2. Not browser-verified.

- **2026-08-31 — Cross-sentence pronunciation profile.** Closes Phase 9's
  one still-open milestone (brief's Phase 15). `src/lib/pronunciationProfile.ts`
  (`buildPronunciationProfile`, pure) aggregates every `AttemptAnalysisSummary`
  across all sentences into a recurring-focus-area ranking (which
  `primaryIssueKind` leads most often, over how many distinct sentences,
  with an improving/worsening/steady trend from the recent vs earlier half)
  plus overall timing/pitch trend lines and a one-line headline.
  `getPronunciationProfile({ sinceDays })` in `repository.ts`; new
  `PronunciationProfilePage` at `/pronunciation` (All-time / 30d / 90d
  window select), linked from Home's shortcut row and ShadowPage's "Past
  attempts" header. Built only from severities, which are already
  per-speaker-normalized upstream (pitch register scored 0), so nothing
  compares absolute pitch/loudness across speakers. `pronunciationProfile.test.ts`
  (8). Not browser-verified.

- **2026-08-31 — Planner: new-card backlog awareness.** The session
  planner was blind to confirmed vocabulary that has never been introduced
  to the SRS (no `vocabularyItem` study item) — it sized the review bucket
  from existing due `study_items` only, so a large first-review backlog lost
  its minutes to glossing and the `due_review_batch` step auto-settled
  before ReviewPage ever seeded a new card. Now `countNewVocabularyCardBacklog()`
  (`repository.ts`) feeds `SessionPlannerInput.newCardBacklogCount` /
  `newCardsPerSessionLimit`; `buildRecommendedSession` reserves
  `min(backlog, limit)` retain-costed minutes in the review ceiling, folds
  that slice into the review step's `targetCount` + label ("Review N due +
  introduce M new"), and adds an explanation line. `ReviewPage.handleRate`
  also holds the review step open (no auto-advance) while the pending-seed
  pool still has never-introduced words and the per-session cap isn't hit,
  since `targetCount` undercounts them (one increment per word, ~3 cards
  seeded). `sessionPlanner.test.ts` +3, `sessionPlannerRepository.test.ts`
  +1. Docs/ROADMAP compacted + Planned section added the same pass. Not yet
  browser-verified. Backlog still drains at `newCardsPerSessionLimit`
  (default 20) per sitting by design.

- **2026-08-31 — Mining: JMnedict proper-noun reading cross-check.**
  `morphology.tokenize_japanese` consults a shipped ~220k-name table
  (`app/data/name_readings.json.gz`, built by `npm run build:name-readings`
  from JMnedict — person names with exactly one reading) and overrides a
  固有名詞 token's reading when UniDic-lite disagrees, dropping the stale
  UniDic accent (Kanjium fills it post-hoc). `MINING_NAME_READING_CHECK=0`
  off. Closes the last slice-B item. `test_morphology.py` +3 → 73 py.

- **2026-08-31 — Mining wizard deferred polish.** (1) `POST /jobs/{id}/commit`
  clips every reviewed row in one request with audio inline (base64) — the
  wizard's commit stage was a per-row clip+fetch loop. (2) `POST
  /source-audio/range` streams one span of a cached source; `/books/:id/resegment`
  now shows the boundary-drag waveform when the book has a `sourceUrl`
  (`ResegmentSourceContext.sourceUrl` → `fetchSourceAudioRange`). (3) Per-row
  `SpanAudioButton` on the segment + translate stage rows. (4) The
  translate stage's "Auto-fill (AI)" groups rows by transcript-segment
  provenance (`buildMiningRealignGroups`) instead of one whole-span group.
  `test_jobs_api.py`/`test_source_cache.py` +2, `miningApi.test.ts` +2,
  `resegmentPlan.test.ts` +1. 70 py / ~1074 ts. Redeployed. Still not
  browser-verified.

- **2026-08-31 — Pitch-accent H/L marks on the sentence.**
  `src/lib/sentencePitchAccent.ts` (`buildSentencePitchAccents`) +
  `src/components/SentencePitchAccentRow.tsx` render a per-word
  high/low-per-mora contour ("H"/"L" letters under the kana, plus a
  following-particle mark) for the confirmed sentence vocabulary that
  carries Kanjium/UniDic accent data. Deliberately per-word, not a joined
  sentence contour (no compound/cross-word accent computation — same
  stance as `pitchAccentRules.ts`); particles and dataless words are left
  unmarked, and the row renders nothing when a sentence has no accented
  words. Wired into `SyncedShadowText` (ShadowPage + guided
  ProgressiveShadowingPanel), `AnalysisPanel`'s pitch-accent section, and
  the `pitch_accent` review-card reveal (highlighting the card's target
  word). `tests/sentencePitchAccent.test.ts` (4). Not browser-verified
  (no browser libs in the sandbox) — typecheck/lint/build/1071 tests green.

## Phase completion

| Phase | State |
|---|---|
| 0 — Repository analysis | done |
| 1 — Unified data model | done, verified; migration live 2026-08-13 |
| 2 — Existing data migration | done (WK kanji catalog + one-time Anki import run against prod; JMDict scoped to a local lookup tool) |
| 3 — Unified shadowing | done; live overlay/analysis delivered later under Phase 8 |
| 4 — FSRS | done; real activity-type differentiation delivered under Phase 7 |
| 5 — Vocabulary/kanji relationships | materialization + browsing UI done; part 2 (JMDict backfill + retroactive materialization) run against prod 2026-08-15 |
| 6 — Anki interoperability cleanup | done; `efancher/anki` archived, no export-back planned |
| 7 — Adaptive learning | done, all slices 7.1–7.11, verified against prod |
| 8 — Shadowing feature parity | done, all slices 8.1–8.5, browser-verified |
| 9 — Shadowing pronunciation/prosody feedback | done, all 9 milestones + cross-sentence learner profile (2026-08-31) |
| Learning Orchestrator | done; daily-session model, vocab-confirm priority |
| Re-segment an existing source | done; run against "After Work" 2026-08-29 |
| Vocabulary meaning glossing | done; JMDict/JMnedict offline + `vocab-assist` Edge Function |
| WaniKani mnemonics | done, deployed 2026-08-29/30/31 (vocab + kanji + subject cache) |
| Contextual conjugation cards | done; migration live 2026-08-30 |
| Progressive listening (`word_listening`) | done 2026-08-30 |
| Mining pipeline v2 | slices A/B/C + wizard W1–W6 + polish + JMnedict reading check done 2026-08-31; one durability item deferred |

Phase-by-phase detail is in `docs/STATUS_ARCHIVE.md`; the ROADMAP entries
carry a one-paragraph summary each.

## Open / deferred

**Mining pipeline v2 — one item still deferred** (everything else —
wizard W1–W6, batch commit, per-row audio, resegment-page waveform,
provenance-grouped realign, JMnedict proper-noun reading check — landed
2026-08-31):
- Durability-only: a `source_audio` Supabase table + Storage mirror so the
  LRU source-audio cache can restore without re-hitting YouTube. Blocked on
  a decision — the Python service deliberately has no Supabase creds, so
  restore-from-Storage needs either a public read path or the client
  proxying the restore. (Recommendation on file: enable box-level backups
  of the cache dir instead; if building anyway, do upload-only and defer
  auto-restore.)

**Not yet browser-verified** (typecheck/build/tests green, and the sandbox
has no browser system libs):
- Mining wizard W1–W6 (covered by integration tests + build + typecheck).
- Contextual conjugation cards (`sentence_transformation` rework).
- Progressive listening `word_listening` cards.
- Cross-sentence pronunciation profile (`/pronunciation`).
- Planner new-card backlog reservation + ReviewPage seed-hold.
- Grammar production card (`grammar_production`).
- `reading_in_context` passage framing (`ReadingInContextCard`).
- Progress screen (`/progress`).
- Audio-less pitch-accent drill (`/pitch-accent`).

**Data / content backlog:**
- **Review new-card backlog** — ~193 confirmed vocab words have no SRS
  card. The planner fix landed 2026-08-31 (see Recent changes): the review
  bucket now reserves minutes for the backlog and the review step stays
  open through seeding, so ~`newCardsPerSessionLimit` new words enter per
  daily session instead of a handful. Still drains over multiple sessions
  by design; raise the limit in Settings to go faster. Diagnostic:
  `scripts/analyze-due-by-book.ts`.
- **Auto-caption fragmentation re-mine** — pre-2026-08-23 shadowing
  imports (After Work, First Day at Work, GLIM SPANKY) were systemically
  mis-segmented (auto-captions, no punctuation). Bulk re-mine through the
  new ASR pipeline is planned, not done.
- **Pitch-accent gaps** — after Kanjium + UniDic gap-fill, ~79
  `vocabulary_items` still have no `pitch_accent_positions`.
- **4 noun homograph pairs** left with two live readings each (何 なに/なん,
  羽 はね/わ, 話 はなし/わ, 後 あと/ご) — both valid; user is waiting to see
  if the duplication is annoying in practice before merging.

**Infra:**
- Mac Tailscale exit node for mining downloads still TODO (phone verified
  working 2026-08-30; datacenter mining box is YouTube bot-blocked, so
  downloads route through a personal-device exit node).

**Larger not-started items (deliberate, reasoning in the archive):**
- PASQA speech-quality model — architecture left ready; blocked on
  PyTorch+s3prl footprint on the memory-constrained analysis host.
- **Segmental pronunciation feedback** (ROADMAP "Planned") — Phase 9
  covers timing + pitch only; nothing tells the learner whether an
  individual sound (し / ら / ふ / つ / う vs. an English substitute) is
  right. Planned as one phase: a `reference` sound guide, a spectrogram
  overlay in `AnalysisPanel` (canvas FFT off the existing alignment
  cache), and an ASR kana-diff observation reusing the current
  faster-whisper signal. Gated on the user first doing phonetics-focused
  tutor sessions to produce a real per-user error list. No new speech
  model (same constraint as PASQA); no standalone perception quiz
  (conflicts with "skill over metalabel quiz"). Prompted 2026-09-02.

## Services

- `server/youtube-mining` (FastAPI, `systemctl --user`, this repo) — mining
  pipeline, `/resegment`, `/reclip`, source-audio cache, job wizard.
- `~/projects/shadowing-analysis-api` (separate repo, Hetzner box,
  `systemd --user`, tailnet-only via `tailscale serve`) — MFA forced
  alignment, `faster-whisper` ASR (`base` diagnostic + `large-v3-turbo`
  source transcription).
- Supabase — single shared project, table-prefix-isolated from the retired
  `shadowing` repo. Always soft-delete synced tables (`deleted_at`), never
  raw `DELETE`, or clients never learn of the change.
- Edge Functions — `grammar-assist`, `vocab-assist` (Claude Haiku).
