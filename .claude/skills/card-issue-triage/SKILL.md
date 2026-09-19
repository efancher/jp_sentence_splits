---
name: card-issue-triage
description: Use when the user asks to check, see, triage, or give an opinion on "issue reports", "card issues", "reported issues", "review issues", or "sync issues"/"sync issue reports" — the flags they raise from ReviewPage's "Report issue" button while studying, or from ConflictPanel/Account & sync settings' "Report sync issue" button when sync behaves unexpectedly (e.g. "more conflicts than expected"). Also use if they ask why a reading/translation/highlight looked wrong, why review audio was cut off / silent / too short on a review card, or why they're seeing repeated/unexpected sync conflicts. Pulls the open reports from Supabase and investigates the underlying data (study_item / vocabulary_item / sentence_vocabulary / sentence / reference_audio for card issues; the bundled diagnostics snapshot and, if tagged, the specific conflicting record for sync issues) to determine whether each is a real bug (and why) or a misunderstanding.
---

# Card issue triage

Learners flag review cards mid-study via ReviewPage's "Report issue" button,
and flag sync trouble via ConflictPanel/Account & sync settings' "Report
sync issue" button (§7). Reports land in Supabase (`card_issue_reports` /
`sync_issue_reports`) and pile up for batch triage — they are not meant to
be actioned one at a time as they arrive.

## 1. Pull open reports

```bash
npm run issues:list
```

Runs `scripts/list-card-issues.ts` (read-only). Prints each open report's id,
activity type, sentence text, note, and the `study_item_id` it's attached to.

## 2. Investigate each report's actual data

Don't take the reporter's note at face value — check the underlying row. The
note tells you *what looked wrong*, not *why*. `study_items.subject_type` is
one of three values, and the id prefix on `subject_id` tells you which table:

- **`vocabularyItem`** (`subject_id` = `vocab_…`; activities `reading_retrieval`,
  `cloze`, `reading_production`, `pitch_accent`) → look up `vocabulary_items`.
  Check whether `reading` actually corresponds to `expression` — a common real
  bug (§3) is `expression` holding the dictionary form while `reading` holds a
  conjugated-surface-form reading. For `pitch_accent`, also check
  `pitch_accent_positions` and the context sentence's audio (§4).
- **`sentenceVocabulary`** (`subject_id` = `sv_…`; activities `word_listening`,
  and other in-sentence word activities) → look up `sentence_vocabulary`, which
  gives you `sentence_id`, `vocabulary_item_id`, and `surface_form` (the word as
  it appears in that sentence). Then pull *both* the `vocabulary_items` row and
  the `sentences` row. `word_listening` plays audio, so check `reference_audio`
  for that `sentence_id` (§4).
- **`sentence`** (`subject_id` = `sent_…`; activities `reading_in_context`,
  `comprehension`) → look up `sentences`. Check `translation`, `reading_only`,
  `inline_reading` for gaps.

`card_issue_reports.sentence_id` is also populated on most reports — a fast way
to jump straight to the sentence + its `reference_audio` regardless of
`subject_type`.

There's no ready-made script for this lookup — write a throwaway one. It
**must live under `scripts/`** (not `/tmp`) because
`./lib/scriptSupabaseClient` is a relative import; drop it in
`scripts/_tmp_<name>.ts`, run with `npx tsx scripts/_tmp_<name>.ts`, then
delete it. Pattern:

```ts
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const supabase = await createScriptSupabaseClient();
  const { data: items } = await supabase
    .from('study_items')
    .select('*')
    .in('id', [/* study_item ids from step 1 */]);
  for (const item of items ?? []) {
    let sentenceId: string | null = null;
    if (item.subject_type === 'vocabularyItem') {
      const { data } = await supabase.from('vocabulary_items').select('*').eq('id', item.subject_id).single();
      console.log(item.id, 'vocab', data);
    } else if (item.subject_type === 'sentenceVocabulary') {
      const { data: sv } = await supabase.from('sentence_vocabulary').select('*').eq('id', item.subject_id).single();
      console.log(item.id, 'sv', sv);
      sentenceId = sv?.sentence_id ?? null;
      if (sv?.vocabulary_item_id) {
        const { data } = await supabase.from('vocabulary_items').select('*').eq('id', sv.vocabulary_item_id).single();
        console.log('  vocab', data);
      }
    } else {
      sentenceId = item.subject_id;
    }
    if (sentenceId) {
      const { data: sent } = await supabase.from('sentences').select('*').eq('id', sentenceId).single();
      console.log('  sentence', sent);
      const { data: audio } = await supabase.from('reference_audio').select('*').eq('sentence_id', sentenceId).is('deleted_at', null);
      console.log('  reference_audio', audio);
    }
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
```

## 3. Fixed bug: expression/reading mismatch on conjugated words (2026-08-20)

Was: `suggestionFromToken` in `src/lib/vocabularySuggestions.ts` built vocab
suggestions as `expression = token.lemma` (dictionary form) paired directly
with `reading = token.reading`, where `token.reading` from the Shadowmine
morphology package is the reading of the **surface** (conjugated) text, not
the lemma. Fixed via `deriveDictionaryReading` (same file) — see
docs/STATUS.md's "Vocabulary reading-mismatch bug + cleanup" entry for the
full story (the fix, three backfill/merge scripts, and a corruption scare
from an early non-idempotent version of the backfill, caught and fixed same
session).

Since 2026-08-30 the mining/re-segment tokens also carry `lemmaReading`
(UniDic `kanaBase`, the actual dictionary-form reading), which
`suggestionFromToken` now uses verbatim — so a *new* mine gets 読む/よむ etc.
right and never needs `deriveDictionaryReading` at all. A mismatch report
therefore points at pre-2026-08-30 data.

If a *new* report looks like this pattern (dictionary-form expression paired
with what looks like a conjugated-form reading), it's most likely a case the
existing backfill couldn't auto-fix rather than a regression — check first:

```bash
npm run fix:vocabulary-reading-mismatches   # ichidan/i-adjective prefix cases
npm run fix:vocabulary-godan-readings       # godan/irregular, via JMDict
npm run merge:duplicate-vocabulary-items    # run after either fix script —
  # picks up any (expression, corrected-reading) collisions they report
```

All three are dry-run by default (`--apply` to write) and idempotent —
safe to run any time, not just right after a fix lands. The godan script
leaves genuinely ambiguous words (e.g. 行く: いく vs ゆく) unfixed on purpose;
those need a human pick, not a guess.

Separately, `combineSuggestions`/`mergeSuggestionIntoSelection` in the same
file can produce garbled combined expressions (e.g. 売るれるた喧嘩) when a
learner confirms a multi-token combine in `VocabularyPicker` without editing
it first — this is a different mechanism (not a lemma/reading mismatch) and,
since 2026-08-20, `combinedExpressionWarning` in the same file surfaces a
non-blocking hint for it in the picker UI itself. If a report references a
nonsensical multi-morpheme expression, that's almost certainly this, not the
reading bug above.

## 4. Known bug: truncated / silent reference-audio clips ("After Work"-era)

Any report whose note is about the *audio* — "cut off", "too short", "just
kssts", "only plays half the sentence", "silent" — on a `word_listening`,
`pitch_accent`, or other audio-playing card. Check `reference_audio` for the
sentence and compare the file length to the span it should cover:

```
ratio = duration_ms / (source_end_ms - source_start_ms)
```

`ratio` well below ~0.55 (e.g. a 694 ms clip for 草野って草野浩先生だよな。, span
3548 ms) = **truncated clip**. This is the residue of the 2026-08-29
`backfill-resegment-audio.ts` run on *Easy Japanese Drama: After Work*
(`book_30cac126-7197-4dd8-934f-53a0798c2326`): `concatCut` in
`src/lib/resegmentPlan.ts` was fed wrong parent clips / cue timings by
`/resegment`, so the cut window collapsed. A separate earlier symptom of the
same run was ~27 *silent* clips (fixed by `remine-silent-shadowing-audio.ts`).
18 more clips in that book were truncated-but-audible and slipped past that
re-mine because its candidate filter only detects silence, not short duration.

**Fixed 2026-08-30** by `scripts/recut-truncated-reseg-audio.ts` — all 18
`audio_reseg_*` clips re-cut and replaced with `audio_remine_*` rows. If a
*new* truncated clip turns up (in this book or another re-segmented one),
that script is the tool: it finds truncation suspects by the
duration/span ratio, then re-cuts each from the *original* pre-resegmentation
fragment clips still in Storage (their `source_start_ms`/`source_end_ms` map
1:1 to the file, no padding) via local ffmpeg — **no youtube-mining service
needed** (YouTube bot-blocks the datacenter box, so the `/jobs` re-download
path is dead). Dry-run by default, `--apply` to write, idempotent. Needs the
original fragment rows to still exist (soft-deleted is fine).

Not every audio complaint is this bug: also check that `source_start_ms` /
`source_end_ms` themselves look sane for the sentence, and that a clip exists
at all (a card with no `reference_audio` row falls back to whatever the UI
does then — that may itself be the reported problem).

## 5. Fixed bug: pitch_accent native-audio loop isolates a truncated stem, not the tested word (2026-09-14)

A report on a `pitch_accent` card saying the native-audio loop "cuts off" or
"leaves off" a trailing part of the word (e.g. "cut off at いい and left off
the ました") is **not** automatically the intentional isolate-just-the-word
design (`SegmentLoopPlayer` deliberately loops only the target word's span,
not the whole sentence — that part *is* by design). Check what reading/morae
the card is actually testing before concluding "working as intended": for a
conjugated occurrence (読みます for 読む), `resolveInflectedPitchAccent`
(src/lib/pitchAccentShift.ts) resolves the pitch test to the *whole*
conjugated reading (よみます, 4 morae, shifted per the -masu offset) — so if
the isolated/highlighted span is shorter than that reading (e.g. only よみ,
missing ます), the loop is genuinely isolating the wrong — too-short — span,
not doing its job correctly. Root cause (now fixed): `sentence_vocabulary.
surfaceForm` is sometimes stored as a truncated stem rather than the full
conjugated word (言い for 言います), and every caller of
`resolveInflectedPitchAccent` used to isolate/highlight off that raw stored
surfaceForm instead of the resolver's own fully-conjugated surface. Fixed by
adding `surfaceForm` to `ResolvedPitchAccent` and switching all four
consumers (`ReviewPage.tsx`'s `buildPitchAccentCandidate`, `AnalysisPanel.tsx`,
`repository.ts`'s `getSentencePitchAccentTargets`/
`getPitchAccentDrillSentences`) to use it. If a *new* report of this shape
turns up, compare the loop's apparent stopping point against
`resolveInflectedPitchAccent`'s `reading` for that occurrence (or just check
whether the sentence_vocabulary `surfaceForm` for that occurrence is a
strict prefix of what's actually in the sentence at that point) before
assuming it's this exact bug recurring vs. something new.

## 6. Resolution is client-side, not scriptable

There is no CLI/script path to mark a report resolved — `list-card-issues.ts`
is deliberately read-only. Resolving happens in the app itself
(`CardIssuesPage` → `resolveCardIssueReport` in `src/db/repository.ts`, writes
to Dexie and syncs up). After fixing a root cause, tell the user to mark the
corresponding reports resolved in-app; don't write a new resolve script
unless asked.

## 7. Sync issue reports (added 2026-09-04)

```bash
npm run issues:list-sync
```

Runs `scripts/list-sync-issues.ts` (read-only, same idea as
`list-card-issues.ts` but against `sync_issue_reports`). Each row has the
learner's free-text note, a `diagnostics_snapshot` (JSON string built by
`buildDiagnosticsSnapshot`, `src/sync/logger.ts` — app/sync-schema version,
online/pending/conflict counts, an `openConflicts` array of
`{entity, recordId, localVersion, remoteVersion, createdAt}` for every open
conflict at report time, `lastSyncAt`/`lastError`, and the last 20 sync log
events), and optionally `conflict_entity`/`conflict_record_id` if the report
was filed from one specific conflict card in ConflictPanel rather than the
general button in Account & sync settings.

Start with `openConflicts` in the snapshot: if the same `entity` recurs
across many reports (or many rows within one snapshot), that points at a
specific table's push/pull logic rather than one bad record — check that
entity's `LAST_WRITE_WINS_ENTITIES` membership and its mapper/engine.ts
switch cases (`src/sync/engine.ts`, `src/sync/mappers.ts`) for a version- or
payload-shape bug before assuming it's routine multi-device editing. A high
`pendingCount` alongside conflicts suggests the queue isn't draining (check
`lastError`) rather than a true edit collision. Resolution is client-side
here too (`CardIssuesPage`'s "Sync issues" section → `resolveSyncIssueReport`
in `src/db/repository.ts`) — no resolve script.

### Two recurring sync-report patterns (both fixed 2026-09-19)

- **"Lots of createdAt conflicts, nothing else differs."** A conflict diff that
  shows only a remote-only `createdAt` means the entity's mapper fills the remote
  `created_at` from a differently-named local field (`addedAt`, `importedAt`,
  `timestamp`), so the local payload never has one and `conflictContentsMatch` can
  never settle it. Fix is one entry in `ENTITY_EXTRA_KEYS` (`conflictDiff.ts`);
  `sweepNoopConflicts` then clears already-open ones next sync. Audit: any
  `created_at: x.<field>` in `mappers.ts` where `<field>` isn't `createdAt`.
- **`X: duplicate key value violates unique constraint "…_uidx" (+N more)`, status
  stuck on conflict, N pending.** A get-or-create entity was minted twice on two
  devices (different ids, same natural key), and the insert can never succeed, so it
  blocks the queue. `adoptRemoteDuplicate` in `engine.ts` recovers by adopting the
  remote row — check that the failing entity is in `DEDUP_ENTITIES`; if not, adding
  it means a natural-key lookup there plus repointing whatever references its id in
  `remapDuplicateEntityId`. Confirm on the data first: a remote row created *after*
  the reporting device's `lastSyncAt` with the same natural key is the signature.

- **`pendingQueue` in the snapshot shows the same record twice / a retryCount in the
  tens, all failing RLS.** (Snapshots carry `pendingQueue` and per-log `details` since
  2026-09-19 — read those first.) Twin rows = the old non-atomic `enqueueMutation`
  race; a link whose `refs.grammarPatternId` exists nowhere = an orphan. Both now
  self-heal (`dedupeQueueRows`, `pruneOrphanedGrammarLink`, `requeueMissingPattern`
  in `engine.ts`); if a report still shows one, the heal didn't fire — check whether
  the referenced pattern is in the device's Dexie (prune only fires when it isn't).
