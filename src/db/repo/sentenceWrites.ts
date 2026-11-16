import type { Sentence, AnalysisChunk, VocabularyReviewStatus, VocabularySelection, GrammarReviewStatus, SentenceAnalysis } from '../../domain/types';
import { getDb } from '../database';
import { nowIso } from '../../lib/normalize';
import { notifySync } from '../syncNotify';
import { ANALYSIS_FORMAT_VERSION } from '../../appConfig';

/**
 * Corrects a sentence's translation and/or kana reading fields
 * (`readingOnly`/`inlineReading`) — e.g. fixing a transcription that's
 * missing the reading for a numeral or other non-kanji token (see
 * AnalyzePage's "Edit reading" panel). Deliberately excludes `japanese`
 * itself: chunk boundaries, vocabulary selection spans, and audio
 * alignment all key off the exact existing string, so changing it needs a
 * re-analysis pass, not a plain field edit.
 */
export async function updateSentenceText(
  sentenceId: string,
  patch: Partial<Pick<Sentence, 'translation' | 'readingOnly' | 'inlineReading'>>,
): Promise<Sentence> {
  const db = getDb();
  const existing = await db.sentences.get(sentenceId);
  if (!existing) throw new Error('Sentence not found');
  const updated: Sentence = {
    ...existing,
    ...patch,
    updatedAt: nowIso(),
  };
  await db.sentences.put(updated);
  notifySync('sentences', updated.id, updated);
  return updated;
}

export async function saveAnalysis(
  sentenceId: string,
  chunks: AnalysisChunk[],
  notes = '',
  vocabulary?: {
    reviewStatus?: VocabularyReviewStatus;
    selections?: VocabularySelection[];
  },
  grammar?: {
    reviewStatus?: GrammarReviewStatus;
  },
): Promise<SentenceAnalysis> {
  const db = getDb();
  const timestamp = nowIso();
  const existing = await db.analyses.get(sentenceId);
  const populated = chunks.some(
    (chunk) => chunk.role.trim() || chunk.literalEnglish.trim(),
  );
  const status =
    chunks.length === 0
      ? 'empty'
      : populated
        ? chunks.every((chunk) => chunk.role.trim() && chunk.literalEnglish.trim())
          ? 'complete'
          : 'in_progress'
        : 'in_progress';
  const analysis: SentenceAnalysis = {
    sentenceId,
    chunks: chunks.map((chunk, index) => ({ ...chunk, order: index })),
    notes,
    status,
    formatVersion: ANALYSIS_FORMAT_VERSION,
    vocabularyReviewStatus:
      vocabulary?.reviewStatus ??
      existing?.vocabularyReviewStatus ??
      'unreviewed',
    vocabularySelections:
      vocabulary?.selections ?? existing?.vocabularySelections ?? [],
    grammarSuggestions: existing?.grammarSuggestions ?? [],
    grammarReviewStatus:
      grammar?.reviewStatus ?? existing?.grammarReviewStatus ?? 'unreviewed',
    comprehensionCheck: existing?.comprehensionCheck,
    particleChecks: existing?.particleChecks,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await db.analyses.put(analysis);
  notifySync('analyses', analysis.sentenceId, analysis);
  return analysis;
}
