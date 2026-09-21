# Status

Current-state snapshot. For the chronological blow-by-blow (files touched,
test counts, code-review findings, production-run logs) see
`docs/STATUS_ARCHIVE.md` and git history. For the feature-oriented
reference see `docs/AI_OVERVIEW.md`; for the at-a-glance phase list see
`docs/ROADMAP.md`.

Last updated: 2026-09-21.

## Where things stand

The original roadmap (Phases 0–9) is complete. All numbered phases plus
the later standalone efforts (Learning Orchestrator, re-segmentation,
vocabulary glossing, contextual conjugation cards, progressive listening,
grammar-pattern browsing/annotation) are shipped and, in almost every
case, verified against production data by the user directly. The
grammar-learning system's 4-card FSRS ladder was collapsed to one
`grammar_completion` card 2026-09-15, and `BookDetailPage` gained a
book-level progress section the same day — see Recent changes. ~1518 TS
tests, green.

**2026-09-01 pass** (see Recent changes): planner new-card-backlog
awareness, cross-sentence pronunciation profile (`/pronunciation`, closes
Phase 9's last milestone), grammar production ladder (`grammar_production`),
`reading_in_context` passage framing (closes the Phase 4 differentiation
gap), the retention/progress screen (`/progress`), the audio-less
pitch-accent drill (`/pitch-accent`), and a ROADMAP compaction. Only
remaining planned work: re-mine "After Work" (browser + human review).

**Mining pipeline v2** — slices A/B/C + wizard W1–W6 landed 2026-08-31;
what's left is one deferred durability item (below).

- **2026-09-20 — Phrase pitch view on the shadowing screen (native vs you, per phrase).** Step 2 of the
  phrase-level pitch plan. `src/lib/phrasePitch.ts` (`groupIntoPhrases`, `buildPhrasePitch`, `phraseFeedback`)
  groups the aligned tokens into phrases (content word + trailing particles/endings from a small closed
  `FUNCTION_TOKENS` list, split on pauses ≥ 150 ms), reads each mora's mean pitch over its *exact* mora interval
  (`phonesToMoraIntervals`), and fits a valid accent shape to each speaker (`fitAccentShape`). The native recording is
  the answer key — no dictionary target. Statuses: `match | different | flat | weak-native | no-learner`. Needs every
  token's phones to parse and sum to the sentence's mora count (~73% of sentences); otherwise that side reports
  "unavailable" rather than guess. `PhrasePitchView` (in `AnalysisPanel`, after "Word timing") shows kana with native
  H/L, your H/L beneath with mismatches flagged, a mini bar per mora for the raw contour, and one plain sentence per
  phrase. Deliberately compact; a fuller written explanation waits until the measurement is shown to be reliable.
  Tests: `tests/phrasePitch.test.ts`, `tests/phrasePitchView.test.tsx`. Also from the 97 hand labels: the
  squash guard flags 3/4 truly-wrong words and unflagged words are 95–97% within 50 ms, so no more word-boundary
  labelling is needed.
  Follow-up same day: the learner side was withheld whenever *any* of their tokens' phones didn't sum exactly to
  the reading, which is common for a learner. Now a token that doesn't parse is split evenly across its aligned
  span (`learnerTokenTimings`, counted in `learnerApproximateTokens` and noted in the view); only a different
  token count or a token with no span withholds it, and the message says which.
  Second follow-up: sent_0208b0fe (しゃっ！今日は田舎日記。) showed the native alignment can total the reading's mora
  count *by coincidence* (an `<unk>` on しゃっ hides 2 morae; the speaker says こんにちは for 今日は, adding 2), which
  laid the kana on the wrong sounds. A native alignment containing `<unk>` is now refused (`no-reference-timing`),
  and a `no-learner` phrase says how many of its sounds had a clear pitch. Open: the same coincidence can
  affect `buildKanaTimeline`'s exact path; not yet guarded.
  Third follow-up: a **"Report a problem with this"** button on the phrase pitch panel (also when nothing could be
  shown). It saves a `SyncIssueReport` (`conflictEntity: 'phrase_pitch'`, `conflictRecordId` = attempt id) whose
  `diagnosticsSnapshot` is `buildPhrasePitchSnapshot` — the rows, both speakers' word/phone timings (ms) and
  voiced-frame counts per token, because the learner's alignment and pitch exist only in the browser. Reuses the
  existing `sync_issue_reports` table, so **no migration**; it lists on `/issues` (heading now "Sync & analysis
  issues") and via `npm run issues:list-sync`.
  Fourth follow-up (regression fix): refusing any native alignment with an `<unk>` (second follow-up) removed the view
  from sentences that had it. Root fix: the phrase view no longer uses the sentence's reading at all. Kana and mora
  timing now come from each token's own phones (`phonesToSoundedMorae` in `moraTiming.ts`, which
  `phonesToMoraIntervals` now wraps), so it shows what was *said* (今日は → こんにちは) and an `<unk>`/reading mismatch
  can't shift labels; `buildPhrasePitch` lost its `moraUnits` argument and the `no-reading` state. A phrase with an
  unparseable token is skipped, not the whole sentence. Known weakness: when the learner says a word differently
  (きょう vs こんにち) their token has a different mora count than the native's and is laid out by an even split,
  flagged as approximate.

## Recent changes

- **2026-09-21 — Daily new-word top-up; 6 stuck links backfilled ("最初 has no study items").** Asked why a
  confirmed word (最初 in sent_2a106f9e) had no study items. Prod (read-only): 642 words with a live link, 103 with
  a card, **539 none** = 532 seedable + 7 never-seedable. Nothing was lost — cards are created lazily, and only
  once `ReviewPage`'s due queue is empty; since 2026-09-14, 232 words were confirmed and 22 first-seeded (0 on 5 of
  8 days) despite 15–185 reviews/day. **Fix:** new setting `dailyNewWordQuota` (default 12, Settings page, `0` = off);
  when `ReviewPage` builds its queue it seeds up to `quota − words first-seeded today` never-introduced vocabulary
  words (`src/lib/newWordQuota.ts`, `countVocabularyWordsSeededSince` — counted from the DB so reopening Review
  can't exceed it), appended after the due cards and counted toward `newCardsPerSessionLimit`. A floor: the lazy
  queue-empty path still runs. The planner still reserves `min(backlog, newCardsPerSessionLimit)` new-card
  minutes (slightly over-reserves vs 12). At 12/day the 532 backlog takes ~44 days; you confirm faster than
  that, so the backlog will keep growing — raise the quota, or pick words more selectively in Analyze.
  **Backfill:** the 7 never-seedable links were old Anki-import rows with no `surface_form`; the sentence spells
  the word in kana, not its kanji. `backfill-vocabulary-surface-forms.ts` gained a tier 3 (`surfaceFormFromReading`:
  the item's reading as hiragana/katakana, accepted only if it occurs exactly once) and `--apply` fixed **6**
  (綺麗→きれい, 餌→えさ, 何とか→なんとか, わし→ワシ, たか→タカ, 達→たち). **7 links still have no surface form**
  (inflected or numeral: おいしい→おいしそう, です→でし(た), なる→なり, できる×2, 三→３) — re-confirm those in
  Analyze. Tests: `newWordQuota` (3), 3 `reviewPage` (seeds while due / off / already-seeded-today), `surfaceForm` (2);
  one existing interleaving test now sets the quota to 0 (it is about the lazy path).

- **2026-09-21 — Pitch drill takes are stored in Supabase (audio + alignment + pitch + optional self-label).**
  Follow-up to the grader change: we couldn't replay it on the learner's own takes because only per-word
  verdicts were logged. Migration `20260921000000_pitch_drill_takes.sql` — table `pitch_drill_takes` (one row
  per take: `alignment`, `pitch` (rounded frames), `targets`, `results`, `labels`, `grader`) + private
  `drill-takes` bucket (path `{owner}/{take}.ext`, owner-only policies on both, update/delete allowed so a
  retention prune is possible later). `src/sync/drillTakeRemote.ts` uploads best-effort after each analysed
  take (audio first, then the row — row still written if only the audio fails); direct access like
  `reference_alignment`, no Dexie mirror, no sync-event wiring. After a take the drill shows an optional
  **Felt right / Felt off** toggle per scored word (`DrillTakeLabelsPanel`, stored in `labels`) — deliberately
  after the take, never before, so it can't become a guess gate. `DRILL_GRADER_VERSION` = `fit-rescue-flat-v1`.
  No retention cap yet (≈60 KB/take; revisit past a few thousand takes). Not covered here: reading takes back
  (a replay script — write it when there are enough labelled takes). Tests: `drillTakeRemote` (7),
  `drillTakeLabels` (2), `tests/pgIntegration/drillTakes.pg.test.ts` (RLS on real Postgres). `test:pg` now
  runs its files serially (`--no-file-parallelism`) — they share one database. **First migration pushed after
  the Supabase GitHub integration was enabled — it did NOT auto-apply** (6+ min, `check:migrations-applied` still
  reported the table missing, no Supabase check on the commit); the integration had not actually been
  enabled; it was turned on afterwards and `pitch_drill_takes` was applied **by hand** (28 tables / 392 columns
  verified by `check:migrations-applied`; live round-trip of the bucket + table on prod OK, test data removed).
  Whether auto-apply works stays **unproven until the next new migration**. `apply-migrations.yml` (manual-only
  `supabase db push` + verify, needs repo secrets `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD`) is the fallback.

- **2026-09-21 — Learner pitch grader: fit can rescue a false mismatch; flat takes flagged.** The drill /
  shadowing grader (`buildPitchAccentShapeObservations`, `buildLearnerPitchAccentShapes`) still used the
  per-mora-vs-mean rule that agrees with the dictionary on **native** clips only 40% of the time (4-mora heiban
  10%) — so a correct plateau could be marked wrong. New `gradeLearnerMorae` (`pitchAccentObservations.ts`):
  (1) the valid-shape fit (`fitAccentShape`) is used only when it *equals the dictionary shape and agrees with the
  raw reading on the opening mora* — a rescue, never a rewrite (first attempt snapped every take to a valid shape
  and turned "you started 「たまご」 high" into "sounds like atamadaka"; an existing test caught it); (2) a take
  whose fitted high−low contrast is under `FLAT_CONTRAST_SEMITONES` = 0.5 gets a low-confidence "barely moved"
  observation instead of a verdict, so a level take can't pass by fitting heiban. **Floor from data** (audit,
  169 fitted native clips, `--tsv` now carries `fitShape`/`fitContrastSt`): floor 0.5 flags 11% of natives and
  agreement among the rest is 57%; 1.0 flags 19% (58%); 2.0 flags 40% (63%) — higher floors barely help, so 0.5.
  **Not measured:** how many of *your* takes flip — drill takes aren't stored (only shapes), so no replay was
  possible; the native-clip benchmark is the only evidence, and it tests the fit, not the grader's extra
  opening-mora guard end to end. Watch `pitch_drill_attempts` mismatch rate on long heiban words after this.
  Tests: 5 new in `pitchAccentObservations.test.ts`.

- **2026-09-21 — Prod-schema check (`check:migrations-applied`); matchWord items closed.** Migrations
  only reach prod if someone applies them, and a miss fails quietly (2026-09-11/12 `books.suspended_at`).
  New read-only `npm run check:migrations-applied` (`scripts/check-migrations-applied.ts`; manual
  workflow `check-migrations-applied.yml`, same secrets as `check-duplicate-books`): replays
  `supabase/migrations/*.sql` into expected public tables/columns
  (`scripts/lib/migrationSchema.ts` — create table, add/drop/rename column, drop table) and probes prod
  via PostgREST `select=cols&limit=0`; exits 1 and names anything missing. Tables + columns only, not
  policies/indexes/functions/buckets. The parser is verified against a real Postgres by
  `tests/pgIntegration/migrationSchema.pg.test.ts` (runs in `npm run test:pg` and the pg-tests
  workflow, which already triggers on `supabase/migrations/**`) — a migration in a shape it can't parse
  fails there. First prod run: **27 tables / 375 columns from 24 migrations, all present.** The Supabase
  GitHub integration is connected with "Deploy to production" on for `main` (Pro is only needed for
  preview branches). Its history table was empty (the 24 older migrations were SQL-editor-applied), so
  the first push would have re-run them; **baselined 2026-09-21** by inserting the 24 versions into
  `supabase_migrations.schema_migrations` from the SQL editor (Database → Migrations now lists exactly
  24). From here a new file in `supabase/migrations/` applies itself on push to `main`; run
  `check:migrations-applied` after the first one to confirm it landed.
  Also: the two `matchWord` follow-ups turned out already closed (numeral drift fixed by `36a6195`;
  repeated surface form is not a bug, see 2026-09-20) — ROADMAP/notes corrected.

- **2026-09-21 — Review-card issue triage: passage context on vocab cards; suspended books no longer feed grammar
  cards.** Six open reports. (1) Two `grammar_completion` reports ("This book was suspended", 緊張してる？):
  `studyItemIsHeldBackBySuspension` deliberately never holds back `grammarPattern` subjects (a pattern isn't
  book-scoped), but the card's context sentence is picked from the pattern's linked sentences, and that one lived
  only in *First Day at Work*, suspended 2026-09-15 — so the shelved book kept surfacing. `pickContextSentenceFor
  GrammarPattern` now takes an optional `suspendedIndex` and skips suspended-only encounters; a pattern with none
  left drops out of the queue (and out of the planner's due backlog via `filterReadyGrammarDueItems`). The
  persistent `deferUnreadyGrammarReviews` deliberately omits the index — a temporary suspension shouldn't push
  stored due dates out. (2) Three reports (reading_retrieval ×1, cloze ×2) asking for the two preceding sentences
  ("if those aren't available, the following one"): the reading-order context `reading_in_context` and grammar
  cards already use is now passed to `VocabularyTargetCard`; it shows the two before, or the one after when
  nothing precedes. On an unrevealed `cloze` the target surface form / dictionary form is masked (`_____`) inside
  those neighbours so context can't leak the answer. No extra readiness gate on the neighbours (unlike
  `reading_in_context`). (3) The remaining cloze report (まあでも夏休みですね。 — "lots of ways to say *well*,
  recommendations?") is a question, not a bug: context should help; excluding fillers/interjections from cloze is
  an open option, not done. Tests: `data.test.ts` (picker + suspension), `reviewPage.test.tsx` (context + masking).

- **2026-09-20 — Native pitch shape: fit a valid accent shape instead of judging each mora against the mean
  (40% → 56% agreement with the dictionary).** Step 1 of the phrase-level pitch plan. The per-mora rule
  (`classifyLearnerMorae`: high if ≥ the word's mean) fails on plateaus: the audit's per-shape breakdown showed
  long heiban words at **10%** (4-mora `lhhh`) and 38% (`lhh`) — the later morae drift a little below the mean and
  are called low. New `src/lib/pitchShapeFit.ts` (`fitAccentShape`, `validAccentShapes`): least-squares fit of
  the app's own valid in-word shapes (`expectedPitchShape` positions 0..n) to per-mora mean pitch, free level per
  class, **high ≥ low enforced** (without it every plateau "fits" by flipping polarity: 30% and 0% on heiban),
  unvoiced morae abstain, returns the contrast (semitones) and the margin to the runner-up. *Experiment
  (`scripts/experiment-pitch-classifier.py`, 219 native clips, exact mora intervals; agreement = measured
  shape equals dictionary shape):* baseline **71/178 = 40%**; valid-shape fit **93–94/169 = 55–56%**; with a
  contrast ≥1 st floor 58% of 137 (fewer measurable); median 53%; middle-60%-of-mora frames 52%; second-half
  57% of 142; outlier trimming 44–51%; a linear drift term 43% — **the plain fit on all frames wins**
  (correct-count and simplicity). Per group: `lhhh` 10→43%, `lhh` 38→63%, `hlll` 25→75%, `hll` 36→55%,
  `lhl` 29→42%; `lhll` 33→22% and `lh` 53% unchanged (small n). **Native audio only, deliberately:** a learner
  can produce a contour that is not valid Japanese (flat; high start with no drop) and forcing it into a valid
  shape would hide the mistake, so the learner classifier stays descriptive — the fit's `contrastSemitones`
  is how a flat production shows up (≈0). Wired into `measureNativeWord` (`fitShape` / `fitAgrees` /
  `fitContrastSemitones`) and printed by the audit next to the old rule. Absolute agreement is still only ~56%:
  natives don't always realise the *citation* accent audibly in connected speech (which is itself the argument
  for teaching from the native recording rather than a rule-predicted target). Tests: `pitchShapeFit` (8),
  two in `nativeClipPitchAudit` (a drifting heiban plateau: old rule `lhhl`, fit `lhhh`).
  **Next:** the phrase view (group tokens into accentual phrases; show the native contour per mora, marked H/L
  by this fit, with your recording overlaid and a plain-language reason for a mismatch).

- **2026-09-20 — Flaky test (mine): labelling page batch test.** The multi-item "goes straight back into the same
  batch after a refresh" test waited for "Session done" with the default 1 s find-timeout and timed out on a
  CPU-starved CI runner (3.4 s), failing the deploy. `labelWordAudioPage.test.tsx` now sets
  `asyncUtilTimeout: 5000` and a 20 s test timeout for the whole file (it decodes audio and writes to
  IndexedDB repeatedly per test).

- **2026-09-20 — Pitch scoring uses exact mora intervals (measured improvement on the native-clip audit).**
  `classifyLearnerMorae` — the per-word high/low classifier behind production feedback — split a word's time into
  **equal-width buckets, one per mora**; morae aren't equal (a long vowel is two, a geminate is silence, a
  devoiced vowel is short), so a high/low call could land on the wrong slice of the F0 track. It now derives the
  word's mora intervals from its own aligner `phones` (`phonesToMoraIntervals`) whenever they parse into exactly
  the expected number of morae, and is unchanged otherwise (an explicit `moraIntervals` argument overrides;
  `null` opts out). Applies wherever the word alignment carries phones — reference and learner alike. *Evidence,
  from `audit-pitch-accent-clips.ts` (new `EXACT_MORAE=1` mode; 219 native clips of citation-form words):*
  agreement of the measured shape with the dictionary shape **35% → 40%** (63/179 → 71/178), median cue strength
  **1.1 → 1.7 semitones**, weak-cue share **53% → 48%**; exact intervals applied to 202 of 219 clips. Absolute
  agreement is still low (native clips often don't realise the citation accent audibly, and the per-bucket-mean
  H/L rule is crude) — so this is a step, not a solution; better H/L rules (slope, peak vs mean, relative to
  neighbouring morae) are the next lever for the phrase-level feedback. Tests: 4 in
  `pitchAccentObservations.test.ts` (a long vowel where equal thirds and exact intervals disagree: `lhh` vs `llh`).

- **2026-09-20 — Flaky test: `VocabularyListPage` "edit meaning inline".** Timed out at 5.06 s in full-suite runs
  (fast alone: ~1 s for the file). Cause: its inner `findByText('Saved', { timeout: 5_000 })` equalled vitest's
  default per-test limit, so the *test* timed out whenever CPU was starved, before the wait could. Given an
  explicit 20 s test timeout.

- **2026-09-20 — Kana timeline: exact per-mora timing (item B).** `buildKanaTimeline` (the mora labels under the
  pitch contours in `AnalysisPanel` / `PitchAccentDrillPage`) had two guesses: *which morae belong to which
  word* (character proportion) and *where each mora sits inside a word* (spread evenly over its phones).
  Now, when every audible token's phones parse into morae (`phonesToMoraIntervals`) and the counts add up to
  the sentence's mora list, each mora gets its own measured interval (`exactMoraIntervals`) — long vowels split
  at the phone's midpoint, geminates into っ + onset, dropped devoiced vowels recovered. Any mismatch (`<unk>`,
  a reading that differs from the speech such as にっぽん/にほん, a learner who elongated or skipped a sound)
  falls back to the old approximation for the whole sentence, so nothing regresses. **Coverage on prod:
  637 of 868 sentences (73%); 84% of those with no `<unk>` token** (124 sentences contain one; 118 have no
  reading). Applies to reference *and* learner alignments. This is the foundation for phrase-level
  pitch work (per-mora F0 slices need mora boundaries). Tests: 4 new in `kanaTimeline.test.ts` (exact
  intervals from real phone shapes, long-vowel split, fallback on count mismatch, fallback on `<unk>`,
  refuses without phones).

- **2026-09-20 — Repeated words: not a playback bug — a labelling hint; override audit.** Investigated the
  "`matchWord` takes the first occurrence" item (33 of 1334 links, 2.5%): **the data can't say which
  occurrence a link means** — there is exactly one `sentence_vocabulary` row per word per sentence,
  `sentence.targetVocabulary` was empty for 30 of the 33 sentences, and `vocabularySuggestions` lists *every*
  occurrence. So each occurrence is an equally valid native example and playing the first is correct; the 声
  "miss" (1.7 s) was the labeller highlighting the first occurrence while the user labelled the second
  (the aligner's timing there is also questionable). Fix is in the labeller: a line "This word appears N
  times in the sentence — label the highlighted (first) one" + the same sentence in the rules panel;
  `occurrenceCount` (tested). Treat that one label as ambiguous, not as a matching bug. *Override audit
  (read-only, dry run):* 40 backfilled ranges still correct, 21 manual untouched, **2 stale — 簡単
  [1120,1540] and 8月 [340,950]** — for both the current logic returns no span (the squashed-alignment
  guard now flags the timing there) yet the stored override would still win; not cleared, awaiting the
  user's go-ahead (`audit-backfilled-word-ranges.ts --apply`).

- **2026-09-20 — Labels file: a plain "Download file" button; second file analysed (62 labels).** On iPhone
  the share sheet handed the user an awkward Apple attachment (save to Notes → share → hunt for the real
  filename). New **Download file** beside **Save labels** skips the share sheet (`saveLabelsFile(...,
  { download: true })`): Safari puts a real `.json` in Files → Downloads. *Second file (62 labels, 10 new,
  all from the old worst-first "Needs review" batch; backed up in `~/data/word-boundary-labels/`):* on
  those 9 scored items (chosen because token and mora cut disagreed) the mora cut was **exactly right in
  8 and within 50 ms in 1**; the whole-token cut overshot by 320–720 ms every time. A biased sample —
  kept out of the fair numbers (default analysis = random only) — but strong support that when the two
  methods disagree the mora cut is the right one. 1 skip (`reduced`: 行っ). The 52 random-sample results
  are unchanged.

- **2026-09-20 — CI flake: `getStudyItemDebugInfo` "most-recent-first" test.** Two `recordReview` calls in the
  same millisecond tie on `timestamp`, so the newest-first sort returned them in random-id order and CI
  went red (the deploy was skipped) — the same ms-resolution-timestamp class as the sync-queue flake
  earlier today. Test now passes distinct `now` values. Not a production bug: real reviews are seconds
  apart.

- **2026-09-20 — Labeller rules: devoiced vowels count (聞こえ heard as "tsukoe").** User couldn't hear
  "kikoe" in 「あまり聞こえません」. It is the き **devoiced** (a high vowel between voiceless sounds is
  whispered; what's left is the k-release burst, which sounds like tsu/shi/chi) — the same effect that makes
  the aligner drop such vowels from its phone list. Guidance: label it, starting at the burst; "slurred /
  merged" is only for words with no separable start (行って after に). Added to the rules panel.

- **2026-09-20 — Labeller: "Your recent labels" — fix a mis-tapped skip after a reload.** User tapped
  "Word isn't in this clip" too quickly on a slurred word and "Undo last" was greyed out (it only knows the
  current page load's labels). The start screen now has a collapsible **Your recent labels** list (latest
  15, survives reloads): a skipped label has a reason dropdown (change it in place), any label has
  **Delete** (second tap confirms) which puts the word back in the pool. `updateSkipReason` only touches
  skipped labels. Deleting then re-labelling is how a corrected/clean label is redone. Tests: three page
  tests (change reason, two-step delete, non-skips have no reason).

- **2026-09-20 — Labeller: "Word is slurred / merged into its neighbour" skip reason.** User hit
  「羽田空港に行って」: the speaker says "nitte" (the い of 行って merges into the に's vowel), so the target
  word has no separable start. Not a speaker error — ordinary casual-speech vowel merger — and not "word
  isn't in the clip" either. New `WordBoundarySkipReason` `'reduced'`: the item is skipped (kept out of
  the accuracy numbers — marking an edge would record a guess) but counted, and the rules panel says when
  to use it. Also a useful data point for the aligner side: the reading says 3 morae (いって) where the
  speech has fewer, which is exactly the phones-vs-reading mismatch that makes the mora cut fall back to
  the token edge. Test added.

- **2026-09-20 — Gold set is randomised, never hand-picked: "Needs review" became "Tricky cases"
  (random within situations); Adjust fixes stay separate from labels.** User's principle: the gold set
  should be *randomised selections of the things we want to target*, and fixing a card (Adjust) must not
  double as labelling. Adjust and labels were already separate (Adjust = the synced card loop range;
  labels = device-local strict word), and stay so — a fix made because a clip *looked wrong* is a
  selected-because-bad sample. The flaw it exposed was mine: "Needs review" took the **worst-first**
  items (largest token-vs-mora disagreement, flagged first) — a hand-picked, biased list you can't
  generalise from. Now: `LabelStratum` (`unreliable-timing` (guard flagged), `mid-token`, `very-short`
  (<250 ms mora cut), `repeated-word`, `digits-or-latin`, else `plain`; first match wins; `stratumOf`).
  **Random** = book-stratified random over everything (overall accuracy). **Tricky cases** = random *within*
  each situation except `plain`, equal allocation across the situations present so a rare one (flagged
  timing, ~5%) still gets sampled (`pickLabelQueue`, seeded-PRNG tested; a test asserts it is *not* the
  worst-first order). **Every label — from either mode — records `stratum`, `stratumCount` and `poolSize`**
  (kept in the stored session so a refresh keeps recording them), so a per-situation error rate is valid from
  either sample and a stratified result can be re-weighted to the corpus share. The chip reads "Sampled
  from: target ends inside a longer aligner token". `npm run analyze:word-boundary-labels` prints
  a **By situation** table (typical miss, within-50, misses ≥250 ms, pool share). Tests: `stratumOf` /
  `stratumCounts` / equal-allocation / not-worst-first, and page tests for the recorded fields, the mode
  and a resumed batch. Existing labels (52, all `random`, no stratum) stay valid for the overall numbers.

- **2026-09-20 — Adjust now uses the zoomed edge editor; ±100 ms bump; flagged words say so.** User: liked
  the labelling UI, asked whether it could replace the old "Adjust", and for a 100 ms bump for big
  misses. `WordAudioRangeEditor` (whole-sentence drag, ~1 px per 10 ms) is **removed**; `SegmentLoopPlayer`'s
  Adjust opens `ZoomedRangeEditor` (new; two `BoundaryEdgeEditor`s + Play toggle + Save / Cancel / Reset
  to automatic). **Same data, same meaning as before:** the saved span is the link's synced
  `audioStartMs/EndMs` — what the *card loops*, so pitch cards should keep the ending/particle in it —
  which is deliberately **not** the strict-word labels (those stay in the device-local label table).
  Behaviour changes: nothing is written until Save (was: on every drag end), Save is disabled until an
  edge moved (so an untouched span isn't frozen as an override), and the toggle reads "Close". Both
  editors gained **±100 ms** buttons (`BoundaryEdgeEditor`). When the squashed-alignment guard withheld the
  span, the hint reads "The timing here looks unreliable — tap Adjust to set it by ear" instead of the
  generic "couldn't isolate". Tests: `segmentLoopPlayer` (+4: guard message, Save persists, Cancel /
  Save-disabled, Reset), one ±100 test on the labelling page; `wordAudioRangeEditor.test` deleted with
  the component. *Not built (proposed):* a proactive "N words need fixing" list (flag at import /
  re-alignment) — the guard already runs wherever a word is used, and the labelling screen's "Needs
  review" ranks flagged items first.

- **2026-09-20 — Squashed-alignment guard: a target near an over-compressed token falls back to the
  whole sentence instead of playing a confidently wrong span.** Built from the 52 labels + the corpus.
  *Signal:* the aligner mis-times a stretch of speech (drawled 「ちょっとねー」, Latin `VIP`) by crushing
  tokens to a few frames (3 morae in 90 ms) and shifting the words around them 0.6–1.7 s. A token of ≥2
  morae under **45 ms/mora** (`SQUASHED_MS_PER_MORA`; mora count from its phones) **within 2 tokens**
  (`SQUASH_NEIGHBOURHOOD`) of the target marks its timing unreliable. **On the labels: 4 of the 7 misses
  ≥250 ms flagged (every squash-caused one) and 0 of 45 good items** — threshold sweep 40/45/50/55/60:
  40 lost one catch, ≥50 added a false alarm without a catch. Local, not sentence-wide: `セッション`
  (err 0) shares a sentence with the squash but sits 8 tokens on, so "any squash before the target"
  would have been a false alarm — the radius matters. *Tried and dropped:* long trailing `<eps>` (good
  alignments have as much: median 1.4 s, max 3.5 s = the same as the bad 声 case). *Not caught:* early
  starts (今日 +510 ms, いろいろ +270 ms) and the repeated-word bug (声). *Cost:* 4.6% of the corpus's
  words (38 of 826 resolvable links; 3.6% at 40, 5.8% at 50) lose isolation; the flagged examples I
  eyeballed are real squashes (今日 = 70 ms after a 1 s ジャパニーズ; 上手い = 3 morae in 120 ms). Flagged
  targets return null from `isolatedWordRange/Spans/MatchRange` (all consumers' existing whole-sentence
  fallback; the games skip them). `matchWord(..., { includeUnreliable })` lets the **labelling tool still
  see them**: `estimateWordSpans` returns the raw token/mora spans plus `unreliable`, `shipped: null`;
  "Needs review" ranks flagged items first (that is how the guard gets checked) and the chip says why.
  `npm run analyze:word-boundary-labels` now prints error / misses-≥250 ms for flagged vs not (for labels
  made after this shipped). Tests: `squashedAlignment` (11) using the real VIP-sentence shape.

- **2026-09-20 — First hand-label results (52 random labels) → the 200 ms mora-cut floor removed.**
  User's first saved file (52 labels, all `random`, 7 books; backed up at
  `~/data/word-boundary-labels/`; 35 accepted as detected, 8 small corrections <100 ms, 5 large, 4
  relocations; median 21 s per item, ~6–10 s when accepting). Both the whole-token and the mora cut have
  **median error 0 ms** at both edges; the tail is what matters. Within 50 ms: token 88% start / 65% end,
  mora cut 88% / 81% — the mora cut's advantage is the *end* edge (token overshoots when the target ends
  mid-token). Per-book bias: none visible (n=6–9 per book; one book -12 ms start). Pad calibration on the
  mora cut: onset p90 0 ms, tail p90 97 ms (ceilings 30/60 — tail is the only side that ever needs more).
  **The floor decision, settled by labels not judges:** the CTC judge had leaned against mora cuts under
  ~250 ms, so a 200 ms floor (keep the token edge) was added. Against the labels it *hurts*: with the floor
  the 90th-percentile end miss is 364 ms, without it 99 ms (ends within 50 ms 81% → 85%) because real
  short words (見 = 130 ms, あり = 180 ms) were being handed their whole token. `MIN_MORA_CUT_MS` is now
  just the 60 ms sanity limit. (The floor test that shipped with it passed vacuously — its token text
  was kana while the sentence was kanji, so no cut ever ran; fixed, and the new pair of tests
  genuinely exercises both sides.) **What the other misses are** (9 of 52): 2 were the floor (fixed);
  ~6 are **aligner failures, not matching bugs** — 「ちょっとねー」 drawls (×2 sentences, ×3 labels)
  where MFA marks ~0.8 s of speech as `<eps>`/squashes ちょっと to 120 ms, and "またVIPメンバーに
  なると" where the Latin `VIP` collapses the following words ~1.6 s early (`私` gets 1.5 s); a couple of
  starts 270–510 ms early (今日, いろいろ — leading breath/noise absorbed into the word); and 1 is the
  **repeated-word bug**: `matchWord` uses the *first* occurrence of the surface form (声 appears twice in
  its sentence; the link is the second). That affects 33 of 1334 links (2.5%). Not fixed here: needs
  occurrence info the link doesn't store (candidates: `vocabularySuggestions` spans). Ideas noted on the
  ROADMAP (squashed-alignment detector; occurrence disambiguation). 52 labels is a first look —
  ~40 random was the target, so the picture is usable but the tails are only 9 items.

- **2026-09-20 — Labeller: batch sizes, stop/resume, survives a refresh.** User: the session reset on
  refresh and a 25-item batch is a lot. Labels were always written per item; what was lost was the
  *batch* (React state only), so a refresh drew a fresh random set. Now: **batch size 1 / 5 / 10 / 25**
  ("1 at a time"; default 10, remembered), a **"Stop for now"** button, and the batch plan is kept in
  localStorage (`src/lib/labelSession.ts`: the ordered item ids + sample kind + `paused`; **progress is
  never stored** — what's left is always "planned items with no label", so undo, another device's labels
  and crashes stay consistent). A refresh mid-batch goes straight back to the next unlabelled item
  ("2 / 10"); after "Stop for now" a refresh instead shows "You have a batch in progress — N of M left"
  with Resume / Discard this batch. A finished batch, or a plan whose items were all labelled or became
  unlabellable, is forgotten. Unsaved edits to the *current* item are still lost on refresh (only that one
  item). `loadWordBoundaryCandidatesForLinks` rebuilds a saved plan in its original order. Tests:
  `labelSession` (4), five batch tests in `labelWordAudioPage`, one loader test.

- **2026-09-20 — Labeller: "Couldn't decode this recording on this device".** The labelling page decoded
  the locally stored recording once and gave up. Known Safari behaviour (see the `useRangeLoop` /
  `repairSentenceAudio` notes): IndexedDB sometimes returns a Blob that looks intact but won't decode;
  the cloud original is fine. Now `decodeWithRepair` (`src/lib/decodeWithRepair.ts`) retries off a
  re-downloaded copy (which also heals the local cache), the error text names the underlying failure
  (e.g. `EncodingError: Unable to decode audio data (no cloud copy to repair from)`), and an
  unplayable item can be skipped (`skipReason: 'undecodable'`) instead of stranding the session.
  `RangePlayer` also shares one `AudioContext` for the page instead of making one per item (iOS
  allows only a handful of live contexts and closes them asynchronously). Not confirmed which of the two
  causes hit the reporter (no device details) — the new message will say if it recurs. Tests:
  `decodeWithRepair` (5) and two page tests (repair-and-carry-on; failure message + skip).

- **2026-09-20 — Word-boundary labelling screen built (`/label-word-audio`).** The ground-truth tool
  from the ROADMAP: shows one target word's automatic span; drag/nudge the two edges onto where the word
  really starts/ends, or accept it in one tap. Settings → "Label word audio".
  *Screen:* `LabelWordAudioPage` — setup (Random sample = unbiased, book-stratified round-robin;
  Needs review = biggest token-vs-mora disagreements / short mora cuts), 25-item sessions, "why this
  item" chip, collapsible rules ("How to place the edges"; open until first dismissed), Undo last,
  session summary with a live scoreboard of the estimators against your random-sample labels.
  Per item: two `BoundaryEdgeEditor`s (±400 ms of waveform around each edge — 10 ms ≈ 7 px vs ~1 px in
  the whole-sentence Adjust editor; drag, ±1/±10 ms buttons, arrow keys ±1 / Shift ±10), audition buttons
  per edge ("Hear before/after" — for a start edge the audio before should contain none of the word and
  after should begin with it; reversed for the end edge), a single Play/Stop toggle for the word span
  (optional 0.5 s context, half speed — lower pitch), Skip reasons (word isn't in the clip / audio ≠
  text / overlapping speech / noisy / can't tell). Playback is Web Audio from the decoded buffer
  (`src/lib/rangePlayer.ts`, sample-accurate; the `<audio>` loop players' ~4 Hz `timeupdate` is far too
  coarse for a 300 ms slice). Geometry is pure and tested (`src/lib/boundaryEditor.ts`).
  *Design decisions:* (1) the handles start at the **mora cut** (else token) — the best guess at the word
  itself; that anchoring is a known bias, so `shown` is stored with every label. (2) Labels are the
  **strict word** and are **not** written to `SentenceVocabulary.audioStartMs/EndMs` — those are a pitch
  card's whole loop range including the ending/particle, so writing a strict label there would strip
  the cue (this corrects the ROADMAP's earlier "every label also fixes the card"). (3) **Device-local,
  no cloud sync** (user's call): labels live in a Dexie table (`wordBoundaryLabels`, v20) and leave the
  device through a **"Save labels" button** — one JSON file (`src/lib/wordBoundaryLabelExport.ts`),
  handed to the OS share sheet where the browser can share files (iOS/Android → Files/AirDrop), else a
  normal download; the page shows how many labels are newer than the last saved file. No Supabase table,
  no migration to run. (An earlier version of this entry described a best-effort upload to a
  `word_boundary_labels` table; it was replaced the same day.)
  *Analysis:* `npm run analyze:word-boundary-labels -- <labels.json> [more.json…] [--all]` reads the saved
  file(s) (several — phone and laptop — are merged, newest copy of a label wins) and prints each
  estimator's signed error / typical miss / within-25/50 ms per edge, mora vs token split by mora-cut
  length (<250 ms), per-book bias (speaker proxy), and a pad calibration (p75/p90 of the misses vs the
  30/60 ms ceilings). Every label stores the estimates that were shown plus `spanVersion`
  (`WORD_SPAN_VERSION`, bump when `isolatedWordRange` output changes); estimators can also be
  recomputed later from the stored audio/alignment, so only the gold `label` is irreplaceable — keep the
  saved files.
  Tests: `wordBoundaryLabels` (estimators, queue selection, error stats), `boundaryEditor`,
  `wordBoundaryLabelExport` (file format, merge, share/download/cancel) and `labelWordAudioPage`
  (accept / nudge-and-correct / skip / undo / empty / save button, with audio decoding mocked). Not built: spectrogram strip, mora-boundary labels, "due soon" queue ordering.

- **2026-09-20 — CTC kana judge tried; mora cut gets a 200 ms floor.** Replacing Whisper as the
  clip judge (it hallucinates stock phrases on sub-second audio): installed
  `sakasegawa/japanese-wav2vec2-large-hiragana-ctc` (Apache-2.0; code
  github.com/nyosegawa/hiragana-asr) on the box under `~/tools/hiragana-asr` in its own venv
  (torch 2.14 CPU + transformers; NOT the `mfa` env; checkpoint loads `weights_only=True`).
  `scripts/ctc-transcribe-clips.py` transcribes a manifest's clips to hiragana; score with
  `score-pad-variants.py <dir> --texts <file>`; summarize with `summarize-clip-judge.py`.
  Cost: 631 MB checkpoint, **2.8 GB peak RSS** (fp32; the card's 630 MB is fp16), RTF 0.3–0.6
  on this CPU (200 clips ≈ 1.5–4 min, vs ~20 min for Whisper large-v3-turbo), ~9 s load.
  **Bare sub-second clips mostly transcribe to nothing** (76% of mora clips, 36% of token clips
  empty) — it was trained on whole utterances; **surrounding each clip with 800 ms of digital
  silence fixes that** (empty 10/0 of 100; 1500 ms no better; 300 ms not enough). Padded, it
  hears sensible kana with no stock-phrase hallucinations (食べ: token "たべました" vs mora
  "たべ"). On the same 100 mora-vs-token clip pairs: overall mora better 52 / worse 34; by mora-
  clip length **≥400 ms 21/6, 250–400 ms 21/12, <250 ms 10/16** — the latter is new information
  (Whisper couldn't judge those) and leans against the mora cut. Agreement with Whisper's
  verdict on its 68 non-hallucinated pairs only 38/68, so neither judge is ground truth.
  Consequence at the time: a 200 ms floor on mora cuts — **later removed** (see the 52-label
  entry above: the hand labels showed it hurt).

- **2026-09-20 — Sync queue ordering flake (CI red on the word-audio push).**
  `pushBatching.test.ts` failed in CI (`k_a,k_c,k_b,k_d` vs queued order): `enqueueMutation`
  stamped rows with `new Date().toISOString()` (ms resolution) and `listPendingMutations`
  orders by that stamp, so rows queued in the same millisecond tied and came back in random
  queue-id order — "keeps queued order within one entity" only held when the clock ticked
  between enqueues. Pre-existing (from the 2026-09-20 push-batching work), not caused by the
  word-audio changes. Fix: `nextLocalTimestamp()` in `src/sync/queue.ts` is strictly
  increasing within a session (costs a few ms of drift during a burst); regression test pins
  the clock and asserts order + unique stamps (fails on the old code).

- **2026-09-20 — Word-audio precision pass: pad experiment #2, sub-token mora cut, research.**
  *Pad:* re-ran the round-trip ASR comparison (120 words, 4 variants). Mean similarity:
  current 60/120 ms ceilings + 30 ms slack 0.647; 30/60 + slack 30 0.666; **30/60 + slack 0
  0.675**; no pad 0.667. 30/60/0 beat current 27–12 (sign test p≈0.02; 30/60/30 only 12–9);
  many extreme cases were Whisper hallucinations, so treat as directional. Adopted
  `DEFAULT_PAD = { onsetMs: 30, tailMs: 60, slackMs: 0 }` (`isolatedWordRange.ts`); adjacent
  tokens now get no pad, a pause gets up to 30/60 ms. Revert = three constants. Tests
  re-derived by hand from the rule. `nativeClipPitchAudit.measureNativeWord` no longer strips a
  hard-coded pad (it was already wrong once the pad became gap-aware): it takes the raw span
  (`isolatedWordMatchRange`). Experiment: `scripts/experiment-pad-comparison.ts`.
  *Mora cut:* 19% of links have an aligner token longer than the target (生まれ in 生まれた).
  New `src/lib/moraTiming.ts`: `phonesToMoraIntervals` derives mora boundaries from a token's
  MFA phones (vowel = 1 mora, `Vː` = 2, geminate `Cː` = っ + onset, ɴ/ɰ̃ = ん, dropped devoiced
  vowels between/after voiceless consonants recovered, final `ʔ` = っ; any unparseable pattern →
  null); `buildMoraMap`/`resolveMoraRange` give each raw character its mora range from the
  ruby `inlineReading` and refuse targets that cut through a reading unit.
  `isolatedWordRange`/`Spans(..., { inlineReading })` cut at the target's last mora when the
  phones and the reading agree on the token's mora count, else keep the token edge; a cut inside
  a token disables particle folding and treats the remainder as a butted neighbour for padding.
  Coverage on prod: 136 of 153 token-longer-than-target links refined (89%); fallbacks are
  reading≠pronunciation (日本 = にっぽん vs にほん) and geminates the aligner leaves unlabelled
  (言って = `i t(340) e`). **ASR check (100 links, large-v3-turbo):** overall mora 0.516 vs
  token 0.577 — but 30 mora clips vs 4 token clips were Whisper hallucinations on very short
  audio; excluding hallucinated pairs (n=69) mora **0.709 vs 0.639, better 40 / worse 15**;
  by mora-clip length ≥400 ms 17 better / 5 worse, <250 ms 10 / 19 (the judge is unreliable
  there, which is what the planned CTC judge is for). **Wiring decision:** pitch-accent
  consumers deliberately keep whole-token spans (a verb/adjective ending shows whether the
  pitch stays high or falls — the same role a particle plays for a noun); non-pitch loops
  (`SegmentLoopPlayer` in the Analyze page's word audio and the ReviewPage word-only cloze) pass
  `inlineReading`. Experiment: `scripts/experiment-mora-cut.ts`.
  *Research (subagent, 2026-09-20):* MFA `japanese_mfa` is the right aligner (CSJ mean phone
  boundary error 10.8 ms vs MAUS 13.5, SPPAS 17.8, Julius 19.3 — arXiv 2606.18466; WhisperX/MMS
  worse than MFA on English word boundaries — arXiv 2406.19363; both citations spot-checked);
  our remaining errors are mapping errors, not boundary error. MFA's tokenizer joins a literal
  space into `_`; the supported bypass is `align_utterance_online(..., tokenizer=None)` with
  pre-split text/custom lexicon entries (ran it; forced splits inside a merged vowel give
  degenerate durations, so cross-check use only). kalpy `fine_tune_alignments` refines
  boundaries to 1 ms (benefit unbenchmarked). Suggested judge: a CTC kana recogniser
  (`sakasegawa/japanese-wav2vec2-large-hiragana-ctc`, no hallucination); suggested ground
  truth: ~40 hand-labelled edges. Poor fits: TTS/Forvo isolated audio. Not done:
  `kanaTimeline.ts` still maps morae to tokens by character proportion (same drift class
  as the old `matchWord`).

- **2026-09-20 — Pad comparison by round-trip ASR (the check the computed-pad entry left
  open).** `scripts/experiment-pad-comparison.ts` (+ `score-pad-variants.py`, reuses the
  backfill scorer's similarity; read-only, seeded sample) cuts the same word-only match
  three ways — old fixed −60/+120, the shipped computed pad, no pad — and transcribes each
  with `large-v3-turbo`. 120 random occurrences, 102 where computed ≠ fixed. Mean
  similarity: fixed 0.703, computed 0.721, none 0.728 (on the differing 102). Head-to-head
  (>0.05 apart): **computed beat fixed 41–19** (sign test p≈0.006, so the pad change is a
  real improvement — e.g. 時間 "時間です" → "時間", セット "おせっとに" → "セット", お勤め
  "お勤めになって" → "お勤めの"), but **no pad beat computed 24–14** and beat fixed 49–20.
  So by this judge, *any* padding is roughly neutral-to-harmful and the old fixed pad was
  the worst. Caveats: the judge is noisy on very short clips (the "worse" list has
  Whisper hallucinations — する → "次の動画でお会いしましょう", 宮本 → "Miyamoto" scores 0
  for being romaji — and 30 ms flips like たくさん 1.00 → 0.50), and ASR rewards a
  clean cut while a human listener may want a little lead-in/decay, so the data
  doesn't say to remove the pad — only that the ceilings (60/120) and slack (30) are
  probably generous. Cheap next experiment if wanted: computed pad with smaller
  ceilings (e.g. 30/60) and slack 0 vs the current one. Aligner restarted first to
  free its leaked memory (5.0 GB → 1.5 GB used).

- **2026-09-20 — Aligner numeral expansion ported to TypeScript (closes the ROADMAP item);
  Odd Ear Out no longer skips dated sentences.** `src/lib/alignerText.ts` holds the
  43-entry day/month table (generated from `shadowing-analysis-api`'s `app/numerals.py`,
  not retyped) and `alignerView(japanese)`: the characters the aligner actually kept —
  dates expanded to hiragana, punctuation dropped — each remembering its raw source range
  (an expanded date's characters all map to the whole `16日`). `matchWord`,
  `alignerCharCount`, `alignerRangeToRawIndices` and the karaoke highlight all work in that
  view, so tokens spell the sentence and the exact-offset mapping applies to dated
  sentences too. Against real data: 53 links sit in dated sentences and **43 change**
  (e.g. 地方 in 11日は、関東地方… [3060,4410] → [4350,4830]); 0 links in undated sentences
  changed. `hasAlignerNumeralExpansion` and both skips (Odd Ear Out,
  `audit-pitch-accent-clips.ts`) are gone. **Drift guard:** `tests/alignerText.test.ts`
  parses the sibling repo's `numerals.py` and asserts the tables are identical
  (skipped when the repo isn't checked out at `~/projects/shadowing-analysis-api`) — if
  the aligner's table changes, update `alignerText.ts` and bump `ALIGNMENT_VERSION`.
  Still uncovered on the aligner side: 番/年 counters and day 3 (みっか) → `<unk>`, which
  the existing `<unk>` guard turns into a whole-sentence fallback. Audit script re-run:
  0 stale overrides.

- **2026-09-20 — Word span landed on the *previous* word when the sentence had `<unk>`
  tokens later on (study item for 自分 in 無心とは、怒りや恐れ、そして自分が…: loop played そして).**
  Third `matchWord` cause. It located the word by *fraction* of the token total, and
  `<unk>` tokens are excluded from that total — so two `<unk>` blobs *after* the target
  shrank the denominator and stretched every position earlier (the existing `<unk>`
  guard only covered tokens before the match). Now, whenever the leading tokens
  verifiably spell the sentence (`verifiedPrefixTokenCount`, punctuation aside), the
  match uses exact character offsets; the proportional mapping stays only as the
  fallback for unverifiable prefixes (numeral expansion, normalized spellings). Against
  870 real links the exact mapping changes 34 (4%), all spot-checked ones onto the
  correct word (e.g. 恐れ [2650,5060] → [4090,5060]). `SyncedShadowText`'s karaoke
  highlight had the same stretch and uses the same `verifiedTokenCharRange` helper.
  Audit re-run cleared 2 more stale backfilled overrides (たくさん [1590,4060] →
  [3220,4060]); 0 stale left. 3 new tests.

- **2026-09-20 — Word-clip pad is computed from the gap to neighbouring tokens; degenerate
  matches fall back.** Follow-up to the particle-fold fix (both left open there).
  *Pad:* the fixed −60/+120 ms became ceilings (`ONSET_PAD_MS`/`TAIL_PAD_MS` in
  `isolatedWordRange.ts`): each side gets `min(ceiling, silence to the nearest real token
  + 30 ms boundary slack)`, so a word next to a pause keeps the full pad and one butted
  against another gets ~30 ms — no more "chiisai-ba" from a tail reaching into the next
  word's onset. `<eps>` is treated as silence; `<unk>` as a neighbour. **Not validated
  by the round-trip ASR scorer** — the earlier "default pad wins 57%" numbers were
  measured on the pre-fix (drifting) spans; re-run `backfill:word-audio-range` /
  the experiment script if pad quality needs numbers. *Guard:* a matched span under 60 ms
  (`MIN_MATCH_MS`) returns null → whole-sentence fallback. Picked from the corpus: of
  815 links only 何 (30 ms) is below 60 ms; the next shortest are 60–90 ms real words.
  Existing tests' expected pads updated (each value derived from the rule, not copied)
  + 2 new tests.

- **2026-09-20 — Word clip folded in the next *noun*, not just particles (user
  report on sent_17d1bdde: 生まれ → "umareta toki kara", 小さい → "chiisai basho",
  場所 looping into 山の中).** Second cause behind the same "word audio is too
  long" complaint. The aligner's timings were right (生まれた 0.98–1.59 s, 場所
  3.46–4.00 s); `isolatedWordRange` folded in *any* following token of ≤2 chars,
  meant to catch case particles, so it also swallowed 時, 場所 and 山 — the last
  across a 0.47 s pause. Now only tokens in `FOLDABLE_PARTICLES` (は が を に へ と で
  の も や か ね よ から まで より) fold in, and only when the gap to the word is
  ≤150 ms (`MAX_PARTICLE_GAP_MS`); otherwise `withParticle` is null and the range is
  the word alone. 3 tests using that sentence's real alignment. The audit script
  re-run after the fix found 14 more backfilled overrides that had folded a noun
  (e.g. 店長 [410,1760] → [410,790]); `--apply` cleared them (0 stale left, 44
  still-correct, 21 manual untouched). **Known, not fixed:** the +120 ms tail pad can
  still overlap the next word's first mora when two words are adjacent (小さい end
  3.46 s + pad reaches into 場所's onset); and a degenerate aligner match (何 =
  30 ms in "え、何あやまってるの？") yields a near-empty clip.

- **2026-09-20 — Word-audio spans landed on the wrong token: `matchWord` counted
  punctuation the aligner drops.** User: word-level audio extraction quality "isn't
  very good". Probed the cached alignments: the aligner's token texts concatenate to
  the sentence *without* 、。「」 (847 of 986 match once stripped, 0 with punctuation;
  129 have `<unk>`; 10 are numeral expansions), but `matchWord`
  (`src/lib/isolatedWordRange.ts`) measured position/length against the raw
  `japanese`, so every word after a comma drifted earlier by ~1 char per mark. On 700
  real links **72% picked a different span than the exact mapping (median 380 ms,
  p90 ~1 s)**, typically starting on the *previous* token (ござい in ありがとうござい
  ます picking up と). The earlier pad/round-trip-ASR/backfill work tuned boundaries
  around that span, which is why no fixed pad won. Fix: positions and lengths now
  count only the characters the aligner keeps (`ALIGNER_DROPPED`, `\p{P}\p{S}\p{Z}`);
  no clipping change — nothing is cut, the client loops a range of the whole-sentence
  audio. 2 regression tests (comma-heavy sentence, quoted word) fail on the old code;
  `tests/gameRepository.test.ts`'s fixture had `です。` as one aligner token (never
  real) — corrected. `scripts/audit-backfilled-word-ranges.ts` classes stored
  overrides by whether they equal the legacy matcher's output: **70 stale backfill,
  58 still correct, 21 manual/other (never touched), 9 without alignment**; ran
  `--apply` the same day, **clearing the 70** (re-audit: 0 stale) so the corrected
  runtime default applies; devices pick the change up via the normal sync trigger.
  `backfill:word-audio-range` can now be re-run to re-tighten on correct spans.
  Same follow-up: `SyncedShadowText`'s karaoke highlight had the same drift
  (token fraction × raw `japanese.length`) and now converts the fraction back
  through `alignerRangeToRawIndices` (`isolatedWordRange.ts`, 3 tests); the mora
  row was unaffected (mora units already skip punctuation).

- **2026-09-20 — Deterministic ids for get-or-create sync rows; real-Postgres push tests.**
  Follow-up to the sync reliability pass below (the two items it left on the ROADMAP).
  *Ids:* `kanji`, `vocabulary_items`, `grammar_patterns`, `sentence_grammar`,
  `grammar_relationships` and `vocabulary_kanji` now get ids derived from the signed-in
  owner + natural key (`deterministicId` in `lib/ids.ts`, `mintGetOrCreateId` in
  `repository.ts`) instead of `randomUUID`, so two devices minting the same word produce
  the same row. Owner is part of the key because ids are global primary keys server-side;
  signed out there is no owner, so ids stay random and duplicates are still adopted at
  push time (`adoptRemoteDuplicate`, unchanged, also covers rows minted before this).
  Push side (`engine.ts` `pushOne`): a first push (`expectedVersion == null`) that finds a
  *live* remote row with the same id adopts the server's copy (`adoptSameIdRemote`)
  instead of overwriting it with the initial payload; a soft-deleted remote row is a
  tombstone for a re-created word and is resurrected by the normal update. *Tests:*
  `npm run test:pg` (`scripts/pg-test.sh`, `tests/pgIntegration/`) starts
  `supabase/postgres` + PostgREST in Docker, applies the real migrations, and runs
  `pushMutations` with a real supabase-js client and JWTs (skipped unless
  `SYNC_PG_TEST`; own non-gating workflow `sync-pg-tests.yml`). It immediately found a
  real flaw in the batching from earlier today: sorting by tier alone left entities
  interleaved in queue order, so almost nothing batched (230 requests for 60 words) —
  `sortForPush` now also groups by entity (14 requests). Unit tests:
  `tests/deterministicIds.test.ts`.

- **2026-09-20 — Sync reliability pass (a day of `Report sync issue` triage).** Reports
  on 2026-09-19/20 turned up a run of separate bugs, all fixed:
  hung Supabase requests (no timeout anywhere → status stuck on "syncing", reports never
  uploaded; `fetchWithTimeout` 30s REST / 120s storage in `supabaseClient.ts`, stage
  tracking + a log-only `SYNC_STALL` watchdog in `runSyncCycle`); reference-audio
  hydration running *inside* the cycle (now detached, single-flight, 4-way parallel,
  per-download timeout, progress logs); the report forms + Copy diagnostics awaiting
  `navigator.clipboard.writeText` after the click gesture (Safari left it pending —
  `buildDiagnostics` vs `copyDiagnostics`, the latter now a synchronous `ClipboardItem`
  promise write with an honest result); Keep local/remote buttons disabled for a whole
  sync cycle; "Loading sentence…" shown forever for a deleted sentence
  (VocabularyReviewPage/AnalyzePage now say it's missing). Push path rewritten
  (`engine.ts`): rows are pushed parents-first (`PUSH_TIER`/`sortForPush` — link-table
  RLS needs the referenced rows to exist), same-entity upserts go out as one
  existence-check + one bulk insert (`pushUpsertBatch`/`insertBisecting`; a rejected
  bulk insert is bisected to the bad row, which falls back to the unchanged
  `pushSingle` conflict/dedupe/RLS-heal path; transport errors abort the pass instead of
  timing out per batch), and save-triggered cycles skip the pull if one ran <20s ago.
  Tests: `src/sync/pushBatching.test.ts`; `tests/syncPushIncident.test.ts`'s fake server
  now models atomic bulk inserts and `.in()`. Not done (ROADMAP): deterministic ids for
  get-or-create entities, a real-Postgres RLS test.

- **2026-09-19 — Delete ads/junk sentences from the book list and Shadow page.**
  User request (recordings contain advertisements). `deleteSentenceCascade` already
  existed (AnalyzePage "Danger zone"); added batch `deleteSentencesCascade` (one
  transaction, one sync notify) and two-step-confirm delete buttons: "Delete selected
  (ads, junk)" in `BookDetailPage`'s selection bar (distinct from "Remove selected from
  book", which only detaches membership) and "Delete (ad / junk)" on `ShadowPage`.
  Inline confirm, no `window.confirm` (PWA). No undo — soft-deleted remotely.
  Follow-up same day: deleting sentences (`deleteSentencesCascade`, and orphans in
  `deleteBookCascade`) also drops their still-pending/active steps from in-progress
  planner sessions (`dropSentencesFromOpenSessionsLocal`); batched `sentenceIds` steps
  lose only the deleted ids. Settled steps stay (history/analytics); a session left with
  nothing unsettled is marked completed. The batched step's label count isn't rewritten.

- **2026-09-19 — Daily practice panel (non-SRS practice targets beside the session)**.
  User request: a small set of "do 5 pitch drills"-style daily recommendations in the
  session, not SRS related. New `DailyPracticePanel` (Home, right under "Today", and at
  the top of `SessionRunnerPage`) driven by the pure `src/lib/dailyPractice.ts`
  (`buildDailyPractice`, `rotatingGameOrder`): (1) **Pitch drill — say 5 words**
  (deep-links `/pitch-accent?mode=word`; detail line points at words missed in review
  when the focus queue is non-empty; left out in quiet mode since it records), (2)
  **Odd Ear Out — one round**, (3) **one rotating game** (a stable-per-day rotation over
  the other games, first one that can fill a round). **Deliberately not session steps:**
  steps settle only by an explicit Mark complete (2026-08-27 decision) and would need a
  new step kind rippling through recap/skip analytics/sync, whereas these are counters —
  progress is read live from logs the activities already write (`pitchDrillAttempts`,
  `gameRounds` via `getDailyPracticeCounts`), so nothing to tick by hand and nothing
  touches FSRS or the planner's bucket minutes. `gameRounds` is local-only, so game
  progress is per-device; drill takes sync. Game eligibility is checked once on mount via
  each game's `loadPools` (same check as the /play hub); an unplayable game is left out.
  Targets are constants in `dailyPractice.ts` (`DAILY_PITCH_DRILL_TARGET` = 5,
  `DAILY_GAME_ROUND_TARGET` = 1); no settings UI yet.
- **2026-09-19 — Pitch-accent analysis tools (native-clip audit, cue-strength
  join, d′)**. Follow-up to the card reveal work below. New pure module
  `src/lib/nativeClipPitchAudit.ts` (`measureNativeWord`, `accuracyBySeparation`,
  `signalDetection`) + `scripts/audit-pitch-accent-clips.ts` (read-only; downloads
  reference audio from Supabase storage, decodes with ffmpeg **from a temp file** —
  the m4a recordings can't be demuxed from a pipe, which silently produced empty
  tracks at first — caches pitch tracks in `/tmp/pitch-audit-cache`).
  `classifyLearnerMorae` (`pitchAccentObservations.ts`) is now exported and returns
  its `bucketMeans`/`overallMean` so the audit measures native clips with the exact
  rule that scores the learner. `report-pitch-drill-effectiveness.ts` gained d′ /
  criterion for 2-mora `hl` vs `lh`. Pitch reviews now also store
  `contextSentenceId` (the clip played) for exact joins going forward.
  **Findings (first run):** d′ = 0.19 on fall-vs-rise; native clips agree with the
  dictionary shape only 37% under the drill's scorer (4-mora heiban 3%), accuracy
  does not rise with cue strength, voiceless-consonant hypothesis not supported —
  i.e. the weak-clip explanation is out, and the drill scorer's validity on native
  speech is the new open question (ROADMAP "Pitch-accent: analysis tools").
  **Correction to the earlier note:** the card is ~50% exact-match vs ~27–31%
  chance overall (above chance); only the 2-mora fall-vs-rise contrast is at chance.
- **2026-09-19 — `pitch_accent` card: measured native contour + "what your pick
  sounds like" on a miss, with usage tracking**. Prompted by the user still
  struggling with the pitch card/drill despite doing well on the standalone ear
  trainers. Prod data (`report-pitch-drill-effectiveness.ts`, 110 shape-tagged
  reviews) showed the card near chance on the simplest contrast: 2-mora `hl`
  (atamadaka) answered `lh` 19× vs correct 18×, `lh` 59% — spread across 8 words,
  not one bad clip; a voiceless-first-mora hypothesis did *not* hold (きょう/さき
  5/5), misses cluster on all-sonorant words (山, いえ, はい, なか). Two additions on
  the reveal, both audio→picture bridges, neither touching FSRS grading:
  1. **Measured contour of the native word** (`WordPitchContour`, shared with Odd
     Ear Out) beside the dictionary diagram, cropped to the same span the loop
     plays (`SegmentLoopPlayer` gained `onRangeChange`/`onLoopStart`).
  2. **Miss contrast** (`PitchContrastExample`, `pickContrastClip` in
     `src/lib/pitchContrastClip.ts`): after a wrong pick, a real same-mora-count word
     with the *picked* in-word shape (Odd Ear Out's word-only clips, same book as the
     card's clip preferred as a same-speaker proxy) with its own measured contour and
     a play button. Skipped for heiban↔odaka (identical word-only shape) or when no
     clip fits.
  **Tracking, no migration:** reviews' existing synced `assistance` jsonb gained
  `pitch_native_looped` / `pitch_contrast_shown` / `pitch_contrast_played` (a new
  `reviews` column would have risked the migration-apply gap failing every review
  push). `report-pitch-drill-effectiveness.ts` now prints accuracy by expected shape,
  pass-rate looped vs not, and next-review pass-rate after a miss by contrast
  played / offered / not offered (empty until reviews accrue from 2026-09-19).
  Considered next, not built (see chat 2026-09-19): binary fall/rise high-volume
  drill on 2-mora native clips, "hear native first" in Single-words mode,
  resynthesized contour-flip stimuli.
- **2026-09-19 — Sync: the stuck grammar links diagnosed (duplicate queue rows +
  orphaned links) and fixed**. The diagnostics added earlier did their job. The
  third report showed the queue: **4 rows, only 2 distinct records — each
  `sentence_grammar` link queued twice — retried 70 times**, all failing the insert
  RLS policy, referencing patterns `0d35bccc…`/`b503f7b5…` that exist **neither on
  the server nor (any longer) in the laptop's Dexie**. On the server the same
  sentence (それで、九州で地震がありましたね。) already has links to `それで` and
  `～ましたね` (created 09-17) — the laptop's own copies of the same two patterns.
  Three defects, all fixed:
  1. **Duplicate queue rows.** `enqueueMutation`'s coalescing (read existing → put)
     wasn't atomic, so two overlapping calls for one record (a create and an
     immediate un-awaited edit) each saw "nothing queued" and each inserted. Now one
     `rw` transaction. `dedupeQueueRows()` (newest payload, oldest id/lock base,
     highest retry count) runs at the start of every push to heal queues that already
     hold twins.
  2. **Remaps only repointed the first queue row.** `remapLinkReferences` and the
     relationship/study-item remaps used `.first()`, so a twin kept the abandoned
     pattern id. All three now go through `repointQueuedPayloads` (every row).
  3. **Orphaned links retried forever.** A `sentence_grammar`/`grammar_relationships`
     row whose pattern no longer exists *locally* can never pass the policy (the pattern
     has no row to push). On an RLS failure (42501) `pruneOrphanedGrammarLink` now drops
     the local row, its meta and every queue row for it (`ORPHAN_PRUNED`) — safe without
     a tombstone because the insert failing means the record never reached the server,
     and only fires when the pattern is *absent* locally. If the pattern *is* local but
     missing remotely and has no queue row of its own, `requeueMissingPattern`
     re-queues it (`PATTERN_REQUEUED`) so its insert either lands or is adopted.
  Reproduced in `tests/syncPushIncident.test.ts` (fake server enforcing the RLS rule
  and the unique indexes; mutation-checked — with pruning disabled the laptop's
  scenario fails exactly as in production). **Not determined:** how the laptop's local
  patterns/links got into that state (adoption ran for those patterns but their links
  weren't repointed — most likely the twin-row case above). Left as-is: the 3
  leftover conflicts (2 `analyses`, 1 `books`) look like real divergence for the
  learner to resolve, and 2 `book_sentences` v2/v3 conflicts remain, worth a look if
  they persist.

- **2026-09-19 — Sync follow-up: laptop went 63 → 5 conflicts, 10 → 4 pending;
  remaining `sentence_grammar` RLS failure not yet diagnosed → diagnostics gap
  closed**. The second report from the laptop (after loading the fix) shows the
  two fixes above worked: open conflicts **63 → 5** (2 `book_sentences`, 1 `books`,
  2 `analyses`) and pending **10 → 4**, with the `grammar_patterns` duplicate error
  gone. What's left is `sentence_grammar: new row violates row-level security policy
  (+3 more)` on 4 pending pushes. That policy requires the sentence to be editable
  and `owns_grammar_pattern(grammar_pattern_id)` — a live pattern owned by the user —
  so those links still reference a pattern id the server doesn't have. Checked and
  ruled out on the server side: no soft-deleted patterns, no orphaned live links, no
  near-duplicate patterns; the two adopted patterns and the other device's 4 links
  are all live. A push-cycle reproduction (`tests/syncPushIncident.test.ts`, a fake
  server enforcing the same unique indexes and the RLS rule; patterns-first /
  links-first orders) drains the queue in a few cycles, so the adoption flow itself
  works — the laptop's real state differs from what's modelled and can't be
  determined from the snapshot. **Root cause of the blind spot:** the diagnostics
  snapshot listed only counts and log *messages*; `recentLogs` dropped each
  PUSH_FAIL's `details` (the failing entity/recordId/server message) and nothing
  described the queue. It now includes `pendingQueue` (entity, recordId, operation,
  retryCount, lastError, and referenced ids such as `sentenceId`/`grammarPatternId`/
  `subjectId` — ids only, never text; `summarizePendingItem`) and `details` on the
  last 30 log events (still token-redacted). The next "Report sync issue" from the
  laptop will show exactly which records are stuck and which ids they point at.
  `pushMutations` is exported for tests.

- **2026-09-19 — Sync: stuck grammar-pattern push + 58 phantom "createdAt"
  conflicts (Report sync issue from the Mac laptop)**. One report: status
  "conflict", 10 pending, `grammar_patterns: duplicate key … (+9 more)`, 63 open
  conflicts (58 `book_sentences` local v3/remote v4, 2 `book_sentences` v2/v3, 1
  `books`, 2 `analyses`), "a large number of createdAt conflicts … can't see anything
  else that conflicts". Two independent causes, both fixed:
  1. **Phantom `createdAt` conflicts.** `BookSentence` has `addedAt`, not
     `createdAt`; `bookSentenceToRemote` copies `addedAt` into the remote
     `created_at`, so every `book_sentences` conflict diff showed a remote-only
     `createdAt` and `conflictContentsMatch` could never say "identical" — harmless
     CAS races (remote rows were bumped by scripts: `client_id` null, chapter/position
     assignments on 09-18) surfaced as manual conflicts. Same bug class as the
     `reviews` fix of 2026-09-14. `ENTITY_EXTRA_KEYS` (conflictDiff.ts) now strips
     `createdAt` for every entity whose mapper fills `created_at` from a
     differently-named local field: `book_sentences`, `import_batches`, `inbox`,
     `reference_audio`, `pitch_drill_attempts` (+ `reviews`). The existing
     `sweepNoopConflicts` re-checks open conflicts each sync cycle, so the 58 stuck
     ones clear on the next sync after the laptop loads the new build; a real
     difference (e.g. differing `status`) stays open (tested).
  2. **`grammar_patterns` duplicate insert blocked the queue.** Another device
     created `～ています（現在進行）` and `今、～` at 2026-09-18 20:42 UTC — after the
     laptop's last sync (14:30 UTC) — while the laptop created the same patterns
     locally with different ids; every push hit the natural-key unique index (23505)
     and failed forever. `adoptRemoteDuplicate` (engine.ts), which already handled
     `kanji`/`vocabulary_items`, now also covers `grammar_patterns` (by
     `normalized_key`) and the link tables `sentence_grammar` (sentence+pattern) and
     `grammar_relationships` (pair+type). Adopting a pattern repoints, locally and in
     their queued pushes, its `sentence_grammar` links, its `grammar_relationships`
     (re-canonicalizing the a<b order), and its grammar `study_items`; a study item
     that already exists for the adopted pattern is left unmerged and logged
     (`DEDUP_STUDY_ITEM_CLASH` — can't arise in the stale-cache case, since the item
     would have been pulled with the pattern). The adopted **remote** wording wins for
     the pattern itself; the laptop's local wording for those two patterns is dropped.
  Tests: `tests/syncAdoptDuplicate.test.ts` (13, incl. a faked Supabase client that
  pins the lookup columns per entity), `conflictDiff.test.ts`, `queue.test.ts`.
  **To take effect:** the laptop must load the new build (deploy runs on push to
  `main`, ~2.5 min; PWA update banner / reload), then one or two sync cycles.
  Left for the learner: the 2 `analyses` and 1 `books` conflicts, which look like real
  divergence (analyses remote v8→10 from backfill scripts) — resolve in the app.
  Not fixed / worth knowing: adoption only fires on the *insert* path; a queued
  *update* to a record whose remote counterpart was replaced would still surface as a
  normal version conflict.

- **2026-09-19 — Verb Lego: plain-English help for the grammar terms** (user:
  both new games work great, but they don't always know forms like causative).
  The prompt now annotates each function ("causative (make/let someone) → passive
  (be done to) → past (did)"); a **"What do these mean?"** expander (native
  `<details>`, iOS-safe) explains each function in plain English *during* play;
  once a form is finished a fixed block adds **this verb** in each function
  (聞かせる / 聞かれる / 聞いた) generated from its own conjugation, plus a
  whole-form gloss for built forms ("wasn't made to X"). Examples are withheld
  until the form is done because "This verb: 食べられる" would give the answer
  away. Examples appear only when the verb's class is trusted — built chains
  carry their JMdict tag (`VerbChain.partOfSpeech`, also now used for decoy
  stems), real chains must have their own stem confirm the class — so a
  shape-misclassified godan like 切る shows the meaning but no (wrong) example
  (tested). Manual test: `/play` → Verb Lego → Start; note the hints in the
  "Build:" line, open "What do these mean?", play a form, and confirm the
  "This verb:" examples appear only after the last slot locks.

- **2026-09-19 — `reference_alignment` refreshed to v3 (full-corpus backfill);
  Odd Ear Out playable; backfill script pagination bug fixed**. Ran
  `backfill:reference-alignment --apply` on codex-dev after review by the
  alignment session (who OK'd it). A 20-recording pilot took 58 s (~2.9 s each,
  aligner RSS +3 MB), then the full run: **1054 stored, 1 failed** (a transient
  Storage "Gateway Timeout" on one download, recovered on retry) in ~48 min;
  aligner RSS went 3.05 → 3.68 GB peak (~0.65 MB/alignment, far under the feared
  leak rate), never near the watchdog limits (5.2 GB RSS / 700 MB free). Verified:
  **1075 recordings, 1075 already aligned (v3), 0 to do**. **Script bug found and
  fixed:** the "already aligned" read had no pagination, so PostgREST's 1000-row
  cap made every run think ~75 rows past the cap were missing and re-align them
  (harmless upserts — that was the "75 to do" that kept reappearing, not new
  recordings; the `audio_remine_*` rows are from 2026-08-30). Its query now pages.
  **Odd Ear Out after the refresh (word-only spans, overrides ignored, dated
  sentences and suspended-only books skipped):** ~34–43 distinct playable words
  (my two throwaway prod measurements differ slightly because of Supabase paging
  in the scripts) but only **4 contrasts** (2-mora hl/lh both ways; 3-mora
  lhl>hll, lhl>lhh) — one short of the 5 a round needed. Rounds now need only
  **3 trials** (`ODD_EAR_MIN_TRIALS`), may reuse a contrast with fresh words,
  never reuse a word within a round (`buildOddEarRound`), and the hub gates on the
  trials a round could actually be built with. On the prod pool 40/40 simulated
  rounds fill 5 trials, 189/200 with all four clips from one book. Manual test:
  `/play` → Odd Ear Out → Play a round; expect a 4–5 round game (a smaller pool
  gives a shorter one).

- **2026-09-19 — Odd Ear Out skips digit+日/月 sentences (from the alignment
  session's review of the proposed backfill)**. The session that owns the
  aligner reviewed the `backfill:reference-alignment` plan and flagged that
  `shadowing-analysis-api`'s `app/numerals.py` rewrites `(\d+)(日|月)` to hiragana
  readings *before* aligning, so the cached alignment's word texts are longer than
  the sentence `matchWord` measures against — every word's span in such a sentence
  is skewed, not just the date's. Odd Ear Out now skips any sentence matching
  `[0-9０-９]+[日月]` (`hasAlignerNumeralExpansion`; fullwidth included because
  Python's `\d` matches it). The proper, shared fix — porting the 43-entry
  day/month table to TypeScript so `matchWord` measures against the same expanded
  text the aligner saw — would help every word-audio consumer (pitch cards, karaoke
  text) but means maintaining the table in two languages; on ROADMAP as a
  possibility, not started. The same review OK'd running the backfill, pending
  the user's go-ahead: suggested first pass `--limit 20` while watching aligner RSS
  and timing, with the aligner's weekly restart (Sun 04:08 UTC) as a natural
  chunk boundary.

- **2026-09-19 — Odd Ear Out: no longer trusts manual/backfilled word ranges
  (conflict with the earlier word-boundary backfill)**. Cross-checking the games
  work against the earlier alignment/word-boundary sessions found a real clash:
  `backfill-word-audio-range.ts` writes `audio_start_ms/audio_end_ms` from
  `isolatedWordRangeUnpadded`, whose "tight" range **folds in the following short
  word/particle** — by design, for the pitch cards. Odd Ear Out had treated any
  override as a *word-only* clip, so a heiban and an odaka word would have sounded
  different inside a group the game calls "the same shape". Measured on prod
  against the (v1) alignments: of the 92 overrides with a following particle to
  compare, **71 end at word+particle, 10 at word-only, 11 other/hand-adjusted**.
  Fix: `getOddEarOutData` now uses only the strict `wordOnly` span from a
  **current-version** alignment and ignores overrides entirely; `MIN_CLIP_MS`
  raised 150→300 (the aligner pad alone is 180 ms, so the old floor could never
  fire). Consequence: the "23 playable words" figure in the entry below is now
  **0** until `reference_alignment` is refreshed at v3
  (`backfill:reference-alignment --apply`, still pending a go-ahead). No other
  overlap found: no commits from other sessions since 09-19 00:40, no
  uncommitted work in any local repo, nothing foreign in the games commits, no
  competing Dexie/sync schema changes (v19 `gameRounds` is the only one).

- **2026-09-19 — Short games: Verb Lego shipped (hybrid real + built chains)**.
  Fourth `/play` game (`src/lib/verbLego.ts`, `VerbLegoGame.tsx`): build stacked
  verb forms piece by piece; tap-to-stack chips (the only controls) fill the next
  slot and are judged at once (green/red, −1 point, live "Worth N now");
  6 forms/round. **Prod-data finding that shaped the design:** the corpus has
  905 verb+aux runs but only 287 stacked, and 98 of 115 chains in
  vocab-confirmed sentences are the same polite-past 〜ました (7 distinct
  patterns) — a real-only game would repeat itself. So the pool is *hybrid*:
  real chains (from UniDic tokens, whitelisted auxiliaries only, validated
  against the text span) **plus built chains** composed from the 97 confirmed
  godan/ichidan verbs JMdict tags (570 built chains, 10 recipes up to 食べさせ
  られなかった) → 26 patterns; the picker's unit is the *pattern*, so a round never
  repeats one. Correctness safeguards (a wrong built form would teach wrong
  Japanese): class comes from the JMdict tag not word shape — **a prod check
  caught 思い切る (godan) composing as 思い切させない** when shape was used — plus
  skips for statives/irregulars/honorifics/potential-of-another-verb/particle+verb
  phrases, transitive tag required for passives, and decoys that are certainly
  wrong only (never れ for られ, never the e-stem 聞け/食べれ, た/だ & て/で twins only
  when the preceding piece rules them out). Verified: 570 built chains
  structurally validated against prod verbs with zero wrong forms (only safe
  declines where the conjugator can't split a verb, e.g. 羽ばたく/近づく), plus a
  known-forms table in the tests; browser-checked with seeded data (0
  reviews/study items written). Kana-only verbs work via a `仮`+last-kana
  stand-in. Manual test: `/play` → Verb Lego → Play a round → Start; tap the
  piece for the next slot — right turns the slot green, wrong turns it red and
  drops "Worth N now"; on the last slot the form, and (for real chains) the
  sentence and translation, appear; results list each form with source ("from
  your sentence" / "built from your vocabulary") and the pieces you missed.
  Follow-ups on ROADMAP: 〜たくなかった / 〜でした pieces, a reverse "which piece is
  the passive?" mode.

- **2026-09-19 — Short games: Odd Ear Out shipped (pool limited by stale
  alignments)**. Third `/play` game (`src/lib/oddEarOut.ts`,
  `OddEarOutGame.tsx`): 5 rounds of four native word clips (same mora count,
  cut to the word alone), three sharing an in-word accent shape, one odd; tap ▶
  to loop, "This one" to pick; immediate green/red with a "Worth N now" countdown
  (3 points/round, −1 per wrong pick); reveal shows each word's shape plus its
  **measured** pitch contour cropped from the cached sentence track. Weakness is
  per shape pair from the round log; `weak`/`strong` only. New plumbing:
  `getOddEarOutData` + `loadAlignmentsBulk` (Dexie cache → bulk
  `fetchRemoteAlignments`, cached locally). Verified in a real browser with
  seeded tone audio (grid layout, red on wrong, contours drawn, per-pair misses
  logged, 0 reviews/study items written).
  **Prod finding:** all 782 rows in `reference_alignment` are version **1** while
  the client is at `ALIGNMENT_VERSION` 3 (two bumps for the numeral /
  supplementary-dictionary fixes) — `backfill:reference-alignment` dry run on
  codex-dev reports **0 of 1075 recordings current**. So today only clips with a
  hand-corrected `audioStartMs/EndMs` (156 links) are playable: **23 words, 2
  contrasts** (< the 5 a round needs), and the hub correctly says "not enough to
  play yet". Running `ANALYSIS_ALIGN_API_BASE=http://127.0.0.1:8002 npm run
  backfill:reference-alignment -- --apply` on codex-dev (aligner is up there)
  would refresh them — not run yet (1075 alignments on the shared 8 GB box; a
  decision for the user). The same staleness already degrades word-audio
  isolation off-tailnet for pitch/word-listening cards. Manual test (after the
  backfill): `/play` → Odd Ear Out → Play a round → Start; ▶ each clip, tap
  "This one" under the odd one; confirm red on wrong with the countdown
  dropping, then the reveal with shapes and contours; result lists each round's
  words; confirm review/study-item counts are unchanged.

- **2026-09-19 — Particle Puzzle: immediate green/red feedback + score countdown**
  (user request after playing it: liked Word Detective's "worth N now"
  countdown). Replaced the fill-everything-then-Check flow: each placement is
  judged as it's made — right locks the blank green (✓), wrong flashes it red
  (✗) until the next tap and returns the chip to the bank. A sentence is worth
  one point per blank and loses one per wrong placement (`puzzlePointsAvailable`,
  floor 0 — a heavily-missed sentence can finish at 0/N; easy to raise to 1 like
  Word Detective's solve floor if that feels harsh), shown live as "Worth N now".
  `gradePuzzle` → `scorePuzzle` (per-blank `wrongTries`); the round log's
  per-blank `parts` still records first-try hit/miss (`note` = first wrong pick),
  so the weak-spot history is unchanged. Trade-off accepted: with per-pick
  feedback the shared bank no longer forces a consistent parse — the point cost
  is what discourages guessing now. Verified in a real browser (wrong pick →
  red + "Worth 1 now" → "Worth 0 now"; clean sentences 2/2; round 8/10; miss
  logged; 0 reviews/study items written). Manual test: Particle Puzzle → pick a
  chip → tap a blank; confirm green lock on right, red on wrong with the
  countdown dropping, translation + "N / M points" appearing when all blanks
  lock, and result totals matching.

- **2026-09-19 — Short games: Particle Puzzle shipped**. Second `/play` game
  (`src/lib/particlePuzzle.ts`, `ParticlePuzzleGame.tsx`): 5 real sentences,
  2–4 particles pulled into one shared chip bank + 1–2 confusable decoys, tap
  chip → tap blank → Check; translation hidden until the check; two preceding
  sentences shown for は/が context (`getPrecedingSentences`, reuses
  `buildReadingContextMap`). Deliberately conservative about what it blanks
  (only 格助詞/係助詞; never の/へ/終助詞/接続助詞, never a particle touching
  another — には/でも are ambiguous compounds); は/が/も swaps are reported as
  "different from the original" since they're often both grammatical.
  Eligibility = vocab-confirmed, translated, ≤60 chars, ≥2 blankable, not
  suspended-only: **142 playable sentences in prod** (528 before the
  confirmed-vocab gate). **First use of the `gameRounds` log as history:** each
  blank is a `GameRoundItem.parts` entry; recent per-particle misses feed
  `missFocus` (biases which particles a weak round blanks) and each sentence's
  picker stats — so the hub's "Weak spots" pool starts at 0 and grows as you
  miss things. Offers `weak` + `strong` only (`GameDef.signals`); per-game
  `SignalCopy` wording. Also: the picker's `any` fallback now samples the whole
  pool (it used to re-draw the same first few items), and the Word Detective
  effect no longer trips `exhaustive-deps`. Still read-only w.r.t. FSRS.
  Verified in a real browser (seeded data, deliberate mistake → per-blank
  feedback, miss logged, next weak pool = 7, 0 reviews/study items written).
  Manual test plan: `/play` → Particle Puzzle → Play a round → Start; tap a
  chip then a blank, fill all, Check — ✓/✗ per blank, translation appears,
  a wrong は/が/も swap carries the "often both natural" note; finish and confirm
  the result lists each sentence with a "why this sentence" line; return to
  `/play` — "Weak spots (n)" now counts sentences containing the particles you
  missed; play "Weak spots" and confirm the intro/why lines mention them.

- **2026-09-19 — Short games P1 shipped: `/play` + Word Detective**. New
  standalone `/play` hub (Home shortcut "Play a round") and
  `/play/:gameId/:signal`. Pieces: `GameShell` (intro → play → result, no-fail
  pace bar), pure shared picker `src/lib/gamePicker.ts` (signals weak / stale /
  strong from FSRS lapses + `predictRetrievability`, fallback weak → stale →
  strong → any with an honest note), game registry `src/games/registry.tsx`
  (each game's `loadPools` applies its own eligibility; hub hides a game/signal
  whose pool can't fill a round), and the first game **Word Detective**
  (`src/lib/wordDetective.ts`, `WordDetectiveGame.tsx`): 3 words/round, blanked
  in real sentences from the learner's books, typed reading, clue ladder
  (translation → second sentence → meaning → first kana → audio), score
  5 − clues − wrong guesses. Eligibility = ≥2 distinct sentences containing the
  recorded surface form, opener translated, suspended-only sentences skipped.
  **Read-only w.r.t. FSRS by design** — rounds append to a new **local-only**
  Dexie table `gameRounds` (v19; `logGameRound`), not synced, no Supabase
  migration. Verified in a real browser against seeded data (round played
  end-to-end, no console errors, 0 reviews/study items written). Manual test
  plan: Home → "Play a round" → hub shows Word Detective with per-signal
  counts (a signal under 3 is greyed "not enough yet"); Play a round → Start →
  wrong guess shows "Not quite", Clue button reveals translation, then a second
  sentence…; Give up reveals the word; finish → result lists each word with its
  "why this word" line and a Replay button; confirm `/study-items` and review
  counts are unchanged afterwards. Next (ROADMAP "Short games"): more games
  (Odd Ear Out, Verb Lego, Particle Puzzle), then P2 session interlude, P3
  `/progress` panel, P4 sync.

- **2026-09-19 — "Short games" planned (no code yet) + feasibility script**.
  Four parallel read-only design passes (audio / vocab / grammar /
  framework) produced a ranked game shortlist, a shared GameShell +
  item-picker design, and a phased rollout; all recorded under "Short
  games (`/play`)" in ROADMAP.md "Planned". Added
  `scripts/report-game-feasibility.ts` (read-only, prod via
  `createScriptSupabaseClient`) to size each candidate's eligible pool
  before building: Word Detective 194/490 confirmed words have 2+
  sentences (25 lapsed words qualify — thin weakness pool); Odd Ear Out
  113 words with aligned audio, 3+1 rounds possible at 2–5 morae
  (proficiency unfiltered); Particle Puzzle 994/1269 sentences with 2+
  particle tokens.

- **2026-09-18 — numeral `<unk>` cascade fixed (partial), backfill applied
  to 52 links**. The 18 "no aligner match" skips from the backfill below
  traced almost entirely to one cause: mined transcripts write dates as
  arabic digits (16日), the MFA dictionary has no entry for a bare digit
  string, so the tokenizer emits `<unk>` for the whole token — and
  `isolatedWordRange`'s OOV guard treats any `<unk>` as poisoning every
  later word in the same sentence (its audio duration isn't credited to
  the character-proportion basis, so everything after it drifts). One date
  at the start of a weather-report sentence was enough to break isolation
  for every word after it.
  Fix lives in the sibling repo: `~/projects/shadowing-analysis-api`'s
  `app/numerals.py` expands `<n>日`/`<n>月` to their hiragana reading
  before alignment. Two things tried and ruled out first (checked directly
  against `japanese_mfa.dict`): converting to kanji digits instead of kana
  isn't enough (十六日 has no entry of its own; the tokenizer treats it as
  one indivisible token it can't look up either way — only kana readings
  turned out to have literal dictionary entries), and forcing a token
  split with an explicit space actively regressed *already-working* cases
  (whatever this tokenizer does with a literal space, it isn't "treat it
  as a boundary"). Live sweep of all 43 day/month values against `/align`:
  **12/12 months fixed, 19/31 days fixed** initially — the 12 day
  failures (3,13,16-19,23,26-30) split into a tens-prefix plus a
  ones-digit+にち remainder that isn't independent vocabulary on its own.
  Same-day follow-up: queried the tokenizer directly
  (`generate_language_tokenizer`) to get the exact failing fragment for
  each value — six recurring remainders (さんにち/ろくにち/しちにち/
  はちにち/くにち/じゅうにち) cover 11 of the 12. Derived each one's
  phones from already-verified data (the whole compound's real dictionary
  entry minus the verified prefix's phones, cross-checked via two
  different parent compounds landing on the same remainder) rather than
  hand-transcribing IPA, and added them to shadowing-analysis-api's
  `app/data/supplementary_dictionary.dict`. **Day coverage 19/31 → 30/31.**
  The one holdout, day 3 (みっか splits as み+っか, or か at least, inside
  a sokuon gemination), was left alone — no clean phone boundary to derive
  from, and a wrong guess there produces confidently-wrong alignment
  instead of a safe skip. 番/年 remain uncovered entirely — open-ended
  constructions with no closed-vocabulary dictionary entry, and no
  verified compound to derive missing-fragment phones from either.
  `ALIGNMENT_VERSION` bumped 1→2, then 2→3 for this follow-up
  (`src/lib/analysisApi.ts`) so cached
  `reference_alignment` rows from before this fix get recomputed instead
  of silently reusing the stale, still-`<unk>`-poisoned result — both
  `backfill-word-audio-range.ts` and `experiment-word-boundary-
  verification.ts` now check `alignment_version` before trusting a cached
  row. Re-ran the word-boundary backfill on the same 150-word scope after
  the fix: skips dropped from 18 to 11, 7 more words got a usable
  alignment (11日, 気温 ×2, なり, 10月, 15日, 地方, 降っ), and 12 more
  links qualified for a tight-boundary write. Applied to date: **52
  links** on the 150-word scope, then **80 more** on a full-corpus sweep
  (`--apply --limit 100000`, 493 candidates, 31 skipped, 462 scored) — 132
  total. That full-corpus run used `ALIGNMENT_VERSION` 2 (the hiragana-
  reading fix only); the follow-up supplementary-dictionary fix landed
  after it started, bumping to v3. Final re-run under v3
  (`--apply --limit 100000`, 421 candidates — the 80 already written are
  excluded — 29 skipped, 8 more updated): **140 links total**. The 29
  remaining skips are the uncovered counters (8番 ×2, 20歳 ×2, 3週間,
  100匹) plus genuine one-off OOVs (Patreon, メンバーシップ, しゃっ,
  エクストリーム, ガラッ, ゆうじくん) and the words cascade-poisoned by them
  in the same sentences. Diagnostic tools added:
  `scripts/diagnose-word-boundary-skips.ts` (characterizes *why* a given
  surface form has no aligner match — substring-missing vs. OOV-cascade —
  searches by surface form since skip-log indices shift as soon as an
  earlier `--apply` run removes rows from the eligible pool) and
  `scripts/verify-numeral-alignment-fix.ts` (forces a fresh, uncached
  `/align` call against known-affected sentences).
- **2026-09-18 — word-clip boundary backfill built and applied (40 links)**.
  Turns the round-trip-verification experiment below into a real backfill:
  `scripts/backfill-word-audio-range.ts` (+ shared `scripts/lib/
  audioClipHelpers.ts`, extracted from the experiment script so the two
  don't drift) tries `default` (the fixed pad) against `tight` (the
  aligner's raw match) per `sentence_vocabulary` link, via a
  `large-v3-turbo` round-trip ASR pass in a subprocess
  (`scripts/score-word-audio-candidates.py`, `mfa` conda env — loads the
  model once, scores every clip, exits). Writes `audio_start_ms`/
  `audio_end_ms` (the same field the "Adjust" hand-correction editor uses)
  only when `tight` clears a similarity floor (0.5) and beats `default` by
  a real margin (0.1) — anything under that stays on the runtime default,
  nothing is ever written for a `default` win (that's already what happens
  with no override stored). Never touches a link with an existing manual
  range. Dry-run by default (`--apply` to write), `--book`/`--limit` to
  scope. 150-word dry-run: 132 scored (18 skipped, mostly no aligner
  match), 40 (30%) would switch to `tight`, all with a clear margin (e.g.
  今回 0.10→1.00, 天気 0.00→0.86, 二人 0.00→0.75) — applied for real
  (`--apply --limit 150`), 40 links updated. The 18 skips led directly to
  the numeral-cascade investigation/fix above; a second pass after that
  fix applied 12 more (52 total so far). Wider corpus not yet swept.
- **2026-09-18 — word-clip boundary round-trip ASR verification experiment**
  (chat: "would some sort of iterative process... help?" re: word-clip
  precision for pitch_accent/word_listening cards). Added
  `scripts/experiment-word-boundary-verification.ts` (read-only, no
  writes): for a sample of confirmed `sentence_vocabulary` occurrences, it
  builds several candidate boundaries off the aligner's raw match
  (`isolatedWordRangeUnpadded`, newly exported from
  `src/lib/isolatedWordRange.ts` alongside the existing padded
  `isolatedWordRange`) — the current fixed -60/+120ms pad, no pad, double
  pad, and a silence-snapped variant — ffmpeg-trims each, and scores it via
  `POST /validate-transcript` (fresh Whisper pass + hiragana-normalized
  similarity to the target surface form). Run against 40 real occurrences:
  no single fixed pad dominates (default wins 57% of words by best
  similarity, no-pad 35%, double-pad only 8% and clearly worse on
  average, mean 0.489 vs ~0.55-0.57 for the others) — a per-word
  round-trip choice between a couple of pad candidates would beat any
  fixed constant. Silence-snap collapsed to the default boundary almost
  every time at the current ±200ms search window, so it isn't pulling its
  weight yet. Also: even the best candidate's similarity is often
  mediocre (0.3-0.7, several near 0, one clear Whisper hallucination on a
  near-silent clip) — the "base" diagnostic Whisper model is a noisy judge
  at word length, a real constraint on how far this approach can be
  pushed without a bigger verification model. Not yet turned into a
  production feature (would mean an extra ASR-call backfill pass and
  writing `SentenceVocabulary.audioStartMs/EndMs` at scale) — next step if
  pursued.
  **Follow-up same day**: re-ran the identical 37-word/147-clip sample
  through `large-v3-turbo` instead of the diagnostic `base` model
  (`scripts/rescan-clips-with-model.py`, one-off — loads the kept clips
  from `KEEP_CLIPS_DIR`, not wired to any service; needs the `mfa` conda
  env's faster-whisper + a `pip install jaconv` done there for kana-fold).
  Restarted `shadowing-analysis-api` first to clear ~3 days of the known
  aligner memory leak (5.2G RSS, 1.7G swapped) before loading a second
  model — same recovery its weekly restart timer already does. Using one
  consistent (simplified, no kanji-reading step) comparison metric for
  both models on the exact same clips: turbo scored meaningfully higher
  across every boundary candidate (mean similarity ~0.45-0.57 vs base's
  ~0.33-0.40, roughly +25-40% relative) — a real accuracy gain, not noise.
  Which boundary candidate won stayed split between `default` and `tight`
  either way (turbo: 51%/46%, base: 57%/35%) — the bigger model makes the
  verifier a more trustworthy judge, it doesn't remove the need to try
  more than one boundary per word. Some clips (揺れ, 日記, 下手) scored
  near zero on both models regardless of pad — genuinely hard/short clips,
  not a model problem.
- **2026-09-18 — stale "in progress" mining jobs hidden once imported**
  (user: podcast episode #1472「髪について！」showed as "in progress: step
  1 of 4" on the feed picker despite already being imported). Root cause:
  `YouTubeMinePage`'s "resumable" job list (from the mining service's job
  registry) and its "Imported" pill (from local Book/Chapter records via
  `getSeriesImportedSourceIds`) are two independent, never-reconciled
  status sources. A stalled first attempt (its job stuck at the transcript
  stage, likely because a podcast RSS enclosure URL changed on refetch so
  a retry's `_find_reusable_job` URL match missed it) survives up to the
  server's 48h TTL even after a second, successful attempt gets committed
  and the episode is fully imported. Added `visibleResumable` (filters
  `resumable` against `importedPodcastSourceIds` and the existing
  `minedVideos` YouTube-id index) so an already-imported episode's ghost
  job no longer shows as resumable. Immediate unblock for the reported
  episode: resume the stale job from the list, then "Start over" (calls
  `deleteMiningJob`, removing it server-side). Not fixed: the underlying
  job-matching gap in `server/youtube-mining/app/jobs.py`
  (`_find_reusable_job`'s exact-URL match) that let the orphan job spawn
  in the first place.
- **2026-09-18 — same/different near-minimal-pair perception warm-up**
  (real-audio pitch-perception bridge, docs/ROADMAP.md). The ABX half of
  the bridge that shipped 2026-09-14 as `PitchWordPhraseWarmup`
  (word-alone-vs-phrase): `src/lib/pitchAccentMinimalPairs.ts`
  (`findMinimalPairContrasts`/`buildMinimalPairTrials`, pure, 8 tests)
  finds confirmed, proficient vocabulary pairs sharing a reading (a true
  homophone, e.g. 箸/橋, both はし) but a different dictionary pitch-accent
  position, excluding heiban-vs-odaka combinations since those render an
  *identical* in-word shape and would be an unanswerable trial from the
  isolated word alone. `getPitchAccentMinimalPairOccurrences`/
  `getPitchAccentMinimalPairTrials` (`repository.ts`) restrict candidates
  to a sentence with reference audio *and* the word's exact citation-form
  surface (`link.surfaceForm === expression`), sidestepping inflected-form
  accent resolution — near-minimal accent pairs are almost always nouns.
  New `PitchAccentMinimalPairWarmup` component (isolates each word's clip
  via the same `isolatedWordRange`/forced-alignment technique as
  `PitchWordPhraseWarmup`) sits at the top of `PitchAccentDrillPage`:
  plays both clips in a randomized order, the learner picks which clip is
  which before revealing the answer. Up to 5 trials, each contrast tried
  once from the same book, then once more across two different books if
  the corpus has one — **`Book.id` doubles as a same-speaker proxy**, since
  no per-clip speaker identity exists in this corpus; a book is normally
  one show/narrator (or one consistent cast), so this is an approximation,
  not verified per-clip speaker data. Prompted by mining two episodes of
  "Nihongo con Teppei (Beginners)" specifically as a known single-narrator
  source, after confirming NHK Easy's own feed/site publish no narrator
  metadata to check by. Ungraded and unpersisted, like its sibling warm-up
  — renders nothing when the corpus has no eligible pairs yet (likely with
  only two podcast episodes mined so far). Not browser-verified (no
  browser libs on this host) — shipped on the full test suite + typecheck.
  Still open: the same/different + ABX bullet's "cross-speaker" half is
  covered; "3–5 trials" depends entirely on how many true homophone
  accent-minimal-pairs end up mined with proficient, audio-linked
  occurrences on both sides — likely to start near zero and grow as more
  single-speaker podcast/NHK-Easy content is mined.
- **2026-09-17 — recording-timing playhead on the native pitch contour**
  (user: "when I'm recording ... show a bar on the native pitch that
  follows time ... so I can try to match my overall timing better than
  just from memory"). `ShadowPage`'s free-form "Record" button (the
  "Record & analyze" panel) has no reference audio sounding — the learner
  recites the sentence from memory — so there was previously no timing cue
  at all while recording, unlike the "Close shadow" hands-free loop where
  the reference audio itself paces them. `MeasuredPitchContour` gained a
  `pacing` prop that recolors its existing playhead (accent → `--danger`)
  to distinguish "elapsed-time guide" from "live playback position."
  `SyncedShadowText` gained optional `recordingElapsedMs`/`recordingSpeed`
  props; when set it derives the contour's `progress` from elapsed
  recording time scaled by the chosen practice speed
  (`elapsedSeconds * speed / clipDurationSeconds`, clamped to 1) instead of
  the reference `<audio>` element's `currentTime` — the same math the
  existing playback-driven playhead already relies on (`currentTime`
  advances in clip-native seconds regardless of `playbackRate`, so scaling
  by speed converts real elapsed seconds into the same units). `ShadowPage`
  passes these only while `shadowing.status === 'recording' && !isLoopingReps`
  (the hands-free loop pins `recordingElapsedMs` at 0 per-tick already, so
  gating isn't strictly required, but the explicit condition future-proofs
  against relying on that quirk). Test added at the component level
  (`tests/measuredPitchContour.test.tsx`: pacing playhead/band get the
  `-pacing` modifier class; unstyled otherwise).
- **2026-09-17 — sibling-spacing broadened to span descriptors** (user:
  "still see new cards that ask about the same vocabulary in the same
  sentence one right after another"). `spaceOutSiblingCards`
  (`ReviewPage.tsx`) only compared `subjectType:subjectId`, but a word's
  `reading_retrieval` (subjectType `vocabularyItem`) and its
  `word_listening` (subjectType `sentenceVocabulary`, the occurrence link)
  never shared that key even though they drill the same word in the same
  sentence — so they slipped past both the bury filter and the spacing
  pass. Added `queueCardVocabularySiblingKey` (resolves through
  `target`/`wordListening`/`conjugation`/`pitchAccent`'s `vocabularyItem` +
  the card's `sentence.id`) as a second sibling key, and generalized the
  greedy spacer to `spaceOutBySiblingKeys` so it checks both keys. Also hit
  new-card seeding, which never ran spacing at all: `vocabulary` and
  `wordListening`'s per-descriptor candidate lists are both ordered by
  sentence, so their pending-seed batches commonly land at the same
  round-robin index and get lazily seeded back to back. Added
  `spaceOutPendingSeedBatches`, applied once when the pool is built, to
  reorder whole (descriptorKey, subjectId) batches on the same duck-typed
  vocabulary+sentence key before they're queued for seeding. Not a shuffle
  (considered and rejected — a plain shuffle wouldn't guarantee
  non-adjacency and would fight the due-date sort feeding this same
  function); this reuses the existing 2026-09-04 spacing approach with a
  wider sibling key instead. Test added:
  "never places two cards on the same word in the same sentence adjacently
  even across descriptors" (`tests/reviewPage.test.tsx`).
- **2026-09-17 — three ROADMAP items closed: velocity/ETA, "Ready to read"
  step 3, leech list** (user, after reviewing the roadmap for "other items
  that would be good to do"). All three shipped together, browser-verified
  on `/progress` and Home with a live dev server (Playwright against real
  seeded data through the app's own repository module, no fixtures) — no
  console errors, screenshots confirmed correct rendering including the
  "no estimate yet" zero-rate edge case.
  - **Velocity/ETA** (`src/lib/velocity.ts`, `buildVelocityReport`) — a new
    "New-card backlog" `/progress` panel combining
    `countNewVocabularyCardBacklog()`'s count with the words-learned-per-
    week trend `buildProgressReport` already computes (`ProgressReport.weeks`);
    computed client-side in `ProgressPage`, no new Dexie reads. Averages
    only complete weeks (excludes the current in-progress bucket, which
    would understate the rate) and reports "no estimate yet" rather than
    dividing by zero when the recent rate is 0 — real behavior hit live
    during verification (a freshly-recalled word only counts once its week
    is complete).
  - **"Ready to read" step 3** (`repository.ts#findExploreCandidates`) —
    among explore candidates that are otherwise tied (both already caught
    up on vocabulary confirmation — the existing rank-0-vs-1 split is
    untouched), `getBookVocabularyCoverage()`'s ratio now breaks the tie
    before falling back to recency, so an easier caught-up book edges out
    a harder one opened more recently. Unanalyzed books (`ratio: null`)
    still sort last, matching `BooksPage`'s "Easiest first" convention.
    Test: `tests/sessionPlannerRepository.test.ts` builds a harder book
    opened *after* an easier one and asserts the easier one still ranks
    first.
  - **Leech list** (`src/lib/leechList.ts`, `buildLeechList`) — a new
    "Leech list" `/progress` panel: every study item with a real FSRS
    `lapses > 0`, ranked by `lapses + weakness` (same
    `recentAgainCount / recentReviewCount` term `sessionPlanner.ts`'s
    `scoreReviewPriority` uses), each row showing its most common recent
    `errorClassification` reason and a next action. Reuses `errorMix.ts`'s
    label/route table (`metaFor`/`classificationKey`, both newly exported)
    rather than a second copy, so the leech list and "What to work on"
    never disagree on what a classification means. Deliberately gated on
    a real lapse, not just recent misses — a still-new item's `weakness`
    defaults nonzero in the planner's own formula, which would otherwise
    leak brand-new items in here too. `repository.ts#getLeechList` only
    queries reviews for the lapsed subset (via `listStudyItemSummaries`'s
    existing subject-label batching), not the whole `reviews` table. Each
    row links to `/study-items/:id` (existing debug view) and, when
    classified, the same next-action route `errorMix` points at.
  - 14 new tests (`tests/velocity.test.ts`, `tests/leechList.test.ts`, plus
    additions to `tests/progressPanels.test.ts` and
    `tests/sessionPlannerRepository.test.ts`); full suite green (1508).
- **2026-09-17 — per-review predicted-retrievability logging** (user asked
  about the "FSRS calibration surfacing" ROADMAP entry, then asked to close
  the gap it flagged). "FSRS confidence" on `/progress` only ever showed a
  live snapshot of *current* predicted retrievability because nothing
  persisted what FSRS predicted right before a review was actually graded
  — true predicted-vs-actual calibration and a desired-retention knob both
  need that per-review value. `recordReview` (`src/db/repository.ts`) now
  calls `predictRetrievability` against the study item's FSRS state before
  `scheduleReview` mutates it, storing the result on a new
  `Review.predictedRetrievability` field — undefined for `new`-state items
  and any item without a real `lastReview` (checking `state !== 'new'`
  alone isn't enough: ts-fsrs's `get_retrievability` throws without a
  `lastReview` to diff against, caught by the full test suite against a
  `reviewPage.test.tsx` fixture that has `state: 'review'` but no
  `lastReview`). Synced via a new nullable `predicted_retrievability`
  column (`supabase/migrations/20260917000000_review_predicted_retrievability.sql`
  — **not yet applied to prod**; this environment has no Supabase CLI/
  service-role credentials to apply DDL directly, apply by hand via the
  Supabase Dashboard SQL editor, same as the 2026-09-13 te-form migration)
  and `reviewToRemote`/`remoteToReview` (`src/sync/mappers.ts`). Only
  reviews recorded from now on carry the value; historical rows are
  unaffected. No UI yet — that's the next step once enough logged reviews
  accumulate to make a predicted-vs-actual view meaningful. Detail in
  ROADMAP.md.
- **2026-09-17 — `pitch_accent` reveal: fixed a silent noun rule-note gap,
  added the -masu family's fixed-accent rule, and a hedged noun-length
  tendency note** (user: noticed やま/山 got no explanatory rule note at
  all on reveal, and separately asked about verb/noun pitch tendencies).
  Root cause of the silence: `hasNounTag` in `pitchAccentRules.ts` only
  recognized JMDict tags (`n`, `pn`, …), but mined nouns keep their raw
  UniDic POS (`名詞/普通名詞`) forever — `scripts/backfill-vocabulary-jmdict-pos.ts`
  deliberately never rewrites noun rows — so the "no reliable rule, must be
  memorized" fallback silently never fired for any mined noun. Fixed by
  recognizing UniDic noun POS too, mirroring how
  `conjugationWordClassFromPartOfSpeech` already handles UniDic adjective
  tags. Separately, confirmed the -masu family (ます/ました/ません) already
  had its downstep position computed correctly (Wiktionary-verified, in
  `pitchAccentShift.ts`'s `politeStemPosition`) but the reveal's
  explanation text still described the *citation* form's own heiban/
  accented class rather than naming the -masu override — added a
  `conjugationFormKey` field threaded from `resolveInflectedPitchAccent`
  through `PitchAccentReviewCandidate` to `explainPitchAccent`, which now
  states the -masu family's fixed accent when applicable. Finally, added a
  length-based noun tendency note (short 2–3-mora nouns skew atamadaka/
  heiban; long 5+-mora nouns skew nakadaka near the antepenultimate mora)
  — explicitly worded as a statistical tendency, not a rule, and only
  shown when the specific word's own pattern happens to agree with it
  (silent otherwise, same "stay silent rather than assert something false"
  stance as every other rule in the file). `src/lib/pitchAccentRules.ts`,
  `src/lib/pitchAccentShift.ts`, `src/pages/ReviewPage.tsx`; 9 new unit
  tests in `tests/pitchAccentRules.test.ts`, 1489→1492 total.

- **2026-09-17 — `grammar_completion` rebuilt from multiple choice to
  typed recall** (follow-up to the same-day card issue triage below: "not
  sure if the way this card type is setup is helpful, it's just kind of a
  search and find" → user: "the question should be what should the card be
  teaching me to retain?"). With the translation always shown, multiple
  choice let a learner eliminate options by shape rather than recalling
  the construct from its meaning. Now a typed-input card, same shape as
  `SentenceConjugationCard`/`ReadingProductionCard`, graded by a new
  `isGrammarPatternAnswerCorrect` (`src/lib/grammarPatterns.ts`) reusing
  the existing tilde/annotation-stripping normalization
  (`normalizeGrammarPatternKey`/`blankPatternInSentence`) so a missing
  tilde or an unstated parenthetical gloss doesn't fail an otherwise-right
  answer. Deleted `buildGrammarCompletionChoices`/
  `GRAMMAR_COMPLETION_CHOICE_COUNT` and the `GrammarRelationship`-ranked-
  distractor plumbing in `ReviewPage.tsx`'s scope query — no longer
  needed, and with it the "fewer than 2 choices" degenerate case (every
  tracked pattern now gets the same card). `GrammarReviewCandidate` lost
  its `choices` field. Updated 3 existing `reviewPage.test.tsx` tests,
  removed one that only tested distractor ranking, added 6 new
  `isGrammarPatternAnswerCorrect` unit tests. A future *discrimination*
  card (confusable-pair contrast, using `GrammarRelationship` /
  `commonly_confused`) is parked on docs/ROADMAP.md as a possible
  follow-up if recall alone doesn't surface those errors.

- **2026-09-17 — `WordAudioRangeEditor` drag dispatched by DOM z-order,
  not pointer proximity: the ungrabbable/collapsing handle bug (card issue
  triage).** Two same-day reports (まあ / 夏休み, both short words inside a
  long clip) described the same symptom: "can't adjust the right side, if
  I try the left side collapses and I can't move either." Each handle drags
  via its own invisible 24-viewBox-unit-wide hit-line, and the `end`
  handle's line is drawn after (on top of) `start`'s — for a short word the
  two starting handle positions sit well within that 24-unit overlap, so
  every pointerdown in that zone hit `end` regardless of intent: a drag
  meant to widen `start` leftward instead dragged `end` down onto it,
  collapsing the range, after which both handles occupied the same point
  and `start` was permanently unreachable. Fixed by moving pointerdown
  dispatch to the `<svg>` itself and picking whichever handle's *current
  position* is nearer the click, not whichever hit-line happens to be
  topmost. `src/components/WordAudioRangeEditor.tsx`; 1 new regression test
  in `tests/wordAudioRangeEditor.test.tsx`. Third open report this session
  (`grammar_completion`, "just kind of a search and find") is UX feedback
  on the rebuilt card's design, not a data bug — left for the user to weigh
  in on rather than acted on unilaterally.

- **2026-09-16 — Five data-grounding panels on `/progress`** (user: "any
  recommendations for types of data we should collect or improving what
  we already collect" → "maybe build all 5?" → "All 5 on /progress").
  Three were already-identified but unbuilt ROADMAP possibilities from a
  2026-09-08 discussion; two ("step usefulness," "gate funnel") were new,
  motivated directly by the gate-starvation bugs found earlier the same
  session. All five are pure `src/lib/*.ts` modules (same "no Dexie,
  unit-testable" convention as `progressReport.ts`/`errorMix.ts`) fed by a
  thin `repository.ts` fetcher, following the exact existing pattern:
  - **Self-rating check** (`selfRatingCalibration.ts`) — global pass-rate
    comparison, self-rated activity types vs. objectively-graded ones.
  - **Skill coverage** (`skillCoverage.ts`) — of recognition-proficient
    words, share also production/pitch/word-listening proficient. New
    `getProficientRecognitionVocabularyItemIds` (reading_retrieval/cloze
    only, excluding reading_production — a separate rung).
  - **FSRS confidence** (`fsrsConfidence.ts`) — live retrievability
    snapshot. New `scheduling.ts#predictRetrievability` wraps ts-fsrs's
    own `get_retrievability` (never reimplement the forgetting curve).
    True predicted-vs-actual calibration and a desired-retention knob were
    scoped out — both need per-review logging that doesn't exist yet;
    left as an explicit ROADMAP follow-up rather than rushed.
  - **Step usefulness** (`stepUsefulness.ts`) — `PlannerSession.steps`
    flattened across a 56-day window, grouped by `targetKind`, sorted by
    skip rate.
  - **What's stuck** (`repository.ts#getGateFunnelSnapshot`, no pure lib
    module — mostly Dexie-side counting) — a standing version of the
    one-off Node script used earlier the same session to diagnose the
    皆/元気 gating bugs: sentences blocked on specifically one named
    requirement, not a general readiness count.
  Caught one real bug before it reached anything except a test: a
  `review`-state `StudyItem` fixture with no `lastReview` set crashed
  ts-fsrs's `get_retrievability` (`FSRSValidationError: Invalid date`) —
  guarded in `getFsrsConfidenceSnapshot` (every item `scheduleReview` has
  ever touched has `lastReview` set; the guard is for legacy/malformed
  rows, not a "can't happen" case, since a real test fixture had it).
  Browser-verified against the Vite dev server (seeded real data via a
  dynamic `import('/src/db/repository.ts')` in-page, the same
  fixture-free-seeding technique used 2026-09-14) — all 5 panels render
  correctly empty and with real numbers, zero console errors. 10 new
  repository-integration tests (`tests/progressPanels.test.ts`) + 13 new
  pure-function unit tests across 4 new test files; full suite green
  (1482 tests).

- **2026-09-16 — Skill-graph pass 2: word_listening/listening/contrastive
  un-blended from pitch, plus a starvation-bug preempt on the two new
  pitch gates from pass 1.** Same-day follow-up to the split below, after
  mapping the full card-type → skill dependency graph with the user
  (docs/AI_OVERVIEW.md's glossing/listening sections). Three fixes:
  - New `getProficientReadingVocabularyItemIds` (`repository.ts`, reuses
    the `filterVocabularyItemIdsByActivity` helper from pass 1). `word_listening`'s
    tier-1 gate and the `contrastive` (confusion pair) gate in
    `ReviewPage.tsx` both already documented their `GateContext.proficientVocabularyItemIds`
    field as meaning "the word's reading proficiency" — they were just
    getting it from the blended `getProficientVocabularyItemIds`, so a
    word with only `pitch_accent` reps could satisfy either gate. Swapped
    to the new function; both gates now mean what they already claimed to.
  - `getSentenceListeningReadiness` (the `listening` card's tier-2 gate)
    now also requires every dictionary-pitch-eligible underlying word's
    `pitch_accent` card to be proficient, alongside the existing
    `word_listening`-proficiency requirement — pitch perception and
    word-level listening are two different skills that both support
    sentence-level listening (user framing), not one blended signal.
  - Caught before shipping, not after a report this time: both this new
    pitch requirement and `getSentenceShadowingReadiness`'s pitch
    requirement (pass 1, same day) would otherwise `.every()`-block a
    sentence forever if any linked word has no dictionary pitch data
    (`VocabularyItem.pitchAccentPositions` empty) — such a word can never
    seed a `pitch_accent` card, so it's now exempt from the pitch
    dimension entirely rather than gating on something structurally
    unreachable. Exact shape of the starvation bug `continue_book`'s
    FSRS-proficiency gate hit earlier the same day (see below) — this
    time found by inspection while writing the docstring, not by a user
    report.
  - `tests/data.test.ts` (`getSentenceListeningReadiness` describe block:
    3 new cases for the pitch dimension + the no-dictionary-data
    exemption) and `tests/sessionPlannerRepository.test.ts` (1 new case
    for the shadowing exemption; 1 existing case's fixture updated to set
    `pitchAccentPositions` since it now needs to be pitch-eligible to test
    what it claims) updated; full suite green (1459 tests).
  - Deferred, discussed but explicitly not built this pass (still
    "sitting on it," user's words): a free-composition/"writing" skill
    node (given an intent, produce Japanese from scratch — `reading_production`
    only tests reading-back a word already placed in a sentence, a much
    narrower skill) and a context-aware 4-option comprehension check for
    `reading_in_context`/`listening` (add an objective signal to what's
    currently pure self-rating) — see docs/ROADMAP.md.

- **2026-09-16 — Split the blended vocabulary-proficiency signal:
  `continue_book` gates on reading/meaning "introduced," shadowing gates
  on reading/meaning *and* pitch proficiency, separately** (user report:
  a sentence with 皆 — zero study items of any kind — surfaced for
  Analyze right after the same-day fix below loosened `continue_book` to
  just `confirmed`; separately, 元気 looked "known" to a shared gate
  because of a `pitch_accent` rep, even though its reading/meaning card
  had never been touched). Root cause both times:
  `getProficientVocabularyItemIds` (`repository.ts`) treats *any*
  `vocabularyItem`-subject study item — `pitch_accent` included — as
  proof the word is "known," so pitch-drill reps could stand in for
  reading/meaning recall and vice versa. Fix, scoped to the two consumers
  actually discussed (grammar/conjugation/full-sentence-review/book-
  coverage still use the original blended gate unchanged):
  - New `isVocabularyItemIntroduced` (`scheduling.ts`): state `!== 'new'`
    — reviewed at least once, not necessarily proficient.
  - New `getSentenceReadingIntroducedReadiness` (`repository.ts`), scoped
    to `reading_retrieval`/`cloze`/`reading_production` activity types
    only. `findExploreCandidates` now patches
    `ExploreCandidate.sentences[].vocabularyIntroduced` from it (the same
    batched-after-slice shape the old, removed `vocabularyReady` field
    used), and `classifyExploreSentences` (`sessionPlanner.ts`) requires
    both `vocabularyConfirmed` and `vocabularyIntroduced` before drafting
    `continue_book` — confirmed-but-never-reviewed sentences get no
    glossing step that pass, same as before, just for a different reason.
  - New `getSentenceShadowingReadiness` (`repository.ts`), replacing
    `findShadowCandidates`'s old `getSentenceFullReviewReadiness` call:
    `vocabularyReviewStatus === 'confirmed'` *and* every linked word
    proficient on `reading_retrieval`/`cloze`/`reading_production` *and*
    proficient on `pitch_accent`, checked as two separate sets rather than
    one blended one. Reading proficiency preserves the original
    2026-08-27 intent (don't split attention between recalling words and
    imitating pronunciation); the pitch requirement is new — shadowing
    should reinforce a pitch pattern already learned, not one never
    practiced.
  - `tests/scheduling.test.ts` (`isVocabularyItemIntroduced`),
    `tests/sessionPlanner.test.ts` (fixtures updated for the new required
    `vocabularyIntroduced` field + one new "confirmed but not introduced"
    case), and `tests/sessionPlannerRepository.test.ts` (two new
    end-to-end cases reproducing the 皆/元気 scenarios against real
    vocabulary links and FSRS state) all updated; full suite green.

- **2026-09-16 — UI-triggerable, book-scoped alignment backfill** (user
  doesn't always have SSH access to codex-dev, wanted the equivalent of
  `scripts/backfill-reference-alignment.ts` from a phone). Two additions,
  no new Python dependencies:
  - The script itself gained an optional `--book <id>` filter
    (`reference_audio.book_id`, direct + indexed column) so a run can be
    scoped to one book instead of the whole corpus.
  - `server/youtube-mining/app/alignment_backfill.py` is a new, minimal
    job type — deliberately separate from `jobs.py` (mining-pipeline
    scratch dirs/checkpoints don't apply) — that shells out to the script
    as a subprocess (reusing its already-authed Supabase logic verbatim
    rather than reimplementing it in Python, which has no Supabase client
    today) and tracks progress in memory. New routes `POST
    /alignment-backfill/jobs` / `GET /alignment-backfill/jobs/{id}`;
    client `src/lib/alignmentBackfillApi.ts`; a "Precompute word audio
    alignment" button + inline poll on `BookDetailPage`. Needs Node
    resolved via the same `MINING_YTDLP_JS_RUNTIME_PATH` nvm symlink
    yt-dlp's JS solver already uses (systemd's PATH lacks nvm's). No new
    credential setup needed — `tsx` auto-loads the repo root's `.env`
    (same creds the CLI backfill scripts already require) since the
    subprocess runs with `cwd` set there. Verified live on codex-dev
    2026-09-16 (`POST /alignment-backfill/jobs`, unscoped, ran the full
    782-recording corpus for real via the restarted service).

- **2026-09-16 — `continue_book` (Analyze) steps no longer wait on vocab
  FSRS proficiency** (user report: "haven't been getting many sentences
  in my daily session for analyzing"). `buildExploreSteps`
  (`sessionPlanner.ts`) used to withhold a sentence's `continue_book` step
  until *every* confirmed vocabulary item had independently reached FSRS
  `review`/`relearning` (`isSentenceReadyForFullReview`) — a rule meant
  for full-sentence *review* cards (don't test recall of an unproven
  word), reused here even though structural analysis/grammar-noticing
  isn't a recall test. With several books mid-read and vocab flowing in
  continuously, most frontier sentences sat "confirmed but still
  learning" indefinitely, producing no glossing step at all
  (spot-checked against prod: 4 active books' next ~20 unstarted
  sentences each — 68/75 stuck in that limbo, only 6 actually
  analyze-eligible, one book at 0/15). `continue_book` is now eligible as
  soon as `vocabularyReviewStatus === 'confirmed'`, matching the
  `vocabulary_review`-then-`continue_book` ordering rule that already
  existed; the unused `ExploreCandidate.sentences[].vocabularyReady`
  field and its batched `getSentenceFullReviewReadiness` lookup in
  `findExploreCandidates` (`repository.ts`) were removed along with it.
  Full-sentence review cards are untouched — they still gate on
  `isSentenceReadyForFullReview` directly. `tests/sessionPlanner.test.ts`
  updated for the new behavior; full suite green.

- **2026-09-16 — "Imported" badge now finds pre-series-model episodes
  too** (user report: two already-imported `nihongoconteppei.com`
  episodes showed no mark in the podcast picker). Root cause: both were
  imported same-day as, but just before,
  `commitSeriesEpisodeImport`/one-shared-book-per-series (01fa81a,
  2026-09-13) — they landed as their own standalone single-chapter books
  (via `commitShadowingPackageImport`) rather than a chapter in the series
  book, exactly the "Known gap" that commit's message flagged and
  deferred. `getSeriesImportedSourceIds` (`repository.ts`) only checked
  the series book's chapter `sourceId`s, so it never saw them.
  `getSeriesImportedSourceIds` now also matches any standalone book's
  `sourceUrl` against the episode/article URL — exact-string matching is
  safe since a `sourceUrl` collision would mean two different feeds
  serving the same media file. No data migration; confirmed against prod
  Supabase (`scripts/diagnose-podcast-imported-books.ts`, kept for future
  spot-checks) that the two affected books really were standalone before
  writing the fix.

- **2026-09-15 — Grammar-pattern "Graduated" badges + book-level grammar
  rollup** (follow-up to the book-progress section below, prompted by "how
  are the different pieces graduated" / "make that more consistent"). The
  existing `sentence`/`vocabularyItem` "Graduated" pill
  (`computeGraduatedSubjectIds`/`isGraduated`, every study item for the
  subject past `graduationMinScheduledDays`) now also applies to
  `grammarPattern` subjects — a third `graduated: boolean` field on
  `GrammarPatternSummary` (`listGrammarPatternSummaries`, `repository.ts`),
  rendered as a pill on `GrammarListPage` (next to "Tracked") and
  `GrammarPatternDetailPage` (next to the learner-state pill). New
  `getBookGrammarProgress(bookId)` (`repository.ts`) mirrors
  `getBookVocabularyCoverage`'s join chain — `bookSentences` →
  `sentenceGrammar` (indexed on `sentenceId`) → distinct
  `grammarPatternId`s → their study items → graduation — and feeds a new
  "Grammar patterns: G/T graduated (T tracked, E encountered)" line in
  `BookDetailPage`'s progress section. Deliberately did **not** extend
  graduation to the `chunk` subjectType — grepped confirmed no code path
  anywhere ever creates a `chunk`-subject study item (vestigial union
  member), so there's nothing to badge. Given the 2026-09-15 finding that
  the grammar ladder "essentially never fired" (2/74 patterns had study
  items pre-fix), expect this badge to show 0 graduated for most patterns
  for a while — that's expected, not a bug. 6 new repository tests
  (`tests/data.test.ts`) cover `graduated` on `listGrammarPatternSummaries`
  and all four `getBookGrammarProgress` cases (empty book, untagged,
  encountered-only, tracked-only, graduated, cross-book isolation).
  Verified by hand: tagged an untracked pattern via the Analyze page's
  "Grammar noticed" panel, confirmed `/grammar`, `/grammar/:id`, and the
  book's progress line all render it correctly with no console errors
  (headless Playwright against the dev server).

- **2026-09-15 — Book-level progress section on `BookDetailPage`** (user
  ask: summarize a book's current state and progress toward completion in
  one place, instead of only inferring it from scrolling the sentence
  list). A new "Progress" panel sits above the action-button row,
  book-level only (matches the existing "per-chapter breakdown not done"
  scope note on the "Ready to read" coverage work in ROADMAP.md — a
  chapter's sentences aren't queried separately today). Shows: sentence
  completion count/percent + bar and a status-pill breakdown
  (unstarted/in progress/needs review/complete), vocabulary-confirmed
  sentence count, known-vocabulary coverage (reuses
  `getBookVocabularyCoverage`/`coveragePercent`, same "not confirmed yet"
  wording as `BooksPage`'s list card), and graduated (mastered) sentence
  count (reuses the `computeGraduatedSubjectIds` set the page already
  computed for per-row "Graduated" pills). All of it is derived from data
  the page's `useLiveQuery` was already fetching, plus one added
  `getBookVocabularyCoverage()` call — no new repository query or schema
  change. Renders "No sentences yet." for an empty book instead of a 0%
  bar. Verified by hand: fresh CSV import (3 sentences, all unstarted,
  vocab unconfirmed) and a brand-new empty book, both via a headless
  Playwright run against the dev server — no console errors either way.

- **2026-09-15 — Recent feed URLs remembered on podcast/NHK Easy import**
  (user ask: don't make them re-find/re-paste the same RSS URL every
  time). `AppSettings` gained two optional arrays,
  `recentPodcastFeedUrls`/`recentNhkEasyFeedUrls` (newest first, capped at
  8, deduped) — kept separate since the two inputs take differently-shaped
  feeds. `rememberPodcastFeedUrl`/`rememberNhkEasyFeedUrl`
  (`repository.ts`) append on a successful `fetchPodcastFeed` load and
  persist via the existing `updateSettings`. `YouTubeMinePage`'s podcast
  URL input and `NhkEasyImportPage`'s feed URL input each read their list
  via `useLiveQuery` and offer it through a native `<datalist>` (typing
  still free-text, no separate list-management UI). No new Dexie table —
  reused the existing per-device `settings` singleton, same pattern as
  `quietMode`.

- **2026-09-15 — Grammar SRS: 4-card ladder collapsed to one
  `grammar_completion` card** (docs/ROADMAP.md — resolves the 2026-09-09
  open question). A performance check
  (`scripts/report-grammar-card-performance.ts`) found the
  `grammar_comprehension`/`grammar_completion`/`grammar_contrast`/
  `grammar_production` ladder essentially never fired (2 of 74 tracked
  patterns had ever produced a study item) because
  `pickContextSentenceForGrammarPattern` gated every card on the same
  strict vocab-proficiency rule `reading_in_context` already uses. First
  attempt collapsed all four into an ambient "noticing" strip under every
  review card; tried in real use it "makes the review cards clunky and
  doesn't help with learning" (user) — reverted same day. Second attempt,
  kept:
  - `grammar_comprehension`/`grammar_contrast`/`grammar_production`
    retired outright; `grammar_completion` survives as the sole grammar
    activity type and was rebuilt.
  - **Gating loosened to vocabulary's level** —
    `pickContextSentenceForGrammarPattern` (`repository.ts`) dropped its
    `getSentenceFullReviewReadiness` call, mirroring
    `pickContextSentenceForVocabularyItem` exactly (just needs a linked
    sentence, no requirement on the rest of that sentence's vocabulary).
  - **`GrammarCompletionCard` rebuilt** (`ReviewPage.tsx`): the target
    sentence's English translation is now always visible — the input
    signal for picking the right construct, before choosing, not gated
    behind reveal — and the sentence is framed by its reading-order
    passage context (before untranslated always, after translated only
    post-reveal), same convention `ReadingInContextCard` uses. New
    `getReadingContextForSentence` (`repository.ts`) resolves this per
    pattern with bounded per-sentence queries rather than the shared
    scope-wide context map, since grammar patterns are global-scope and
    can reference a sentence from any book.
  - `GrammarPicker`'s "Track" seeds only `grammar_completion` now (was
    seeding `grammar_comprehension` + `grammar_completion` together).
  - Learner-state ladder (`grammarPatterns.ts`) back to 3 rungs
    (encountered/noticed/recognized) — `recognized` now reads FSRS
    proficiency off `grammar_completion` instead of the retired
    `grammar_comprehension`.
  - `scripts/retire-non-completion-grammar-items.ts` soft-deleted the 3
    non-`grammar_completion` study items across the 2 tracked patterns —
    both patterns' `grammar_completion` items (`reps`/`due`/`lapses`)
    verified unchanged afterward; `sentence_grammar`/`grammar_patterns`
    rows untouched throughout both passes.

- **2026-09-14 — "Reimport" buttons on `BookDetailPage`** (user ask: find
  a source's URL then be taken straight back to its import page). A plain
  mined-video book (`sourceKey` starting `shadowing:source-`) gets a
  book-level "Reimport" linking to `/import/youtube?url=<sourceUrl>` — the
  existing "Mine again" flow on that page already handles the actual
  re-mine once the URL is prefilled. A series book (NHK Easy News, or a
  podcast under `shadowing:podcast-series-*`) gets a per-chapter
  "Reimport" instead, since the book is shared across many episodes/
  articles: NHK links to `/import/nhk-easy?feedUrl=<fixed feed>`, podcast
  links to `/import/youtube?podcastFeedUrl=<book.sourceUrl>&q=<chapter
  title>`. Both target pages now read those query params on mount
  (`useSearchParams`) to prefill the URL/feed field and, for a feed,
  auto-load it (cheap GET) — episode/article picking stays a manual click
  so nothing auto-starts a real mining job unexpectedly; the already-
  existing "Imported" pill (matched by the feed item's own URL against the
  stored chapter `sourceId`) plus the prefilled search term make the
  right one easy to spot. `YouTubeMinePage`'s podcast `<details>` section
  auto-opens when arriving this way. No schema changes — both `sourceUrl`
  (plain video, podcast series) and per-chapter `sourceId` (episode/
  article identity) were already persisted by `commitShadowingPackageImport`/
  `commitSeriesEpisodeImport`.

- **2026-09-14 — Word-alone vs. word-in-phrase pitch warm-up** (roadmap
  "Real-audio pitch-perception bridge," exercise 1). Heiban (no downstep)
  and odaka (downstep right after the word) have an identical contour
  *within* the word — the only audible cue is whether the following
  particle stays high or drops. The `pitch_accent` SRS card now shows an
  ungraded warm-up (`PitchWordPhraseWarmup`) for exactly those two edge
  cases: loop the word alone, loop word+particle, then self-check "stays
  high or drops" before answering the real graded question below. Gated to
  render only when forced alignment resolves both spans (silent no-render
  otherwise, same degrade pattern as `SegmentLoopPlayer`'s `wordOnly` mode).
  `isolatedWordRange.ts` gained `isolatedWordSpans` (returns `wordOnly` +
  `withParticle` instead of picking one); `SegmentLoopPlayer`'s blob-fetch
  and loop/retry logic were extracted into `useSentenceAudioBlob`/
  `useRangeLoop` (`src/hooks/`) so the warm-up can loop two independent
  spans of the same clip without duplicating the Safari retry handling —
  pure internal refactor, `SegmentLoopPlayer`'s three existing callers are
  unaffected. Verified in a real browser session (seeded heiban/odaka/
  nakadaka cards directly into Dexie): warm-up renders and self-checks
  correctly for heiban/odaka, is absent for nakadaka, doesn't disturb the
  graded flow. Exercise 2 (near-minimal-pair ABX) remains open.

- **2026-09-14 — `alignAudioDetailed` distinguishes "service unreachable"
  from "service reached but declined this take" (user report: the
  pitch-accent drill said "couldn't reach the alignment service" while
  `AnalysisPanel` aligned fine minutes later — the service was up the whole
  time; MFA's beam search was failing on that specific isolated-word clip
  and returning 500, which the old `alignAudio` collapsed into the same
  `null` as a genuine network failure).** New `alignAudioDetailed` in
  `src/lib/analysisApi.ts` returns `{ result, reason? }`, `reason` being
  `'unreachable'` (fetch itself failed/timed out) or `'rejected'` (got a
  response — non-2xx, or a 2xx that didn't parse/shape-check). Plain
  `alignAudio` (used by `alignmentCache.ts`) is now a thin wrapper, unchanged
  behavior. `PitchAccentDrillPage`'s `AnalysisState` threads the reason
  through to `PitchAccentFeedback`, which now shows a distinct message for
  "this take's alignment failed, try recording it again" vs. the original
  "can't reach the server" copy. Root cause of the 500s themselves (MFA's
  beam=10/retry_beam=40 failing on short isolated-word audio) lives in the
  sibling `shadowing-analysis-api` repo, not fixed here. `tests/analysisApi`
  +5.

- **2026-09-14 — Kana ruler under `AnalysisPanel`'s pitch contours now
  spreads one label per mora instead of one per forced-alignment word
  (user ask: "could the hiragana mora be spread out to reflect where they
  were actually voiced, so I can see where I'm saying a mora too long/
  slow").** `buildKanaTimeline` (`src/lib/kanaTimeline.ts`) still decides
  *which* morae belong to which aligned word via the existing
  audible-character-count proportion (unchanged, still the cross-
  tokenization approximation from 2026-09-07 below), but now sub-divides
  each word's own `[start, end]` span across its morae using that word's
  own `phones` sub-alignment (already returned by the forced-alignment
  service, previously unused): each mora claims a proportional slice of
  phone-index space (`phones.length / moraCount`), with real time coming
  from linear interpolation between actual phone boundaries. Phone count
  and mora count aren't equal in general (gemination/long vowels collapse
  two morae onto one shared phone in MFA's output), so this is still an
  approximation, but unlike an even word-internal split it lets a
  learner's actual drawn-out mora show up as a wider label — an even split
  can't show that at all, which was the point of the ask. One-mora words
  and words with no phone data fall back to the prior single-label
  behavior. `tests/kanaTimeline` +2.

- **2026-09-14 — Fix `SegmentLoopPlayer`'s native-audio loop stalling after
  one play-through.** Third report in the same triage session: "the loop
  native word is only doing one play through" — a genuinely different bug
  from the two pitch_accent fixes above/below, this one in the shared
  loop primitive itself (`playLoopedRange`, src/lib/recording.ts), so it
  affects every caller (`pitch_accent`'s and `word_listening`'s native-word
  loop, both via `SegmentLoopPlayer`). Root cause: `onTimeUpdate` only
  rewound when `audio.currentTime` crossed the *requested* `endMs` — with
  no clamp against the clip's actual duration. `isolatedWordRange`
  (src/lib/isolatedWordRange.ts) adds a flat, unclamped `+120ms` tail pad
  to the isolated word's end (deliberately, to include the trailing
  particle/mora that disambiguates heiban/odaka by ear) — for a word whose
  isolated span sits near the very end of the clip, that pad can push the
  requested end past the audio's real length. `currentTime` can then never
  reach it: playback just runs off the end of the file, the browser's own
  `ended` fires with nothing listening for it (no `ended` handler existed),
  and `playLoopedRange`'s promise never resolves — the loop button stays
  stuck saying "Looping…" having played exactly once, needing a manual
  stop click to recover (matches the report, and likely explains the odder
  half of it too — a stuck loop interacting with `SegmentLoopPlayer`'s own
  Safari-blob retry path is a plausible route to the "first click nothing,
  then plays the whole sentence" follow-up the user also described, though
  that half wasn't independently reproduced). Fix: `onTimeUpdate` now
  clamps its crossing check to `Math.min(endSec, audio.duration)` when
  `duration` is a finite number, and a new `ended` listener triggers the
  same rewind as a fallback regardless of what caused native playback to
  stop. Two new tests in `tests/recording.test.ts` (duration-clamped
  crossing; rewinds off `ended` with no `timeupdate` crossing at all) plus
  the existing loop/rewind/cancel/rate tests all still green. Full
  1444-test Vitest suite + typecheck + oxlint green. **Not browser-verified
  against the user's exact repro** (no live reproduction environment in
  this session) — ask the user to re-test both the plain "loops
  indefinitely" case and the whole-sentence-then-loop sequence and report
  back if either still misbehaves.

- **2026-09-14 — Fix pitch_accent native-audio loop stopping mid-word for
  -masu (and other multi-morpheme conjugated) occurrences.** User follow-up
  to the same triage session as the `createdAt` fix below: on re-reading the
  card_issue_e9445133 report ("cut off at いい and left off the ました") the
  user pointed out the card *tests* the full conjugated word (言います), not
  the bare stem — so "cut off" wasn't the intended isolate-just-the-word
  design after all, it was really isolating the *wrong* span. Root cause:
  `resolveInflectedPitchAccent` (src/lib/pitchAccentShift.ts) already
  resolves the correct -masu-family reading (`いいます`, 5 morae, accent
  shifted per the fixed ます offset) via `findInflectedSurfaceInSentence`
  falling back off the raw `identifyConjugationForm` miss on the truncated
  stored surface — but it discarded the resolved *surface* (`conjugated.
  expression` = 言います) and every caller kept using the input
  `occurrence.surfaceForm`, which is whatever `sentence_vocabulary.
  surfaceForm` happened to store (here: `言い`, the bare stem before ます).
  `ReviewPage.tsx`'s `buildPitchAccentCandidate` then isolates/highlights
  off that truncated surfaceForm, so `SegmentLoopPlayer`'s forced-alignment
  loop (via `isolatedWordRange`) stopped right after いい — correct for
  what it was told to isolate, wrong word. Fix: `ResolvedPitchAccent` gained
  a `surfaceForm` field (the full citation expression or the full
  `conjugated.expression`, not the input); all four call sites now use it —
  `ReviewPage.tsx` (pitch_accent card audio isolation + target highlight),
  `AnalysisPanel.tsx` and `repository.ts`'s `getSentencePitchAccentTargets`/
  `getPitchAccentDrillSentences` (ambient H/L marks + drill sentence prep,
  same latent bug, not yet reported but same root cause). New
  `resolveInflectedPitchAccent surfaceForm` describe block in
  `tests/pitchAccentShift.test.ts` pins the exact 言う/言います scenario from
  the report. Full 1442-test Vitest suite + typecheck + oxlint green.
  **Not yet browser-verified** — no way to reproduce the learner's specific
  card session from here; the fix is confirmed by the new unit test
  reproducing the resolver's actual (wrong→right) output for this word, not
  by re-clicking through the review UI.

- **2026-09-14 — Sweep stale no-diff conflicts every sync cycle.** Two new
  "Report sync issue" reports (`sync_issue_a0716156-…`,
  `sync_issue_6675650d-…`) both said "the diff doesn't show a difference" on
  `reviews` conflicts — and both conflicts' `createdAt` predated the
  same-day `createdAt`-noise fix below (2026-09-08, 2026-09-12, 2026-09-04
  vs. the fix landing 01:18 that day). That fix only changed what
  `handlePushConflict` decides for *new* `version_conflict`s going forward;
  a conflict already sitting in the local `syncConflicts` Dexie table from
  before the fix landed is never re-evaluated, so it stays open forever even
  after `ConflictPanel`'s diff view catches up and starts rendering it as
  "No field-level differences" — a conflict card with nothing left to
  decide, which is exactly what confused both reporters. Added
  `sweepNoopConflicts` (`src/sync/queue.ts`): re-runs `conflictContentsMatch`
  against every open conflict's already-frozen `localPayload`/`remotePayload`
  and auto-resolves (`resolution: 'auto_noop'`, new `SyncConflict.resolution`
  member) any that now match. Called once per `runSyncCycle`
  (`src/sync/engine.ts`), after `pullChanges`. Typecheck + `src/sync` Vitest
  green. The two reporters' specific stale conflicts still need one
  in-app sync cycle on their own device to clear (no server-side conflict
  store to sweep from a script — same Dexie-only caveat as the entry
  below); tell them to open the app once online and the cards should
  disappear on their own, then mark both sync issue reports resolved in
  Card Issues.

- **2026-09-14 — Fix spurious `createdAt` noise on `reviews` sync
  conflicts.** Root-caused from a user "Report sync issue" (§7 of
  `.claude/skills/card-issue-triage`): "missing a remote createdAt date".
  `Review` (domain/types.ts) has no `createdAt` field — only `timestamp` —
  but `reviewToRemote` (src/sync/mappers.ts) copies `timestamp` into the
  remote row's `created_at` column purely to satisfy the table schema.
  `ConflictPanel`'s diff (`forDiff`/`conflictContentsMatch`,
  src/sync/conflictDiff.ts) had no way to know this was bookkeeping rather
  than a real field, so every `reviews` conflict showed a spurious
  remote-only `createdAt` line — and, more importantly, `conflictContentsMatch`
  (used by `handlePushConflict` in src/sync/engine.ts to auto-settle a bare
  CAS-mismatch with no actual content divergence) could never return `true`
  for `reviews`, so even a harmless race between two devices always
  surfaced as a manual conflict card. Fix: `forDiff`/`conflictContentsMatch`
  now take an optional `SyncEntity` and strip a small per-entity extra-keys
  table (`ENTITY_EXTRA_KEYS`, currently just `reviews` → `createdAt`) on top
  of the existing universal `SYNC_BOOKKEEPING_KEYS`; both call sites
  (`ConflictPanel.tsx`, `engine.ts`'s `handlePushConflict`) now pass
  `conflict.entity`/`item.entity`. New regression test in
  `conflictDiff.test.ts`. Full 1440-test Vitest suite + typecheck + oxlint
  green. `addConflict` (src/sync/queue.ts) writes conflict rows to local
  Dexie only, not Supabase, so the reporter's specific open conflict
  (`sync_issue_d4f8988e-cfa1-4f6c-9fb2-d76b48a5eaca`, `review_f68e6482-…`)
  isn't inspectable from a script — the fix stops the spurious `createdAt`
  line going forward, but whether that conflict card still has a real diff
  underneath (and so still needs a manual keep-local/keep-remote) can only
  be seen in-app on the reporter's own device.

- **2026-09-13 — Difficulty screening checkpoint** (docs/ROADMAP.md,
  "Podcast mining" item 5, promoted to Done). A rough "looks beginner/
  intermediate/advanced" readout, computed once and shared across every
  mining path rather than copied per pipeline:
  `server/youtube-mining/app/difficulty.py`'s `score_difficulty` scores
  content-word JMDict-common ratio + average sentence length (+ morae/
  second when a duration is available), classified by a hand-picked (not
  corpus-tuned) threshold table. JMDict's "common" flag only lives on the
  Node/TS side (`scripts/lib/jmdict.ts`) and tokenization only runs in this
  Python service, so `scripts/generate-common-words-asset.ts` (new
  `npm run generate:common-words-asset`) flattens every common kanji/kana
  spelling into a committed asset (`server/youtube-mining/app/data/
  common_words.json`, 38,360 entries, ~500KB) the Python side loads
  (`app/common_words.py`). Two call sites: a new stateless
  `POST /difficulty` endpoint (same no-job pattern as `/resegment` /
  `/validate-transcript`) scores the wizard's current, possibly hand-edited
  Transcript-stage text — `TranscriptStage.tsx` gained a "Check difficulty"
  button + `DifficultyBadge` readout, reused as-is by both YouTube and
  podcast mining since they share the component; and `_nhk_easy_import_sync`
  computes it inline from the `tokens` each `NhkEasySentenceResult` already
  carries (no second tokenize pass), attached to `NhkEasyImportResponse` and
  shown on `NhkEasyImportPage`. 13 new Python tests (scoring logic,
  sentence-splitting incl. the decimal-point guard, the common-word lookup,
  the API endpoint) + full 143-test backend suite green; frontend typecheck
  + full 1439-test Vitest suite green. Verified live against the real
  `youtube-mining-api` service (restarted after confirming `GET /jobs` had
  no in-flight job — all three listed jobs were `error`-terminal):
  `POST /difficulty` against a plain sentence scored 100% common/beginner,
  a sentence with several literary/formal words (独白, 不条理, 痛感) scored
  82% common/intermediate — a real illustration of the heuristic's known
  ceiling (JMDict's "common" flag is broader than "beginner-friendly," so a
  formal-register sentence can still read as easier than it is; acceptable
  for a "should I abandon this" screen, not a calibrated placement test).
  **Not browser-verified** — this host has no browser libs installed
  (`libnspr4.so` missing) and no sudo; Docker was viable in an earlier
  session but felt disproportionate for an additive read-only badge, so
  this shipped on typecheck + the full test suite + a direct curl against
  the live service instead of a screenshot. **Manual test plan:** open the
  YouTube-mining wizard, get to the Transcript stage (paste a URL or resume
  a job), click "Check difficulty" — expect a short readout line ("Looks
  intermediate — NN% common vocabulary, avg N.N words/sentence, N.N
  morae/sec") to appear within a couple seconds, or a red error line if the
  mining service is down. Separately, import any NHK Easy article
  (`/import/nhk-easy`) and confirm the same readout appears under the
  sentence count line once the article loads — no extra click needed there,
  since the score comes back with the import response.

- **2026-09-13 — Fixed "Apply & segment" re-splitting AI-curated sentence
  boundaries, a second and distinct bug behind the same "segments seemed to
  revert" report.** The earlier same-day fix (decimal points) turned out not
  to be the whole story. User's follow-up repro, job #1556「田舎日記①」:
  pasted a "Segment with AI help" reply that deliberately keeps
  "しゃっ！今日は田舎日記。" (an interjection folded into the next clause)
  on one `[0:01]`-tagged line, and "Apply & segment" still split it into
  "しゃっ！" + "今日は田舎日記。" — the app was ignoring the curated
  boundary. Root cause: `applyAndSegment()` always called `applyJobSegments`
  with its default options, which run `resegment.py`'s generic
  `split_multi_sentence_cues` merge/split heuristic on the transcript before
  showing it in the Segment stage. That heuristic is meant for *raw*,
  uncurated ASR fragments — it has no way to know a boundary was already
  reviewed and finalized rather than left mid-sentence by chance. Fixed by
  tracking a new `aiSegmented` flag (`YouTubeMinePage.tsx`), set the moment
  "Apply pasted sentences" replaces the transcript
  (`TranscriptStage`/`AiSegmentHelp` gained an `onAiSegmentsApplied`
  callback for this) and cleared on `reset()`; `applyAndSegment()` now calls
  `applyJobSegments(jobId, segments, { merge: false, split: false })` when
  the flag is set, trusting the reviewed transcript exactly — the same
  "annotate-only" mode already used elsewhere (lyrics/manual resegmentation)
  for content whose boundaries shouldn't be second-guessed. Going back to
  Transcript and re-pasting still works the same way each time. 1 new test
  reproducing the exact しゃっ！ case end-to-end (paste → apply → segment
  stage keeps one row, not two). Typecheck, full suite (1434), and
  production build all clean.
- **2026-09-13 — Podcast episode picker gained pagination + a title
  search, follow-up to the same-day sort toggle.** User feedback: a
  newest/oldest toggle alone still leaves 770 episodes to scroll through 30
  at a time with no way to reach the middle. Added `podcastFeedPage` (Back
  →/Forward → over `PODCAST_PAGE_SIZE` = 30-episode pages, page count
  computed from whatever the current sort + search have narrowed the list
  to) and a plain title-substring search box (case-insensitive, no
  pagination while active — just shows every match, since a search has
  presumably already narrowed things down). Page resets to 0 whenever the
  sort, the search text, or the loaded feed itself changes, so it can never
  point past the end of a freshly-narrowed list. Typecheck, full suite
  (1433), and production build all clean; no dedicated test for this one
  (page-count/slice arithmetic over already-tested sort logic) per this
  repo's manual-test-plan convention for lower-risk UI additions.
- **2026-09-13 — Podcast episode picker gained a "Newest first / Oldest
  first" sort.** A show with a long backlog (checked live: 770 episodes for
  one recommended show) is ordered newest-first by RSS convention, and the
  picker's own latest-30 cap made a host's own "start from my earliest
  episodes, I spoke slower back then" advice completely unreachable — no
  way to get there. Also found (same live check) that a show's own
  "seasons" don't necessarily correspond to a clean `itunes:season` RSS
  tag — this one's early years are simply untagged, mixed in with an
  ongoing untagged side-series, so a season-number filter wouldn't have
  reliably found "the beginning" either; sorting chronologically oldest-
  first does. `YouTubeMinePage.tsx` gained a `podcastFeedSort` toggle;
  the same latest/oldest-30 slice just runs over a reversed array when
  "Oldest first" is selected. Typecheck and full suite green (1433);
  no dedicated test added for this one (a plain array reverse), per this
  repo's manual-test-plan convention for lower-risk UI toggles.
- **2026-09-13 — Fixed the mining wizard's "Apply & segment" silently
  fragmenting decimal numbers, and made a stuck/failed step visible without
  scrolling.** User report: used "Segment with AI help" to clean up a
  transcript, went back to Transcript to double-check it, and the segments
  "seemed to revert." Two real, separate bugs found:
  1. `resegment.py`'s `split_multi_sentence_cues`/`merge_incomplete_cues`
     (used by every "Apply & segment" call, not just NHK Easy) treats a
     bare `.` as always sentence-final — the exact same bug class found and
     fixed earlier today in `app/nhk_easy.py`'s own splitter, never
     back-ported here. A sentence like "売り上げが1.5倍になりました。" got
     fragmented into "...1." + "5倍になりました。" the moment it was
     resegmented, which is exactly what an AI-cleaned, already-correct
     transcript would look like "reverting" to. Fixed the same way: a
     digit-flanked `.` is protected (swapped for a private-use placeholder,
     restored after) before either regex runs. Verified live against the
     running service, not just unit tests. 2 new tests; the equivalent
     cross-cue-boundary case (a decimal point that happens to fall exactly
     at a caption-cue split) is *not* fixed — would need lookahead into the
     next cue, a rarer case not worth the complexity right now.
  2. `YouTubeMinePage`'s busy/error status only ever rendered once, at the
     very top of the page — invisible without scrolling back up once
     working through Transcript/Segment/Translate, which have their own
     content below. A failed "Apply & segment" (from bug 1, or anything
     else) looked like the button did nothing. Each stage's own button row
     now shows the same busy/error line locally. Also: `resumeJob`'s catch
     block and the auto-reconnect-on-mount effect both showed a generic
     "may have expired" guess regardless of the real cause (network error,
     404, schema mismatch) — now shows the actual error message, so a
     future recurrence is diagnosable instead of a dead end. 1 new test.
  Full backend suite green (130), frontend suite green (1433), typecheck
  and build clean.
- **2026-09-13 — Podcast episodes and NHK Easy articles now land in one
  shared book per series, chapters kept chronological.** User request,
  after using both flows for the first time today: importing episode by
  episode was creating a whole new book per episode/article, which doesn't
  scale for a podcast with hundreds of episodes or a growing NHK Easy
  habit. New `commitSeriesEpisodeImport` (`src/db/repository.ts`) looks up
  the book by a series-level `sourceKey` (one per podcast feed, one fixed
  key for all of NHK Easy) instead of per-episode, adds each import as its
  own chapter, and cascades a new `BookChapter.sourceDate` field into
  `bookSentences.position` so chapters — and their sentences — stay in
  publish-date order even if episodes are clicked out of order. Chapters
  dedup by a new `BookChapter.sourceId` (the episode's own source id, not
  its title, which can change or collide) so re-importing an episode
  updates its existing chapter instead of duplicating it.
  `ShadowingPreviewCard` gained an `onCommit` override so
  `YouTubeMinePage`'s podcast branch and `NhkEasyImportPage` route through
  this instead of the original one-book-per-source path (still used
  unchanged for plain YouTube videos and `.shadowing.zip` uploads). 4 new
  repository tests, full suite green (1430). Deliberately scoped down from
  "bulk-import a whole feed automatically" (real cost/throttling concerns
  for a 1000+-episode podcast) — still one click per episode/article, just
  landing in the right shared place now. Detail + the one known gap
  (books already created under the old per-episode scheme aren't
  retroactively merged) in `docs/ROADMAP.md`.
- **2026-09-13 — NHK Easy import v1 complete: wizard UI + vocabulary
  tokens, closing out the day's feature.** Final piece after the
  text-extraction and forced-alignment work below: `NhkEasyImportPage.tsx`
  (`/import/nhk-easy`) — feed URL → article picker → one
  `POST /nhk-easy/import` call (no job/polling/ASR, the text is already
  known-correct) → "Auto-fill translations (AI)" (calls
  `realignTranslations` directly, one group per sentence) → the same
  `ShadowingPreviewCard` commit step the YouTube-mining wizard already
  ends on. `PodcastEpisode` gained `descriptionHtml` (an nhkeasier.com
  item's furigana body — a real podcast never has this) so the existing
  `/podcast-feed` endpoint feeds the picker directly, no parallel endpoint.
  `NhkEasySentenceResult` gained UniDic `tokens`
  (`morphology.tokenize_japanese`) so the vocabulary picker gets
  suggestions the same way YouTube-mined sentences do — but the committed
  `inlineReading` stays NHK's own authoritative furigana (overwritten
  after `buildShadowingPreview` runs, since that function otherwise
  re-derives it from tokens) and the plain-kana `reading` field is
  likewise derived from that furigana rather than left blank. 23 new
  backend tests + 6 new frontend tests across the day's three commits, full
  suites green (128 backend, 1426 frontend), production build clean.
  Verified live end-to-end on a fresh, previously-untested article: 9 real
  sentences, real audio, correct furigana, real vocabulary tokens, all in
  one pass. Not yet manually clicked-through in a browser — see
  `docs/ROADMAP.md`'s entry for the manual test plan.
- **2026-09-13 — NHK Easy import: forced-alignment pipeline built and
  deployed, blocked on one cross-service decision.** Follow-up to the same
  day's text-extraction work (below). Built `app/align_client.py` (calls
  `shadowing-analysis-api`'s `POST /align`), `assign_sentence_spans()` in
  `nhk_easy.py` (maps its word-level output back onto sentence boundaries),
  and `POST /nhk-easy/import` (`main.py`) wiring parse → fetch audio →
  align → cut clips (`clip.py`) → degrade to text-only on any failure.
  Deployed and verified against two different held-out real articles end
  to end, not just unit tests. Two more real bugs found this way (on top
  of the decimal-point one from the parsing pass): (1) sentence-final `。`
  is never itself a spoken word, so targeting a sentence's full length
  overshot into the next sentence's first match — fixed by targeting the
  last non-punctuation character instead; (2) real prose embeds quoted
  titles/reported-speech *mid*-sentence, and treating `」`/`』` as
  sentence-final (inherited from `subtitles.py`'s ASR-tuned char set) cut
  88 of 471 real sentences (19%) apart at the bracket — fixed with a
  narrower, NHK-Easy-specific `SENTENCE_END_CHARS`. 23 tests total, full
  backend suite green (127). **Found a real blocker, not implemented
  around yet**: `shadowing-analysis-api`'s `/align` rejects any transcript
  over 200 characters (`ANALYSIS_MAX_TRANSCRIPT_LENGTH`), and 80% of the
  real 50-item nhkeasier.com corpus exceeds that once joined into one
  whole-article transcript — most real articles currently fail the audio
  half (still import fine as text-only). The fix (raise that env var) means
  editing a separate, already-live production service that also backs
  real-time shadowing-practice grading on the same memory-constrained box —
  flagged for the user rather than changed silently. Full detail in
  `docs/ROADMAP.md`.
- **2026-09-13 — NHK Easy import: original plan invalidated by checking
  live, corrected plan found and the first real module built.** Started
  from the morning's ROADMAP plan ("scrape NHK Easy directly, crib parsing
  from `nhk-easy-api`/`nhkeasy`") — verifying it against the live site
  first (rather than building against a stale assumption) found NHK's own
  News Web Easy site has been rebuilt as a `news.web.nhk` Next.js SPA
  (part of the new "NHK ONE" platform): `www3.nhk.or.jp/news/easy/`
  redirects there, article content isn't in the initial HTML at all, and
  its `api.web.nhk` backend 403s unauthenticated. The cited OSS scrapers
  target the old static-HTML-era site and no longer apply — direct NHK
  scraping is dead. Found instead: **https://nhkeasier.com**, a third-party
  site already republishing NHK Easy articles for learners as a standard
  RSS feed (confirmed live, 50 items) — each item is the exact same shape
  the morning's podcast-mining `podcasts.py` already parses (title,
  pubDate, an `<enclosure>` audio URL — hosted on nhkeasier.com, pointing
  at the real NHK narration) **plus** a `<description>` carrying the full
  article body as `<ruby>漢字<rt>かな</rt></ruby>` HTML, which a real
  podcast never has. This reframes the feature entirely: not a bespoke
  scraper, but the existing podcast RSS path plus one new module that pulls
  already-correct text out of the description instead of transcribing
  audio. Built that module: `server/youtube-mining/app/nhk_easy.py`
  (`parse_nhkeasier_description`) converts ruby spans to this app's
  `漢字[かな]` `inlineReading` format and splits into sentences — 7 unit
  tests plus a dry run against the *entire* live 50-item feed (471
  sentences, zero errors after one fix). That full-corpus dry run (not the
  unit tests) caught a real bug the unit tests' hand-picked fixture didn't:
  NHK Easy articles routinely report measurements like `350.5ミリ`/`36.5度`,
  and splitting on `.` (a legitimate sentence-end character elsewhere in
  this codebase, e.g. `subtitles.py` for ASR/caption text) cut those
  mid-number — `_is_decimal_point` now guards a `.` flanked by digits on
  both sides. Full plan + what's still not built (the forced-alignment
  integration, wizard UI, translation step) in `docs/ROADMAP.md`.
- **2026-09-13 — "Ready to read" per-book vocabulary-coverage scoring +
  sort, closing the first two steps of the promoted ROADMAP item.**
  `src/lib/bookCoverage.ts` (`buildBookCoverage`, pure, 8 tests) answers
  "what fraction of this book's confirmed vocabulary do I already know" by
  reusing the exact same primitives `isSentenceReadyForFullReview` is built
  from (`getReviewableVocabularyItemIdsBySentence` /
  `getProficientVocabularyItemIds`) — no new proficiency concept, same
  "known" as everywhere else. `getBookVocabularyCoverage()`
  (`src/db/repository.ts`) batches this once across every book, same
  one-pass convention as `getBlindSpots`. `BooksPage.tsx` shows "~NN% known
  vocabulary (X/Y words)" (or "Vocabulary not confirmed yet" for an
  unanalyzed book — a `null` ratio, deliberately not 0%) per book, plus a
  "Recent" / "Easiest first" sort toggle; easiest-first always sorts
  unanalyzed books last regardless of ratio. Per-chapter breakdown and
  feeding the session planner's `continue_book` ranking are deferred — see
  `docs/ROADMAP.md`. Not yet browser-verified (no existing `BooksPage` test
  file to extend; the underlying pure function is fully unit tested,
  following the same convention as `getBlindSpots`) — manual test plan in
  the ROADMAP entry.
- **2026-09-13 — Fixed a translation-shift data-corruption bug in "Auto-fill
  translations (AI)" (user report during a live podcast mine: "they're
  shifted down by 1").** Root cause, in the `sentence-realign` Edge Function
  (`supabase/functions/sentence-realign/index.ts`): the client
  (`buildMiningRealignGroups`) maps each sentence row to a "group" and
  applies the AI's reply back onto rows by plain array **position**
  (`result.groups[assignment.groupIndex]`), with no id echoed back to
  re-associate by. The Edge Function used to silently drop any group whose
  piece(s) were blank/whitespace-only (`.filter((group) => group.pieces.length
  > 0)`) before calling the model — so a single blank/near-silent row (common
  in ASR output) shrank the reply array by one, and every group *after* it
  silently landed on the wrong row for the rest of the batch. Separately, the
  function's `MAX_GROUPS = 60` cap was enforced with a plain `.slice(0, 60)`
  and no signal back to the client, so a mined source with more than 60
  sentences (routine for a podcast episode — the triggering case had 162)
  got its rows 61+ silently left untranslated with no error. Two-part fix:
  (1) the Edge Function now keeps every input group's *position* in the
  response regardless of content — blank groups get re-expanded back onto
  their original slot instead of being dropped, so one blank row can no
  longer shift anything after it; (2) `realignTranslations`
  (`src/lib/sentenceRealign.ts`) now chunks any request into batches of ≤60
  groups (mirroring the server's own cap) so a long source's rows all
  actually get sent, and validates every batch's reply length against what
  was sent — a mismatch now fails the whole call loudly (`ok: false`)
  instead of ever being applied positionally. 5 new tests
  (`tests/sentenceRealign.test.ts`) lock in both the chunking and the
  strict length-parity refusal, reproducing the exact 162-group shape that
  triggered the incident. **Needs a manual deploy step this session
  couldn't perform** (no `SUPABASE_ACCESS_TOKEN`/`supabase login` available
  on this box): run `supabase functions deploy sentence-realign` before this
  fix takes effect in production — until then, the client-side chunking +
  strict validation already prevent the *silent corruption* (a mismatch now
  errors instead of misapplying), but large batches will still error out
  rather than succeed against the old server code. The user's in-progress
  162-row podcast mine was not committed with the bad translations; re-run
  "Auto-fill translations (AI)" after the Edge Function is redeployed.
- **2026-09-13 — Podcast mining: RSS feed parsing, episode picker, and
  real-title wiring, verified live end-to-end against production.**
  Discovered mid-session that this dev sandbox *is* `codex-dev`, the box
  `youtube-mining-api.service` actually runs on (same checkout, same
  `.venv`) — so this was validated against the live service, not just unit
  tests. Added: `server/youtube-mining/app/podcasts.py`
  (`parse_podcast_feed`/`fetch_podcast_feed`) + `POST /podcast-feed`;
  `fetchPodcastFeed` in `src/lib/miningApi.ts`; a collapsible "Or import a
  podcast episode" section on `YouTubeMinePage.tsx`'s idle screen (feed URL
  → episode list, capped at the latest 30 — some feeds run 1000+ episodes —
  → tap one to mine it). `SourceInfo.type` widened from
  `Literal["youtube"]` to `["youtube", "podcast"]`; `CreateJobRequest`
  gained `title`/`sourceType`, threaded through `create_job` →
  `Job.title_override`/`source_type` (checkpointed, survives a mid-job
  restart) → applied onto `SourceInfo` once `info_to_source()` builds it —
  so a podcast-sourced book gets the real RSS episode title instead of
  yt-dlp's filename-derived one. Verified against the running service: no
  jobs in flight, restarted `youtube-mining-api.service` to pick up the
  code, then ran a real ~9:26 Nihongo con Teppei episode through the full
  pipeline live — no captions found (podcasts never have them), ASR
  fallback engaged as designed, produced real sentence cues, and the
  resulting source carried the correct `type: "podcast"` + real title. See
  `docs/ROADMAP.md` "Podcast mining" for the full plan and remaining steps
  (long-episode ASR headroom, the difficulty-screening checkpoint,
  `alreadyMined`'s cosmetic YouTube-only dedup gap).
- **2026-09-13 — Fixed word-audio range editor drag handles on wide screens
  (two user reports: "can't adjust the right side... it collapses the left
  side in to the end", "waveform not showing").** Root cause:
  `WordAudioRangeEditor`'s `<svg>` uses a `viewBox` of `600×88` with a CSS
  width of `100%` and no `preserveAspectRatio` override, while
  `msForClientX` maps pointer position to milliseconds by dividing by the
  rendered box's full `getBoundingClientRect().width`. The app's content
  column is up to 720px (`--content-max`), wider than the 600 viewBox units,
  so the default `xMidYMid meet` scaling letterboxes the drawn waveform
  horizontally on any screen past ~600px — the box is wider than what's
  actually drawn, so dividing by the full box width maps every drag to the
  wrong millisecond, worst near the edges where a handle drag would look
  like it snapped or dragged the other handle instead. Fixed by adding
  `preserveAspectRatio="none"` so the svg always stretches to fill its box
  exactly, matching what the JS math already assumed. `BoundaryWaveform.tsx`
  (the mining re-segmentation boundary editor) has the identical
  `viewBox`/`msForClientX` pattern and got the same fix pre-emptively, even
  though no report has come in against it yet. `LiveShadowWaveform.tsx`
  shares the viewBox pattern but isn't draggable, so it's unaffected. The
  "waveform not showing" half of one report is not explained by this and
  is still open — ask the reporter for browser/device details if it
  recurs after this fix.
- **2026-09-13 — Fixed extra-practice auto-exit in the pitch-accent drill
  (user report: "exits immediately after it displays the analysis, I don't
  even have time to see it").** Root cause: in focus mode (`/pitch-accent`,
  "Extra practice"), `activeWords` tracked the live `getPitchAccentFocusWords`
  query directly; logging a take (`logPitchDrillAttempt`) writes to
  `pitchDrillAttempts`, which the query watches, so it immediately reran and
  dropped the just-practiced word out of the list — shifting whatever word
  sat at the same `position` into view, which looked like an instant,
  uncontrollable advance and wiped the analysis panel via the
  `currentId`-keyed reset effect. Fix: `PitchAccentDrillPage.tsx` now snapshots
  the focus queue into `focusSession` state once when focus mode is switched
  on, instead of reading the live query on every render; the queue no longer
  changes underneath the learner mid-session, so they can re-record and
  review the same word as many times as they like, and only advance via the
  existing manual Previous/Next buttons. A fresh queue is drawn the next time
  extra practice is started.
- **2026-09-13 — Per-word te-form pitch-accent data, closing the
  `te_form`/`plain_past`/`tara_form` gap in `pitchAccentShift.ts`
  (user follow-up on the OJAD question: "can we get that data from
  Wiktionary directly?" — yes).** New `VocabularyItem.teFormAccentPosition`
  (migration `20260913000000_vocabulary_te_form_pitch_accent.sql`,
  nullable/additive, mirrors `pitchAccentPositions`'s own addition exactly
  — schema, Zod, sync mapper) stores the te-form's own downstep, sourced
  per-word since it can't be derived by formula: real data confirms 走って
  keeps 走る's citation downstep (mora 2) but 食べて *retracts* one mora
  earlier than 食べる's (mora 2 → 1) — two accented verbs, two different
  behaviors, exactly why this needed real data and not a rule.
  `pitchAccentShift.ts`'s `predictInflectedPitchAccentPosition` now takes
  an optional `teFormAccentPosition` input: when present, `plain_past`
  reuses it directly (て/で vs た/だ never changes mora count) and
  `tara_form` derives from it (heiban te → たら gains its own accent right
  before ら; accented te → carries straight through) — mirrors the
  already-shipped godan なかった derivation. Without it, all three forms
  keep returning `null` exactly as before — purely additive, no change to
  already-verified behavior.
  New `scripts/backfill-te-form-pitch-accent-wiktionary.ts`
  (`npm run backfill:te-form-pitch-accent-wiktionary -- [--apply]`) —
  a separate script from the citation-form backfill (different target
  set: confirmed godan/ichidan verbs that already have citation data but
  no te-form data yet, not "items with no accent data at all"). Sources
  the same Wiktionary page's "Extended conjugation" table's Conjunctive
  row, which — unlike the citation form — has no explicit
  "(Nakadaka – [N])" annotation; the downstep is only encoded
  structurally (a `<span style="border-top:...">` wraps the high-pitch
  span, and a nested empty `<span style="position:absolute;...
  border-right:...">` marks exactly which mora the drop lands after; no
  nested marker means heiban). Parsed from raw HTML (not the tag-stripped
  text the citation pattern uses, since the nesting must survive) via a
  bounded-depth regex plus `segmentIntoMorae` for the actual mora
  counting. Reuses the citation-form pattern purely to anchor position in
  the page and bound the search window per reading, so a multi-reading
  page (開ける: あける/ひらける/はだける) still resolves each reading's own
  Conjunctive row correctly — verified directly (ひらける's own te-form
  value differs from あける's and doesn't leak across). `parseKanaCellPosition`/
  `extractTeFormAccentPosition` exported and unit-tested
  (`tests/backfillTeFormPitchAccentWiktionary.test.ts`, 12 cases,
  synthetic HTML mirroring the real nested-span structure) independent of
  the network call.
  **Run against production 2026-09-13** (migration applied by hand via
  the Supabase Dashboard SQL editor, since this environment has no
  Supabase CLI/service-role credentials to apply DDL directly): of 134
  candidate godan/ichidan verbs, 96 matched and were written (including
  食べる at position 1, confirming the retraction case in production
  data), 1 had no Wiktionary page, 37 had no usable Conjunctive row.

- **2026-09-12 — Third-pass Wiktionary backfill for vocabulary items with
  no dictionary pitch-accent data at all.** New
  `scripts/backfill-pitch-accent-wiktionary.ts` (`npm run
  backfill:pitch-accent-wiktionary -- [--apply]`), run after the existing
  Kanjium (`backfill:pitch-accent`) and UniDic (`backfill:pitch-accent-unidic`)
  passes, against whatever's still blank. Fetches each item's live
  Wiktionary page and parses its Pronunciation section's accent citation
  (e.g. "はしる [hàshíꜜrù] (Nakadaka – [2])") — the same real data this
  session used to verify `pitchAccentShift.ts`'s formulas. Matches by the
  kana reading each accent entry is actually *for*, not just "any accent
  label on the page" — load-bearing, since one spelling can host several
  distinct Japanese words with different accents (開ける is あける,
  ひらける, and はだける, each separate); an earlier draft that only
  checked "how many distinct positions appear anywhere on the page" would
  have wrongly called 開ける ambiguous even though あける's own entry
  resolves cleanly. First script in this codebase to do per-page external
  HTML fetches (as opposed to one bulk download or batched internal-API
  calls) — sends a descriptive User-Agent and a 1.5s delay between
  requests, since Wiktionary is a shared community resource. Skips (never
  guesses) on no page, no accent-tagged entry for that reading, or more
  than one distinct position cited for that reading. Dry-run by default,
  same convention as the other two passes. `parseWiktionaryAccentHtml` is
  exported and unit-tested (`tests/backfillPitchAccentWiktionary.test.ts`,
  7 cases) independent of the network call. **Run against production
  2026-09-13**: of 196 items with no pitch-accent data, 60 matched and
  were written, 61 had no Wiktionary page, 65 had no accent-tagged entry
  for that reading, and 10 were correctly skipped as genuinely ambiguous
  (including known variable-accent words like 明日/あす and 難しい) — left
  for a hand check, not guessed. 141 items remain blank; the un-appliable
  ambiguous ones plus anything with no Wiktionary presence would need a
  different source (OJAD, or manual lookup) to close further.

- **2026-09-12 — Ambient pitch-accent display ("H/L marks" on shadowing
  pages, `AnalysisPanel`, the pitch-accent drill, and the `pitch_accent`
  card's own reveal) is now inflection-aware, matching the review card.**
  Every consumer previously sourced its per-word contour from
  `getVocabularyTargetCandidates` — dictionary reading only, regardless of
  whether the sentence's actual occurrence was inflected (the same class
  of bug `pitch_accent` had before this session, just never fixed for the
  ambient display). New `resolveInflectedPitchAccent`
  (`src/lib/pitchAccentShift.ts`) factors the citation-vs-inflected
  resolution logic out of `ReviewPage.tsx`'s `buildPitchAccentCandidate`
  into a shared pure function; new `getSentencePitchAccentTargets`
  (`src/db/repository.ts`) runs every occurrence in a sentence through it
  and drops (never misdraws) one outside the shift calculator's coverage.
  `SentencePitchAccentRow.tsx`, `AnalysisPanel.tsx`, and
  `getPitchAccentDrillSentences` all switched to it; `SyncedShadowText.tsx`
  needed no change (already `sentenceId`-driven through the row).
  Cleanup: removed the `sentence_transformation` exclusion for the ambient
  row (`ReviewPage.tsx`) — its inflected verb now renders correctly
  instead of being hidden outright — which also fixes a latent bug where
  the `pitch_accent` card's own reveal could show two disagreeing
  contours for the same word (the card's `PitchAccentDiagram` correct,
  the ambient row below it wrong) since both now share one resolver.
  New `tests/getSentencePitchAccentTargets.test.ts` (citation-form,
  supported-inflected, unsupported-inflected-dropped, no-accent-data-dropped).

- **2026-09-12 — `pitch_accent` inflected-occurrence support extended to
  ichidan verbs, i-adjectives, and the -masu family for godan/ichidan**
  (user follow-up: "are those [Wiktionary] pages useful for other parts of
  the app?" → yes; scoped and extended same day). `src/lib/pitchAccentShift.ts`
  now covers, all independently verified against Wiktionary's live-rendered
  `{{ja-acc-table}}` output for real words (走る/買う godan, 食べる/開ける
  ichidan, 高い/甘い i-adjective — see the module's doc comment and
  `fixtures/pitch-accent-shift-fixtures.json`, 26 rows):
  - `polite_present`/`polite_past`/`polite_negative` (godan + ichidan) —
    the simplest case: the -ます family's downstep is *class-independent*
    (only needs the stem's mora count, not whether the citation form is
    heiban or accented). `polite_past_negative` isn't built by
    Wiktionary's own module at all — stays excluded.
  - `plain_negative`/`ba_form` (ichidan) — same `ba_form` shape as godan,
    but `plain_negative` differs: an accented ichidan verb's negative
    downstep stays at the *unchanged* citation position, unlike godan's
    +1 shift. `plain_past_negative` isn't verified for ichidan yet — stays
    excluded rather than assumed.
  - `polite` (い-adjective 〜いです) — a full, clean, dual-branch formula.
  - `plain_negative`/`plain_past_negative` (い-adjective), **heiban only**.
    The accented case is excluded for a real reason, not just caution:
    real data for 高くない shows a genuine *two-accent* realization (the
    く-stem's own downstep plus ない's own atamadaka accent,
    independently) that isn't representable as one position number —
    confirmed by finding Wiktionary's own module has a broken placeholder
    (string concatenation where a number belongs) for exactly this case.
  Still excluded everywhere: te-form/plain-past/tara-form for every word
  class (sourced from external per-word data even in Wiktionary's own
  engine), い-adjective te_form/plain_past/ba_form (same reason), irregular
  いい/よい, na_adjective/suru/kuru, potential/passive/causative.
  **Side discovery, not acted on**: heiban i-adjectives may carry a
  *different* accent in bare sentence-final predicate position than their
  citation form (甘い is heiban [0] but Wiktionary's "terminal" node
  renders it as あまꜜい, position 2, used predicatively) — a pre-existing
  gap in the citation-form path itself, logged in docs/ROADMAP.md for a
  future look, not fixed here.

- **2026-09-12 — `pitch_accent` cards accept a narrow set of godan-verb
  inflected occurrences (user: "is there a way to improve [the
  citation-form-only restriction]?"); corrected same day after an initial
  cut shipped wrong formulas.** The card previously required a word to
  appear in its exact dictionary citation form (`isCitationForm`,
  `getPitchAccentReviewCandidates` in `src/pages/ReviewPage.tsx`) — added
  2026-09-02 after a bug where a ござる card was tested against
  ありがとうございます audio, whose mora count/accent disagreed with the
  dictionary contour. New `src/lib/pitchAccentShift.ts`
  (`predictInflectedPitchAccentPosition`) computes the correct downstep for
  an inflected *godan* occurrence instead of rejecting it outright, for
  three forms: `plain_negative`, `ba_form`, `plain_past_negative`.
  `getPitchAccentReviewCandidates` now takes per-occurrence candidates
  (`VocabularyOccurrenceCandidate[]`, same source `getSentenceConjugationCandidates`/
  `getWordListeningCandidates` use) instead of one pre-picked occurrence per
  word, grouping by word and preferring a citation-form occurrence when one
  exists, falling back to a shift-covered inflected one otherwise —
  `PitchAccentReviewCandidate` gained a `reading` field so the card, its
  `PitchAccentDiagram`, and mora choices key off whichever reading the
  native clip actually says. `pitchAccentRules.ts`'s two-class
  classification (`position === 0` unaccented / `position === moraCount - 1`
  accented) was extracted into shared `classifyVerbAdjectiveAccent`.
  **Two rounds of scope correction, both mid-implementation, both from
  checking assumptions against real sources rather than trusting
  code-derived reasoning:**
  1. The original plan assumed an accented verb's downstep just "carries
     forward unchanged" (same absolute mora index as citation) uniformly
     across godan, ichidan, and i-adjectives, for `plain_negative`/
     `plain_past`/`plain_past_negative`/`te_form`/`ba_form`/`tara_form`.
     Cross-checking against web-searched pitch-accent references found
     this fails for ichidan (its て/た/ば/たら family retracts the accent
     one mora earlier, with devoicing/moraic-ん exceptions) and for
     i-adjective negative/past forms (their own documented exceptions) —
     scope was narrowed to godan only, first commit `b82ffc6`.
  2. That commit shipped with a real bug anyway: web-search summaries
     alone were unreliable enough that even the *godan* formula was wrong.
     Fetching the actual source (Wiktionary's `Module:ja-acc-table`,
     en.wiktionary.org, CC-BY-SA/GFDL — a real audited rule engine, pulled
     via `curl` after `WebFetch`'s LLM-summarized read of the same page
     produced suspiciously clean/plausible-looking pseudocode that turned
     out to not match the real source) showed: an accented verb's
     **negative**-form downstep actually lands *one mora later* than the
     citation position (right before ない, not at the old stem boundary);
     an **unaccented** (heiban) verb's **ba-form** and **なかった** forms
     are *not* flat — ば and かった each induce their own downstep on an
     otherwise-heiban verb; and **te-form/plain-past/tara-form aren't
     derivable from a formula at all** — Wiktionary's own module sources
     their accent from explicit per-word data it doesn't try to compute,
     which is why they're excluded even for godan. Fixed same day, second
     commit.
  3. User asked to double-check the fix rather than trust it outright.
     Re-tracing the Lua by hand confirmed the transcription was accurate,
     but the fixtures' own ground truth wasn't: 読む was assumed heiban
     [0] without checking — it's actually atamadaka **[1]**. Rather than
     trust another summary, fetched Wiktionary's *live, rendered* pages
     for 走る and 買う directly (`curl`, not WebFetch) and read the actual
     `{{ja-acc-table}}`-computed romaji off the page — real production
     output, not a re-derivation. Every prediction matched exactly
     (走らない `[hàshíráꜜnàì]` drop after mora 3, 走れば `[hàshíꜜrèbà]` drop
     after mora 2, 走らなかった `[hàshíráꜜnàkàttà]` drop after mora 3;
     買わない `[kàwánáí]` flat, 買えば `[kàéꜜbà]` drop after mora 2,
     買わなかった `[kàwánáꜜkàttà]` drop after mora 3) — third commit swaps
     the fixture's heiban example from 読む to the verified-heiban 買う.
     Ichidan/i-adjective remain deferred — see docs/ROADMAP.md; any future
     work there should verify against real rendered output the same way,
     not summarized web search or an untested assumption about which
     words are heiban.
  New `tests/pitchAccentShift.test.ts` + `fixtures/pitch-accent-shift-fixtures.json`
  (godan-only, 買う/走る across the 3 supported forms, each row's expected
  position cross-referenced against Wiktionary's live-rendered accent
  romaji) plus two `tests/reviewPage.test.tsx` cases (masu-form regression
  stays rejected; a 走らない negative occurrence is accepted and graded
  against はしらない, not はしる).

- **2026-09-12 — Grammar production primes with native situational context
  instead of the abstract meaning gloss, when safe (user: "I wonder if we
  could make [grammar production cards] more driven by native context").**
  `GrammarProductionCard` (`src/pages/ReviewPage.tsx`) now shows the
  candidate encounter's `sentence.translation` as the writing prompt ("...
  for a situation like this: <translation>") instead of
  `pattern.shortMeaning`, so the learner produces a sentence for a real
  scenario they've encountered rather than reacting to a dictionary-style
  definition. New `translationLeaksPatternMeaning` (`src/lib/
  grammarPatterns.ts`) guards this: some patterns (aspectual/discourse
  constructions with no English morphological analog, e.g. ～てる, ～だね)
  translate cleanly without hinting at the grammar, but modal patterns with
  a near-1:1 English idiom (～わけがない → "there's no way...") translate so
  literally that the translation *is* the gloss — showing it up front would
  hand over the answer. The heuristic checks how much of the pattern's own
  `shortMeaning`/`explanation` text reappears verbatim in the translation
  (word-overlap ratio ≥ 0.4) and falls back to today's gloss display when
  it looks like a restatement, or when there's no translation at all.
  Verified against 6 real corpus patterns — correctly primes with
  translation for ～てる/～ている（状態描写）/～だね/～て（命令形）, falls back
  to the gloss for ～わけがない/～でもいい. Reveal step unchanged (same
  encounter sentence). Scoped down from "pick a different priming encounter
  than the reveal sentence" after checking live data: only one pattern is
  currently `grammar_production`-eligible at all, and it has just 2 tagged
  encounters — not enough headroom to justify sourcing two distinct
  sentences per pattern yet.

- **2026-09-12 — Fix grammar_production/grammar_completion pattern matching
  against annotated pattern names (user report: 疲れている marked "couldn't
  spot ～ている（状態描写）" despite being a correct example).**
  `grammarPatternUsedIn` and `blankPatternInSentence`
  (`src/lib/grammarPatterns.ts`) matched a pattern's `canonicalName` as a
  literal substring/fragment set against real Japanese text, but
  canonicalName can carry a parenthetical sense gloss to disambiguate
  homographic patterns (e.g. ～ている（状態描写） vs ～ている（動作進行）) —
  since no real sentence ever contains the literal gloss text, every
  pattern with an annotation failed both checks unconditionally, regardless
  of correctness. New `stripPatternAnnotation` strips `（…）`/`(...)` before
  matching in both functions, while `normalizeGrammarPatternKey` (the
  dedup key used by `ensureGrammarPattern`) is left untouched since the
  gloss is part of the pattern's identity there. `GrammarCompletionCard`'s
  comment updated to match — annotation is no longer the common
  null-blank case, only genuine conjugated/colloquial surface mismatches
  are.

- **2026-09-12 — First pass at automated transcript validation (follow-up
  to the sent_263ac750 fix below — user: "is it worthwhile when we do these
  imports to have you or a tool go through the transcripts and validate the
  stored japanese?").** New `youtube-mining` endpoint `POST
  /validate-transcript` (`app/validate.py`, `app/asr_client.py`'s new
  `transcribe_clip` — the short-utterance `/transcribe` model, not
  `transcribe_source`'s long-form `/transcribe-source`): re-transcribes a
  sentence's own reference-audio clip and compares it to the stored
  `japanese`, on **hiragana readings** rather than raw text — `色々`/`いろいろ`
  are the same word with zero character overlap, so a raw-text compare
  would flag the single most common non-bug case in the corpus.
  `readings.generate_reading` (fugashi, already used elsewhere in this
  service) handles the kanji side; katakana is independently folded to
  hiragana via `jaconv.kata2hira` for ASR's habit of rendering names in
  katakana (found live-testing against prod: 佐藤ゆうじ vs ASR's サトウユージ
  scored ~0.25 before this fold, ~0.88 after — the residual gap is
  `kata2hira` not expanding the chōonpu ー to match hiragana's vowel-
  doubling, an accepted imperfection since the flagging threshold is 0.6,
  not exactness). Returns a similarity score (0–1) — a review-queue signal,
  never an auto-fix, since ASR errs too (confirmed live: very short/quiet
  clips, a couple morae, sometimes produce a plausible-sounding hallucinated
  word instead of low confidence).
  - New `scripts/validate-sentence-transcripts.ts`
    (`npm run validate:sentence-transcripts -- [--book id] [--batch id]
    [--sentence id] [--limit N] [--threshold 0.6]`) — read-only batch
    runner: downloads each candidate's stored clip from Supabase Storage,
    calls the new endpoint, prints anything below threshold side-by-side
    (stored vs heard). Default limit 50 (each check is a real ASR round
    trip, ~3s/sentence observed). Live-tested against 30 real prod
    sentences: 2 flagged (both short single-clause utterances — plausible
    ASR noise on tiny clips, not confirmed bugs; needs a human listen) and
    1 ASR-unavailable (transient), 27 clean.
  - Scope of this pass deliberately stops at the retroactive/on-demand
    script — not wired into the mining wizard's commit step yet. If the
    script proves useful in practice, that's the natural next step (flag at
    commit time instead of requiring a separate manual run).
  - UI reminder (user follow-up: "put a reminder in the UI to run this
    after an import"): `YouTubeMinePage`'s commit now navigates to
    `/books/:bookId?imported=1`; `BookDetailPage` reads that param on
    mount, shows a one-time `Snackbar` with the exact
    `npm run validate:sentence-transcripts -- --book <id>` command (real
    bookId filled in), and strips the param via `setSearchParams` so it
    doesn't reappear on a later revisit. Scoped to the mining flow only —
    `ImportPage.tsx`'s manual `.shadowing.zip` upload shares
    `ShadowingPreviewCard` but wasn't touched, since the motivating bug
    class is specific to mining's automated ASR-cut segmentation. No new
    tests (small navigation+toast wiring; `BookDetailPage` has no existing
    render-test harness and building one for this alone wasn't worth it —
    verified by typecheck + full vitest suite green (1337) plus manual
    read-through of the wiring).
  - New Python tests: `tests/test_validate.py` (comparison logic, mocked
    ASR — kanji/kana equivalence, katakana-name equivalence, genuine
    mismatch, ASR-unavailable), `tests/test_validate_api.py` (endpoint
    contract). 102 Python tests green. Full vitest suite unaffected
    (script has no runtime import from `src/` beyond the already-Node-safe
    `appConfig.ts`).

- **2026-09-11 — Mis-transcribed sentence + mis-cut reference audio,
  root-caused and fixed by hand for one sentence (card_issue_6be947e5,
  pitch_accent on 色々).** User reported the isolated word audio sounded
  wrong ("irorondesukedo" instead of 色々); investigation escalated to a
  whole-clip problem. Diagnosed by pulling the source video's cached audio
  straight from this box's `~/.cache/youtube-mining/source-cache/` (this
  session runs directly on the codex-dev mining box, tailnet-reachable) and
  re-transcribing windows of it via shadowing-analysis-api's
  `/transcribe-source` (word-level timestamps) — no YouTube re-download
  needed. Found two compounding bugs in `sent_263ac750`:
  1. **Audio boundaries were off.** Stored `source_start_ms`/`end_ms`
     (56990/62530) landed 450ms into the word 色々 (explaining the
     "irorondesukedo" — a clipped いろいろ) and ran ~1.3s past the sentence's
     end into a trailing ねえ filler with zero gap. Corrected to
     56540/61200 (the actual いろいろ...まして span) and re-cut from the
     cached source with the same padding/fade convention `app/clip.py` uses
     (+300/-250ms pad, 20ms fade-out, aac 192k) — verified by re-transcribing
     the new clip before upload, which came back exactly `いろいろあるんで
     すけど` / `今日はそれをほとんど全て楽しんできまして` with no bleed.
  2. **The sentence text itself was wrong.** Stored text opened with "ま、"
     (well, ...) but that's never said at this timestamp — the real
     preceding clause is "この8月はね" (a separate sentence about local
     produce), not part of this sentence's audio at all. Dropped the
     spurious leading "ま、" from `japanese`/`reading_only`/`inline_reading`/
     `normalized_key` and shifted `vocabulary_suggestions` spans left by 2
     (dropping the two suggestions that had covered "ま"/"、"). Also cleared
     a stale manual `audio_start_ms`/`audio_end_ms` override on the 色々
     `sentence_vocabulary` link the user had set (via Adjust) against the
     old, wrong clip's timeline — now falls back to auto-alignment against
     the corrected audio.
  - Pure data fix via a throwaway script (not committed) + Supabase Storage
    upload (`upsert: true`, same `storage_path` — no new row). No code
    changed. Root cause (why this one sentence's boundaries/text were wrong)
    wasn't traced further upstream — plausibly a one-off manual-correction
    slip rather than a systemic mining-pipeline bug, but see the
    transcript-validation idea below.
  - Follow-up idea raised, not yet built: validate a sentence's stored
    Japanese against a fresh ASR pass of its own clip at import/mining
    time (or in batch, retroactively) to catch this class of error
    automatically — see docs/ROADMAP.md.

- **2026-09-11 — Pitch-accent drill usage tracking + SRS-miss-triggered
  extra practice + H/L shape tracking (user request — "is the drill actually
  helping?").** Three additive pieces, none touching the `pitch_accent` SRS
  card's FSRS scheduling (explicitly out of scope — extra practice is a
  separate, one-time nudge, not a retention-interval change):
  - **Usage log.** New `PitchDrillAttempt` (`src/domain/types.ts`) +
    `pitchDrillAttempts` Dexie table (DB v18) + `pitch_drill_attempts`
    Supabase table, synced like `reviews` (append-only, insert/select-only
    RLS). `logPitchDrillAttempt` (`src/db/repository.ts`) writes one row per
    scored target word per take on `PitchAccentDrillPage` — both "Full
    sentence" and "Single words" modes — recording `measured`/`mismatch`/
    `confidence` plus the dictionary vs. measured H/L shape strings
    (`expectedShape`/`measuredShape`, `'h'/'l'` per mora). Wired from a new
    effect in `PitchAccentDrillPage.tsx` that fires once a take's analysis
    reaches `status: 'done'`; per-word mismatch/confidence is recovered by
    matching `buildPitchAccentShapeObservations`'s `pitch-accent-shape-${i}`
    observation ids back to the `scorableTargets` array
    (`analyzeRecording`'s new `observationBySurfaceForm` map) rather than
    re-deriving the match heuristic. `getPitchAccentDrillSentences` gained a
    `targetVocabularyItemIds` (surface form → vocabulary item id) field on
    its return type so sentence-mode attempts can resolve an id without
    threading one through the widely-shared `PitchAccentTarget` type.
  - **"Missed in review" focus queue.** New `getPitchAccentFocusWords`: a
    word whose `pitch_accent` card's last 2 reviews were both `again`/`hard`
    (confirmed rule) surfaces in a banner at the top of
    `PitchAccentDrillPage` ("You've missed the pitch-accent card twice in a
    row on N words") with a "Start extra practice" button that walks just
    that list in single-word mode (`focusMode` state swaps the list source
    and forces `effectiveMode: 'word'`, tags logged attempts
    `focusTriggered: true`). Clears the moment *any* drill attempt is
    logged for the word afterward, regardless of outcome — it's extra
    practice, not a retest gate — and only reappears on a fresh 2-miss
    streak. The word-example-picking logic shared with
    `getPitchAccentDrillWords` was factored into
    `bestExampleOccurrencesByItemId`.
  - **H/L shape tracking on the SRS card too (user: "both is fine").**
    `Review` gained `pitchExpectedShape`/`pitchChosenShape` (both `'h'/'l'`
    strings from `expectedPitchShape`), computed in `ReviewPage.tsx`'s
    `handleRate` from `PitchAccentCard`'s already-known chosen/correct drop
    positions and threaded into `recordReview`. Grading itself is
    unchanged — this is analysis-only data alongside the existing
    `responseRaw`/`expectedAnswer` digit strings.
  - **Query path.** `scripts/report-pitch-drill-effectiveness.ts` (same
    `createScriptSupabaseClient` pattern as `report-new-card-backlog.ts`):
    weekly drill-attempt volume vs. `pitch_accent` pass-rate, a drill-heavy-
    vs-quiet-weeks pass-rate comparison (explicitly flagged correlational,
    not causal — usage is self-selected), and the most common H/L
    shape-confusion pairs pooled from both the drill log and the SRS
    card's review history. Meant to be run directly and read, not
    exported/imported.
  - Migration `20260911010000_pitch_drill_attempts.sql` **to apply**
    (2 new nullable `reviews` columns + the new table). `tests/sync.test.ts`
    +2 mapper round-trips, `tests/pitchAccentDrill.test.ts` +8. 1337 tests
    green.

- **2026-09-11 — POS badges in the vocabulary picker (user request, prompted
  by wanting to learn to read Japanese dictionary entries).** New
  `src/lib/posLabels.ts`: maps every UniDic pos tag seen in prod
  `vocabulary_suggestions` (32 distinct values as of this date) to the term
  a real Japanese dictionary would print (with the UniDic subcategory noted
  parenthetically) plus a short English gloss — `describePos` (exact match,
  falling back to a top-level-prefix table for anything unrecognized) and
  `posTopLevelJa` (compact top-level term only). Wired into
  `VocabularyPicker.tsx`: `MorphChipContent` gets a one-line compact badge
  (e.g. "名詞") on every strip chip and the drag overlay; `SelectedCard`
  shows the full breakdown (e.g. "名詞（普通名詞） · noun (common)") on
  confirmed/tray cards, splitting a combined selection's `+`-joined pos
  string per part. Strip-chip title tooltips upgraded to the friendly
  ja+en text too. New `tests/posLabels.test.ts` + a
  `tests/vocabularyPicker.test.tsx` case. Full vitest suite green (1330).
  - Verified visually via a throwaway route+harness page (not committed) —
    dev server + Playwright screenshots run through Docker
    (`mcr.microsoft.com/playwright`, `--network host`), since the bare host
    is missing browser shared libs (no sudo to install them). Desktop
    (900px) render is clean. Found, and then fixed same day (user: "I use
    it on my phone a lot") — a **pre-existing** mobile-width (390px) bug in
    `SelectedCard`: its header row (drag handle + content + Edit/Remove, all
    one `flex-wrap: wrap` row) wrapped Japanese text one character per line,
    because the content column's `min-width: 0` let flexbox shrink it to a
    sliver once the drag handle and Edit/Remove buttons claimed most of a
    narrow row, rather than wrapping the buttons down. Confirmed
    pre-existing (not caused by the new pos line) — the untouched
    `item.surface`/`item.expression` text wrapped the same way. Fix:
    `min-width: 0` → `min-width: 10rem` on that column, so flex-wrap now
    reliably pushes Edit/Remove onto their own line below content instead
    of collapsing it — verified at both 390px and 900px (desktop now also
    wraps buttons below on the narrower vocab-picker panel width, which
    reads fine, not broken).

- **2026-09-11 — Root-caused a compound-noun reading bug the user'd hit
  before: お母さん → おははさん.** `suggestionFromToken`
  (`src/lib/vocabularySuggestions.ts`) unconditionally preferred
  `token.lemmaReading` (UniDic `kanaBase` — the lemma's own out-of-context
  citation reading) over the tokenizer's contextual `token.reading`, even
  when `surface === lemma` (nothing inflected, so there was no gap for
  `lemmaReading` to bridge). For a compound-noun member whose in-context
  reading legitimately differs from its isolated dictionary reading (母
  alone kanaBase はは, but inside お母さん its contextual reading is かあ),
  that silently swapped in the wrong reading — invisible until the learner
  combined tokens in the picker and the wrong reading rode along. Fixed:
  `lemmaReading` is now only consulted when `token.surface !== expression`
  (there's an actual inflection gap); an uninflected token trusts its own
  contextual `reading`. New regression test in
  `tests/vocabularySuggestions.test.ts`.
  - Scanned prod for the same signature across other known irregular
    family-honorific/date compounds (お父さん, お兄さん, お姉さん, 今日, 明日,
    昨日, 一日, …) and found one more real hit: お父さん → おちちさん, plus an
    unrelated orphaned お父さん→おとうさんどり row (dead, no links/study
    items, likely a stray from an お父さん鳥 combine). Hand-merged/deleted
    both the same way the two card-issue-report instances were (repoint
    study_items preserving FSRS + reviews + card_issue_reports, repoint
    sentence_vocabulary, dedupe vocabulary_kanji) — this bug's trigger
    (uninflected compound member, not a conjugation surface form) falls
    outside `merge-duplicate-vocabulary-items.ts`'s detection, so no
    general backfill script exists for it; the scan was a one-off, not
    added as a script.

(New detail lands here; swept into `STATUS_ARCHIVE.md` next time this file
is trimmed.)

- **2026-09-11 — Two grammar review-card bugs found via card issue triage.**
  - `GrammarCompletionCard` (`grammar_completion`): the reveal only named the
    correct pattern inside the `<mark>` blank, which only renders when
    `blankPatternInSentence` finds the pattern's canonical name verbatim in
    the sentence — never true for any pattern with a parenthetical
    annotation (e.g. `～ている（状態描写）`) or a conjugated/colloquial surface
    form. A wrong answer on those cards showed "✗ Not quite" with no visible
    correction. Now always shows "Correct: {canonicalName}" when there's no
    blank to mark it in. (report card_issue_f8eb6258)
  - `GrammarComprehensionCard` (`grammar_comprehension`): reused the same
    `blankPatternInSentence` literal-match as a check, not a blank — when it
    misses, a note now flags that the sentence uses a conjugated/colloquial
    form of the pattern rather than its dictionary form (e.g. てる for ている),
    since the AI-generated `explanation` field doesn't reliably call that out
    itself. (report card_issue_f222efff)

- **2026-09-11 — Two more issue reports, same session: another
  reading-mismatch instance, and a silent playback-failure bug in the
  word-loop control.**
  - cloze report on 並ぶ (card_issue_699e5810): same expression/reading-
    mismatch bug class as 頑張る above — `vocabulary_items.reading` held
    `ならび` (masu-stem) instead of `ならぶ`. Cloze is a self-rated reveal
    (`VocabularyTargetCard`), not auto-graded, so "the answer" it shows is
    literally `vocabularyItem.reading` — fixing the data fixed the card, no
    code change needed here.
  - `SegmentLoopPlayer`'s "Loop native word" button could fail completely
    silently: its local `<audio>` + `PlaybackCoordinator.loopRange` had no
    equivalent of `nativeAudioController`'s `recoverAndRetry` (the existing
    fix for Safari's IndexedDB occasionally handing back a Blob that looks
    intact locally but won't actually decode — WebKitBlobResource error).
    `playLoopedRange` (`src/lib/recording.ts`) now *rejects* on the initial
    `play()` failure instead of silently resolving (mid-loop rewind
    failures still retry silently — a single stutter isn't worth aborting
    the loop over); `SegmentLoopPlayer.toggleLoop` catches that and retries
    once off a freshly refetched blob via a temporary object URL set
    directly on the `<audio>` element (not through `setBlob`, which would
    cancel the retry through the objectUrl effect's cleanup), surfacing
    "Unable to play this word on this device." only if the retry also
    fails. `ShadowPage`'s other `loopRange` caller got a matching catch so
    the now-possible rejection doesn't surface as an unhandled promise
    rejection there. (report card_issue_ed8e9e5e — "nothing seemed to
    happen when I clicked it"; root cause unconfirmed since it can't be
    reproduced from data alone, but this closes the actual gap: previously
    a real playback failure had zero recovery and zero feedback, by design
    symmetry with the whole-sentence path.)
  - `tests/recording.test.ts`: updated the loopRange test that asserted the
    old silent-resolve behavior to assert rejection instead. Full vitest
    suite green (1323).
  - Both in `src/pages/ReviewPage.tsx`. Full vitest suite green (1323).
  - Also ran `merge:duplicate-vocabulary-items --apply` while triaging a
    third report (reading_production on 頑張る showing expected answer
    "がんばっ" instead of "がんばる" — the known expression/reading-mismatch
    bug, see "Vocabulary reading-mismatch bug + cleanup" below). Cleared 64
    buggy/correct duplicate pairs backlog-wide (not just 頑張る); script is
    idempotent and repoints reviews/card_issue_reports onto the surviving
    item, so the report itself followed its study item to the merged
    correct-reading item automatically. 0 pairs remain.

- **2026-09-11 — "Suspend studying" for a book that's too hard right now
  (user request).** New `Book.suspendedAt` (nullable ISO timestamp), distinct
  from `archived`: archiving tidies a *finished* book off the library while its
  review cards keep flowing for retention; suspending shelves a *too-hard* book
  — it drops out of every session-planner candidate source (the three finders
  now filter via a shared `isBookInStudyRotation`, was `!book.archived`) **and**
  its exclusive SRS cards are held back from the global `/review` queue.
  - New pure `src/lib/suspendedBooks.ts` — `SuspendedBookIndex` +
    `sentenceIsSuspendedOnly` / `vocabularyItemIsSuspendedOnly` /
    `studyItemIsHeldBackBySuspension`. A sentence (and, transitively, a word) is
    only held back when *every* book it belongs to is suspended, so a word
    shared with an active book keeps being reviewed there. `grammarPattern`
    subjects are never held back (not book-scoped).
  - `loadSuspendedBookIndex()` (`repository.ts`) returns `null` when no book is
    suspended — the common case, zero extra IO; otherwise reads the whole
    `bookSentences` + `sentenceVocabulary` tables (a few times per review-init /
    plan). `ReviewPage`'s global-scope `scope` filters `sentences` by
    `sentenceIsSuspendedOnly` (cascades to vocab/audio/conjugation candidates);
    `getSessionPlannerInput` filters `retainDue`/`practiceDue`. The book-scoped
    review path (`/books/:id/review`) is exempt — opening a suspended book's own
    review is deliberate.
  - `setBookSuspended(bookId, suspended)` — on **resume** it calls
    `rescheduleResumedBookItems`: every overdue held-back card of that book gets
    its `due` spread round-robin over the next `RESUME_RESCHEDULE_SPREAD_DAYS`
    (7) days (FSRS state otherwise untouched — the cards were shelved, not
    failed), so there's no one big overdue pile.
  - UI: `BookDetailPage` gets a "Suspend studying" / "Resume studying" toggle
    next to Archive + a status note; the existing jump-to-sentence button is
    renamed "Resume" → "Continue" to avoid the clash. `BooksPage` shows a
    "Suspended" pill and sinks suspended books (via `isBookInStudyRotation`).
  - Sync: `books.suspended_at timestamptz`
    (`20260911000000_book_suspended_at.sql`), `bookToRemote`/`remoteToBook`,
    `bookSchema`. No Dexie bump (not indexed).
  - Tests: `tests/suspendedBooks.test.ts` (new), + cases in
    `tests/data.test.ts` (suspend/resume + reschedule),
    `tests/sessionPlannerRepository.test.ts` (planner exclusion),
    `tests/reviewPage.test.tsx` (global queue holds back, book-scoped doesn't),
    `tests/sync.test.ts` (mapper round-trip). Full vitest suite green (1323).

- **2026-09-10 — Pitch-accent misses now come with a corrective "Try this:"
  hint (user request).** New `pitchAccentCorrections.ts`
  (`diagnosePitchAccentDeviation`) classifies the dictionary-vs-recording
  H/L divergence into a named failure mode — first-mora-high, held-high
  (late drop), early-drop, no-downstep, final-fall, particle-fall, flat —
  and returns an actionable practice cue, several naming the likely
  English-transfer cause (initial stress, utterance-final declination,
  loudness-not-pitch prominence). Wired into `buildPitchAccentShapeObservations`
  via `TimingObservation.hint`, rendered as a "Try this:" line in
  `AnalysisPanel` and `PitchAccentDrillPage`. Also widened the scorer: it
  now fires (medium/low confidence) when the drop position is right but
  individual morae are off — `classifyLearnerMorae` exposes per-bucket
  `voicedBuckets` so a divergent *carried-forward* bucket is suppressed
  rather than flagged. +2 test files (`pitchAccentCorrections`, new
  `pitchAccentObservations` cases). 1307 tests green.

- **2026-09-10 — Pitch-accent shape feedback gave a contradictory message
  when the drop was merely misplaced (user report — "the phrase is
  nakadaka, but I sound like nakadaka", 「親鳥」 えさを…).** When the learner's
  drop position and the dictionary's fall in the same coarse category
  (only nakadaka has more than one interior position) the old message read
  "Dictionaries mark X as nakadaka; your pitch here sounds like nakadaka
  instead." `buildPitchAccentShapeObservations` now detects the same-label
  case and names the mora the drop belongs on vs. where the learner put it
  ("It belongs after 「や」 (mora 2), but yours stays high 1 mora too long
  and drops after 「ど」 (mora 3)."). The underlying detection was already
  correct — 親鳥 is Kanjium [2] and the recording did drop a mora late.
  `pitchAccentObservations.ts` + one new test.

- **2026-09-10 — Word-audio loop fell back to whole-sentence too often on
  colloquial sentences (user report — "why aren't pitch cards showing
  word-level playback", e.g. `で、なんか結構怖がってたりもしてね、最近は`).**
  Root cause: `SegmentLoopPlayer` computed the word span lazily by calling
  the **tailnet-only** `/align` service at review time, so it silently
  no-ops off-tailnet; and on-tailnet, `isolatedWordRange`'s char-proportion
  remap is defeated by fillers / contractions / phrase-final targets. Three
  fixes:
  - **Alignment is stored + shared, no longer recomputed per client.**
    `loadOrComputeAlignment` (`src/lib/alignmentCache.ts`) now resolves in
    three tiers: local `referenceAlignments` Dexie cache → the owner-scoped
    `reference_alignment` Supabase table (`src/sync/alignmentRemote.ts` —
    read/written by direct query, **not** the sync-event engine, same
    treatment as reference-audio blobs in `audioSync.ts`) → the MFA
    service. A fresh service result is cached locally *and* pushed to the
    table opportunistically (`uploadRemoteAlignment`). Migration
    `20260910000000_reference_alignment.sql` (plain owner-scoped table,
    `alignment` jsonb + `alignment_version`, no sync triggers).
    `scripts/backfill-reference-alignment.ts` (`npm run
    backfill:reference-alignment`, `--apply`/`--limit N`) computes the
    whole existing corpus — meant to run **on codex-dev itself**, which
    hosts the aligner (`ANALYSIS_ALIGN_API_BASE=http://127.0.0.1:8002`, no
    tailnet hop) and where the TS scripts already have an authed Supabase
    path. Idempotent. Off-tailnet clients now get spans for anything
    aligned once anywhere. Not wired into mining-commit yet — the backfill
    plus opportunistic upload cover it; a commit-time hook is a marginal
    follow-up touching three delicate import sites.
  - **Cascade gap found + fixed.** `cascadeRetireSentenceLocal` never
    retired a sentence's `reference_audio` rows, so the 2026-09 "After
    Work" / "GLIM SPANKY" sentence soft-deletes stranded **140** live
    `reference_audio` rows pointing at deleted sentences (114 + 26) — why
    the alignment backfill covered 473 of 613 rows. Cascade now sweeps
    `db.sentenceAudio` (all three callers; re-segmentation opts out via a
    new `retireAudio=false` arg since it transfers/retires clips itself).
    `scripts/cleanup-orphaned-reference-audio.ts` (dry-run default,
    `--apply`, `--delete-blobs`) cleared the existing 140 against prod
    2026-09-10 (rows soft-deleted + Storage blobs removed). `reference_audio`
    is now 473 live rows, all aligned, 0 orphaned.
  - Two individually mis-segmented clips that failed alignment
    (`audio_7f9e2107` #932 乗馬, `audio_48a4f5a7` 説明が上手い人) were
    tail-truncated (one also head-truncated); re-cut from the cached source
    via the mining service, verified to align, and their `reference_audio`
    rows + `reference_alignment` updated. Corpus now 473/473 aligned.
  - `isolatedWordRange` now returns `null` (→ whole-sentence fallback) when
    an `<unk>` token sits at/before the matched span. The aligner emits
    `<unk>` for out-of-vocabulary words — chiefly casual contractions like
    `怖がってたり` — whose characters drop out of the character-proportion
    basis while their airtime doesn't, so every token after shifts and the
    span comes out confidently wrong. Better no isolate than a wrong one.
  - `SegmentLoopPlayer`'s "Adjust" editor is now reachable when forced
    alignment produced no range at all (off-tailnet, OOV, degenerate). It's
    seeded with a rough duration-proportional guess (target char-span ×
    clip length) to drag from; the guess is never looped or persisted until
    the learner commits a drag, which writes the usual
    `SentenceVocabulary.audioStartMs/EndMs` override. Needs a `link` and a
    known `durationMs`; `wordOnly` callers (the `word_listening` optional
    scaffold) are unaffected.

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
    UniDic's na-adjective tag (綺麗, 大変, 静か, 好き, 便利), which the old
    list (`形容動詞`, the pre-UniDic term) missed entirely, so na-adjectives
    (好き included) were never default-checked. `形状詞/助動詞語幹` (the
    そう/よう stems) stays excluded.
  - `isFunctionAdverb` — a lemma-keyed list of degree/quantity/discourse
    words the tokenizer files as `副詞` (and a few `形状詞`/`連体詞`) but
    which are picked up from exposure: 色々, とても, かなり, ちょっと, もう,
    まだ, たくさん, よく, やっぱり, たぶん, こう/そう/どう … Manner adverbs
    (ゆっくり, はっきり, しっかり, きちんと) stay checked; すごく / 結構 stay
    checked too (shared lemma with 凄い / the na-adjective 結構).
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
  pipeline, `/resegment`, `/reclip`, source-audio cache, job wizard. Also a
  no-JS `GET /status` box-resource page (RAM/disk trend + service RSS +
  cache size), fed by the `box-metrics` 15-min sampling timer
  (`deploy/box-metrics.{service,timer}` → `app/metrics.py`). At
  `…/youtube-mining/status`.
- `~/projects/shadowing-analysis-api` (separate repo, Hetzner box,
  `systemd --user`, tailnet-only via `tailscale serve`) — MFA forced
  alignment, `faster-whisper` ASR (`base` diagnostic + `large-v3-turbo`
  source transcription). MFA/kalpy leaks per-alignment memory (~2.3 GB warm
  → ~4.7 GB/week on the 8 GB box); a `shadowing-analysis-api-restart.timer`
  in that repo restarts it every Sunday 04:00.
- Supabase — single shared project, table-prefix-isolated from the retired
  `shadowing` repo. Always soft-delete synced tables (`deleted_at`), never
  raw `DELETE`, or clients never learn of the change.
- Edge Functions — `grammar-assist`, `vocab-assist` (Claude Haiku).
