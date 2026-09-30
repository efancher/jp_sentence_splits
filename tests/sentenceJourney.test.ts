import { describe, expect, it } from 'vitest';
import type { SentenceLearningEvent } from '../src/domain/types';
import { buildSentenceJourney } from '../src/lib/sentenceJourney';

let n = 0;
const ev = (over: Partial<SentenceLearningEvent>): SentenceLearningEvent => ({
  id: `e${n++}`, timestamp: '2026-09-01T10:00:00', visitId: 'v', action: 'target_practice', bookId: 'b', sentenceId: 's', ...over,
});
const target = { kind: 'grammar' as const, key: 'g1', label: 'を' };
const base = {
  sentenceId: 's',
  vocabulary: [{ expression: '読む', surface: '読み' }, { expression: '本' }],
  knownExpressions: new Set<string>(),
  structure: [{ key: 'g1', label: 'を' }],
};

describe('buildSentenceJourney', () => {
  it('has no percentage without evidence', () => {
    expect(buildSentenceJourney({ ...base, events: [] }).percent).toBeUndefined();
  });

  it('does not treat an empty inventory as complete', () => {
    const journey = buildSentenceJourney({ ...base, vocabulary: [], structure: [], events: [ev({ action: 'walkthrough_completed' })] });
    expect(journey.provisional).toBe(true);
    expect(journey.stages[1]!.fraction).toBeNull();
    expect(journey.percent).toBe(17);
  });

  it('a revealed-answer practice is supported, never independent', () => {
    const journey = buildSentenceJourney({
      ...base,
      events: [ev({ outcome: 'got_it', support: 'explanation_hidden', target })],
    });
    expect(journey.structure.supported.done).toBe(1);
    expect(journey.structure.independent.done).toBe(0);
  });

  it('masked got-it counts as independent; earlier-review words count as known', () => {
    const journey = buildSentenceJourney({
      ...base,
      knownExpressions: new Set(['本']),
      events: [ev({ outcome: 'got_it', support: 'target_masked', target: { kind: 'vocabulary', key: 'v1', label: '読み' } }), ev({ outcome: 'got_it', support: 'target_masked', target })],
    });
    expect(journey.vocabulary.independent).toEqual({ done: 2, total: 2 });
    expect(journey.structure.independent).toEqual({ done: 1, total: 1 });
    expect(journey.provisional).toBe(false);
  });

  it('gist on the same day adds no independent or retained credit; later days do', () => {
    const walk = ev({ action: 'walkthrough_completed', timestamp: '2026-09-01T10:00:00' });
    const same = buildSentenceJourney({ ...base, events: [walk, ev({ action: 'gist_check', outcome: 'got_it', timestamp: '2026-09-01T11:00:00' })] });
    expect(same.gist.checkedAfterGap).toBe(0);
    const later = buildSentenceJourney({ ...base, events: [walk, ev({ action: 'gist_check', outcome: 'got_it', timestamp: '2026-09-03T11:00:00' })] });
    expect(later.gist.checkedAfterGap).toBe(1);
    expect(later.stages[3]!.fraction).toBe(0);
    const twice = buildSentenceJourney({ ...base, events: [walk,
      ev({ action: 'gist_check', outcome: 'got_it', timestamp: '2026-09-03T11:00:00' }),
      ev({ action: 'gist_check', outcome: 'got_it', timestamp: '2026-09-08T11:00:00' })] });
    expect(twice.stages[3]!.fraction).toBe(1);
  });

  it('cannot reach 100% from understanding alone', () => {
    const events = [ev({ action: 'walkthrough_completed' }),
      ev({ action: 'gist_check', outcome: 'got_it', timestamp: '2026-09-03T11:00:00' }),
      ev({ action: 'gist_check', outcome: 'got_it', timestamp: '2026-09-08T11:00:00' }),
      ev({ outcome: 'got_it', support: 'target_masked', target }),
      ev({ outcome: 'got_it', support: 'target_masked', target: { kind: 'vocabulary', key: 'v', label: '読む' } }),
      ev({ outcome: 'got_it', support: 'target_masked', target: { kind: 'vocabulary', key: 'w', label: '本' } })];
    expect(buildSentenceJourney({ ...base, events }).percent).toBe(67);
  });
});
