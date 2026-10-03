import { describe, expect, it } from 'vitest';

import { glossesFromWords } from '../src/lib/chunkGlosses';

describe('glossesFromWords', () => {
  const chunks = [
    { id: 'a', japanese: 'もう一つは' },
    { id: 'b', japanese: '紙、' },
    { id: 'c', japanese: '何かを' },
    { id: 'd', japanese: '書いたりする' },
  ];
  const words = [
    { expression: 'もう', english: 'one more / another' },
    { expression: '一', english: 'one' },
    { expression: '紙', english: 'paper' },
    { expression: '何', english: 'what' },
    { expression: '書く', english: 'to write' },
    { expression: 'やつ', english: 'thing / stuff' },
  ];

  it('assigns each word to the first chunk containing it, matching inflected stems', () => {
    const result = glossesFromWords(chunks, words);
    expect(result.get('a')).toBe('one more · one');
    expect(result.get('b')).toBe('paper');
    expect(result.get('c')).toBe('what');
    expect(result.get('d')).toBe('to write');
  });

  it('skips words that appear in no chunk', () => {
    expect([...glossesFromWords(chunks, words).values()].join(' ')).not.toContain('thing');
  });
});
