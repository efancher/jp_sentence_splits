# Mining wizard rework — implementation spec

> **Status: done (2026-08-31).** W1–W6 all landed, plus a post-W6 polish
> pass: batch `POST /jobs/{id}/commit`, streaming `POST /source-audio/range`
> + the `/books/:id/resegment` boundary waveform (W6's "consider"), per-row
> audio on the segment/translate stages, and provenance-grouped
> "Auto-fill (AI)". Kept as the design record. Still deferred (own line in
> `docs/ROADMAP.md`): in-import JMnedict/Kanjium cross-check; a
> `source_audio` Supabase durability table.


Self-contained brief for implementing the staged wizard from
`docs/mining-pipeline-v2.md` §"Target architecture". Everything else in that
doc (slices A/B/C, the quality upgrades, the "lighter" review-step
increments) is **already done and deployed** — this is the last piece.

Multi-session work. Do the commit sequence below in order; each commit is
independently shippable and testable. Commit + push to `main` per
`CLAUDE.md` conventions (this repo works directly on main).

## Read first

- `docs/mining-pipeline-v2.md` — full context; §"Target architecture" is the
  wizard skeleton, §"Unifying with ResegmentSourcePage" matters for W3.
- `server/youtube-mining/app/jobs.py` — the `Job` dataclass + `_run_job`
  (one `threading.Thread`, in-process `_JOBS` dict, single-worker uvicorn —
  see the module docstring). `main.py` for the endpoints, `models.py` for
  `Cue`/`CueOut`.
- `src/pages/YouTubeMinePage.tsx` — the current linear cue-by-cue review it
  replaces. Already has: audio playback (`GET /jobs/{id}/cues/{i}/audio`,
  `?through=` for a span), `Cue.lowConfidence` flag, "+ Merge next",
  "⁄ Split". Reuse these widgets.
- `src/pages/ResegmentSourcePage.tsx` + `src/lib/resegmentPlan.ts` — the
  existing-book re-segment flow. `resegmentPlan.ts` is pure and shared:
  `seedResegmentReview`, `buildResegmentPlan`, `concatCut`,
  `distributeTranslation`, `buildRealignGroups`. `ResegmentReviewRow` is the
  row shape stage 2 edits.
- `src/lib/miningApi.ts` — client for the mining service. `src/lib/waveform.ts`
  — `peaksFromBlob`, `computePeaks`, `peaksToPolyline`, `WavePeak`;
  `src/components/LiveShadowWaveform.tsx` for a canvas render pattern.
- `src/lib/sentenceRealign.ts` + the `sentence-realign` Edge Function —
  translation redistribution, already wired into `ResegmentSourcePage`
  ("Auto-fill translations (AI)").
- Test patterns: `server/youtube-mining/tests/test_jobs_api.py` (monkeypatch
  the yt-dlp/ffmpeg/ASR edges), `tests/youtubeMine.test.tsx`,
  `tests/resegmentSourcePage.test.tsx`.
- Memories to respect: iOS audio-gesture constraint (gesture-gate audio
  setup once); `MINING_EXIT_NODE` lives only in the systemd unit env, not a
  plain shell.

## Decisions already made — do not relitigate

- **Replace `YouTubeMinePage` in place**, same route. Don't keep two flows.
  But land it stage-by-stage so the page always works between commits.
- **Job persistence: bump `JOB_TTL_SECONDS` to ~6 h** for the interactive
  window. No disk checkpointing — a swept mid-wizard job means restart, and
  the source is cached so re-download is the only cost. Defer.
- **Stage 0 (chapter/range scoping): not in v1.** Whole video only.
- **Vocab stays a *preview* at stage 4, not full confirmation.** The import
  still lands sentences with `vocabularySuggestions`; the learner confirms
  later on `VocabularyReviewPage` as today. Stage 4 just shows "this import
  will suggest N words: […]" — a count + list, no `VocabularyPicker`.
- **Translate stage: reuse `sentenceRealign` + `distributeTranslation`.**
  No fresh MT.
- Audio everywhere comes from the **cached source** via a range endpoint
  (W2), not per-cue pre-clipping.

## Commit sequence

### W1 — server job state machine

`Job` gains `stage: Literal["fetching","transcript","segment","translate","ready","error"]`
(keep `status` for back-compat or fold in) and per-stage payload fields.
Split `_run_job` so it **stops at `transcript`** after
download → cache → ASR/caption (the existing `_looks_human_captioned` /
music-gate / `asr_client` logic, minus the `resegment_cues` call). New
endpoints, each `asyncio.to_thread` for the ffmpeg/tokenize work:

- `POST /jobs/{id}/segment` `{segments:[{text,startMs,endMs}], merge, split}`
  → accept the corrected transcript, run `resegment.resegment_cues`
  (honoring the music/no-punctuation merge-skip), store cues, → `segment`
  stage. Re-runnable.
- `POST /jobs/{id}/translate` → `subtitles.load_parallel_text_from_dir` +
  (optional) an LLM redistribute hook the client can also call; returns
  rows. Re-runnable.
- `GET /jobs/{id}` → `{stage, transcript?|cues?|rows?}` for the current
  stage. `cues_out` stays for the `segment` stage payload.

Keep `POST /jobs/{id}/cues/{i}/clip` + `/audio` working (Commit still uses
per-cue clip). Bump TTL. Tests: extend `test_jobs_api.py` for the new
stage transitions.

### W2 — generic source-range audio endpoint

`GET /jobs/{id}/audio?startMs&endMs` → stream that span of the cached
source (m4a). Replaces `/jobs/{id}/cues/{i}/audio` + `?through=` (keep them
as thin wrappers or migrate callers). `miningApi.fetchJobAudioRange(jobId,
startMs, endMs)`. This is what every wizard panel plays.

### W3 — extract `<SegmentationEditor>` (refactor, no behavior change)

Pull the reviewed-row list out of `ResegmentSourcePage` into
`src/components/SegmentationEditor.tsx`: takes `ResegmentReviewRow[]` +
callbacks (mergeUp, splitRow, removeRow, edit text/translation, toggle
"reviewed"), renders the row list with the "needs translation review"
warnings and the collapsed non-progress rows. `ResegmentSourcePage` becomes
a thin wrapper that supplies rows from `seedResegmentReview` and applies via
`applyResegmentation`. Move/extend `tests/resegmentSourcePage.test.tsx`
coverage onto the component. **No user-visible change** — verify
`ResegmentSourcePage` still works in a browser (`run` skill).

### W4 — waveform + boundary drag in `<SegmentationEditor>`

Above the row list, a waveform of the reviewed span (`peaksFromBlob` on
`fetchJobAudioRange`, canvas render à la `LiveShadowWaveform`). Vertical
handles at each row boundary; dragging one updates the two adjacent rows'
`startMs`/`endMs`. A "snap to nearest pause" action — either a server
`POST /jobs/{id}/silences` (ffmpeg `silencedetect`) or client
`energyEnvelope`/`detectOnsetSeconds` from `waveform.ts`. Purely additive to
W3.

### W5 — the wizard shell

`YouTubeMinePage` → a stepper. Panels:

1. **Transcript** — editable segment list (text + `?startMs&endMs` audio +
   `lowConfidence` badge + the existing merge/split affordances, now editing
   plain segments not cues). "Apply & segment" → `POST /jobs/{id}/segment`.
2. **Segment** — `<SegmentationEditor>` (W3/W4) seeded from the job's cues.
   "Apply & translate".
3. **Translate** — EN per row + "Auto-fill translations (AI)"
   (`realignTranslations`). "Next".
4. **Commit** — existing `ShadowingPreviewCard` + "N sentences, ~M vocab
   suggestions" summary. Per-row clip happens here (`clipMiningCue` loop, or
   a new `POST /jobs/{id}/commit` that clips all rows and returns the
   bundle).

Back/forward between stages; each stage's "apply" is re-runnable. Kill the
old linear `cueIndex` march. Rework `tests/youtubeMine.test.tsx` around the
stepper.

### W6 — polish

Re-run buttons per stage, SRS-impact detail, retire dead code from the old
flow, doc + STATUS updates. Consider whether `/books/:id/resegment` should
also gain the waveform (it's the same `<SegmentationEditor>` now).

## Gotchas

- The job registry is an in-process dict; a service restart drops all
  in-flight jobs. Fine for W1–W6 (interactive, short-lived) — just don't
  assume persistence.
- `_run_job` and the stage handlers are CPU/IO-bound → `threading.Thread` /
  `asyncio.to_thread`, never bare `asyncio.create_task` (see the jobs.py
  docstring — TestClient doesn't keep a request loop alive).
- Deploy: `systemctl --user restart youtube-mining-api` on this host
  (`codex-dev`, which also runs `shadowing-analysis-api`). No CI deploy.
- `npm run check` (tsc + oxlint + vitest) and `cd server/youtube-mining &&
  .venv/bin/python -m pytest` both green before each commit. Browser-verify
  UI commits with the `run` skill.
- YouTube downloads route through a Tailscale exit node — only works when a
  personal device advertises one (`tailscale exit-node list`). For W1 tests,
  monkeypatch `youtube.fetch_audio` like the existing fixture does.
