/**
 * Backfills `vocabulary_items.pitch_accent_positions` from the Kanjium
 * pitch-accent dictionary, for items with no pitch data yet — feeds
 * `src/lib/pitchAccentObservations.ts`'s ground-truth pitch-accent
 * scoring in the shadowing AnalysisPanel.
 *
 * Reuses scripts/lib/kanjiumPitch.ts unmodified. Dry-run by default;
 * --apply required to write. Idempotent: only items with no positions yet
 * are selected, so a successful --apply run leaves nothing for the next
 * run to find (items with no Kanjium match stay blank and get retried
 * harmlessly, not wrongly treated as done).
 *
 * Usage: npm run backfill:pitch-accent -- [--apply]
 */
import { ensureKanjiumPitchIndex, lookupKanjiumPitch } from './lib/kanjiumPitch';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

interface VocabularyItemRow {
  id: string;
  expression: string;
  reading: string;
}

async function fetchUnscoredItems(
  supabase: Awaited<ReturnType<typeof createScriptSupabaseClient>>,
  ownerId: string,
): Promise<VocabularyItemRow[]> {
  const all = await fetchAll(
    supabase,
    'vocabulary_items',
    'id, expression, reading, pitch_accent_positions',
    ownerId,
    (row) => ({
      id: String(row.id),
      expression: String(row.expression),
      reading: String(row.reading ?? ''),
      pitchAccentPositions: (row.pitch_accent_positions as number[] | null) ?? [],
    }),
  );
  return all
    .filter((row) => row.reading.trim() && row.pitchAccentPositions.length === 0)
    .map(({ id, expression, reading }) => ({ id, expression, reading }));
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching vocabulary items with no pitch-accent data yet, and loading Kanjium...');
  const [items, index] = await Promise.all([
    fetchUnscoredItems(supabase, user.id),
    ensureKanjiumPitchIndex(),
  ]);
  console.log(`Found ${items.length} item(s) with no pitch-accent data.`);
  if (!items.length) return;

  let matched = 0;
  let notFound = 0;
  for (const item of items) {
    const positions = lookupKanjiumPitch(index, item.expression, item.reading);
    if (!positions) {
      notFound += 1;
      continue;
    }
    matched += 1;
    console.log(`  ${item.expression} [${item.reading}] — positions: ${positions.join(', ')}`);
    if (apply) {
      const { error } = await supabase
        .from('vocabulary_items')
        .update({ pitch_accent_positions: positions })
        .eq('id', item.id);
      if (error) {
        throw new Error(`Failed to update vocabulary_item ${item.id}: ${error.message}`);
      }
    }
  }

  console.log(
    `\nDone. ${matched} item(s) ${apply ? 'updated' : 'would be updated'}, ${notFound} had no Kanjium match.`,
  );
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
