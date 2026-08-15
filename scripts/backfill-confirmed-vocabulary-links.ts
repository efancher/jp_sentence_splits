/**
 * Retroactively materializes vocabulary_items/sentence_vocabulary (and
 * kanji/vocabulary_kanji for any newly-created item) for sentences that
 * were confirmed via VocabularyPicker *before* Phase 5 shipped —
 * materialization only fires from the confirm button going forward
 * (src/pages/AnalyzePage.tsx), so any sentence confirmed earlier still has
 * its picks sitting only in analyses.vocabulary_selections, never turned
 * into real rows. The confirm-vocabulary UI predates Phase 5 by a lot, so
 * this is a real, not merely theoretical, gap.
 *
 * Deliberately narrow scope: only sentences with `vocabulary_review_status
 * = 'confirmed'` AND zero existing sentence_vocabulary links — i.e.
 * confirmed-but-never-materialized. A sentence that already has any link
 * (re-confirmed after Phase 5 shipped, or otherwise already correct) is
 * left untouched entirely; this script only fills the specific documented
 * gap, never reconciles or overwrites.
 *
 * Mirrors import-anki-sentences.ts's exact get-or-create shape for
 * vocabulary_items (normalizeExpressionKey dedup) and
 * import-wanikani-kanji.ts's shape for kanji (fetch-existing-then-reuse-id
 * by character), reusing src/sync/mappers.ts's row mappers rather than
 * hand-rolling the Postgres row shape again.
 *
 * Dry-run by default; --apply required to write. Idempotent: only
 * never-materialized confirmed sentences are selected, so a successful
 * --apply run leaves nothing for the next run to find; a failed --apply run
 * (e.g. a mid-batch unique-constraint violation) is also safe to just
 * re-run, since already-written rows are picked up as "existing" next time.
 *
 * Known, accepted limitation (matches import-anki-sentences.ts's existing,
 * pre-this-script pattern — not new here): the read snapshot
 * (confirmedAnalyses/existing* below) isn't a single atomic transaction, so
 * a live confirm through AnalyzePage for the same word landing between the
 * snapshot read and this script's write can independently mint a second
 * vocabulary_items row for the same (expression, reading), surfacing as a
 * unique-constraint error on that batch. Given this workflow is manual/
 * occasional (never scheduled) and a failed run is safely re-runnable, this
 * is deliberately not solved with locking/retry machinery — just flagged.
 *
 * Usage: npm run backfill:confirmed-vocabulary-links -- [--apply]
 */
import {
  kanjiSchema,
  sentenceVocabularySchema,
  vocabularyItemSchema,
  vocabularyKanjiSchema,
} from '../src/domain/schemas';
import type {
  Kanji,
  SentenceVocabulary,
  VocabularyKanji,
  VocabularySelection,
} from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { isHanCharacter } from '../src/lib/kanji';
import { normalizeExpressionKey, nowIso } from '../src/lib/normalize';
import {
  kanjiToRemote,
  sentenceVocabularyToRemote,
  vocabularyItemToRemote,
  vocabularyKanjiToRemote,
} from '../src/sync/mappers';

import {
  fetchAll,
  parseApplyFlag,
  requireAuthedUser,
  upsertBatched,
  withoutVersionAndTimestamps,
} from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type SupabaseClient = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

const SELECT_PAGE_SIZE = 1000;

interface ConfirmedAnalysis {
  sentenceId: string;
  selections: VocabularySelection[];
}

async function fetchConfirmedAnalyses(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<ConfirmedAnalysis[]> {
  const out: ConfirmedAnalysis[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('analyses')
      .select('sentence_id, vocabulary_selections')
      .eq('owner_id', ownerId)
      .eq('vocabulary_review_status', 'confirmed')
      .is('deleted_at', null)
      // analyses has no `id` column — sentence_id is its primary key (see
      // idColumnForEntity in src/sync/mappers.ts). A stable order keeps
      // .range() page boundaries correct under concurrent writes.
      .order('sentence_id', { ascending: true })
      .range(from, from + SELECT_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to fetch analyses: ${error.message}`);
    for (const row of data ?? []) {
      out.push({
        sentenceId: String(row.sentence_id),
        selections: (row.vocabulary_selections as VocabularySelection[]) ?? [],
      });
    }
    if (!data || data.length < SELECT_PAGE_SIZE) break;
    from += SELECT_PAGE_SIZE;
  }
  return out;
}

interface ExistingVocabItem {
  id: string;
  expression: string;
  reading: string;
  meaning: string;
  partOfSpeech?: string;
}

interface WorkingVocabItem extends ExistingVocabItem {
  isNew: boolean;
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching confirmed analyses, existing links, vocabulary items, and kanji...');
  const [
    confirmedAnalyses,
    linkedSentenceIds,
    existingVocabItems,
    existingKanji,
    existingVocabKanjiLinks,
  ] = await Promise.all([
      fetchConfirmedAnalyses(supabase, user.id),
      fetchAll(supabase, 'sentence_vocabulary', 'sentence_id', user.id, (row) =>
        String(row.sentence_id),
      ),
      fetchAll(
        supabase,
        'vocabulary_items',
        'id, expression, reading, meaning, part_of_speech',
        user.id,
        (row): ExistingVocabItem => ({
          id: String(row.id),
          expression: String(row.expression),
          reading: String(row.reading ?? ''),
          meaning: String(row.meaning ?? ''),
          partOfSpeech: row.part_of_speech ? String(row.part_of_speech) : undefined,
        }),
      ),
      fetchAll(supabase, 'kanji', 'id, character', user.id, (row) => ({
        id: String(row.id),
        character: String(row.character),
      })),
      fetchAll(
        supabase,
        'vocabulary_kanji',
        'vocabulary_item_id, position_in_word',
        user.id,
        (row) => ({
          vocabularyItemId: String(row.vocabulary_item_id),
          positionInWord: Number(row.position_in_word),
        }),
      ),
    ]);

  const linkedSet = new Set(linkedSentenceIds);
  const toMaterialize = confirmedAnalyses.filter(
    (analysis) =>
      !linkedSet.has(analysis.sentenceId) &&
      analysis.selections.some((selection) => selection.expression?.trim()),
  );
  console.log(
    `Found ${confirmedAnalyses.length} confirmed sentence(s); ${toMaterialize.length} not yet materialized.`,
  );
  if (!toMaterialize.length) return;

  const vocabByKey = new Map(
    existingVocabItems.map((item) => [
      normalizeExpressionKey(item.expression, item.reading),
      item,
    ]),
  );
  const kanjiIdByCharacter = new Map(existingKanji.map((k) => [k.character, k.id]));
  const linkedPositionsByItemId = new Map<string, Set<number>>();
  for (const link of existingVocabKanjiLinks) {
    const set = linkedPositionsByItemId.get(link.vocabularyItemId);
    if (set) set.add(link.positionInWord);
    else linkedPositionsByItemId.set(link.vocabularyItemId, new Set([link.positionInWord]));
  }
  const workingVocab = new Map<string, WorkingVocabItem>();
  const newKanji = new Map<string, string>(); // character -> id, this run only
  const vocabKanjiLinks: VocabularyKanji[] = [];
  const sentenceVocabLinks: SentenceVocabulary[] = [];
  const now = nowIso();

  for (const analysis of toMaterialize) {
    const itemIdsForSentence = new Set<string>();
    for (const selection of analysis.selections) {
      const expression = selection.expression?.trim();
      if (!expression) continue;
      const reading = (selection.reading ?? '').trim();
      const key = normalizeExpressionKey(expression, reading);

      let vocabItem = workingVocab.get(key);
      if (!vocabItem) {
        const existing = vocabByKey.get(key);
        vocabItem = existing
          ? { ...existing, isNew: false }
          : {
              id: createId('vocab'),
              expression,
              reading,
              meaning: selection.english?.trim() ?? '',
              partOfSpeech: selection.pos?.trim() || undefined,
              isNew: true,
            };
        workingVocab.set(key, vocabItem);

        // Reconcile kanji breakdown for every item touched this run, not
        // just brand-new ones — a prior run could have written
        // vocabulary_items successfully but crashed before its
        // vocabulary_kanji batch (network drop, process killed mid-run),
        // which would otherwise leave that item permanently unlinked since
        // it's no longer classified "new" here. Cheap to always check: just
        // an Array.from + a Set lookup per character.
        const characters = Array.from(vocabItem.expression);
        const linkedPositions = linkedPositionsByItemId.get(vocabItem.id) ?? new Set<number>();
        for (let position = 0; position < characters.length; position += 1) {
          const character = characters[position]!;
          if (!isHanCharacter(character) || linkedPositions.has(position)) continue;
          let kanjiId = kanjiIdByCharacter.get(character);
          if (!kanjiId) {
            kanjiId = createId('kanji');
            kanjiIdByCharacter.set(character, kanjiId);
            newKanji.set(character, kanjiId);
          }
          vocabKanjiLinks.push({
            id: createId('vocab_kanji'),
            vocabularyItemId: vocabItem.id,
            kanjiId,
            positionInWord: position,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
      itemIdsForSentence.add(vocabItem.id);
    }
    for (const vocabularyItemId of itemIdsForSentence) {
      sentenceVocabLinks.push({
        id: createId('sentence_vocab'),
        sentenceId: analysis.sentenceId,
        vocabularyItemId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const newVocabItems = [...workingVocab.values()].filter((item) => item.isNew);
  const newKanjiRows: Kanji[] = [...newKanji.entries()].map(([character, id]) => ({
    id,
    character,
    meanings: [],
    onyomi: [],
    kunyomi: [],
    nanori: [],
    createdAt: now,
    updatedAt: now,
  }));

  console.log(
    `\n${toMaterialize.length} sentence(s) to materialize: ${newVocabItems.length} new vocabulary item(s), ` +
      `${newKanjiRows.length} new kanji row(s), ${vocabKanjiLinks.length} new vocabulary_kanji link(s), ` +
      `${sentenceVocabLinks.length} new sentence_vocabulary link(s).`,
  );

  // Validate everything before writing anything.
  for (const item of newVocabItems) {
    vocabularyItemSchema.parse({
      id: item.id,
      expression: item.expression,
      reading: item.reading,
      meaning: item.meaning,
      partOfSpeech: item.partOfSpeech,
      createdAt: now,
      updatedAt: now,
    });
  }
  for (const kanji of newKanjiRows) kanjiSchema.parse(kanji);
  for (const link of vocabKanjiLinks) vocabularyKanjiSchema.parse(link);
  for (const link of sentenceVocabLinks) sentenceVocabularySchema.parse(link);

  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
    return;
  }

  // Dependency order: kanji/vocabulary_items (parents, no ordering
  // constraint on each other) before vocabulary_kanji/sentence_vocabulary
  // (children — both reference vocabulary_items, vocabulary_kanji also
  // references kanji) — same ordering established in
  // src/sync/engine.ts's uploadAllLocalData.
  await Promise.all([
    upsertBatched(
      supabase,
      'kanji',
      newKanjiRows.map((row) => withoutVersionAndTimestamps(kanjiToRemote(row, user.id, 1))),
      'id',
    ),
    upsertBatched(
      supabase,
      'vocabulary_items',
      newVocabItems.map((item) =>
        withoutVersionAndTimestamps(
          vocabularyItemToRemote(
            {
              id: item.id,
              expression: item.expression,
              reading: item.reading,
              meaning: item.meaning,
              partOfSpeech: item.partOfSpeech,
              createdAt: now,
              updatedAt: now,
            },
            user.id,
            1,
          ),
        ),
      ),
      'id',
    ),
  ]);
  await upsertBatched(
    supabase,
    'vocabulary_kanji',
    vocabKanjiLinks.map((link) => withoutVersionAndTimestamps(vocabularyKanjiToRemote(link, user.id, 1))),
    'id',
  );
  await upsertBatched(
    supabase,
    'sentence_vocabulary',
    sentenceVocabLinks.map((link) =>
      withoutVersionAndTimestamps(sentenceVocabularyToRemote(link, user.id, 1)),
    ),
    'id',
  );

  console.log('\nApplied.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
