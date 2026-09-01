# Status

Current-state snapshot. For the chronological blow-by-blow (files touched,
test counts, code-review findings, production-run logs) see
`docs/STATUS_ARCHIVE.md` and git history. For the feature-oriented
reference see `docs/AI_OVERVIEW.md`; for the at-a-glance phase list see
`docs/ROADMAP.md`.

Last updated: 2026-09-01.

## Where things stand

The original roadmap (Phases 0–9) is complete. All numbered phases plus
the later standalone efforts (Learning Orchestrator, re-segmentation,
vocabulary glossing, WaniKani mnemonics, contextual conjugation cards,
progressive listening, grammar-learning system incl. `grammar_production`)
are shipped and, in almost every case, verified against production data by
the user directly. ~1117 TS tests, green.

**2026-09-01 pass** (see Recent changes): planner new-card-backlog
awareness, cross-sentence pronunciation profile (`/pronunciation`, closes
Phase 9's last milestone), grammar production ladder (`grammar_production`),
`reading_in_context` passage framing (closes the Phase 4 differentiation
gap), the retention/progress screen (`/progress`), the audio-less
pitch-accent drill (`/pitch-accent`), and a ROADMAP compaction. Only
remaining planned work: re-mine "After Work" (browser + human review).

**Mining pipeline v2** — slices A/B/C + wizard W1–W6 landed 2026-08-31;
what's left is one deferred durability item (below).

## Recent changes

(New detail lands here; swept into `STATUS_ARCHIVE.md` next time this file
is trimmed.)

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
| WaniKani mnemonics | done, deployed 2026-08-29/30/31 (vocab + kanji + subject cache) |
| Contextual conjugation cards | done; migration live 2026-08-30 |
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

**Not yet browser-verified** (typecheck/build/tests green, and the sandbox
has no browser system libs):
- Mining wizard W1–W6 (covered by integration tests + build + typecheck).
- Contextual conjugation cards (`sentence_transformation` rework).
- Progressive listening `word_listening` cards.
- Cross-sentence pronunciation profile (`/pronunciation`).
- Planner new-card backlog reservation + ReviewPage seed-hold.
- Grammar production card (`grammar_production`).
- `reading_in_context` passage framing (`ReadingInContextCard`).
- Progress screen (`/progress`).
- Audio-less pitch-accent drill (`/pitch-accent`).

**Data / content backlog:**
- **Review new-card backlog** — ~193 confirmed vocab words have no SRS
  card. The planner fix landed 2026-08-31 (see Recent changes): the review
  bucket now reserves minutes for the backlog and the review step stays
  open through seeding, so ~`newCardsPerSessionLimit` new words enter per
  daily session instead of a handful. Still drains over multiple sessions
  by design; raise the limit in Settings to go faster. Diagnostic:
  `scripts/analyze-due-by-book.ts`.
- **Auto-caption fragmentation re-mine** — pre-2026-08-23 shadowing
  imports (After Work, First Day at Work, GLIM SPANKY) were systemically
  mis-segmented (auto-captions, no punctuation). Bulk re-mine through the
  new ASR pipeline is planned, not done.
- **Pitch-accent gaps** — after Kanjium + UniDic gap-fill, ~79
  `vocabulary_items` still have no `pitch_accent_positions`.
- **4 noun homograph pairs** left with two live readings each (何 なに/なん,
  羽 はね/わ, 話 はなし/わ, 後 あと/ご) — both valid; user is waiting to see
  if the duplication is annoying in practice before merging.

**Infra:**
- Mac Tailscale exit node for mining downloads still TODO (phone verified
  working 2026-08-30; datacenter mining box is YouTube bot-blocked, so
  downloads route through a personal-device exit node).

**Larger not-started items (deliberate, reasoning in the archive):**
- PASQA speech-quality model — architecture left ready; blocked on
  PyTorch+s3prl footprint on the memory-constrained analysis host.

## Services

- `server/youtube-mining` (FastAPI, `systemctl --user`, this repo) — mining
  pipeline, `/resegment`, `/reclip`, source-audio cache, job wizard.
- `~/projects/shadowing-analysis-api` (separate repo, Hetzner box,
  `systemd --user`, tailnet-only via `tailscale serve`) — MFA forced
  alignment, `faster-whisper` ASR (`base` diagnostic + `large-v3-turbo`
  source transcription).
- Supabase — single shared project, table-prefix-isolated from the retired
  `shadowing` repo. Always soft-delete synced tables (`deleted_at`), never
  raw `DELETE`, or clients never learn of the change.
- Edge Functions — `grammar-assist`, `vocab-assist` (Claude Haiku).
