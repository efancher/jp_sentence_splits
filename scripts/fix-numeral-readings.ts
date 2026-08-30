/**
 * Correct sentences.reading_only / inline_reading rows that left an Arabic
 * numeral unfused with its counter — "2人" read as "2にん" instead of
 * "ふたり", "1ヶ月" as "1かげつ" instead of "いっかげつ", "20歳" as "20さい"
 * instead of "はたち". A bare digit in `reading_only` (a pure kana
 * transcription) is always wrong, and it dropped straight out of ShadowPage's
 * mora/hiragana row (`segmentIntoMorae` skips non-kana).
 *
 * Originally a hand-picked per-sentence list; now driven by the shared
 * `src/lib/fixNumeralReadings.ts` (same logic `inlineReadingFromTokens` and
 * the import path use), so it stays correct as the corpus is re-mined.
 * `japanese` itself is untouched — Arabic-numeral orthography in the source
 * text is normal and not the bug.
 *
 * Dry-run by default; --apply required to write. Idempotent: re-running finds
 * nothing once applied.
 *
 * Usage: npm run fix:numeral-readings -- [--apply]
 */
import {
  fixNumeralsInInlineReading,
  fixNumeralsInReadingOnly,
} from '../src/lib/fixNumeralReadings';
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data, error } = await supabase
    .from('sentences')
    .select('id, japanese, reading_only, inline_reading')
    .eq('owner_id', user.id)
    .is('deleted_at', null);
  if (error) throw new Error(`Failed to fetch sentences: ${error.message}`);

  let fixed = 0;
  for (const row of data ?? []) {
    const readingOnly = String(row.reading_only ?? '');
    const inlineReading = String(row.inline_reading ?? '');
    const nextReadingOnly = fixNumeralsInReadingOnly(readingOnly);
    const nextInlineReading = fixNumeralsInInlineReading(inlineReading);
    if (nextReadingOnly === readingOnly && nextInlineReading === inlineReading) {
      continue;
    }

    fixed += 1;
    console.log(`  ${row.id}  ${row.japanese}`);
    if (nextReadingOnly !== readingOnly) {
      console.log(`    reading_only:   "${readingOnly}" -> "${nextReadingOnly}"`);
    }
    if (nextInlineReading !== inlineReading) {
      console.log(`    inline_reading: "${inlineReading}" -> "${nextInlineReading}"`);
    }

    if (apply) {
      const { error: updateError } = await supabase
        .from('sentences')
        .update({ reading_only: nextReadingOnly, inline_reading: nextInlineReading })
        .eq('id', row.id);
      if (updateError) {
        throw new Error(`Failed to update sentence ${row.id}: ${updateError.message}`);
      }
    }
  }

  console.log(`\nDone. ${fixed} sentence(s) ${apply ? 'fixed' : 'would be fixed'}.`);
  if (!apply) console.log('Dry run — nothing written. Re-run with --apply to write.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
