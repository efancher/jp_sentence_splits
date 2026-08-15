/**
 * One-time correction for vocabulary_items.meaning rows imported before
 * scripts/lib/ankiImport.ts's vocabularyMeaning() decoded HTML entities —
 * Anki stores fields as HTML, so an apostrophe in WkMeaning/HintGlossary
 * was imported as the literal text `&#x27;` instead of `'`. Found live on
 * /vocabulary (でしょ's meaning rendering as "don&#x27;t you agree?...").
 * Confirmed narrow blast radius by checking production directly: 6 of 334
 * vocabulary_items affected. sentences.target_vocabulary[].english is
 * populated by the same vocabularyMeaning() call (sentenceDraftFromNote in
 * this same file), so it was equally exposed to the bug in principle — but
 * checking all 206 sentences / 571 targetVocabulary entries directly found
 * 0 affected rows, so there's nothing to correct there right now. Not
 * fixed by a different code path; just no affected note happened to land
 * in `sentences`.
 *
 * Not a recurring backfill — this corrects historical data for a bug
 * that's now fixed at the source (ankiImport.ts). No GitHub Actions
 * workflow; run once, locally.
 *
 * Dry-run by default; --apply required to write. Idempotent: only rows
 * whose decoded meaning differs from the stored one are selected.
 *
 * Usage: npm run fix:html-entity-meanings -- [--apply]
 */
import { displayJapanese } from '../src/lib/normalize';

import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

interface VocabularyItemRow {
  id: string;
  meaning: string;
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching vocabulary items...');
  const items = await fetchAll(
    supabase,
    'vocabulary_items',
    'id, meaning',
    user.id,
    (row): VocabularyItemRow => ({
      id: String(row.id),
      meaning: String(row.meaning ?? ''),
    }),
  );

  const toFix = items
    .map((item) => ({ item, decoded: displayJapanese(item.meaning) }))
    .filter(({ item, decoded }) => decoded !== item.meaning);

  console.log(`Found ${items.length} vocabulary item(s); ${toFix.length} with HTML-entity-encoded meanings.`);
  for (const { item, decoded } of toFix) {
    console.log(`  "${item.meaning}" -> "${decoded}"`);
    if (apply) {
      const { error } = await supabase
        .from('vocabulary_items')
        .update({ meaning: decoded })
        .eq('id', item.id);
      if (error) throw new Error(`Failed to update vocabulary_item ${item.id}: ${error.message}`);
    }
  }

  console.log(`\nDone. ${toFix.length} item(s) ${apply ? 'fixed' : 'would be fixed'}.`);
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
