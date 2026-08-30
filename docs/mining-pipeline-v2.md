# Mining pipeline v2 — design

Status: **proposed** (2026-08-30). Supersedes nothing yet; the current
pipeline (`server/youtube-mining/`, `src/pages/YouTubeMinePage.tsx`,
`src/pages/ResegmentSourcePage.tsx`) keeps working until slices land.

## Why

Every recent mining defect traces to one root cause: **YouTube auto-caption
tracks are treated as the source of truth for Japanese text.** They:

- carry no reliable kanji → poisons vocab `expression`, pitch-accent lookup
  (needs kanji + reading), furigana, comprehension cards;
- carry no punctuation → which is exactly what `resegment.py`'s merge/split
  keys on, so the segmenter is inert on the input that needs it most (this
  is why "Easy Japanese Drama: After Work" imported so badly fragmented);
- mis-transcribe proper nouns (し吾→しんご, ひし→ひろし, 水希→みさん) — names
  are high-value vocab and a re-download pulls the *same* track, so they
  never improve.

Secondary issues:

- The mine review UI (`YouTubeMinePage`) lets you edit cue text but **you
  can't hear the audio while reviewing** (the clip is only cut *after* you
  commit the cue) and **can't re-split a cue** — so mis-transcriptions are
  invisible and segmentation is frozen before you ever see it.
- Segmentation is batch-then-review: download → resegment → align all run
  before the human sees anything, so alignment/readings are computed against
  an unverified transcript.
- `align_parallel_text` maps EN→JA cues by time overlap; any segmentation
  shift bleeds English across sentences.
- The job's source audio is swept after 2 h. Both 2026-08-30 audio incidents
  (27 silent clips, 18 truncated clips) needed painful reconstruction because
  the pristine source was gone; `applyResegmentation` re-cuts from *fragment*
  clips (lossy, seam artifacts, the `concatCut` no-padding assumption that
  caused the truncation bug).
- `readings.py` / `morphology.py` run on `unidic-lite` — the small dictionary
  — which is why `deriveDictionaryReading` + three backfill scripts +
  `backfill-pitch-accent.ts` all exist to clean up after it.

## What the mined content feeds

Keep these consumers in mind for every change — a defect in the transcript
propagates to all of them:

| Consumer | Needs |
| --- | --- |
| Shadowing practice | accurate sentence-level audio clip; clean speech-onset/offset boundaries; reference prosody (pitch/timing/mora, via `shadowing-analysis-api` MFA) |
| Vocabulary SRS (`cloze`, `reading_retrieval`, `reading_production`) | correct `expression` (kanji), dictionary `reading`, `meaning`, POS |
| `pitch_accent` cards | correct reading → Kanjium/UniDic accent position |
| `word_listening` / `listening` | word-level audio spans *within* the sentence (forced alignment) |
| `reading_in_context` / `comprehension` | correct `japanese` + `inlineReading` furigana + `translation` |
| Grammar glossing | correct text + stable character offsets |
| Contextual conjugation (`sentenceVocabulary`) | the exact conjugated **surface form** as spoken |

## Target architecture: a staged, re-runnable pipeline

Replace the single `_run_job` thread + flat review with an explicit state
machine. Each stage is re-runnable, its output feeds the next, and audio is
always one tap away in the UI.

```
0 Scope      pick chapters / a time range (optional)
1 Transcript ASR or captions, per-segment audio + confidence flags → human fixes text
2 Segment    resegment on the *corrected* transcript; waveform + silence markers; drag/merge/split
3 Translate  EN aligned to *final* boundaries; sentence-realign auto-runs; human tweaks
4 Vocabulary POS-filtered suggestions w/ sentence audio + span highlight; dictionary/accent cross-check; "creates N SRS cards"
5 Commit     existing import preview + SRS-impact summary
```

### Job state machine (server)

`Job` gains `stage: Literal["scope","transcript","segment","translate","vocab","commit","error"]`
and holds the artifacts of each completed stage. New endpoints operate on a
live job:

- `POST /jobs` `{url}` → downloads audio + subtitle tracks, runs ASR if
  enabled, stops at `transcript`. (No auto-resegment.)
- `GET  /jobs/{id}` → current stage + that stage's payload.
- `GET  /jobs/{id}/audio?startMs&endMs` → streamed byte range of the source
  (for inline playback in every stage — replaces per-cue pre-clipping).
- `POST /jobs/{id}/transcript` `{segments:[{text,startMs,endMs}]}` → accept
  human-corrected transcript, advance to `segment`.
- `POST /jobs/{id}/segment` `{merge,split, edits?}` → run `resegment.py` on
  the stored transcript, advance to `translate`. Re-runnable.
- `POST /jobs/{id}/translate` → align EN to current boundaries + run
  `sentence-realign`; returns rows. Re-runnable.
- `POST /jobs/{id}/vocab` → tokenize final sentences, return suggestions +
  per-token dictionary-membership / reading-confidence flags.
- `POST /jobs/{id}/commit` → cut all clips from the (retained) source, bundle
  the shadowing-package payload the client imports today, and persist the
  compressed source (see "source retention").
- `DELETE /jobs/{id}` unchanged.

Bump `JOB_TTL_SECONDS` for interactive jobs, or checkpoint stage artifacts to
`JOBS_ROOT` so a swept job can resume.

### Client

A wizard replacing `YouTubeMinePage`'s linear cue march — one panel per
stage, back/forward, "re-run this stage." The stage-2 panel is
`ResegmentSourcePage`'s merge/split UI (see unification below). Stage 4 is
the existing `VocabularyPicker`, run at mine time.

## The three quality upgrades (slot into the stages)

### A. ASR transcript (stage 1 primary; captions the fallback)

**[done 2026-08-30]** `shadowing-analysis-api` gained `POST /transcribe-source`
(`asr.transcribe_source`) — Whisper `large-v3-turbo`
(`ANALYSIS_SOURCE_WHISPER_MODEL`), timed segments
`{text,startMs,endMs,avgLogprob,noSpeechProb}`. Separate lazily-loaded model
instance (the `base` diagnostic `/transcribe` keeps its ~270 MB footprint),
released after each run (`ANALYSIS_SOURCE_WHISPER_UNLOAD`, reclaims ~half of
turbo's ~1.8 GB — CT2 pools the rest). The mining service
(`app/asr_client.py`) POSTs the cached Opus; `_run_job` uses those cues in
place of the caption track, falling back to captions on any failure
(`MINING_USE_ASR_TRANSCRIPT=0` forces captions).

**Model choice:** started at `small` — too weak on Japanese kanji (同い年 →
おないどし, 敬語 → 傾語, 担任 → 単人). `large-v3-turbo` has only 4 decoder
layers so on CPU it's no slower (~1.5–3.6× realtime measured) but gets those
right, plus better names (佐藤裕二, 上村玲香). Peaks ~1.84 GB RSS.
`large-v3` is one env var away for max quality (much slower on CPU).

**VAD:** `vad_filter=True` first, but Silero VAD classified a whole *song*
track as non-speech and dropped everything (GLIM SPANKY → 0 segments), so
`transcribe_source` retries with VAD off when the first pass is empty.

The **punctuation is the structural win** — `resegment.py` merge/split
finally has boundaries. Names still get fumbled by every source; that's what
the review step (with audio) is for.

Still open:
- ~~Confidence flags in the UI~~ **[done 2026-08-30]** — a shaky segment
  (`avgLogprob < -0.55` or `noSpeechProb > 0.6`) becomes `Cue.lowConfidence`,
  OR'd through merge/split, shown as a "⚠ check against the audio" line in
  the review step.
- ~~Manual-caption preference~~ **[done 2026-08-30]** — `_looks_human_captioned`
  (≥50% of ≥5 cues end on sentence punctuation) → use the caption track and
  skip ASR entirely (correct kanji/names, and instant vs minutes).
- ~~Songs~~ **[done 2026-08-30]**: yt-dlp `info["categories"]` carries
  `"Music"` for a music upload (verified). A Music upload → use the JA
  caption track (synced lyrics) and skip ASR if one exists; always skip the
  merge pass so lines don't fuse. A punctuation-free transcript from any
  source also skips merge. (A song with *no* lyrics track still gets rough
  ASR — Whisper mangles dense music — but the reviewer has the audio.)
- ~~`word_timestamps=True`~~ **[done 2026-08-30]** —
  `/transcribe-source` returns per-word timings; `split_multi_sentence_cues`
  cuts a multi-sentence cue (~17% of turbo segments) at the real word gap.
  Costs ~2.5–3× transcription time (2m20s → 6m20s / 8-min source);
  `ANALYSIS_SOURCE_WORD_TIMESTAMPS=0` disables it.

### B. Dictionary-form reading + accent from UniDic (stages 1, 4)

**Finding (2026-08-30):** `unidic-lite` *already* exposes `kanaBase` (the
dictionary-form reading — 読ん→ヨム, not the surface ヨン) and `aType` (the
pitch-accent nucleus mora). No need to swap to full `unidic` (~250 MB) —
the mining service just wasn't reading those fields.

- **[done 2026-08-30]** `morphology.py` now emits `lemmaReading`
  (`kata2hira(kanaBase)`) alongside the surface `reading`. Client
  `suggestionFromToken` (`vocabularySuggestions.ts`) uses it verbatim,
  falling back to `deriveDictionaryReading` only when it's blank (older
  data). This is the case the whole `deriveDictionaryReading` +
  `fix-vocabulary-reading-mismatches` + `fix-vocabulary-godan-readings`
  chain existed to paper over — a *new* mine now gets 読む/よむ, 見つける/みつける,
  行く/いく, 書く/かく right at import. `test_morphology.py`,
  `vocabularySuggestions.test.ts`.
- **[done 2026-08-30]** `aType` → pitch accent, but *not* in the import path
  (`backfill-pitch-accent.ts` is fill-only-empty, so a mining-set accent
  would wrongly outrank Kanjium). Instead `MorphemeToken.accentType` +
  `scripts/backfill-vocabulary-pitch-accent-unidic.ts`, a gap-fill that runs
  *after* Kanjium: single dictionary-form content token, reading agrees,
  integer aType, no proper nouns. Filled 46 production items.
- **remaining:** JMnedict proper-noun reading check + Kanjium cross-check
  *inline* (both in `scripts/lib/` today, post-hoc). Bigger — needs the
  datasets available to the Python service.
- **maybe:** `READING_OVERRIDES` (1 entry) → a small curated table of
  context-ambiguous readings (何 なに/なん, 方 かた/ほう…). Low frequency;
  `kanaBase` doesn't help here (it's a fugashi-context problem).

### C. Retain source audio per book (stage 5)

On commit, upload a compressed Opus of the full source (~1 MB/min → 5–15 MB
per book) so every future re-cut / boundary-nudge / re-segment comes from
pristine source instead of fragment clips.

- **Data model:** new `source_audio` table (`book_id` PK-ish, `storage_path`,
  `mime_type`, `duration_ms`, `source_url`, `checksum`) synced the same way
  `reference_audio` is (local blob + Supabase Storage via the sync engine;
  see `src/sync/engine.ts`, `applyRemoteUpsert`). Local-blob-optional like
  reference audio — a device without it falls back to on-demand fetch.
- **Who uploads:** the client, during commit — `GET /jobs/{id}/source-audio`
  returns the Opus, the import writes the `source_audio` row + Storage blob.
  (The Python service has no Supabase credentials and shouldn't get them.)
- **Payoff:** `applyResegmentation` cuts from source (drop the fragment-clip
  `concatCut` path entirely); both 2026-08-30 audio incidents would have been
  one script run. `recut-truncated-reseg-audio.ts` /
  `remine-silent-shadowing-audio.ts` become obsolete for any book that has
  a retained source.

## Unifying with `ResegmentSourcePage`

The re-segment-existing-book flow and mine stage 2 are the same operation
(re-split cues on real boundaries, migrate study progress). After v2:

- Stage 2's boundary editor is the shared component (merge up / split /
  remove / drag-on-waveform), used by both the wizard and `/books/:id/resegment`.
- `src/lib/resegmentPlan.ts` (`buildResegmentPlan`, `concatCut`,
  `seedResegmentReview`) is already pure and shared — keep it.
- `applyResegmentation` in `repository.ts` stays the apply path for the
  existing-book case; the new-book case keeps using the shadowing-import
  path. Difference is only "migrate FSRS/vocab links onto new sentences"
  (existing book) vs "create fresh" (new).
- Once every fragmented book is re-segmented (After Work done; First Day at
  Work needs only 2 translation edits; GLIM SPANKY is a 20-line song), the
  standalone `/resegment` route can stay as a maintenance tool but stops
  being load-bearing.

## Implementation order (each slice independently shippable)

1. **C — source retention.** Smallest, no UX change, immediately de-risks
   re-cuts.
   - **[done 2026-08-30]** server foundation: `app/source_cache.py` — a
     persistent per-video Opus cache outside the job sweep, populated on
     every successful mine; `POST /source-audio` (ensure), `GET
     /source-audio/{videoId}` (stream), `POST /source-audio/clip {url,cuts}`
     (cut absolute spans). `tests/test_source_cache.py`.
   - **[done 2026-08-30]** `applyResegmentation` (`src/db/repository.ts`)
     now cuts each new sentence straight from the source via
     `miningApi.clipFromSource` → `POST /source-audio/clip` when the book has
     a reachable `sourceUrl`, falling back to the `concatCut` fragment path
     only on failure. `scripts/backfill-source-audio.ts` primes the cache
     for pre-existing books — run `--apply` for all 3 shadowing books
     (After Work, First Day at Work, GLIM SPANKY).
   - **remaining (durability only):** the mining box's cache is the source
     of truth and self-heals via re-download, so it's optional — a
     `source_audio` Supabase table + Storage mirror (`reference-audio`
     bucket, `source/{videoId}.opus`) so `source_cache.ensure` can restore
     from Storage instead of re-hitting YouTube if the box disk is wiped.
     Cloud-only table (like `wanikani_subjects`), client writes it at import.
2. **B — dictionary-form reading (`lemmaReading` from UniDic `kanaBase`).**
   **[done 2026-08-30]** — the conjugation reading-mismatch class is fixed
   at the source for new mines. `aType` pitch accent + inline JMnedict/Kanjium
   still open (see slice B section).
3. **Stage 1 + 2 as the interactive core.** Job state machine, `/audio`
   range endpoint, transcript + segmentation panels with inline playback and
   waveform. Auto-captions still the text source at this point.
   - **[done 2026-08-30]** increments on the current cue-review step (no
     state machine yet): plays the cue's audio (`GET
     /jobs/{id}/cues/{i}/audio`); shows the low-confidence flag;
     **"+ Merge next"** folds the following cue in (`?through=` audio
     preview, Keep & clip spans the merged range). Still to do here:
     manual split (auto-only today), then the full staged wizard.
4. **A — ASR.** **[done 2026-08-30]** `POST /transcribe-source` on
   `shadowing-analysis-api` (Whisper `small`); mining `_run_job` uses it as
   the cue source, captions as fallback. Confidence flags not surfaced yet;
   manual-caption preference + song gating still open (see slice A section).
5. **Stages 3–5 polish.** `sentence-realign` at mine time, vocab picker at
   mine time, SRS-impact summary, `ResegmentSourcePage` component merge.

Slices 1–2 are pure wins with no redesign. 3 is the redesign. 4–5 build on it.

## Open questions

- ASR box choice: extra load on the Hetzner analysis box vs a model on the
  datacenter mining box. Lean Hetzner (RAM headroom, model already there).
- Whisper model size vs accuracy vs the Hetzner box's real budget for
  *concurrent* alignment + ASR + this.
- Retained-source format/bitrate — Opus 24–32 kbps mono is plenty for
  re-clipping speech; verify against a shadowing clip A/B.
- Do we re-mine "After Work" fresh once ASR lands (cleaner text: 水希 not
  みさん) or leave it? Progress-migration from a fresh mine has no smooth
  path today — probably leave it, fix names by hand.
- Migration cost for `source_audio` on the sync protocol (new synced table
  → client version bump, `applyRemoteUpsert` case, backup-exclusion note
  like reference audio).
