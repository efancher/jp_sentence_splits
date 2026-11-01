/**
 * One-time cleanup for the one-dictation-tile-per-sentence change
 * (docs/STATUS.md). Sentences seeded before it may hold up to nine
 * `dictation_tile:N` study items; this keeps the most-reviewed one per sentence
 * (`planDictationRetirement`) and soft-deletes the rest so they stop being due.
 *
 * Append-only `reviews` rows are left untouched (evidence history). Retired
 * rows get `deleted_at` set, never a hard delete, so other devices learn of it
 * through sync.
 *
 * Dry-run by default; --apply required to write. Idempotent: soft-deleted rows
 * are excluded from the read.
 *
 * Usage: npm run retire:extra-dictation-tiles [-- --apply]
 */
import { planDictationRetirement } from '../src/lib/dictationRetirement';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const [studyItems, reviews] = await Promise.all([
    fetchAll(supabase, 'study_items', 'id, subject_type, subject_id, activity_type', user.id, (r) => ({
      id: String(r.id),
      subjectType: String(r.subject_type),
      subjectId: String(r.subject_id),
      activityType: String(r.activity_type),
    })),
    fetchAll(supabase, 'reviews', 'id, study_item_id', user.id, (r) => ({ studyItemId: String(r.study_item_id) })),
  ]);
  const dictation = studyItems.filter(
    (item) => item.subjectType === 'sentence' && item.activityType.startsWith('dictation_tile:'),
  );
  const reviewCount = new Map<string, number>();
  for (const review of reviews) reviewCount.set(review.studyItemId, (reviewCount.get(review.studyItemId) ?? 0) + 1);

  const plan = planDictationRetirement(dictation, reviewCount);
  const sentences = new Set(dictation.map((item) => item.subjectId)).size;
  console.log(`${dictation.length} dictation_tile study item(s) across ${sentences} sentence(s).`);
  console.log(`Keep ${plan.keep.length} (one per sentence); retire ${plan.retire.length}.`);
  console.log(
    `${plan.retiredWithReviews.length} of the retired item(s) have reviews (their history stays; only the card goes).`,
  );
  const kept = dictation.filter((item) => plan.keep.includes(item.id));
  const perTile = new Map<string, number>();
  for (const item of kept) perTile.set(item.activityType, (perTile.get(item.activityType) ?? 0) + 1);
  console.log('Kept, by tile:', Object.fromEntries([...perTile].sort()));

  if (apply) {
    const stamp = new Date().toISOString();
    for (const id of plan.retire) {
      const { error } = await supabase.from('study_items').update({ deleted_at: stamp }).eq('id', id);
      if (error) throw new Error(`Failed to retire study_item ${id}: ${error.message}`);
    }
    console.log(`\nRetired ${plan.retire.length} study_item(s).`);
  } else {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
