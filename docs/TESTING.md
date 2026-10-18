# Test coverage and maintenance review

Reviewed 2026-10-18 against main at `024a4e9`, with the maintenance changes on
`codex/test-coverage-cleanup`. These are local verification results; they do not
certify deployed services or production data.

## Verified results

| Check | Result |
| --- | --- |
| Unit/component suite with V8 coverage | 253 files passed; 2,738 tests passed, 12 skipped |
| Mining backend, offline suite | 171 passed |
| Real Postgres/PostgREST integration | 3 files, 10 tests passed |
| Chromium + WebKit | All 43 executable cases passed across the full run and reader rerun; 4 private-fixture cases skipped |
| TypeScript and production build | Passed (`npm run build`) |
| Lint | Passed, with 36 existing warnings and no errors |

The final full browser run had 42 passes and one WebKit reader-reload timeout.
It overlapped a replacement of the preview build. All eight reader cases then
passed against the completed build, in both browsers at phone and desktop
widths. Treat this as a verification caveat, not proof that the timeout cannot
recur. Build before starting the suite and leave that preview unchanged.

The ordinary unit run skips the 10 Postgres integration tests (run separately
above), one private personal-export smoke test, and one cross-repository
aligner-parity check when the sibling Python file is unavailable. The four
optional real-chapter browser cases require a private fixture. The synthetic
fixtures cover the regular browser suite without account or service secrets.

## Measured application coverage

`npm run test:coverage` explicitly includes every `src/**/*.{ts,tsx}` module,
including modules the tests never import. Only test files, declarations and
`src/test` helpers are excluded. Browser execution is not merged into these
Vitest percentages. Python, scripts and Edge Functions are outside this
application-source metric; the backend and SQL checks above are separate.

| Metric | Coverage |
| --- | --- |
| Lines | 71.83% (18,383 / 25,590) |
| Statements | 70.44% |
| Functions | 67.00% |
| Branches | 61.62% |

| Area | Lines | Branches |
| --- | ---: | ---: |
| Learning/import/audio helpers (`src/lib`) | 89.30% | 80.02% |
| Database/repository (`src/db`) | 90.52% | 74.78% |
| Components | 52.60% | 45.89% |
| Pages | 51.08% | 46.61% |
| Sync | 43.65% | 47.80% |

Previously, the default coverage calculation only counted imported modules, so
its higher percentage was not directly comparable. Coverage is reported as a
baseline; no arbitrary global percentage threshold was added. Use the generated
`coverage/index.html` and `coverage/coverage-summary.json` to inspect gaps. CI
retains these artifacts for seven days.

## Changes made during this review

- Added five sign-in recovery tests: local-only access, loading/session loss,
  deliberate sign-out, offline dismissal and failed sign-in retry. A rejected
  sign-in promise now displays an error and releases the busy state.
- Added four tests through the real review page and IndexedDB for the default
  sentence-led audio ladder: introduction gating, Ear Tiles before dictation,
  explicit self-rating, typed-answer evidence, duplicate-submit protection and
  the relearning lock. Playback is stubbed in these component tests.
- Updated browser fixtures/assertions for the sentence-led default, walkthrough
  structure checks and current clause questions. Legacy word-card review cases
  explicitly select their intended learning mode. Completing a walkthrough
  introduces one sentence card without recording a review.
- Fixed the Playwright fixture callback's false React-hook lint error. Removed
  unused test bindings, the unreferenced SVG puzzle-path renderer and the unused
  sync export barrel. Active game code, older learning modes and repair tools
  remain available.
- Expanded CI from a browser subset and eight assist-run checks to the full
  configured browser suite and all offline backend tests. Added coverage
  reporting and lint to the existing typecheck/build workflow. Relevant pull
  requests now trigger the real-Postgres workflow too.

## Remaining priorities

1. **Sync recovery and audio transfer.** `sync/engine.ts` has 34.24% line
   coverage and `audioSync.ts` 5.96%. Queue/conflict and real-RLS tests already
   provide useful protection, but do not establish browser behavior across token
   expiry, offline reconnects, interrupted uploads, partial restores and multiple
   devices. `ConflictPanel` and auth/sync settings also have little UI coverage.
2. **Import UI orchestration.** `QuickMinePage` and `NhkEasyImportPage` have no
   Vitest line coverage. Helpers and backend routes are tested; browser checks
   should exercise resumable imports, partial assistant results and failure
   recovery through the actual screens. Source-cache tests stub the backup
   boundary and cover disabled configuration; enabled Storage upload/restore
   and a configured service round trip remain gaps.
3. **Games and secondary screens.** Most game rules have pure tests, while many
   playable components have almost no component coverage. Add outcome-focused
   browser checks for weak pools, replay, completion logging and unchanged FSRS
   state. Difficulty screening, easiest-first sorting and Shadow mark/loop
   controls also retain browser gaps in the roadmap.
4. **Real audio and devices.** Synthetic native-pitch tests cover playback,
   highlighting, recording and stopping on close. They do not establish acoustic
   correctness, real microphone behavior or physical-iPhone reliability. The
   private chapter cases and sibling aligner parity check remain optional checks
   to run when their inputs are available.

Low coverage alone is not evidence of dead code. Keep active but uncovered
screens and optional learning paths. Lint's remaining warnings include hook
dependencies and component-export conventions; inspect them when changing
those areas rather than applying mechanical fixes during this cleanup.

## Reproduce

From the repository root, with dependencies installed:

```bash
npm run test:coverage -- --maxWorkers=2
npm run build
npm run lint
npm run test:pg
npm run test:e2e -- --project=chromium --project=webkit --workers=1
```

Postgres tests require Docker. Browser tests require Playwright's browsers and
system libraries; see [the container setup](../e2e/README.md) when host libraries
are unavailable. Remove the example's single-spec argument to run the whole
suite. Use synthetic/local-only data and a completed, unchanged preview build.

From `server/youtube-mining`, in a Python environment with ffmpeg available:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -m "not slow" -q
```

The backend's `slow` marker identifies real YouTube/yt-dlp network integration.
The reported run used the offline suite. Browser/backend
and Postgres workflows run independently of Pages deployment; making them
deployment gates remains an explicit roadmap option.
