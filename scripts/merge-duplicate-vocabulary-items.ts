/**
 * Merges the vocabulary_items duplicates left behind by the reading-mismatch
 * bug (src/lib/vocabularySuggestions.ts, fixed; see
 * fix-vocabulary-reading-mismatches.ts): ensureVocabularyItem() dedupes on
 * the exact (expression, reading) pair, so a word studied once in dictionary
 * form (correct reading) and once in a conjugated form (buggy reading, pre-
 * fix) ended up as two separate rows for the same real word — one of them
 * carrying whatever study history/review the learner actually did.
 *
 * Finds "buggy" items using both detection methods already in this repo: the
 * string-math derivation from fix-vocabulary-reading-mismatches.ts (ichidan
 * る-drop etc.) and, when that doesn't apply, the single-common-JMDict-
 * reading rule from fix-vocabulary-godan-readings.ts (godan stem changes,
 * irregulars) — either way, only when the derived correct reading matches an
 * existing *other* item's reading for the same expression. For each pair:
 *   1. study_items on the buggy item are repointed (subject_id ->
 *      correct item's id) rather than deleted — preserves FSRS state,
 *      review history, and any card_issue_reports (which reference
 *      study_item_id, untouched by this). If a study_item already exists
 *      for the correct item + same activity_type, the one with fewer
 *      reviews is repointed onto instead (its own reviews/card_issue_reports
 *      moved across first) and then soft-deleted — never silently dropped.
 *   2. sentence_vocabulary links on the buggy item are repointed to the
 *      correct item, unless the correct item already has a link for that
 *      exact sentence (sentence_vocabulary_uidx), in which case the buggy
 *      link is soft-deleted (its surface_form is copied across first if the
 *      surviving link doesn't have one).
 *   3. vocabulary_kanji links on the buggy item are repointed if the correct
 *      item doesn't already have that kanji at that position, else deleted.
 *   4. The buggy vocabulary_items row itself is soft-deleted last, after
 *      everything referencing it has been moved.
 *
 * Dry-run by default; --apply required to write. Idempotent: a merged
 * (deleted_at set) item is excluded from candidate detection on the next
 * run.
 *
 * Usage: npm run merge:duplicate-vocabulary-items -- [--apply]
 */
import { deriveDictionaryReading } from '../src/lib/vocabularySuggestions';

import { buildJmdictIndex, ensureJmdictFile } from './lib/jmdict';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type SupabaseClient = Awaited<ReturnType<typeof createScriptSupabaseClient>>;

interface VocabularyItemRow {
  id: string;
  expression: string;
  reading: string;
}

interface LinkRow {
  id: string;
  vocabularyItemId: string;
  surfaceForm: string | null;
}

interface SentenceVocabRow {
  id: string;
  sentenceId: string;
  vocabularyItemId: string;
  chunkId: string | null;
  surfaceForm: string | null;
}

interface KanjiLinkRow {
  id: string;
  vocabularyItemId: string;
  kanjiId: string;
  position: number;
}

interface StudyItemRow {
  id: string;
  subjectId: string;
  activityType: string;
}

async function findMergePairs(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<{ buggy: VocabularyItemRow; correct: VocabularyItemRow }[]> {
  const [links, items] = await Promise.all([
    fetchAll(
      supabase,
      'sentence_vocabulary',
      'id, vocabulary_item_id, surface_form',
      ownerId,
      (row): LinkRow => ({
        id: String(row.id),
        vocabularyItemId: String(row.vocabulary_item_id),
        surfaceForm: row.surface_form ? String(row.surface_form) : null,
      }),
    ),
    fetchAll(
      supabase,
      'vocabulary_items',
      'id, expression, reading',
      ownerId,
      (row): VocabularyItemRow => ({
        id: String(row.id),
        expression: String(row.expression ?? ''),
        reading: String(row.reading ?? ''),
      }),
    ),
  ]);

  const surfaceFormsByItemId = new Map<string, Set<string>>();
  for (const link of links) {
    if (!link.surfaceForm) continue;
    const set = surfaceFormsByItemId.get(link.vocabularyItemId) ?? new Set<string>();
    set.add(link.surfaceForm);
    surfaceFormsByItemId.set(link.vocabularyItemId, set);
  }
  const itemById = new Map(items.map((item) => [item.id, item]));
  const itemIdByExpressionReading = new Map(
    items.map((item) => [`${item.expression} ${item.reading}`, item.id]),
  );

  const jmdictIndex = buildJmdictIndex(await ensureJmdictFile());

  const pairs: { buggy: VocabularyItemRow; correct: VocabularyItemRow }[] = [];
  const seenBuggyIds = new Set<string>();
  for (const item of items) {
    const surfaceForms = surfaceFormsByItemId.get(item.id);
    if (!surfaceForms) continue;
    if (![...surfaceForms].some((s) => s !== item.expression)) continue; // never seen conjugated

    // Same string-math derivation as fix-vocabulary-reading-mismatches.ts
    // (ichidan/i-adjective る-drop etc.).
    const derivedReadings = new Set(
      [...surfaceForms]
        .map((surfaceForm) => deriveDictionaryReading(surfaceForm, item.reading, item.expression))
        .filter((derived) => derived !== item.reading),
    );
    let correctId: string | undefined;
    if (derivedReadings.size === 1) {
      correctId = itemIdByExpressionReading.get(`${item.expression} ${[...derivedReadings][0]}`);
    }

    // Fall back to the same single-common-JMDict-reading rule as
    // fix-vocabulary-godan-readings.ts (godan stem changes, irregulars).
    if (!correctId) {
      const jmdictEntries = jmdictIndex.byExpression.get(item.expression) ?? [];
      const allReadings = new Set(jmdictEntries.map((entry) => entry.reading));
      if (!allReadings.has(item.reading) && allReadings.size > 0) {
        let jmdictReading: string | undefined;
        if (allReadings.size === 1) {
          jmdictReading = [...allReadings][0];
        } else {
          const commonReadings = new Set(
            jmdictEntries.filter((entry) => entry.common).map((entry) => entry.reading),
          );
          if (commonReadings.size === 1) jmdictReading = [...commonReadings][0];
        }
        if (jmdictReading) {
          correctId = itemIdByExpressionReading.get(`${item.expression} ${jmdictReading}`);
        }
      }
    }

    if (!correctId || seenBuggyIds.has(item.id)) continue;
    seenBuggyIds.add(item.id);
    pairs.push({ buggy: item, correct: itemById.get(correctId)! });
  }
  return pairs;
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Finding duplicate vocabulary item pairs...');
  const pairs = await findMergePairs(supabase, user.id);
  console.log(`Found ${pairs.length} pair(s) to merge.\n`);
  if (!pairs.length) return;

  for (const { buggy, correct } of pairs) {
    console.log(`--- ${buggy.expression}: "${buggy.reading}" (${buggy.id}) -> "${correct.reading}" (${correct.id}) ---`);

    const [buggyStudyItems, correctStudyItems, buggyLinks, correctLinks, buggyKanji, correctKanji] =
      await Promise.all([
        fetchAll(supabase, 'study_items', 'id, subject_id, activity_type', user.id, (row): StudyItemRow => ({
          id: String(row.id),
          subjectId: String(row.subject_id),
          activityType: String(row.activity_type),
        })).then((rows) => rows.filter((row) => row.subjectId === buggy.id)),
        fetchAll(supabase, 'study_items', 'id, subject_id, activity_type', user.id, (row): StudyItemRow => ({
          id: String(row.id),
          subjectId: String(row.subject_id),
          activityType: String(row.activity_type),
        })).then((rows) => rows.filter((row) => row.subjectId === correct.id)),
        fetchAll(
          supabase,
          'sentence_vocabulary',
          'id, sentence_id, vocabulary_item_id, chunk_id, surface_form',
          user.id,
          (row): SentenceVocabRow => ({
            id: String(row.id),
            sentenceId: String(row.sentence_id),
            vocabularyItemId: String(row.vocabulary_item_id),
            chunkId: row.chunk_id ? String(row.chunk_id) : null,
            surfaceForm: row.surface_form ? String(row.surface_form) : null,
          }),
        ).then((rows) => rows.filter((row) => row.vocabularyItemId === buggy.id)),
        fetchAll(
          supabase,
          'sentence_vocabulary',
          'id, sentence_id, vocabulary_item_id, chunk_id, surface_form',
          user.id,
          (row): SentenceVocabRow => ({
            id: String(row.id),
            sentenceId: String(row.sentence_id),
            vocabularyItemId: String(row.vocabulary_item_id),
            chunkId: row.chunk_id ? String(row.chunk_id) : null,
            surfaceForm: row.surface_form ? String(row.surface_form) : null,
          }),
        ).then((rows) => rows.filter((row) => row.vocabularyItemId === correct.id)),
        fetchAll(
          supabase,
          'vocabulary_kanji',
          'id, vocabulary_item_id, kanji_id, position_in_word',
          user.id,
          (row): KanjiLinkRow => ({
            id: String(row.id),
            vocabularyItemId: String(row.vocabulary_item_id),
            kanjiId: String(row.kanji_id),
            position: Number(row.position_in_word),
          }),
        ).then((rows) => rows.filter((row) => row.vocabularyItemId === buggy.id)),
        fetchAll(
          supabase,
          'vocabulary_kanji',
          'id, vocabulary_item_id, kanji_id, position_in_word',
          user.id,
          (row): KanjiLinkRow => ({
            id: String(row.id),
            vocabularyItemId: String(row.vocabulary_item_id),
            kanjiId: String(row.kanji_id),
            position: Number(row.position_in_word),
          }),
        ).then((rows) => rows.filter((row) => row.vocabularyItemId === correct.id)),
      ]);

    // 1. study_items: repoint onto correct item, unless correct already has
    // one for the same activity_type -- then keep the one with more
    // reviews, moving the other's reviews/card_issue_reports across first.
    for (const buggyStudyItem of buggyStudyItems) {
      const collision = correctStudyItems.find((s) => s.activityType === buggyStudyItem.activityType);
      if (!collision) {
        console.log(`  study_items: repoint ${buggyStudyItem.id} (${buggyStudyItem.activityType}) -> subject ${correct.id}`);
        if (apply) {
          const { error } = await supabase
            .from('study_items')
            .update({ subject_id: correct.id })
            .eq('id', buggyStudyItem.id);
          if (error) throw new Error(`Failed to repoint study_item ${buggyStudyItem.id}: ${error.message}`);
        }
        continue;
      }

      const [buggyReviewCount, correctReviewCount] = await Promise.all([
        supabase
          .from('reviews')
          .select('id', { count: 'exact', head: true })
          .eq('owner_id', user.id)
          .eq('study_item_id', buggyStudyItem.id)
          .is('deleted_at', null),
        supabase
          .from('reviews')
          .select('id', { count: 'exact', head: true })
          .eq('owner_id', user.id)
          .eq('study_item_id', collision.id)
          .is('deleted_at', null),
      ]);
      const [loser, survivor] =
        (buggyReviewCount.count ?? 0) > (correctReviewCount.count ?? 0)
          ? [collision, buggyStudyItem]
          : [buggyStudyItem, collision];
      console.log(
        `  study_items: activity_type "${buggyStudyItem.activityType}" collision -- moving reviews/issue reports from ${loser.id} onto ${survivor.id}, then deleting ${loser.id}`,
      );
      if (apply) {
        const { error: reviewsError } = await supabase
          .from('reviews')
          .update({ study_item_id: survivor.id })
          .eq('study_item_id', loser.id);
        if (reviewsError) throw new Error(`Failed to repoint reviews from ${loser.id}: ${reviewsError.message}`);
        const { error: issuesError } = await supabase
          .from('card_issue_reports')
          .update({ study_item_id: survivor.id })
          .eq('study_item_id', loser.id);
        if (issuesError) throw new Error(`Failed to repoint card_issue_reports from ${loser.id}: ${issuesError.message}`);
        const { error: deleteError } = await supabase
          .from('study_items')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', loser.id);
        if (deleteError) throw new Error(`Failed to delete study_item ${loser.id}: ${deleteError.message}`);
        if (survivor.id === buggyStudyItem.id) {
          const { error: repointError } = await supabase
            .from('study_items')
            .update({ subject_id: correct.id })
            .eq('id', survivor.id);
          if (repointError) throw new Error(`Failed to repoint surviving study_item ${survivor.id}: ${repointError.message}`);
        }
      }
    }

    // 2. sentence_vocabulary: repoint unless the correct item already has a
    // link for that sentence.
    for (const link of buggyLinks) {
      const collision = correctLinks.find((c) => c.sentenceId === link.sentenceId && c.chunkId === link.chunkId);
      if (!collision) {
        console.log(`  sentence_vocabulary: repoint ${link.id} (sentence ${link.sentenceId}) -> item ${correct.id}`);
        if (apply) {
          const { error } = await supabase
            .from('sentence_vocabulary')
            .update({ vocabulary_item_id: correct.id })
            .eq('id', link.id);
          if (error) throw new Error(`Failed to repoint sentence_vocabulary ${link.id}: ${error.message}`);
        }
        continue;
      }
      if (link.surfaceForm && !collision.surfaceForm) {
        console.log(`  sentence_vocabulary: copy surface_form "${link.surfaceForm}" onto ${collision.id}, delete ${link.id}`);
        if (apply) {
          const { error } = await supabase
            .from('sentence_vocabulary')
            .update({ surface_form: link.surfaceForm })
            .eq('id', collision.id);
          if (error) throw new Error(`Failed to copy surface_form onto ${collision.id}: ${error.message}`);
        }
      } else {
        console.log(`  sentence_vocabulary: delete redundant ${link.id} (sentence ${link.sentenceId} already linked)`);
      }
      if (apply) {
        const { error } = await supabase
          .from('sentence_vocabulary')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', link.id);
        if (error) throw new Error(`Failed to delete sentence_vocabulary ${link.id}: ${error.message}`);
      }
    }

    // 3. vocabulary_kanji: repoint unless the correct item already has that
    // kanji at that position.
    for (const kanjiLink of buggyKanji) {
      const collision = correctKanji.find((c) => c.kanjiId === kanjiLink.kanjiId && c.position === kanjiLink.position);
      if (!collision) {
        console.log(`  vocabulary_kanji: repoint ${kanjiLink.id} -> item ${correct.id}`);
        if (apply) {
          const { error } = await supabase
            .from('vocabulary_kanji')
            .update({ vocabulary_item_id: correct.id })
            .eq('id', kanjiLink.id);
          if (error) throw new Error(`Failed to repoint vocabulary_kanji ${kanjiLink.id}: ${error.message}`);
        }
      } else {
        console.log(`  vocabulary_kanji: delete redundant ${kanjiLink.id}`);
        if (apply) {
          const { error } = await supabase
            .from('vocabulary_kanji')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', kanjiLink.id);
          if (error) throw new Error(`Failed to delete vocabulary_kanji ${kanjiLink.id}: ${error.message}`);
        }
      }
    }

    // 4. finally, soft-delete the buggy item itself.
    console.log(`  vocabulary_items: delete ${buggy.id}`);
    if (apply) {
      const { error } = await supabase
        .from('vocabulary_items')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', buggy.id);
      if (error) throw new Error(`Failed to delete vocabulary_item ${buggy.id}: ${error.message}`);
    }
    console.log();
  }

  console.log(`Done. ${pairs.length} pair(s) ${apply ? 'merged' : 'would be merged'}.`);
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
