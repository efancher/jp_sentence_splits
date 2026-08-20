/**
 * Corrects vocabulary_items.reading for words the string-math heuristic in
 * fix-vocabulary-reading-mismatches.ts can't safely handle: godan verbs
 * (and a few irregulars like 来る) whose stem sound changes under
 * conjugation, so `surface` isn't a literal prefix of `expression` (e.g.
 * 話す/話し — see deriveDictionaryReading's doc comment). Same underlying
 * bug (src/lib/vocabularySuggestions.ts, fixed), different shape.
 *
 * Uses JMDict (scripts/lib/jmdict.ts, already used elsewhere in this repo)
 * as ground truth instead of string math. Only auto-fixes when JMDict has
 * exactly one *common* reading for the expression — e.g. 行く genuinely has
 * two valid readings (いく common, ゆく also valid/less common), so it's
 * left alone rather than guessed. A word whose current reading already
 * matches some JMDict reading for its expression is left alone too (already
 * correct, or a legitimate less-common reading someone chose deliberately).
 *
 * Only considers items with a genuinely conjugated surface_form on record
 * (surface != expression) — words never linked to a conjugated occurrence
 * aren't from this bug and shouldn't be touched even if JMDict disagrees
 * with the stored reading for some other reason.
 *
 * Same duplicate-collision handling as fix-vocabulary-reading-mismatches.ts:
 * vocabulary_items_owner_expr_reading_uidx is unique on (expression,
 * reading), so if the JMDict reading collides with an existing separate
 * item, this is reported as needing a merge (see
 * merge-duplicate-vocabulary-items.ts) rather than written.
 *
 * Dry-run by default; --apply required to write. Idempotent: only items
 * whose reading doesn't match any JMDict reading are selected.
 *
 * Usage: npm run fix:vocabulary-godan-readings -- [--apply]
 */
import { buildJmdictIndex, ensureJmdictFile } from './lib/jmdict';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

interface LinkRow {
  vocabularyItemId: string;
  surfaceForm: string | null;
}

interface VocabularyItemRow {
  id: string;
  expression: string;
  reading: string;
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching sentence_vocabulary links, vocabulary items, and JMDict...');
  const [links, items, jmdictFile] = await Promise.all([
    fetchAll(
      supabase,
      'sentence_vocabulary',
      'id, vocabulary_item_id, surface_form',
      user.id,
      (row): LinkRow => ({
        vocabularyItemId: String(row.vocabulary_item_id),
        surfaceForm: row.surface_form ? String(row.surface_form) : null,
      }),
    ),
    fetchAll(
      supabase,
      'vocabulary_items',
      'id, expression, reading',
      user.id,
      (row): VocabularyItemRow => ({
        id: String(row.id),
        expression: String(row.expression ?? ''),
        reading: String(row.reading ?? ''),
      }),
    ),
    ensureJmdictFile(),
  ]);
  const index = buildJmdictIndex(jmdictFile);

  const surfaceFormsByItemId = new Map<string, Set<string>>();
  for (const link of links) {
    if (!link.surfaceForm) continue;
    const set = surfaceFormsByItemId.get(link.vocabularyItemId) ?? new Set<string>();
    set.add(link.surfaceForm);
    surfaceFormsByItemId.set(link.vocabularyItemId, set);
  }

  const itemIdByExpressionReading = new Map(
    items.map((item) => [`${item.expression} ${item.reading}`, item.id]),
  );

  const toFix: { item: VocabularyItemRow; correctReading: string }[] = [];
  const needsMerge: { item: VocabularyItemRow; correctReading: string; duplicateOfId: string }[] = [];
  const ambiguous: { item: VocabularyItemRow; readings: string[] }[] = [];

  for (const item of items) {
    const surfaceForms = surfaceFormsByItemId.get(item.id);
    if (!surfaceForms) continue;
    if (![...surfaceForms].some((s) => s !== item.expression)) continue; // never seen conjugated

    const jmdictEntries = index.byExpression.get(item.expression) ?? [];
    const allReadings = new Set(jmdictEntries.map((entry) => entry.reading));
    if (allReadings.has(item.reading)) continue; // already a valid JMDict reading
    if (allReadings.size === 0) continue; // no JMDict entry at all -- nothing to go on

    let correctReading: string;
    if (allReadings.size === 1) {
      correctReading = [...allReadings][0]!;
    } else {
      const commonReadings = new Set(jmdictEntries.filter((entry) => entry.common).map((entry) => entry.reading));
      if (commonReadings.size !== 1) {
        ambiguous.push({ item, readings: [...allReadings] });
        continue;
      }
      correctReading = [...commonReadings][0]!;
    }

    const duplicateOfId = itemIdByExpressionReading.get(`${item.expression} ${correctReading}`);
    if (duplicateOfId) {
      needsMerge.push({ item, correctReading, duplicateOfId });
      continue;
    }
    toFix.push({ item, correctReading });
  }

  console.log(
    `${toFix.length} fixable via a single common JMDict reading; ${needsMerge.length} collide with an existing ` +
      `duplicate item; ${ambiguous.length} have multiple JMDict readings and need a manual pick.\n`,
  );

  for (const { item, correctReading } of toFix) {
    console.log(`  ${item.expression}: "${item.reading}" -> "${correctReading}"`);
    if (apply) {
      const { error } = await supabase
        .from('vocabulary_items')
        .update({ reading: correctReading })
        .eq('id', item.id);
      if (error) throw new Error(`Failed to update vocabulary_item ${item.id}: ${error.message}`);
    }
  }

  if (needsMerge.length) {
    console.log(`\n${needsMerge.length} item(s) whose fix would collide with an existing duplicate (not touched):`);
    for (const { item, correctReading, duplicateOfId } of needsMerge) {
      console.log(`  ${item.expression}: "${item.reading}" (${item.id}) duplicates "${correctReading}" (${duplicateOfId})`);
    }
  }

  if (ambiguous.length) {
    console.log(`\n${ambiguous.length} item(s) with multiple JMDict readings (needs a manual pick, not touched):`);
    for (const { item, readings } of ambiguous) {
      console.log(`  ${item.expression} (current "${item.reading}", ${item.id}): ${readings.join(', ')}`);
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
