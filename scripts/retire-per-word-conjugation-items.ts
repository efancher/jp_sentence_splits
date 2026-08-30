/**
 * One-time cleanup for the contextual-conjugation rework (see docs/STATUS.md).
 *
 * The old `sentence_transformation` card was one study item *per vocabulary
 * item* (`subject_type = 'vocabularyItem'`), quizzing a hash-picked form. The
 * new card is one study item *per occurrence* (`subject_type =
 * 'sentenceVocabulary'`, subject_id a sentence_vocabulary.id), quizzing the
 * form that sentence actually used. The old per-word rows are now unreachable
 * from ReviewPage (its conjugation descriptor only looks up
 * sentenceVocabulary-subject items), but they still match
 * `sentence_transformation` by activity type, so the session planner's
 * practice due-pool keeps counting them. This soft-deletes them so that
 * stops.
 *
 * Append-only `reviews` rows are left untouched (evidence history).
 *
 * Dry-run by default; --apply required to write. Idempotent: already
 * soft-deleted rows are filtered out by `.is('deleted_at', null)`.
 *
 * Usage: npx tsx scripts/retire-per-word-conjugation-items.ts -- [--apply]
 */
import { parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data: rows, error } = await supabase
    .from('study_items')
    .select('id, subject_id')
    .eq('owner_id', user.id)
    .eq('activity_type', 'sentence_transformation')
    .eq('subject_type', 'vocabularyItem')
    .is('deleted_at', null);
  if (error) throw new Error(`Failed to fetch study_items: ${error.message}`);

  console.log(
    `${rows?.length ?? 0} per-word sentence_transformation study_item(s) to retire.\n`,
  );

  if (apply) {
    for (const row of rows ?? []) {
      const { error: updateError } = await supabase
        .from('study_items')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', row.id);
      if (updateError) {
        throw new Error(`Failed to retire study_item ${row.id}: ${updateError.message}`);
      }
      console.log(`  retired ${row.id} (word ${row.subject_id})`);
    }
  }

  console.log(
    `\nDone. ${apply ? 'Retired' : 'Would retire'} ${rows?.length ?? 0} study_item(s).`,
  );
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
