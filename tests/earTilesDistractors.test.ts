import { describe, expect, it } from 'vitest';

import type { Sentence, VocabularySuggestion } from '../src/domain/types';
import { buildCheckPuzzle, buildEarTilesPuzzle, particleOutcomes } from '../src/lib/earTiles';

type Piece = [surface: string, pos: string, expression?: string];

function sentence(pieces: Piece[]): Pick<Sentence, 'id' | 'japanese' | 'vocabularySuggestions'> {
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
  return { id: 's1', japanese: pieces.map((p) => p[0]).join(''), vocabularySuggestions: suggestions };
}

const NOUN = '名詞/普通名詞/一般';
const KAKU = '助詞/格助詞';
const VERB = '動詞/一般';
const AUX = '助動詞';
const CONJ = '助詞/接続助詞';
const PUNCT = '補助記号/句点';

const SENTENCE: Piece[] = [
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
];

describe('distractor tiles', () => {
  it('adds no distractors unless asked, so the Ear Tiles game is unchanged', () => {
    const puzzle = buildEarTilesPuzzle(sentence(SENTENCE), { seed: 'a' })!;
    expect(puzzle.bank).toHaveLength(4);
    expect(puzzle.bank.every((tile) => !tile.distractor)).toBe(true);
  });

  it('adds the requested fakes, each swapping one particle or ending of a real tile', () => {
    for (let n = 0; n < 20; n += 1) {
      const puzzle = buildEarTilesPuzzle(sentence(SENTENCE), { seed: `d-${n}`, distractors: 2 })!;
      const fakes = puzzle.bank.filter((tile) => tile.distractor);
      expect(fakes).toHaveLength(2);
      expect(puzzle.bank).toHaveLength(6);
      for (const fake of fakes) {
        expect(puzzle.answer).not.toContain(fake.text);
        expect(puzzle.answer).toContain(fake.distractor!.from);
      }
      expect(new Set(fakes.map((f) => f.distractor!.from)).size).toBe(2);
      expect(new Set(fakes.map((f) => f.text)).size).toBe(2);
      expect(new Set(fakes.map((f) => f.distractor!.kind))).toEqual(new Set(['particle', 'ending']));
    }
  });

  it('only swaps endings that attach to any stem, and never touches て-form conjunctions', () => {
    const polite = buildEarTilesPuzzle(
      sentence([
        ['学校', NOUN],
        ['へ', KAKU],
        ['行き', VERB],
        ['まし', AUX],
        ['た', AUX],
      ]),
      { seed: 'x', distractors: 4 },
    )!;
    const texts = polite.bank.map((tile) => tile.text);
    expect(texts).toContain('行きます');
    expect(texts).not.toContain('行きない');

    const te = buildEarTilesPuzzle(
      sentence([
        ['食べ', VERB],
        ['て', CONJ],
        ['寝', VERB],
        ['まし', AUX],
        ['た', AUX],
      ]),
      { seed: 'x', distractors: 4 },
    )!;
    expect(te.bank.some((tile) => tile.distractor?.kind === 'particle')).toBe(false);
  });

  it('keeps the real tiles from landing in spoken order', () => {
    for (let n = 0; n < 40; n += 1) {
      const puzzle = buildEarTilesPuzzle(sentence(SENTENCE), { seed: `o-${n}`, distractors: 2 })!;
      const real = puzzle.bank.filter((tile) => !tile.distractor).map((tile) => tile.text);
      expect(real).not.toEqual(puzzle.answer);
    }
  });

  it('builds a check for 3–8 tiles and refuses shorter sentences', () => {
    expect(buildCheckPuzzle(sentence(SENTENCE), 'v')).not.toBeNull();
    const short = sentence([
      ['猫', NOUN],
      ['が', KAKU],
      ['いる', VERB],
    ]);
    expect(buildCheckPuzzle(short, 'v')).toBeNull();
  });

  it('reports which particle fakes the learner fell for', () => {
    const puzzle = buildEarTilesPuzzle(sentence(SENTENCE), { seed: 'p', distractors: 4 })!;
    const particleFake = puzzle.bank.find((tile) => tile.distractor?.kind === 'particle')!;
    const all = particleOutcomes(puzzle, []);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((o) => !o.fellFor)).toBe(true);
    const fell = particleOutcomes(puzzle, [particleFake.text]).find((o) => o.tile === particleFake.distractor!.from)!;
    expect(fell.fellFor).toBe(true);
    expect(fell.particle).toBe(particleFake.distractor!.particle);
  });
});
