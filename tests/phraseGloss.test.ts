import { describe, expect, it } from 'vitest';

import { phraseGloss } from '../src/lib/phraseShadow';

describe('phraseGloss', () => {
  const japanese = '言語を学ぶと、文化や生活も学ぶことができます。';
  const walkthrough = {
    natural: 'x',
    steps: [{ text: '文化や生活も', start: 7, end: 13, gloss: 'culture and life too', explanation: '' }],
    words: [
      { text: '文化', start: 7, end: 9, gloss: 'culture' },
      { text: 'や', start: 9, end: 10, gloss: 'and (a partial list)' },
      { text: '生活', start: 10, end: 12, gloss: 'daily life' },
    ],
  };

  it('glosses only the walkthrough words inside the phrase, particle included, in sentence order', () => {
    expect(phraseGloss(japanese, '文化や', walkthrough, [])).toBe('文化 = culture · や = and (a partial list)');
  });

  it('falls back to the first dictionary meaning of linked words inside the phrase', () => {
    const links = [
      { surfaceForm: '文化', meaning: 'culture; civilization' },
      { surfaceForm: '生活', meaning: 'life' },
    ];
    expect(phraseGloss(japanese, '文化や', undefined, links)).toBe('文化 = culture');
  });

  it('is null when the phrase is not in the sentence or nothing in it has a gloss', () => {
    expect(phraseGloss(japanese, '別の', walkthrough, [])).toBeNull();
    expect(phraseGloss(japanese, '文化や', undefined, [])).toBeNull();
  });
});
