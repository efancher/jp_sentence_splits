# Handoff: app review recommendations and the word/grammar card-flow removal

Written 2026-11-11 so another session can resume. Delete this file once the
removal below has shipped and the remaining recommendations are either done or
moved into `ROADMAP.md`.

## Where things stand

- **Done and pushed to main (`cebbd13`):** Word checks have their own planner
  candidate list picked from sentence morphology, Dictation blanks the
  weakest-meaning word's phrase, and the planner drafts one tool per sentence
  per plan. Details in `STATUS.md` and the ROADMAP entry "Separate Dictation and
  Word check from the Fresh try".
- **Removal done 2026-11-12 (stages 1-5 below):** settings, planner, ReviewPage,
  dead-code sweep, tests, e2e and docs are updated. Not done: unused-export scan
  (see stage 4), `GrammarNoticingFlowPage` / `VocabularyReviewPage` kept,
  `PlannerStepTargetKind` values kept so old saved steps still route, and the
  Progress velocity panel still reads `countNewVocabularyCardBacklog`.

## Removal of the word/grammar card flow

### Decisions the learner made (2026-11-11)

1. **Scope: word and grammar drills only.** Activity types `reading_retrieval`,
   `cloze`, `reading_production`, `contrastive`, `sentence_transformation`,
   `word_listening`, `grammar_recognition`, `grammar_completion` (the
   `LEGACY_DRILL_ACTIVITY_TYPES` set in `src/lib/sentenceLed.ts`).
2. **Keep** pitch-accent cards (`pitch_accent`, `pitch_accent_production`,
   behind `pitchAccentPaused`) and sentence cards (`reading_in_context`,
   `listening`, `ear_tiles`, `dictation_tile:N`, behind `sentenceCardsPaused`).
3. **Keep every existing row and its review history.** No migration, no
   soft-delete. Production has roughly 700 word/grammar study items; word
   strength (`buildWordEvidence`), the i+1 "known words" set
   (`getIntroducedReadingVocabularyItemIds`) and the progress panels read their
   reviews as evidence, so those readers must keep working.

### What must keep working

- Vocabulary and grammar browse pages, the vocabulary picker and manual
  confirmation (they create the `sentence_vocabulary` links that games, word
  audio and pitch-accent cards use). Only the planner steps and Review cards go.
- `getVocabularyOccurrenceCandidates` in `ReviewPage.tsx`: the pitch-accent
  descriptor is built from it.
- `/play` games, the Shadow page, reader tools, Read checks, Fresh tries.
- Backup import of older files and settings synced from older clients that
  still carry the removed setting keys (check `settingsSchema` in
  `src/domain/schemas.ts` tolerates unknown keys before deleting the fields).
- AGENTS.md currently says "Preserve the optional older flow". Update the root
  `AGENTS.md`, `src/AGENTS.md` and `e2e/AGENTS.md` wording as part of this work.

### Suggested stages (commit each; merge to main only when `npm run check` is green)

1. **Flow switches.** In `src/lib/sentenceLed.ts` remove `isSentenceLedFlow`,
   `effectiveLegacyDrillsPaused` and `effectiveSentenceFirstPlanning` (all are
   constant `true` once the flow is gone). Remove the settings
   `sentenceLedFlow`, `legacyDrillsPaused`, `sentenceFirstPlanning` and
   `dailyNewWordQuota` from `src/domain/types.ts`, `src/domain/schemas.ts`,
   `src/db/database.ts` and their controls in `src/pages/SettingsPage.tsx`
   (around lines 219, 333, 429, 445). `isActivityTypeInUse` should report the
   legacy drill types as never in use. Call sites: `ReviewPage.tsx`,
   `BookDetailPage.tsx:514`, `BooksPage.tsx:28`, `repository.ts` (about lines
   5504, 5548, 10170 and `gatherSessionPlannerInput`).
2. **Planner.** In `src/lib/sessionPlanner.ts` drop the `vocabulary` and
   `analyze` explore kinds (`classifyExploreSentences`, `exploreStepFor`, the
   pass-1 vocabulary reserve in `buildExploreSteps`), `understandCandidates`,
   `grammarNoticingCandidates`, `newCardBacklogCount` and
   `newCardsPerSessionLimit` handling, and the `sentenceFirst` parameter. In
   `repository.ts` drop `findUnderstandCandidates`,
   `findGrammarNoticingCandidates`, `countNewVocabularyCardBacklog` and the
   `legacyPaused` branches in `gatherSessionPlannerInput`. Check
   `PlannerStepTargetKind` values `vocabulary_review`, `continue_book` and
   `grammar_noticing`: saved sessions on devices may still hold such steps, so
   keep `sessionStepTargetPath` able to route (or skip) them.
3. **Review page.** In `src/pages/ReviewPage.tsx` remove the `vocabulary`,
   `wordListening`, `confusion`, `conjugation` and `grammar` descriptors from
   `buildActivityDescriptors`, their scope queries, the daily new-word top-up,
   and the cards `VocabularyTargetCard`, `ReadingProductionCard`,
   `SentenceConjugationCard`, `WordListeningCard`, `ContrastivePairCard`,
   `GrammarRecognitionCard`, `GrammarCompletionCard`. The non-led gates go with
   them: `deferUnreadySentenceReviews`, `deferUnreadyReadingInContextReviews`,
   `deferUnreadyGrammarReviews`, `getSentenceFullReviewReadiness`,
   `getSentenceListeningReadiness`, `GateContext`, `gateSentenceId` and
   `isReady` (only the listening descriptor's `activityIsReady` still does
   work). Check `SentenceDeepDivePage` (`/review?sentenceId=`): its mastery
   rungs may list word cards.
4. **Dead-code sweep.** `noUnusedLocals` is on, so `npm run typecheck` finds
   unused locals and imports. Unused *exports* need a search (knip is not
   installed and running it through `npx` was refused; a small script that
   counts each exported name's uses across `src`, `tests`, `scripts`, `e2e`
   works). Expect whole files to fall out: `src/lib/newWordQuota.ts`,
   `GrammarNoticingFlowPage`, possibly `VocabularyReviewPage` (only if nothing
   but the removed planner step routes to it), `scripts/report-new-card-backlog.ts`.
5. **Tests, browser specs, scripts, docs.** About 35 test files set
   `sentenceLedFlow`, `legacyDrillsPaused` or `sentenceFirstPlanning`
   (`grep -rln` those names under `tests e2e scripts`). Delete tests of removed
   behaviour; drop the setting from the rest. `e2e/review-document.spec.ts`
   turns sentence-led mode off for legacy word-card fixtures. Update `STATUS.md`,
   `AI_OVERVIEW.md`, `ARCHITECTURE.md`, `ROADMAP.md` (several "Possibilities"
   entries assume the cards exist: grammar discrimination card, vocab/pitch
   ladder notes) and the user guide.

### Checks to run

`npm run check` (typecheck, lint, all tests), `npm run build`, and the browser
suite per `e2e/README.md`. Port 4173 was held by another worktree's preview on
2026-11-11; serve on another port with a temporary config that overrides
`baseURL` rather than stopping that process.

## Remaining recommendations from the review

In the order they were proposed; none of these is started unless noted.

1. **One owner per sentence skill.** After the removal above, decide whether
   sentence cards also go (turn `sentenceCardsPaused` on by default and let
   Read checks carry the spacing). The learner chose to keep them for now.
2. **Meaning evidence.** Done (see top). Follow-ups: a Word check triggered
   directly by a Meaning/Kanji/Reading trouble tag, decoupling the Grammar check
   from its revisit the same way, and comparing the next Read check after a
   standalone Word check or Dictation. Re-read usage after about a week.
3. **Sync per-device evidence:** `reviewTroubleLogs` and game rounds sync as
   append-only `review_trouble_logs` / `game_rounds` (migration
   `20261112000000`, pending apply). Still local-only: `shadowRequests`,
   `shadowSnoozes` and the i+1 setting, because `AppSettings` has no synced
   mechanism; they need a small LWW table (like `planner_sessions`) or a
   settings-sync design.
4. **Verification week.** Items marked "local checks only" in `STATUS.md`:
   phrase-shadow checklist P1–P8 in `MANUAL_TEST_LOG.md`, grammar links through
   the real panel, parallel assistant agents on the 8 GB box, chunked ASR on a
   40+ minute episode, trouble chips on a phone.
5. **Phrase-shadowing data re-pull** due around 2026-11-17, including the
   never-done join with measured timing and pitch of the same take.
6. **R2 backup.** R2 is the only copy of live clips: install the daily
   `backup:r2-audio` timer, write and rehearse a restore, decide on an offsite
   copy (`CLOUDFLARE_R2_PLAN.md`).
7. **Data repairs after recent fixes:** re-align sentences aligned before the
   digit-expansion fix; scan earlier imports for kana-only ASR text.
8. **Card-flow removal:** this document.
9. **Tidy-ups:** `STATUS.md` header still says "reviewed 2026-10-18"; two empty
   stray files in the main checkout root (`satori-glossbook@0.6.0`, `tsx`); an
   uncommitted change to `cloudflare/r2-gateway/wrangler.toml` in the main
   checkout (not touched by this work; ask before committing or discarding it).
