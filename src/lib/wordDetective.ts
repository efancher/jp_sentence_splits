import type { Sentence, SentenceAudio, SentenceVocabulary, VocabularyItem } from '../domain/types';
import { isReadingAnswerCorrect, surfaceReadingFromInline } from './readingAnswer';
import { splitOnSurfaceForm } from './surfaceForm';

/**
 * Word Detective (docs/ROADMAP.md "Short games"): a mystery word from the
 * learner's own books. It's shown blanked out in a real sentence; they type
 * its reading, spending clues one at a time, and fewer clues score higher.
 * Typed recall on purpose — multiple choice is gameable when a translation is
 * on screen (the `grammar_completion` lesson).
 *
 * Pure: `buildWordDetectiveWord` takes rows already fetched from Dexie, so
 * the eligibility rules and scoring are unit-testable without a database.
 */
export interface WordDetectiveOccurrence {
  sentenceId: string;
  japanese: string;
  translation: string;
  inlineReading: string;
  /** The exact inflected text of the word in this sentence — the blanked span. */
  surfaceForm: string;
  audio?: SentenceAudio;
}

export interface WordDetectiveWord {
  vocabularyItemId: string;
  expression: string;
  reading: string;
  meaning: string;
  /** Always length >= 2; `[0]` is the primary (opening) sentence. */
  occurrences: WordDetectiveOccurrence[];
}

export type ClueKind = 'translation' | 'second_sentence' | 'meaning' | 'first_kana' | 'audio';

export const CLUE_LABELS: Record<ClueKind, string> = {
  translation: 'Translation',
  second_sentence: 'Another sentence',
  meaning: 'Meaning',
  first_kana: 'First kana',
  audio: 'Hear it',
};

/** Words per round — about 90 seconds. */
export const WORD_DETECTIVE_ROUND_SIZE = 3;

/** Points for a clean, clue-free solve. Every clue and wrong guess costs one; a solve is never worth less than 1. */
export const MAX_WORD_POINTS = 5;

/**
 * Build a playable word from its confirmed occurrences, or null when it isn't
 * eligible: needs a reading, and at least two *distinct* sentences where the
 * recorded surface form is really found in the text — the second sentence is
 * the game's whole differentiator from the `cloze` card — with a translation
 * on the opening one. Sentences with audio sort first so the "Hear it" clue is
 * available whenever any occurrence has a recording.
 */
export function buildWordDetectiveWord(input: {
  item: VocabularyItem;
  links: readonly SentenceVocabulary[];
  sentenceById: ReadonlyMap<string, Sentence>;
  audioBySentenceId: ReadonlyMap<string, SentenceAudio>;
}): WordDetectiveWord | null {
  const { item, links, sentenceById, audioBySentenceId } = input;
  if (!item.reading?.trim() || !item.expression?.trim()) return null;

  const seen = new Set<string>();
  const occurrences: WordDetectiveOccurrence[] = [];
  for (const link of links) {
    if (!link.surfaceForm || seen.has(link.sentenceId)) continue;
    const sentence = sentenceById.get(link.sentenceId);
    if (!sentence || !sentence.japanese.includes(link.surfaceForm)) continue;
    seen.add(link.sentenceId);
    occurrences.push({
      sentenceId: sentence.id,
      japanese: sentence.japanese,
      translation: sentence.translation?.trim() ?? '',
      inlineReading: sentence.inlineReading ?? '',
      surfaceForm: link.surfaceForm,
      audio: audioBySentenceId.get(sentence.id),
    });
  }
  if (occurrences.length < 2) return null;

  // Opening sentence: has a translation (the first clue), preferring audio.
  occurrences.sort(
    (a, b) =>
      Number(!!b.translation) - Number(!!a.translation) ||
      Number(!!b.audio) - Number(!!a.audio) ||
      a.sentenceId.localeCompare(b.sentenceId),
  );
  if (!occurrences[0]!.translation) return null;

  return {
    vocabularyItemId: item.id,
    expression: item.expression,
    reading: item.reading,
    meaning: item.meaning?.trim() ?? '',
    occurrences,
  };
}

/**
 * The clues this word can actually offer, in the order they're revealed. A
 * clue with nothing behind it (no gloss, no recording) is left out rather than
 * shown empty.
 */
export function buildClueLadder(word: WordDetectiveWord): ClueKind[] {
  const ladder: ClueKind[] = ['translation', 'second_sentence'];
  if (word.meaning) ladder.push('meaning');
  ladder.push('first_kana');
  if (word.occurrences[0]!.audio) ladder.push('audio');
  return ladder;
}

/** The sentence split around its (blanked) target word; null when the word isn't found. */
export function blankedParts(
  occurrence: Pick<WordDetectiveOccurrence, 'japanese' | 'surfaceForm'>,
): { before: string; after: string } | null {
  const [before, target, after] = splitOnSurfaceForm(occurrence.japanese, occurrence.surfaceForm);
  return target ? { before, after } : null;
}

export function firstKana(word: Pick<WordDetectiveWord, 'reading'>): string {
  return Array.from(word.reading.trim())[0] ?? '';
}

/**
 * Whether `typed` names the word. Accepts the dictionary reading *and* the
 * reading as it's inflected in the opening sentence (the same leniency a
 * `reading_production` card gives), plus the written word itself — typing 頑張る
 * is at least as strong evidence of recall as typing がんばる.
 */
export function isWordDetectiveAnswerCorrect(word: WordDetectiveWord, typed: string): boolean {
  const primary = word.occurrences[0]!;
  const inflected = surfaceReadingFromInline(primary.inlineReading, primary.surfaceForm);
  const accepted = [word.reading, word.expression, primary.surfaceForm];
  if (inflected) accepted.push(inflected);
  return isReadingAnswerCorrect(typed, accepted);
}

export function scoreWord(input: {
  solved: boolean;
  cluesUsed: number;
  wrongGuesses: number;
}): number {
  if (!input.solved) return 0;
  return Math.max(1, MAX_WORD_POINTS - input.cluesUsed - input.wrongGuesses);
}
