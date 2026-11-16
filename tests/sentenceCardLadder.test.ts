import { describe, expect, it } from 'vitest';

import type { StudyItem } from '../src/domain/types';
import {
  buildSentenceLadderRows,
  countLadderStages,
  filterSentenceLadderRows,
  ladderStageOf,
} from '../src/lib/sentenceCardLadder';

const NOW = '2026-11-16T12:00:00.000Z';

function card(subjectId: string, activityType: string, due: string, lapses = 0): StudyItem {
  return {
    id: `${subjectId}:${activityType}`,
    subjectType: 'sentence',
    subjectId,
    activityType,
    fsrsState: {
      due,
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 0,
      reps: 1,
      lapses,
      state: 'review',
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('ladderStageOf', () => {
  it('maps sentence cards to stages and leaves other cards out', () => {
    expect(ladderStageOf('reading_in_context')).toBe('read');
    expect(ladderStageOf('listening')).toBe('listening');
    expect(ladderStageOf('ear_tiles')).toBe('ear_tiles');
    expect(ladderStageOf('dictation_tile:2')).toBe('dictation');
    expect(ladderStageOf('dictation')).toBe('dictation');
    expect(ladderStageOf('reading_retrieval')).toBeNull();
    expect(ladderStageOf('pitch_accent')).toBeNull();
  });
});

describe('buildSentenceLadderRows', () => {
  it('groups cards by sentence, ignoring retired drills, non-sentence subjects and unmet sentences', () => {
    const items = [
      card('a', 'reading_in_context', '2026-11-10T00:00:00.000Z', 1),
      card('a', 'dictation_tile:2', '2026-11-20T00:00:00.000Z'),
      card('a', 'dictation_tile:0', '2026-11-18T00:00:00.000Z', 2),
      card('a', 'cloze', '2026-11-01T00:00:00.000Z'),
      { ...card('a', 'pitch_accent', '2026-11-01T00:00:00.000Z'), subjectType: 'sentenceVocabulary' as const },
      card('unmet', 'reading_in_context', '2026-11-01T00:00:00.000Z'),
    ];
    const [a, b] = buildSentenceLadderRows(['a', 'b'], items, NOW);
    expect(a!.stages.read).toHaveLength(1);
    expect(a!.stages.dictation.map((item) => item.activityType)).toEqual(['dictation_tile:0', 'dictation_tile:2']);
    expect(a!.nextDue).toBe('2026-11-10T00:00:00.000Z');
    expect(a!.dueNowCount).toBe(1);
    expect(a!.lapses).toBe(3);
    expect(b).toMatchObject({ sentenceId: 'b', dueNowCount: 0, lapses: 0 });
    expect(b!.nextDue).toBeUndefined();
  });
});

describe('filterSentenceLadderRows and countLadderStages', () => {
  const rows = buildSentenceLadderRows(
    ['soon', 'later', 'none', 'lapsed'],
    [
      card('soon', 'reading_in_context', '2026-11-15T00:00:00.000Z'),
      card('later', 'reading_in_context', '2026-12-01T00:00:00.000Z'),
      card('later', 'ear_tiles', '2026-11-16T00:00:00.000Z'),
      card('lapsed', 'reading_in_context', '2026-11-30T00:00:00.000Z', 4),
    ],
    NOW,
  );

  it('orders each filter', () => {
    expect(filterSentenceLadderRows(rows, 'due').map((row) => row.sentenceId)).toEqual(['soon', 'later']);
    expect(filterSentenceLadderRows(rows, 'lapsed').map((row) => row.sentenceId)).toEqual(['lapsed']);
    expect(filterSentenceLadderRows(rows, 'all').map((row) => row.sentenceId)).toEqual(['soon', 'later', 'lapsed', 'none']);
  });

  it('counts sentences reached and cards due per stage', () => {
    expect(countLadderStages(rows, NOW)).toEqual([
      { stage: 'read', sentences: 3, due: 1 },
      { stage: 'listening', sentences: 0, due: 0 },
      { stage: 'ear_tiles', sentences: 1, due: 1 },
      { stage: 'dictation', sentences: 0, due: 0 },
    ]);
  });
});
