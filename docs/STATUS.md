# Status

Current implementation snapshot, reviewed 2026-10-18 against main at `024a4e9`.
Includes the incoming Ear Tiles refinement from `9be3657`.
Earlier chronological detail remains in `STATUS_ARCHIVE.md` (frozen) and git
history. `AI_OVERVIEW.md` describes features; `ROADMAP.md` keeps unfinished work
and possible extensions. This snapshot does not certify a live deployment.

## Current learning flow

- Sentence-led learning is on by default. A completed walkthrough introduces one
  `reading_in_context` card; word/grammar cards stay paused. Introduction gates
  use sentence learning events, started book membership or a sentence card.
- i+1 sentence order (opt-in, `settings.iPlusOneOrdering`, local to the device,
  2026-11-07): new lessons are ordered by known-word coverage instead of
  reading order (`orderByIPlusOne`, `loadIPlusOneContext`/`findExploreCandidates`).
  Known = content lemmas (default-checked `vocabularySuggestions`) of introduced
  sentences plus words whose reading/meaning card has been reviewed at least
  once; 1-2 unknown lemmas first (words that unlock the most other sentences
  leading), then all-known, with every Nth slot a harder sentence
  (`settings.iPlusOneStretchEvery`: 3, 5 default, 8 or never); untokenized
  sentences go last, never "0 unknowns". The rank is computed once over every
  book, so a good sentence in any book is offered ahead of a worse one in the
  most recently opened book (each book keeps its own order, Sentence Growth
  floating included; the planner merges books by next rank). The lesson's reason
  line names the new words ("new here: 空"). Episode momentum (2026-11-08):
  sentences from an episode (book + chapter) with many already-started
  sentences are favoured, up to +50% on the unlock value at 10 started
  (`episodeMomentumBoost`) and as a tie-break in the ready and stretch tiers, so
  a clearly more useful word still wins. Order only (a permutation: nothing
  gated or dropped); off in sequential study mode. The unlock-value ranking
  down-weights interjections/fillers and discourse markers (x0.2), grammar-bound
  verbs (しれる, x0.3) and proper nouns (x0.5) via `lemmaWeight`, for ranking
  only: those words still count as unknown. Limits: only しれる is on the
  grammar-bound list; exposure counts and self-ratings are not used.
  Grammar (2026-11-07): an unmet curated pattern counts as one more unknown
  piece, so "1-2 new pieces" covers words plus patterns. A sentence's curated
  patterns are its AI/manual `sentence_grammar` links that resolve
  unambiguously to the vendored OpenJLPT list (`src/data/openJlptGrammar.json`,
  CC BY-SA 4.0, id/pattern/level/formation only; regenerate with
  `npm run vendor:openjlpt-grammar`); a pattern is known once an introduced
  sentence carries it. Curated patterns are also found from the sentence text
  itself (`buildGrammarDetector`, with per-entry over-match guards in `src/lib/grammarDetectionGuards.ts`, audited by `npm run diagnose:grammar-detection`; shared-text senses resolve by context when each owner has a guard, listed by `npm run diagnose:grammar-ambiguous`: each entry's fixed text, split patterns in
  order, conjugated る-verb endings, longest match wins, entries sharing text
  skipped, fixed text under 3 characters ignored), so ~65% of candidates carry
  grammar instead of ~19% via AI links. A match may not start partway through
  a verb or noun token from the sentence's morphology (かった inside 分かっ+た),
  though い-adjective tokens are exempt since they carry their own inflection
  (楽しかっ+た); sentences without morphology fall back to plain text. Level-aware pacing (`grammarLevelCosts`): an
  unmet pattern above the easiest JLPT level under 60% met costs extra, so N2
  stays out of the one-new-piece pool while N4 is unmet. Vocabulary still leads
  ranking. The "new here" line names new patterns too, and a sentence-led book
  page has a "Ready to pick up" panel (`getBookReadyToPickUp`, computed when
  opened) listing the book's next sentences within two new pieces. Measure with `npm run diagnose:i-plus-one`.
- "Fresh try" revisits: automatic ones (parked checks, spaced schedule) are capped
  at `EXPLORE_REVISITS_PER_BOOK` per book per plan, counted after sentences in
  suspended episodes are dropped and only while that book has new lessons waiting
  (2026-10-28: the cap used to eat oldest-first due sentences from suspended
  episodes, leaving open episodes with ~0 steps and a short session); ones
  requested via the review card's "Fresh try this sentence" button are exempt
  from that cap and drafted first. The glossing time budget still bounds the total. A Fresh try counts as
  done (spacing advances, a pending request clears) once its walkthrough is
  finished on a later day than the first; a "say it" attempt is optional.
  Previously only `expression_attempt` counted, so the same sentences were
  re-drafted daily and crowded out new lessons (2026-10-21).
- Shadowing "Try again: Tomorrow / 5 days / 2 weeks" (2026-10-31): a button row
  on shadowing session-step rows and the Shadow page. It stores
  `settings.shadowSnoozes[sentenceId]` (end of the snooze, local-only like
  `shadowRequests`), which `findShadowCandidates` skips, and skips the sentence's
  open session step. A later Sound flag clears the snooze. Shadowing is not an
  FSRS card (the review-card attempt of 2026-10-30 was reverted the same day).
- Phrase shadowing (2026-11-03, trial): after marking a span narrower than the clip on
  the Shadow pane, "How did this phrase go?" offers Not yet / Close / Got it, logged
  as a `phrase_shadow` `sentence_learning_events` row (`rangeStartMs`/`rangeEndMs`,
  `target.label` = aligned phrase text, `target.key` = `phrase-shadow:<word ids>`).
  Evidence only: no Review or FSRS, not a whole-sentence attempt, and the planner
  does not read it yet. `buildWordEvidence` credits the words inside the phrase as
  reading recognition (Got it success, Not yet failure, Close nothing). Settings →
  "Pause sentence shadowing in the daily plan" (`sentenceShadowingPaused`, default off)
  empties the planner's shadow candidates; the Shadow page and reader tool are
  unchanged. The Supabase migration `20261103000000_phrase_shadow_events.sql` adds the
  action, the `close` outcome and the span columns; `npm run test:pg` covers it locally,
  and it is applied to production (checked read-only 2026-11-08: the span columns exist and
  36 `phrase_shadow` rows have synced). Follow-up plan under ROADMAP
  "Phrase shadowing". 2026-11-04: the span can come from the Loop window sliders as well
  as Mark start/end, the rating row sits under the sliders and prints the span's aligned
  words, and the pane offers "Suggested phrase … Use this phrase": the sentence's
  weakest-reading word (`orderLinksByWeakness`) with its following particle, widened to
  1–3 s (`suggestPhraseShadow`, needs a current reference alignment). One tap sets both
  the loop window and the target. The planner's "Shadow a phrase: …" steps (drafted while
  sentence shadowing is paused) are named after that phrase when the clip is aligned, and
  in the reader "I didn't" on a tapped word's Reading offers "Shadow this phrase" (opens
  the docked tool on that word). Covered by `e2e/phrase-shadow.spec.ts` (Chromium and
  emulated WebKit passed locally in the Playwright container, synthetic data) plus
  jsdom tests; the hands-on checklist is in `MANUAL_TEST_LOG.md` (P1–P8, none verified yet).
  2026-11-05: the loop sliders were too coarse for a short phrase inside a long clip, so while
  sentence shadowing is paused the estimated phrase is preset on open, and "Fine-tune phrase" (not persisted; only Adjust clip saves; the live pitch chart now covers the lead-in and pause)
  opens the zoomed edge editor (the "Adjust clip" one) on that span. Its Save changes the loop
  window and rated span only, not the audio. The editor's decode and Save path is not covered by
  jsdom (no audio decoding there), so it needs the hands-on pass.
- Review "Trouble with" chips (Reading, Meaning, Kanji, Sound; prototype,
  2026-10-20): optional, tapped before rating, never choosing the FSRS rating
  or crediting cards. Reading/Meaning/Kanji queue a Fresh try (walked-through
  sentences only; otherwise nothing is queued, the sentence is still a first
  lesson); Sound puts the sentence first in shadow candidates until a shadowing
  attempt is saved after the flag (`settings.shadowRequests`). Tag use is logged
  in the local-only `reviewTroubleLogs` table (not synced or backed up), so
  tags are per-device evidence. The `/progress` "Review trouble tags" panel
  summarises that log: tag counts, share of misses tagged, follow-ups done, and
  the next review's good/easy split with vs without the follow-up first (counts
  only, uncontrolled). The soft gate (surface remediation shortly after
  the review) and word-level tags are not built; remediation just leads the next plan.
- Daily audio top-up (`settings.dailyNewAudioCardQuota`, default 3, 2026-10-21):
  Review opens by seeding the first `ear_tiles` card (with the sentence's other
  pending audio cards) for up to that many sentences per day, even while cards
  are due. Lazy seeding only runs on an empty queue, which never happened, so
  no `ear_tiles` (and hence no dictation) card had been created. Counted from
  the database; 0 turns it off. The same floor applies to the first
  `reading_in_context` card of introduced sentences
  (`settings.dailyNewSentenceCardQuota`, default 5): none had been created after
  2026-10-18 for the same reason.
- Planner steps for the reader tools (2026-11-04): up to 3 two-minute `Ear tiles:` / `Dictation:`
  steps in the `review` bucket after the Read checks (`findListeningToolCandidates`,
  `src/lib/listeningTools.ts`; routes `/books/:bookId/tiles|dictate/:sentenceId`, step field
  `readerTool`). A sentence qualifies when it is introduced, in an active book, has native audio and
  splits into enough phrases; it starts with Dictation (2026-11-08; Ear tiles used to come first),
  falls back to Ear tiles after a Dictation slip or when the sentence is too long for Dictation, waits 7 days after a clean pass and 1 day after a slip, and comes first when its last Read
  check needed help. Sentences already drafted a Fresh try that day are skipped. With
  `sentenceShadowingPaused` on, the planner's shadow candidates are drafted as `Shadow a phrase:`
  steps (`phrase: true`, same `/speak/` route) instead of being dropped. The old audio cards still
  appear in Review unless `sentenceCardsPaused` is on, so both can ask for the same sentence.
- Audio reviews offer `ear_tiles`, then `dictation_tile:N` after Ear Tiles has
  two reviews and is out of learning/relearning. Whole-sentence dictation is
  retired. Typed-match feedback never chooses the FSRS rating.
  Ear Tiles accepts up to nine tiles and merges splits of ten to twelve tiles
  down to nine by joining the shortest neighbours, retaining inner punctuation.
  Single-tile dictation keeps the raw split and its nine-tile limit. A sentence
  now seeds only one new dictation tile (the first whose phrase no other
  sentence already dictates). The older multi-tile sentences were trimmed to
  the most-reviewed card each on 2026-11-01 (`npm run retire:extra-dictation-tiles`:
  38 of 48 soft-deleted, reviews untouched; applied to the production database,
  reversible by clearing `deleted_at`).
- Shadowing candidates are ordered by weak vocabulary after explicit sound flags
  and missed cloze cards, ahead of fewest attempts (`getWeakWordSentenceSignal`,
  selection only, local history). Sentence-first planning also revisits
  walked-through sentences (3+ days since last walked) for weak words, and
  `reading_in_context` asks for the typed reading of the sentence's weakest word
  from its second review (answers feed the model; the rating stays explicit).
  Each weak-word revisit also drafts a Word check step (max 2 per plan) that opens
  the reader's word check at `/books/:bookId/check/:sentenceId`.
  Grammar (2026-11-08): the same revisits also cover weak grammar patterns
  (`getWeakGrammarSentenceSignal`, from the reader's grammar taps; a pattern is
  weak by its weakest tapped facet, untapped is unseen not weak). Weak words
  fill the revisit room first; the reason reads "Has grammar that hasn't
  stuck: …". Each such revisit also drafts a Grammar check step (max 1 per plan,
  `grammarCheck`, `/books/:bookId/grammar-check/:sentenceId`) that opens the
  reader's `GrammarCheckPanel`: it names the pattern's text, hides what it is
  and does, then you judge your recall (evidence on the `use` facet only).
  The pattern asked about is the weakest tapped one, else an unchecked one
  (`pickGrammarCheckPatternId`). An optional typed answer before the reveal is shown
  back after it (not stored or graded). /progress "Grammar strength" shows pattern
  counts by level and the weakest ones (`getGrammarStrengthReport`). Counts as a
  grammar step in the session.
  Missing evidence is shown in the reader (2026-11-08): on the focused sentence
  each tappable word and grammar pattern has an evidence level
  (`getReaderEvidenceLevels`: `unchecked` = never tapped/reviewed/walked, `shaky`
  = strength below 0.6, `solid`). Unchecked ones get a thicker amber underline,
  shaky a muted one, solid words keep the plain underline, solid grammar patterns
  get a green solid one, and a line under the
  sentence names the unchecked ones. A tap makes an unchecked item shaky at
  once; the next load decides the real level. Display only, grades nothing.
  Words start from a JMdict frequency-band prior (fetched on demand from
  `public/wordFrequency.json`; none offline). Meaning has no recall evidence
  yet; see AI_OVERVIEW for the model.
- Reader, Analyze, review and Shadow support chapter layouts. The reader has
  per-sentence play/loop, new-word furigana (a word counts as known from card
  proficiency or reading strength of at least 0.6, so furigana and word help fade
  as a word strengthens), optional phrase/construction explanations, and
  in-place Dictation (blanked phrase), Ear Tiles (slots in the sentence line) and Word check (self-judged meaning) tools
  that log lesson evidence and feed the word-strength model's meaning facet.
  The two new tools have component tests and a Chromium browser spec
  (`e2e/reader-tools.spec.ts`, 390px and 1280px: no horizontal overflow, rail
  reachable, events persisted, no review or study item created); WebKit is not
  covered (its test contexts refuse the audio Blob; a later change runs the spec in WebKit through a
  disk-backed profile). Word check hides the word
  help and translation while it is open so they do not answer it.
- **Tap-a-word feedback (2026-11-01).** On the selected sentence each content word in the
  sentence line is itself a button (plain, new-word-furigana and furigana text modes; in a
  walkthrough the highlighted sentence and the "Words in this sentence" list items are buttons too). Tapping one asks separately
  about its reading and meaning ("I knew it" / "I didn't"), then shows both; the panel sits under
  the line, or under the walkthrough while one is open, and works during shadowing because the
  line stays above the docked panel. It logs `target_practice` events (`vocab-read:<id>` for
  reading, `vocab:<id>` for meaning, `assessmentSource: 'self'`): `target_masked` when that facet
  was hidden at the time (plain text / known word / no word help) counts as recall,
  `explanation_hidden` when it was showing counts as recognition. Evidence only: no `Review`, no
  study item, no FSRS. Taps are ignored (and the panel hidden) while Word check, Ear tiles,
  Dictation or an unrevealed Read check is open. The study tools sit in a sticky side rail at
  every width.
- **Tap-a-pattern feedback (2026-11-01).** Grammar patterns linked to a sentence (book assistant
  or hand tagged, `sentenceGrammar` with its text position) are tappable in the selected sentence
  line and the walkthrough's highlighted sentence (dashed accent underline; text a tappable word
  claims stays a word tap). The panel asks "Spotting it" and "What it does" ("I knew it" / "I
  didn't"), then names the pattern and its meaning here. Events are `target_practice`, target
  kind `grammar`, keys `grammar-spot:<id>` / `grammar-use:<id>`, `target_masked` (the pattern is
  not explained on screen when they judge), self-assessed; `buildGrammarEvidence` /
  `grammarStrength` (`src/lib/grammarEvidence.ts`) reuse the word-strength weights. Evidence only,
  not yet read by the planner or Home (next step).
- **Read checks and docked shadowing (2026-11-01).** The reader's 📖 Read check shows the
  sentence plain, reveals help and meaning on request, and logs the learner's own call as a
  `gist_check` event (no `Review`, no FSRS). `sentencesDueForReadCheck` (`src/lib/readCheck.ts`)
  spaces them from the sentence's evidence: 1, 2, 4, 8, 16, 32, 64 days per consecutive got-it day,
  reset by "needed help", measured from the last walkthrough, gist check or say-it attempt. The
  planner drafts up to 8 one-minute "Read check:" steps in the `review` bucket
  (`/books/:bookId/recall/:sentenceId`), most urgent first, with the waiting count in the first
  reason; a sentence drafted a Fresh try the same day is skipped. Settings → "Pause sentence review
  cards" (`sentenceCardsPaused`, default off, reversible, nothing deleted) withholds the
  reading/listening/Ear Tiles/dictation cards from Review and from the planner's batches.
  "Needed help" on a Read check now offers one follow-up on that sentence (2026-11-04,
  `chooseFollowUp` in `src/lib/followUpOffer.ts`): Word check when the sentence has a content word
  not yet known by strength, otherwise Dictation, Ear tiles (2026-11-08: Dictation first) or Shadowing, whichever can open. About
  40% of offers are drawn at random among the available tools as a baseline for comparing
  activities. An unrevealed Read check on a walked sentence also shows "I haven't walked this"
  (2026-11-08): it logs a synced `walkthrough_reset` event (migration `20261108000000`), and
  `withoutResetWalkthroughs` then ignores that sentence's earlier `walkthrough_completed` events
  wherever walked status is read (progress line, Read check pool, `requestFreshTry`). History is
  kept; the sentence's card is removed too (so it is no longer "introduced" via the card) only while
  it is untouched: new, no reps, no reviews.
  Each offer logs a synced `follow_up_offer` event (`followup:<tool>:<rule|random>`,
  migration `20261104000000`) under the Read check's visit; the follow-up tool shares that
  `visitId`, so "taken" is inferred from its own events. Nothing reads these yet: the after-effect
  comparison panel and grammar/pronunciation outcome evidence are still to build
  (ROADMAP, "Follow-up offers and activity effectiveness"). Listening outcomes are readable
  per sentence (`src/lib/listeningEvidence.ts`): reader Dictation results, review-card ratings on
  `ear_tiles`/`dictation_tile:N`/`listening`, and reader Ear tiles rounds, which now log a
  `target_practice` event (`eartiles:<sentenceId>`) graded by slips (0 = got it, 1–2 = close, more =
  needed help; observed, so no `assessmentSource`, and never a rating). `/progress` → "After a follow-up offer" (`src/lib/followUpEffect.ts`, `getFollowUpEffect`) groups offers by tool and rule-vs-random and shows how many were opened, the next Read check's got-it count (14-day window) and the next listening result, the next Word check on the sentence and the next self-rated shadow (7 days, a later occasion). The reader's docked Shadowing now asks "How did your pronunciation go?" (Good / Not good, `target_practice` key `shadow:<sentenceId>`, `src/lib/pronunciationOutcome.ts`; phrase shadows count too). Compare tools on the random rows only; Shadowing counts as opened once the sentence or a phrase is rated from the reader (phrase ratings log under the Read check's visit); the next-shadow figure shows good / close / not good.
  🎙 Shadowing opens `ShadowWorkspace` (`embedded`) under the sentence, and shadowing planner steps
  now open `/books/:bookId/speak/:sentenceId` in the reader; the standalone `/shadow/:sentenceId`
  page is unchanged. Episode preparation accepts the main JSON and
  structure lines together. Source-matched extras live in `sentence_extras`, with a read-only
  overlay for older inline book data.
- Progressive glossing and ungraded clause questions are available. Source
  matching invalidates stale questions and review notes. Reactions now sync via
  `clause_question_feedback`; old local reactions are imported once. Use
  `questions:coverage` for a fresh active-book inventory rather than historical
  counts. Independent reference review is still required before auto-grading.
- Mining imports are tracked in the synced `mining_imports` table (migration
  `20261026000000`, one row per episode keyed by canonical source id; last write
  wins). Quick import and YouTube mine write it at job start (feed, target book,
  episode date), on ready/failed, and on commit, and read it back when a job is
  resumed, so a reloaded page still commits a podcast episode into its series
  instead of a standalone book. Committed rows also feed the picker's
  "Imported" mark. The migration is applied in production (checked read-only
  2026-11-08: the table exists and has 25 synced rows). Known gaps: the NHK Easy
  page and the box-side job store are not tracked, a committed row keeps the
  "Imported" mark after the book is deleted on purpose, and a re-import of an
  already committed episode is allowed, not blocked.
- Remix and Sentence Growth are implemented on `/play`, using UniDic tokens.
  Both accept introduced sentences without vocabulary confirmation in the
  default flow. Growth rebuilds the original sentence from its own chunks and
  records Hard/Okay/Easy self-ratings. Game rounds remain local-only and do not
  write FSRS reviews. Growth-eligible lessons float within each book's existing
  preview window when planning is non-sequential.
- Shadowing includes native pitch preparation, phone-aligned mora targets,
  playback highlighting, pause-group rehearsal and cancellable listen–repeat.
  Attempt comparison uses measured contours; older attempts can have pitch
  snapshots backfilled. These features are on main; branch-only notes were stale.
- Book/chapter suspension, sentence-stage progress (grey = not started, purple =
  awaiting first review: has cards but none reviewed yet), chapter-level conflict
  choices and repeat-edit sync race fixes are implemented. Extras save/recovery
  retains failed or unverified server results. Source audio has a best-effort
  private Storage backup/restore path when the backend is configured.

## Test and maintenance review

See [TESTING.md](TESTING.md) for reproducible commands, measured coverage,
verification results and remaining gaps. This review adds regression coverage
for sign-in recovery and the Ear Tiles → dictation ladder, repairs stale
browser fixtures/assertions, and expands CI to the full offline backend and
browser suites. Coverage includes unimported application modules;
real-Postgres checks also run on relevant pull requests.

Performance testing now has a separate browser baseline command and configurable
request/body-byte budgets for sync and audio. The browser harness uses small and
large synthetic local libraries; Postgres uses the disposable migration/RLS
harness. Timings remain report-only. The new snapshot-based
[Supabase budget report](SUPABASE_BUDGET.md) projects cumulative usage,
time-weighted storage/disk and database capacity, with headroom/data-quality
warnings. A first manual snapshot (2026-10-19, Free plan) found every resource
within allowance; average storage is rising toward its 1 GB allowance.
Automatic retrieval is unimplemented. See
[PERFORMANCE.md](PERFORMANCE.md) for scope and reproduction.

Snapshot-report validation (2026-10-18): all 34 usage tests, application and
performance TypeScript checks passed. Lint passed with 36 existing warnings.
CLI smoke checks confirmed an example overrun and an incomplete blank template
(`--check` exits 2). Next: fill the template with actual dashboard figures;
broader import/restore workloads and calibrated UI timing gates remain open.

Added a two-device mixed-entity Postgres usage scenario (2026-10-18): restoring
161 word/kanji/link rows takes 6 requests; see [PERFORMANCE.md](PERFORMANCE.md).
Timing gates still need repeated comparable CI runs before limits are set.
Reference-audio storage moved to Cloudflare R2 (2026-10-21): the gateway Worker
is deployed, all live clips (3,126, 0.73 GB) are in R2, new uploads go to R2, and
the old Supabase copies were deleted, so R2 is the only copy of live clips (no
backup yet). Open items (usage monitor, budget alert, scripts still writing to
Supabase, second-account and limit checks) are in
[CLOUDFLARE_R2_PLAN.md](CLOUDFLARE_R2_PLAN.md). After that: restore coverage for
sentences/study items.

Review now reads meaning-choice and missed-reading history for the active card
only, through existing indexes. The question waits for a fixed history snapshot
and offers a retry on read failure. This removes the two library-wide history
reads from queue loading; see the [measured follow-up](PERFORMANCE_REVIEW_FOLLOWUP.md).

Pruned the unused SVG puzzle-path renderer and unused sync barrel. The active
chunk strip uses clause-tinted blocks. Older word/grammar flows, migration and
repair tooling, research materials and future roadmap ideas remain available.

## Open limitations and follow-ups

- **Aligner digit expansion (2026-11-08):** `shadowing-analysis-api` now reads every
  arabic number and common counter (年 時 歳 回 人 分 本 etc., incl. irregular
  readings) to hiragana before alignment (`app/number_expansion.py`), so
  `エピソード1で` no longer yields `<unk>`; `alignerView` mirrors it
  (`numeralExpansion.ts`, shared fixture). Still `<unk>`: じゅっ- forms, 100+
  with a counter, 600, 12345. Alignments stored before this stay wrong until
  re-aligned (not yet done); phrase shadowing's boundary snap
  (`snapRangeToWordBoundaries`, `dropLeadingParticles`) covers the gap meanwhile.
- **Duplicate book membership on push (2026-11-06):** two devices attaching the same
  sentence to the same chapter before syncing hit `book_sentences_book_chapter_sentence_uidx`
  (23505) forever and aborted the `book_sentences` push. The push now adopts the server's row
  (`adoptRemoteBookSentence`, `engine.ts`): local twin and its queued pushes dropped, server
  row kept. It covers both the insert path and the update path (a standalone episode book
  merged into its series moves the row locally while the server still has that id in the old
  book; the stale server copy is then tombstoned via a queued delete). Both are covered in
  `tests/pgIntegration/syncPush.pg.test.ts`. Settings also stopped loading every
  native-audio blob at once (iOS page kills). Series imports now queue only the membership
  rows whose position changed (a dozen out-of-order imports had queued 2000+ pushes).
- **All-kana ASR transcripts (2026-11-05):** slow learner speech (Slow Japanese) came back
  from `/transcribe-source` as hiragana (no kanji, no readings stored). The service now passes
  Whisper `hotwords` (`ANALYSIS_SOURCE_HOTWORDS`; re-injected every window, unlike
  `initial_prompt`) and re-transcribing the Episode #7 audio returned normal kanji-kana.
  `scripts/restore-kanji-sentences.ts` (dry-run by default, explicit substitutions in
  `scripts/data/restore-kanji-*.json`) fixed that episode's nine kana-only sentences in
  place: ids, cards and events kept, readings/suggestions regenerated, `sentence_grammar`
  offsets remapped, bundled clause questions updated. It refuses sentences with chunk
  analyses or vocabulary selections. Other earlier imports have not been scanned for
  kana-only text; the hotwords change was only tested on this one episode.
- **Imports and extras (2026-10-20):** chunk/walkthrough drafts are stored per
  chapter in `sentence_extras`. New standalone shadowing imports now get a
  chapter, a quick import that cannot save its extras says so on the book page,
  merging a book into another carries its extras, and Quick import has an "Add to
  book" selector (a new chapter of any non-archived book). Standalone books
  imported earlier have no chapter and no drafts; run "Generate extras with the
  assistant" after moving them. `repair:orphaned-sentence-extras` (dry-run by
  default) repoints drafts left on a deleted book; its first production dry run
  found none.
- **Grammar links (2026-10-31, steps 1-3 of 5 built; local checks only):** book-page
  "Generate extras with the assistant" has a "Grammar links" row. For sentences
  without links it asks the box assistant which of the learner's patterns each
  uses, then saves unconfirmed `sentence_grammar` rows (`ai_suggested`, with span,
  surface form and a per-sentence note). An unreviewed assistant link is visible
  only once its sentence has been introduced (`withoutUnseenAiLinks`, using
  `getIntroducedSentenceIds`): the walkthrough finish screen has a "Patterns here"
  block (`SentencePatterns`, with a one-tap "Not this"), and the Analyze "Grammar
  noticed" panel, the pattern page and the grammar list's counts, priority and
  membership all apply the same rule, so an assistant-created pattern stays out of
  the list until it has a visible link or a card. Unreviewed assistant links are
  also skipped when picking a grammar card's context sentence and when
  auto-tracking patterns (no silent cards; matters only in the optional older
  flow). The pattern page has a "Lined up" section (2+ visible encounters with a
  span): sentences simplest first with the pattern highlighted (matches share one
  column on a wide screen; plain highlighted sentences on a phone) and
  "Forms you have met" chips that filter by matched text. The clickable "seen
  before" callback is still to build (ROADMAP). Patterns tagged
  `family = no-auto-link` are never sent to the assistant; the 2026-10-31 cleanup
  (`merge:grammar-patterns`) merged six duplicate groups and tagged 22 entries.
  `sentence_extras.grammar_checked` (migration `20261031000000`) records sentences
  already looked at, so "nothing to link" sentences are not re-sent; the client
  sends the column only when true, so push works before the migration is applied.
  `diagnose:grammar-links` is a read-only dry run on a book's walked-through
  sentences. Not yet run through the real panel or against a live box run.
- **Parallel assistant calls (2026-10-28, local checks only):** Quick import and
  book extras have an "Agents" 1–5 selector (default 1); the box clamps it to
  `MINING_ASSIST_MAX_CONCURRENCY` (default 3, set in the service unit). Batches
  were also shrunk (segmenting 40→20 fragments, extras 25→15 sentences,
  book extras 100→50). Not yet run live: the service needs a restart to pick up
  the new unit/cap, and the 8 GB box's memory under 2–3 concurrent CLIs is
  unmeasured.

- **Game supply:** the 2026-10-17 production probe found only 30 qualifying Growth
  sentences (none introduced) and one introduced audio-backed Remix skeleton.
  These are dated observations, not a fresh inventory. Other games' individual
  confirmed-vocabulary gates may still restrict supply; changing them is a
  separate product decision.
- **Production exercises:** per-chunk typed/recorded Growth, pruning mode, Remix
  verb swaps and free/saved remixes remain unbuilt. See the production-bridge
  possibilities in the roadmap.
- **Native pitch:** timing/pitch needs perceptual review against real recordings,
  including `audio_6598874f` / `sent_519942fa`. Synthetic browser fixtures do not
  establish acoustic accuracy or physical-iPhone behavior. Speaking-rate ratio,
  contour correlation and a synchronized overlay cursor remain possible work.
- **Sentence lessons:** preserve the passage-first plan's unfinished ideas:
  accessible secondary controls, charging embedded due reviews once, scoring
  with help-level evidence, robust semantic masking and long-chapter
  virtualization. Spoken transfer/independent-expression recording and an
  expanding transfer-recheck schedule remain possible extensions; current
  spoken expression is self-reported. Promoting practised targets into durable
  word tracking needs a separate design that safely merges vocabulary links.
- **Layout:** the Analyze icon toolbar omits the clip Adjust control. The
  source-based adjuster works when a source URL exists; otherwise the Original
  layout supplies it. Shadow mark/loop toolbar controls still need a dedicated
  browser test. Persisting reader before/after counts and loop choice remains
  optional work.
- **Data integrity:** the 2026-10-17 integrity check was clean after chapter-order
  repair. Whether dropped delete-op conflicts should auto-retry remains open.
  An unrelated 605-row episode-order proposal was unexplained and unapplied;
  do not treat it as the completed Slow Japanese repair. Chapter conflict
  choices do not remove the underlying row-level conflict boundary.
- **Older data/content:** retain the bulk ASR re-mine proposal for fragmented
  pre-2026-08-23 imports (After Work, First Day at Work, GLIM SPANKY), an audit of
  pre-fix orphaned occurrence study items, and unresolved dictionary-accent and
  context-dependent reading gaps. Historical backlog counts are not current;
  use the existing diagnostics before proposing a repair. Keep distinct
  homograph readings (何/羽/話/後); grouping them in the browse UI is an optional
  presentation change, not permission to merge the data. Broader なる/する
  grammar-versus-content-word selection still needs semantic disambiguation.
- **Operations:** source-audio Storage mirroring supersedes the old durability
  blocker. Offline whole-episode cache/adjuster improvements, recording-retention
  pruning, per-request sync timing and the earlier Mac exit-node setup remain
  possible follow-ups; verify their current state before acting. Older-server
  extras recovery needs the updated backend on a fresh device. The 2026-09-13
  sentence-realign deployment handoff remains unverified in this audit.
- **Further learning work:** learned practice routing above FSRS is research
  only. The roadmap retains calibration/retention controls, pronunciation
  refinements, labelling improvements, free composition and all other possible
  work. Segmental pronunciation should follow a real learner error inventory;
  PASQA remains constrained by the analysis host's footprint.

## Services

- `server/youtube-mining` (this repo): mining/import, assistant runs,
  resegmentation, clip repair, source cache and `/status` resource diagnostics.
  The box-metrics timer samples resources every 15 minutes.
- `~/projects/shadowing-analysis-api` (separate repo): MFA alignment and
  faster-whisper transcription, accessed over the tailnet. Earlier operational
  notes record a Sunday 04:00 restart timer for accumulated MFA/kalpy memory;
  service health and timer configuration were not re-audited here.
- Supabase: optional sync and Storage. Synced records use soft deletion so other
  devices receive the change. Edge Function implementations live under
  `supabase/functions`; deployment state must be checked separately.
