/**
 * Read-only diagnostic: live `study_items` in the cloud whose subject *row*
 * is entirely missing (not merely unlinked).
 *
 * `cleanup-orphaned-study-items.ts` judges a `grammarPattern` item orphaned
 * only when the pattern has no live `sentence_grammar` link — it never checks
 * that the `grammar_patterns` row itself exists. Symptom that slips through:
 * `/study-items/:id` shows "Subject not found (may have been deleted)" and the
 * card sits stuck-due, even after a full local wipe + re-download, because the
 * subject row is absent from the cloud too (the originating device never
 * pushed it, or a `pullChanges` skip dropped it upstream). `grammar_patterns`
 * has no delete path anywhere in the app, so a missing one is always a bug.
 *
 * Usage: npx tsx scripts/diagnose-missing-subject-study-items.ts
 */
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

async function fetchAll(
  supabase: any,
  table: string,
  columns: string,
  { includeDeleted = false } = {},
): Promise<Row[]> {
  const rows: Row[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    let query = supabase.from(table).select(columns).order('id', { ascending: true }).range(from, from + page - 1);
    if (!includeDeleted) query = query.is('deleted_at', null);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
    from += page;
  }
  return rows;
}

const SUBJECT_TABLE: Record<string, string> = {
  sentence: 'sentences',
  vocabularyItem: 'vocabulary_items',
  vocabularyConfusion: 'vocabulary_confusions',
  grammarPattern: 'grammar_patterns',
  sentenceVocabulary: 'sentence_vocabulary',
};

async function main() {
  const supabase = await createScriptSupabaseClient();
  const nowIso = new Date().toISOString();

  const [studyItems, sentences, vocabItems, vocabConfusions, patterns, sentenceVocab, reviews] =
    await Promise.all([
      fetchAll(supabase, 'study_items', 'id, subject_type, subject_id, activity_type, fsrs_state'),
      fetchAll(supabase, 'sentences', 'id'),
      fetchAll(supabase, 'vocabulary_items', 'id'),
      fetchAll(supabase, 'vocabulary_confusions', 'id'),
      fetchAll(supabase, 'grammar_patterns', 'id, canonical_name'),
      fetchAll(supabase, 'sentence_vocabulary', 'id'),
      fetchAll(supabase, 'reviews', 'study_item_id'),
    ]);

  const live: Record<string, Set<string>> = {
    sentence: new Set(sentences.map((r) => r.id)),
    vocabularyItem: new Set(vocabItems.map((r) => r.id)),
    vocabularyConfusion: new Set(vocabConfusions.map((r) => r.id)),
    grammarPattern: new Set(patterns.map((r) => r.id)),
    sentenceVocabulary: new Set(sentenceVocab.map((r) => r.id)),
  };

  const reviewCountByItem = new Map<string, number>();
  for (const r of reviews) {
    reviewCountByItem.set(r.study_item_id, (reviewCountByItem.get(r.study_item_id) ?? 0) + 1);
  }

  const missing = studyItems.filter((it) => {
    const set = live[it.subject_type];
    return set !== undefined && !set.has(it.subject_id);
  });

  if (missing.length === 0) {
    console.log('No study items with a missing subject row. Nothing to do.');
    return;
  }

  const byType = new Map<string, Row[]>();
  for (const it of missing) {
    const arr = byType.get(it.subject_type) ?? [];
    arr.push(it);
    byType.set(it.subject_type, arr);
  }

  console.log(`${missing.length} study item(s) whose subject row is missing from the cloud:\n`);
  for (const [type, items] of byType) {
    console.log(`  ${type} → ${SUBJECT_TABLE[type]} (${items.length}):`);
    for (const it of items) {
      const rc = reviewCountByItem.get(it.id) ?? 0;
      const due = it.fsrs_state?.due ?? '?';
      const overdue = typeof due === 'string' && due <= nowIso ? ' DUE' : '';
      console.log(
        `    study_item ${it.id}\n` +
          `      ${it.activity_type.padEnd(22)} state=${it.fsrs_state?.state ?? '?'} due=${due}${overdue} reviews=${rc}\n` +
          `      subject_id=${it.subject_id}`,
      );
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
