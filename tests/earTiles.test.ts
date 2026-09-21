import { describe, expect, it } from 'vitest';

import type { Sentence, VocabularySuggestion } from '../src/domain/types';
import {
  buildEarTilesPuzzle,
  chunkSentenceIntoTiles,
  describeEarTilesPick,
  earTilesPointsAvailable,
  earTilesRejection,
  isCorrectTile,
  scoreEarTiles,
} from '../src/lib/earTiles';

type Piece = [surface: string, pos: string, expression?: string];

/** Lay pieces end to end as consecutive tokens over `japanese` (the caller keeps them consistent). */
function sentence(
  pieces: Piece[],
  overrides: Partial<Sentence> = {},
): Pick<Sentence, 'id' | 'japanese' | 'translation' | 'vocabularySuggestions'> {
  let cursor = 0;
  const suggestions: VocabularySuggestion[] = pieces.map(([surface, pos, expression], i) => {
    const token: VocabularySuggestion = {
      id: `t${i}`,
      surface,
      start: cursor,
      end: cursor + surface.length,
      expression: expression ?? surface,
      reading: surface,
      pos,
      source: 'morphology',
      selectedByDefault: false,
    };
    cursor += surface.length;
    return token;
  });
  return {
    id: 's1',
    japanese: pieces.map((p) => p[0]).join(''),
    translation: 'A translation.',
    vocabularySuggestions: suggestions,
    ...overrides,
  };
}

const NOUN = '名詞/普通名詞/一般';
const KAKU = '助詞/格助詞';
const VERB = '動詞/一般';
const BOUND_VERB = '動詞/非自立可能';
const AUX = '助動詞';
const CONJ = '助詞/接続助詞';
const PUNCT = '補助記号/句点';
const COMMA = '補助記号/読点';

describe('chunkSentenceIntoTiles', () => {
  it('glues particles and auxiliaries onto the word before them', () => {
    const s = sentence([
      ['私', '代名詞'],
      ['は', '助詞/係助詞'],
      ['猫', NOUN],
      ['が', KAKU],
      ['魚', NOUN],
      ['を', KAKU],
      ['食べ', VERB],
      ['まし', AUX],
      ['た', AUX],
      ['。', PUNCT],
    ]);
    expect(chunkSentenceIntoTiles(s)).toEqual(['私は', '猫が', '魚を', '食べました']);
  });

  it('keeps 見る/来る as the main verb of their own phrase after a particle', () => {
    const s = sentence([
      ['ニュース', NOUN],
      ['を', KAKU],
      ['見', BOUND_VERB, '見る'],
      ['まし', AUX],
      ['た', AUX],
    ]);
    expect(chunkSentenceIntoTiles(s)).toEqual(['ニュースを', '見ました']);
  });

  it('glues a bound auxiliary verb only straight after て/で', () => {
    const s = sentence([
      ['食べ', VERB],
      ['て', CONJ],
      ['み', BOUND_VERB, '見る'],
      ['たい', AUX],
    ]);
    expect(chunkSentenceIntoTiles(s)).toEqual(['食べてみたい']);
  });

  it('treats punctuation as a boundary, so 揺れた。だけど does not fuse', () => {
    const s = sentence([
      ['揺れ', VERB],
      ['た', AUX],
      ['。', PUNCT],
      ['だ', AUX],
      ['けど', CONJ],
    ]);
    expect(chunkSentenceIntoTiles(s)).toEqual(['揺れた', 'だけど']);
  });

  it('joins adjacent nouns into a compound and a noun with its する', () => {
    expect(
      chunkSentenceIntoTiles(
        sentence([
          ['東京', NOUN],
          ['大学', NOUN],
          ['で', KAKU],
          ['勉強', '名詞/普通名詞/サ変可能'],
          ['し', BOUND_VERB, 'する'],
          ['ます', AUX],
        ]),
      ),
    ).toEqual(['東京大学で', '勉強します']);
  });

  it('attaches a prefix to the word that follows', () => {
    const s = sentence([
      ['お', '接頭辞'],
      ['先', NOUN],
      ['に', KAKU],
      ['行く', VERB],
    ]);
    expect(chunkSentenceIntoTiles(s)).toEqual(['お先に', '行く']);
  });

  it('refuses tokens that do not tile the text', () => {
    const gap = sentence([
      ['猫', NOUN],
      ['が', KAKU],
    ]);
    gap.vocabularySuggestions[1]!.start = 5;
    gap.vocabularySuggestions[1]!.end = 6;
    expect(chunkSentenceIntoTiles(gap)).toBeNull();

    const wrongSurface = sentence([['猫', NOUN]]);
    wrongSurface.japanese = '犬';
    expect(chunkSentenceIntoTiles(wrongSurface)).toBeNull();

    expect(chunkSentenceIntoTiles({ japanese: '猫', vocabularySuggestions: [] })).toBeNull();
  });

  it('refuses when tokens leave part of the sentence uncovered', () => {
    const s = sentence([['猫', NOUN]]);
    s.japanese = '猫が寝る';
    expect(chunkSentenceIntoTiles(s)).toBeNull();
  });
});

const FIVE: Piece[] = [
  ['今日', NOUN],
  ['は', '助詞/係助詞'],
  ['友達', NOUN],
  ['と', KAKU],
  ['公園', NOUN],
  ['で', KAKU],
  ['遊び', VERB],
  ['まし', AUX],
  ['た', AUX],
  ['。', COMMA],
];

describe('earTilesRejection', () => {
  it('accepts a normal sentence and rejects each way it can fail', () => {
    expect(earTilesRejection(sentence(FIVE), 3000)).toBeNull();
    expect(earTilesRejection(sentence(FIVE, { translation: ' ' }), 3000)).toBe('no-translation');
    expect(earTilesRejection(sentence(FIVE), 12_000)).toBe('clip-too-long');
    expect(earTilesRejection(sentence(FIVE, { japanese: 'あ'.repeat(60) }), 3000)).toBe('too-long');
    expect(
      earTilesRejection(
        sentence([
          ['猫', NOUN],
          ['が', KAKU],
          ['寝る', VERB],
        ]),
        3000,
      ),
    ).toBe('too-few-tiles');
    const many: Piece[] = Array.from({ length: 8 }, (_, i): Piece[] => [
      [`語${i}`, NOUN],
      ['が', KAKU],
    ]).flat();
    expect(earTilesRejection(sentence(many), 3000)).toBe('too-many-tiles');
    expect(earTilesRejection(sentence([['猫', NOUN]], { japanese: '犬' }), 3000)).toBe('bad-tokens');
  });
});

describe('buildEarTilesPuzzle', () => {
  it('keeps the answer in spoken order and never starts the bank in that order', () => {
    for (let n = 0; n < 40; n += 1) {
      const puzzle = buildEarTilesPuzzle(sentence(FIVE), { seed: `seed-${n}` })!;
      expect(puzzle.answer).toEqual(['今日は', '友達と', '公園で', '遊びました']);
      expect([...puzzle.bank.map((t) => t.text)].sort()).toEqual([...puzzle.answer].sort());
      expect(puzzle.bank.map((t) => t.text)).not.toEqual(puzzle.answer);
    }
  });

  it('is deterministic for a seed and null for an untileable sentence', () => {
    const a = buildEarTilesPuzzle(sentence(FIVE), { seed: 'x' })!;
    const b = buildEarTilesPuzzle(sentence(FIVE), { seed: 'x' })!;
    expect(a.bank).toEqual(b.bank);
    expect(buildEarTilesPuzzle({ id: 's', japanese: '猫', vocabularySuggestions: [] }, { seed: 'x' })).toBeNull();
  });
});

describe('scoring', () => {
  const puzzle = { answer: ['今日は', '友達と', '公園で', '遊びました'] };

  it('judges by text, so a repeated phrase is interchangeable', () => {
    const repeated = { answer: ['はい', 'はい', 'ね'] };
    expect(isCorrectTile(repeated, 0, 'はい')).toBe(true);
    expect(isCorrectTile(repeated, 1, 'はい')).toBe(true);
    expect(isCorrectTile(repeated, 2, 'はい')).toBe(false);
  });

  it('counts down live: one point per tile, minus wrong taps and a translation peek, never below 0', () => {
    expect(earTilesPointsAvailable(4, 0, false)).toBe(4);
    expect(earTilesPointsAvailable(4, 1, false)).toBe(3);
    expect(earTilesPointsAvailable(4, 1, true)).toBe(2);
    expect(earTilesPointsAvailable(4, 9, true)).toBe(0);
  });

  it('scores a finished sentence and flags only a fully clean one', () => {
    const clean = scoreEarTiles(puzzle, [[], [], [], []], false);
    expect(clean).toMatchObject({ points: 4, maxPoints: 4, wrongCount: 0, clean: true });

    const messy = scoreEarTiles(puzzle, [[], ['公園で'], [], []], false);
    expect(messy).toMatchObject({ points: 3, wrongCount: 1, clean: false });
    expect(messy.wrongTries[1]).toEqual(['公園で']);

    const peeked = scoreEarTiles(puzzle, [[], [], [], []], true);
    expect(peeked).toMatchObject({ points: 3, wrongCount: 0, clean: false });
  });

  it('describes why a sentence was picked', () => {
    expect(describeEarTilesPick('weak', ['猫', '犬'])).toContain('猫・犬');
    expect(describeEarTilesPick('weak', [])).toBe('From your confirmed sentences.');
    expect(describeEarTilesPick('strong', [])).toContain('solidly');
  });
});
