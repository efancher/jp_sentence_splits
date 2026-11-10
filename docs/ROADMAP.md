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

- [~] **Phrase shadowing (checkpoint ~2026-11-17).** Step 1 shipped 2026-11-03:
  mark a span on the Shadow pane (Mark start / Mark end), shadow it, self-rate
  Not yet / Close / Got it → a `phrase_shadow` learning event (span, text, credited
  words; no Review, no FSRS, never closes the sentence's own shadowing step) that
  feeds word strength as recognition evidence. `settings.sentenceShadowingPaused`
  ("Pause sentence shadowing in the daily plan", on for the trial) stops the
  planner drafting whole-sentence shadowing steps. **Pick up after ~2 weeks of use:**
  (1) read the data read-only first (counts of `phrase_shadow` by outcome, how many
  sentences, how many events have an empty phrase text because no alignment was
  cached, and "Got it" vs the measured timing/pitch of the same take) before
  changing any gate; (2) feed it into `findShadowCandidates`/the planner as ordering,
  not a gate: a recent Not yet = phrase pass before the whole sentence, all phrases
  Got it = sentence more eligible, no phrase data = today's behaviour (per the
  starved-gate lesson); (3) decide whether to turn the pause off; (4) the Shadow pane
  suggests the weakest word's phrase, the planner's paused-mode steps are named after
  it, and the reader offers "Shadow this phrase" after "I didn't" on a word's Reading
  (all 2026-11-04); still open: a "Sound"-flag trigger for the same shortcut, and that
  hands-on checklist (`MANUAL_TEST_LOG.md` P1–P7); (5) a `/progress` panel, and revisit
  the evidence weights (Got it is a small recognition success today). `phraseShadowsBySentence` (`src/lib/phraseShadow.ts`) is the
  unused-by-the-planner reader of the data. `20261103000000_phrase_shadow_events.sql`
  is applied to Supabase (confirmed 2026-11-08). **First read, 2026-11-08 (too thin to
  act on):** 36 events over 20 sentences in one book, on 2 days (11-05, 11-07): 25 Got it,
  7 Close, 4 Not yet; no empty phrase text; median span 1.75 s (1.1-4.1 s); 12 sentences
  shadowed more than once, mostly improving. Self-rated, so the high Got it share may be
  generous. Re-pull around 11-17 before steps 2-3; the join with measured timing/pitch of
  the same take is still not done.

  **Chunk chain (proposed 2026-11-08, nothing built).** The jump from one phrase to a
  whole sentence is too big, and slowing the whole sentence (tried by the learner)
  did not help much. Instead build the sentence from the end: last chunk, last two,
  and so on up to the whole sentence (backward build-up keeps the final intonation
  intact at every rung). Design agreed so far:
  - *Grading:* self-rating per rung (Not yet / Close / Got it); the measured take
    score is shown beside the buttons as evidence and never picks the rating. Got it
    moves up, Close repeats once, Not yet drops a rung (or to the weakest chunk).
    About two attempts per rung, then the learner leaves via "Mark complete". The
    first rung is a "Next" tap, not a rating; ratings start at rung 2.
  - *Logging:* one `phrase_shadow` link event per rung with an empty credited-word
    list (diagnostics only, zero planner weight) plus one chain summary event (highest
    rung with Got it, attempts per rung). Credit each word once per chain, at the
    highest Got-it rung containing it, so a chain does not double-count words.
    Planner evidence comes only from the top rung and the summary.
  - *Eligibility (check before any gate):* a sentence needs at least 3 chunks; shorter
    ones go straight to whole-sentence shadowing. The chain is an optional route to
    the whole-sentence step, never a gate on it. Run a read-only count of how many
    recently imported sentences are chain-eligible with the auto-chunker first.
  - *Measuring whether it helps:* a cold whole-sentence rating on a random subset of
    chains (not every one, so the learner is not always warmed up), compared with the
    final top-rung rating. Read-only diagnostic, not a gate.
  - *Chunks:* auto-proposed, learner-adjustable. Candidate sources are the stored
    `AnalysisChunk`s (Cure Dolly chunking) and particle/clause boundaries from the
    morphology. Adjusting works like the Reader's chunk chips (`ReadingHelpPanel`: tap
    a chunk, see it, loop it) but with add/remove at the edges: select kana to extend a
    chunk or tap a divider to move it. The selection snaps to aligned word boundaries
    (never mid-conjugation) so every chunk has a start and end time. Reuse
    `isolatedWordSpans`/`isolatedWordRange` and `verifiedTokenCharRange`
    (`src/lib/isolatedWordRange.ts`) for text to time, and `SegmentLoopPlayer` for
    playback. Open: free kana selection is a new interaction; the Reader's existing
    flow is tap-a-chip, not text-range selection. Also open: chunks over a squashed
    or `<unk>` alignment (the `wordTimingUnreliable` guard) should fall back to
    whole-sentence shadowing rather than a confidently wrong span.
  - *First eligibility read, 2026-11-08 (read-only, proxies only; the real chunker
    does not exist yet, so this is not the final check):* stored `AnalysisChunk`s
    cover only 64 of 4,435 sentences (56 complete, 8 in progress; 3+ chunks on 46),
    so they cannot be the main chunk source. The 1,000 newest sentences (all from the
    2026-11-07/08 imports): median 16 characters, p10 6, p90 50; 64% are 12+
    characters and 82% are 8+. Splitting at 、。！？ alone gives 3+ clauses for only
    33%, so a chain needs a within-clause boundary rule (particles/morphology), not
    punctuation. The space-separated segments in `inline_reading` are no use for
    these imports (810 have inline readings, 809 are a single segment).
  - *Real chunker read, 2026-11-08 (`npm run diagnose:chunk-chain`):* the boundary rule
    already exists: `chunkSentenceIntoTiles` (`src/lib/earTiles.ts`, bunsetsu from the
    stored UniDic tokens), so no new chunker is needed to start. Over the 5,369
    sentences with a native clip, 1% are unchunkable (fall back to whole-sentence
    shadowing), 87% yield 3+ chunks and 77% yield 4+. Since 2026-11-07 (651 sentences):
    70% yield 3+ and 57% yield 4+. Eligibility is driven by length: under 10
    characters only 7-11% reach 3 chunks; 10-19 characters 69-85%; 20+ is 100%. So the
    3-chunk minimum mostly excludes short sentences, which don't need a chain.
    **New problem:** 38% of all sentences yield 8+ chunks (long caption-style lines), so
    a one-chunk-per-rung chain would be 8+ rungs. Decide before building: merge
    neighbouring chunks into ~3-5 rungs (target a rung length in seconds, not chunks),
    or cap the chain to the last N rungs. The Ear Tiles `MAX_SENTENCE_LENGTH` (45) and
    `MAX_CLIP_MS` (10 s) are a precedent for limiting this.
  - *Rung planner, 2026-11-08:* decided to merge by duration. `planChunkChain`
    (`src/lib/chunkChain.ts`, tests in `tests/chunkChain.test.ts`) cuts the Ear Tiles
    chunks at their aligned start times and keeps a cut only if it adds at least
    1.2 s (or total/5 s for long clips) of new audio, so a chain is 3-5 rungs ending in
    the whole sentence. It rejects with a reason: `no-chunks`, `too-short`,
    `unreliable-alignment` (a cut is dropped when its start token doesn't verify against
    the text or a squashed token sits beside it; other cuts still serve). Not built yet: the Shadow-pane UI, the chain logging, the divider
    adjustment. **First real run (`npm run diagnose:chunk-chain`, 5,369 clips):** only
    11% (582) get a chain today, and the main limit is stored alignments, not chunks:
    3,610 clips (67%) have no `reference_alignment` row, including all 649 from the
    2026-11-07/08 imports (so none of the newest sentences can chain until the
    alignment backfill runs). Of the ~1,760 clips with an alignment, 582 plan (376 with
    3 rungs, 206 with 4), 622 are too short once rungs are sized by duration, 408 have
    an alignment the planner will not trust. **After loosening that rule to per-cut
    checks:** 743 clips (14%) plan (505 with 3 rungs, 238 with 4); 517 are still
    `unreliable-alignment`, because the aligner can only be verified as a prefix of the
    text, so an `<unk>` early in a clip loses every later cut (only trouble at the end
    is recoverable). **Open:** whether the alignment backfill should cover the clips a
    chain would use first.
  - *First UI, 2026-11-08 (merged to main):* a "Chunk chain" button in the Shadow
    pane (`ChunkChainPanel`, only when the cached alignment plans 3+ rungs). It points
    the pane's own loop/target at the current rung; the first rung is Next-only, later
    rungs take Not yet / Close / Got it (`chunkChainSession.ts`: Got it climbs, Close
    repeats once, Not yet drops, 12 ratings max). Each rating logs a `phrase_shadow`
    event keyed `chain-rung:<n>` (no credited words, not a pronunciation attempt);
    when the chain ends, one ordinary `phrase_shadow` Got it over the highest Got-it
    rung credits its words once. **Also shipped on the branch:** "Adjust steps" (tap an
    aligned word to start or stop a step there; cuts snap to word starts, `rungsFromCutTimes`;
    per visit, not saved), a cold whole-sentence try opening ~25% of runs (`chain-cold:0`,
    skippable, no credit; `COLD_PASS_SHARE`), `npm run diagnose:chunk-chain-outcomes` (read-only:
    cold rating vs the chain's last rating per visit), and `e2e/chunk-chain.spec.ts`.
    **Still to do:** read the outcomes diagnostic once there are a few dozen cold pairs.
    **Manual test:** open a
    Shadow pane for a clip with a stored alignment and 8+ words; tap Chunk chain, loop
    the first step, Next, rate Got it up to the whole sentence, then check the finish
    message and that Review shows no new cards; repeat with Not yet to see it drop; try
    Adjust steps and confirm the loop follows the moved step.
    `phraseShadowsBySentence` still includes rung events (it is unused by the planner).

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
    Measured 2026-11-10: a fresh-device restore costs about 2.1 to 2.3 requests per
    100 rows (linear), but the Postgres suite's wall-clock times are distorted by
    `fake-indexeddb` (super-linear), so restore latency still needs a real-browser
    measurement at the large fixture size (see PERFORMANCE.md).
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
  **Where it stands:** optional Reading/Meaning/Kanji/Sound chips on the review
  card (shown after reveal, before rating, never affecting the rating).
  Reading/Meaning/Kanji queue a Fresh try (walked-through sentences only);
  Sound puts the sentence first in shadow candidates until a later attempt is
  saved (`settings.shadowRequests`). Tag use is logged in the local-only
  `reviewTroubleLogs` table. Details and limits: STATUS.md. Not yet checked in a
  browser on phone or desktop.
  **Next, in order:**
  1. **Progress notes from the tag log (panel shipped 2026-10-21; now use it
     for about a week).** A read-only `/progress` panel: tag counts, how often each
     queued follow-up was actually done, and whether tagged sentences' later
     ratings improved. Use about a week of real use to judge whether tags are
     accurate enough to build on. Judge the evidence honestly: a sentence's next
     rating is not proof the follow-up caused the gain.
     **First reading (2026-11-08, one learner, one device):** Fresh tries done 23
     of 24 and shadowing 30 of 34 (per sentence, from each sentence's latest
     tag; the first panel showed 0 of 29 because it ignored
     `walkthrough_completed`, fixed). Tags cover Kanji 22, Sound 64, Meaning 7,
     Reading 0. Next review good/easy was 24 of 25 when the follow-up came first
     and 7 of 10 when it did not; that is small and confounded. **Masked
     signal:** on sentences seen many times, familiarity can carry the meaning
     even when the kanji are shaky, so a missing Meaning tag does not show the
     sentence was understood (Meaning is probably undercounted, and Kanji-only
     sentences are not "understood"). Reading is harder to mask, but the learner
     cannot always tell a reading problem from a kanji problem, which fits it
     being unused. Reading and Kanji may merge or Reading may go. Dictation and
     Word check, which test the words without the whole-sentence memory, are the
     better check (see "Separate Dictation and Word check" below).
  2. **Soft gate (dropped for now, 2026-11-08).** Follow-ups are already done
     about 90% of the time, so a nudge would add little. If it comes back:
     surface pending remediation shortly after the review (same day or next);
     if undone when the card falls due, show the card anyway, and check against
     real data that it cannot starve a gate.
  3. **Sync** `reviewTroubleLogs` (needs a Supabase migration, RLS and the sync
     mappers) once step 1 shows the tags are worth keeping. `shadowRequests`
     lives in settings and should follow the same path as `freshTryRequests`;
     confirm that.
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
  - **Remediation queue, not FSRS cards:** shadowing and walkthroughs have no
    recall grade, so scheduling them as FSRS items would pollute stability.
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
  `sentence_grammar` rows with spans, and the finish-screen "Patterns here" block
  with the visibility rule for unreviewed assistant links, and the pattern page's
  "Lined up" examples with form chips (STATUS.md). Not built from that idea: a
  "what varies" grouping by sub-meaning (the per-sentence notes are free text, so
  grouping them needs an assistant pass).
  **Next, in order:**
  1. **"Seen before" as a real link.** The walkthrough's recurrence count shows
     the earlier sentences inline with the pattern highlighted.
  2. **Tag patterns while writing new walkthroughs** so new sentences need no
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
  - **Chunked ASR for long episodes (2026-11-07).** A 42-minute episode outran the
    1 h `MINING_ASR_TIMEOUT_SECONDS`: the client gave up, no captions existed to
    fall back on, and the job failed with "no segmented sentences". Interim fixes
    shipped: timeout raised to 2 h, and a caption-less ASR failure now says so.
    **Built 2026-11-08 (source and offline tests only; not yet run on a real long
    episode):** `app/asr_client.py` splits sources over 15 min (`MINING_ASR_CHUNK_*`)
    into ~8 min chunks cut at silence midpoints (ffmpeg `silencedetect`), sends each
    to `/transcribe-source` with its own timeout, offsets cues and words onto the full
    source, shows "part N of M" in the job message, and checkpoints finished chunks
    under `JOBS_ROOT/asr_chunks/<videoId>` so a retry (a new job) resumes; the
    directory is removed on success. Any chunk failure still falls back to captions.
    Still open: the analysis service cannot be told to cancel, so an abandoned job
    wastes at most the chunk in flight; seams are cut at pauses but a sentence that
    spans a hard cut (no silence in range) is untested on real audio; deploy and
    restart `youtube-mining-api`, then try a 40+ minute episode.
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
  - [ ] **Estimate unknown words' accent from the recording** (*measured 2026-11-10, gate not met*): `npm run
    diagnose:pitch-estimate-accuracy` hides the dictionary accent and fits the best valid shape to each native
    clip (495 words). Agreement 51% overall, 60% on strong cues (margin ≥3, contrast ≥1.5 st; 61% of words),
    41% on 4-mora words, similar across books (50–55%). Below the ≥70% gate, so no estimated marks. Needs a
    better measurement first (phone-aligned intervals, declination detrend); a per-speaker profile would not fix
    this since the error is per-word, not speaker offset.
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

## Possibilities (organic vocabulary/grammar growth, i+1 sequencing)

Direction from a 2026-11-07 discussion. Replace "the book's order decides what
comes next" with "the learner's current knowledge decides": prefer sentences
whose content words and grammar are almost all known, with one or two unknown
pieces, and mix in a higher-unknown sentence every few days. Grammar patterns
should eventually be tracked like vocabulary items.

Feasibility check (read-only, prod Supabase, 2026-11-07; reproduce with
`npm run diagnose:i-plus-one`). 5,232 not-yet-introduced candidate sentences;
every one has `sentences.vocabulary_suggestions` (UniDic morphology) and 5,144
have default-checked content tokens. Known lemmas come from the 231 introduced
sentences only (465 lemmas, the sentence-led definition from
`getIntroducedSentenceIds`). Unknown distinct content lemmas per candidate:
0 -> 430, 1 -> 1,003, 2 -> 1,083, 3 -> 905, 4 -> 654, 5+ -> ~1,070. About 2,086
(~40%) have 1-2 unknowns, spread across every book (593 and 651 in the two
largest). A one-off greedy simulation (learn the most unlocking word each
step; not in the script) grew the "<=1 unknown" pool from ~1,500 to ~2,400
after 140 words, so the pool does not run dry.

Constraints and decisions:

- **Use morphology, not `sentence_vocabulary`.** Only ~284 candidates have
  picker-confirmed vocabulary links, so linked-vocab counts would starve the
  scheduler (a per-item gate with no eligibility check starves, as it has
  before). Count the sentence's default-checked `vocabularySuggestions`
  (`selectedByDefault`, the picker's content-vs-function rule), keyed by
  lemma expression + reading.
- **"Known" is conservative**: lemmas from introduced sentences plus words with a
  reviewed reading/meaning card (done 2026-11-07). Grammar patterns now need two
  introduced sentences and no shaky reader evidence (done 2026-11-08). Words
  need two introduced sentences too (`WORD_MIN_EXPOSURES`; reviewed-card words stay known; done 2026-11-08).
  Measured by `diagnose:i-plus-one` (which also applies the shaky cut): the 1-2-unknown pool went 2,564 -> 2,287
  (words only) and 2,069 -> 1,895 (words + grammar); known lemmas 556 -> 313. Word struggle cut shipped 2026-11-08: two or more failed
  reader/Word-check taps with the latest a failure (`strugglingWordIds`) makes a word unknown again; measured 13
  known words flipped, pool 2,286 -> 2,229 (words) and 1,894 -> 1,851 (with grammar). A single miss was rejected
  (20 words, one of them, 思う, in ~530 sentences). Open: nothing for words beyond tuning the threshold.
  Never derive FSRS ratings from this.
- **Rank by unlock value** among 1-2-unknown sentences: how many other
  candidates become closer to ready if the unknown word is learned.
- **Stretch cadence** is a setting (start ~1 in 5 sentences with more unknowns);
  keep the older book-order flow selectable.
- **Grammar: curated reference, vocabulary first.** `sentence_grammar` is 100%
  `ai_suggested` (54 of 2,530 links confirmed), so raw links are low confidence.
  Plan: treat a learner pattern as high confidence only when it resolves to an
  entry in a curated list. Chosen reference: OpenJLPT's grammar dataset (526
  patterns N5-N1 with level, formation tokens, examples, tags; CC BY-SA 4.0,
  hand-written, single-author, levels are community consensus because the JLPT
  publishes no official list). Fetch it at run time or keep it as a derived
  dataset with attribution and share-alike; do not copy it into the repo
  unlabelled. Matching is `src/lib/grammarReference.ts`; measure with
  `npm run diagnose:grammar-reference`. 2026-11-07 result: 132 of 378 learner
  patterns resolve (23 ambiguous, N5 38 / N4 49 / N3 34 / N2 10 / N1 1);
  1,458 of 2,530 links resolve; 970 of 5,232 candidates carry a curated link;
  counting by curated entry (several learner patterns collapse to one, e.g. two
  passive patterns), unknown entries per linked candidate are 0 -> 572,
  1 -> 339, 2 -> 53. Grammar therefore covers ~19% of candidates; it can refine
  vocabulary-led ranking but cannot drive it. The 246 unmatched patterns are
  mostly colloquial/sentence-specific or junk (one is literally named "NEW").
  Open: merge duplicate learner patterns that map to one curated entry;
  clean unmatched junk; detect curated patterns from morphology using the
  `formation` tokens instead of relying on AI links; cross-check levels against
  the Tanos grammar lists (CC BY, .doc/.pdf only; Bluskyo/JLPT_Vocabulary
  converts only the Tanos vocab/kanji lists, not grammar, and tanos.co.uk was
  unreachable from the dev sandbox, so convert manually if wanted). Other leads
  not evaluated: the MIT Ruby `jlpt` gem (grammar-pattern extraction) and NINJAL
  日本語文型バンク (reportedly N5/N4 only, license unconfirmed).
- Proper nouns and odd UniDic splits can inflate unknown counts; audit the
  default-checked tokens before trusting a threshold.

**Import pipeline (new material keeps arriving).** The vocabulary score is derived
live from `vocabularySuggestions` plus the introduced-sentence set, so new
imports need no extra scoring step, and they do not change the known set until
they are introduced. Only YouTube/podcast (quick import and wizard), NHK Easy
and Shadowmine ZIP imports are in use; all write morphology tokens, so every
live import path is scorable. The one-time Anki importer and the Satori CSV importer
(both wrote `[]`) were removed 2026-11-07. Guard shipped:
`scoreSentence` treats an empty suggestion list as "not scorable", never "0
unknowns", and `diagnose:i-plus-one` reports and warns about such sentences.
Still to do at import: (a) grammar links produced and matched to the curated
reference at commit time (the grammar-links extra, then `matchOwnPattern`), so
new sentences arrive with high-confidence patterns; (b) a per-book "ready to
pick up" summary after import (`diagnose:i-plus-one --book <id>` is the
prototype: unknown-count histogram and top unlocking words). Keep both
advisory, never blocking an import.

Steps: (1) [done 2026-11-07] `src/lib/unknownLemmas.ts` (content lemmas,
known set, unknown-per-sentence, unlock value) with fixture tests, and the
`diagnose:i-plus-one` script; (2) [done 2026-11-07] unknown-count ordering as
an opt-in per-book ranking behind `settings.iPlusOneOrdering`
(`src/lib/iPlusOne.ts`, hooked into `findExploreCandidates`), including the
1-in-5 stretch cadence and unlock-value ranking; (3) [done 2026-11-07] tuning: `lemmaWeight` x0.2 for 感動詞 and pure
discourse markers, x0.3 for grammar-bound verbs (しれる, いける, ござる, なさる, and について's つく), x0.5 for
proper nouns (ranking only; frequent real words like ちょっと/やる/わかる are
deliberately untouched); stretch cadence is a setting
(`settings.iPlusOneStretchEvery`); words with a reviewed reading/meaning card
count as known (+72 lemmas, ~+130 sentences in the 1-2 pool on 2026-11-07
data; all 1,099 picked vocabulary items would add ~800 lemmas, but that is
"picked", not "learned", so it is not used); the lesson reason line says "new
here: X"; ranking is across books (one global rank, per-book order kept, books
merged by next rank). Left over: more grammar-bound lemmas as the audit finds them (the per-book "ready to pick up" panel shipped, see
step 4); (4) [done 2026-11-07, refinements open] grammar as items: the OpenJLPT list is vendored as a
trimmed derived file (`src/data/openJlptGrammar.json`, id/pattern/level/formation,
CC BY-SA 4.0 attribution inside; `npm run vendor:openjlpt-grammar` regenerates
it), unambiguous learner-pattern matches give each sentence curated grammar
entries, an entry is met once two introduced sentences carry it and it is not shaky (2026-11-08; was one), and unmet
entries count as unknown pieces in `orderByIPlusOne` (and are named in "new
here"). On 2026-11-07 data: 27 curated patterns known; the 1-2-unknown pool
2,273 -> 2,231 sentences. Same day, curated patterns are also detected from
the sentence text (fixed text of each entry; ~65% of candidates carry grammar,
50 patterns known, pool 2,273 -> ~1,890 with level-aware pacing: an unmet
pattern above the easiest JLPT level under 60% met costs extra) and each
sentence-led book page has a "Ready to pick up" panel. The duplicate learner
patterns were merged and the junk "NEW" pattern soft-deleted (2026-11-07), and
matches no longer start partway through a verb/noun token (`wordSpansForDetection`;
removed ~16 false matches). Episode momentum (2026-11-08): sentences from
episodes with many started sentences get up to +50% on unlock value
(`episodeMomentumBoost`, capped at 10 started) and win ties. Retesting exists
only at sentence level (Read checks 1-64 days, Fresh try revisits, weak-word
revisits). Grammar parity, first slice (2026-11-08): weak grammar patterns (from
reader grammar taps) now bring walked sentences back like weak words
(`getWeakGrammarSentenceSignal`). The reader now flags unchecked/shaky words and
patterns on the focused sentence (amber/muted underline plus a "Not checked yet"
line; `getReaderEvidenceLevels`). Manual test: open a chapter with an
untouched sentence, see amber underlines and the hint, tap one and give a call,
see it turn muted and drop from the hint. Grammar check shipped (2026-11-08): weak-grammar revisits draft a recall step
(`/grammar-check/:sentenceId`, `GrammarCheckPanel`). Manual test: tap a weak
sentence's Grammar check step, see the pattern text without its meaning, show it,
and give a call. Grammar parity finished (2026-11-08): the Grammar check has an
optional "say it in your own words" box before the reveal (shown back as "You wrote",
never graded or stored); solid grammar patterns get a green solid underline in the
reader (solid words stay plain); /progress has a "Grammar strength" panel
(`getGrammarStrengthReport`: solid/shaky/unchecked counts plus the weakest tapped
patterns). Manual test: type a guess in a Grammar check and see it after the reveal;
give a pattern a few "I knew it" taps and see it turn green; open /progress and
check the counts move. Left over: any grammar study surface.
**Reminder, revisit on or after 2026-11-15:** decide whether grammar needs its own
study surface. First look at a week of Grammar check use (the /progress "Grammar
strength" panel: solid/shaky/unchecked counts, weakest tapped patterns, and whether
the weak-grammar revisits are being finished). Only design a surface if patterns pile
up shaky or unchecked despite the check; it is the user's design call.
Ambiguous `（note）` senses (2026-11-08): only 7 curated forms share their text
(`npm run diagnose:grammar-ambiguous`). A shared form is now detected when every
owner has a guard: ながら（while）/（も） and くらい/ぐらい（approximately）/（extent）
are resolved by context; ように, そうだ, られる and にする stay skipped (the senses
need grammar, not nearby text). Short patterns (under 3 characters) were measured
with `npm run diagnose:grammar-short`: eleven N3/N2 entries precise enough
(さえ, こそ, ほど, ぶり, まま, がち, っけ, ずに, 次第, 場合, 向き/向け) are allowlisted in
`SHORT_LITERAL_FORMS`; particle-sized ones (こと, って, とか, とは, なり, まい, and the
N5 は/が/に/で roles) match far too often for text, and would need morphology or an
AI link.
Short-form over-matches (2026-11-08): `src/lib/grammarDetectionGuards.ts` holds
per-entry guards (ないです is not ないで, すばらしい is not らしい, 大切にしています
is not にして, …) found with the read-only `npm run diagnose:grammar-detection`;
add a guard only for a measured over-match.

## Possibilities (reader as the single study surface)

Direction from a 2026-11-01 discussion, not scheduled. Make the reader the one
place study happens, with each activity a tool acting on the text in place:
Ear Tiles puts the chunk blocks where they belong in the episode; dictation
blanks the target and gets a playback/loop strip; the walkthrough gets a toolbar
with pop-up definitions and explanations; shadowing gets a toolbar plus a panel
for pitch contour and recording. The smart activity schedule stays and decides
which location and tool come next (SessionBar remains the single advance
control).

- **Why.** Review cards feel artificial and each activity logs its own evidence.
  In the reader, scaffolding can fade by word strength (hide furigana/gloss on
  weak words so the reader itself forces recall), and every tool reports evidence
  to one shared word-strength estimate. That estimate only chooses sentences and
  words; the sentence FSRS schedule stays the only "when", so two schedulers
  cannot disagree.
- **Order.** (1) Word-strength library, evidence-weighted (retrieval counts far
  more than exposure), usable from any surface. (2) Use the reader to fade
  furigana/gloss by word strength as a cheap test of the idea. (3) Migrate tools
  one at a time, simplest first (dictation blank, Ear Tiles), then walkthrough,
  then shadowing last, keeping the old pages working throughout.
  *Progress (2026-11-01):* (1) and (2) shipped; the dictation blank and a
  self-judged word-meaning check now run in the reader, and the walkthrough was
  already hosted there. Ear Tiles now run in place (slots in the sentence line, bank below; same day). Read checks (the reader's replacement for sentence review cards, evidence-only, spaced from events) and docked shadowing shipped the same day; the old sentence cards stay behind `sentenceCardsPaused`. Left (old note, partly done): shadowing as
  a docked panel (pitch contour, recording; iOS gesture-gated audio), Word
  checks beyond weak-word revisits (the planner only drafts them beside those,
  max 2 a plan, and not yet in a browser spec for the step route), and a
  WebKit/physical-iPhone check of the new tools (the
  Chromium phone and desktop layout pass is done in `e2e/reader-tools.spec.ts`).
- **Costs and constraints.** Shadowing needs a docked panel and its iOS
  gesture-gated audio setup, so it cannot fully dissolve into the text. Review
  behavior (self-rating, sibling burying, gates) is tuned inside `ReviewPage`
  and must not regress in a big-bang rewrite. Mined or review-only sentences
  have no episode context and need a single-sentence or short-window fallback.
  The schedule needs an obvious "next up" so the reader does not become
  open-ended wandering. Ratings stay explicit; tool results are evidence only.
- **Follow-up offers and activity effectiveness (agreed 2026-11-04, not built).**
  The reader tools (🎧 Dictation, 🧩 Ear tiles, 💭 Word check, 🎙 Shadowing)
  sit in an icon rail and nothing prompts the learner to open them, so they get
  almost no use while the old cards (`sentenceCardsPaused` off) stay the natural
  route. Direction: learning is sentence-led and in context, across five aspects
  — *reading*, *meaning*, *listening*, *pronunciation* (mostly shadowing/pitch)
  and *grammar* — and it is not obvious which activity best supports which
  (shadowing seems to help reading too), so measure it instead of assuming.
  1. **Embed, don't queue.** The Read check stays the entry point (self-judged,
     spaced 1…64 days; see `readCheck.ts`). When the learner answers "needed
     help", the reader offers one follow-up on that sentence chosen by what went
     wrong (Ear tiles for flow, Dictation blanking the weakest word, Word check
     for meaning, Shadowing for sound). No new planner steps or cards for these
     tools; once offers exist, `sentenceCardsPaused` can be turned on without
     losing dictation/Ear tiles practice.
  2. **Evidence gaps to close first.** The word-strength model has no listening
     facet: Dictation and Ear tiles outcomes are logged but nothing reads them as
     listening evidence. Grammar evidence (`grammarStrength`) is collected but
     the planner does not read it. Shadowing attempts are not linked to later
     reading outcomes. Pronunciation needs its own outcome check.
  3. **After-effect measurement.** Log every offer (sentence, aspect targeted,
     activity offered, whether taken). For each aspect define one outcome check
     (reading → next Read check got-it; meaning → next Word check on a word in
     the sentence; listening → next Dictation/Ear tiles result; grammar → next
     grammar-spot tap; pronunciation → next shadowing score/H-L match) and
     compare it in the following 1–7 days against sentences where the activity
     was not done. A `/progress` panel would show the table.
  4. **Vary the offer.** The learner agreed to randomising which follow-up is
     offered on some sentences so the comparison has a baseline, because
     activities chosen after a struggle look worse than they are. Record which
     were randomised.
  *Planner (2026-11-04):* Ear tiles, Dictation and phrase-shadow steps are drafted in the daily plan (STATUS).
  *Progress (2026-11-04):* steps 1 (Read check "needed help" → one offer, not a
  planner step) and 4 (random baseline draws, ~40%) are shipped, and every offer
  is logged as a `follow_up_offer` event (migration `20261104000000`). Listening
  evidence (step 2, first aspect) is shipped as `listeningEvidence.ts` (reader Ear tiles now log
  a slips-graded result). The step 3 panel
  (`/progress` → "After a follow-up offer") shows reading, listening, meaning (next Word check) and pronunciation (self-rated
  Good / Not good shadow, 2026-11-04) outcomes. Still to build: grammar evidence and a
  grammar column, and the aspect-specific cause picking (the rule today only
  knows "weak word → Word check, else listening, else sound"). Offers log no
  outcome; "taken" means the tool wrote events under the same `visitId`.
  *Open (pronunciation, noted 2026-11-04):* the pronunciation column mixes a
  whole-sentence Good / Not good with phrase shadows (Got it / Close / Not yet), which are
  one self-picked span and can be easier or harder than the sentence. Once there are enough
  phrase ratings (a few weeks of offers), report whole-sentence and phrase good-rates
  separately instead of pooling them. "Close" is already shown separately, not as a miss.
  Do not change the offer rule's Shadowing logic before the random-draw rows have data.
  Caveats: one learner, self-judged outcomes and a few hundred events mean
  associations, not proof; expect noisy results for a while. Keep ratings
  explicit and these events evidence-only. Related: step usefulness
  (`stepUsefulness.ts`, completed vs skipped), skill coverage, and the
  remediation counts in STATUS.
- **Separate Dictation and Word check from the Fresh try (asked 2026-11-08,
  not built).** After a day of Fresh tries the learner found that the checks
  folded into a Fresh try (word checks, Ear tiles, dictation) make it long and
  blur what is being practised. Ear tiles are already pulled out (their own
  planner step, `findListeningToolCandidates`); the wish is the same for
  dictation and word checks, and for the plan to use them deliberately to
  support understanding of the sentence rather than as extras tacked on.
  *Starting point (confirm in code before building):* the planner already has
  standalone `Dictation:` steps (only after a clean Ear tiles round, max 3 per
  plan shared with Ear tiles) and standalone Word check steps (only beside
  weak-word revisits, max 2 per plan, `WORD_CHECK_STEPS_PER_PLAN`). Those gates
  are probably why they still mostly appear inside Fresh tries. Check where a
  Fresh try itself still runs these checks and remove or make them optional.
  *Direction:*
  1. **Fresh try = understanding only.** Walkthrough, then optionally say it.
     No bundled checks, so its done-rule (a later-day finished walkthrough) and
     the `/progress` trouble-tag counts stay clean.
  2. **Word check = the meaning step for a sentence.** Offer it a day or two
     after a Fresh try on the sentence's weakest word (`getWordMeaningCheckTarget`),
     and when a tagged miss is Meaning/Kanji/Reading. Loosen the "only beside
     weak-word revisits" gate to "any introduced sentence with a weak word",
     keeping the 2-per-plan cap until usage shows it is wanted.
  3. **Dictation = the listening step, not gated on Ear tiles.** *(Tool choice shipped
     2026-11-08: Dictation first, Ear tiles after a slip or for long sentences; blanking
     the weakest word's phrase is not done.)* Let it start
     for a sentence that has native audio and a clean Fresh try, with Ear tiles
     as the easier alternative after a slip, rather than always Ear tiles first.
     It should blank the phrase that contains the sentence's weakest word, so
     it also reinforces meaning (`buildTileDictation` picks a tile today without
     reference to word strength).
  4. **Sequence per sentence, not per tool.** One sentence moves through
     Fresh try → Word check → Ear tiles/Dictation → Read check → phrase shadow,
     each at its own spacing, so a sentence is never asked for several tools
     in one plan (extends today's "skip sentences drafted a Fresh try that day").
  5. **Measure before tuning.** Reuse the follow-up offer table (`/progress` →
     "After a follow-up offer") and `listeningEvidence.ts`/meaning evidence to
     see whether a sentence's next Read check goes better after a standalone
     Word check or Dictation than after a Fresh try alone. Keep outcomes
     self-judged and evidence-only; ratings stay explicit.
  *Progress (2026-11-08):* only the Dictation-first tool choice shipped. The planner
  already drafts Word check as its own step; it was not made independent of the
  same-plan Fresh try because that needs its own candidate list (walked-through
  sentences with weak words, spaced from the last Word check). Where a Fresh try
  itself bundles these checks was not located in code. The learner's screenshot
  (2026-11-08) shows it is the Read check's follow-up offer ("Try Ear tiles on
  it?" after "needed help", `chooseFollowUp` in `followUpOffer.ts`), not the
  Fresh try. Its rule order was Word check (weak word), Ear tiles, Dictation,
  Shadowing; Dictation now comes before Ear tiles (2026-11-08, learner's call).
  Offer rows before and after that date are not directly comparable in the
  "After a follow-up offer" panel.
  *Open:* how many separate steps a day is tolerable (the plan's time budget
  bounds it today), and whether the typed dictation match should count toward
  `/progress` (see the writing-ladder note above).

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
