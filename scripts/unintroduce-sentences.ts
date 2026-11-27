/**
 * Puts sentences containing given words back into the not-yet-introduced pool so i+1 ordering can offer
 * them again. For each matched sentence that is introduced (`planUnintroduce`): appends a
 * `walkthrough_reset` event (cancels earlier walkthroughs, `withoutResetWalkthroughs`) and soft-deletes every
 * sentence study item. Reviews and other learning events are left as history. Soft deletes only (`deleted_at`),
 * so other devices learn of it through sync. Sentences whose book membership is started are reported, not changed.
 *
 * Dry-run by default; --apply required to write. Idempotent: reset sentences no longer read as introduced.
 *
 * Select sentences by text (--words, substring match, any word) and/or by id (--ids); both may be given.
 * Word strength/evidence is keyed by word, not sentence, so it is left alone: resetting only lowers how many
 * introduced sentences a word has been seen in, which is what i+1 ordering reads.
 *
 * Usage: npm run unintroduce:sentences -- --words 略語,習慣,趣味 [--ids sent_a,sent_b] [--apply]
 */
import type { SentenceLearningAction } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { planUnintroduce } from '../src/lib/sentenceUnintroduce';
import { fetchAll, insertBatched, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

function parseList(argv: string[], flag: string): string[] {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = parseApplyFlag(argv);
  const words = parseList(argv, '--words');
  const wantedIds = new Set(parseList(argv, '--ids'));
  if (words.length === 0 && wantedIds.size === 0) {
    throw new Error('Pass --words word1,word2 (substrings of the sentence text) and/or --ids sent_a,sent_b.');
  }
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const sentences = await fetchAll(supabase, 'sentences', 'id, japanese', user.id, (r) => ({
    id: String(r.id),
    japanese: String(r.japanese),
  }));
  const matched = sentences.filter(
    (s) => wantedIds.has(s.id) || words.some((word) => s.japanese.includes(word)),
  );
  console.log(`${matched.length} sentence(s) match (words: ${words.join(' / ') || '-'}; ids: ${wantedIds.size}).`);

  const [events, items, memberships] = await Promise.all([
    fetchAll(supabase, 'sentence_learning_events', 'id, sentence_id, action, timestamp', user.id, (r) => ({
      timestamp: String(r.timestamp),
      sentenceId: String(r.sentence_id),
      action: String(r.action) as SentenceLearningAction,
    })),
    fetchAll(supabase, 'study_items', 'id, subject_type, subject_id, activity_type', user.id, (r) => ({
      id: String(r.id),
      subjectType: String(r.subject_type),
      subjectId: String(r.subject_id),
      activityType: String(r.activity_type),
    })),
    fetchAll(supabase, 'book_sentences', 'id, book_id, chapter_id, sentence_id, status', user.id, (r) => ({
      sentenceId: String(r.sentence_id),
      bookId: String(r.book_id),
      chapterId: r.chapter_id ? String(r.chapter_id) : undefined,
      status: String(r.status),
    })),
  ]);

  const plan = planUnintroduce(
    matched.map((s) => s.id),
    events,
    items.filter((item) => item.subjectType === 'sentence'),
    memberships,
  );
  const textById = new Map(matched.map((s) => [s.id, s.japanese]));
  console.log(`\nIntroduced and to reset: ${plan.sentenceIds.length}`);
  for (const id of plan.sentenceIds) console.log(`  ${id}  ${textById.get(id)}`);
  console.log(`walkthrough_reset events to add: ${plan.resetEvents.length}`);
  console.log(`study items to soft-delete: ${plan.retireItemIds.length}`);
  if (plan.skippedStartedMembership.length) {
    console.log(`Skipped (book membership started, not changed): ${plan.skippedStartedMembership.join(', ')}`);
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  const stamp = new Date().toISOString();
  await insertBatched(
    supabase,
    'sentence_learning_events',
    plan.resetEvents.map((e) => ({
      id: createId('sle'),
      owner_id: user.id,
      timestamp: stamp,
      visit_id: createId('visit'),
      action: 'walkthrough_reset',
      book_id: e.bookId,
      chapter_id: e.chapterId ?? null,
      sentence_id: e.sentenceId,
    })),
  );
  for (const id of plan.retireItemIds) {
    const { error } = await supabase.from('study_items').update({ deleted_at: stamp }).eq('id', id);
    if (error) throw new Error(`Failed to retire study_item ${id}: ${error.message}`);
  }
  console.log(`\nAdded ${plan.resetEvents.length} reset event(s); retired ${plan.retireItemIds.length} study item(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
