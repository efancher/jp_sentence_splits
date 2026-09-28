/**
 * Correct `vocabulary_items.reading` values that were stored before
 * `suggestionFromToken` learned to fuse numerals with their counters (see
 * `japaneseNumberReading.ts`, landed in bcbf157) — e.g. 3週間 stored with
 * reading "3しゅうかん" instead of "さんしゅうかん". A bare Arabic digit in
 * `reading` is always wrong: it's meant to be a plain kana transcription, and
 * `isReadingAnswerCorrect` (readingAnswer.ts) can never match a typed kana
 * answer against a literal digit, so a `reading_production` card for one of
 * these vocab items is unanswerable (card_issue_9431a960, 3週間).
 *
 * Reuses the same `fixNumeralsInReadingOnly` string repair that
 * `fix-numeral-readings.ts` already applies to `sentences.reading_only` —
 * `vocabulary_items.reading` is the same shape (pure kana, digit + known
 * counter).
 *
 * Same duplicate-collision handling as `fix-vocabulary-reading-mismatches.ts`:
 * `vocabulary_items_owner_expr_reading_uidx` is unique on (expression,
 * reading), and the fixed reading can collide with a pre-existing correct
 * duplicate (e.g. mined a second time, or from an Anki import). Those are
 * reported separately as needing `merge:duplicate-vocabulary-items` rather
 * than written here.
 *
 * Dry-run by default; --apply required to write. Idempotent: re-running
 * finds nothing once applied.
 *
 * Usage: npm run fix:vocabulary-numeral-readings -- [--apply]
 */
import { fixNumeralsInReadingOnly } from '../src/lib/fixNumeralReadings';
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data, error } = await supabase
    .from('vocabulary_items')
    .select('id, expression, reading')
    .eq('owner_id', user.id)
    .is('deleted_at', null);
  if (error) throw new Error(`Failed to fetch vocabulary_items: ${error.message}`);

  const items = data ?? [];
  const idByExpressionReading = new Map(
    items.map((item) => [`${item.expression} ${item.reading}`, item.id]),
  );

  const toFix: { id: string; expression: string; reading: string; next: string }[] = [];
  const needsMerge: { id: string; expression: string; reading: string; next: string; duplicateOfId: string }[] = [];

  for (const row of items) {
    const reading = String(row.reading ?? '');
    const nextReading = fixNumeralsInReadingOnly(reading);
    if (nextReading === reading) continue;

    const duplicateOfId = idByExpressionReading.get(`${row.expression} ${nextReading}`);
    if (duplicateOfId) {
      needsMerge.push({ id: row.id, expression: row.expression, reading, next: nextReading, duplicateOfId });
      continue;
    }
    toFix.push({ id: row.id, expression: row.expression, reading, next: nextReading });
  }

  for (const { id, expression, reading, next } of toFix) {
    console.log(`  ${id}  ${expression}  "${reading}" -> "${next}"`);
    if (apply) {
      const { error: updateError } = await supabase
        .from('vocabulary_items')
        .update({ reading: next })
        .eq('id', id);
      if (updateError) {
        throw new Error(`Failed to update vocabulary_item ${id}: ${updateError.message}`);
      }
    }
  }

  if (needsMerge.length) {
    console.log(
      `\n${needsMerge.length} item(s) whose fix would collide with an existing duplicate (not touched — run merge:duplicate-vocabulary-items after applying this):`,
    );
    for (const { id, expression, reading, next, duplicateOfId } of needsMerge) {
      console.log(`  ${expression}: "${reading}" (${id}) duplicates "${next}" (${duplicateOfId})`);
    }
  }

  console.log(`\nDone. ${toFix.length} item(s) ${apply ? 'fixed' : 'would be fixed'}.`);
  if (!apply) console.log('Dry run — nothing written. Re-run with --apply to write.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
