/**
 * Backfills `VocabularySuggestion.english` (in `sentences.vocabulary_
 * suggestions`) from JMDict, for content-word suggestions that don't have
 * one yet. The fugashi tokenizer (scripts/tokenize_sentences.py, via
 * scripts/backfill-vocabulary-suggestions.ts) only ever produces surface/
 * reading/POS — never a meaning, since that's not fugashi's job.
 *
 * This isn't cosmetic: `selectionFromSuggestion()`
 * (src/lib/vocabularySuggestions.ts) already copies `suggestion.english`
 * into the resulting `VocabularySelection.english` the moment a user taps
 * a suggestion in VocabularyPicker — which is exactly what pre-fills the
 * "Meaning (optional)" field, and downstream, `ensureVocabularyItem`'s
 * initial `meaning` on confirm. That whole pipeline already exists; this
 * script is the only missing piece, and needs no UI changes.
 *
 * Complementary to, not a replacement for,
 * scripts/backfill-vocabulary-meanings.ts: that one fixes *already-
 * confirmed* vocabulary_items with a blank meaning (a frozen snapshot,
 * past confirms). This one improves the picker's UX for *future* confirms
 * by pre-filling the gloss before the word is even tapped.
 *
 * Scope: only `selectedByDefault: true` suggestions (content words — see
 * isContentPos in src/lib/vocabularySuggestions.ts). Particles/punctuation/
 * auxiliaries are skipped — JMDict has entries for many of them, but their
 * glosses aren't useful "vocabulary meanings," matching this codebase's
 * own existing definition of "worth studying."
 *
 * Dry-run by default; --apply required to write. Idempotent by the same
 * convention as backfill-vocabulary-meanings.ts: suggestions with no
 * JMDict match are left without `.english` and retried harmlessly next
 * run, not distinguished from "never attempted."
 *
 * Usage: npm run backfill:vocabulary-suggestion-glosses -- [--apply]
 */
import type { VocabularySuggestion } from '../src/domain/types';

import { buildJmdictIndex, ensureJmdictFile, lookupJmdict } from './lib/jmdict';
import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

interface SentenceRow {
  id: string;
  suggestions: VocabularySuggestion[];
}

function needsGloss(suggestion: VocabularySuggestion): boolean {
  return suggestion.selectedByDefault && !suggestion.english?.trim();
}

async function fetchSentencesNeedingGlosses(
  supabase: Awaited<ReturnType<typeof createScriptSupabaseClient>>,
  ownerId: string,
): Promise<SentenceRow[]> {
  const all = await fetchAll(
    supabase,
    'sentences',
    'id, vocabulary_suggestions',
    ownerId,
    (row): SentenceRow => ({
      id: String(row.id),
      suggestions: (row.vocabulary_suggestions as VocabularySuggestion[] | null) ?? [],
    }),
  );
  return all.filter((row) => row.suggestions.some(needsGloss));
}

async function main() {
  const apply = parseApplyFlag(process.argv.slice(2));

  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching sentences with unglossed content-word suggestions, and loading JMDict...');
  const [sentences, index] = await Promise.all([
    fetchSentencesNeedingGlosses(supabase, user.id),
    ensureJmdictFile().then(buildJmdictIndex),
  ]);
  console.log(`Found ${sentences.length} sentence(s) with at least one unglossed content word.`);
  if (!sentences.length) return;

  let sentencesUpdated = 0;
  let suggestionsMatched = 0;
  let suggestionsNotFound = 0;
  for (const sentence of sentences) {
    let changed = false;
    const enriched = sentence.suggestions.map((suggestion) => {
      if (!needsGloss(suggestion)) return suggestion;
      const result = lookupJmdict(
        index,
        suggestion.expression,
        suggestion.reading || undefined,
        suggestion.pos || undefined,
      );
      if (!result) {
        suggestionsNotFound += 1;
        return suggestion;
      }
      suggestionsMatched += 1;
      changed = true;
      console.log(`  ${suggestion.expression} [${suggestion.reading}] — ${result.gloss}`);
      return { ...suggestion, english: result.gloss };
    });
    if (!changed) continue;
    sentencesUpdated += 1;
    if (apply) {
      const { error } = await supabase
        .from('sentences')
        .update({ vocabulary_suggestions: enriched })
        .eq('id', sentence.id);
      if (error) {
        throw new Error(`Failed to update sentence ${sentence.id}: ${error.message}`);
      }
    }
  }

  console.log(
    `\nDone. ${sentencesUpdated} sentence(s) ${apply ? 'updated' : 'would be updated'} ` +
      `(${suggestionsMatched} suggestion(s) matched, ${suggestionsNotFound} had no JMDict match).`,
  );
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
