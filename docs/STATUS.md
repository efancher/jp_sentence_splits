# Status

Current-state snapshot. For the chronological blow-by-blow (files touched,
test counts, code-review findings, production-run logs) see
`docs/STATUS_ARCHIVE.md` and git history. For the feature-oriented
reference see `docs/AI_OVERVIEW.md`; for the at-a-glance phase list see
`docs/ROADMAP.md`.

Last updated: 2026-09-09.

## Where things stand

The original roadmap (Phases 0–9) is complete. All numbered phases plus
the later standalone efforts (Learning Orchestrator, re-segmentation,
vocabulary glossing, contextual conjugation cards,
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

- **2026-09-09 — Contextual conjugation cards had ~zero coverage (user
  report — "surprised I haven't seen any conjugation cards yet").**
  `getSentenceConjugationCandidates` was producing **0** candidates.
  `scripts/diagnose-conjugation-cards.ts` (new; `npm run
  diagnose:conjugation-cards`) shows the funnel. Two causes, both fixed:
  - **POS format.** `conjugationWordClassFromPartOfSpeech` only read
    JMdict tags (`v5r`, `v1`, `adj-i`…) but the mining pipeline writes
    UniDic POS (`動詞/一般`), so 558 of 631 surface-form occurrences were
    dropped. Three-part fix: (a) `conjugationWordClassFromPartOfSpeech` now
    also reads the AI glosser's English tags (`godan verb`…) and UniDic
    adjective POS (`形容詞…`/`形状詞…`); (b) new `inferConjugationWordClass`
    decides godan vs ichidan from an inflected surface / the sentence when
    the tag alone can't — `materializeVocabularySelections` (the confirm
    path) calls it and stores a synthetic `v5k`/`v1`/… tag, so a
    newly-mined verb needs no backfill; (c)
    `scripts/backfill-vocabulary-jmdict-pos.ts` (new; `npm run
    backfill:vocabulary-jmdict-pos`) retags the *existing* rows from a
    confident JMdict match. Applied 2026-09-09: 224 items retagged.
  - **Truncated surface forms.** The picker stores the content morpheme
    UniDic segmented, dropping the trailing auxiliary (`言い` for `言いました`,
    `飛ん` for `飛んで`). New `findInflectedSurfaceInSentence`
    (`src/lib/conjugation.ts`) recovers the full single conjugated form
    from the sentence — used both at read time in
    `getSentenceConjugationCandidates` (accepts it only when it extends the
    stored stem and doesn't continue into an auxiliary —
    `CONTINUES_INTO_AUXILIARY`, so `待っ`→`待っている` stays un-quizzed) and
    by `scripts/fix-truncated-surface-forms.ts` (new; `npm run
    fix:truncated-surface-forms`) which repairs the stored value for the
    other surface-form cards. Applied 2026-09-09: 85 links repaired.
  - Result: conjugation candidates 0 → **86** across 71 sentences. Most
    are still held by the deliberate full-sentence readiness gate
    (`getSentenceFullReviewReadiness` — vocab confirmed + every sentence
    vocab FSRS-proficient); they surface as vocabulary matures. Tests +18
    (`conjugation.test.ts`, `reviewPage.test.tsx`, `data.test.ts`).

- **2026-09-09 — Vocabulary picker smarter about what it default-checks
  (recommender polish, same discussion).** Two `selectedByDefault` filters
  in `src/lib/vocabularySuggestions.ts`, both leaving the chip visible (one
  tap to add), both forward-only (re-run `backfill:vocabulary-suggestions`
  to refresh older unreviewed sentences):
  - `isBoundAuxiliaryVerb` — the いる/くる/しまう/おく/みる/くれる in
    〜ている / 〜てくる / 〜てしまう … is UniDic `動詞/非自立可能` (content
    POS) so the old default checked it; now unchecked when it's glued to a
    preceding て/で. Standalone いる・する・できる and サ変 する (世話をする,
    particle is を) unaffected.
  - `isKanaWrittenFormalNoun` — こと/はず/つもり/わけ/ため/ところ/ほう/よう/
    まま/ふり unchecked when *this occurrence* is written in kana (the
    grammatical use — 〜ことがある, 〜はずだ, 〜たところ). Written with their
    kanji (事/訳/為/所/方/用) they're taken as ordinary nouns. `GrammarPicker`
    owns the constructions.
  - `CONTENT_POS_PREFIXES` gained `形状詞/一般` + `形状詞/タリ` — modern
    UniDic's na-adjective tag (色々, 綺麗, 大変, 元気), which the old list
    (`形容動詞`, the pre-UniDic term) missed entirely, so na-adjectives
    were never default-checked. `形状詞/助動詞語幹` (the そう/よう stems)
    stays excluded.
  - Side effect (intended): `selectedByDefault` also feeds the `/progress`
    "vocabulary blind spots" count (`getBlindSpots`), so `ている`-`いる` and
    kana `こと`/`はず` drop off it while na-adjectives now appear.

- **2026-09-09 — `reading_retrieval` / `reading_production` skipped for
  all-kana words (user request, follow-on from the conjugation work — "type
  the reading doesn't make sense for kana words").** A word whose
  dictionary form has no kanji (する, わかる, テレビ, いい) has no reading to
  recall — those two cards degenerate into copying the on-screen kana. The
  `vocabulary` descriptor's new `activityIsReady` (`containsKanji`,
  `src/lib/kanji.ts`) seeds only `cloze` for such words; conjugation /
  `word_listening` / contrastive are unaffected. Existing kana-word reading
  study items just stop surfacing (not deleted; their proficiency still
  counts toward sentence readiness). This removes the reason to avoid
  gathering high-frequency kana verbs/adjectives as vocabulary — which is
  the *only* path to a conjugation card for them (grammar tracking builds
  `grammar_pattern` rows, never `sentence_vocabulary` links).
  - `MeasuredPitchContour` (top-of-page native contour) drew over the whole
    clip, so a reference with leading/trailing room tone squashed the line
    into a few pixels ("three brief lines"). Now crops the x-axis to
    `voicedTimeSpan` like `PitchCanvas`, remaps the playhead into that
    window, and takes an optional `height` — ShadowPage renders it at 64px.
  - `AnalysisPanel` blanked *both* reference and learner pitch contours (and
    the waveforms) whenever one clip failed — an older attempt in a codec
    the current browser's `decodeAudioData` rejects would take the whole
    analysis down. Reference/learner decode + `analyzeAlignment` are now
    isolated: each side shows its own "couldn't read this on this device" /
    "too little voiced sound to plot" note and the good side still renders.
  - `tests/measuredPitchContour.test.tsx` rewritten with real frame
    timestamps + a voiced-span-crop case (+2). Suite 1267.

- **2026-09-09 — `ShadowPage` collapsed to close-shadow + record/analyze
  (user request — "I pretty much always just use the close shadow looping
  and the main record and analyze").** The standalone 5-stage
  guided/progressive practice panel (Listen → Pause&Repeat → Delayed
  Shadow → Close Shadow → Record&Compare) is gone, along with the
  free-form "Delayed shadow" + delay-picker and the "Shadow mode"
  checkbox. New single-page layout:
  - **Reference player** (unchanged) — audio, playback speed, Mark
    start / Mark end / Loop target.
  - **Close shadow** panel — just the hands-free "Loop shadow reps"
    toggle + live waveform + rep counter, and Hear-that-back / Compare
    for the last (ephemeral, never saved) rep.
  - **Record & analyze** panel — Calibrate mic, one plain Record toggle,
    save/discard, then the unchanged Past-attempts list with inline
    `AnalysisPanel`.
  - **Live loop tweaks** — playback speed *and* the target range can be
    changed while the loop runs (`ShadowingController.updateShadowLoop`
    → `ShadowReferencePlayer.setPlaybackRate` / `seek`; `startShadowLoop`
    gained a `range` option and `tickShadowLoop` wraps a sub-range back
    to its start without waiting for the clip's real end). No stop/restart,
    so the iOS-safe "gesture-gated setup once" property is preserved.
    Follow-up (2026-09-09): the loop stuttered at slow speeds — worse the
    slower the rate, compounding on every `loop=true` wrap. Root cause: in
    loop mode `ShadowReferencePlayer.start` captured the reference `<audio>`
    into the shared `AudioContext` (`createMediaElementSource`), and Chrome's
    real-time `preservesPitch` time-stretch of a slowed element starves when
    pulled through the graph at the fixed callback cadence. Fix: loop mode now
    plays the reference as a **bare element** (no `createMediaElementSource`)
    — the same path as the stutter-free non-loop reference player; the shared
    context still owns the mic analyser, so it's not a "second context". The
    earlier `pendingPlaybackRate` deferral (its premise gone) was reverted —
    `updateShadowLoop` applies a speed change immediately again.
  - Deleted `ProgressiveShadowingPanel.tsx`, `useProgressiveShadowing.ts`
    and their two test files. `Attempt.practiceStage` /
    `practiceSessionId` (only the old final-stage save set them) are left
    in the schema — harmless optional fields, one planner test still
    exercises `practiceStage: 'final'`. `tests/shadowing.test.ts` +2
    (range loop, `updateShadowLoop`); `tests/shadowPage.test.tsx` swaps
    the delayed-shadow / shadow-mode assertions for a close-shadow one.
    Suite green (1265).

- **2026-09-08 — Analytics pass 1: blind spots, error mix, shadowing→SRS
  bridge (user request — "measuring my performance / directing my learning
  / cards & shadowing don't reinforce each other").** Two new read-mostly
  panels on `/progress` plus the first link between the local-only
  shadowing world and the synced SRS world. All the aggregation is pure
  (`src/lib/blindSpots.ts`, `src/lib/errorMix.ts`,
  `buildShadowingWeakWords` in `pronunciationProfile.ts`), evidence-only,
  nothing seeded/stored — same shape as `progressReport.ts`.
  - **Blind spots** (`getBlindSpots`) — vocabulary (tokenizer `morphology`
    suggestions that start checked + Satori `satori` suggestions +
    `targetVocabulary` chips) and grammar (the `worth_learning_now`
    priority bucket) that recur (≥`BLIND_SPOT_MIN_SENTENCES` = 2 sentences)
    across books the learner has actually worked (≥1 non-`unstarted`
    `BookSentence`) but were never confirmed / tracked. Distinct from the
    new-card backlog (words already picked, not yet reviewed). Vocab rows
    deep-link to that sentence's `VocabularyReviewPage`; the grammar row to
    `/grammar`.
  - **What to work on** (`getErrorMix`) — aggregates
    `Review.errorClassification` (written by `classifyReviewError`, until
    now only visible as raw JSON on `StudyItemDebugPage`) into a ranked
    breakdown: each category has a count, a share-of-classified, a
    recent-vs-earlier trend, and a next-action label + optional route
    (`incorrect_reading` → `/review`, `grammar_misunderstanding` →
    `/grammar`, `pronunciation_difficulty` → `/pitch-accent`, …). A
    30d/90d/all window toggle. Reports `unclassifiedAgainCount` separately
    as a hedged footnote (self-rated `again`s can't be broken down). A
    **Pronunciation** block folds in the shadowing side — the pronunciation
    profile's top focus area + specific weak words.
  - **Shadowing → SRS bridge.** `recordShadowingEncounter(sentenceId)`
    (`repository.ts`, mirrors `recordNaturalEncounter`): a `better`/`same`
    A/B rating on a shadow attempt in `ShadowPage` logs **one**
    `natural_encounter` review (rating `good`) against the sentence's
    `reading_in_context` study item — **only if that item already exists**
    (never creates one — that would bypass the passage-readiness gate), and
    deduped so re-rating a take (or rating several takes in one sitting)
    can't ratchet the interval past the next scheduled review. Scoped to
    the sentence card only, never the word cards, so the schedule impact is
    one row per shadowed sentence. Recommendation on file was "yes but
    tightly scoped"; user chose to ship it.
  - **Per-word weakness signal.** `AttemptAnalysisSummary` gained an
    optional local-only `wordIssues` array (no Dexie bump — same
    free-optional-field precedent as `Attempt.practiceStage`);
    `AnalysisPanel` fills it from pitch-accent shape observations (which
    now carry a `subject` = surface form on `TimingObservation`).
    `buildShadowingWeakWords` aggregates across attempts (≥2 flagged) into
    the words named in the error-mix pronunciation block. Wiring these into
    the pitch-accent drill's ordering was deferred (the drill
    `seededShuffle`s its list) — see ROADMAP "Possibilities".
  - Tests: `tests/blindSpots.test.ts` (new, +6), `tests/errorMix.test.ts`
    (new, +6), `tests/pronunciationProfile.test.ts` (+3
    `buildShadowingWeakWords`), `tests/data.test.ts` (+3
    `recordShadowingEncounter`), `tests/progressPage.test.tsx` (+2). Suite
    green (1282).
  - **Follow-up same day (user):** the bridge now **also fires from the
    computed analysis** — when `AnalysisPanel`'s server alignment produced
    signal and both `timingSeverity` and `pitchSeverity` came back below
    `SHADOW_ENCOUNTER_MAX_SEVERITY` (0.2), it calls the same
    `recordShadowingEncounter` (deduped, so it can't double-count with the
    A/B path). The A/B "Better"/"Same" tap stays as the fallback for when
    the alignment service is unreachable. User's reasoning: they end up
    reading the graphs anyway and trust a steady computed read over their
    own A/B call. A muted "Close to the reference — logged as a natural
    encounter" line shows in the panel.
  - **Follow-up same day (user): paired pitch contours now share an axis.**
    `PitchCanvas` (reference + learner in `AnalysisPanel`) drew each contour
    over frame-index / clip-duration, so a reference clip cut with trailing
    room tone squashed into ~40% of the width while a tight learner take
    filled it — impossible to compare. New exported `voicedTimeSpan`
    (`src/lib/pitch.ts`): first→last voiced frame + a 6% margin. Each canvas
    now maps `frame.timeSeconds` across *its own* voiced span, so both fill
    the width "speech start → speech end" and line up; the kana rulers
    underneath (`buildKanaTimeline`) take the same window. In
    speaker-normalized (semitones) mode the two canvases also share a y-range
    (`sharedPitchRange`, union of both clips' voiced `relativeSemitones`), so
    a flat delivery reads as flat instead of being stretched to full height.
    Hz mode keeps per-canvas y (absolute register isn't cross-speaker
    comparable). `tests/pitch.test.ts` +3.
  - Docs: AI_OVERVIEW §0/§4/§6, ROADMAP (three moved to Done under
    "Analytics pass 1"; the rest of the discussion parked under
    "Possibilities").

- **2026-09-08 — Pitch-accent drill: kana ruler under your recording's
  contour (user request, follow-up).** `MeasuredPitchContour` gained an
  optional `kana` prop (a `buildKanaTimeline` entry list); when passed it
  renders the shared `KanaTimelineRow` (extracted from `AnalysisPanel` into
  `src/components/KanaTimelineRow.tsx`) under the SVG — same time-aligned
  syllable ruler the shadowing analysis contours use. The drill builds the
  timeline from the take's forced-alignment words (`analysis.learnerWords`,
  now kept on the `done` state) + the item's mora sequence
  (`getSentenceReadingForMora`/`segmentIntoMorae` in sentence mode, the
  vocab reading + trailing particle in word mode). Shows only once alignment
  succeeds; degrades to nothing otherwise.
- **2026-09-08 — Pitch-accent drill shows your recording's measured pitch
  contour (user request).** After a take, `PitchAccentDrillPage` renders a
  `MeasuredPitchContour` (labelled "Your pitch (measured)") under the audio
  player — the same honest YIN track the review reveals draw for the native
  reference, now on the learner's own clip. The playhead follows playback
  (x↔time is exact — the audio *is* the clip the pitch was measured from).
  `analyzeRecording` now extracts the pitch track in its own try block so the
  contour still renders when the alignment service is down (`learnerPitch` on
  both the `done` and `unavailable` analysis states). `MeasuredPitchContour`
  gained `label` / `ariaLabel` props (default to the native-reference
  wording; ReviewPage/shadowing untouched). Same pass (user request): both
  drill lists are now walked in a **shuffled** order (`seededShuffle`,
  deterministic per a random `shuffleSeed` so a live-query refresh can't
  reorder mid-drill) — "Shuffle" button by the counter, "Shuffle and start
  over" at the end of the list.
- **2026-09-08 — `comprehension` retired; `reading_in_context` is the only
  sentence-subject card (user: "always better to learn in context if
  possible").** The plain isolated-sentence card is gone.
  `SENTENCE_ACTIVITY_TYPES` is now just `['reading_in_context']`, so nothing
  new seeds as `comprehension` and the planner's `RETAIN_ACTIVITY_TYPES`
  drops it too. `reading_in_context` keeps its stricter gate unchanged (the
  whole 2-before/1-after passage must be full-review ready, user request
  2026-09-03) — a sentence whose passage isn't ready now waits rather than
  falling back to an isolated card; with genuinely no passage (inbox-only
  sentence, book-scoped queue that can't see neighbours) it still degrades
  to the isolated layout inside `ReadingInContextCard`. Existing
  `comprehension` study items (FSRS state + review history) are migrated by
  `scripts/migrate-comprehension-to-reading-in-context.ts` (dry-run default,
  `--apply`): relabel in place where the sentence has no `reading_in_context`
  row yet, otherwise keep whichever of the two is further along (reps →
  scheduledDays → lastReview) and soft-delete the other. Append-only
  `reviews` rows follow the relabelled id untouched. Docs + `reviewPage`/
  `sessionPlannerRepository` tests updated; suite green (1257). Migration
  run against production 2026-09-08: 14 relabelled, 19 soft-deleted (7
  comprehension superseded, 12 reading_in_context rows where the
  comprehension row was further along); re-run is idempotent.

- **2026-09-07 — Live shadow pitch contour no longer degrades over loop
  reps (user: "starts smooth but becomes more and more spiky as the loops
  go on").** `LiveShadowWaveform` kept one set of per-bucket amplitude/pitch
  buffers for the whole loop: each bucket held a single last-write-wins YIN
  frame, and rep after rep filled in more buckets until the contour was 240
  independent one-shot estimates (octave errors included) vibrating around
  the median — while the reference contour looked smooth because it averages
  ~15 frames/bucket. Fix: detect the reference `<audio loop>` wrap (media
  time jumps back > half the clip) and wipe the amplitude/pitch buffers at
  the top of each rep; accumulate per-bucket sum+count and average at render
  (matching the reference path); drop frames > 10 st from the running
  median. The normalization median stays pooled across reps so only the
  shape redraws, not the vertical position. typecheck + waveform/pitch/
  shadow tests green.
- **2026-09-07 — Pitch-accent scorer now uses the following particle to
  tell odaka from heiban (user: "wire the scorer to use the following
  token").** `expectedPitchShape` gains an optional third arg
  `hasFollowingMora`; when set it appends the particle's expected level
  ('h' for heiban, 'l' for every accented pattern), so
  `detectedDropPosition` reports an odaka drop at `moraCount` instead of
  collapsing it into heiban. `classifyLearnerMorae` measures one extra
  bucket over the aligned particle span (`followingMoraSpan` matches the
  next token(s) against `PitchAccentTarget.followingMora` so the next
  *content* word is never mistaken for the particle) and classifies it 'l'
  only when it sits ≥ `FOLLOWING_DROP_MARGIN_SEMITONES` (2 st) below the
  word's mean — biased toward 'h' so ordinary declination on a genuinely
  heiban phrase isn't misread as odaka. `buildPitchAccentShapeObservations`
  then emits a targeted message ("…the pitch drops on the particle after
  it, but yours stays up there — it sounds like heiban"). Without a
  measurable following mora everything stays exactly as before (2-arg
  `expectedPitchShape`, odaka never scored against a heiban-shaped attempt).
  `PitchAccentTarget.followingMora` is populated by
  `getPitchAccentDrillWords` (from `followingParticle`),
  `getPitchAccentDrillSentences`, and `AnalysisPanel` (all via
  `trailingBunsetsuParticles`). `LearnerPitchAccentShape.followingClass` +
  a `learnerFollowingBySurface` map thread the measured particle level to
  `PitchAccentWordMarks`, which now renders the learner's H/L (with
  match/mismatch flag) under the dictionary particle mark instead of a bare
  `·`. `tests/pitchAccentShape.test.ts` +5, `tests/pitchAccentObservations.test.ts`
  +6, `tests/pitchAccentDrill.test.ts` +1.

- **2026-09-07 — Pitch-accent drill: "predict the drop" removed + a
  Single-words mode + a bigger pool (user: "I just want to practice saying
  it and have it check the pitch" / "a mode to do single words" / "add more
  words").** `PitchAccentDrillPage` no longer opens on the perceptual
  predict-the-drop beat (added 2026-09-06, now cut) — every item goes
  straight to marks → record → dictionary-shape check. `PredictDropStep` /
  `PredictionResult` / the `prediction` state / the `focusWord` rotation are
  gone; `PitchChoiceContour` is still used by the `pitch_accent` SRS card so
  the component stays. New **Full sentence / Single words** toggle at the
  top. Single-words mode walks one word at a time (word rendered alone via
  `SentencePitchAccentText`, reading — meaning, and the example sentence as
  `<mark>`ed context), records just that word, and runs the same
  `buildPitchAccentShapeObservations` scoring with a one-entry target list.
  New `getPitchAccentDrillWords` (`repository.ts`): every confirmed vocab
  item the learner has reviewed to proficiency
  (`getProficientVocabularyItemIds`) that carries dictionary
  `pitchAccentPositions`, one entry per word, example sentence = the
  dictionary-form occurrence when there is one else the earliest —
  **deliberately not gated on the sentence lacking reference audio** (you're
  drilling the word in isolation, so the overlap with the audio-gated
  `pitch_accent` card doesn't apply), which makes the pool much larger than
  the sentence list. Quiet mode no longer affects this page — it's a
  deliberate "practise speaking" page (`AppSettings.quietMode` doc, Home /
  Settings copy updated). `tests/pitchAccentDrill.test.ts` +4 (new
  `getPitchAccentDrillWords` describe), `tests/pitchAccentDrillPage.test.tsx`
  rewritten for the no-predict flow + word mode.
  **Follow-up same day (user: "if a word has a particle after it, could we
  include that, since particles often take the pitch accent of the preceding
  word"):** single-word mode now drills `surfaceForm + followingParticle` —
  the word plus the run of single-kana bunsetsu particles after it in the
  example sentence (new exported `trailingBunsetsuParticles` in
  `sentencePitchAccent.ts`; `PitchAccentDrillWord.followingParticle`). The
  particle gets its dictionary H/L mark (via `SentencePitchAccentText`, same
  as sentence mode) and is included in the recording transcript so a
  phrase-final heiban/odaka fall is actually voiced.
  `getPitchAccentDrillWords` now scores candidate occurrences
  `(hasParticle?2:0) + (isDictForm?1:0)`, earliest-first tiebreak, so it
  prefers an example where the word carries a particle. Note:
  `buildPitchAccentShapeObservations` still only classifies the word's own
  morae, so the *scorer* can't yet use the particle to tell heiban from
  odaka — display + transcript only for now. `tests/pitchAccentDrill.test.ts`
  +1, `tests/pitchAccentDrillPage.test.tsx` +1.

- **2026-09-07 — `pitch_accent` card skips phrase-final edge-accent words
  (user ask: "how would I tell it's odaka from the recording since heta is
  at the end of the sentence, so there's nothing to go down to").** Heiban
  (drop 0) and odaka (drop === mora count) are identical on the word's own
  morae — the fall only surfaces on whatever is voiced after the word. New
  `hasFollowingVoicedMora` (in `ReviewPage.tsx`) requires a hiragana mora
  (particle / copula / auxiliary) immediately after the word's occurrence
  before `getPitchAccentReviewCandidates` will emit an edge-accent card;
  atamadaka / nakadaka (internal drop, audible on the word alone) are
  unaffected. Same "skip, don't show degraded" treatment as the missing-
  reference-recording gate. Already-seeded study items for now-ineligible
  words just fall dormant (no cleanup, mirrors the audio gate).

- **2026-09-07 — Kana ruler under the AnalysisPanel pitch contours (user
  ask: "line up the hiragana under those so I have a better idea of what
  syllables relate to the pitches").** New pure `buildKanaTimeline`
  (`src/lib/kanaTimeline.ts`) places one kana label per forced-alignment
  word along a linear time axis: each word's share of the total audible
  transcript character count is mapped onto the sentence's mora sequence by
  proportion (same approximation as `SyncedShadowText`'s karaoke slice — no
  fragile cross-tokenization string matching), positioned by the word's
  `start`/`end` seconds over the contour's `durationSeconds`. Reference side
  subtracts `targetRange.startMs` when a practice-target slice is active and
  drops words outside the window; falls back to the raw aligner token when
  the sentence has no reading. `AnalysisPanel` renders it via a
  `KanaTimelineRow` under each `PitchCanvas` (both `PitchCanvas` SVGs gained
  `preserveAspectRatio="none"` so x is truly linear at any width, matching
  `MeasuredPitchContour`). Only appears once the server forced alignment is
  `ready` — degrades to nothing off-tailnet. `moraUnits` now threads from
  `ShadowPage` into `AnalysisPanel`. Waveforms deliberately skipped (their
  peaks are edge-trimmed / mode-warped, so no honest linear axis).
  `tests/kanaTimeline` new (+5).

- **2026-09-07 — Measured native pitch contour on the non-audio review
  cards (user ask: they wanted the real speaker contour, not a symbolic
  one, on "the review cards where it's only shown the h/l for the
  vocabulary words").** `ReviewPitchContour` (the YIN track of the native
  clip, playhead + loop) previously mounted only on `listening` /
  `word_listening` reveals, where the audio rides on the candidate. New
  `SentenceNativePitchContour` wrapper does a `useLiveQuery` for the
  sentence's first `sentenceAudio` row and mounts `ReviewPitchContour` when
  one exists — added above the shared `SentencePitchAccentRow` insert on
  every other revealed sentence card (comprehension, reading_in_context,
  grammar, …), gated out when a `ReviewPitchContour` is already showing so
  there's never a double contour. Nothing shows for sentences with no
  reference clip. A brief symbolic overline contour (b08a038) was tried
  first and reverted (9b8893b) — the user wanted the real thing.

- **2026-09-06 — Pitch-accent marks extend over attached particles (user
  ask: "add the h/l markers for the entire sentence").** Still per-word, not
  a computed sentence contour, but `buildSentencePitchAccents` now runs a
  second pass that pulls the run of short single-kana grammatical particles
  immediately after a marked word (`BUNSETSU_PARTICLE_KANA` — は・が・を・に・
  も・の・か・ね・よ・…) into that word's accent phrase as `particleTail`,
  voiced at the `particleHigh` level (high after heiban, low after an
  accented/odaka word — so odaka is finally visible in the sentence view).
  Deliberately stops at verb/copula okurigana (て・た・だ・で), multi-mora
  particles (から・まで・のに — several carry their own accent), and the next
  marked word. `PitchAccentWordMarks` renders the real particle kana when
  present (falling back to the abstract `·` following-particle mark
  otherwise); `SentencePitchAccentText` folds the tail onto the sentence
  line and out of the plain-text run. Flows through `SentencePitchAccentRow`
  too (shadowing panels, `AnalysisPanel`, `pitch_accent` card).

- **2026-09-06 — Grammar-noticing is one batched step + its own flow (user
  report: "notice grammar / notice vocab items keep coming up during review
  sessions — put them in their own flow").** The planner used to draft one
  `grammar_noticing` step per worked-through sentence and
  `preferCoherentChains` interleaved them through the sitting. Now
  `buildGrammarNoticingSteps` emits a **single** step — "Notice grammar in N
  sentences", carrying `PlannerSessionStep.sentenceIds`, capped at
  `GRAMMAR_NOTICING_PER_SESSION_LIMIT` (4) regardless of remaining grammar
  budget so a backlog drains a few at a time. `sessionStepTargetPath` routes
  it to the new **`GrammarNoticingFlowPage`** (`/notice-grammar?ids=…`,
  lazy): a walker that shows each sentence + the existing `GrammarPicker`
  (reused, not reimplemented — same principle as `SessionRunnerPage`), a
  1/N progress row with per-sentence ✓, Prev/Next, and a "Nothing to notice"
  shortcut (`setSentenceGrammarReviewStatus` → `confirmed`, advance). When
  there's only one candidate the step keeps `sentenceId` set too, so
  coherent-chain ordering and older persisted sessions (which deep-link
  straight to `AnalyzePage`) still work. `advanceCompletedStepProgress` and
  `exclusionsFromSteps` both iterate `sentenceIds`: marking the batched step
  complete confirms every sentence not already closed in the flow, and a
  same-day top-up won't re-propose any of them. Tests: +2
  `sessionPlanner.test.ts` (batch collapse + cap; lone-candidate keeps
  `sentenceId`), +1 `sessionPlannerRepository.test.ts` (batch → complete
  confirms all → no re-draft next day).

- **2026-09-06 — "Quiet mode" — pause every speak-aloud activity (user
  request: "sometimes at work / in a noisy environment, can't talk").** New
  `AppSettings.quietMode` (per-device like the rest of `settings`, default
  `false`), toggleable on **both** the Settings page (Learning Orchestrator
  section) and Home (a checkbox right above the Add-time buttons — it flips
  day to day, so it needs to be one tap from where you start a session).
  When on:
  - **Session planner:** `getSessionPlannerInput` returns an empty
    `shadowCandidates` list, so `buildShadowSteps` drafts nothing and
    `allocateTimeAcrossModes` routes the shadowing minutes to glossing /
    grammar / review. Nothing is consumed — candidates recompute next plan.
    New `SessionPlannerInput.quietMode` flag drives one explanation line
    ("Quiet mode is on — speaking practice (shadowing) is paused for now.").
  - **Pitch-accent drill:** the recording beat is dropped — it runs
    perception-only (predict the drop → reveal the dictionary marks + your
    prediction result → next sentence). The "Skip — just practise saying it"
    button is hidden (the prediction *is* the whole exercise).
  - **`/shadow`:** a non-blocking banner ("Quiet mode is on … this page
    still works if you've found somewhere you can talk") with a "Turn off
    quiet mode" button. Not hard-blocked.
  - Not synced (settings never is); an in-flight planned session keeps any
    shadow steps it already had (skip them, or turn quiet mode off and
    re-plan). `tests/sessionPlanner.test.ts` +1,
    `tests/sessionPlannerRepository.test.ts` (extended the shadow-gate
    test), `tests/pitchAccentDrillPage.test.tsx` +1; 1228 vitest tests
    green.

- **2026-09-06 — Pitch-accent drill opens on a "predict the drop" step +
  `pitch-ear-trainer` adaptive difficulty (user request, from a ChatGPT
  pitch-ear discussion).** The learner passes synthetic-tone discrimination
  (`relative-pitch-trainer`) but still misses lexical accent in real speech;
  the missing piece is an active "locate the fall" step cued to a real word
  in sentence context (rather than an abstract melody or a metalabel guess).
  - `PitchAccentDrillPage` now runs each sentence in two beats. **Beat 1:**
    one accent-bearing word is spotlighted (`<mark>`) in the otherwise-plain
    sentence and the learner picks where *its* pitch falls (`0..moraCount`,
    each drawn as a whole NHK-style contour) before the dictionary marks
    reveal. The focus word rotates by list position so patterns vary down
    the drill. **Beat 2:** the existing reveal — full `SentencePitchAccentText`
    marks, record, `buildPitchAccentShapeObservations` scoring — with the
    beat-1 result (`✓/✗`, and the dictionary contour when missed) kept on
    screen so the loop closes. A "Skip — just practise saying it" button
    goes straight to beat 2.
  - `PitchChoiceContour` extracted from `ReviewPage.tsx` to its own
    component (`src/components/PitchChoiceContour.tsx`), now shared by the
    `pitch_accent` SRS card and the drill. `splitOnSurfaceForm` likewise
    lifted to `src/lib/surfaceForm.ts` (was a `ReviewPage` local).
  - `scripts/pitch-ear-trainer.html` gains an adaptive-difficulty mode:
    trials start at an exaggerated 10-semitone drop and shrink toward
    natural speech (2 st) on each streak of 5, widening back on a miss —
    ported from `relative-pitch-trainer.html`'s ladder. The fixed-interval
    select still works when adaptive is off.
  - The real-audio half of the same discussion (word-alone vs. word+particle,
    same/different + ABX on corpus near-minimal pairs) is written up under
    ROADMAP "Planned" → **Real-audio pitch-perception bridge**; deliberately
    not an F0-resynthesis pipeline. `tests/pitchAccentDrillPage.test.tsx`
    +3, `tests/surfaceForm.test.ts` new (+4); 1226 vitest tests green.

- **2026-09-06 — `/grammar` list hides orphaned patterns (user report).**
  User saw それより / ～じゃん at the bottom of the grammar page reading
  "Encountered 0 times, not tracked yet." These are canonical
  `grammar_patterns` rows whose every `sentence_grammar` link was removed
  (sentence deleted / re-segmented, or the last occurrence
  mis-tag-corrected) — `cascadeRetireSentenceLocal` and
  `removeSentenceGrammar` both deliberately keep the row so
  `ensureGrammarPattern` can reuse it by `normalizedKey` if the pattern
  recurs. `listGrammarPatternSummaries` walked every row with no filter, so
  they surfaced with `encounterCount 0` in the `recently_encountered`
  bucket. Fixed by filtering the summary list to
  `encounterCount > 0 || tracked`; the canonical rows are left in place (no
  delete). Harmless to reviews — the planner already skips them
  (`pickContextSentenceForGrammarPattern` finds no live sentence).
  `tests/grammarListPage.test.tsx` +2.

- **2026-09-06 — Pitch-accent drill shows your measured H/L under the
  dictionary row (user request).** After a take, `PitchAccentDrillPage`
  now also runs `buildLearnerPitchAccentShapes` (alongside the existing
  `buildPitchAccentShapeObservations`) and passes the result as
  `learnerClassesBySurface` to `SentencePitchAccentRow` — the same
  mark-for-mark second H/L line already used in `AnalysisPanel`, with
  mismatched morae flagged and unreachable ones shown as `·`. The
  per-word mismatch observations still render below it. Also stops the
  misleading "no mismatch — nicely done" when in fact *no* target word
  could be lined up in the recording (compound split differently / word
  too quiet): the message is now keyed off how many of the sentence's
  accent-bearing words were actually measured ("N of M"), with a distinct
  "nothing to check, try again slower" when that count is zero.

- **2026-09-06 — Pitch-accent drill: marks moved under the sentence (user
  request).** The drill was showing the sentence on one line and the
  accent contour as a separate strip below, so reading + checking the
  accent meant glancing back and forth. New `SentencePitchAccentText`
  renders the whole sentence with each accent-bearing word's kana + H/L
  (and, post-take, the learner's measured H/L) stacked directly beneath
  it; particles / punctuation / dataless words stay inline as plain text.
  Shared per-word mark markup extracted to `PitchAccentWordMarks` and
  reused by the existing compact `SentencePitchAccentRow` (unchanged
  output). Only the drill page uses the new inline layout; shadowing /
  AnalysisPanel / `pitch_accent` reveal keep the compact row.

- **2026-09-06 — Sentence-glossing page shows preceding context (user
  request).** `AnalyzePage` now renders the previous one or two sentences
  (dimmed, above the working sentence; translations shown only when "Show
  Satori English" is on) so short conversational lines have context while
  glossing. Context is capped at the current chapter so it doesn't bleed
  across a scene break.

- **2026-09-06 — "Order from paste" tolerates Satori's dropped episode-final
  `。` (user report).** Reordering *spring new life* left
  `しばらくすると、…羽をバタバタさせ始めました。` unmatched: it's the last
  sentence of 第三話 and Satori's copy/paste omits the closing `。` on each
  episode's final sentence, so the exact-substring match failed.
  `orderBookSentencesFromPaste` now retries with trailing sentence-final
  punctuation (`。.!?…‥`) stripped from the stored key. +1 test.

- **2026-09-06 — Learner's own H/L under the dictionary pitch-accent row
  (user request).** `AnalysisPanel`'s "Pitch accent (dictionary)" section
  measured the learner's per-mora shape internally
  (`classifyLearnerMorae`) but only surfaced it as prose when it
  *disagreed* with the dictionary. New `buildLearnerPitchAccentShapes`
  exports that same rough per-mora H/L estimate; `SentencePitchAccentRow`
  takes an optional `learnerClassesBySurface` map and draws it as a second
  H/L line directly under the dictionary one (AnalysisPanel only — the
  shadowing/review uses of the row are unchanged). Disagreeing morae are
  flagged in `--danger`; morae with too little voiced signal show `·`. So
  a correctly-produced accent now reads as a visible match. +4 tests
  (`pitchAccentObservations.test.ts`).
- **2026-09-06 — Completed glossing/grammar steps kept coming back (user
  report).** The planner's `continue_book` / `vocabulary_review` /
  `grammar_noticing` candidate finders key on real-progress markers
  (`BookSentence.status`, `SentenceAnalysis.vocabularyReviewStatus` /
  `grammarReviewStatus`), not the session step. Those markers move only via
  AnalyzePage's own status pill / the picker's Confirm button — and the
  learner was settling the step from `SessionBar`'s "Mark complete" instead,
  leaving the sentence `unstarted`, so every subsequent session re-drafted
  the identical step. The 2026-08-27 "single advance control" decision
  (in-page work never settles a step) now has its reverse wired up:
  `updatePlannerSessionStep` calls `advanceCompletedStepProgress` when a
  glossing/grammar step transitions to `completed` (never `skipped`), which
  advances that step's marker — `continue_book` → `BookSentence.status`
  `complete`, `vocabulary_review` → `confirmSentenceVocabulary` (materializes
  the autosaved selections), `grammar_noticing` → `grammarReviewStatus`
  `confirmed`. `grammar_detail` ("Examine <pattern>") is deliberately left
  out — whether to Track is a real decision that step exists to prompt.
  (`src/db/repository.ts`.)

- **2026-09-05 — "Reviews this step: 0 / N" never advanced (user report).**
  The session planner's `review` step only gets a `startedAt` when it's
  flipped to `active`, which `SessionRunnerPage`'s "Go" does — but reaching
  `ReviewPage` via the top-nav "Review" link or `SessionBar`'s "Resume"
  (navigate-only) left the step `pending`. With no `startedAt`,
  `countReviewsSince` can't run, so the counter (and the target-count
  auto-advance) sat frozen at 0 no matter how many cards were graded.
  `ReviewPage` now activates a matching `pending` review step on arrival
  (`src/pages/ReviewPage.tsx`), the same effect "Go" has.

- **2026-09-05 — Looped word audio clipped its tail at slowed speeds
  (user report, card issue `e1c3f531`).** On the `pitch_accent` card (and
  any `SegmentLoopPlayer` consumer) the reporter noticed the looped native
  word lost more of its end the more they slowed playback. Cause:
  `preservesPitch` time-stretching makes `audio.currentTime` lead the
  audible output, and that lead grows as the rate drops, so `playLoopedRange`
  (`src/lib/recording.ts`) pausing the instant `currentTime` reached `endSec`
  cut the still-buffered tail — the folded-in trailing particle, i.e. the
  audible heiban/odaka cue. Below 1× it now keeps playing for an estimated
  WSOLA-buffer drain time before the pause/rewind; 1× is unchanged. First
  pass used `(1/rate - 1) * 90` ms and the user reported it still clipped,
  so the constant is now `400` (≈400 ms at 0.5×, ≈133 ms at 0.75×) and
  `localStorage.loopTailLagMs` overrides the whole computation for hands-on
  tuning without a rebuild. Empirical — revisit if it bleeds into the next
  word. 1 test in `tests/recording.test.ts`.
- **2026-09-05 — AnalysisPanel waveforms trim silent edges (user request).**
  The stacked "Reference waveform" / "Learner waveform" in `AnalysisPanel`
  were drawn from the full sample arrays, so a learner take's record-button
  lead-in (and any trailing dead air) squashed the actual speech into a
  fraction of the width and made shape comparison hard. New
  `trimmedSampleRange` in `src/lib/waveform.ts` finds the first/last
  above-threshold energy window (8% of peak, 50 ms margin) and
  `analyzeAlignment` now feeds `computePeaks` the trimmed slice for each
  clip independently. Display-only: onset/offset/duration-ratio math still
  runs on the untrimmed samples, and a note under the waveforms says so.
  2 tests in `tests/waveform.test.ts`.
- **2026-09-04 — Content-identical conflicts now auto-settle instead of
  requiring a manual click (user confirmed, after the diff-noise fixes
  above, that some conflicts showed "no other diff lines highlighted" at
  all).** A `version_conflict` is a raw CAS mismatch — it doesn't mean the
  content actually diverged; two near-simultaneous saves landing on the
  same resulting state (or a queued mutation landing right after another
  already wrote it) hit it with nothing left to decide. New
  `conflictContentsMatch` (`src/sync/conflictDiff.ts`, reuses `forDiff`'s
  normalization) checked in `handlePushConflict`
  (`src/sync/engine.ts`) before recording a conflict — if content matches,
  the local record-meta still aligns to the cloud version (so future edits
  push cleanly) but no `ConflictPanel` card is created at all, logged at
  `debug` (`CONFLICT_NOOP`) rather than the `warn`/`CONFLICT` a real
  conflict gets. 2 new `conflictDiff.test.ts` cases.
- **2026-09-04 — Fixed: two more conflict-diff noise sources, found via
  five more sync issue reports filed right after the bookkeeping-stripping
  fix above (the cleaner diff let these show through clearly for the first
  time).** (1) `updatedAt` differed after *every* push, for *every*
  entity, because every synced table has a `before update ...
  sync_private.set_updated_at()` trigger
  (`supabase/migrations/20260722000000_sync_schema.sql`) that
  unconditionally stamps `now()`, ignoring whatever the client sent —
  added to the excluded-from-diff key set alongside the other
  auto-managed columns, same reasoning. (2) An unset optional field
  (`chunkId?`, `conflictEntity?`, ...) is simply absent from the local
  domain payload but every `*ToRemote` mapper writes it as an explicit
  `column: value ?? null`, so it always showed as a spurious "added: null"
  line; `forDiff` now recursively drops `null`-valued keys before
  diffing, matching the absent/null equivalence the mappers already use
  elsewhere. Also normalizes ISO timestamp strings (`Z` vs. `+00:00`,
  millisecond vs. microsecond precision) so the same instant never reads
  as a diff. 4 new `conflictDiff.test.ts` cases.
- **2026-09-04 — Fixed: conflict diff buried the real change under sync
  bookkeeping (found via a second sync issue report — "seems to be mostly
  just bookkeeping entries, ids, versions, timestamps").** `canonicalize`
  (`src/sync/conflictDiff.ts`) normalized casing but never stripped
  `owner_id`/`version`/`deleted_at`/`client_id`/`last_modified_by` — columns
  every remote row carries (see any migration's table trailer) that the
  local domain payload never has. Every conflict's "Differences" view
  therefore showed these ~5 fields as spurious "added" lines regardless of
  entity, drowning out whatever the learner actually edited. New `forDiff`
  export drops just those keys before diffing; the full local/remote JSON
  `<details>` panels are untouched (still show real version numbers etc. —
  useful for debugging a conflict, as opposed to deciding keep-local vs.
  keep-remote). `src/components/ConflictPanel.tsx` now calls `forDiff`
  before `prettyLines` in the diff path only. 3 new `conflictDiff.test.ts`
  cases.
- **2026-09-04 — Fixed: duplicate conflict rows for the same record
  (found via the first sync issue report filed through the new button
  below).** `addConflict` (`src/sync/queue.ts`) always inserted a new
  `SyncConflict` row with a fresh id, even when an open conflict for that
  same `(entity, recordId)` already existed. Several queued mutations for
  one record hitting `version_conflict` in the same push cycle (e.g. a few
  quick edits to one sentence's `analyses` row) each added their own
  duplicate `ConflictPanel` card — the user's first report showed 34 open
  conflicts that collapsed to only 10 distinct records once deduped. Fixed
  by upserting on `(entity, recordId)` among open conflicts: an existing
  open conflict updates in place (keeping its original id/createdAt but the
  latest `localPayload`) instead of spawning a duplicate — also fixes a
  correctness gap where only the *first* queued edit's payload was kept for
  "Keep local", discarding later ones. 3 new `queue.test.ts` cases.
- **2026-09-04 — Sync issue reports: a "Report issue" button for sync
  trouble (user request — "seeing more conflicts than I'd expect,
  and I'm at work with no Claude access when it happens").** New
  `sync_issue_reports` table (`supabase/migrations/20260904000000_sync_issue_reports.sql`)
  and `SyncIssueReport` domain type mirror `card_issue_reports`, but with no
  `study_item_id` FK — sync trouble isn't always tied to one card. Two entry
  points: a general "Report sync issue" button in `AuthAndSyncSettings`
  (Account & sync settings) and a per-conflict "Report this conflict" button
  on each card in `ConflictPanel` (tags `conflictEntity`/`conflictRecordId`).
  Both bundle a diagnostics snapshot automatically via
  `reportSyncIssue`/`buildDiagnosticsSnapshot`, so the reporter doesn't need
  clipboard access to file something useful. `buildDiagnosticsSnapshot`
  (`src/sync/logger.ts`) now also embeds an `openConflicts` summary
  (entity/recordId/versions/createdAt per open conflict, no payload
  contents) instead of just a count — this also improves the pre-existing
  "Copy diagnostics" button. Reports list/resolve alongside card issues on
  `CardIssuesPage` (new "Sync issues" section,
  `listSyncIssueReports`/`resolveSyncIssueReport`); `npm run issues:list-sync`
  (`scripts/list-sync-issues.ts`) mirrors `issues:list` for batch triage by a
  future Claude session — `card-issue-triage` skill's §6 covers reading the
  `openConflicts` summary to spot a bad entity vs. routine multi-device
  editing. Full sync-engine wiring (Dexie v17, `SyncEntity`, mappers,
  push/pull/upload-all/replace-from-cloud) follows the existing per-entity
  switch-case pattern exactly.
- **2026-09-05 — Vocabulary picker empty on 35 Anki-imported sentences.**
  User hit "No morphology suggestions on this sentence…" on the later
  sentences of *spring new life* (the 第五話/ending block, positions
  78–111, plus one stray grammar-example sentence). Root cause: these were
  Anki-imported into an existing book *after* the last
  `backfill:vocabulary-suggestions` run, and `csvImport`/`import-anki-sentences`
  never populate `vocabulary_suggestions` (only Shadowmine `.zip` imports
  do) — so the picker had nothing to render. Not a code bug; the backfill
  is `workflow_dispatch`-only and just needed re-running. Ran it against
  production (`--apply`, 35 sentences updated, 0 skipped) via a local
  `.venv-tokenize` (README's documented path; `pip install -e ../shadowing/cli`).
  Recurring gotcha: re-run the backfill after any Anki/CSV import.
- **2026-09-03 — Card-issue triage: お父さん reading merge.** Three open
  reports (`reading_retrieval`/`cloze`/`reading_production`) flagged お父さん
  reading as おちちさん. Root cause is the `combineSuggestions` reading
  concatenation (`src/lib/vocabularySuggestions.ts:237` — お+ちち+さん) when a
  learner combines the お/父/さん tokens in VocabularyPicker; no special-reading
  lookup and no reading-level `combinedExpressionWarning`. Same class as the
  2026-08-30 お母さん→おははさん cleanup; `merge:duplicate-vocabulary-items`
  skips it (never seen conjugated). Fixed by hand: buggy `vocab_item_965e5db8`
  merged into canonical おとうさん `vocab_18a79a98` (4 sentence_vocabulary
  links + 3 study_items repointed, reviews + card_issue_reports moved onto the
  higher-review survivors, buggy row soft-deleted). Two other open reports
  (pitch_accent word-audio span on 新人さんですか / 今日から働くことになりました)
  are forced-alignment inaccuracies — `SegmentLoopPlayer`'s `isolatedWordRange`
  mislocates the word in the clip.
- **2026-09-03 — Reported-issues rows get subject-aware deep links + Analyze
  word-audio editor (user request, follow-up to the triage above).**
  `listCardIssueReportsWithContext` now also resolves each report's book
  (lowest-position `book_sentences`) and vocabulary item (direct, or via the
  `sentenceVocabulary` link), so `CardIssuesPage` rows link to "Open in
  Analyze" and "Find in vocabulary" (new `?q=` seed on `VocabularyListPage`
  via `useSearchParams`) instead of only the FSRS-stats debug page. AnalyzePage
  gains a "Native word audio" section (`WordAudioSection`, one
  `SegmentLoopPlayer` per distinct `surfaceForm`) so the word-span "Adjust"
  editor — previously reachable only mid-review — can be used on the sentence
  itself; it writes the same `SentenceVocabulary.audioStartMs/EndMs` override.
  `src/db/repository.ts`, `src/pages/CardIssuesPage.tsx`,
  `src/pages/VocabularyListPage.tsx`, `src/pages/AnalyzePage.tsx`; 1 new
  data.test.ts case.
- **2026-09-05 — Word-audio "Adjust" drag committed a stale position.**
  `WordAudioRangeEditor`'s `endDrag` read `props.value` to decide what to
  persist, but `pointermove` is a React *continuous* event so its
  `onChange → parent setState → new value prop` round trip can still be in
  flight when the *discrete* `pointerup` fires — the commit then saved a
  partway-through span (or the pre-drag span), so dragging the start handle
  earlier appeared to do nothing on playback (reported on 新人 /
  `sent_11e4fc56`). Now tracks the live drag span in a ref and commits from
  that. `src/components/WordAudioRangeEditor.tsx`; 1 new test.
- **2026-09-03 — `reading_in_context` gated on its whole passage (user
  request).** `comprehension` still waits only on its own sentence's vocab
  (Phase 7.11 gate); `reading_in_context` now additionally waits until every
  sentence in the surrounding passage (2 before + 1 after,
  `buildReadingContextMap`) is itself full-review-ready — so the learner
  never reads a passage containing words they haven't confirmed + made
  proficient. New generic `ActivityDescriptor.activityIsReady` hook (per
  activity type, unlike `isReady`); `GateContext` now carries
  `sentenceReadiness`; new `deferUnreadyReadingInContextReviews()` repo
  pass (mirrors `deferUnreadySentenceReviews`/`deferUnreadyGrammarReviews`),
  run on every ReviewPage queue build. `src/pages/ReviewPage.tsx`,
  `src/db/repository.ts`; 2 ReviewPage tests + 6 repo tests.
- **2026-09-03 — Contrastive pair card gated on vocabulary (user request).**
  The `contrastive` (VocabularyConfusion-subject) review card now carries an
  `ActivityDescriptor.isReady` gate, mirroring tier-1 `word_listening`:
  withheld from both the due queue and the pending-seed pool until **both**
  member words' readings have reached FSRS proficiency. Previously ungated
  (only implicitly required both words to be confirmed, via
  `getConfusionPairCandidates`). `GateContext.proficientVocabularyItemIds`
  now also includes confusion-pair member ids. `src/pages/ReviewPage.tsx`;
  3 tests in `tests/reviewPage.test.tsx` (via new `seedContrastivePairFixture`).
- **2026-09-03 — Spectrogram overlay in AnalysisPanel (user request; ROADMAP
  segmental-feedback slice).** A "Show spectrogram" toggle under the
  waveforms draws the reference clip and the learner attempt as stacked
  grayscale spectrograms (`src/lib/spectrogram.ts` — a hand-rolled radix-2
  FFT + Hann STFT, pure, no dep; `SpectrogramCanvas.tsx` — canvas, time×freq,
  0–4 kHz, louder=brighter). Computed from the samples `AnalysisPanel`
  already decodes for pitch/alignment; a short "how to read this" caption
  (the ROADMAP's "noise without guidance" guard). The other two
  segmental-feedback pieces (a `reference` sound guide, ASR kana-diff — the
  latter already exists as `asrObservations`) and the phonetics-tutor
  prerequisite are unchanged. `tests/spectrogram` new (+5).

- **2026-09-03 — Per-sentence clip re-cut on Analyze (user request).**
  `AnalyzePage` gains an **"Adjust clip timing"** control (only when the
  book has a `sourceUrl`) — opens the same `<BoundaryWaveform>` editor over
  that one sentence's span, "Save & re-cut" calls new
  `recutSentenceAudioFromSource` which re-clips just that `sentenceAudio`
  row from the pristine YouTube source (`clipFromSource`) and re-uploads
  it. No text change, no lost chunk/grammar analysis, no study-progress
  remap — the lightweight alternative to book-wide "Re-segment captions"
  when one mining boundary is a touch off. `tests/data` +2,
  `sentenceAudioAdjuster` spec new.

- **2026-09-03 — Boundary editor: play the selection + edit the outer
  edges (user feedback).** Two gaps in the per-row `<BoundaryWaveform>`:
  (1) the row's play button (`SpanAudioButton`) cached its first clip
  forever, so after dragging a boundary you replayed the *old* span and
  couldn't tell if the edit helped — added a `▶ Play selection` button in
  the editor that re-fetches the current `[startMs, endMs]` every press,
  plus a `cacheKey` prop on `SpanAudioButton` that drops the stale clip
  when the span moves (also fixes the transcript/translate-stage row
  buttons after a merge/split). (2) The first row's start and the last
  row's end weren't draggable at all — new `moveRowEdge` in
  `resegmentPlan.ts` moves an outer edge alone (internal edges still move
  the shared boundary), the first/last row's editor view now extends to 0 /
  well past the end so there's room to drag, and `SegmentationEditor` takes
  `mediaDurationMs` as the last-row ceiling. `resegmentPlan` +5,
  `segmentationEditor` +1.

- **2026-09-03 — Hand-correctable word-audio span (user request).** The
  isolate-and-loop control (`SegmentLoopPlayer`, used by the `pitch_accent`
  and `word_listening` review cards) derived the word's span inside the
  sentence recording from forced alignment + `isolatedWordRange`'s
  character-proportion remap — two stacked approximations, often a little
  off, no way to fix it, and nothing at all when alignment failed. New
  **"Adjust"** toggle on that control opens `<WordAudioRangeEditor>`: the
  clip decoded in the browser (2–6 s, no server, no iOS decode ceiling),
  draggable start/end handles over the waveform, `detectSilences` pause
  lines + "Snap to pauses", "Reset to auto". The corrected span is stored
  on the `SentenceVocabulary` link (`audioStartMs`/`audioEndMs`, **synced**
  — new nullable columns, migration
  `20260903120000_sentence_vocabulary_audio_range.sql` to apply) and
  overrides the alignment guess for both the loop and the pitch-accent
  native model. `getVocabularyTargetCandidates` / the pitch-accent
  candidate now carry the link. `tests/data` +3, `tests/sync` +1,
  `segmentLoopPlayer` / `wordAudioRangeEditor` specs new (+5).

- **2026-09-03 — Boundary waveform: server-side + per-row zoom (user
  request).** Two parts. (a) The boundary waveform no longer touches audio
  in the browser: `AudioContext.decodeAudioData` on a multi-minute span
  reliably fails on iOS Safari, so it was permanently "unavailable" there.
  New `app/waveform.py` does one ffmpeg pass over the span (low-rate PCM on
  stdout + `silencedetect` on stderr) and returns just peak buckets + pause
  midpoints as a few-KB JSON — `GET /jobs/{id}/waveform` (wizard), `POST
  /source-audio/waveform` (`/books/:id/resegment`); stdlib only, no numpy.
  (b) A single whole-span strip is unreadable for an 8-min podcast (118
  boundary lines in 600 px), so it's gone. Each full `SegmentationEditor`
  row now has an **"Adjust timing"** toggle opening `<BoundaryWaveform>` —
  a zoomed waveform of just that sentence ±1.5 s with a draggable handle on
  each editable edge, visible pause lines, and a per-row "Snap to pauses".
  One open at a time; closes on any merge/split/remove.
  `SegmentationEditor` takes `waveformForRange` (separate from
  `audioForRange`, which still feeds the per-row play buttons).
  `test_waveform.py` (new, +9 py), `test_jobs_api` / `test_source_cache`
  +1 each; `tests/miningApi.test.ts` +3, `tests/segmentationEditor` reworked.
  Deploy: `pip install -r requirements.txt` unchanged.

- **2026-09-03 — Mining wizard warns on an already-imported video (user
  request).** The Import-from-YouTube idle screen now parses the pasted
  URL's 11-char video id (`extractYouTubeId` in `src/lib/youtubeUrl.ts`,
  mirrors `server/youtube-mining` `extract_video_id`) and checks it against
  every book's `sourceUrl` and `shadowing:source-<id>` `sourceKey`. On a
  match it shows "Already imported as “<title>” on <date>. Mining it again
  re-clips the audio and updates that book." and relabels the Start button
  "Mine again". Warning only — a re-mine is still the sanctioned way to
  restore native clips. `tests/youtubeUrl.test.ts` (new, +4);
  `tests/youtubeMine.test.tsx` +1.

- **2026-09-04 — Review: space out surviving siblings (user request).**
  Reported seeing 絶対's `reading_retrieval` → `cloze` → `reading_production`
  back to back. All three were FSRS `learning` (introduced 2026-09-02,
  rated "again" every sitting since), so the 2026-09-02 sibling-bury filter
  — which only holds back `review`/`relearning` siblings — left them all
  in, and due-sorted they landed adjacent. New `spaceOutSiblingCards`
  (`ReviewPage.tsx`, exported + unit-tested) greedily reorders the deduped
  due queue so no two cards share a `subjectType:subjectId` neighbour
  unless every remaining card does. Chosen over extending the bury filter
  to `learning` ("space them, don't cut them"). `reviewPage.test.tsx` +3.

- **2026-09-04 — Conflict panel: normalised key diff (user request).**
  `ConflictPanel` was clipping each payload at 1200 chars and showing local
  (domain, camelCase) vs. remote (raw Postgres row, snake_case) as two
  unrelated JSON blobs, so nothing lined up. New `src/sync/conflictDiff.ts`
  recursively camel-cases + sorts keys on both sides, then renders a unified
  LCS line diff (`− local` / `+ remote`, changed-line count) in an
  open `<details>`; the full un-clipped payloads stay available in two
  collapsed `<details>`. `conflictDiff.test.ts` +4.

- **2026-09-04 — Measured pitch overlay: moved up, playhead, loop button
  (user request).** The `MeasuredPitchContour` now sits directly under the
  sentence text (above the dictionary H/L row) on the `listening` /
  `word_listening` reveals and the shadowing surfaces. During playback a
  playhead (vertical line + faint band) sweeps the contour — the clip
  playing *is* the one the pitch was measured from, so `currentTime /
  duration` maps to the contour exactly (~16ms / one frame), no
  forced-alignment guesswork. Review cards get a "🔁 Loop sentence" toggle
  next to the contour (`nativeAudioController.play` gained a `{ loop }`
  option); shadowing surfaces reuse ShadowPage's existing controls.
  `SyncedShadowText` also gained the contour on its *main* return branch
  (feature 1 only wired the no-alignment fallback branch — a miss). Playhead
  tracked off `nativeAudioController.getCurrentTime()` (review, rAF) and the
  reference `<audio>` element directly (shadowing, rAF, alignment-
  independent). `tests/measuredPitchContour.test.tsx` +1,
  `tests/nativeAudio.test.ts` +2; 1148 tests green.

- **2026-09-04 — Looped word/segment audio front-clipped on every pass
  after the first (user report).** `playLoopedRange` (`src/lib/recording.ts`,
  behind `SegmentLoopPlayer` → the `pitch_accent` card reveal, the
  `word_listening` "Reveal sentence" isolated-word loop, and
  `PitchAccentNativeAudio`) restarted each loop by writing `currentTime`
  while the element was still playing — an imprecise seek on compressed
  audio (mp3/webm) that ate the word's attack a little more each pass,
  while a fresh page's first loop (seek from a *paused* element) was always
  clean. Now every restart pauses, seeks, and waits for `seeked` (with a
  250ms fallback) before resuming — the same path the first play takes —
  and a `restarting` guard drops the repeat `timeupdate`s that fire before
  the seek lands. `tests/recording.test.ts` loopRange test rewritten to the
  pause→seek→resume flow; 1145 tests green.

- **2026-09-04 — Content backlog worked (user go-ahead).**
  - **Pitch-accent:** filled 42 blank `vocabulary_items` (36 single-position
    Kanjium + 2 UniDic + 4 hand-set). `backfill:pitch-accent` now **skips**
    words where this Kanjium export lists multiple accents in an untrusted
    order (`positions[0]` is authoritative app-wide; e.g. 結局 came back
    `[4,0,0]` where 0/heiban is right) — prints them for a hand check
    instead. 89 items still blank (no Kanjium/UniDic match; no automated
    source).
  - **New-card backlog (207):** no change — `settings` is local-only, so the
    limit is a per-device Settings toggle. Recommendation: 30.
  - **4 homograph pairs:** decided **not** to merge — genuinely distinct
    context-dependent readings, not duplicate-bug rows.
  - **Grammar review queue:** re-checked clean 2026-09-03 (0 stuck; 2
    correctly vocab-gated).
  - New `npm run report:new-card-backlog`.

- **2026-09-03 — Settings destructive actions no longer dead on iOS PWA.**
  "Clear audio cache", "Remove local data from this device", and "Replace all
  local data" (backup restore) each gated on `window.confirm`, which silently
  no-ops on an installed iOS Safari PWA — the actions were unreachable there.
  New in-file `ConfirmButton` (two-step inline confirm, same pattern as the
  Analyze / BookDetail confirms) replaces all three; the destructive bodies
  are unchanged (backup-first, then wipe). `AuthAndSyncSettings` was already
  inline (2026-09-02). `tests/settingsPage.test.tsx` +1; 1145 vitest tests
  green. (Backup export/import itself already existed — nothing built there.)

- **2026-09-03 — Daily session recap.** `SessionRunnerPage`'s finished
  state now shows a short "Today you…" summary of what the day's session
  actually moved, under the existing "N of M activities completed" line.
  `src/lib/sessionRecap.ts` (`buildSessionRecap`, pure) + `getSessionRecap`
  (`repository.ts`, the only fetch) — activities completed per bucket,
  scheduled reviews graded in the session window + % recalled (natural
  encounters excluded, same filter as `progressReport.ts`), distinct
  vocabulary items whose first-ever review landed in the window, and
  sentences marked `grammarReviewStatus: confirmed` in the window. All
  recomputed from `Review` / `StudyItem` / `SentenceAnalysis` rows; nothing
  stored. Window is the session's own `[createdAt, endedAt ?? now]`. Hidden
  entirely when nothing measurable happened (`isEmpty`). Shadowing attempts
  deliberately excluded (user's pick). `tests/sessionRecap.test.ts` (7),
  `tests/sessionRunnerPage.test.tsx` (2); 1144 vitest tests green. Not yet
  browser-verified.

- **2026-09-03 — Native-clip measured pitch overlay (ROADMAP "Planned").**
  A real YIN pitch track of the *reference* recording, drawn under the
  sentence on the `listening` / `word_listening` review reveals and the
  shadowing surfaces (`SyncedShadowText`) — a genuine sentence-level pitch
  view with no prosody-model guesswork, complementing the per-word dictionary
  H/L marks (`SentencePitchAccentRow`). New local-only Dexie cache
  `referencePitchTracks` (DB v16, `ReferencePitchTrack` / `PITCH_TRACK_VERSION`
  in `src/lib/pitch.ts`, same version-gated derived-data precedent as
  `referenceAlignments`; not synced, survives a backup restore).
  `src/lib/referencePitchCache.ts` `loadOrComputeReferencePitch` mirrors
  `loadOrComputeAlignment` — cache → decode (`decodeAudioBuffer` +
  `canonicalizeAudioBuffer`) → `extractPitch` → save; never throws (no
  AudioContext / undecodable blob → overlay just doesn't render).
  `src/components/MeasuredPitchContour.tsx` draws the voiced contour in
  relative semitones (per-speaker median-normalized), broken into separate
  `<polyline>` runs across unvoiced gaps. `AnalysisPanel` opportunistically
  warms the cache when it computes the full-clip reference pitch (skipped for
  practice-target slices). `tests/referencePitchCache.test.ts` (3),
  `tests/measuredPitchContour.test.tsx` (4), `tests/data.test.ts` +2,
  `tests/reviewPage.test.tsx` +1; 1136 vitest tests green. Not yet
  browser-verified (no AudioContext in the sandbox).

- **2026-09-03 — "Notice grammar in this sentence" planner nudge (user
  request).** Grammar farming now has a sentence-level reminder, mirroring
  `vocabulary_review` for vocab. New `SentenceAnalysis.grammarReviewStatus`
  (`unreviewed`/`confirmed`, additive — migration
  `20260903000000_analysis_grammar_review_status.sql`, live on prod
  2026-09-03). `GrammarPicker` gains
  a "Done — nothing more to notice" / "Reopen grammar" toggle
  (`setSentenceGrammarReviewStatus`) and a "Reviewed" pill. New planner
  candidate `findGrammarNoticingCandidates` → `grammar_noticing` step
  (`SYNTHETIC_ACTIVITY_TYPES.grammarNoticing`, `grammar` bucket, deep-links
  to the sentence's Analyze page): a sentence marked `complete` in its book
  whose vocab is confirmed + proficient (same `getSentenceFullReviewReadiness`
  gate) but whose `grammarReviewStatus` isn't `confirmed`. The grammar bucket
  now runs two passes over one budget — corpus-flagged patterns
  (`buildUnderstandSteps`) first, then `buildGrammarNoticingSteps`.
  `GRAMMAR_NOTICING_CANDIDATE_LIMIT = 8`. `tests/data.test.ts` +2,
  `tests/sessionPlannerRepository.test.ts` +1, `tests/grammarPicker.test.tsx`
  +1; 1126 vitest tests green.

- **2026-09-02 — Grammar review: unready-context items no longer sit
  stuck-due, and Track is gated on sentence vocab.** Follow-up to the
  orphaned-study-items work: 4 live `grammarPattern`-subject study items
  (patterns `～ている（状態描写）` / `～を見つける`, both only linked to one
  `unreviewed` sentence) were correctly dropped from `/review`
  (`pickContextSentenceForGrammarPattern` → undefined) but still read as due
  — invisible backlog inflating the session planner and showing "Subject not
  found" on `/study-items/:id` for a client also missing the pattern row.
  Three-part fix: (1) `deferUnreadyGrammarReviews` (`src/db/repository.ts`,
  grammar twin of `deferUnreadySentenceReviews`) — pushes any due
  `grammarPattern` card whose pattern has no full-review-ready context
  sentence out ≥7 days; ReviewPage runs it alongside the sentence pass.
  (2) `getSessionPlannerInput` filters the same items out of its due-review
  batch read-only (`filterReadyGrammarDueItems`, since
  `planRecommendedSession` must not persist). (3) `GrammarPicker`'s **Track**
  button is now disabled until `getSentenceFullReviewReadiness` passes for
  that sentence, with an inline hint — grammar tracking waits on the
  sentence's own vocabulary being confirmed + proficient, so no new stuck
  cards get seeded. New `scripts/defer-unready-grammar-reviews.ts` (dry-run;
  `--apply`) — ran against production 2026-09-02 (4 items deferred);
  `scripts/resync-grammar-tables.ts --apply` re-run so affected clients
  re-pull the pattern rows. `tests/data.test.ts` +4, `tests/grammarPicker.test.tsx`
  +1; 1122 vitest tests green (2 skipped).

- **2026-09-02 — Grammar explanation Save button now gives feedback.**
  In `GrammarPicker`'s expanded "Explain" form the Save button was
  fire-and-forget — no in-flight state, no confirmation, no error handling,
  so after "Suggest explanation (AI)" you couldn't tell whether a save
  landed without refreshing. Added a `dirty` check (local buffers vs the
  persisted pattern/link), a `saveState` machine (`idle`/`saving`/`saved`/
  `error`), and inline status text next to the button: "Unsaved changes"
  while dirty, "Saved ✓" after a successful write, "Couldn't save — try
  again" on error. Button is disabled when clean or mid-save. Same feedback
  pattern as the Analyze sentence-status buttons (06833da).

- **2026-09-02 — WaniKani mnemonics removed.** Learning-in-context proved
  more useful than the Tofugu mnemonics, so the whole feature is gone:
  `ReviewPage`'s "Show mnemonic" scaffolding + auto-show maturity effect,
  `MnemonicText.tsx`, `src/lib/wanikaniMnemonic.ts`, both ingestion scripts
  (`import-wanikani-kanji.ts`, `backfill-wanikani-mnemonics.ts`) + their
  GitHub workflows, `scripts/lib/wanikani.ts` / `wanikaniCache.ts`, the
  mnemonic CSS, and the four related test files. Migration
  `20260902000000_drop_wanikani_mnemonics.sql` (live on prod 2026-09-02)
  drops `vocabulary_items.{meaning,reading}_mnemonic`,
  `kanji.{meaning,reading}_{mnemonic,hint}`, and the `wanikani_subjects`
  cache table. The `kanji`
  table itself and its Phase 2-imported readings/meanings stay (no live
  WaniKani integration remains). The `mnemonic_shown` `Review.assistance`
  value is retained as legacy so historical reviews still parse.

- **2026-09-02 — Analyze page: sentence-status buttons now give feedback.**
  "Mark in progress" / "Mark complete" / "Needs review" wrote
  `bookSentences.status` but nothing on the page reflected it, so clicking
  between them looked like a no-op. Added a live "Sentence status" pill next
  to the buttons (`SENTENCE_STATUS_LABEL`, reactive off the existing
  `membership` live query) and the button matching the current status now
  renders `primary` + `aria-pressed`. Also replaced the open-warnings
  `window.confirm` on "Mark complete" — a silent no-op on installed iOS
  PWAs — with an inline two-step confirm (`confirmCompleteWithWarnings`,
  same pattern as the delete confirm). `.status-pill.unstarted` style added.

- **2026-09-02 — Sync: pull no longer permanently skips events + a
  "Re-download from cloud" recovery.** Follow-up to the orphaned-study-items
  work: a `grammarPattern`-subject study item still showed "Subject not
  found" after a clean sync because the client's local `grammar_patterns`
  row was missing — `pullChanges` had once skipped that row's event
  (`shouldApplyRemoteEvent` false on stale `syncRecordMeta`: meta said
  "have v1", no row) and advanced its cursor past it forever.
  `src/sync/engine.ts`: (1) the "already have this version" skip now also
  requires `localRecordExists(entity, recordId)` — stale meta with a missing
  row applies instead of suppressing; (2) events skipped for a transient
  reason (pending write / open conflict) are stored in
  `SyncMetaState.deferredPullEventIds` and re-attempted at the top of every
  pull rather than lost (capped `MAX_DEFERRED_PULL_EVENTS` = 2000);
  (3) `applyFetchedRemote` writes record-meta at the fetched row's real
  version, not the (possibly stale) triggering event's. New Settings →
  Account & sync action **"Re-download everything from cloud"**
  (`AuthAndSyncSettings`, inline two-step confirm, backup-first,
  `replaceLocalWithCloud`) as the general escape hatch — previously only
  reachable from the first-run `MigrationModal`. Recovery already run
  against the affected data via `scripts/resync-grammar-tables.ts`.
  `tests/sync.test.ts` +1; 1143 TS tests green.

- **2026-09-02 — Sentence-delete cascade leaked orphaned study items.**
  Manual testing (`docs/MANUAL_TEST_LOG.md` item 2f) surfaced "grammar cards
  show as due but never appear in `/review`". Root cause: the 2026-09-01
  "After Work" / "GLIM SPANKY" sentence soft-deletes orphaned study items —
  `cascadeRetireSentenceLocal` only retired `subjectType: 'sentence'` items,
  not the `sentenceVocabulary`-subject per-occurrence cards (`word_listening`
  / `sentence_transformation`) keyed off the links it deleted, nor
  `grammarPattern`-subject items whose last live `sentence_grammar` link was
  in a deleted sentence — leaving them stuck-due and invisible
  (`pickContextSentenceForGrammarPattern` returns undefined → the pattern is
  dropped before the due-check). Fixed `cascadeRetireSentenceLocal` to retire
  both (grammar only when it was the pattern's last occurrence;
  `tests/applyResegmentation.test.ts` +2). New read-only diagnostics
  `scripts/diagnose-grammar-review-queue.ts` and
  `scripts/cleanup-orphaned-study-items.ts` (dry-run; `--apply` soft-deletes)
  — cleanup applied to production 2026-09-02 (45 orphans soft-deleted: 20
  `word_listening`, 22 `grammarPattern`, 3 never-reviewed vocab). The only 2
  grammar patterns still not surfacing are correctly vocab-gated (their one
  sentence is `unreviewed`). 1142 TS tests green.
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
| WaniKani mnemonics | removed 2026-09-02 (shipped 2026-08-29/30/31; learning-in-context replaced it) |
| Contextual conjugation cards | done; migration live 2026-08-30; coverage fix 2026-09-09 (see Recent changes — JMdict POS + truncated surface forms) |
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

**Not yet browser-verified** (typecheck/build/tests green; the user
verifies by hand during normal use — running log in
`docs/MANUAL_TEST_LOG.md`. As of 2026-09-02: read-only screens, the H/L
pitch row, and the planner new-card backlog are ✅; sibling burying ✅ on
iOS Safari but ⚠️ unconfirmed on Firefox — see the log):
- Mining wizard W1–W6 (covered by integration tests + build + typecheck).
- Contextual conjugation cards (`sentence_transformation` rework).
- Progressive listening `word_listening` cards.
- Cross-sentence pronunciation profile (`/pronunciation`).
- Planner new-card backlog reservation + ReviewPage seed-hold.
- Grammar production card (`grammar_production`).
- `reading_in_context` passage framing (`ReadingInContextCard`).
- Progress screen (`/progress`).
- Audio-less pitch-accent drill (`/pitch-accent`).
- Native-clip measured pitch overlay (`MeasuredPitchContour` on the
  `listening` / `word_listening` reveals + shadowing surfaces).
- Daily session recap (`SessionRunnerPage` finished state).
- Analytics pass 1: `/progress` "Blind spots" + "What to work on" panels,
  the shadowing→SRS `recordShadowingEncounter` bridge, and the
  `AttemptAnalysisSummary.wordIssues` per-word weakness signal.

**Data / content backlog:**
- **Review new-card backlog** — **207** confirmed vocab words have no SRS
  card as of 2026-09-03 (261 confirmed, 54 in the SRS). The planner fix
  landed 2026-08-31 (see Recent changes): the review bucket reserves
  minutes for the backlog and the review step stays open through seeding,
  so ~`newCardsPerSessionLimit` new words enter per daily session. Drains
  over ~11 sessions at the default limit of 20. **No bump made** — the
  `settings` table is local-only (not synced), so `newCardsPerSessionLimit`
  can only be changed per-device in Settings → "New cards per review
  session"; recommend 30 (~7 sessions) when ready to absorb the extra
  daily review load. Diagnostics: `npm run report:new-card-backlog`,
  `scripts/analyze-due-by-book.ts`.
- **Conjugation-card POS** — RESOLVED going forward 2026-09-09: the
  confirm path (`materializeVocabularySelections`) stores a synthetic
  conjugation tag via `inferConjugationWordClass`, so newly-mined verbs no
  longer need a backfill. `npm run backfill:vocabulary-jmdict-pos --
  --apply` is a one-off cleanup for pre-existing rows (already run once);
  `npm run diagnose:conjugation-cards` shows coverage (86 candidates /
  71 sentences as of 2026-09-09, most held by the vocab-readiness gate).
- **Grammar review queue** — re-checked clean 2026-09-03
  (`scripts/diagnose-grammar-review-queue.ts`): 0 stuck items; the only 2
  non-surfacing patterns (`～ている（状態描写）`, `～を見つける`) are correctly
  vocab-gated on their one sentence (`sent_959`, vocab not confirmed). The
  2026-09-02 fixes held.
- **Auto-caption fragmentation re-mine** — pre-2026-08-23 shadowing
  imports (After Work, First Day at Work, GLIM SPANKY) were systemically
  mis-segmented (auto-captions, no punctuation). Bulk re-mine through the
  new ASR pipeline is planned, not done.
- **Pitch-accent gaps** — **89** `vocabulary_items` have no
  `pitch_accent_positions` as of 2026-09-04 (was 131). Backfill applied:
  36 single-position Kanjium + 2 UniDic + 4 hand-set (結局 [0], 一番 [2],
  時点 [1], 押さえる [3] — the words `backfill:pitch-accent` now skips
  because this Kanjium export orders multiple accents unreliably, e.g.
  結局 → [4,0,0]). The remaining 89 have no Kanjium/UniDic match (proper
  nouns, rare compounds, expressions) — no automated source; app degrades
  gracefully (word just gets no contour / is skipped from pitch cards).
- **4 noun homograph pairs** (何 なに/なん, 羽 はね/わ, 話 はなし/わ,
  後 あと/ご) — **decided not to merge** (2026-09-04): these are genuinely
  context-dependent readings of different words/senses, not duplicate-bug
  rows like お母さん→おははさん. Merging would force one reading onto
  sentences that use the other. Two accurate dictionary entries in `/words`
  is the correct state; if the browse-view duplication grates, that's a
  homograph-grouping UI question, not a data merge.

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
