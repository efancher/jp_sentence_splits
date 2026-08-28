import { describe, expect, it } from 'vitest';

import {
  buildJmnedictIndex,
  lookupJmnedict,
  type JmnedictFile,
} from '../scripts/lib/jmnedict';

const file: JmnedictFile = {
  words: [
    {
      id: '1',
      kanji: [{ text: '佐藤' }],
      kana: [{ text: 'さとう', appliesToKanji: ['*'] }],
      translation: [{ type: ['surname'], translation: [{ lang: 'eng', text: 'Satō' }] }],
    },
    {
      id: '2',
      kanji: [{ text: '新宿' }],
      kana: [{ text: 'しんじゅく', appliesToKanji: ['*'] }],
      translation: [{ type: ['place'], translation: [{ lang: 'eng', text: 'Shinjuku' }] }],
    },
    {
      id: '3',
      kana: [{ text: 'ゆい' }],
      translation: [{ type: ['fem'], translation: [{ lang: 'eng', text: 'Yui' }] }],
    },
  ],
};
const index = buildJmnedictIndex(file);

describe('lookupJmnedict', () => {
  it('glosses a surname with its name type', () => {
    expect(lookupJmnedict(index, '佐藤', 'さとう')?.gloss).toBe('Satō (surname)');
  });

  it('glosses a place name', () => {
    expect(lookupJmnedict(index, '新宿')?.gloss).toBe('Shinjuku (place name)');
  });

  it('handles kana-only entries', () => {
    expect(lookupJmnedict(index, 'ゆい', 'ゆい')?.gloss).toBe('Yui (female given name)');
  });

  it('returns null for an unknown name', () => {
    expect(lookupJmnedict(index, '存在しない')).toBeNull();
  });

  it('prefers the person-name type when an entry is tagged place + surname', () => {
    const both = buildJmnedictIndex({
      words: [
        {
          id: 'x',
          kanji: [{ text: '佐藤' }],
          kana: [{ text: 'さとう', appliesToKanji: ['*'] }],
          translation: [
            { type: ['place', 'surname'], translation: [{ lang: 'eng', text: 'Satō' }] },
          ],
        },
      ],
    });
    const hit = lookupJmnedict(both, '佐藤', 'さとう');
    expect(hit?.gloss).toBe('Satō (surname)');
    expect(hit?.typePriority).toBe(0);
  });
});
