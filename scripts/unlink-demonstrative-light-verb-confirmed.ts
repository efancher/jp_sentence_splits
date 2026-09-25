/**
 * Un-confirms する/なる where it was confirmed as vocabulary directly off a
 * manner demonstrative (こう/そう/ああ/どう+する/なる, e.g. つぎはこうしよう)
 * — the light-verb construction `isDemonstrativeLightVerb`
 * (src/lib/vocabularySuggestions.ts) now excludes from default-checked, but
 * `refreshVocabularySuggestionDefaults` deliberately never reaches once a
 * real selection already exists (see docs/STATUS.md, 2026-09-24). This is
 * the follow-up for the handful of sentences where it *was* already
 * confirmed before that fix — found via
 * scripts/diagnose-demonstrative-light-verb-confirmed.ts (superseded by
 * this script's own dry-run output).
 *
 * Scans dynamically (same detection as the diagnostic) rather than a
 * hardcoded id list — small, well-understood population, and safe to
 * re-run if more sentences reach this state later.
 *
 * Per sentence: drops the flagged selection from `analyses.vocabulary_selections`,
 * soft-deletes any `sentence_vocabulary` link no longer needed by the
 * remaining selections (mirrors `materializeVocabularySelections`'s own
 * stale-link diff), soft-deletes any `sentenceVocabulary`-subject study_item
 * on a deleted link (the leak `materializeVocabularySelections` was just
 * fixed for — see its 2026-09-24 repository.ts change), and re-derives
 * `selectedByDefault` on the sentence's `vocabulary_suggestions`
 * (`recomputeSuggestionDefaults`) so the picker shows the right default if
 * the word is ever re-added. The underlying `vocabulary_items` row for
 * する/なる itself is never touched — shared across the whole corpus, still
 * confirmed on every other sentence.
 *
 * Dry-run by default; --apply required to write. Idempotent: nothing left
 * for a second run once the first `--apply` run completes.
 *
 * Usage: npx tsx scripts/unlink-demonstrative-light-verb-confirmed.ts [--apply]
 */
import { recomputeSuggestionDefaults } from '../src/lib/vocabularySuggestions';
import type { VocabularySelection, VocabularySuggestion } from '../src/domain/types';

import { fetchAll, parseApplyFlag, requireAuthedUser } from './lib/scriptHelpers';
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

interface LinkRow {
  id: string;
  sentenceId: string;
  vocabularyItemId: string;
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
  const apply = parseApplyFlag(process.argv.slice(2));
  const supabase = await createScriptSupabaseClient();
  const user = await requireAuthedUser(supabase);

  console.log('Fetching sentences, analyses, vocabulary items, links, and study items...');
  const [sentences, analyses, vocabItems, links, studyItems] = await Promise.all([
    fetchAll<SentenceRow>(
      supabase,
      'sentences',
      'id, japanese, vocabulary_suggestions',
      user.id,
      (row) => ({
        id: String(row.id),
        japanese: String(row.japanese ?? ''),
        vocabularySuggestions:
          (row.vocabulary_suggestions as VocabularySuggestion[] | null) ?? [],
      }),
    ),
    fetchAll<AnalysisRow>(
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
    ),
    fetchAll<{ id: string; expression: string; reading: string }>(
      supabase,
      'vocabulary_items',
      'id, expression, reading',
      user.id,
      (row) => ({ id: String(row.id), expression: String(row.expression), reading: String(row.reading) }),
    ),
    fetchAll<LinkRow>(
      supabase,
      'sentence_vocabulary',
      'id, sentence_id, vocabulary_item_id',
      user.id,
      (row) => ({
        id: String(row.id),
        sentenceId: String(row.sentence_id),
        vocabularyItemId: String(row.vocabulary_item_id),
      }),
    ),
    fetchAll<{ id: string; subjectType: string; subjectId: string }>(
      supabase,
      'study_items',
      'id, subject_type, subject_id',
      user.id,
      (row) => ({ id: String(row.id), subjectType: String(row.subject_type), subjectId: String(row.subject_id) }),
    ),
  ]);

  const analysisBySentenceId = new Map(analyses.map((a) => [a.sentenceId, a]));
  const itemIdByKey = new Map(vocabItems.map((v) => [`${v.expression}|${v.reading}`, v.id]));
  const linksBySentenceId = new Map<string, LinkRow[]>();
  for (const link of links) {
    const arr = linksBySentenceId.get(link.sentenceId) ?? [];
    arr.push(link);
    linksBySentenceId.set(link.sentenceId, arr);
  }
  const studyItemsByLinkId = new Map<string, string[]>();
  for (const item of studyItems) {
    if (item.subjectType !== 'sentenceVocabulary') continue;
    const arr = studyItemsByLinkId.get(item.subjectId) ?? [];
    arr.push(item.id);
    studyItemsByLinkId.set(item.subjectId, arr);
  }

  type Plan = {
    sentenceId: string;
    japanese: string;
    removedExpressions: string[];
    newSelections: VocabularySelection[];
    staleLinkIds: string[];
    orphanedStudyItemIds: string[];
    newSuggestions: VocabularySuggestion[];
    suggestionsChanged: boolean;
  };
  const plans: Plan[] = [];

  for (const sentence of sentences) {
    const flagged = flaggedSuggestionIds(sentence.vocabularySuggestions);
    if (flagged.size === 0) continue;
    const analysis = analysisBySentenceId.get(sentence.id);
    if (!analysis || analysis.vocabularySelections.length === 0) continue;

    const toRemove = analysis.vocabularySelections.filter((sel) =>
      sel.suggestionIds?.some((id) => flagged.has(id)),
    );
    if (toRemove.length === 0) continue;

    const newSelections = analysis.vocabularySelections.filter((sel) => !toRemove.includes(sel));
    const stillNeededItemIds = new Set(
      newSelections
        .map((sel) => itemIdByKey.get(`${sel.expression.trim()}|${sel.reading.trim()}`))
        .filter((id): id is string => Boolean(id)),
    );
    const existingLinks = linksBySentenceId.get(sentence.id) ?? [];
    const staleLinks = existingLinks.filter((link) => !stillNeededItemIds.has(link.vocabularyItemId));
    const orphanedStudyItemIds = staleLinks.flatMap((link) => studyItemsByLinkId.get(link.id) ?? []);

    const newSuggestions = recomputeSuggestionDefaults(sentence.vocabularySuggestions);
    const suggestionsChanged = newSuggestions.some(
      (s, i) => s.selectedByDefault !== sentence.vocabularySuggestions[i]!.selectedByDefault,
    );

    plans.push({
      sentenceId: sentence.id,
      japanese: sentence.japanese,
      removedExpressions: toRemove.map((s) => s.expression),
      newSelections,
      staleLinkIds: staleLinks.map((l) => l.id),
      orphanedStudyItemIds,
      newSuggestions,
      suggestionsChanged,
    });
  }

  if (plans.length === 0) {
    console.log('Nothing to do — no confirmed selections match the pattern.');
    return;
  }

  console.log(`\n${plans.length} sentence(s):\n`);
  for (const plan of plans) {
    console.log(`  ${plan.japanese}`);
    console.log(`    remove selection(s): ${plan.removedExpressions.join(', ')}`);
    console.log(`    stale sentence_vocabulary link(s): ${plan.staleLinkIds.length}`);
    console.log(`    orphaned study_item(s) to retire: ${plan.orphanedStudyItemIds.length}`);
    console.log(`    suggestion defaults refreshed: ${plan.suggestionsChanged ? 'yes' : 'no'}`);
  }

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  const nowIso = new Date().toISOString();
  for (const plan of plans) {
    const { error: analysisError } = await supabase
      .from('analyses')
      .update({ vocabulary_selections: plan.newSelections })
      .eq('sentence_id', plan.sentenceId)
      .eq('owner_id', user.id);
    if (analysisError) throw new Error(`analyses ${plan.sentenceId}: ${analysisError.message}`);

    for (const linkId of plan.staleLinkIds) {
      const { error: linkError } = await supabase
        .from('sentence_vocabulary')
        .update({ deleted_at: nowIso })
        .eq('id', linkId)
        .eq('owner_id', user.id);
      if (linkError) throw new Error(`sentence_vocabulary ${linkId}: ${linkError.message}`);
    }

    for (const studyItemId of plan.orphanedStudyItemIds) {
      const { error: studyError } = await supabase
        .from('study_items')
        .update({ deleted_at: nowIso })
        .eq('id', studyItemId)
        .eq('owner_id', user.id);
      if (studyError) throw new Error(`study_items ${studyItemId}: ${studyError.message}`);
    }

    if (plan.suggestionsChanged) {
      const { error: sentenceError } = await supabase
        .from('sentences')
        .update({ vocabulary_suggestions: plan.newSuggestions })
        .eq('id', plan.sentenceId)
        .eq('owner_id', user.id);
      if (sentenceError) throw new Error(`sentences ${plan.sentenceId}: ${sentenceError.message}`);
    }
  }

  console.log(`\nDone. Updated ${plans.length} sentence(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
