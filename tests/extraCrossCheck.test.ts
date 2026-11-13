import { describe, expect, it } from 'vitest';

import { checkParticleChunk, checkStructureSentence, type CheckToken } from '../src/lib/extraCrossCheck';

const t = (surface: string, start: number, pos: string): CheckToken => ({ surface, start, end: start + surface.length, pos });
// 私は本を読みます。
const sentence = '私は本を読みます。';
const tokens = [
  t('私', 0, '代名詞'),
  t('は', 1, '助詞/係助詞'),
  t('本', 2, '名詞/普通名詞'),
  t('を', 3, '助詞/格助詞'),
  t('読み', 4, '動詞/一般'),
  t('ます', 6, '助動詞'),
  t('。', 8, '補助記号/句点'),
];

describe('extra cross-checks', () => {
  it('accepts a particles chunk ending in a case particle and flags other endings', () => {
    expect(checkParticleChunk(sentence, tokens, '本を')).toBeNull();
    expect(checkParticleChunk(sentence, tokens, '読みます。')?.problem).toMatch(/not a particle/);
    expect(checkParticleChunk(sentence, tokens, '雑誌を')?.problem).toMatch(/substring/);
  });

  it('flags role labels that contradict the tokens and tolerates a dropped は', () => {
    const ok = checkStructureSentence(sentence, tokens, [
      { chunk: '私は', role: 'topic は' },
      { chunk: '本を', role: 'を-car' },
      { chunk: '読みます。', role: 'engine: verb' },
    ]);
    expect(ok).toEqual([]);
    const bad = checkStructureSentence(sentence, tokens, [
      { chunk: '私は', role: 'Aが' },
      { chunk: '本を', role: 'に-car' },
      { chunk: '読みます。', role: 'を-car' },
    ]);
    expect(bad.map((i) => i.chunk)).toEqual(['私は', '本を', '読みます。']);
    expect(checkStructureSentence(sentence, tokens, [{ chunk: '私', role: 'topic は' }])).toEqual([]);
  });
});
