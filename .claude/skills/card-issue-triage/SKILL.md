---
name: card-issue-triage
description: Use when the user asks to check, see, triage, or give an opinion on "issue reports", "card issues", or "reported issues" — the flags they raise from ReviewPage's "Report issue" button while studying. Also use if they ask why a reading/translation/highlight looked wrong on a review card. Pulls the open reports from Supabase and investigates the underlying study_item/vocabulary_item/sentence data to determine whether each is a real bug (and why) or a misunderstanding.
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
either `vocabularyItem` or `sentence`:

- `vocabularyItem` reports (`reading_retrieval`, `cloze`, `reading_production`) →
  look up `vocabulary_items` by `study_items.subject_id`. Check whether
  `reading` actually corresponds to `expression` — a common real bug (see
  below) is `expression` holding the dictionary form while `reading` holds a
  conjugated-surface-form reading.
- `sentence` reports (`reading_in_context`, `comprehension`) → look up
  `sentences` by `study_items.subject_id`. Check `translation`,
  `reading_only`, `inline_reading` for gaps.

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
    const table = item.subject_type === 'vocabularyItem' ? 'vocabulary_items' : 'sentences';
    const { data: subject } = await supabase.from(table).select('*').eq('id', item.subject_id).single();
    console.log(item.id, subject);
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

## 4. Resolution is client-side, not scriptable

There is no CLI/script path to mark a report resolved — `list-card-issues.ts`
is deliberately read-only. Resolving happens in the app itself
(`CardIssuesPage` → `resolveCardIssueReport` in `src/db/repository.ts`, writes
to Dexie and syncs up). After fixing a root cause, tell the user to mark the
corresponding reports resolved in-app; don't write a new resolve script
unless asked.
