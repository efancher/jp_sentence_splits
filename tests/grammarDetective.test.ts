import { describe, expect, it } from 'vitest';

import type { GrammarPattern, Sentence, SentenceAudio, SentenceGrammar } from '../src/domain/types';
import {
  buildGrammarClueLadder,
  buildGrammarDetectiveWord,
  describeGrammarPick,
  grammarFirstKana,
  isGrammarDetectiveAnswerCorrect,
  MAX_GRAMMAR_POINTS,
  scoreGrammarWord,
} from '../src/lib/grammarDetective';
import type { ReadingContext } from '../src/lib/readingContext';

const T = '2026-09-26T00:00:00Z';

function pattern(overrides: Partial<GrammarPattern> = {}): GrammarPattern {
  return {
    id: 'gp-1',
    canonicalName: '〜わけがない',
    normalizedKey: 'わけがない',
    aliases: [],
    shortMeaning: "strong denial — 'there's no way that...'",
    provenance: 'ai_suggested',
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

function link(sentenceId: string, surfaceForm?: string): SentenceGrammar {
  return {
    id: `sg-${sentenceId}`,
    sentenceId,
    grammarPatternId: 'gp-1',
    surfaceForm,
    confirmedByLearner: true,
    source: 'manual',
    createdAt: T,
    updatedAt: T,
  };
}

function audio(sentenceId: string): SentenceAudio {
  return { id: `a-${sentenceId}`, sentenceId, sourceTitle: 'src' } as SentenceAudio;
}

const emptyContext: ReadingContext = { before: [], after: [] };

describe('buildGrammarDetectiveWord eligibility', () => {
  const s1 = sentence('s1', '彼が犯人なわけがない。');

  it('needs a canonical name and a translation on the sentence', () => {
    expect(
      buildGrammarDetectiveWord({
        pattern: pattern(),
        sentence: s1,
        sentenceGrammar: link('s1', 'わけがない'),
        readingContext: emptyContext,
      }),
    ).not.toBeNull();
    expect(
      buildGrammarDetectiveWord({
        pattern: pattern({ canonicalName: '' }),
        sentence: s1,
        sentenceGrammar: link('s1'),
        readingContext: emptyContext,
      }),
    ).toBeNull();
    expect(
      buildGrammarDetectiveWord({
        pattern: pattern(),
        sentence: { ...s1, translation: ' ' },
        sentenceGrammar: link('s1'),
        readingContext: emptyContext,
      }),
    ).toBeNull();
  });

  it('does not require a second occurrence — one tracked sentence is enough', () => {
    const word = buildGrammarDetectiveWord({
      pattern: pattern(),
      sentence: s1,
      sentenceGrammar: link('s1', 'わけがない'),
      readingContext: emptyContext,
    });
    expect(word?.sentenceId).toBe('s1');
  });
});

describe('clue ladder', () => {
  const s1 = sentence('s1', '彼が犯人なわけがない。');
  const withContext: ReadingContext = { before: [sentence('s0', '事件が起きた。')], after: [] };

  it('offers every clue when the data exists', () => {
    const word = buildGrammarDetectiveWord({
      pattern: pattern(),
      sentence: s1,
      sentenceGrammar: link('s1', 'わけがない'),
      readingContext: withContext,
      audio: audio('s1'),
    })!;
    expect(buildGrammarClueLadder(word)).toEqual(['translation', 'context', 'meaning', 'first_kana', 'audio']);
  });

  it('omits context/meaning/audio when there is nothing behind them, keeping translation+first_kana', () => {
    const word = buildGrammarDetectiveWord({
      pattern: pattern({ shortMeaning: '' }),
      sentence: s1,
      sentenceGrammar: link('s1'),
      readingContext: emptyContext,
    })!;
    expect(buildGrammarClueLadder(word)).toEqual(['translation', 'first_kana']);
  });
});

describe('answers and scoring', () => {
  const s1 = sentence('s1', '彼が犯人なわけがない。');
  const word = buildGrammarDetectiveWord({
    pattern: pattern({ aliases: ['わけない'] }),
    sentence: s1,
    sentenceGrammar: link('s1', 'わけがない'),
    readingContext: emptyContext,
  })!;

  it('accepts the canonical name (tilde/whitespace-insensitive) and known aliases', () => {
    expect(isGrammarDetectiveAnswerCorrect(word, '〜わけがない')).toBe(true);
    expect(isGrammarDetectiveAnswerCorrect(word, 'わけがない')).toBe(true);
    expect(isGrammarDetectiveAnswerCorrect(word, '  わけがない  ')).toBe(true);
    expect(isGrammarDetectiveAnswerCorrect(word, 'わけない')).toBe(true);
    expect(isGrammarDetectiveAnswerCorrect(word, 'はずがない')).toBe(false);
    expect(isGrammarDetectiveAnswerCorrect(word, '')).toBe(false);
  });

  it('exposes the first kana of the normalized name', () => {
    expect(grammarFirstKana(word)).toBe('わ');
  });

  it('scores fewer clues higher, never below 1 for a solve, and 0 for giving up', () => {
    expect(scoreGrammarWord({ solved: true, cluesUsed: 0, wrongGuesses: 0 })).toBe(MAX_GRAMMAR_POINTS);
    expect(scoreGrammarWord({ solved: true, cluesUsed: 2, wrongGuesses: 1 })).toBe(MAX_GRAMMAR_POINTS - 3);
    expect(scoreGrammarWord({ solved: true, cluesUsed: 5, wrongGuesses: 4 })).toBe(1);
    expect(scoreGrammarWord({ solved: false, cluesUsed: 0, wrongGuesses: 0 })).toBe(0);
  });

  it('describes weak/stale/strong/any picks without vocabulary-specific wording', () => {
    expect(describeGrammarPick('weak', { hasCard: true, lapses: 2, retrievability: 0.5, matureCards: false })).toContain(
      'Missed 2×',
    );
    expect(
      describeGrammarPick('any', { hasCard: false, lapses: 0, retrievability: null, matureCards: false }),
    ).not.toContain('vocabulary');
  });
});
