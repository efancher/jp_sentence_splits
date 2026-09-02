/**
 * One-time / idempotent cleanup: push out the due date of any live
 * `grammarPattern`-subject study_item whose pattern has NO full-review-ready
 * context sentence right now — the server-side twin of
 * `deferUnreadyGrammarReviews` (src/db/repository.ts).
 *
 * Such an item can't render a card (ReviewPage drops the pattern when
 * `pickContextSentenceForGrammarPattern` returns undefined) yet still reads
 * as due — invisible in /review but inflating the session planner's backlog
 * and showing "Subject not found" on `/study-items/:id` for any client that
 * is also missing the pattern row locally. The app now defers these on its
 * own, but only on a device that opens /review; this reaches every device
 * immediately (the fsrs_state update bumps version + fires append_sync_event).
 *
 * "Ready" mirrors getSentenceFullReviewReadiness: the pattern has a live
 * `sentence_grammar` link to a sentence whose analysis is
 * `vocabulary_review_status = 'confirmed'` AND every surface-form vocab item
 * in it has a `vocabularyItem` study_item at FSRS review/relearning.
 *
 * Never pulls a due date earlier. Dry-run by default; --apply to write.
 *
 * Usage: npx tsx scripts/defer-unready-grammar-reviews.ts [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

type Row = Record<string, any>;

const MIN_DEFER_DAYS = 7;
const PROFICIENT = new Set(['review', 'relearning']);

async function fetchAll(
  supabase: any,
  table: string,
  columns: string,
  orderColumn = 'id',
): Promise<Row[]> {
  const rows: Row[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .is('deleted_at', null)
      .order(orderColumn, { ascending: true })
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
  const now = new Date();
  const nowIso = now.toISOString();
  const minDueIso = new Date(now.getTime() + MIN_DEFER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [studyItems, links, analyses, sentenceVocab] = await Promise.all([
    fetchAll(supabase, 'study_items', 'id, subject_type, subject_id, activity_type, fsrs_state'),
    fetchAll(supabase, 'sentence_grammar', 'grammar_pattern_id, sentence_id'),
    fetchAll(supabase, 'analyses', 'sentence_id, vocabulary_review_status', 'sentence_id'),
    fetchAll(supabase, 'sentence_vocabulary', 'sentence_id, vocabulary_item_id, surface_form'),
  ]);

  const proficientVocab = new Set<string>();
  for (const it of studyItems) {
    if (it.subject_type === 'vocabularyItem' && PROFICIENT.has(it.fsrs_state?.state)) {
      proficientVocab.add(it.subject_id);
    }
  }
  const reviewStatusBySentence = new Map(
    analyses.map((a) => [a.sentence_id, a.vocabulary_review_status ?? 'unreviewed']),
  );
  const surfaceVocabBySentence = new Map<string, Set<string>>();
  for (const l of sentenceVocab) {
    if (!l.surface_form) continue;
    let set = surfaceVocabBySentence.get(l.sentence_id);
    if (!set) surfaceVocabBySentence.set(l.sentence_id, (set = new Set()));
    set.add(l.vocabulary_item_id);
  }
  const sentenceReady = (sentenceId: string): boolean => {
    if (reviewStatusBySentence.get(sentenceId) !== 'confirmed') return false;
    const vocab = [...(surfaceVocabBySentence.get(sentenceId) ?? [])];
    return vocab.every((id) => proficientVocab.has(id));
  };

  const readySentencesByPattern = new Map<string, boolean>();
  for (const link of links) {
    const prev = readySentencesByPattern.get(link.grammar_pattern_id) ?? false;
    readySentencesByPattern.set(
      link.grammar_pattern_id,
      prev || sentenceReady(link.sentence_id),
    );
  }

  const stuck = studyItems.filter(
    (it) =>
      it.subject_type === 'grammarPattern' &&
      (it.fsrs_state?.due ?? '') <= nowIso &&
      (it.fsrs_state?.due ?? '') < minDueIso &&
      !readySentencesByPattern.get(it.subject_id),
  );

  if (stuck.length === 0) {
    console.log('No due grammar study items without a ready context sentence. Nothing to do.');
    return;
  }

  console.log(`${stuck.length} due grammar study item(s) with no ready context sentence:\n`);
  for (const it of stuck) {
    console.log(
      `  ${it.id}  ${it.activity_type.padEnd(22)} due=${it.fsrs_state?.due}  pattern=${it.subject_id}`,
    );
  }
  console.log(`\nWould push each due date out to ${minDueIso}.`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply.');
    return;
  }

  let done = 0;
  for (const it of stuck) {
    const nextState = { ...it.fsrs_state, due: minDueIso };
    const { error } = await supabase
      .from('study_items')
      .update({ fsrs_state: nextState })
      .eq('id', it.id)
      .eq('owner_id', user.id);
    if (error) throw new Error(`Failed to defer study_item ${it.id}: ${error.message}`);
    done += 1;
  }
  console.log(`\nDeferred ${done} study item(s) to ${minDueIso}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
