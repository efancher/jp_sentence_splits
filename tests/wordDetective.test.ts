import { describe, expect, it } from 'vitest';

import type { Sentence, SentenceAudio, SentenceVocabulary, VocabularyItem } from '../src/domain/types';
import {
  blankedParts,
  buildClueLadder,
  buildWordDetectiveWord,
  firstKana,
  isWordDetectiveAnswerCorrect,
  MAX_WORD_POINTS,
  scoreWord,
} from '../src/lib/wordDetective';

const T = '2026-09-19T00:00:00Z';

function item(overrides: Partial<VocabularyItem> = {}): VocabularyItem {
  return {
    id: 'vi-1',
    expression: '頑張る',
    reading: 'がんばる',
    meaning: 'to do one’s best',
    createdAt: T,
    updatedAt: T,
    ...overrides,
  };
}

function sentence(id: string, japanese: string, overrides: Partial<Sentence> = {}): Sentence {
  return {
    id,
    normalizedKey: id,
    japanese,
    readingOnly: '',
    inlineReading: '',
    translation: `translation of ${id}`,
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: T,
    updatedAt: T,
    ...overrides,
  };
}

function link(sentenceId: string, surfaceForm?: string): SentenceVocabulary {
  return {
    id: `l-${sentenceId}`,
    sentenceId,
    vocabularyItemId: 'vi-1',
    surfaceForm,
    createdAt: T,
    updatedAt: T,
  };
}

function audio(sentenceId: string): SentenceAudio {
  return { id: `a-${sentenceId}`, sentenceId, sourceTitle: 'src' } as SentenceAudio;
}

function build(
  sentences: Sentence[],
  links: SentenceVocabulary[],
  audios: SentenceAudio[] = [],
  vocab: VocabularyItem = item(),
) {
  return buildWordDetectiveWord({
    item: vocab,
    links,
    sentenceById: new Map(sentences.map((s) => [s.id, s])),
    audioBySentenceId: new Map(audios.map((a) => [a.sentenceId, a])),
  });
}

describe('buildWordDetectiveWord eligibility', () => {
  const s1 = sentence('s1', '明日も頑張ってください。');
  const s2 = sentence('s2', '彼はいつも頑張る。');

  it('needs two distinct sentences where the surface form is really present', () => {
    expect(build([s1, s2], [link('s1', '頑張って'), link('s2', '頑張る')])).not.toBeNull();
    expect(build([s1], [link('s1', '頑張って')])).toBeNull();
    // same sentence linked twice still counts once
    expect(build([s1], [link('s1', '頑張って'), { ...link('s1', '頑張って'), id: 'dup' }])).toBeNull();
    // surface form not actually in the text
    expect(build([s1, s2], [link('s1', '頑張って'), link('s2', '頑張った')])).toBeNull();
    // links without a surface form (unconfirmed) don't count
    expect(build([s1, s2], [link('s1', '頑張って'), link('s2', undefined)])).toBeNull();
  });

  it('needs a reading, and a translation on the opening sentence', () => {
    const links = [link('s1', '頑張って'), link('s2', '頑張る')];
    expect(build([s1, s2], links, [], item({ reading: '' }))).toBeNull();
    expect(
      build([{ ...s1, translation: '' }, { ...s2, translation: ' ' }], links),
    ).toBeNull();
    // one translated sentence is enough — it becomes the opener
    const word = build([{ ...s1, translation: '' }, s2], links)!;
    expect(word.occurrences[0]!.sentenceId).toBe('s2');
  });

  it('prefers an opening sentence that has audio', () => {
    const word = build([s1, s2], [link('s1', '頑張って'), link('s2', '頑張る')], [audio('s2')])!;
    expect(word.occurrences[0]!.sentenceId).toBe('s2');
    expect(word.occurrences[0]!.audio).toBeDefined();
  });
});

describe('clue ladder', () => {
  const s1 = sentence('s1', '明日も頑張ってください。');
  const s2 = sentence('s2', '彼はいつも頑張る。');
  const links = [link('s1', '頑張って'), link('s2', '頑張る')];

  it('offers every clue when the data exists, meaning and audio last-ish', () => {
    const word = build([s1, s2], links, [audio('s1')])!;
    expect(buildClueLadder(word)).toEqual([
      'translation',
      'second_sentence',
      'meaning',
      'first_kana',
      'audio',
    ]);
  });

  it('omits clues with nothing behind them', () => {
    const word = build([s1, s2], links, [], item({ meaning: '' }))!;
    expect(buildClueLadder(word)).toEqual(['translation', 'second_sentence', 'first_kana']);
  });
});

describe('answers and scoring', () => {
  const s1 = sentence('s1', '明日も頑張ってください。', { inlineReading: '明日[あした]も頑張[がんば]ってください。' });
  const s2 = sentence('s2', '彼はいつも頑張る。');
  const word = build([s1, s2], [link('s1', '頑張って'), link('s2', '頑張る')])!;

  it('accepts the dictionary reading, the in-sentence reading, romaji, or the written word', () => {
    expect(isWordDetectiveAnswerCorrect(word, 'がんばる')).toBe(true);
    expect(isWordDetectiveAnswerCorrect(word, 'がんばって')).toBe(true);
    expect(isWordDetectiveAnswerCorrect(word, 'ganbaru')).toBe(true);
    expect(isWordDetectiveAnswerCorrect(word, '頑張る')).toBe(true);
    expect(isWordDetectiveAnswerCorrect(word, 'たべる')).toBe(false);
    expect(isWordDetectiveAnswerCorrect(word, '')).toBe(false);
  });

  it('blanks the surface form and exposes the first kana', () => {
    expect(blankedParts(word.occurrences[0]!)).toEqual({ before: '明日も', after: 'ください。' });
    expect(blankedParts({ japanese: 'abc', surfaceForm: 'x' })).toBeNull();
    expect(firstKana(word)).toBe('が');
  });

  it('scores fewer clues higher, never below 1 for a solve, and 0 for giving up', () => {
    expect(scoreWord({ solved: true, cluesUsed: 0, wrongGuesses: 0 })).toBe(MAX_WORD_POINTS);
    expect(scoreWord({ solved: true, cluesUsed: 2, wrongGuesses: 1 })).toBe(MAX_WORD_POINTS - 3);
    expect(scoreWord({ solved: true, cluesUsed: 5, wrongGuesses: 4 })).toBe(1);
    expect(scoreWord({ solved: false, cluesUsed: 0, wrongGuesses: 0 })).toBe(0);
  });
});
