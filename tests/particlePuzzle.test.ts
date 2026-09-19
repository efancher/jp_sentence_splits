import { describe, expect, it } from 'vitest';

import type { GameRound, Sentence, VocabularySuggestion } from '../src/domain/types';
import {
  buildParticleHistory,
  buildParticlePuzzle,
  describeParticlePick,
  findBlankableParticles,
  gradePuzzle,
  isParticlePuzzleEligible,
  missFocus,
  particleSentenceStats,
} from '../src/lib/particlePuzzle';

/** Build a sentence + particle tokens by finding each given particle after `from`. */
function sentence(
  japanese: string,
  particles: { surface: string; pos?: string; at: number }[],
  overrides: Partial<Sentence> = {},
): Pick<Sentence, 'id' | 'japanese' | 'translation' | 'vocabularySuggestions'> {
  const suggestions: VocabularySuggestion[] = particles.map((p, i) => ({
    id: `t${i}`,
    surface: p.surface,
    start: p.at,
    end: p.at + p.surface.length,
    expression: p.surface,
    reading: p.surface,
    pos: p.pos ?? '助詞/格助詞',
    source: 'morphology',
    selectedByDefault: false,
  }));
  return {
    id: 's1',
    japanese,
    translation: 'A translation.',
    vocabularySuggestions: suggestions,
    ...overrides,
  };
}

// 私は猫が魚を食べた。  — は@1 が@3 を@5
const BASIC = sentence('私は猫が魚を食べた。', [
  { surface: 'は', pos: '助詞/係助詞', at: 1 },
  { surface: 'が', at: 3 },
  { surface: 'を', at: 5 },
]);

describe('findBlankableParticles', () => {
  it('returns case and binding particles whose spans match the text', () => {
    expect(findBlankableParticles(BASIC).map((t) => t.surface)).toEqual(['は', 'が', 'を']);
  });

  it('skips の, へ, sentence-final and conjunctive particles, and non-particles', () => {
    const s = sentence('私の猫へ言ったね。', [
      { surface: 'の', at: 1 },
      { surface: 'へ', at: 3 },
      { surface: 'ね', pos: '助詞/終助詞', at: 7 },
      { surface: 'た', pos: '助動詞', at: 6 },
    ]);
    expect(findBlankableParticles(s)).toEqual([]);
  });

  it('skips a token whose stored span does not match the sentence text', () => {
    const s = sentence('私は猫が魚を食べた。', [
      { surface: 'は', pos: '助詞/係助詞', at: 2 }, // wrong offset
      { surface: 'が', at: 3 },
    ]);
    expect(findBlankableParticles(s).map((t) => t.surface)).toEqual(['が']);
  });

  it('drops particles that touch another particle (には, でも style compounds)', () => {
    // ここには猫が  — に@2 は@3 adjacent; が@5 stands alone
    const s = sentence('ここには猫がいる。', [
      { surface: 'に', at: 2 },
      { surface: 'は', pos: '助詞/係助詞', at: 3 },
      { surface: 'が', at: 5 },
    ]);
    expect(findBlankableParticles(s).map((t) => t.surface)).toEqual(['が']);
  });
});

describe('isParticlePuzzleEligible', () => {
  it('needs 2+ blankable particles, a translation, and a reasonable length', () => {
    expect(isParticlePuzzleEligible(BASIC)).toBe(true);
    expect(isParticlePuzzleEligible({ ...BASIC, translation: ' ' })).toBe(false);
    expect(isParticlePuzzleEligible({ ...BASIC, japanese: BASIC.japanese + 'あ'.repeat(60) })).toBe(false);
    expect(
      isParticlePuzzleEligible(sentence('猫が寝る。', [{ surface: 'が', at: 1 }])),
    ).toBe(false);
  });
});

describe('buildParticlePuzzle', () => {
  it('reassembles into the original sentence when every blank gets its answer', () => {
    const puzzle = buildParticlePuzzle(BASIC, { seed: 'a' })!;
    let blankIndex = 0;
    const rebuilt = puzzle.segments
      .map((seg) => (seg.kind === 'text' ? seg.text : puzzle.answers[blankIndex++]!))
      .join('');
    expect(rebuilt).toBe(BASIC.japanese);
    expect(puzzle.answers).toEqual(['は', 'が', 'を']);
  });

  it('shares one bank: every answer once, plus decoys that are not answers', () => {
    const puzzle = buildParticlePuzzle(BASIC, { seed: 'a' })!;
    const texts = puzzle.bank.map((chip) => chip.text);
    for (const answer of puzzle.answers) expect(texts).toContain(answer);
    const decoys = texts.filter((t) => !puzzle.answers.includes(t));
    expect(decoys).toHaveLength(2); // 3 blanks => 2 decoys
    expect(new Set(puzzle.bank.map((c) => c.id)).size).toBe(puzzle.bank.length);
    expect(decoys).not.toContain('へ'); // never offers へ
  });

  it('uses one decoy for a two-blank puzzle', () => {
    const s = sentence('猫が魚を食べた。', [{ surface: 'が', at: 1 }, { surface: 'を', at: 3 }]);
    const puzzle = buildParticlePuzzle(s, { seed: 'a' })!;
    expect(puzzle.bank).toHaveLength(3);
  });

  it('caps blanks at four and prefers particles the learner has missed', () => {
    // 6 blankable particles, non-touching
    const s = sentence('AがBをCにDでEとFも', [
      { surface: 'が', at: 1 },
      { surface: 'を', at: 3 },
      { surface: 'に', at: 5 },
      { surface: 'で', at: 7 },
      { surface: 'と', at: 9 },
      { surface: 'も', at: 11 },
    ]);
    const plain = buildParticlePuzzle(s, { seed: 'x' })!;
    expect(plain.answers).toHaveLength(4);
    const focused = buildParticlePuzzle(s, {
      seed: 'x',
      focus: new Map([['と', 5], ['も', 4]]),
    })!;
    expect(focused.answers).toEqual(expect.arrayContaining(['と', 'も']));
  });

  it('is deterministic for a seed', () => {
    const a = buildParticlePuzzle(BASIC, { seed: 'k' })!;
    const b = buildParticlePuzzle(BASIC, { seed: 'k' })!;
    expect(a).toEqual(b);
  });

  it('returns null with fewer than two blankable particles', () => {
    expect(buildParticlePuzzle(sentence('猫が寝る。', [{ surface: 'が', at: 1 }]), { seed: 'a' })).toBeNull();
  });
});

describe('gradePuzzle', () => {
  it('grades each blank and flags は/が/も swaps as plausible alternatives', () => {
    const graded = gradePuzzle({ answers: ['は', 'を', 'に'] }, ['が', 'を', 'で']);
    expect(graded.correctCount).toBe(1);
    expect(graded.allCorrect).toBe(false);
    expect(graded.blanks[0]).toMatchObject({ correct: false, plausibleAlternative: true });
    expect(graded.blanks[1]).toMatchObject({ correct: true, plausibleAlternative: false });
    expect(graded.blanks[2]).toMatchObject({ correct: false, plausibleAlternative: false });
    expect(gradePuzzle({ answers: ['が'] }, ['が']).allCorrect).toBe(true);
  });
});

describe('history', () => {
  const round = (timestamp: string, parts: { key: string; correct: boolean }[]): GameRound => ({
    id: timestamp,
    timestamp,
    gameId: 'particle-puzzle',
    signal: 'any',
    poolSize: 10,
    items: [{ ref: 's', correct: false, cluesUsed: 0, wrongGuesses: 0, points: 0, ms: 1, parts }],
  });

  it('tallies per-particle attempts and misses, newest rounds only up to the limit', () => {
    const rounds = [
      round('2026-09-01', [{ key: 'は', correct: false }]),
      round('2026-09-02', [{ key: 'は', correct: true }, { key: 'が', correct: false }]),
      round('2026-09-03', [{ key: 'は', correct: true }]),
    ];
    const all = buildParticleHistory(rounds);
    expect(all.get('は')).toEqual({ attempts: 3, misses: 1 });
    expect(all.get('が')).toEqual({ attempts: 1, misses: 1 });
    const recentTwo = buildParticleHistory(rounds, 2); // drops 09-01
    expect(recentTwo.get('は')).toEqual({ attempts: 2, misses: 0 });
    expect(missFocus(all)).toEqual(new Map([['は', 1], ['が', 1]]));
  });

  it('maps a sentence onto picker stats', () => {
    const history = new Map([['は', { attempts: 10, misses: 2 }]]);
    const tokens = [
      { start: 1, end: 2, surface: 'は' },
      { start: 3, end: 4, surface: 'が' },
    ];
    expect(particleSentenceStats(tokens, history)).toEqual({
      hasCard: true,
      lapses: 2,
      retrievability: 0.8,
      matureCards: true,
    });
    expect(particleSentenceStats(tokens, new Map())).toEqual({
      hasCard: false,
      lapses: 0,
      retrievability: null,
      matureCards: false,
    });
  });

  it('explains why a weak sentence was picked', () => {
    const focus = new Map([['は', 3]]);
    expect(describeParticlePick('weak', ['は', 'が'], focus)).toMatch(/は/);
    expect(describeParticlePick('any', ['は'], focus)).toBe('From your confirmed sentences.');
  });
});
