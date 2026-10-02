/**
 * One-off: create the (new, due-now) reading_in_context study item for every
 * sentence that has a walkthrough_completed event but no study item yet.
 * Going forward logSentenceLearningEvent does this at walkthrough time under
 * the sentence-led flow; this covers walkthroughs from before that change.
 *
 * Dry-run by default; --apply to write. Idempotent: sentences that already
 * have a reading_in_context item are skipped.
 *
 * Usage: npm run backfill:walked-sentence-items -- [--apply]
 */
import { createId } from '../src/lib/ids';
import { nowIso } from '../src/lib/normalize';
import { createInitialFsrsState } from '../src/lib/scheduling';
import { studyItemToRemote } from '../src/sync/mappers';

import { insertBatched, parseApplyFlag, requireAuthedUser, withoutVersionAndTimestamps } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const { data: events, error: eventsError } = await supabase
    .from('sentence_learning_events')
    .select('sentence_id')
    .eq('owner_id', user.id)
    .eq('action', 'walkthrough_completed')
    .is('deleted_at', null)
    .limit(1000);
  if (eventsError) throw new Error(eventsError.message);
  const walked = [...new Set((events ?? []).map((row) => String(row.sentence_id)))];

  const { data: sentences, error: sentencesError } = await supabase
    .from('sentences')
    .select('id')
    .eq('owner_id', user.id)
    .is('deleted_at', null)
    .in('id', walked);
  if (sentencesError) throw new Error(sentencesError.message);
  const liveSentenceIds = new Set((sentences ?? []).map((row) => String(row.id)));

  const { data: existing, error: existingError } = await supabase
    .from('study_items')
    .select('subject_id')
    .eq('owner_id', user.id)
    .eq('subject_type', 'sentence')
    .eq('activity_type', 'reading_in_context')
    .is('deleted_at', null)
    .in('subject_id', walked);
  if (existingError) throw new Error(existingError.message);
  const seeded = new Set((existing ?? []).map((row) => String(row.subject_id)));

  const missing = walked.filter((id) => liveSentenceIds.has(id) && !seeded.has(id));
  console.log(`${walked.length} walked sentences, ${missing.length} missing a reading_in_context item.`);
  for (const id of missing) console.log(`  ${id}`);
  if (!apply) {
    console.log('Dry run — pass --apply to write.');
    return;
  }

  const now = nowIso();
  const rows = missing.map((subjectId) =>
    withoutVersionAndTimestamps(
      studyItemToRemote(
        {
          id: createId('study_item'),
          subjectType: 'sentence',
          subjectId,
          activityType: 'reading_in_context',
          fsrsState: createInitialFsrsState(),
          createdAt: now,
          updatedAt: now,
        },
        user.id,
        1,
      ),
    ),
  );
  await insertBatched(supabase, 'study_items', rows);
  console.log(`Inserted ${rows.length} study items.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
