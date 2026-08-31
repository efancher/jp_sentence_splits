# Status

Current-state snapshot. For the chronological blow-by-blow (files touched,
test counts, code-review findings, production-run logs) see
`docs/STATUS_ARCHIVE.md` and git history. For the feature-oriented
reference see `docs/AI_OVERVIEW.md`; for the at-a-glance phase list see
`docs/ROADMAP.md`.

Last updated: 2026-08-31.

## Where things stand

The original roadmap (Phases 0–9) is complete. All numbered phases plus
the later standalone efforts (Learning Orchestrator, re-segmentation,
vocabulary glossing, WaniKani mnemonics, contextual conjugation cards,
progressive listening, grammar-learning system Phases 1–9-slice) are
shipped and, in almost every case, verified against production data by the
user directly. Roughly 68 Python / ~1066 TS test files, green.

Active work is **Mining pipeline v2** — the last remaining roadmap item.
Its three quality slices (A: ASR transcript, B: full UniDic
form/reading/accent, C: retained source audio) and the staged wizard
(W1–W6) all landed 2026-08-31. What's left is deferred polish (below).

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
| 9 — Shadowing pronunciation/prosody feedback | done, all 9 milestones |
| Learning Orchestrator | done; daily-session model, vocab-confirm priority |
| Re-segment an existing source | done; run against "After Work" 2026-08-29 |
| Vocabulary meaning glossing | done; JMDict/JMnedict offline + `vocab-assist` Edge Function |
| WaniKani mnemonics | done, deployed 2026-08-29/30/31 (vocab + kanji + subject cache) |
| Contextual conjugation cards | done; migration live 2026-08-30 |
| Progressive listening (`word_listening`) | done 2026-08-30 |
| Mining pipeline v2 | slices A/B/C + wizard W1–W6 done 2026-08-31; polish deferred |

Phase-by-phase detail is in `docs/STATUS_ARCHIVE.md`; the ROADMAP entries
carry a one-paragraph summary each.

## Open / deferred

**Mining pipeline v2 polish:**
- `/books/:id/resegment` waveform — `ResegmentSourcePage` shares
  `<SegmentationEditor>` and the resegment transforms with the wizard but
  not the waveform; that wants a streaming source-range endpoint rather
  than the base64 `/source-audio/clip` it currently has.
- In-import JMnedict/Kanjium reading cross-check (morphology emits
  UniDic form/reading/accent directly now; a dictionary second opinion at
  import time is still unbuilt).
- Durability-only: a `source_audio` Supabase table + Storage mirror so the
  LRU source-audio cache can restore without re-hitting YouTube.

**Not yet browser-verified** (typecheck/build/tests green, and the sandbox
has no browser system libs):
- Mining wizard W1–W6 (covered by integration tests + build + typecheck).
- Contextual conjugation cards (`sentence_transformation` rework).
- Progressive listening `word_listening` cards.

**Data / content backlog:**
- **Review new-card backlog** — ~193 confirmed vocab words have no SRS
  card; the planner can't see the backlog, seeds too slowly, and the
  session review step can auto-complete before the queue drains. Needs a
  planner fix, not just a one-off seed.
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
- Cross-sentence shadowing learner profile (Phase 9's one still-open
  milestone; brief's Phase 15).
- Audio-less pitch-accent production/recording drill mode (practice pitch
  accent on Satori sentences that have no reference audio) — distinct from
  the shipped passive `pitch_accent` SRS card.
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
