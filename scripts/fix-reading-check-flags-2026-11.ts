/**
 * One-time correction for the 2026-11-03 batch of "Reading check" flags where
 * the tokenizer's furigana was verified wrong from the sentence meaning:
 *   今日 こんにち -> きょう   (…今日本当に… was split 今日本 + 当)
 *   方   ほう     -> かた     (polite "person": 学習者の方, ほとんどの方, 年上の方)
 *   他   た       -> ほか     (その他, 他にも, 他なの)
 *   人   にん     -> じん     (社会人)
 * Flags needing the audio (明日, その後, 言う) and the assistant's false positives
 * are deliberately left to the in-app dismiss/resolve flow.
 *
 * Reuses `applyReadingFlagFix` (force) so inline_reading and, when it was the
 * plain kana of the old furigana, reading_only stay consistent. Dry-run by
 * default; --apply required to write. Idempotent.
 *
 * Usage: npx tsx scripts/fix-reading-check-flags-2026-11.ts [--apply]
 */
import { applyReadingFlagFix } from '../src/lib/readingFlagFix';
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const FIXES: { sentenceId: string; base: string; furigana: string; assistant: string }[] = [
  { sentenceId: 'sent_8c209c5c', base: '今日', furigana: 'こんにち', assistant: 'きょう' },
  { sentenceId: 'sent_c3634520', base: '方', furigana: 'ほう', assistant: 'かた' },
  { sentenceId: 'sent_4a61054c', base: '方', furigana: 'ほう', assistant: 'かた' },
  { sentenceId: 'sent_780f651b', base: '方', furigana: 'ほう', assistant: 'かた' },
  { sentenceId: 'sent_9de3056a', base: '方', furigana: 'ほう', assistant: 'かた' },
  { sentenceId: 'sent_32bbb627', base: '他', furigana: 'た', assistant: 'ほか' },
  { sentenceId: 'sent_419fba25', base: '他', furigana: 'た', assistant: 'ほか' },
  { sentenceId: 'sent_2bd91a14', base: '他', furigana: 'た', assistant: 'ほか' },
  { sentenceId: 'sent_fa6f0447', base: '人', furigana: 'にん', assistant: 'じん' },
  { sentenceId: 'sent_e9516d33', base: '人', furigana: 'にん', assistant: 'じん' },
];

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  let changed = 0;
  for (const fix of FIXES) {
    const { data, error } = await supabase
      .from('sentences')
      .select('id, japanese, inline_reading, reading_only')
      .eq('owner_id', user.id)
      .eq('id', fix.sentenceId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw new Error(`Failed to fetch ${fix.sentenceId}: ${error.message}`);
    if (!data) {
      console.log(`  ${fix.sentenceId}: not found, skipped`);
      continue;
    }
    const result = applyReadingFlagFix(
      { inlineReading: data.inline_reading, readingOnly: data.reading_only },
      { base: fix.base, furigana: fix.furigana, assistant: fix.assistant, hasAudio: false },
      { force: true },
    );
    if (!result) {
      console.log(`  ${fix.sentenceId}: ${fix.base}[${fix.furigana}] not present (already fixed?), skipped`);
      continue;
    }
    changed += 1;
    console.log(`\n  ${fix.sentenceId}  ${data.japanese}`);
    console.log(`    inline_reading: ${data.inline_reading}\n                 -> ${result.inlineReading}`);
    if (result.readingOnly !== undefined) console.log(`    reading_only: ${data.reading_only}\n               -> ${result.readingOnly}`);
    if (apply) {
      const patch: Record<string, unknown> = { inline_reading: result.inlineReading };
      if (result.readingOnly !== undefined) patch.reading_only = result.readingOnly;
      const { error: updateError } = await supabase.from('sentences').update(patch).eq('id', fix.sentenceId);
      if (updateError) throw new Error(`Failed to update ${fix.sentenceId}: ${updateError.message}`);
    }
  }
  console.log(`\nDone. ${changed} sentence(s) ${apply ? 'fixed' : 'would be fixed'}.`);
  if (!apply) console.log('Dry run — nothing written. Re-run with --apply to write.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
