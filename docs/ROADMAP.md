# Roadmap

At-a-glance list. `STATUS.md` is the current-state snapshot,
`STATUS_ARCHIVE.md` the frozen chronological detail (files touched, test
counts, production-run logs), `AI_OVERVIEW.md` the feature-oriented
reference. Keep implementation logs in git history; retain unresolved decisions and
future ideas here. Update an entry when its scope or status changes.

Original phases match `docs/UNIFIED_APP_ARCHITECTURE.md` §15.

## Completed foundation

Phases 0–9 established the unified data model, imports, FSRS, vocabulary/kanji,
grammar, shadowing and pronunciation feedback. The daily planner, progress
panels, source resegmentation, podcast/NHK Easy import, read-along, pitch practice
and short games are implemented. The default sentence-led flow pauses the older
word/grammar card ladder; its code remains available when that setting is off.

Completed implementation logs and superseded designs have been pruned from this
living roadmap. See `AI_OVERVIEW.md` for current behavior, `STATUS_ARCHIVE.md`
for the frozen earlier history, and git history for later implementation detail.
The items below retain unfinished work, optional refinements and future ideas.

## In progress

- [~] **Phase 5 — Vocabulary/kanji relationships.** Implemented and covered by
  repository/component tests. The original interactive confirm-vocabulary
  manual verification remains unrecorded; retain it as a verification follow-up.

- [~] **Sentence-membership integrity (class of bug).** Detector, guards, the
  cascade-soft-delete migration and a manual `check-sentence-integrity.yml`
  workflow are in; prod has 0 dangling memberships / orphan clips (2026-10-17).
  Prod is consistent as of 2026-10-17 (`check:sentence-integrity` clean after
  `repair:chapter-recording-order`). Left: decide
  whether a dropped delete-op conflict should auto-retry.

- [~] **Passage-first learning and reviews.** Plan in
  `docs/SENTENCE_FIRST_LEARNING_PLAN.md`. First slice implemented on
  `feat/chapter-review` (merged to main): full-chapter vocabulary reading/cloze
  and grammar-recognition display, verified by unit/integration and container
  browser tests. Other activities and the learning/preparation model remain.
  Browser test instructions: `e2e/README.md`.

- [ ] **Source audio refinements.** Mining pipeline v2 and its Storage
  durability path (`app/source_backup.py`, private `source-audio` bucket) are
  implemented, enabled when the service has credentials. Keep offline
  whole-episode caching/adjustment improvements as optional follow-ups.
  Design: `docs/mining-pipeline-v2.md` / `docs/mining-wizard-spec.md`.

- [~] **Progressive glossing.** Slices 1-2 shipped 2026-10-01 (STATUS), including feasibility script, try-unaided, partial translation, self-report, park-and-prepare, readiness tiers, progress panel, heuristic の attachment skill, planner revisit. Left: AI-verified dependency reference and clause skills. Diagnostic refreshed 2026-10-15: 50/64 analysed sentences have a settled heuristic decision; attachment coverage is 25 の decisions. Pilot drafted 2026-10-16: 12 real sentences, 8 promising, 2 needing chunk repairs, 2 deferred for context/ambiguity; see `research/GLOSS_CLAUSE_PILOT.md`. References are self-reviewed drafts, not independently validated. Opt-in span-based preview shipped and expanded to all active unique sentences (365 questions, 64 reviewed notes as of 2026-10-17, after replacing 46 no-choice questions with connective-link questions and noting 29 too-short ones), including the repaired examples and missing-question notices; independent reference review still required before auto-grading. Helpful/disputed reactions sync as of 2026-10-17 (`clause_question_feedback`; `npm run diagnose:clause-feedback`) so the dispute rate can guide that review.

## Planned

Unfinished work and optional extensions; completed behavior is in `AI_OVERVIEW.md`.

- [~] **UI load-time and database performance tests, with Supabase usage budgets.**
  (2026-10-18: initial baseline harness and deterministic usage gates implemented.)
  Home/Books/Reader/Review now have repeated document, warm and offline-navigation
  measurements with small/large synthetic libraries in Chromium and WebKit.
  Real-Postgres sync and synthetic-transport audio tests enforce configurable
  request/body-byte ceilings. A [snapshot budget report](SUPABASE_BUDGET.md)
  now projects usage with configurable headroom; a first manual snapshot
  (2026-10-19) was within allowance, with storage growth to investigate, and
  automatic retrieval remains outstanding. Timing gates are unfinished.
  The first measured Review bottleneck is addressed by
  loading history per active card; see [the comparison](PERFORMANCE_REVIEW_FOLLOWUP.md).
  Commands, measurement boundaries and follow-ups:
  [PERFORMANCE.md](PERFORMANCE.md).
  Catch slowdowns as the library grows
  and prevent routine study/sync from exhausting the available Supabase usage
  early in the billing period. Build on the test setup in [TESTING.md](TESTING.md).
  - **UI:** measure cold startup, warm navigation and time until useful content
    and controls are ready on Home, Books, Reader and Review. Use representative
    small/large libraries, phone/desktop profiles and offline/slow-network
    scenarios. Separate local rendering/data access from background sync and
    audio loading; record repeated-run median and p95 timings.
  - **Database:** benchmark IndexedDB reads/writes in a real browser and the
    sync/Postgres paths with realistic fixture sizes. Cover review-queue building,
    opening a long chapter, import/commit, first sync, incremental sync and
    reconnect. Track query/request counts, rows and bytes transferred alongside
    latency; inspect query plans for server hotspots. Catch repeated per-row
    queries, full-table reloads, unnecessary polling and redundant audio transfers.
  - **Supabase budget:** set configurable per-scenario budgets for requests,
    transferred bytes, storage growth and relevant function calls/retries. Model
    normal study, imports, background activity and multiple devices, then compare
    projected period usage with the project's actual usage and current plan
    allowances/reset dates. Include other consumers of the shared project and
    reserve headroom, with an early warning when projected usage exceeds budget.
    Request counts alone are not a quota or billing model; identify the actual
    metered resources when implementing this.
  - **Regression checks:** establish measured baselines before choosing limits.
    Use deterministic count/byte budgets in CI and repeated, controlled timing
    runs with tolerances to avoid flaky gates. Keep routine tests on synthetic
    local/disposable services; use a separate read-only account-usage check for
    real consumption so the tests themselves do not burn the production budget.

- [~] **Clip-audio storage headroom and Cloudflare R2 migration.**
  (2026-10-19.) Supabase Storage was about 893 MB of the 1 GB Free allowance,
  mostly `reference_audio` clips at roughly 192 kbps AAC. Lower-bitrate trials
  remain an option; see PERFORMANCE.md "Storage headroom". **Done 2026-10-20:**
  the Worker gateway is deployed with a usage ledger and limits, all 2,847
  reference-audio clips are copied and verified in R2, the deployed app writes new
  clips to R2 and reads R2 first, the maintenance scripts use the same helper, and
  `npm run report:r2-usage` reads Cloudflare analytics (details and the live
  results in the [R2 plan](CLOUDFLARE_R2_PLAN.md)). **Remaining, in order:**
  - Done 2026-10-21: the Supabase copies of reference audio were deleted (about
    690 MB; R2 is now the only copy of live clips). Still to do: confirm the
    Supabase dashboard storage figure has dropped and refresh the budget
    snapshot. R2 has no second copy: `npm run backup:r2-audio` now mirrors the
    clips to the box (first full run 2026-10-21, 3,126 clips). Still to do:
    schedule it daily (a systemd user timer like the usage report's; not
    installed), write a restore script and rehearse a restore, and decide
    whether a truly offsite copy (another provider or another machine) is
    needed, since the mirror shares the box with the services.
  - Create the Cloudflare budget alert (Manage Account, Billing, Billable Usage;
    the user's account setting). It only notifies; it cannot cap spending.
  - Install the daily usage-report timer on the box: pull the main checkout, then
    follow `cloudflare/r2-gateway/README.md`. Optionally set `R2_ADMIN_TOKEN` in
    `.env` so the report also compares the gateway ledger with Cloudflare.
  - Show R2 and Supabase usage in the app's storage settings. Needs a server-side
    feed; never put the gateway admin token or analytics token in the browser.
  - Optionally move the drill-take and source-episode buckets (about 200 MB)
    onto the gateway; they use separate paths
    (`src/sync/drillTakeRemote.ts`, `src/lib/sourceEpisodeCache.ts`, the box's
    source-audio mirror) and would need their own key rules and copy runs.
  - Optional live checks of a book member reading another user's clip and of the
    limit refusals at their ceilings. Low priority while there is a single user
    and no shared books; the unit tests cover both.
  - Re-run the usage report after the Supabase delete to confirm Supabase storage
    dropped, and refresh the Supabase budget snapshot (docs/SUPABASE_BUDGET.md).
  - Lower-bitrate re-encoding (mono 64k trial results in PERFORMANCE.md) is now
    only a way to shrink R2 storage, which has 10 GB free; not needed soon.

- [ ] **Learned practice routing above FSRS.** (2026-10-18 research;
  stage 0 evidence audit run 2026-10-19 — thin data, see the research note;
  no routing implemented.) Keep FSRS for review timing; learn which
  exercise, easier variant, or helper improves later independent performance.
  Start with the sentence-led flow and existing review/gloss evidence.
  First audit and connect attempt → help → delayed check data, then introduce
  a few explainable routes, learn their effectiveness with shared evidence,
  and compare them against fixed rules before expanding scheduling authority.
  The graph must distinguish content relationships from measured learning
  effects; assisted success does not establish unaided recall, and related
  cards must not receive automatic FSRS credit. First experiment: does targeted
  help after a sentence miss improve the next independent attempt and transfer
  to another sentence using the same skill, for the time spent?
  Findings, data contract, phased acceptance criteria, evaluation design,
  implementation pointers, open questions, and primary research sources:
  [Adaptive scheduling research](ADAPTIVE_SCHEDULING_RESEARCH.md).

- [~] **Review trouble tags and remediation queue.** (2026-10-20 brainstorm;
  prototype shipped and CI-green the same day, `3285d3a`. Preferred over the
  graph/learned-routing approach above because the learner names the weakness
  instead of the system inferring it.)
  **Where it stands:** optional Reading/Meaning/Kanji chips on the review
  card (shown after reveal, before rating, never affecting the rating).
  They queue a Fresh try (walked-through sentences only). The Sound chip and
  `settings.shadowRequests` were removed 2026-10-31. Tag use is logged in the local-only
  `reviewTroubleLogs` table. Details and limits: STATUS.md. Not yet checked in a
  browser on phone or desktop.
  **Next, in order:**
  1. **Progress notes from the tag log (panel shipped 2026-10-21; now use it
     for about a week).** A read-only `/progress` panel: tag counts, how often each
     queued follow-up was actually done, and whether tagged sentences' later
     ratings improved. Use about a week of real use to judge whether tags are
     accurate enough to build on. Judge the evidence honestly: a sentence's next
     rating is not proof the follow-up caused the gain.
  2. **Soft gate.** Surface pending remediation shortly after the review (same
     day or next); if undone when the card falls due, show the card anyway.
     Check against real data that it cannot starve a gate before shipping.
  3. **Sync** `reviewTroubleLogs` (needs a Supabase migration, RLS and the sync
     mappers) once step 1 shows the tags are worth keeping.
  4. **Word-level tags.** Tap the problem word. `reading_in_context` already
     records "Missed reading" word taps, so check whether those can double as
     the Reading tag before adding a second mechanism.
  Motivation: shadowing and walkthroughs are what make readings and meanings
  stick, but doing them right before a review defeats FSRS spacing (the review
  then tests short-term memory). Run remediation *after* a failed retrieval.
  - **Tags:** after Hard/Again on a review, offer optional chips (reading,
    meaning, kanji form), ideally tapped on the problem word in the sentence
    (`reading_in_context` is sentence-level). Skipped on Good/Easy so the fast
    path stays one tap. Keep the explicit FSRS rating: tags are supplementary
    evidence, never an auto-derived rating (house rule). Replacing the four
    buttons with checkboxes alone would be a deliberate change to that rule.
  - **Remediation queue, not FSRS cards:** walkthroughs have no recall grade, so
    scheduling them as FSRS items would pollute stability. (Shadowing became a
    self-rated `shadowing` review card on 2026-10-30; the Sound tag was
    removed 2026-10-31 rather than rerouted. Open: a scheduled recheck of the
    walkthrough's unaided step as its own FSRS item.)
    Use per-sentence flags (e.g. needs-walkthrough, needs-shadow) set by the
    tag and cleared when the activity is done. Reading/meaning trouble routes
    to a walkthrough; fluency/sound trouble routes to shadowing. Doing them
    gives no FSRS credit to the review card or related cards.
  - **Soft gate:** surface pending remediation in the session shortly after
    the review (same day or next). If still undone when the card falls due,
    show the card anyway; a hard gate risks the starvation failure seen with
    other readiness gates, so check eligibility against real data first.
  - **Shadow coverage:** independently, order shadowing by fewest prior
    shadows; flagged sentences come first, then lowest shadow count.
  - **Open:** whether to drop the four rating buttons later, and whether
    word-level tags should feed per-word weakness analytics.

- [~] **Grammar links: seeing one pattern across many sentences.** (2026-10-31;
  motivation: the walkthrough explains each sentence's grammar once, and nothing
  helps the learner extract and generalize a pattern across sentences.)
  **Built:** book-assistant "Grammar links" extra writing unconfirmed
  `sentence_grammar` rows with spans (STATUS.md). **Next, in order:**
  1. **Show links only after the walkthrough.** A "Patterns here" block on the
     walkthrough finish screen with a quiet "not this" dismiss. A display rule,
     never an eligibility gate. Hide `ai_suggested` patterns from the grammar list
     until a walked-through sentence uses them (new proposals are created
     automatically).
  2. **Pattern page as a comparison.** On `GrammarPatternDetailPage`: aligned,
     highlighted examples across walked-through sentences ordered simple to
     complex, plus a "what varies" grouping by the per-sentence notes.
  3. **"Seen before" as a real link.** The walkthrough's recurrence count shows
     the earlier sentences inline with the pattern highlighted.
  4. **Tag patterns while writing new walkthroughs** so new sentences need no
     separate run (an optional pattern field per walkthrough step).
  Ideas not chosen: linking one sentence at a time with `grammar-assist` at
  walkthrough completion (extra API cost); seeding names from OpenJLPT grammar
  JSON (CC BY-SA 4.0, github.com/evanclan/OpenJLPT; textbook-style, misses
  casual patterns, would lengthen every prompt) — revisit if the assistant keeps
  proposing patterns a reference list would have covered; deterministic
  morphology matchers for the commonest constructions; a "spot the pattern"
  contrast step (the parked discrimination idea). Open: the assistant also
  proposes connective words (そして) as patterns; tag those `no-auto-link`.
  Manual check once built: run the extra on one book, confirm spans highlight the
  right words and a NONE sentence is not re-sent.

- [ ] **Deterministic-id and sync-test follow-ups.** Existing get-or-create
  entities use deterministic ids. Optional extensions: `study_items` (whose
  FSRS state needs care) and `sentence_vocabulary` still use random ids.
  Consider making `test:pg` a deployment gate if its image-pull cost is acceptable;
  it currently runs independently on relevant pushes and pull requests.

- [~] **Short games (`/play`) — remaining extensions.** The hub, picker,
  individual games, local round log, planner breaks, progress panel and adaptive
  pool depth are built. Keep games cued and separate from FSRS grading. Future
  work and ideas from the original design:
  - Sync `game_rounds` after usefulness is established; explicitly offer
    "Queue misses for review" to seed cards without grading them. Eventually
    evaluate game misses as planner weakness evidence (the riskiest phase).
  - Replace the fixed three-minute break estimate with per-game timing, add a
    Settings toggle/frequency, and consider weak-skill selection instead of day
    rotation. Breaks already displace requested session time. A rolling rounds
    count versus a streak remains an optional product choice.
  - Verb Lego: add 〜たくなかった / 〜でした pieces and a reverse "which piece
    is the passive?" mode; preserve careful aux-lemma labelling.
  - Ear Tiles: slower replay, per-phrase replay when alignment spans exist, and
    ways to include sentences rejected for too few phrases.
  - Unbuilt candidates: **Draft Day** (choose backlog words to adopt) and
    **Pair Sort** (only when discrimination errors justify it). Earlier ideas
    deferred for overlap or size remain possibilities: Connections, Furigana
    Fog, Gremlin Hunt and Ghost Run.
  - Re-measure eligible pools rather than relying on the September feasibility
    counts. Speaker Match needs the same word in multiple non-suspended books;
    Word Detective's multi-context weakness pool can also be thin. Eligibility
    must run before ranking, with an explanation and fallback for a small pool.
  - Browser verification remains useful: run a weak round, check that its reason
    matches the evidence, verify no review/study-item writes, and exercise the
    small-pool fallback. New game gates should respect the default sentence-led
    flow rather than depend on paused word-card history.

- [ ] **Grammar pattern discrimination card.** (2026-09-17, follow-up to
  the `grammar_completion` recall redesign) A second retention target
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
  **Checked 2026-09-28: not justified yet, stays unscheduled.** Prod data
  is far too thin to tell either way — only 2 live `grammar_completion`
  items (13 more soft-deleted 2026-09-02, not real history), 13 reviews, 6
  misses. More importantly, `grammar_relationships` has **zero rows of any
  type** in prod — `commonly_confused` links are only ever created by a
  manual "link patterns" action on `GrammarPatternDetailPage` and nothing
  has populated any yet, so the card's proposed data source doesn't exist
  regardless of error volume. Separately found: `classifyReviewError`
  collapses every `grammar_completion` typed-mismatch into one
  `grammar_misunderstanding` bucket — there's no discrimination-specific
  error classification, so `errorMix`/the error-mix view can't actually
  surface this signal even in principle; answering "do discrimination
  errors show up" requires reading `Review.responseRaw` by hand, which is
  what this check did (`grammar_completion` grades via
  `isGrammarPatternAnswerCorrect` but does persist the raw typed answer on
  `Review.responseRaw`/`expectedAnswer`). One recurring miss surfaced
  (3× typed "～だろ" for ～ている（状態描写）) but doesn't map onto a curated
  confusable pair since none exist. Revisit once `grammar_completion` (a
  young redesign, 2026-09-17/22) has real volume across more patterns —
  and if `commonly_confused` links get seeded some other way (manual
  authoring, or an AI-suggested pass) in the meantime, that would remove
  the bigger blocker on its own.
  - **Root cause of the low `grammar_completion` volume fixed 2026-09-28** —
    see the grammar section in `AI_OVERVIEW.md`. The
    dominant cause turned out to be 68% of annotated patterns sitting
    Track-eligible and simply forgotten, not the readiness bar or a lack of
    annotation. Should raise `grammar_completion` volume organically over
    time; `commonly_confused` still needs its own separate seeding
    mechanism (manual authoring or AI-suggested) regardless.
- [~] **Podcast mining — remaining refinements.** RSS selection, episode titles,
  ASR fallback, difficulty screening and the longer ASR timeout are implemented.
  The earlier 10–20 minute episode checks succeeded; preserve chunked
  transcription beyond roughly 30 minutes as an optional future design.
  - Direct podcast URLs still lack the YouTube-id-based "already imported"
    warning. Feed episode badges/chapter dedup are separate; extending the raw
    URL warning remains a low-priority refinement.
  - Bare audio URLs can lack useful titles/durations, and some RSS feeds omit
    duration tags. Retain optional metadata handling; public RSS discovery is
    useful for supported shows, while feedless sources need another approach.
  - The old `sentence-realign` blank-row/truncation fixes are in the source.
    The 2026-09-13 deployment handoff has not been verified in this audit;
    check deployment state before treating it as either complete or pending.
  - **Speaker labels for conversation podcasts (parked 2026-10-27).** Goal:
    label who is speaking in two-person podcasts. Not built; no app or service
    code changed. A CPU-only trial on `codex-dev` (scratch scripts, not in the
    repo) showed the following.
    - Pipeline: keep `large-v3-turbo`, add pyannote `speaker-diarization-community-1`
      (gated on Hugging Face; needs an accepted-terms read token). kotoba-whisper-v2.0
      (CTranslate2 build) was worse than turbo on one clip; v2.2 needs
      `trust_remote_code`, and the transformers path was unusably slow on CPU.
    - Cost: about 1.8x audio length for ASR plus diarization on CPU, ~3 GB peak
      RAM (tight next to the aligner). With word timestamps (~3x ASR) a 17-minute
      episode would take roughly an hour. No GPU needed for two-person podcasts;
      a rented GPU is the first thing to try if quality proves good.
    - Quality: long turns label cleanly. Short backchannels and overlap are
      inconsistent. Naive per-word splitting on turn boundaries cut sentences
      mid-phrase (574 cues became 684 rows), so it needs smoothing (minimum run
      length, prefer pauses/punctuation) before use. Unverified: the third host
      in the coten radio episode was never detected as a separate speaker.
    - Open items: hand-label a few minutes of audio as ground truth to compare
      per-segment, per-word and smoothed labelling; make it opt-in per source
      with a speaker count (skip for single-speaker sources, `num_speakers=2`
      for two-person ones, since pyannote can invent phantom speakers); run it
      as a separate step after transcription so the ASR timeout is unaffected.
      Whisper sometimes prefixes cues with names (ヤンヤン, 樋口); these did
      not match the diarized speakers reliably and should not be treated as
      labels.

- [ ] **NHK Easy import refinements.** Import, translation and commit are built;
  articles/episodes share a series book, with imported badges and chapter dedup.
  Preserve the optional long-input idea: split audio at silence gaps and align
  matched paragraphs if articles outgrow the aligner's transcript cap. Paragraph
  text splitting alone cannot locate corresponding audio without alignment;
  pauses need not coincide with paragraph breaks, so validate that assumption.
  Bulk feed import still needs throttling and pause/resume design. Existing
  single-episode books can be merged manually; bulk/automatic retroactive merge
  remains an optional extension. Per-chapter coverage is tracked below.

- [ ] **"Ready to read" coverage refinements.** Book-level known-word coverage,
  easiest-first sorting and planner tie-breaking are built. Preserve per-chapter
  coverage and cross-book recommendations ("read X before Y") as optional work.
  Browser checks of the difficulty checkpoint and easiest-first book sorting
  remain a coverage gap; pure/repository tests do not verify these screens.

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
  - ~~**Ichidan `plain_past_negative`.**~~ **Closed 2026-09-28** — verified
    against real Wiktionary data (食べる/見る/出る/開ける): the same
    "carries the negative form's value forward" rule holds for ichidan too,
    just built on ichidan's own `plain_negative` value. See STATUS.md.
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
  - [x] **Calibrate the drill scorer against native clips** (**done 2026-09-21** — learner grader now uses `gradeLearnerMorae`: fit rescues false mismatches, flat takes flagged; see STATUS; remaining text below is history) (*new, from the
    audit*; **partly done 2026-09-20** — exact mora intervals from the aligner's phones took native-clip
    agreement 35% → 40%, and a valid-shape least-squares fit (`fitAccentShape`, native audio only) 56%;
    still open: the *learner* grader (`classifyLearnerMorae` → `buildPitchAccentShapeObservations`) still
    uses the per-mora-vs-mean rule, i.e. the 40% one, incl. 4-mora heiban at 10% — see STATUS 2026-09-20). The audit is also a validity test of the free drill's grader: run on
    native speakers' own clips it disagrees with the dictionary ~63% of the time
    (4-mora heiban almost always), so it can mark a *correct* production wrong.
    Candidate fixes to try against this benchmark: detrend declination before
    bucketing, use median not mean, snap buckets to alignment phone/mora
    boundaries instead of equal widths, drop octave-error frames, and require ≥80%
    agreement on clean native clips before trusting a category. Until then treat
    drill "mismatch" verdicts on long/heiban words sceptically. Do this before
    building anything that leans on the same measurement (below).
  - [x] **Gate/rank `pitch_accent` cards by measured cue strength.** (2026-09-22)
    New `SentenceVocabulary.pitchCueSeparationSemitones` (nullable, citation-form
    occurrences only), backfilled offline via `scripts/backfill-pitch-cue-strength.ts`
    (reuses `measureNativeWord`, the same rule the audit script and drill scorer use).
    `ReviewPage`'s `buildPitchAccentCandidate` skips an occurrence whose clip is known
    weak (< 1.5 st, same threshold `audit-pitch-accent-clips.ts` uses) — same "gate
    cards missing support" stance already applied to missing audio and phrase-final
    heiban/odaka — and `getPitchAccentReviewCandidates` prefers the strongest-cue
    occurrence when a word has several. First prod run: 165/328 eligible links
    measured (rest: no usable span/alignment, or too little voiced signal), of which
    **80 (48%) were below the weak threshold** — confirms the audit's earlier "57%
    weak" finding and means this gate has real bite. Undefined (not yet measured) is
    never gated — only a known-weak clip is skipped.
  - [x] **Continuous scoring in the drill.** (2026-09-22) `compareFallToNative`
    (`src/lib/pitchContinuousScore.ts`) compares the learner's take to a real native clip of the same
    word (fall timing error in morae, fall magnitude as a ratio of the native's contrast — both already
    relative-to-own-median semitones, so no extra per-speaker normalization is needed), shown under
    both the pass and mismatch feedback branches so progress shows even while the categorical grade is
    still wrong. Logged per attempt (`PitchDrillAttempt.fallTimingErrorMorae`/`fallMagnitudeRatio`) for
    a weekly trend in `report-pitch-drill-effectiveness.ts`; data starts accumulating from this point on.
    See STATUS.md.
  - [x] **Weighted practice + auto-play + long-word scaffold.** (2026-09-27,
    from a full weakness scan across `reviews`/`study_items`: d′ = 0.35 on
    hl-vs-lh — still essentially the "no discrimination" reading from the
    2026-09-19 pull above — and long shapes far worse than short ones,
    `lhhl` 36%/`hll` 40% vs. `hl`/`lh` 53-61%.) `PitchAccentDrillPage`'s
    word-mode pool now surfaces 2-mora words ~2x as often
    (`weightedSeededShuffle`); the "what your pick sounds like" miss
    contrast now attempts to auto-play instead of waiting for a second
    click (only 6 of 48 offered were ever manually played); the
    `pitch_accent` SRS card gates 4+ mora words behind a coarse early-half/
    late-half picker before showing individual fall-position buttons, so a
    long word never compares more than ~3 contours at once instead of up to
    6. See STATUS.md 2026-09-27 for the full writeup, including the
    autoplay-safety fix this needed (`DOMException instanceof Error` isn't
    reliable across engines).
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

- [~] **Word-audio ground truth: a hand-labelling workflow.** *Screen built 2026-09-20 (`/label-word-audio`); first 52 random labels analysed the same day (STATUS) —
  more labels would firm up the tails. To read a new file:
  `npm run analyze:word-boundary-labels -- <saved file>`.* (2026-09-20, from the
  word-audio precision pass.) Everything measured so far is agreement between methods (two
  ASR judges that disagree with each other); ~60 hand-labelled edges would give real error
  numbers and decide the open questions: pad size, whether mora cuts under ~250 ms are good,
  whether pitch cards should keep whole tokens, whether accuracy varies by speaker. Design:
  - **Reuse what exists.** `WordAudioRangeEditor` already has waveform, draggable edges and
    snap-to-pauses; `SegmentLoopPlayer` has the loop + pitch-preserving speed; a saved edit is
    already the synced override (`audioStartMs/EndMs`) — but **labels are not written there**: an
    override is a pitch card's whole loop range (word + ending), a label is the strict word. Gaps: its waveform covers the whole sentence (100 ms ≈ 10 px), so add a zoomed
    ±400 ms view per edge, ± nudge buttons (10 ms / 1 ms; arrow keys on desktop), an energy /
    spectrogram strip, and per-edge *audition* buttons (play 300 ms **outside** the edge — should
    contain none of the word — and 300 ms **inside** — should begin with its first sound).
    Decode a trimmed ±1.5 s window, not the whole span (iOS `decodeAudioData` limit).
  - **What to label, per item:** target *start* and *end* (each: clean / early / late, nudge if
    not clean); item flags — wrong word, audio doesn't match text, overlapping speech, too noisy
    (skip, and record as data-quality signal). Optionally the *mora boundary* between the
    target's last mora and the rest of its token, only where a consonant onset makes it well
    defined (never inside long vowels/geminates).
  - **Instructions (one line + tap-to-expand audio examples, per label type).** START: "the
    earliest moment you hear the first sound of the word, with nothing of the previous word
    before it" (stop consonants: the burst counts). END: "the moment the last sound has died
    away, before the next word begins; a whispered/devoiced final vowel counts." MORA: "between
    the last sound of the target and the first sound of what follows."
  - **Candidate selection (as built — randomised, never hand-picked).** Two samples, both random: (a) *random* —
    book-stratified over everything (overall accuracy); (b) *tricky cases* — random within each situation we
    want to check (flagged timing, target ends mid-token, very short word, repeated word, digits/Latin),
    equal allocation across situations. Each label records its `stratum` + how common it was, so
    per-situation rates are valid from either and can be re-weighted. A worst-first list, or a fix made
    because a clip looked wrong (Adjust), is deliberately **not** gold — a selected-because-bad sample can't
    be generalised from. The 21 existing hand-adjusted overrides are therefore *not* free gold either.
  - **Storage (as built).** Device-local Dexie table + a "Save labels" file export (no cloud sync, no
    migration — the user's call). Each label stores the auto span *shown* and `spanVersion`, because auto
    spans drift as code changes. The saved files are the only copy that leaves the device: keep them.
  - **Per speaker?** There is no per-clip speaker identity; `Book.id` is the proxy (already used
    by the perception games). Test before building: label ≥10 per book, check whether per-book
    median signed error differs from the global one (bootstrap). If not, one global pad is
    enough; if so, store per-book offsets. Speech rate (phones/sec from the alignment itself)
    may predict error better than speaker and needs no per-speaker labels.
  - **Effort.** Target ≤15 s per item when the auto span is right (one tap), ~40 s to correct;
    sessions of 25 (~10 min). First analysis: 60 items (40 random + 20 targeted). Re-present ~8
    items later, blind, to measure your own labelling noise — it bounds any accuracy claim.
  - **Outputs.** Error percentiles per edge type (start/end; adjacent vs pause; token vs mora),
    per-book bias, pad calibration (p90 of signed error, capped at the neighbour gap), the
    verdict on short mora cuts and on token-vs-mora for pitch cards, and a **gold set** so a
    future change (kalpy `fine_tune_alignments`, `tokenizer=None` re-alignment, a new model)
    can be benchmarked in one command.
  - **Next: test estimator ideas against the gold set (2026-09-20 idea).** Give the models *context* —
    the words around the target — and let them place the boundary, instead of judging a bare clip
    (the CTC judge only worked once padded with silence, i.e. it wants context):
    (a) *CTC context alignment:* run the kana CTC model on the whole sentence (its comfort zone), force-align
    the known reading (`inlineReading`) to its frame posteriors, and read the target's per-mora times — an
    independent, mora-level estimator to compare/combine with MFA; (b) *CTC likelihood search:* a window =
    target + neighbouring words, score candidate [start, end] by the CTC log-likelihood of the expected
    kana, shifting each edge by mora/word steps and taking the best — a tight window that still contains
    every mora of the target should win; (c) the same with Whisper (cross-attention word timestamps /
    round-trip on shifted windows) as a second opinion. None of these can be judged by the ASR judges
    alone (they disagree on 30 of 68 pairs); with ~40 gold labels each becomes a one-command comparison
    against `token` / `mora` in `analyze-word-boundary-labels.ts`. Build them as extra estimators only
    if they beat the mora cut on the gold set.
  - **Follow-ups from the first 52 labels (2026-09-20).** (1) *Squashed-alignment detector — BUILT 2026-09-20 (STATUS); to verify with new labels:* the worst
    misses (~1–1.7 s) are the aligner mis-timing a stretch of speech (drawled 「ちょっとねー」, Latin `VIP`),
    which shifts every later word — a gate on implausibly fast tokens (~40 ms/mora vs ≥80 normal) or
    long `<eps>` next to very short tokens could send those to the whole-sentence fallback instead of a
    confident wrong span; needs more labels to set thresholds. (2) *Repeated surface form — CLOSED, not a bug
    (STATUS 2026-09-20):* `matchWord` takes the first occurrence; 2.5% of links (33/1334) have the word
    twice, but a link is one row per word per sentence and never says which occurrence, so each is an
    equally valid native example. The labeller now says "appears N times — label the first". (3) *Early starts:* leading breath/noise absorbed
    into a word start (今日 +510 ms, いろいろ +270 ms) — a trailing-energy trim on onset is the candidate.
  - **Proactive "needs fixing" list (2026-09-20 idea).** The squashed-alignment guard is a pure function
    of a cached alignment + a link, so it can run for every link when an alignment is stored (mining
    commit, backfill, re-alignment) — a count on the book page / Analyze ("12 words have unreliable
    timing") opening the zoomed editor one word at a time (the labelling screen's "Needs review" queue is
    already that, minus the card-loop override semantics). Resolved: a hand fix does **not** also count as a
    strict-word label — the gold set stays randomised (see Candidate selection).
  - **UI rules (from your preferences).** One Play/Stop toggle (not paired buttons); controls
    beside the content they act on; no `window.prompt`/`confirm` (dead in the iOS PWA);
    gesture-gated audio; progress + undo-last; a "why this item" chip.

- [ ] **Read-along optional extensions.** The reader already supports per-sentence
  play/loop and karaoke with furigana. Earlier coverage-gated ideas remain
  deferred: per-chapter coverage, a sticky first-reached unlock, a `/progress`
  "chapters ready to read" list, and a second stricter/furigana-off threshold.
  The reader itself stays ungated.

- [ ] **Dropped clause-final connectives in mined sentences (follow-up).**
  (2026-10-23.) The quick-import AI turned "…始めましたが、今は…" into
  "…始めました。今は…", silently dropping が (found on Episode #24). The importer
  prompt now forbids dropping spoken words, tells the assistant to keep Whisper's
  punctuation when the fragments already have it (`looksPunctuated`; podcast
  sources get their text from Whisper, not a transcript), and
  `checkCombinedReply` warns in the
  review stage (`findDroppedConnectives`); source and local tests only, not yet
  seen on a live import. Existing data: the 12 confirmed pairs (Slow Japanese
  Episodes #24 ×2, #21 ×2, #58 ×2, #53, #45, #26 ×2, #46, #23) were merged on
  2026-10-23/24 with `scripts/merge-adjacent-sentences.ts` (pairs in
  `scripts/data/merge-pairs-2026-10-23.json`; the Re-segment page cannot do this —
  it rebuilds a whole book as one source). Verified by row checks against
  Supabase, not played in the app. The merged sentences start with no extras
  (analysis, structure, walkthrough) and no word-alignment, so those need
  regenerating. Unfinished: (1) Episode #24 at 342 s (なり、そして、) is
  unresolved; (2) **Wider scan** — the first pass checked
  only the last ~3 s of each clip against が/から and a strict filter, skipped the
  YouTube sources (~420 clips) and one 403 podcast source, and did not cover けど/
  し/ので. (3) **Boundary check from audio + grammar** — a UniDic check that allows
  a split only after a final verb form or sentence-final particle (not after a
  connecting particle) unless a long pause backs it, using word timings, to
  flag or move AI-chosen boundaries; also removes the whole-second `[m:ss]`
  timing slack. Not started; build only if the prompt/warning proves
  insufficient. Rejected: swapping the ASR model (SenseVoice/Cotoba) — Whisper's
  own text kept the が.

- [ ] **Other retained foundation follow-ups.** Finer per-word accent-class
  pronunciation statistics need more persisted attempt detail. Grammar prediction
  and transformation activity types remain unstarted. The older progressive
  word-listening card still needs a recorded browser verification.

## Possibilities (sentence-led flow follow-ups)

- **Writing ladder (native-clip anchored).** The audio ladder now uses `ear_tiles` followed by `dictation_tile:N` (2026-10-18): reconstruct the clip, then type one missing phrase. Whole-sentence dictation is retired. Next rungs, only if dictation proves useful: (2) *reconstruct from cues* — show the sentence's content words and/or its translation and rebuild the sentence, then reveal the native version (no free composition, always compared to a real sentence); (3) *shadow-then-vary* — after a shadowing pass change one slot (subject/tense/noun) and check it against vocab/grammar constraints; hardest to grade, so last. `grammar_production` (free composition, retired) is the cautionary precedent: always anchor to a native sentence. Open question for dictation: whether to count the typed match toward `/progress` (e.g. a dictation pass-rate panel) — currently only visible via `Review.responseRaw`/`expectedAnswer` and the `listening_failure` error class.

- **Reverse English -> Japanese exercise (not built, by design).** Would show an English meaning and ask the learner to pick/produce the Japanese. Constraints if ever built: the Japanese must be unchanged real source material (no generated Japanese distractors); candidates must pass an ambiguity check (an English sentence that several source sentences could translate is excluded); no auto-rating (house rule: self-rate).
- Bank coverage: shipped 2026-10-02 (book-page "Meaning choices: bulk generate" panel with copy/paste and AI-now, plus background auto-generation for sentences with no check). Remaining: auto top-up of thin banks (manual only today) and wiring generation directly into each import commit instead of the background worker.
- Sequential mode: latch from the planner too (it is read-only today) and expose a per-book "reset unlocks".

## Possibilities (analytics & cross-activity coherence)

Unfinished ideas from the 2026-09-08 discussion. Shipped progress panels,
error routing, reveal helpers and deep-dive details are in `AI_OVERVIEW.md`.
These extensions remain unscheduled:

- **FSRS calibration and a desired-retention control.** The confidence panel
  and per-review predicted-retrievability logging are built. Predicted-versus-
  actual validation and a desired-retention knob remain possible future work;
  check the volume and quality of recorded predictions first. Historical reviews
  without a prediction stay unset.
- **Sentence mastery planner step.** The read-only mastery view and opt-in
  single-sentence deep dive are built. A dedicated "finish sentence X" session
  step remains deferred until there is evidence it helps the default flow.
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
- **Adaptive comprehension distractors.** Context-aware checks, book-level
  authoring and listening checks are built. Adaptive distractor difficulty
  remains an open possibility; answers continue to inform the learner's
  self-rating rather than setting it automatically.
- **Pitch-production review extensions.** Sentence-mode production cards are
  built; single-word production is still free practice only. Scheduling that
  mode and reconsidering which pitch evidence listening gates should use remain
  optional work. Preserve self-rating, the explicit time cost and quiet-mode
  behavior if this is extended; pitch practice can also be paused entirely.
- **Compare-speakers refinements.** The sequential native-clip comparison tool
  is built. Re-measure its usable pool as single-speaker content grows; dual-ear/
  binaural playback remains deliberately deferred.

## Possibilities (sentence glossing accessibility)

From a 2026-09-28 brainstorm on making sentence glossing (structural
analysis + the read-along/vocab-confirmation surfaces around it) more
usable when most of a sentence's vocabulary is still unknown, not just
once a sentence is nearly mastered. Four shipped the same day (see
STATUS.md): showing `sentence.translation` on `VocabularyReviewPage`,
tap-to-toggle word glosses in `KaraokeSentenceText` independent of
playback, an ungated client-side heuristic structure preview on
`ReaderPage` (`previewHeuristicChunks`, no AI, no saved analysis), and
replacing `continue_book`'s all-or-nothing "every word introduced" gate
with a `CONTINUE_BOOK_MIN_INTRODUCED_RATIO` density threshold
(`getSentenceReadingIntroducedReadiness`, repository.ts — `getParticlePuzzleData`
deliberately keeps the strict all-or-nothing bar via `minRatio: 1`, since
that game needs the whole sentence readable for the particle blank to be
a comprehension check rather than a guess). The rest are unscheduled,
kept here so the thinking isn't lost:

- **Passed `reading_in_context` comprehension check as an alternate
  `continue_book`/shadowing readiness signal**, alongside (not replacing)
  `vocabularyIntroduced`. Comprehension is arguably a more valid readiness
  proxy than per-word SRS reps, but `reading_in_context`'s 4-option check
  is currently documented as informational-only — using its result to
  drive a real gate is a deliberate repurposing, not a silent extension.
  Needs an explicit decision before building, not a default.
- **A genuinely non-SRS "preview glossing" step/bucket** for sentences too
  unknown even for the density threshold above — pure exposure (never
  writes to `SentenceAnalysis`/FSRS), the highest-fidelity answer to "an
  on-ramp for brand-new material." Needs a new `PlannerStepTargetKind` and
  budget-slice plumbing in `buildExploreSteps`/`sessionPlanner.ts` — a
  real lift, not a config tweak like the density threshold was.
- **Precompute `vocab-assist` (and sentence translation, for the
  sentences that don't have one yet) at mining/import commit time** via
  Anthropic's Message Batches API (50% off Haiku), instead of live-firing
  on first `VocabularyReviewPage` visit. Since both write to the shared
  `Sentence` row (not per-user), the cost is paid once per sentence ever
  mined, and it removes the "translation isn't ready yet" gap the
  translation quick-win above can still hit on a freshly-imported,
  not-yet-glossed sentence.
- **Port the offline POS-disambiguated JMDict lookup (`scripts/lib/
  jmdict.ts`) into a runtime the browser/edge function can query**, as a
  free first pass before any Haiku call — closes the gap where
  `KaraokeSentenceText`'s tap gloss shows nothing until `vocab-assist` has
  fired for that sentence, and could eliminate most Haiku calls outright
  (the ambiguity guard already filters down to the cases that actually
  need AI).
- **Per-chunk masking of unconfirmed words in `AnalyzePage`'s chunk
  cards** (show role only, tap to reveal, rather than literal English
  always visible) — parked because `AnalysisChunk` has no real link to
  `SentenceVocabulary` spans today (`chunk.japanese` is free text, not a
  span reference), and because `AnalyzePage` is where the literal-English
  gloss is *authored*, not just displayed — the "hide it from the
  learner" framing fits a read-only viewer better than this page's actual
  role. Would need real chunk↔vocabulary-span data first.
- **Frequency-rank-based glossing thresholds** (gloss only words below
  some corpus-frequency rank — standard in L2 reading pedagogy) — currently
  infeasible: there's no lexical frequency-rank data anywhere in this
  codebase (only acoustic pitch Hz "frequency," an unrelated concept).
  Would need a new data source before this is buildable.
- **Tiered word help in the episode reader (`ReaderPage`).** (2026-10-02
  idea.) Gloss-only words (pronouns, function adverbs, kana formal nouns;
  shipped as `isGlossOnlySuggestion`, see STATUS.md) are the first tier of a
  broader idea: words that are not worth a card but need a meaning on first
  sight get a gloss while help is high, then fade. Today they fade by
  support level in the structure-check panel and by "most of the sentence
  is known" in the Reader's default word list. Open: a per-word exposure
  count (show the first few times seen, then hide) so the fade is
  per-word instead of per-sentence; a bigger set-expression table
  (shipped 2026-10-02 with ~13 phrases in `src/lib/setExpressions.ts`);
  counters and numerals moved into the gloss-only tier the same day; a Reader control that
  steps help down tier by tier instead of the current all / none / default
  override.

## Possibilities (Cure Dolly pedagogy pass)

From the same 2026-09-28 session, a follow-on brainstorm (four more
parallel agents) on making `AnalyzePage` teach structure the way Cure
Dolly's videos do, not just label it. The guided walkthrough, per-chunk
"why" field + roleGuide-seeded placeholder, cross-sentence recurrence
callback, and automatic `chunk-why-assist` drafting for commonly-confused
roles all shipped (see STATUS.md). Ideas considered but not built:

- **Clause-chained reveal for multi-clause sentences** — the walkthrough
  currently walks engine-first, then everything else in flat source order;
  sequencing by clause (engine of clause 0 → its cars → the connector →
  engine of clause 1 → …) would better match how Cure Dolly actually
  chains compound sentences. Skipped for v1 since most sentences here are
  single-clause enough that the flat order already reads as clause-chained
  by construction; revisit if multi-clause sentences prove confusing in
  practice.
- **Audio-synced "narrate it" autoplay** — pace the walkthrough's reveal to
  the existing "Play by chunks" TTS instead of tap-to-advance, for
  repeat-sentence fatigue. The tap-driven version shipped first as the
  simpler mechanic to validate before adding a second, autoplay-paced one.
- **Cross-sentence callback as a real link**, not just a count — "you've
  seen 「topic は」 3 times before" currently doesn't link to the actual
  earlier sentence, which is the specific mechanism that makes Cure
  Dolly's "we saw this in lesson 3" callbacks work pedagogically rather
  than being a bare counter. Deferred because resolving and rendering
  another sentence's preview text per role adds a second query per card;
  worth adding once the plain-count version has been lived with a bit.
- **Fixed narrative template with phrasing variants** ("This sentence's
  engine is X… notice that Y is marked with は, not が…") repeated in the
  same shape every sentence, so the *format* itself becomes recognizable —
  a bigger authoring lift (10-15 templates × 2-3 phrasing variants each)
  than the roleGuide-blurb-per-step version that shipped; the "predict
  before reveal" thinking-prompt framing for は/が contrasts is a related,
  separately-scoped idea on top of this.
- **TTS narration of the English structural reasoning** (not just the
  Japanese sentence) — infrastructure-ready (`SpeakButton`/
  `useJapaneseSpeech` precedent) but flagged as the highest attention-
  budget risk of anything in the brainstorm, against this app's own
  single-audio-source-at-a-time convention; would need to be a narrow,
  explicit opt-in slice, not a full narrated-lesson mode.
- **Contrastive structured "why" sub-field** (separate "alternative
  rejected" / "why rejected" fields for は/に-car pairs etc.) instead of
  one free-text `notes` field — more Cure-Dolly-faithful for the
  particle-choice subset of chunks specifically, but a bespoke schema
  change the shipped free-text version avoids; only the general `notes`
  field shipped.
- **A reasoning cache keyed by structural signature** (role + adjacent
  role + ambiguity shape, not full sentence text) so a second sentence
  with the same shape of ambiguity could offer the same AI draft as a
  starting point instead of paying for a fresh generation — an efficiency
  layer worth revisiting once real usage data on `chunk-why-assist` calls
  exists, not something to build ahead of that.
- **Routing ambiguous-particle "why" through the existing `GrammarPattern`
  Explain flow** instead of the new `chunk.notes`/`chunk-why-assist`
  mechanism, for the subset of ambiguity that already corresponds to a
  named, trackable pattern — the best reuse profile of anything
  considered (no new field, no new Edge Function), but only covers cases
  with a `GrammarPattern` to hang off; plain role-assignment reasoning
  (why this is the を-car, why this modifier attaches here) has nothing to
  route through and still needs the mechanism that shipped.
- **Gloss-first sequencing (2026-09-29, user idea; big change, not
  committed to).** Today the planner is vocab-first: an unconfirmed
  sentence only gets `vocabulary_review`; `continue_book` (the Analyze
  walkthrough) opens once ≥50% of its words are introduced
  (`CONTINUE_BOOK_MIN_INTRODUCED_RATIO`); "Grammar noticed" comes after.
  Proposal: make the guided walkthrough the *first exposure*, with the
  English translation shown as the answer key, and pick up vocabulary
  and grammar from inside it. The harder unaided gloss (translation and
  role labels hidden) becomes a later, separate pass, so the
  vocab-before-glossing rule still protects the unaided attempt. The
  translation is what resolves the usual objection (glossing unknown
  words means guessing). Low-risk first step: surface unconfirmed words
  inline at the chunk where they appear and confirm them there, keeping
  the current order otherwise. Before building, check that
  vocab-suggestion and confirmed-vocab data are populated when the
  picker is skipped, since the planner keys many downstream steps off
  confirmed vocab, and that the walkthrough can show/hide the
  translation (it's an editable field today, not an answer key).

## Possibilities (sentence-revisit repetition)

From a 2026-09-29 brainstorm (four parallel agents: trigger mechanics,
fading scaffolding, anti-boredom content variation, systems integration)
on repeating a sentence's structural lesson once more of its vocabulary
is familiar, without new scheduling machinery or feeling like a bored
rerun. Shipped (see STATUS.md/AI_OVERVIEW.md): reusing `reading_in_context`'s
existing FSRS due-schedule as the trigger (no new bucket/step/gate), and
from the sentence's second review onward, a typed-recall "type this
chunk's reading" production check for one classic Cure-Dolly-confusion
role, before the existing comprehension check/Reveal.

The brainstorm considered five ways to handle the actual handoff — what a
learner does once a revisit is triggered — and only one (the typed-recall
check above) was built; the user asked for the rest to be written up
rather than built "in case it doesn't work out":

- **Full `BuildPage` embed** — extract `BuildPage`'s tile-reconstruction
  UI (shuffle chunk tiles, place them in order, hint ladder) into a
  shared component, use it as the `reading_in_context` card's body when
  due. Most faithful to "revisit via production," but real work: that UI
  was never split from the page, and a fundamentally different
  interaction shape (multi-step tile placement) doesn't fit `ReviewPage`'s
  established "front → reveal → rate" card shape without real effort to
  keep the two copies in sync.
- **Link out to `BuildPage`, then return to rate** — the review card
  shows a button to `/books/:bookId/build/:sentenceId`, the learner does
  the exercise there, then needs to come back to `ReviewPage` to actually
  settle the FSRS card. Cheapest in UI code (zero duplication) but breaks
  the single-page session flow this app otherwise keeps tight, and needs
  new "return here to rate" plumbing that doesn't exist today.
- **Passive read-only recap card** — reuse `ChunkPuzzleStrip`/
  `roleGuideBlurb` read-only as the `reading_in_context` card body instead
  of the typed check. Cheapest of all (fits the existing reveal/rate shape
  trivially, no new interaction), but this is exactly what the
  content-variation brainstorm flagged as risking "same thing, quieter" —
  passive review, not production, is precisely the boredom failure mode
  the user named up front.
- **Prominent "Build this" nudge instead of touching `ReviewPage` at
  all** — leave `reading_in_context` untouched; just make the existing
  "Build this" link (already on `AnalyzePage`) more visible/suggested once
  a sentence matures (e.g. full vocab proficiency). Smallest possible
  change, most consistent with this app's "never forced" convention
  (`BuildPage`'s own hint ladder, `ReaderPage` being ungated) — but
  weakest on the "automatic" part of the original ask, since visiting
  stays fully opt-in.
- **A `ParticlePuzzle` round targeted at the sentence's flagged role**
  (rather than the game's normal random weak-pool pick) as a rotation
  option for a third/later visit, so repeated revisits of the same
  sentence don't all ask the identical typed-reading question. Narrower
  applicability than the others (only sentences with a blankable
  particle), but cheap once `getParticlePuzzleData` exists to extend, and
  makes a repeat feel earned rather than templated.

Explicitly ruled out by the integration-brainstorm agent, not just
deferred: a second, independent scheduling mechanism (new bucket/step
with its own vocab-ratio eligibility check) — `continue_book`'s own
history (four gate-tuning iterations in one week) was cited as evidence
this codebase's per-sentence readiness predicates are easy to get subtly
wrong, and a second scheduler answering "is this sentence due for another
look" independently of `reading_in_context` would eventually disagree
with it.

- Sentence-first: promote a practised target into durable tracking (explicit "Keep reviewing this"; vocabulary first, needs a merge-link operation). Parked with reasoning in `docs/SENTENCE_FIRST_HANDOFF.md`, awaiting the user's go-ahead.

## Possibilities (active sentence-production bridge)

From a 2026-10-17 design brainstorm: the learner likes the passive "hear a
clip, pick the matching chunks in order" activity but struggles to bridge to
independent sentence construction. Five interface concepts, each removing one
support (given chunks, given order, attached particles, visible target,
template). User wants to try all of them; Remix and Sentence Growth (first slice) are built, the rest are not. Suggested
progression: Stage → Elastic → Particle Swap → Sentence Growth → Remix, but
**Remix Mode is the recommended first build** (closest to the existing chunk
drill, reuses already-heard native sentences). Cautions from existing
precedent: `grammar_production` (free composition) was retired, so anchor to
native sentences where possible; the "Reverse English -> Japanese" note above
forbids generated Japanese distractors; no auto-derived FSRS rating (objective
checks are supplementary evidence only); pair grammar labels with plain-English
hints.

- **Remix Mode (steal, then swap) — recommended first.** Play a known native
  clip, show its skeleton (`[who] が [where] で [what] を [verb]`), then ramp
  difficulty: swap one slot → swap two → swap the verb (particles must change
  to fit) → free remix on the same skeleton about the learner's own life.
  Saved remixes appear beside native sentences. Reuses material already heard
  and shadowed, so only the construction is new.
  **Status 2026-10-17: scope A built** (the `/play` Remix game, `src/lib/remix.ts`; translation handling = slot hints during play, full translation after). Scope A = (rungs 1–2 only:
  swap one / two slots, as a `/play` game; read-only vs FSRS, local-only
  rounds; no schema/sync changes). Findings from the design pass:
  - The drill the learner likes is Ear Tiles (`earTiles.ts`), whose tiles
    come from UniDic tokens (`Sentence.vocabularySuggestions`) — NOT the
    Cure-Dolly chunks (only 64 of 2,268 analyses have any), so BuildPage /
    `ChunkPuzzleStrip` roles can't seed skeletons.
  - Slots = noun + case particle (が/を/に/で/から/と…), verb slot = final
    verb phrase. Of 2,479 sentences ≤45 chars with tokens: 1,450 verb-final,
    930 with ≥2 slots, 376 with 1. Raw heuristic is noisy (formal/adverbial
    nouns こと/なん/一緒に, UniDic-split compounds like 親鳥→鳥, multi-clause
    sentences) → needs a single-clause filter and head-noun quality filters;
    reuse `findBlankableParticles` conservatism (no の/へ, no adjacent
    particles, は/が/も swaps flagged "often grammatical").
  - Substitutes come from vocabulary linked to introduced sentences in the
    default sentence-led flow (POS formats mix UniDic `名詞/…` and JMdict `n`).
    The older flow still requires confirmed nouns. Offer a slot
    only if enough substitute nouns exist — check the gate is satisfiable
    before shipping. Semantic fit ("eat the house") is not machine-checkable;
    tell the learner. Checks are structural (particle kept, fixed text
    unchanged, reading correct); no generated Japanese distractors; learner
    self-rates, no auto rating. Slot hints reuse the plain-English relations
    in `glossSkill.ts`.
  - Deferred: **rung 3** (verb swap) has no verb→particle data; only the
    curated transitive/intransitive pairs in `scripts/lib/verbPairs.ts`
    (e.g. ドアを開ける→ドアが開く) force a checkable particle change.
    **Rung 4** + saved remixes need a new synced table (migration, soft
    delete) and risk re-creating retired `grammar_production`; decide only
    after trying rungs 1–2.
- **Sentence Growth (seed-and-sprout).** Start from a bare verb (or a clip
  with everything but the verb muted); branching prompts (who? what? where?
  when?) grow the sentence outward, each answer a short spoken/typed
  production; finish by saying the whole sentence against the original clip.
  Reverse mode, *pruning*, strips a native sentence down to its skeleton to
  show what is load-bearing.
  **Status 2026-10-17: first slice built** as a `/play` game (`src/lib/sentenceGrowth.ts`,
  `SentenceGrowthGame.tsx`): own chunks only (pick each from the sentence's own
  pieces), asked in the order が/は → を → で → に → から → まで, then say the whole
  sentence along with the clip, reveal, three-way self-rating. Not built:
  typed/recorded production per chunk, pruning mode, a recorded take. Chunks come
  from the Remix skeleton (UniDic), not saved Cure-Dolly analyses (~5% coverage).
  Pool is small (30 qualifying sentences, 0 yet met) and fills through ordinary
  walkthroughs, which now prefer these sentences within their existing window.
- **Particle Swap (one dial, shifting meaning).** One concrete scene with a
  single slot cycling は/が/も/を/に, showing a tiny picture change, an English
  "feel" line, and the audio of each variant (intonation, not just text).
  Production step gives an English situation ("someone asks who ordered the
  coffee") and the learner picks/says the right variant with no target shown.
  Targets the confusable pairs (は/が, に/で). Tension: needs variant audio for
  sentences that may not exist natively.
- **The Stage (particles as spotlights).** Nouns are actors; dragging a
  particle onto one lights it by role (は dims everything else, が points,
  を draws a thread to the verb, に a doorway, で a circle on the floor) and an
  animation plays the resulting scene, so swapping で for に visibly changes
  the meaning. Makes particle behaviour consequential rather than a memorised
  label. Biggest art/animation cost of the five.
- **The Elastic Sentence (word-order playground).** Verb fixed at the right
  edge, every other chunk a bubble tethered by its particle, draggable into
  any order: green = natural, amber = grammatical but marked (the front word
  glows as the stressed one), red = snaps back (orphaned particle, verb moved
  off the end). Teaches "verb last, particle-marked chunks float" by feel.
  Variant: an emphasis-weight slider as a chunk moves left.

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
