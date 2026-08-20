/**
 * Removes vocabulary_items created by combining adjacent morphology
 * suggestions (combineSuggestions/mergeSuggestionIntoSelection,
 * src/lib/vocabularySuggestions.ts) and confirmed without editing the
 * auto-generated draft first. Those functions' own doc comments say the
 * combined expression/reading is just "the joined surfaces" — a starting
 * point meant for the learner to fix up in VocabularyPicker before
 * confirming, not a finished value. When confirmed as-is, each token's
 * lemma/reading gets concatenated literally, e.g. combining 売られた (sold,
 * passive-past of 売る) + 喧嘩 (fight) produces expression "売るれるた喧嘩"
 * (literally "sell"+"passive"+"past"+"fight" mashed together) rather than a
 * real word or phrase.
 *
 * Found via manual investigation (not a query this script re-derives,
 * because "garbled combine" isn't reliably distinguishable from a
 * legitimate multi-morpheme word by pattern alone — a regex heuristic tried
 * during triage produced false positives on real words like いい加減,
 * 連れて行く). Hence the explicit id list below rather than a scan.
 *
 * All 7 confirmed via direct query to have zero study_items (never
 * scheduled/reviewed) before this script was written, so no FSRS state or
 * review history is at risk. Each has exactly one sentence_vocabulary link,
 * which is deleted alongside the parent item; the real underlying words are
 * unaffected (separate vocabulary_items from the same morphology pass).
 *
 * Dry-run by default; --apply required to write. Idempotent: already-
 * deleted ids are silently skipped.
 *
 * Usage: npm run fix:delete-garbled-combined-vocabulary -- [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const GARBLED_ITEM_IDS = [
  'vocab_item_2f1f0be7-0f88-46ef-ac14-90a701a3c029', // 売るれるた喧嘩
  'vocab_item_7dc7075a-4ffb-45f1-be46-4aa79e6e3a97', // 笑うれる
  'vocab_item_810334d0-a993-485a-afa6-3f7d8e6141ea', // するてあげる
  'vocab_item_919749a7-ab62-4678-bbda-dba368d03554', // 鈍感だふり
  'vocab_item_da1fad99-a7de-4176-8c29-4836f646a8ae', // 安いすぎる
  'vocab_item_f8de6720-5385-4976-85f4-e7211f14a0b3', // 笑うてる
  'vocab_item_fd31aba3-6926-42df-8830-a57d0d360a33', // 最低だセリフ
];

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data: items, error } = await supabase
    .from('vocabulary_items')
    .select('id, expression, reading')
    .eq('owner_id', user.id)
    .in('id', GARBLED_ITEM_IDS)
    .is('deleted_at', null);
  if (error) throw new Error(`Failed to fetch vocabulary_items: ${error.message}`);

  console.log(`${items?.length ?? 0} of ${GARBLED_ITEM_IDS.length} listed item(s) still live.\n`);

  for (const item of items ?? []) {
    const { data: links, error: linksError } = await supabase
      .from('sentence_vocabulary')
      .select('id')
      .eq('owner_id', user.id)
      .eq('vocabulary_item_id', item.id)
      .is('deleted_at', null);
    if (linksError) throw new Error(`Failed to fetch sentence_vocabulary for ${item.id}: ${linksError.message}`);

    const { count: studyItemCount, error: studyError } = await supabase
      .from('study_items')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id)
      .eq('subject_id', item.id)
      .is('deleted_at', null);
    if (studyError) throw new Error(`Failed to check study_items for ${item.id}: ${studyError.message}`);
    if ((studyItemCount ?? 0) > 0) {
      console.log(`  SKIPPING ${item.expression} (${item.id}) -- has ${studyItemCount} study_item(s) now, not present when this list was built`);
      continue;
    }

    console.log(`  ${item.expression} | ${item.reading} (${item.id}): delete item + ${links?.length ?? 0} sentence_vocabulary link(s)`);
    if (apply) {
      for (const link of links ?? []) {
        const { error: deleteLinkError } = await supabase
          .from('sentence_vocabulary')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', link.id);
        if (deleteLinkError) throw new Error(`Failed to delete sentence_vocabulary ${link.id}: ${deleteLinkError.message}`);
      }
      const { error: deleteItemError } = await supabase
        .from('vocabulary_items')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', item.id);
      if (deleteItemError) throw new Error(`Failed to delete vocabulary_item ${item.id}: ${deleteItemError.message}`);
    }
  }

  console.log(`\nDone. ${apply ? 'Deleted' : 'Would delete'} ${items?.length ?? 0} item(s).`);
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
