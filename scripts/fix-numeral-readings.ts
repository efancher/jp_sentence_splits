/**
 * One-time correction for sentences.reading_only / inline_reading rows that
 * left a raw Arabic numeral in place instead of converting it (and its
 * counter suffix) to kana — e.g. "2人" read as "2にん" instead of "ふたり".
 * `reading_only` is meant to be a pure kana transcription (used as the
 * karaoke card's pronunciation-aid line, among other things — see
 * KaraokeSentenceText), so a bare digit in it is always wrong; `japanese`
 * itself is untouched, since Arabic-numeral orthography in the source text
 * is normal and not the bug.
 *
 * Found live via a card issue report on それより2人とも家どこなの? (whose
 * reading showed "2にん" instead of the natural "ふたり") and confirmed a
 * corpus-wide sweep for digits in reading_only: 13 sentences affected, 14
 * occurrences. Each replacement below was picked by hand for its specific
 * counter (人/つ/ヶ月/年生/分), including the irregular native readings
 * (1人 ひとり/2人 ふたり, 1つ ひとつ/2つ ふたつ) rather than a generic
 * digit->on'yomi rule, since a general converter would get those wrong.
 *
 * Not a recurring backfill — a general Japanese-numeral-to-kana converter
 * is future scope (see docs/ROADMAP.md) if more cases turn up; this just
 * corrects the rows found by this sweep.
 *
 * Dry-run by default; --apply required to write. Idempotent: only applies
 * a replacement when the old substring is still present.
 *
 * Usage: npm run fix:numeral-readings -- [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

interface Correction {
  id: string;
  readingOnly: [string, string];
  inlineReading: [string, string];
}

const CORRECTIONS: Correction[] = [
  { id: 'sent_f556df70', readingOnly: ['2にんで', 'ふたりで'], inlineReading: ['2 人[にん]で', '2人[ふたり]で'] },
  { id: 'sent_038bee03', readingOnly: ['2にんとも', 'ふたりとも'], inlineReading: ['2 人[にん]とも', '2人[ふたり]とも'] },
  { id: 'sent_dd8267b8', readingOnly: ['1つじゃん', 'ひとつじゃん'], inlineReading: ['1つじゃん', '1つ[ひとつ]じゃん'] },
  { id: 'sent_91461df5', readingOnly: ['1かげつだよ', 'いっかげつだよ'], inlineReading: ['1 ヶ月[かげつ]だよ', '1ヶ月[いっかげつ]だよ'] },
  { id: 'sent_3d7f41d8', readingOnly: ['こうこう3ねんせい', 'こうこうさんねんせい'], inlineReading: ['高校[こうこう]3 年生[ねんせい]', '高校[こうこう]3年生[さんねんせい]'] },
  { id: 'sent_b9d864ee', readingOnly: ['2つさきの', 'ふたつさきの'], inlineReading: ['2つ 先[さき]の', '2つ[ふたつ] 先[さき]の'] },
  { id: 'sent_799273c4', readingOnly: ['2にんの1つした', 'ふたりのひとつした'], inlineReading: ['2 人[にん]の1つ 下[した]', '2人[ふたり]の1つ[ひとつ] 下[した]'] },
  { id: 'sent_1e8a76dd', readingOnly: ['1かげつも', 'いっかげつも'], inlineReading: ['1 ヶ月[かげつ]も', '1ヶ月[いっかげつ]も'] },
  { id: 'sent_745e0c28', readingOnly: ['2にんは', 'ふたりは'], inlineReading: ['2 人[にん]は', '2人[ふたり]は'] },
  { id: 'sent_dc053202', readingOnly: ['2にんだけで', 'ふたりだけで'], inlineReading: ['2 人[にん]だけで', '2人[ふたり]だけで'] },
  { id: 'sent_ef40c342', readingOnly: ['3にんで', 'さんにんで'], inlineReading: ['3 人[にん]で', '3人[さんにん]で'] },
  { id: 'sent_f259e222', readingOnly: ['1かげつ。1', 'いっかげつ。1'], inlineReading: ['1 ヶ月[かげつ]。1', '1ヶ月[いっかげつ]。1'] },
  { id: 'sent_5667fd48', readingOnly: ['5ふんくらい', 'ごふんくらい'], inlineReading: ['5 分[ふん]くらい', '5分[ごふん]くらい'] },
];

interface SentenceRow {
  id: string;
  readingOnly: string;
  inlineReading: string;
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log(`Fetching ${CORRECTIONS.length} known-affected sentence(s)...`);
  const { data, error } = await supabase
    .from('sentences')
    .select('id, reading_only, inline_reading')
    .eq('owner_id', user.id)
    .in('id', CORRECTIONS.map((c) => c.id));
  if (error) throw new Error(`Failed to fetch sentences: ${error.message}`);

  const rows = new Map<string, SentenceRow>(
    (data ?? []).map((row) => [
      String(row.id),
      { id: String(row.id), readingOnly: String(row.reading_only ?? ''), inlineReading: String(row.inline_reading ?? '') },
    ]),
  );

  let fixed = 0;
  for (const correction of CORRECTIONS) {
    const row = rows.get(correction.id);
    if (!row) {
      console.log(`  ${correction.id}: not found, skipping.`);
      continue;
    }
    const [roOld, roNew] = correction.readingOnly;
    const [irOld, irNew] = correction.inlineReading;
    if (!row.readingOnly.includes(roOld) || !row.inlineReading.includes(irOld)) {
      console.log(`  ${correction.id}: expected substring not found (already fixed, or source changed) — skipping.`);
      continue;
    }
    const newReadingOnly = row.readingOnly.replace(roOld, roNew);
    const newInlineReading = row.inlineReading.replace(irOld, irNew);
    fixed += 1;
    console.log(`  ${correction.id}:`);
    console.log(`    reading_only:   "${row.readingOnly}" -> "${newReadingOnly}"`);
    console.log(`    inline_reading: "${row.inlineReading}" -> "${newInlineReading}"`);
    if (apply) {
      const { error: updateError } = await supabase
        .from('sentences')
        .update({ reading_only: newReadingOnly, inline_reading: newInlineReading })
        .eq('id', correction.id);
      if (updateError) throw new Error(`Failed to update sentence ${correction.id}: ${updateError.message}`);
    }
  }

  console.log(`\nDone. ${fixed} sentence(s) ${apply ? 'fixed' : 'would be fixed'}.`);
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
