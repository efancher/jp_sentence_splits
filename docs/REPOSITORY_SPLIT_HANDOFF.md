# Handoff: test coverage, cleanup and the `repository.ts` split

Written 2026-11-16 so another session can resume. Delete this file once the
split below is finished and the open decisions are resolved or moved into
`ROADMAP.md`.

## Where things stand

Everything listed here is pushed to `main`; checks were run locally (full
`npm run check`, lint, build, and the named Playwright specs in the Docker image).
Nothing here needed a migration or a deploy.

### Done this session (2026-11-15/16)

- **Sync tests.** `tests/audioSyncTransfer.test.ts` (audioSync ~95% lines) and
  `tests/syncEngineCycle.test.ts` (`runSyncCycle`: signed out, token expiry,
  offline/reconnect, pull failure, deferred ids, pull throttle, concurrent
  cycles; engine ~40% lines). Uncovered: fresh-device bootstrap
  (`replaceLocalWithCloud`), remote-event apply, duplicate adoption,
  `uploadAllLocalData`.
- **Repository coverage before the split.** `repository.ts` + `src/db/repo/*`
  went from 90.1% lines / 74.3% branches to 95.6% / 79.7%:
  `tests/backupRestore.test.ts`, `tests/bookMaintenance.test.ts`,
  `tests/plannerCandidates.test.ts`, `tests/stuckSentences.test.ts`.
- **First split slice (`7f1de45`).** Self-contained areas moved to
  `src/db/repo/` (podcast feeds, mining imports, shadowing attempts,
  vocabulary/kanji links, card and sync issue reports, `sentenceWrites`).
  `repository.ts` re-exports them with `export *`, so no importer changed.
  `repository.ts` is now 11,501 lines (from 14,062).
- **Fixes.** Replace-mode backup restore keeps local reference audio for
  restored sentences (`a266665`). The stale "missed cloze card" shadow boost,
  silently re-enabled by the drill-flow removal, is gone (`5e48cb8`).
  `allAudioSentenceIds` no longer uses `uniqueKeys()` (Playwright's WebKit
  rejects `nextunique` cursors on every store).
- **Removals.** `/play` games, planner game breaks, the Games panel and Daily
  practice game slots (`156f89e`, user: "I don't use the games"); unreachable
  word/grammar branches in review priority inputs; unused book-order modes;
  several uncalled drill-era functions. Stored `game_rounds` rows are kept and
  still sync. The pitch clip loader survives as `getPitchWordClips`
  (`src/lib/pitchWordClip.ts`).
- **Progress "What's stuck" reworked (`b259e9a`)** around the current step
  requirements (`src/lib/stuckSentences.ts`, `getStuckSentenceSnapshot`,
  `e2e/progress-stuck.spec.ts`). Not yet checked against the learner's real
  library; the first look on their phone is the real test.
- **Smaller items.** Planner counts Read-check events as review activity;
  `wrangler.local.toml` is gitignored for the R2 gateway; the missing-audio
  backfill has `--non-youtube`; a flaky QuickMine assistant e2e mock was fixed.

## Next: split the rest of `repository.ts`

Approach that worked for the first slice: move whole sections into
`src/db/repo/<area>.ts`, export every moved declaration, `export *` them from
`repository.ts`, prune imports, then `npm run check`. Keep module imports
acyclic: an extracted module must not import from `repository.ts`. The
throwaway scripts used for slice one (dependency analysis, extraction,
import pruning) lived in `/tmp` and are gone; they were ~100 lines of
TypeScript-compiler-API code each and are quick to rewrite.

Current sections (line numbers as of `73b6bdf`) and what each needs from the
others:

| Section | Lines | Depends on |
| --- | ---: | --- |
| Core: books, chapters, sentences, imports, backup, settings (1–3887) | 3,887 | planner pass reads (3 helpers), `getSavedWordStatus` |
| Cached alignments (3888–4451) | 564 | study-item summaries, grammar summaries, proficiency readers, pass reads |
| FSRS review / proficiency (4452–5512) | 1,061 | pass reads (many), `pickContextSentenceForGrammarPattern`, `latchSequentialUnlocksForSentence` |
| Evidence foundation (5513–5555) | 43 | `ensureStudyItem`, `recordReview` |
| Sentence-led flow (5556–7077) | 1,522 | pass reads, core, FSRS, alignment, `listSentenceLearningEvents` |
| Study-item explainability (7078–7280) | 203 | context-diversity helpers in sentence-led |
| Grammar patterns (7281–8746) | 1,466 | FSRS, pass reads, `getReferenceAlignment` |
| Learning Orchestrator / planner (8747–end) | ~2,750 | core, FSRS, grammar, sentence-led |

Suggested order:

1. **Extract the planner pass-read layer first** (`plannerShared`,
   `plannerPassMemo`, `traceStep`, `rowCount`, `readAll*ForPass`,
   `readRowsByKeys`, `bookSentencesForSentences`, `allAudioSentenceIds`,
   `readTileEligibilityForPass`, `ANY_OF_SCAN_THRESHOLD`, the cross-tap cache
   and `resetPlannerReadCachesForTests`) into e.g. `src/db/repo/passReads.ts`.
   It sits in the planner section but every other section uses it; moving it
   to the bottom layer removes most of the cycles. Watch the module-level
   mutable state (`plannerPassMemo`, caches): it must stay a single instance,
   so other modules import it rather than copy it.
2. Then the small leaves: evidence foundation, explainability (after moving
   the two context-diversity helpers it needs), cached alignments.
3. Then FSRS/proficiency and grammar, then sentence-led, then the planner,
   leaving core in `repository.ts` (or `repo/core.ts`) last.
4. Where two sections genuinely call each other (FSRS ↔ grammar ↔
   sentence-led each have one or two such calls), move the shared helper down
   rather than importing upward.

Coordinate before starting: `repository.ts` is edited by many sessions (about
ten commits in three days). Do one section per commit and push promptly.
A thin spot still worth a test before moving its section:
`listStudyItemSummaries` (67% lines at last measure).

## Open decisions for the learner

- **Delete stored game rounds?** Removing `gameRounds` / `game_rounds` needs a
  Supabase migration and permanently drops the data; left in place.
- **Six locked worktrees** (`docs-trim`, `fix-append-only-push-conflict`,
  `perf-coverage`, `perf-large-episode`, `reader-tap-numeral-counters`,
  `wordcheck-dictation-steps`) are held by live Claude sessions; all their
  branches are merged. Not removed; ask before force-removing.
- **`research/gloss-clause-pilot`** branch: the learner said to wait on it.

## Loose ends

- The main checkout is at detached `98a5062` with an untracked
  `cloudflare/r2-gateway/wrangler.local.toml` (real config; gitignored on
  `main`, so advancing the checkout hides it).
- `src/sync/engine.ts` still calls `uniqueKeys()` once (book memberships in
  `repairMissingBookMemberships`). Real Safari appears fine; only Playwright's
  WebKit rejects it.
- Port 4173 was in use by another session's preview; e2e runs used a
  throwaway config pointing at another port (`playwright.config.ts` hard-codes
  4173 and reuses an existing server, so it would test the wrong build).
