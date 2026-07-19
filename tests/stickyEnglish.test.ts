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
});
