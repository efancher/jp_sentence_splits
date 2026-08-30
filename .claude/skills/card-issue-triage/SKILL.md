---
name: card-issue-triage
description: Use when the user asks to check, see, triage, or give an opinion on "issue reports", "card issues", "reported issues", or "review issues" — the flags they raise from ReviewPage's "Report issue" button while studying. Also use if they ask why a reading/translation/highlight looked wrong, or why review audio was cut off / silent / too short, on a review card. Pulls the open reports from Supabase and investigates the underlying study_item / vocabulary_item / sentence_vocabulary / sentence / reference_audio data to determine whether each is a real bug (and why) or a misunderstanding.
---

# Card issue triage

Learners flag review cards mid-study via ReviewPage's "Report issue" button.
Reports land in Supabase (`card_issue_reports`) and pile up for batch triage —
they are not meant to be actioned one at a time as they arrive.

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
the lemma. Now fixed via `deriveDictionaryReading` (same file) — see
docs/STATUS.md's "Vocabulary reading-mismatch bug + cleanup" entry for the
full story (the fix, three backfill/merge scripts, and a corruption scare
from an early non-idempotent version of the backfill, caught and fixed same
session).

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

`ratio` well below ~0.5 (e.g. a 694 ms clip for 草野って草野浩先生だよな。, span
3548 ms) = **truncated clip**. This is the residue of the 2026-08-29
`backfill-resegment-audio.ts` run on *Easy Japanese Drama: After Work*
(`book_30cac126-7197-4dd8-934f-53a0798c2326`): `concatCut` in
`src/lib/resegmentPlan.ts` assumes each source-fragment clip's file duration
equals its video span, so a cue spanning a gap or a short fragment gets a
collapsed cut window. A separate earlier symptom of the same run was ~27
*silent* clips (fixed by `remine-silent-shadowing-audio.ts`). ~14 more clips
in that book are truncated-but-audible and slipped past that re-mine because
its candidate filter only detects silence, not short duration.

To confirm the scope, sweep the book's `audio_reseg_*` rows (live, not
deleted) and flag any with a low duration/span ratio — write a throwaway
`scripts/_tmp_*.ts` for it.

**Fix path:** re-cut the flagged sentences from the real source at their
stored `source_start_ms`/`source_end_ms` (those values are trustworthy).
`remine-silent-shadowing-audio.ts` does exactly this operation but needs a
duration-vs-span candidate filter added (or a one-off variant), plus either
the youtube-mining service reachable or `--local-source <dir>` holding the
source audio downloaded on a residential IP. Writes new `reference_audio`
rows + soft-deletes the bad ones (an in-place update wouldn't reach devices
that already cached the bad blob).

Not every audio complaint is this bug: also check that `source_start_ms` /
`source_end_ms` themselves look sane for the sentence, and that a clip exists
at all (a card with no `reference_audio` row falls back to whatever the UI
does then — that may itself be the reported problem).

## 5. Resolution is client-side, not scriptable

There is no CLI/script path to mark a report resolved — `list-card-issues.ts`
is deliberately read-only. Resolving happens in the app itself
(`CardIssuesPage` → `resolveCardIssueReport` in `src/db/repository.ts`, writes
to Dexie and syncs up). After fixing a root cause, tell the user to mark the
corresponding reports resolved in-app; don't write a new resolve script
unless asked.
