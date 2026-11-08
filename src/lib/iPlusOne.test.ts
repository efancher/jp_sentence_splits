import { describe, expect, it } from 'vitest';

import { episodeMomentumBoost, grammarLevelCosts, knownGrammarEntries, orderByIPlusOne, type IPlusOneItem } from './iPlusOne';
import { buildKnownLemmaSet, lemmaKey, type LemmaSource } from './unknownLemmas';

const tok = (word: string, selectedByDefault = true, pos?: string): LemmaSource => ({
  expression: word,
  reading: word,
  selectedByDefault,
  ...(pos ? { pos } : {}),
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

  it('does not let a widely shared filler outrank a content word', () => {
    const filler = (sentenceId: string): IPlusOneItem => ({
      sentenceId,
      suggestions: [tok('猫'), tok('うん', true, '感動詞/一般')],
    });
    const items: IPlusOneItem[] = [
      filler('filler-1'),
      filler('filler-2'),
      filler('filler-3'),
      sentence('content', '猫', '空'),
      sentence('content-2', '犬', '空'),
    ];
    // うん unlocks three sentences, 空 two; unweighted, the うん sentences would lead.
    const order = orderByIPlusOne(items, known);
    expect(order.slice(0, 2)).toEqual(['content', 'content-2']);
    expect([...order].sort()).toEqual(['content', 'content-2', 'filler-1', 'filler-2', 'filler-3']);
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

  it('favours sentences from episodes with many started sentences, breaking ties and lifting close calls', () => {
    // Same unknown count and unlock value, so only the episode momentum separates them.
    const tied = [
      { ...sentence('cold', '猫', '空'), momentum: 0 },
      { ...sentence('warm', '猫', '海'), momentum: 6 },
    ];
    expect(orderByIPlusOne(tied, known)).toEqual(['warm', 'cold']);
    // A word that unlocks two other sentences is worth 2; +50% on a 1-value word (1.5) still loses to it.
    const items = [
      { ...sentence('shared-a', '猫', '空'), momentum: 0 },
      { ...sentence('shared-b', '犬', '空'), momentum: 0 },
      { ...sentence('warm-lone', '猫', '海'), momentum: 10 },
    ];
    const order = orderByIPlusOne(items, known);
    expect(order.indexOf('warm-lone')).toBeGreaterThan(order.indexOf('shared-a'));
  });

  it('caps the episode boost and is neutral when momentum is absent', () => {
    expect(episodeMomentumBoost(undefined)).toBe(1);
    expect(episodeMomentumBoost(10)).toBe(1.5);
    expect(episodeMomentumBoost(500)).toBe(1.5);
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

describe('grammarLevelCosts', () => {
  const entries = new Map<string, string | undefined>([
    ['n5a', 'N5'],
    ['n5b', 'N5'],
    ['n4a', 'N4'],
    ['n2a', 'N2'],
    ['plain', undefined],
  ]);

  it('holds back levels above the easiest level that is under 60% met', () => {
    // N5 is half met, so N5 is the frontier: N4 costs 2, N2 costs 4.
    expect([...grammarLevelCosts(entries, new Set(['n5a']))]).toEqual([['n4a', 2], ['n2a', 4]]);
  });

  it('opens the next level once the easier one is mostly met', () => {
    // N5 fully met, N4 not: frontier is N4, so only N2 costs more.
    expect([...grammarLevelCosts(entries, new Set(['n5a', 'n5b']))]).toEqual([['n2a', 3]]);
  });

  it('makes a far-level pattern push a sentence out of the ready pool', () => {
    const items: IPlusOneItem[] = [
      { ...sentence('advanced', '猫', '空'), grammar: ['n2a'] },
      { ...sentence('basic', '猫', '空', '雲', '風'), grammar: [] },
    ];
    const knownGrammar = new Set(['n5a']);
    const grammarCost = grammarLevelCosts(entries, knownGrammar);
    // advanced is 1 word + 1 pattern (ready); with the N2 pattern costing 4 it becomes 5 and falls behind basic (3).
    expect(orderByIPlusOne(items, known, { knownGrammar })).toEqual(['advanced', 'basic']);
    expect(orderByIPlusOne(items, known, { knownGrammar, grammarCost })).toEqual(['basic', 'advanced']);
  });
});

describe('orderByIPlusOne with grammar', () => {
  const withGrammar = (item: IPlusOneItem, ...grammar: string[]): IPlusOneItem => ({ ...item, grammar });
  const knownGrammar = new Set(['temiru']);

  it('counts an unmet curated pattern like an unknown word, so one word plus one pattern is still i+1', () => {
    const items: IPlusOneItem[] = [
      withGrammar(sentence('too-much', '猫', '空', '雲'), 'nagara'),
      withGrammar(sentence('words-and-grammar', '猫', '空'), 'nagara'),
      withGrammar(sentence('seen-grammar', '猫', '空'), 'temiru'),
    ];
    // seen-grammar: 1 unknown; words-and-grammar: 2 (ready); too-much: 3 (stretch).
    expect(orderByIPlusOne(items, known, { knownGrammar })).toEqual(['seen-grammar', 'words-and-grammar', 'too-much']);
  });

  it('treats a known-words sentence with a new pattern as i+1, ahead of an all-known one', () => {
    const items: IPlusOneItem[] = [
      withGrammar(sentence('plain', '猫', '犬')),
      withGrammar(sentence('new-pattern', '猫', '犬'), 'nagara'),
    ];
    expect(orderByIPlusOne(items, known, { knownGrammar })).toEqual(['new-pattern', 'plain']);
  });

  it('ignores grammar when no known-grammar set is given', () => {
    const items: IPlusOneItem[] = [
      sentence('b', '猫', '空', '雲', '風'),
      withGrammar(sentence('a', '猫', '空'), 'g1', 'g2', 'g3'),
    ];
    expect(orderByIPlusOne(items, known)).toEqual(['a', 'b']);
    expect(orderByIPlusOne(items, known, { knownGrammar: new Set() })).toEqual(['b', 'a']);
  });
});

describe('knownGrammarEntries', () => {
  const exposures = new Map([['a', 1], ['b', 2], ['c', 5]]);

  it('needs more than one introduced sentence', () => {
    expect([...knownGrammarEntries(exposures)].sort()).toEqual(['b', 'c']);
  });

  it('drops a pattern the learner tapped and found shaky, however often seen', () => {
    expect([...knownGrammarEntries(exposures, new Set(['c']))]).toEqual(['b']);
  });

  it('honours a custom exposure bar', () => {
    expect([...knownGrammarEntries(exposures, new Set(), 1)].sort()).toEqual(['a', 'b', 'c']);
  });
});
