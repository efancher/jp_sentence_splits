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

Slices 2–4 done (`caad3e3`, `dc97a0e`, `538a6f5`; plus the
`listStudyItemSummaries` test the handoff asked for, `a4595e0`);
`repository.ts` is now 10,781 lines.

- Slice 2: the planner pass-read layer moved to `src/db/repo/passReads.ts`
  (407 lines). It owns `plannerShared`, `plannerPassMemo`/`plannerWarming`
  (single instances, imported — never copied — via `plannerPassActive()`,
  `plannerWarmingActive()`, `beginPlannerWarming()`/`endPlannerWarming()` and
  `endPlannerPass()`), `createPlannerTimer`, the timing/trace plumbing and all
  `read*ForPass` / key-batch readers. `warmPlannerReads` and
  `getRecentActivityEvents` stayed in `repository.ts` (they reach into core and
  FSRS helpers above this layer).
- Slice 3: the alignment/attempt result caches (reference alignments, pitch
  tracks, attempt alignments/transcriptions/analysis summaries) moved to
  `src/db/repo/alignmentCaches.ts`. What stayed in `repository.ts` under a
  rewritten header is really progress/diagnostics readers, not caches.
- Slice 4: the two context-diversity helpers moved down to
  `src/db/repo/contextDiversity.ts` and the whole explainability section to
  `src/db/repo/studyItemExplainability.ts`.
- Opened but not moved: the evidence foundation. Its `recordReview` call puts
  it under the FSRS section, and `recordReview` itself ends in
  `latchSequentialUnlocksForSentence` → `latchSequentialUnlocks` →
  `getSequentialBookStatus` (sentence-led) — so either that trio moves down
  first or the latch becomes an injected post-review hook. Pick one when
  starting the FSRS slice; the trio's own deps (settings, `bookSentences`,
  sequential lib) look movable.

Approach that worked for the slices so far: move whole sections into
`src/db/repo/<area>.ts`, export every moved declaration, `export *` them from
`repository.ts`, prune imports, then `npm run check`. Keep module imports
acyclic: an extracted module must not import from `repository.ts`. The
throwaway scripts used for slice one (dependency analysis, extraction,
import pruning) lived in `/tmp` and are gone; they were ~100 lines of
TypeScript-compiler-API code each and are quick to rewrite.

Remaining sections (line numbers as of `73b6bdf`, before slices 2–4; the
explanatory notes survive, the ranges do not) and what each needs:

| Section | Lines | Depends on |
| --- | ---: | --- |
| Core: books, chapters, sentences, imports, backup, settings (1–3887) | 3,887 | planner pass reads (3 helpers), `getSavedWordStatus` |
| Progress/diagnostics readers (was "Cached alignments", 3888–4451) | ~440 now | study-item summaries (imported), grammar summaries, proficiency readers, pass reads |
| FSRS review / proficiency (4452–5512) | 1,061 | pass reads (many), `pickContextSentenceForGrammarPattern`, `latchSequentialUnlocksForSentence` |
| Evidence foundation (5513–5555) | 43 | `ensureStudyItem`, `recordReview` (see slice-4 note above) |
| Sentence-led flow (5556–7077) | ~1,460 now | pass reads, core, FSRS, alignment, `listSentenceLearningEvents` |
| Grammar patterns (7281–8746) | 1,466 | FSRS, pass reads, `getReferenceAlignment` (imported) |
| Learning Orchestrator / planner (8747–end) | ~2,400 now | core, FSRS, grammar, sentence-led |

Suggested order:

1. FSRS/proficiency and grammar (unblock `recordReview`'s latch chain on the
   way), then sentence-led, then the planner, then evidence foundation,
   leaving core in `repository.ts` (or `repo/core.ts`) last.
2. Where two sections genuinely call each other (FSRS ↔ grammar ↔
   sentence-led each have one or two such calls), move the shared helper down
   rather than importing upward.

Coordinate before starting: `repository.ts` is edited by many sessions (about
ten commits in three days). Do one section per commit and push promptly.
The `listStudyItemSummaries` thin spot is covered (`a4595e0`); re-measure
coverage (`npm run test:coverage`) to find the next one before its section moves.

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
