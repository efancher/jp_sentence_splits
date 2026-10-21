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
- "Fresh try" revisits: automatic ones (parked checks, spaced schedule) are capped
  at `EXPLORE_REVISITS_PER_BOOK` per book per plan; ones requested via the review
  card's "Fresh try this sentence" button are exempt from that cap and drafted
  first. The glossing time budget still bounds the total. A Fresh try counts as
  done (spacing advances, a pending request clears) once its walkthrough is
  finished on a later day than the first; a "say it" attempt is optional.
  Previously only `expression_attempt` counted, so the same sentences were
  re-drafted daily and crowded out new lessons (2026-10-21).
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
- Audio reviews offer `ear_tiles`, then `dictation_tile:N` after Ear Tiles has
  two reviews and is out of learning/relearning. Whole-sentence dictation is
  retired. Typed-match feedback never chooses the FSRS rating.
  Ear Tiles accepts up to nine tiles and merges splits of ten to twelve tiles
  down to nine by joining the shortest neighbours, retaining inner punctuation.
  Single-tile dictation keeps the raw split and its nine-tile limit.
- Reader, Analyze, review and Shadow support chapter layouts. The reader has
  per-sentence play/loop, new-word furigana and optional phrase/construction
  explanations. Episode preparation accepts the main JSON and structure lines
  together. Source-matched extras live in `sentence_extras`, with a read-only
  overlay for older inline book data.
- Progressive glossing and ungraded clause questions are available. Source
  matching invalidates stale questions and review notes. Reactions now sync via
  `clause_question_feedback`; old local reactions are imported once. Use
  `questions:coverage` for a fresh active-book inventory rather than historical
  counts. Independent reference review is still required before auto-grading.
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
- Book/chapter suspension, sentence-stage progress, chapter-level conflict
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
Reference-audio storage moved toward Cloudflare R2 (2026-10-20): all 2,847 live
clips were copied and verified, the gateway Worker is deployed, and new uploads
from the deployed app go to R2 (reads try R2 first, then Supabase). Supabase still
holds its copies, so its storage use has not dropped yet; deleting them needs
approval. Open items (usage monitor, budget alert, scripts still writing to
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

- **Imports and extras (2026-10-20):** chunk/walkthrough drafts are stored per
  chapter in `sentence_extras`. New standalone shadowing imports now get a
  chapter, a quick import that cannot save its extras says so on the book page,
  merging a book into another carries its extras, and Quick import has an "Add to
  book" selector (a new chapter of any non-archived book). Standalone books
  imported earlier have no chapter and no drafts; run "Generate extras with the
  assistant" after moving them. `repair:orphaned-sentence-extras` (dry-run by
  default) repoints drafts left on a deleted book; its first production dry run
  found none.

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
