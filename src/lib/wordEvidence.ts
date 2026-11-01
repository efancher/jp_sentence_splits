import type { Review, SentenceLearningEvent, StudyItem } from '../domain/types';
import type { WordEvidence } from './wordStrength';

/**
 * Turns existing review and lesson history into `WordEvidence` for the word
 * strength estimate (`wordStrength.ts`). Pure: callers fetch rows.
 *
 * What counts, and as what:
 * - `reading_retrieval` / `reading_production` on a word: reading recall;
 *   success is any rating but `again` (the learner's own explicit rating).
 * - Any sentence-level review (`reading_in_context`, `listening`, `ear_tiles`,
 *   `dictation_tile:N`, …) or a completed walkthrough: exposure to each word
 *   linked to that sentence. Exposure only credits the reading facet.
 * - `cloze` is retired and ignored. Sentence-level comprehension checks are
 *   not attributable to one word, so they add no recognition evidence.
 *
 * There is no meaning-recall evidence yet: meaning stays at zero until a
 * surface asks for typed meaning recall, so callers should not read a low
 * meaning strength as a finding.
 */
export interface WordEvidenceInput {
  reviews: readonly Pick<Review, 'studyItemId' | 'timestamp' | 'rating' | 'contextSentenceId'>[];
  studyItems: readonly Pick<StudyItem, 'id' | 'subjectType' | 'subjectId' | 'activityType'>[];
  /** Sentence id → ids of the vocabulary items linked to it. */
  wordsBySentence: ReadonlyMap<string, readonly string[]>;
  learningEvents?: readonly Pick<SentenceLearningEvent, 'sentenceId' | 'timestamp' | 'action'>[];
}

const WORD_RECALL_ACTIVITIES = new Set(['reading_retrieval', 'reading_production']);
const IGNORED_ACTIVITIES = new Set(['cloze']);

export function buildWordEvidence(input: WordEvidenceInput): Map<string, WordEvidence[]> {
  const items = new Map(input.studyItems.map((item) => [item.id, item]));
  const out = new Map<string, WordEvidence[]>();
  const add = (evidence: WordEvidence) => {
    const list = out.get(evidence.wordId);
    if (list) list.push(evidence);
    else out.set(evidence.wordId, [evidence]);
  };
  const exposeSentence = (sentenceId: string, at: number) => {
    for (const wordId of input.wordsBySentence.get(sentenceId) ?? []) {
      add({ wordId, facet: 'reading', kind: 'exposure', at, sentenceId });
    }
  };

  for (const review of input.reviews) {
    const item = items.get(review.studyItemId);
    if (!item || IGNORED_ACTIVITIES.has(item.activityType)) continue;
    const at = Date.parse(review.timestamp);
    if (Number.isNaN(at)) continue;
    if (item.subjectType === 'vocabularyItem') {
      if (WORD_RECALL_ACTIVITIES.has(item.activityType)) {
        add({ wordId: item.subjectId, facet: 'reading', kind: 'recall', at, success: review.rating !== 'again' });
      }
      if (review.contextSentenceId) exposeSentence(review.contextSentenceId, at);
    } else if (item.subjectType === 'sentence') {
      exposeSentence(review.contextSentenceId ?? item.subjectId, at);
    }
  }

  for (const event of input.learningEvents ?? []) {
    if (event.action !== 'walkthrough_completed') continue;
    const at = Date.parse(event.timestamp);
    if (!Number.isNaN(at)) exposeSentence(event.sentenceId, at);
  }
  return out;
}
