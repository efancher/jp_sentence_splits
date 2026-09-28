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

  let fixed = 0;
  for (const row of data ?? []) {
    const reading = String(row.reading ?? '');
    const nextReading = fixNumeralsInReadingOnly(reading);
    if (nextReading === reading) continue;

    fixed += 1;
    console.log(`  ${row.id}  ${row.expression}  "${reading}" -> "${nextReading}"`);

    if (apply) {
      const { error: updateError } = await supabase
        .from('vocabulary_items')
        .update({ reading: nextReading })
        .eq('id', row.id);
      if (updateError) {
        throw new Error(`Failed to update vocabulary_item ${row.id}: ${updateError.message}`);
      }
    }
  }

  console.log(`\nDone. ${fixed} vocabulary_item(s) ${apply ? 'fixed' : 'would be fixed'}.`);
  if (!apply) console.log('Dry run — nothing written. Re-run with --apply to write.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
