/**
 * One-time production reset (user request, 2026-08-16): pushes out any
 * currently-due `study_items` full-sentence review card
 * (`comprehension`/`reading_in_context`) that isn't ready yet — its
 * vocabulary hasn't even been reviewed, or has been reviewed but isn't
 * shown proficient — to at least a week from now. Reuses the exact same
 * pure gating logic (`isSentenceReadyForFullReview`, src/lib/scheduling.ts)
 * the app itself now runs automatically on every review-session load
 * (`deferUnreadySentenceReviews`/`getSentenceFullReviewReadiness`,
 * src/db/repository.ts) before computing what's due, and before lazily
 * seeding a new card for an activity type that has no study_item yet. This
 * script exists only to apply that same rule once, immediately, to
 * whatever's *already* due in production, rather than waiting for the next
 * time the review page happens to load.
 *
 * A sentence with `vocabulary_review_status !== 'confirmed'` (including no
 * `analyses` row at all — the common case for a freshly imported sentence
 * nobody has opened AnalyzePage for yet) is never ready, full stop —
 * that's the fix to this script's first version, which incorrectly treated
 * "no vocabulary links" as "nothing to check" and let brand-new sentences
 * skip the gate entirely.
 *
 * Dry-run by default; --apply required to write. Idempotent-ish: re-running
 * without intervening reviews will find the same items still due-in-the-
 * future and skip them (their due date is already >= the target), so it's
 * safe to re-run.
 *
 * Usage: npx tsx scripts/defer-unready-sentence-reviews.ts -- [--apply]
 */
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';
import { isSentenceReadyForFullReview, isVocabularyItemProficient } from '../src/lib/scheduling';
import type { FsrsState } from '../src/domain/types';

// Mirrors ReviewPage.tsx's SENTENCE_ACTIVITY_TYPES — duplicated here since
// that's a React page module, not importable from a Node script.
const SENTENCE_ACTIVITY_TYPES = ['comprehension', 'reading_in_context'];
const MIN_DEFER_DAYS = 7;

interface StudyItemRow {
  id: string;
  subjectType: string;
  subjectId: string;
  activityType: string;
  fsrsState: FsrsState;
}

interface SentenceVocabularyRow {
  sentenceId: string;
  vocabularyItemId: string;
  surfaceForm: string | null;
}

interface AnalysisRow {
  sentenceId: string;
  vocabularyReviewStatus: 'unreviewed' | 'confirmed' | undefined;
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));
  const now = new Date();
  const nowIsoValue = now.toISOString();
  const minDueIso = new Date(now.getTime() + MIN_DEFER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching study_items...');
  const studyItems = await fetchAll<StudyItemRow>(
    supabase,
    'study_items',
    'id, subject_type, subject_id, activity_type, fsrs_state',
    user.id,
    (row) => ({
      id: String(row.id),
      subjectType: String(row.subject_type),
      subjectId: String(row.subject_id),
      activityType: String(row.activity_type),
      fsrsState: row.fsrs_state as FsrsState,
    }),
  );

  const dueSentenceItems = studyItems.filter(
    (item) =>
      item.subjectType === 'sentence' &&
      SENTENCE_ACTIVITY_TYPES.includes(item.activityType) &&
      item.fsrsState.due <= nowIsoValue,
  );
  console.log(
    `Found ${dueSentenceItems.length} due full-sentence review item(s) (of ${studyItems.length} study_items total).`,
  );
  if (dueSentenceItems.length === 0) return;

  const sentenceIds = [...new Set(dueSentenceItems.map((item) => item.subjectId))];

  console.log(`Fetching sentence_vocabulary for ${sentenceIds.length} sentence(s)...`);
  const allLinks = await fetchAll<SentenceVocabularyRow>(
    supabase,
    'sentence_vocabulary',
    'sentence_id, vocabulary_item_id, surface_form',
    user.id,
    (row) => ({
      sentenceId: String(row.sentence_id),
      vocabularyItemId: String(row.vocabulary_item_id),
      surfaceForm: row.surface_form ? String(row.surface_form) : null,
    }),
  );
  const sentenceIdSet = new Set(sentenceIds);
  const vocabularyItemIdsBySentence = new Map<string, string[]>();
  for (const link of allLinks) {
    if (!link.surfaceForm || !sentenceIdSet.has(link.sentenceId)) continue;
    const existing = vocabularyItemIdsBySentence.get(link.sentenceId);
    if (existing) {
      if (!existing.includes(link.vocabularyItemId)) existing.push(link.vocabularyItemId);
    } else {
      vocabularyItemIdsBySentence.set(link.sentenceId, [link.vocabularyItemId]);
    }
  }

  console.log(`Fetching analyses (vocabulary review status) for ${sentenceIds.length} sentence(s)...`);
  const analysisRows = await fetchAll<AnalysisRow>(
    supabase,
    'analyses',
    'sentence_id, vocabulary_review_status',
    user.id,
    (row) => ({
      sentenceId: String(row.sentence_id),
      vocabularyReviewStatus: row.vocabulary_review_status as AnalysisRow['vocabularyReviewStatus'],
    }),
    'sentence_id', // analyses has no `id` column — sentence_id is its primary key.
  );
  const vocabularyReviewStatusBySentence = new Map(
    analysisRows.map((row) => [row.sentenceId, row.vocabularyReviewStatus]),
  );

  const allVocabularyItemIds = [...new Set([...vocabularyItemIdsBySentence.values()].flat())];
  const proficientVocabularyItemIds = new Set(
    studyItems
      .filter(
        (item) =>
          item.subjectType === 'vocabularyItem' &&
          allVocabularyItemIds.includes(item.subjectId) &&
          isVocabularyItemProficient(item.fsrsState.state),
      )
      .map((item) => item.subjectId),
  );

  const toDefer: StudyItemRow[] = [];
  let neverReviewed = 0;
  for (const item of dueSentenceItems) {
    const vocabularyItemIds = vocabularyItemIdsBySentence.get(item.subjectId) ?? [];
    const vocabularyReviewStatus = vocabularyReviewStatusBySentence.get(item.subjectId);
    if (
      isSentenceReadyForFullReview(vocabularyReviewStatus, vocabularyItemIds, proficientVocabularyItemIds)
    ) {
      continue;
    }
    if (vocabularyReviewStatus !== 'confirmed') neverReviewed += 1;
    if (item.fsrsState.due >= minDueIso) continue;
    toDefer.push(item);
  }

  console.log(
    `${toDefer.length} item(s) ${apply ? 'deferred' : 'would be deferred'} to at least ${minDueIso} ` +
      `(${neverReviewed} of those have never had their vocabulary reviewed at all).`,
  );
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
    return;
  }
  if (toDefer.length === 0) return;

  // Plain per-row .update(), not .upsert() — these rows already exist, and
  // a sparse upsert payload risks NOT NULL failures on the INSERT side of
  // ON CONFLICT DO UPDATE for columns not included here (same reasoning as
  // backfill-vocabulary-surface-forms.ts's identical choice).
  for (const item of toDefer) {
    const { error } = await supabase
      .from('study_items')
      .update({
        fsrs_state: { ...item.fsrsState, due: minDueIso },
        updated_at: nowIsoValue,
      })
      .eq('id', item.id);
    if (error) {
      throw new Error(`Failed to update study_items ${item.id}: ${error.message}`);
    }
  }
  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
