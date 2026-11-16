import type {
  GrammarPattern,
  Review,
  Sentence,
  StudyItem,
  VocabularyConfusion,
  VocabularyItem,
} from '../../domain/types';
import {
  computeMaturityLevel,
  MATURE_MIN_SCHEDULED_DAYS,
  type ContextDiversity,
  type MaturityLevel,
} from '../../lib/maturity';
import { getDb } from '../database';
import { computeGrammarPatternContextDiversity, computeVocabularyContextDiversity } from './contextDiversity';

// ---------------------------------------------------------------------------
// Study-item explainability/debug view (Phase 7.10). Read-only: gathers
// everything a "why am I seeing this card, and why is it scheduled the way
// it is" view needs — the study item's raw FSRS state, its full Review
// history (finally surfacing source/assistance/responseRaw/expectedAnswer,
// recorded since Phases 7.1/7.8/7.9 but never shown anywhere), each
// review's context sentence if it has one, and — for a vocabulary-item
// subject — its computed maturity ladder position (Phase 7.1/7.5).
// ---------------------------------------------------------------------------

export type StudyItemDebugSubject =
  | { kind: 'sentence'; sentence: Sentence }
  | {
      kind: 'vocabularyItem';
      vocabularyItem: VocabularyItem;
      maturity: { diversity: ContextDiversity; level: MaturityLevel };
    }
  | {
      kind: 'vocabularyConfusion';
      confusion: VocabularyConfusion;
      itemA: VocabularyItem;
      itemB: VocabularyItem;
    }
  | {
      kind: 'grammarPattern';
      grammarPattern: GrammarPattern;
      maturity: { diversity: ContextDiversity; level: MaturityLevel };
    }
  | {
      kind: 'sentenceVocabulary';
      vocabularyItem: VocabularyItem;
      sentence: Sentence;
      surfaceForm: string | undefined;
    }
  | { kind: 'unknown' };

export interface StudyItemDebugInfo {
  studyItem: StudyItem;
  subject: StudyItemDebugSubject;
  /** Most-recent-first. */
  reviews: Review[];
  contextSentencesById: Map<string, Sentence>;
}

export async function getStudyItemDebugInfo(
  studyItemId: string,
): Promise<StudyItemDebugInfo | undefined> {
  const db = getDb();
  const studyItem = await db.studyItems.get(studyItemId);
  if (!studyItem) return undefined;

  const reviews = (
    await db.reviews.where('studyItemId').equals(studyItemId).toArray()
  ).sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const contextSentenceIds = [
    ...new Set(
      reviews
        .map((review) => review.contextSentenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const contextSentences = await db.sentences.bulkGet(contextSentenceIds);
  const contextSentencesById = new Map<string, Sentence>();
  contextSentences.forEach((sentence, index) => {
    if (sentence) contextSentencesById.set(contextSentenceIds[index]!, sentence);
  });

  let subject: StudyItemDebugSubject = { kind: 'unknown' };
  if (studyItem.subjectType === 'sentence') {
    const sentence = await db.sentences.get(studyItem.subjectId);
    if (sentence) subject = { kind: 'sentence', sentence };
  } else if (studyItem.subjectType === 'vocabularyItem') {
    const vocabularyItem = await db.vocabularyItems.get(studyItem.subjectId);
    if (vocabularyItem) {
      const diversity = await computeVocabularyContextDiversity(vocabularyItem.id);
      const level = computeMaturityLevel(diversity, {
        hasLongIntervalSuccess:
          studyItem.fsrsState.state === 'review' &&
          studyItem.fsrsState.scheduledDays >= MATURE_MIN_SCHEDULED_DAYS,
      });
      subject = { kind: 'vocabularyItem', vocabularyItem, maturity: { diversity, level } };
    }
  } else if (studyItem.subjectType === 'vocabularyConfusion') {
    const confusion = await db.vocabularyConfusions.get(studyItem.subjectId);
    if (confusion) {
      const [itemA, itemB] = await Promise.all([
        db.vocabularyItems.get(confusion.itemAId),
        db.vocabularyItems.get(confusion.itemBId),
      ]);
      if (itemA && itemB) subject = { kind: 'vocabularyConfusion', confusion, itemA, itemB };
    }
  } else if (studyItem.subjectType === 'grammarPattern') {
    const grammarPattern = await db.grammarPatterns.get(studyItem.subjectId);
    if (grammarPattern) {
      const diversity = await computeGrammarPatternContextDiversity(grammarPattern.id);
      const level = computeMaturityLevel(diversity, {
        hasLongIntervalSuccess:
          studyItem.fsrsState.state === 'review' &&
          studyItem.fsrsState.scheduledDays >= MATURE_MIN_SCHEDULED_DAYS,
      });
      subject = { kind: 'grammarPattern', grammarPattern, maturity: { diversity, level } };
    }
  } else if (studyItem.subjectType === 'sentenceVocabulary') {
    const link = await db.sentenceVocabulary.get(studyItem.subjectId);
    if (link) {
      const [vocabularyItem, sentence] = await Promise.all([
        db.vocabularyItems.get(link.vocabularyItemId),
        db.sentences.get(link.sentenceId),
      ]);
      if (vocabularyItem && sentence) {
        subject = {
          kind: 'sentenceVocabulary',
          vocabularyItem,
          sentence,
          surfaceForm: link.surfaceForm,
        };
      }
    }
  }

  return { studyItem, subject, reviews, contextSentencesById };
}

/**
 * A short human label for a study item's subject, for the top-level
 * `/study-items` browsable list (Phase 7.10a follow-up). Deliberately a
 * separate, batched implementation rather than calling
 * `getStudyItemDebugInfo` once per row — that function's per-item
 * `db.get()` calls would be an N+1 query pattern at list scale.
 */
export interface StudyItemSummary {
  studyItem: StudyItem;
  subjectLabel: string;
}

export async function listStudyItemSummaries(): Promise<StudyItemSummary[]> {
  const db = getDb();
  const studyItems = await db.studyItems.toArray();

  const sentenceIds = studyItems
    .filter((item) => item.subjectType === 'sentence')
    .map((item) => item.subjectId);
  const vocabularyItemIds = studyItems
    .filter((item) => item.subjectType === 'vocabularyItem')
    .map((item) => item.subjectId);
  const confusionIds = studyItems
    .filter((item) => item.subjectType === 'vocabularyConfusion')
    .map((item) => item.subjectId);
  const grammarPatternIds = studyItems
    .filter((item) => item.subjectType === 'grammarPattern')
    .map((item) => item.subjectId);

  const [sentences, vocabularyItems, confusions, grammarPatterns] = await Promise.all([
    db.sentences.bulkGet(sentenceIds),
    db.vocabularyItems.bulkGet(vocabularyItemIds),
    db.vocabularyConfusions.bulkGet(confusionIds),
    db.grammarPatterns.bulkGet(grammarPatternIds),
  ]);
  const sentenceById = new Map(
    sentences.filter((row): row is Sentence => Boolean(row)).map((row) => [row.id, row]),
  );
  const vocabularyItemById = new Map(
    vocabularyItems
      .filter((row): row is VocabularyItem => Boolean(row))
      .map((row) => [row.id, row]),
  );
  const confusionById = new Map(
    confusions
      .filter((row): row is VocabularyConfusion => Boolean(row))
      .map((row) => [row.id, row]),
  );
  const grammarPatternById = new Map(
    grammarPatterns
      .filter((row): row is GrammarPattern => Boolean(row))
      .map((row) => [row.id, row]),
  );

  return studyItems.map((studyItem) => {
    let subjectLabel = studyItem.subjectId;
    if (studyItem.subjectType === 'sentence') {
      const sentence = sentenceById.get(studyItem.subjectId);
      if (sentence) subjectLabel = sentence.japanese;
    } else if (studyItem.subjectType === 'vocabularyItem') {
      const vocabularyItem = vocabularyItemById.get(studyItem.subjectId);
      if (vocabularyItem) {
        subjectLabel = `${vocabularyItem.expression} (${vocabularyItem.reading})`;
      }
    } else if (studyItem.subjectType === 'vocabularyConfusion') {
      const confusion = confusionById.get(studyItem.subjectId);
      if (confusion) {
        const itemA = vocabularyItemById.get(confusion.itemAId);
        const itemB = vocabularyItemById.get(confusion.itemBId);
        subjectLabel = `${itemA?.expression ?? confusion.itemAId} vs ${itemB?.expression ?? confusion.itemBId}`;
      }
    } else if (studyItem.subjectType === 'grammarPattern') {
      const grammarPattern = grammarPatternById.get(studyItem.subjectId);
      if (grammarPattern) subjectLabel = grammarPattern.canonicalName;
    }
    return { studyItem, subjectLabel };
  });
}
