import { describe, expect, it } from 'vitest';

import { buildKeystoneRound, describeKeystonePick, type KeystoneCandidate } from '../src/lib/keystone';

function candidate(id: string, unlockCount: number): KeystoneCandidate {
  return {
    id,
    item: { id, expression: `word-${id}`, reading: `reading-${id}`, meaning: `meaning-${id}` },
    unlockedSentenceIds: Array.from({ length: unlockCount }, (_, i) => `${id}-s${i}`),
    exampleSentence: { id: `${id}-s0`, japanese: `文${id}`, translation: `sentence ${id}` },
    stats: { hasCard: false, lapses: 0, retrievability: null, matureCards: false },
  };
}

describe('buildKeystoneRound', () => {
  it('builds a puzzle per target, each with the requested choice count', () => {
    const candidates = [
      candidate('a', 5),
      candidate('b', 4),
      candidate('c', 3),
      candidate('d', 2),
      candidate('e', 1),
      candidate('f', 1),
    ];
    const round = buildKeystoneRound(candidates, 5, 'seed-1');
    expect(round.poolSize).toBe(6);
    expect(round.puzzles).toHaveLength(5);
    for (const puzzle of round.puzzles) {
      expect(puzzle.choices.length).toBe(4);
      // No duplicate choices within one puzzle.
      expect(new Set(puzzle.choices.map((c) => c.id)).size).toBe(puzzle.choices.length);
    }
  });

  it("picks the choice with the most upcoming sentences as each puzzle's answer", () => {
    const candidates = [candidate('a', 5), candidate('b', 1), candidate('c', 1), candidate('d', 1)];
    const round = buildKeystoneRound(candidates, 1, 'seed-2');
    const puzzle = round.puzzles[0]!;
    const answer = puzzle.choices.find((c) => c.id === puzzle.answerVocabularyItemId)!;
    const maxCount = Math.max(...puzzle.choices.map((c) => c.unlockedSentenceIds.length));
    expect(answer.unlockedSentenceIds.length).toBe(maxCount);
  });

  it('is deterministic for a given seed', () => {
    const candidates = [
      candidate('a', 5),
      candidate('b', 4),
      candidate('c', 3),
      candidate('d', 2),
      candidate('e', 1),
    ];
    const round1 = buildKeystoneRound(candidates, 3, 'same-seed');
    const round2 = buildKeystoneRound(candidates, 3, 'same-seed');
    expect(round1.puzzles.map((p) => p.answerVocabularyItemId)).toEqual(
      round2.puzzles.map((p) => p.answerVocabularyItemId),
    );
  });

  it('falls back to higher/equal-count decoys when there are not enough lower-count candidates', () => {
    // Every candidate ties at count 1 — no candidate has a strictly lower count than another.
    const candidates = [candidate('a', 1), candidate('b', 1), candidate('c', 1), candidate('d', 1)];
    const round = buildKeystoneRound(candidates, 1, 'seed-3');
    expect(round.puzzles).toHaveLength(1);
    expect(round.puzzles[0]!.choices).toHaveLength(4);
  });
});

describe('describeKeystonePick', () => {
  it('reports the unlock count, singular vs. plural', () => {
    expect(describeKeystonePick(candidate('a', 1))).toContain('1 upcoming sentence ');
    expect(describeKeystonePick(candidate('a', 3))).toContain('3 upcoming sentences');
  });
});
