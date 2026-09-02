/**
 * Read-mostly cleanup: soft-delete `study_items` whose subject can no longer
 * produce a review card, so they stop sitting stuck-due and inflating the
 * planner / Study-items list.
 *
 * Prompted 2026-09-02: the 2026-09-01 "After Work" / "GLIM SPANKY" sentence
 * soft-deletes left orphans because `cascadeRetireSentenceLocal` only retired
 * `subjectType: 'sentence'` items — not the `sentenceVocabulary`-subject
 * per-occurrence cards (word_listening / sentence_transformation) keyed off
 * the links it deleted, nor `grammarPattern`-subject items whose last live
 * occurrence was in a deleted sentence. The cascade itself is fixed in
 * `repository.ts`; this clears what already leaked.
 *
 * Orphan = a live study_item whose:
 *   - subjectType 'sentence'            → no live `sentences` row
 *   - subjectType 'sentenceVocabulary'  → no live `sentence_vocabulary` row
 *   - subjectType 'vocabularyItem'      → no live `vocabulary_items` row
 *   - subjectType 'vocabularyConfusion' → no live `vocabulary_confusions` row
 *   - subjectType 'grammarPattern'      → pattern has no live `sentence_grammar`
 *                                         link (pickContextSentenceForGrammar-
 *                                         Pattern would return undefined)
 *   - subjectType 'chunk'               → left alone (chunkId was never a real FK)
 *
 * Soft-delete only (`deleted_at`), never raw DELETE. Append-only `reviews`
 * rows are left dangling on purpose (same call as reviews.context_sentence_id).
 * Dry-run by default; --apply to write. Idempotent.
 *
 * Usage: npx tsx scripts/cleanup-orphaned-study-items.ts [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

async function fetchAll(supabase: any, table: string, columns: string): Promise<Row[]> {
  const rows: Row[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
    from += page;
  }
  return rows;
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [studyItems, sentences, sentenceVocab, vocabItems, vocabConfusions, grammarLinks, reviews] =
    await Promise.all([
      fetchAll(supabase, 'study_items', 'id, subject_type, subject_id, activity_type, fsrs_state'),
      fetchAll(supabase, 'sentences', 'id'),
      fetchAll(supabase, 'sentence_vocabulary', 'id'),
      fetchAll(supabase, 'vocabulary_items', 'id'),
      fetchAll(supabase, 'vocabulary_confusions', 'id'),
      fetchAll(supabase, 'sentence_grammar', 'grammar_pattern_id'),
      fetchAll(supabase, 'reviews', 'study_item_id'),
    ]);

  const live: Record<string, Set<string>> = {
    sentence: new Set(sentences.map((r) => r.id)),
    sentenceVocabulary: new Set(sentenceVocab.map((r) => r.id)),
    vocabularyItem: new Set(vocabItems.map((r) => r.id)),
    vocabularyConfusion: new Set(vocabConfusions.map((r) => r.id)),
    grammarPattern: new Set(grammarLinks.map((r) => r.grammar_pattern_id)),
  };

  const reviewCountByItem = new Map<string, number>();
  for (const r of reviews) {
    reviewCountByItem.set(r.study_item_id, (reviewCountByItem.get(r.study_item_id) ?? 0) + 1);
  }

  const orphans = studyItems.filter((it) => {
    const set = live[it.subject_type];
    return set !== undefined && !set.has(it.subject_id);
  });

  if (orphans.length === 0) {
    console.log('No orphaned study items. Nothing to do.');
    return;
  }

  const byType = new Map<string, Row[]>();
  for (const it of orphans) {
    const arr = byType.get(it.subject_type) ?? [];
    arr.push(it);
    byType.set(it.subject_type, arr);
  }

  console.log(`${orphans.length} orphaned study item(s):\n`);
  for (const [type, items] of byType) {
    console.log(`  ${type} (${items.length}):`);
    for (const it of items) {
      const rc = reviewCountByItem.get(it.id) ?? 0;
      console.log(
        `    ${it.activity_type.padEnd(24)} state=${it.fsrs_state?.state ?? '?'} reviews=${rc}  (${it.subject_id})`,
      );
    }
  }

  const totalReviews = orphans.reduce((n, it) => n + (reviewCountByItem.get(it.id) ?? 0), 0);
  console.log(
    `\n${totalReviews} review row(s) will be left dangling (append-only, harmless).`,
  );

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to soft-delete.');
    return;
  }

  const nowIso = new Date().toISOString();
  let done = 0;
  for (const it of orphans) {
    const { error } = await supabase
      .from('study_items')
      .update({ deleted_at: nowIso })
      .eq('id', it.id)
      .eq('owner_id', user.id);
    if (error) throw new Error(`Failed to soft-delete study_item ${it.id}: ${error.message}`);
    done += 1;
  }
  console.log(`\nSoft-deleted ${done} study item(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
