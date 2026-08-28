/**
 * Backfills `vocabulary_items.meaning` (and `part_of_speech`, if also
 * blank) from JMDict, for items with no meaning yet — e.g. every item
 * created by scripts/backfill-vocabulary-suggestions.ts's downstream
 * confirms, or scripts/backfill-confirmed-vocabulary-links.ts's retroactive
 * materialization, starts with an empty meaning until the user fills it in
 * by hand.
 *
 * Reuses scripts/lib/jmdict.ts unmodified — that's already a tested, local-
 * only lookup tool (npm run jmdict:lookup); this script is the first thing
 * that actually writes its results to Supabase.
 *
 * Dry-run by default; --apply required to write. Idempotent: only items
 * with an empty meaning are selected, so a successful --apply run leaves
 * nothing for the next run to find (items with no JMDict match stay blank
 * and get retried harmlessly, not wrongly treated as done).
 *
 * Usage: npm run backfill:vocabulary-meanings -- [--apply]
 */
import { buildJmdictIndex, ensureJmdictFile, lookupJmdict } from './lib/jmdict';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

interface VocabularyItemRow {
  id: string;
  expression: string;
  reading: string;
  partOfSpeech: string | null;
}

async function fetchBlankMeaningItems(
  supabase: Awaited<ReturnType<typeof createScriptSupabaseClient>>,
  ownerId: string,
): Promise<VocabularyItemRow[]> {
  const all = await fetchAll(
    supabase,
    'vocabulary_items',
    'id, expression, reading, meaning, part_of_speech',
    ownerId,
    (row) => ({
      id: String(row.id),
      expression: String(row.expression),
      reading: String(row.reading ?? ''),
      meaning: String(row.meaning ?? ''),
      partOfSpeech: row.part_of_speech ? String(row.part_of_speech) : null,
    }),
  );
  return all
    .filter((row) => !row.meaning.trim())
    .map(({ id, expression, reading, partOfSpeech }) => ({ id, expression, reading, partOfSpeech }));
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching vocabulary items with no meaning yet, and loading JMDict...');
  const [items, index] = await Promise.all([
    fetchBlankMeaningItems(supabase, user.id),
    ensureJmdictFile().then(buildJmdictIndex),
  ]);
  console.log(`Found ${items.length} item(s) with a blank meaning.`);
  if (!items.length) return;

  let matched = 0;
  let notFound = 0;
  for (const item of items) {
    const result = lookupJmdict(
      index,
      item.expression,
      item.reading || undefined,
      item.partOfSpeech || undefined,
    );
    if (!result) {
      notFound += 1;
      continue;
    }
    matched += 1;
    console.log(
      `  ${item.expression} [${item.reading}] — ${result.gloss}${item.partOfSpeech ? '' : ` (pos: ${result.pos || '(none)'})`}`,
    );
    if (apply) {
      const patch: Record<string, string> = { meaning: result.gloss };
      if (!item.partOfSpeech && result.pos) patch.part_of_speech = result.pos;
      const { error } = await supabase
        .from('vocabulary_items')
        .update(patch)
        .eq('id', item.id);
      if (error) {
        throw new Error(`Failed to update vocabulary_item ${item.id}: ${error.message}`);
      }
    }
  }

  console.log(
    `\nDone. ${matched} item(s) ${apply ? 'updated' : 'would be updated'}, ${notFound} had no JMDict match.`,
  );
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
