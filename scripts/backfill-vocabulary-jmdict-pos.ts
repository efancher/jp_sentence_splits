/**
 * Backfills `vocabulary_items.part_of_speech` with JMDict tags for items
 * that carry a UniDic POS string ("動詞/一般", "形容詞/一般", ...) or no POS
 * at all — i.e. everything the mining pipeline produces.
 *
 * Why: the conjugation engine's `conjugationWordClassFromPartOfSpeech`
 * (src/lib/conjugation.ts) only understands JMDict tags (v5r, v1, adj-i,
 * vk, vs). A verb tagged "動詞/一般" is invisible to the contextual
 * conjugation review card (per-occurrence `sentence_transformation`), the
 * `backfill:vocabulary-surface-forms` conjugated-match path, and
 * `pitchAccentRules.ts`. `backfill:vocabulary-meanings` already writes
 * `part_of_speech` from JMDict, but only when it's *blank*, so mined items
 * that got a UniDic POS keep it forever.
 *
 * Scope is deliberately narrow: only rows whose *current* POS doesn't map
 * to a conjugation word class, and only written when the *JMDict* match
 * does — verbs and i/na-adjectives. Noun rows keep their UniDic POS (other
 * code paths that want a coarse class already handle both formats via
 * `resolvePosClass`). `lookupJmdict` uses the existing UniDic POS to break
 * homophone ties, same as `backfill:vocabulary-meanings`.
 *
 * Dry-run by default; --apply required to write. Idempotent: a successful
 * run leaves nothing for the next (rows now map to a class and are
 * skipped); rows with no confident JMDict match are retried harmlessly.
 *
 * Run this after mining a new source (same maintenance pattern as
 * `backfill:vocabulary-suggestions` / `backfill:vocabulary-meanings`).
 *
 * Usage: npm run backfill:vocabulary-jmdict-pos -- [--apply]
 */
import { conjugationWordClassFromPartOfSpeech } from '../src/lib/conjugation';
import { buildJmdictIndex, ensureJmdictFile, lookupJmdict } from './lib/jmdict';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

interface VocabularyItemRow {
  id: string;
  expression: string;
  reading: string;
  partOfSpeech: string | null;
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching vocabulary items and loading JMDict...');
  const [items, index] = await Promise.all([
    fetchAll(
      supabase,
      'vocabulary_items',
      'id, expression, reading, part_of_speech',
      user.id,
      (row): VocabularyItemRow => ({
        id: String(row.id),
        expression: String(row.expression ?? ''),
        reading: String(row.reading ?? ''),
        partOfSpeech: row.part_of_speech ? String(row.part_of_speech) : null,
      }),
    ),
    ensureJmdictFile().then(buildJmdictIndex),
  ]);

  // Only rows the conjugation engine can't already classify.
  const targets = items.filter(
    (item) => !conjugationWordClassFromPartOfSpeech(item.partOfSpeech ?? undefined),
  );
  console.log(
    `${items.length} vocabulary items; ${targets.length} without a conjugatable POS tag.\n`,
  );

  let updated = 0;
  let noMatch = 0;
  let notConjugatable = 0;
  for (const item of targets) {
    const result = lookupJmdict(
      index,
      item.expression,
      item.reading || undefined,
      item.partOfSpeech || undefined,
    );
    if (!result?.pos) {
      noMatch += 1;
      continue;
    }
    if (!conjugationWordClassFromPartOfSpeech(result.pos)) {
      notConjugatable += 1;
      continue;
    }
    updated += 1;
    console.log(
      `  ${item.expression} [${item.reading}]  ${item.partOfSpeech ?? '(none)'} -> ${result.pos}`,
    );
    if (apply) {
      const { error } = await supabase
        .from('vocabulary_items')
        .update({ part_of_speech: result.pos })
        .eq('id', item.id);
      if (error) {
        throw new Error(`Failed to update vocabulary_item ${item.id}: ${error.message}`);
      }
    }
  }

  console.log(
    `\nDone. ${updated} item(s) ${apply ? 'updated' : 'would be updated'}; ` +
      `${notConjugatable} JMDict match but not a verb/adjective; ${noMatch} no confident JMDict match.`,
  );
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
