/**
 * One-off, read-only diagnostic: how many already-CONFIRMED (or otherwise
 * saved) vocabulary selections are する/なる directly glued onto a manner
 * demonstrative (こう/そう/ああ/どう) — the light-verb construction
 * `isDemonstrativeLightVerb` (src/lib/vocabularySuggestions.ts) now excludes
 * from default-checked, but which refreshVocabularySuggestionDefaults
 * deliberately never touches once a real selection exists. Scoping question
 * for a possible follow-up cleanup — writes nothing.
 *
 * Usage: TOKENIZE_PYTHON_BIN=... npx tsx scripts/diagnose-demonstrative-light-verb-confirmed.ts
 * (no Python needed — reads stored data only)
 */
import type { VocabularySelection, VocabularySuggestion } from '../src/domain/types';

import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const MANNER_DEMONSTRATIVES = new Set(['こう', 'そう', 'ああ', 'どう']);

interface SentenceRow {
  id: string;
  japanese: string;
  vocabularySuggestions: VocabularySuggestion[];
}

interface AnalysisRow {
  sentenceId: string;
  vocabularyReviewStatus: string;
  vocabularySelections: VocabularySelection[];
}

function flaggedSuggestionIds(suggestions: VocabularySuggestion[]): Set<string> {
  const ids = new Set<string>();
  for (let i = 1; i < suggestions.length; i += 1) {
    const token = suggestions[i]!;
    const prev = suggestions[i - 1]!;
    if (!token.pos?.startsWith('動詞')) continue;
    if (token.expression !== 'する' && token.expression !== 'なる') continue;
    if (!prev.pos?.startsWith('副詞')) continue;
    if (!MANNER_DEMONSTRATIVES.has(prev.expression)) continue;
    if (prev.end !== token.start) continue;
    ids.add(token.id);
  }
  return ids;
}

async function main() {
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  const sentences = await fetchAll<SentenceRow>(
    supabase,
    'sentences',
    'id, japanese, vocabulary_suggestions',
    user.id,
    (row) => ({
      id: String(row.id),
      japanese: String(row.japanese ?? ''),
      vocabularySuggestions: (row.vocabulary_suggestions as VocabularySuggestion[] | null) ?? [],
    }),
  );
  const analyses = await fetchAll<AnalysisRow>(
    supabase,
    'analyses',
    'sentence_id, vocabulary_review_status, vocabulary_selections',
    user.id,
    (row) => ({
      sentenceId: String(row.sentence_id),
      vocabularyReviewStatus: String(row.vocabulary_review_status ?? 'unreviewed'),
      vocabularySelections: (row.vocabulary_selections as VocabularySelection[] | null) ?? [],
    }),
    'sentence_id',
  );
  const analysisBySentenceId = new Map(analyses.map((a) => [a.sentenceId, a]));

  let sentencesWithFlagged = 0;
  let totalFlagged = 0;
  let confirmedSentences = 0;
  let confirmedSelections = 0;
  const confirmedExamples: string[] = [];

  for (const sentence of sentences) {
    const flagged = flaggedSuggestionIds(sentence.vocabularySuggestions);
    if (flagged.size === 0) continue;
    sentencesWithFlagged += 1;
    totalFlagged += flagged.size;

    const analysis = analysisBySentenceId.get(sentence.id);
    const selections = analysis?.vocabularySelections ?? [];
    const confirmedHere = selections.filter(
      (sel) => sel.suggestionIds?.some((id) => flagged.has(id)),
    );
    if (confirmedHere.length > 0) {
      confirmedSentences += 1;
      confirmedSelections += confirmedHere.length;
      if (confirmedExamples.length < 15) {
        confirmedExamples.push(
          `  ${sentence.japanese} — ${confirmedHere.map((s) => s.expression).join(', ')} (status: ${analysis?.vocabularyReviewStatus ?? 'none'})`,
        );
      }
    }
  }

  console.log(`Sentences scanned: ${sentences.length}`);
  console.log(`Sentences containing a こう/そう/ああ/どう+する/なる suggestion: ${sentencesWithFlagged}`);
  console.log(`Total such suggestions: ${totalFlagged}`);
  console.log(`Sentences where it's already a saved/confirmed selection: ${confirmedSentences}`);
  console.log(`Total such confirmed selections: ${confirmedSelections}`);
  if (confirmedExamples.length) {
    console.log('\nExamples:');
    console.log(confirmedExamples.join('\n'));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
