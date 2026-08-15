/**
 * Seeds `vocabulary_confusions` rows (type `transitivity`) by porting
 * `anki/wk_decks.py`'s suffix-swap verb-pairing algorithm
 * (`scripts/lib/verbPairs.ts`) over already-imported `vocabulary_items` —
 * e.g. 表れる/表す, a genuine transitive/intransitive confusion pair a
 * learner is likely to mix up.
 *
 * Dry-run by default; --apply required to write. Idempotent: fetches
 * existing confusion pairs first and only inserts genuinely new ones (a
 * plain insert, not upsert — `vocabulary_confusions_pair_uidx` is a
 * partial unique index, the same `ON CONFLICT` limitation already hit and
 * fixed for the kanji importer, see docs/STATUS.md Phase 2).
 *
 * Usage: npm run backfill:verb-pair-confusions -- [--apply]
 */
import {
  fetchAll,
  insertBatched,
  parseApplyFlag,
  requireAuthedUser,
} from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';
import { findVerbPairs, type VerbPairCandidate } from './lib/verbPairs';
import { createId } from '../src/lib/ids';
import { nowIso } from '../src/lib/normalize';

function canonicalPair(aId: string, bId: string): [string, string] {
  return aId < bId ? [aId, bId] : [bId, aId];
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching vocabulary items...');
  const items = await fetchAll<VerbPairCandidate>(
    supabase,
    'vocabulary_items',
    'id, expression, reading, meaning',
    user.id,
    (row) => ({
      id: String(row.id),
      expression: String(row.expression),
      reading: String(row.reading ?? ''),
      meaning: String(row.meaning ?? ''),
    }),
  );
  console.log(`Found ${items.length} vocabulary item(s).`);

  const candidatePairs = findVerbPairs(items);
  console.log(
    `Found ${candidatePairs.length} candidate transitive/intransitive pair(s) by reading.`,
  );
  if (!candidatePairs.length) return;

  const existing = await fetchAll(
    supabase,
    'vocabulary_confusions',
    'item_a_id, item_b_id',
    user.id,
    (row) => `${String(row.item_a_id)}:${String(row.item_b_id)}`,
  );
  const existingKeys = new Set(existing);

  const timestamp = nowIso();
  const toInsert: Record<string, unknown>[] = [];
  let alreadyPresent = 0;
  for (const [left, right] of candidatePairs) {
    const [itemAId, itemBId] = canonicalPair(left.id, right.id);
    const key = `${itemAId}:${itemBId}`;
    if (existingKeys.has(key)) {
      alreadyPresent += 1;
      continue;
    }
    console.log(`  ${left.expression} [${left.reading}] / ${right.expression} [${right.reading}]`);
    toInsert.push({
      id: createId('vocab_confusion'),
      owner_id: user.id,
      item_a_id: itemAId,
      item_b_id: itemBId,
      confusion_type: 'transitivity',
      observed_count: 1,
      last_observed_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  console.log(
    `\n${toInsert.length} new pair(s) ${apply ? 'inserted' : 'would be inserted'}, ${alreadyPresent} already present.`,
  );
  if (apply && toInsert.length) {
    await insertBatched(supabase, 'vocabulary_confusions', toInsert);
  } else if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
