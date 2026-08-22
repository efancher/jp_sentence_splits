import { describe, expect, it } from 'vitest';

import { suggestStickyEnglish } from '../src/lib/stickyEnglish';

describe('suggestStickyEnglish', () => {
  it('glosses discourse connectors like そして', () => {
    expect(suggestStickyEnglish('そして、')).toBe('and-then,');
  });

  it('adds particle sticky suffixes', () => {
    expect(
      suggestStickyEnglish('空は', {
        vocabulary: [
          {
            expression: '空',
            reading: 'そら',
            furigana: '',
            english: 'sky',
            partsOfSpeech: 'n',
            sourceCardIds: [],
            cardTypes: [],
          },
        ],
      }),
    ).toBe('sky-as-for');
  });

  it('adds engine sticky suffixes', () => {
    expect(
      suggestStickyEnglish('きれいでした。', {
        vocabulary: [
          {
            expression: 'きれい',
            reading: 'きれい',
            furigana: '',
            english: 'pretty; clean',
            partsOfSpeech: 'adj',
            sourceCardIds: [],
            cardTypes: [],
          },
        ],
      }),
    ).toBe('pretty-was.POLITE');
  });

  it('uses lexicon for common standalone content', () => {
    expect(suggestStickyEnglish('ある')).toBe('a-certain');
  });

  it('matches conjugated verbs against a dictionary-form vocabulary entry', () => {
    expect(
      suggestStickyEnglish('食べました', {
        vocabulary: [
          {
            expression: '食べる',
            reading: 'たべる',
            furigana: '',
            english: 'to eat',
            partsOfSpeech: 'v',
            sourceCardIds: [],
            cardTypes: [],
          },
        ],
      }),
    ).toBe('eat-POLITE.PAST');

    expect(
      suggestStickyEnglish('話しました', {
        vocabulary: [
          {
            expression: '話す',
            reading: 'はなす',
            furigana: '',
            english: 'to speak',
            partsOfSpeech: 'v',
            sourceCardIds: [],
            cardTypes: [],
          },
        ],
      }),
    ).toBe('speak-POLITE.PAST');
  });

  it('treats verb-stem って as te-form (and), not literal quotative って', () => {
    expect(
      suggestStickyEnglish('走って', {
        vocabulary: [
          {
            expression: '走る',
            reading: 'はしる',
            furigana: '',
            english: 'to run',
            partsOfSpeech: 'v',
            sourceCardIds: [],
            cardTypes: [],
          },
        ],
      }),
    ).toBe('run-and');
  });
});
