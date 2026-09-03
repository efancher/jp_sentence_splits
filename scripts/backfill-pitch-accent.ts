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
 * Words for which this Kanjium export lists more than one accent are
 * skipped and printed for a hand check — the export's ordering isn't
 * reliable (e.g. 結局 → [4,0,0], but 0/heiban is correct) and `positions[0]`
 * is treated as authoritative throughout the app.
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
  const ambiguous: string[] = [];
  for (const item of items) {
    const positions = lookupKanjiumPitch(index, item.expression, item.reading);
    if (!positions) {
      notFound += 1;
      continue;
    }
    // `positions[0]` is authoritative everywhere in the app
    // (sentencePitchAccent, the pitch_accent card, pitchAccentObservations).
    // This Kanjium export lists multiple accents for some words in an
    // unreliable order (e.g. 結局 → [4,0,0], where 0/heiban is correct), so
    // writing one blind would teach the wrong "correct" answer. Skip those
    // for a hand check rather than guess.
    const distinct = [...new Set(positions)];
    if (distinct.length > 1) {
      ambiguous.push(`${item.expression} [${item.reading}] — Kanjium: ${positions.join(', ')}`);
      continue;
    }
    matched += 1;
    console.log(`  ${item.expression} [${item.reading}] — position: ${distinct[0]}`);
    if (apply) {
      const { error } = await supabase
        .from('vocabulary_items')
        .update({ pitch_accent_positions: [distinct[0]] })
        .eq('id', item.id);
      if (error) {
        throw new Error(`Failed to update vocabulary_item ${item.id}: ${error.message}`);
      }
    }
  }

  console.log(
    `\nDone. ${matched} item(s) ${apply ? 'updated' : 'would be updated'}, ${notFound} had no Kanjium match.`,
  );
  if (ambiguous.length) {
    console.log(
      `\n${ambiguous.length} item(s) skipped — Kanjium lists more than one accent, order not trustworthy. Set by hand:`,
    );
    for (const line of ambiguous) console.log(`  ${line}`);
  }
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
