import { describe, expect, it } from 'vitest';

import { orderByIPlusOne, type IPlusOneItem } from './iPlusOne';
import { buildKnownLemmaSet, lemmaKey, type LemmaSource } from './unknownLemmas';

const tok = (word: string, selectedByDefault = true): LemmaSource => ({
  expression: word,
  reading: word,
  selectedByDefault,
});
const sentence = (sentenceId: string, ...words: string[]): IPlusOneItem => ({
  sentenceId,
  suggestions: words.map((w) => tok(w)),
});
const known = buildKnownLemmaSet([[tok('猫'), tok('犬'), tok('水')]]);

describe('orderByIPlusOne', () => {
  it('serves 1-2 unknown sentences first, then all-known, then stretch, then unscorable', () => {
    const items: IPlusOneItem[] = [
      { sentenceId: 'untokenized', suggestions: [] },
      sentence('hard', '雨', '傘', '風', '雲'),
      sentence('easy', '猫', '犬'),
      sentence('i1', '猫', '空'),
    ];
    expect(orderByIPlusOne(items, known)).toEqual(['i1', 'easy', 'hard', 'untokenized']);
  });

  it('ranks i+1 sentences by how many other sentences their unknown word unlocks', () => {
    const items: IPlusOneItem[] = [
      sentence('lonely', '猫', '珍'),
      sentence('shared-a', '猫', '空'),
      sentence('shared-b', '犬', '空'),
    ];
    expect(orderByIPlusOne(items, known)).toEqual(['shared-a', 'shared-b', 'lonely']);
  });

  it('breaks ties by fewer unknowns, then reading order', () => {
    const items: IPlusOneItem[] = [sentence('two', '猫', '空', '星'), sentence('b', '猫', '海'), sentence('a', '犬', '山')];
    // 'two' has 2 unknowns (空, 星), 'a'/'b' have 1 each and equal unlock value.
    expect(orderByIPlusOne(items, known)).toEqual(['b', 'a', 'two']);
  });

  it('draws every fifth slot from the stretch pool while i+1 sentences remain', () => {
    const ready = Array.from({ length: 8 }, (_, i) => sentence(`r${i}`, '猫', `新${i}`));
    const stretch = [sentence('s1', '雨', '傘', '風', '雲'), sentence('s2', '雨', '傘', '風', '雲', '星')];
    const order = orderByIPlusOne([...stretch, ...ready], known);
    expect(order[4]).toBe('s1');
    expect(order[9]).toBe('s2');
    expect(order.filter((id) => id.startsWith('r'))).toHaveLength(8);
  });

  it('is a permutation: nothing is dropped or duplicated', () => {
    const items: IPlusOneItem[] = [
      sentence('a', '猫'),
      sentence('b', '雨', '傘', '風'),
      { sentenceId: 'c', suggestions: undefined },
      { sentenceId: 'd', suggestions: [tok('は', false)] },
      sentence('e', '猫', '空'),
    ];
    expect([...orderByIPlusOne(items, known)].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('treats a lemma as known once it is in the known set, wherever it was met', () => {
    const items: IPlusOneItem[] = [sentence('new', '猫', '空'), sentence('met', '猫', '空')];
    const withSky = buildKnownLemmaSet([[tok('猫')]], [lemmaKey('空', '空')]);
    // With 空 known, both sentences are all-known and keep reading order.
    expect(orderByIPlusOne(items, withSky)).toEqual(['new', 'met']);
  });

  it('returns an empty order for no items', () => {
    expect(orderByIPlusOne([], known)).toEqual([]);
  });
});
