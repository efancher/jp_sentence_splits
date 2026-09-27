import { describe, expect, it } from 'vitest';

import type { GameRound } from '../src/domain/types';
import {
  buildSpeakerMatchCandidates,
  buildSpeakerMatchHistory,
  buildSpeakerMatchRound,
  describeSpeakerMatchPick,
  speakerMatchKey,
  speakerMatchStats,
  type SpeakerMatchComparison,
  type SpeakerMatchOccurrence,
} from '../src/lib/speakerMatch';

interface Clip extends SpeakerMatchOccurrence {
  id: string;
}

function clip(bookId: string, bookTitle: string): Clip {
  return { id: `${bookId}-clip`, bookId, bookTitle };
}

function comparison(
  vocabularyItemId: string,
  clips: Clip[],
): SpeakerMatchComparison<Clip> {
  return {
    word: { vocabularyItemId, expression: '猫', reading: 'ねこ', meaning: 'cat', position: 1 },
    clips,
  };
}

describe('buildSpeakerMatchCandidates', () => {
  it('keeps only comparisons with 2+ clips', () => {
    const candidates = buildSpeakerMatchCandidates(
      [comparison('vi-1', [clip('b1', 'Book A'), clip('b2', 'Book B')]), comparison('vi-2', [clip('b1', 'Book A')])],
      new Map(),
    );
    expect(candidates.map((c) => c.id)).toEqual(['vi-1']);
  });
});

describe('buildSpeakerMatchRound', () => {
  it('builds one trial per candidate from its fixed two-clip pair', () => {
    const a = clip('b1', 'Book A');
    const b = clip('b2', 'Book B');
    const trials = buildSpeakerMatchRound([comparison('vi-1', [a, b])], 5);
    expect(trials).toEqual([{ word: comparison('vi-1', [a, b]).word, a, b }]);
  });

  it('caps at `size` and skips a comparison with fewer than 2 clips', () => {
    const pair = [clip('b1', 'Book A'), clip('b2', 'Book B')];
    const trials = buildSpeakerMatchRound(
      [comparison('vi-1', pair), comparison('vi-2', [clip('b1', 'Book A')]), comparison('vi-3', pair)],
      1,
    );
    expect(trials).toHaveLength(1);
    expect(trials[0]!.word.vocabularyItemId).toBe('vi-1');
  });
});

describe('history and stats', () => {
  const rounds: GameRound[] = [
    {
      id: 'r1',
      timestamp: '2026-09-27T00:00:00Z',
      gameId: 'speaker-match',
      signal: 'weak',
      poolSize: 3,
      items: [
        { ref: 'vi-1', correct: false, cluesUsed: 0, wrongGuesses: 1, points: 0, ms: 100, parts: [{ key: 'vi-1', correct: false }] },
        { ref: 'vi-1', correct: true, cluesUsed: 0, wrongGuesses: 0, points: 1, ms: 100, parts: [{ key: 'vi-1', correct: true }] },
      ],
    },
  ];

  it('summarizes attempts/misses per word from recent rounds only', () => {
    const history = buildSpeakerMatchHistory(rounds);
    expect(history.get('vi-1')).toEqual({ attempts: 2, misses: 1 });
    expect(history.get('vi-2')).toBeUndefined();
  });

  it('maps history onto PickerStats: lapses=misses, retrievability=accuracy', () => {
    const history = buildSpeakerMatchHistory(rounds);
    const word = { vocabularyItemId: 'vi-1' };
    expect(speakerMatchStats(word, history)).toEqual({
      hasCard: true,
      lapses: 1,
      retrievability: 0.5,
      matureCards: false,
    });
    expect(speakerMatchStats({ vocabularyItemId: 'vi-9' }, history)).toEqual({
      hasCard: false,
      lapses: 0,
      retrievability: null,
      matureCards: false,
    });
  });
});

describe('describeSpeakerMatchPick', () => {
  const word = { vocabularyItemId: 'vi-1', expression: '猫', reading: 'ねこ', meaning: 'cat', position: 1 };

  it('names the past misses for a weak pick', () => {
    const history = new Map([[speakerMatchKey(word), { attempts: 3, misses: 2 }]]);
    expect(describeSpeakerMatchPick('weak', word, history)).toContain('2 misses');
  });

  it('falls back to a neutral description with no history', () => {
    expect(describeSpeakerMatchPick('any', word, new Map())).toContain('猫');
  });
});
