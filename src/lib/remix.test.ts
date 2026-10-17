import { describe, expect, it } from 'vitest';

import type { Sentence, VocabularyItem } from '../domain/types';
import {
  buildRemixNounPool,
  buildRemixPuzzle,
  findRemixSkeleton,
  isCorrectNoun,
  remixedSentence,
  remixRejection,
  swapPoints,
  type RemixNoun,
} from './remix';

type Seg = [surface: string, pos: string, english?: string];

function sentenceOf(id: string, segs: Seg[]): Pick<Sentence, 'id' | 'japanese' | 'translation' | 'vocabularySuggestions'> {
  let at = 0;
  const vocabularySuggestions = segs.map(([surface, pos, english], i) => {
    const token = {
      id: `${id}-${i}`,
      surface,
      start: at,
      end: at + surface.length,
      expression: surface,
      reading: surface,
      pos,
      english,
      source: 'morphology' as const,
      selectedByDefault: false,
    };
    at += surface.length;
    return token;
  });
  return { id, japanese: segs.map(([s]) => s).join(''), translation: 'The parent bird gave the chick a nest.', vocabularySuggestions };
}

const N = '名詞/普通名詞';
const CASE = '助詞/格助詞';
// 親鳥がひなに巣を作りました。
const BASE: Seg[] = [
  ['親', N], ['鳥', N, 'parent bird'], ['が', CASE],
  ['ひな', N, 'chick'], ['に', CASE],
  ['巣', N, 'nest'], ['を', CASE],
  ['作り', '動詞/一般'], ['まし', '助動詞'], ['た', '助動詞'], ['。', '補助記号'],
];

const noun = (id: string, expression: string, gloss: string): RemixNoun => ({
  id,
  expression,
  reading: expression,
  gloss,
});
const POOL = [
  noun('a', '犬', 'dog'), noun('b', '本', 'book'), noun('c', '駅', 'station'),
  noun('d', '水', 'water'), noun('e', '窓', 'window'), noun('f', '机', 'desk'),
  noun('g', '花', 'flower'),
];

describe('findRemixSkeleton', () => {
  it('finds noun+particle slots, compound heads and the fixed verb', () => {
    const skeleton = findRemixSkeleton(sentenceOf('s1', BASE))!;
    expect(skeleton.slots.map((s) => `${s.noun}${s.particle}`)).toEqual(['親鳥が', 'ひなに', '巣を']);
    expect(skeleton.slots[1]!.hint).toBe('where to / when / to whom');
    expect(skeleton.slots[0]!.gloss).toBeUndefined(); // two-token compound: no single gloss
    expect(skeleton.slots[1]!.gloss).toBe('chick');
    expect(skeleton.verbText).toBe('作りました。');
  });

  it('rejects multi-clause, quoted, noun-less and non-verb-final sentences', () => {
    const te: Seg[] = [...BASE.slice(0, 7), ['起き', '動詞/一般'], ['て', '助詞/接続助詞'], ...BASE.slice(7)];
    expect(findRemixSkeleton(sentenceOf('s2', te))).toBeNull();
    const quoted: Seg[] = [['「', '補助記号'], ...BASE.slice(0, 10), ['」', '補助記号']];
    expect(findRemixSkeleton(sentenceOf('s3', quoted))).toBeNull();
    expect(findRemixSkeleton(sentenceOf('s4', BASE.slice(0, 5)))).toBeNull();
  });

  it('skips formal nouns and repeated particles as slots', () => {
    const formal: Seg[] = [['こと', N], ['が', CASE], ...BASE.slice(3)];
    expect(findRemixSkeleton(sentenceOf('s5', formal))!.slots.map((slot) => slot.noun)).toEqual(['ひな', '巣']);
    const dup: Seg[] = [['犬', N], ['を', CASE], ...BASE.slice(5)];
    expect(findRemixSkeleton(sentenceOf('s6', dup))).toBeNull();
  });
});

describe('remixRejection', () => {
  it('needs a translation and a short clip', () => {
    const s = sentenceOf('s1', BASE);
    expect(remixRejection(s, 3000)).toBeNull();
    expect(remixRejection({ ...s, translation: ' ' }, 3000)).toBe('no-translation');
    expect(remixRejection(s, 20_000)).toBe('clip-too-long');
  });
});

describe('buildRemixNounPool', () => {
  const item = (id: string, expression: string, meaning: string, partOfSpeech = '名詞/普通名詞'): VocabularyItem =>
    ({ id, expression, reading: 'ふつう', meaning, partOfSpeech }) as VocabularyItem;

  it('keeps plain nouns with a unique first gloss and drops the rest', () => {
    const pool = buildRemixNounPool([
      item('1', '犬', 'dog; hound'),
      item('2', '猫', 'cat'),
      item('3', '食べる', 'to eat', '動詞'),
      item('4', '本', 'book'),
      item('5', '書物', 'Book'), // same gloss as 4 → both dropped
      item('6', 'こと', 'thing'),
      item('7', 'ABC', 'letters'),
    ]);
    expect(pool.map((n) => n.expression)).toEqual(['犬', '猫']);
    expect(pool[0]!.gloss).toBe('dog');
  });
});

describe('isCorrectNoun', () => {
  it('accepts the kanji form or the reading in either kana script', () => {
    const target = { expression: '犬', reading: 'いぬ' };
    expect(isCorrectNoun('犬', target)).toBe(true);
    expect(isCorrectNoun('いぬ', target)).toBe(true);
    expect(isCorrectNoun('イヌ', target)).toBe(true);
    expect(isCorrectNoun('ねこ', target)).toBe(false);
    expect(isCorrectNoun('  ', target)).toBe(false);
  });
});

describe('buildRemixPuzzle', () => {
  const sentence = sentenceOf('s1', BASE);

  it('swaps one slot then two distinct others, with distinct pool nouns', () => {
    const puzzle = buildRemixPuzzle(sentence, POOL, 'seed')!;
    const [one, two] = puzzle.stages;
    expect(one.swaps).toHaveLength(1);
    expect(two.swaps).toHaveLength(2);
    expect(two.swaps.map((s) => s.slot)).not.toContain(one.swaps[0]!.slot);
    const used = [...one.swaps, ...two.swaps].map((s) => s.noun.id);
    expect(new Set(used).size).toBe(3);
  });

  it('never reuses the sentence\'s own nouns or glosses', () => {
    const pool = [...POOL, noun('x', 'ひな', 'baby'), noun('y', '雛', 'chick')];
    for (let i = 0; i < 20; i += 1) {
      const puzzle = buildRemixPuzzle(sentence, pool, `seed${i}`)!;
      for (const swap of puzzle.stages.flatMap((s) => s.swaps)) {
        expect(['ひな', '巣', '親鳥']).not.toContain(swap.noun.expression);
        expect(swap.noun.gloss).not.toBe('chick');
      }
    }
  });

  it('returns null when the pool is too small (the gate is satisfiable only with enough nouns)', () => {
    expect(buildRemixPuzzle(sentence, POOL.slice(0, 3), 'seed')).toBeNull();
  });

  it('is deterministic per seed', () => {
    expect(buildRemixPuzzle(sentence, POOL, 'k')).toEqual(buildRemixPuzzle(sentence, POOL, 'k'));
  });
});

describe('remixedSentence / swapPoints', () => {
  it('replaces only the chosen slots and copies everything else', () => {
    const sentence = sentenceOf('s1', BASE);
    const skeleton = findRemixSkeleton(sentence)!;
    expect(remixedSentence(sentence, skeleton, new Map([[2, '本']]))).toBe('親鳥がひなに本を作りました。');
    expect(remixedSentence(sentence, skeleton, new Map())).toBe(sentence.japanese);
  });

  it('scores 2 / 1 / 0 by misses and 0 for a reveal', () => {
    expect([swapPoints(0, false), swapPoints(1, false), swapPoints(2, false), swapPoints(0, true)]).toEqual([2, 1, 0, 0]);
  });
});
