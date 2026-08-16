/**
 * Fills in `.english` on `analyses.vocabulary_selections` entries that are
 * still untouched, plain suggestion-derived selections with no meaning of
 * their own yet — picking up enrichment (e.g. JMDict glosses from
 * scripts/backfill-vocabulary-suggestion-glosses.ts) that landed on the
 * sentence's `vocabulary_suggestions` *after* these selections were first
 * saved.
 *
 * Root cause this exists for: `analyses.vocabulary_selections` is a frozen
 * snapshot. AnalyzePage.tsx's hydration effect trusts that snapshot
 * whenever it's non-empty, not only when `vocabulary_review_status` is
 * actually `'confirmed'` — because simply *opening* the Analyze page
 * hydrates default selections into local state, and useAutosave persists
 * that as a side effect of viewing the page, not of confirming. So a
 * sentence someone merely glanced at before a later gloss-enrichment run
 * keeps showing the pre-enrichment (gloss-less) selections forever.
 * Deliberately not fixing that hydration condition itself (risks
 * discarding a real in-progress work-in-progress customization made
 * before confirming) — this script only ever fills in a blank `.english`
 * on a selection it can *prove* is still an untouched, unedited default.
 *
 * Per selection, ALL of the following must hold before it's touched —
 * otherwise it's left exactly as-is, matching every other backfill
 * script's own "only fill in blanks, never overwrite" convention:
 *   1. `source === 'suggestion'` with exactly one `suggestionIds` entry
 *      (defaultSelectionsFromSuggestions's own output shape —
 *      'combined'/'manual' selections only ever come from deliberate user
 *      interaction).
 *   2. The selection's expression/reading/surface/pos/start/end all still
 *      exactly match its underlying suggestion's *current* values — if any
 *      of those differ, the user edited this selection by hand (even
 *      without confirming) and it's left untouched.
 *   3. `selection.english` is empty — an existing manual meaning, however
 *      it got there, is never overwritten.
 *   4. The underlying suggestion actually has a non-empty `.english` to
 *      offer.
 *
 * Dry-run by default; --apply required to write. Idempotent: once a
 * selection has `.english` filled in, rule 3 excludes it from any future
 * run — safe to re-run after any future suggestion-enrichment pass.
 *
 * Usage: npm run backfill:refresh-unreviewed-selections -- [--apply]
 */
import { vocabularySelectionSchema } from '../src/domain/schemas';
import type { VocabularySelection, VocabularySuggestion } from '../src/domain/types';

import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

interface UnreviewedAnalysis {
  sentenceId: string;
  suggestions: VocabularySuggestion[];
  selections: VocabularySelection[];
}

async function fetchUnreviewedWithSelections(
  supabase: Awaited<ReturnType<typeof createScriptSupabaseClient>>,
  ownerId: string,
): Promise<UnreviewedAnalysis[]> {
  const analyses = await fetchAll(
    supabase,
    'analyses',
    'sentence_id, vocabulary_review_status, vocabulary_selections',
    ownerId,
    (row) => ({
      sentenceId: String(row.sentence_id),
      status: String(row.vocabulary_review_status ?? 'unreviewed'),
      selections: (row.vocabulary_selections as VocabularySelection[] | null) ?? [],
    }),
    'sentence_id', // analyses has no `id` column — primary key is sentence_id.
  );
  const candidates = analyses.filter(
    (row) => row.status === 'unreviewed' && row.selections.length > 0,
  );
  if (!candidates.length) return [];

  const sentences = await fetchAll(
    supabase,
    'sentences',
    'id, vocabulary_suggestions',
    ownerId,
    (row) => ({
      id: String(row.id),
      suggestions: (row.vocabulary_suggestions as VocabularySuggestion[] | null) ?? [],
    }),
  );
  const sentenceById = new Map(sentences.map((s) => [s.id, s]));

  const out: UnreviewedAnalysis[] = [];
  for (const candidate of candidates) {
    const sentence = sentenceById.get(candidate.sentenceId);
    if (!sentence) continue;
    out.push({
      sentenceId: candidate.sentenceId,
      suggestions: sentence.suggestions,
      selections: candidate.selections,
    });
  }
  return out;
}

/** Only true when `selection` is still exactly what its suggestion would produce, unedited. */
function matchesUnderlyingSuggestion(
  selection: VocabularySelection,
  suggestion: VocabularySuggestion,
): boolean {
  return (
    selection.expression === suggestion.expression &&
    selection.reading === suggestion.reading &&
    selection.surface === suggestion.surface &&
    (selection.pos ?? '') === (suggestion.pos ?? '') &&
    selection.start === suggestion.start &&
    selection.end === suggestion.end
  );
}

function fillBlankGlosses(
  selections: VocabularySelection[],
  suggestions: VocabularySuggestion[],
): { next: VocabularySelection[]; filled: number; skippedEdited: number } {
  const suggestionById = new Map(suggestions.map((s) => [s.id, s]));
  let filled = 0;
  let skippedEdited = 0;

  const next = selections.map((selection) => {
    if (selection.source !== 'suggestion' || selection.suggestionIds?.length !== 1) {
      return selection;
    }
    const suggestion = suggestionById.get(selection.suggestionIds[0]!);
    if (!suggestion) return selection;

    if (!matchesUnderlyingSuggestion(selection, suggestion)) {
      skippedEdited += 1;
      return selection;
    }
    if (selection.english?.trim()) return selection;
    if (!suggestion.english?.trim()) return selection;

    filled += 1;
    return { ...selection, english: suggestion.english };
  });

  return { next, filled, skippedEdited };
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching unreviewed analyses with saved selections...');
  const candidates = await fetchUnreviewedWithSelections(supabase, user.id);
  console.log(`Found ${candidates.length} unreviewed sentence(s) with saved selections.`);
  if (!candidates.length) return;

  let sentencesUpdated = 0;
  let glossesFilled = 0;
  let selectionsSkippedEdited = 0;
  for (const candidate of candidates) {
    const { next, filled, skippedEdited } = fillBlankGlosses(
      candidate.selections,
      candidate.suggestions,
    );
    selectionsSkippedEdited += skippedEdited;
    if (!filled) continue;

    for (const selection of next) vocabularySelectionSchema.parse(selection);

    sentencesUpdated += 1;
    glossesFilled += filled;
    console.log(`  ${candidate.sentenceId}: ${filled} gloss(es) filled in`);
    if (apply) {
      const { error } = await supabase
        .from('analyses')
        .update({ vocabulary_selections: next })
        .eq('sentence_id', candidate.sentenceId);
      if (error) {
        throw new Error(`Failed to update analysis for ${candidate.sentenceId}: ${error.message}`);
      }
    }
  }

  console.log(
    `\nDone. ${sentencesUpdated} sentence(s) ${apply ? 'updated' : 'would be updated'} ` +
      `(${glossesFilled} gloss(es) filled in), ${selectionsSkippedEdited} selection(s) left ` +
      `untouched (edited away from their suggestion, not a plain default).`,
  );
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
