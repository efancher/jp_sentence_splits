/**
 * Backfills `sentence_vocabulary.surface_form` for existing links that
 * don't have one — normally only set by the interactive VocabularyPicker
 * confirm flow (`materializeVocabularySelections`, src/db/repository.ts,
 * called from src/pages/AnalyzePage.tsx), which captures the exact
 * inflected substring the picker highlighted. Links created any other way
 * (the one-time Anki import, in particular — all of it, as of writing)
 * have no surface form at all, which makes them ineligible for every
 * surfaceForm-gated review card (reading_retrieval/cloze/reading_production/
 * sentence_transformation/contrastive pairs, and PracticePage's
 * natural-encounter panel — see docs/STATUS.md Phase 7.6-7.10b, all of
 * which turned out to have near-zero real coverage because of this).
 *
 * Matching, in order, first hit wins:
 *   1. Exact substring: the vocabulary item's dictionary `expression`
 *      appears verbatim in the sentence (correct for any non-conjugating
 *      word — nouns, particles, adverbs, already-inflected copies, etc.).
 *   2. Conjugated substring: if the item's `partOfSpeech` maps to a
 *      conjugation word class (src/lib/conjugation.ts, the same engine
 *      Phase 7.9b's sentence_transformation card uses), try every form for
 *      that class and check each conjugated `.expression` against the
 *      sentence, first match wins. Only reachable for words with a JMDict
 *      `partOfSpeech` tag already backfilled — a real but separate,
 *      pre-existing gap (see backfill-vocabulary-meanings.ts).
 * A link whose word matches neither way is left alone (not an error —
 * common for words appearing in an okurigana form conjugate() doesn't
 * cover, e.g. the volitional/たい forms, or words the picker's own
 * morphology never lines up with a clean substring at all).
 *
 * Dry-run by default; --apply required to write. Idempotent: only links
 * with a null surface_form are selected, so a successful --apply run
 * leaves nothing for the next run to find; unmatched links get retried
 * harmlessly on every future run (same "no error, just try again" contract
 * as backfill-vocabulary-meanings.ts's JMDict misses).
 *
 * Usage: npm run backfill:vocabulary-surface-forms -- [--apply]
 */
import {
  conjugate,
  conjugationFormsForWordClass,
  conjugationWordClassFromPartOfSpeech,
} from '../src/lib/conjugation';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type SupabaseClient = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

interface LinkRow {
  id: string;
  sentenceId: string;
  vocabularyItemId: string;
}

interface SentenceRow {
  id: string;
  japanese: string;
}

interface VocabularyItemRow {
  id: string;
  expression: string;
  reading: string;
  partOfSpeech: string | null;
}

async function fetchLinksMissingSurfaceForm(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<LinkRow[]> {
  const all = await fetchAll(
    supabase,
    'sentence_vocabulary',
    'id, sentence_id, vocabulary_item_id, surface_form',
    ownerId,
    (row) => ({
      id: String(row.id),
      sentenceId: String(row.sentence_id),
      vocabularyItemId: String(row.vocabulary_item_id),
      surfaceForm: row.surface_form ? String(row.surface_form) : null,
    }),
  );
  return all
    .filter((row) => !row.surfaceForm)
    .map(({ id, sentenceId, vocabularyItemId }) => ({ id, sentenceId, vocabularyItemId }));
}

/** Finds the first substring of `japanese` matching the word's dictionary form or a conjugated form. */
function findSurfaceForm(
  japanese: string,
  expression: string,
  reading: string,
  partOfSpeech: string | null,
): string | null {
  if (expression && japanese.includes(expression)) return expression;

  const wordClass = conjugationWordClassFromPartOfSpeech(partOfSpeech ?? undefined);
  if (!wordClass) return null;
  for (const form of conjugationFormsForWordClass(wordClass)) {
    const conjugated = conjugate(expression, reading, wordClass, form.key);
    if (conjugated && japanese.includes(conjugated.expression)) return conjugated.expression;
  }
  return null;
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching sentence_vocabulary links with no surface_form yet...');
  const links = await fetchLinksMissingSurfaceForm(supabase, user.id);
  console.log(`Found ${links.length} link(s) with no surface_form.`);
  if (!links.length) return;

  const sentenceIds = [...new Set(links.map((link) => link.sentenceId))];
  const vocabularyItemIds = [...new Set(links.map((link) => link.vocabularyItemId))];

  console.log(`Fetching ${sentenceIds.length} sentence(s) and ${vocabularyItemIds.length} vocabulary item(s)...`);
  const [sentences, vocabularyItems] = await Promise.all([
    fetchAll(
      supabase,
      'sentences',
      'id, japanese',
      user.id,
      (row): SentenceRow => ({ id: String(row.id), japanese: String(row.japanese ?? '') }),
    ),
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
  ]);
  const sentenceById = new Map(sentences.map((row) => [row.id, row]));
  const vocabularyItemById = new Map(vocabularyItems.map((row) => [row.id, row]));

  let matched = 0;
  let notFound = 0;
  for (const link of links) {
    const sentence = sentenceById.get(link.sentenceId);
    const vocabularyItem = vocabularyItemById.get(link.vocabularyItemId);
    if (!sentence || !vocabularyItem) {
      notFound += 1;
      continue;
    }
    const surfaceForm = findSurfaceForm(
      sentence.japanese,
      vocabularyItem.expression,
      vocabularyItem.reading,
      vocabularyItem.partOfSpeech,
    );
    if (!surfaceForm) {
      notFound += 1;
      continue;
    }
    matched += 1;
    console.log(`  ${vocabularyItem.expression} -> "${surfaceForm}" in ${sentence.japanese}`);
    if (apply) {
      const { error } = await supabase
        .from('sentence_vocabulary')
        .update({ surface_form: surfaceForm })
        .eq('id', link.id);
      if (error) {
        throw new Error(`Failed to update sentence_vocabulary ${link.id}: ${error.message}`);
      }
    }
  }

  console.log(
    `\nDone. ${matched} link(s) ${apply ? 'updated' : 'would be updated'}, ${notFound} had no match.`,
  );
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
