import { describe, expect, it } from 'vitest';
import type { SentenceLearningEvent } from '../src/domain/types';
import { buildSentenceJourney, sentencesReadyToRevisit } from '../src/lib/sentenceJourney';

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

  it('expression: frame attempts are supported only; independent needs no frame and a later day', () => {
    const walk = ev({ action: 'walkthrough_completed', timestamp: '2026-09-01T10:00:00' });
    const attempt = (over: Partial<SentenceLearningEvent>) =>
      ev({ action: 'expression_attempt', outcome: 'got_it', unitsExpressed: 3, unitsTotal: 3, scaffold: 'none', ...over });
    const framed = buildSentenceJourney({ ...base, events: [walk, attempt({ scaffold: 'frame', timestamp: '2026-09-05T10:00:00' })] });
    expect(framed.stages[4]!.fraction).toBe(1);
    expect(framed.stages[5]!.fraction).toBe(0);
    const sameDay = buildSentenceJourney({ ...base, events: [walk, attempt({ timestamp: '2026-09-01T10:30:00' })] });
    expect(sameDay.stages[5]!.fraction).toBe(0);
    const later = buildSentenceJourney({ ...base, events: [walk, attempt({ timestamp: '2026-09-05T10:00:00' })] });
    expect(later.stages[5]!.fraction).toBe(1);
    const partial = buildSentenceJourney({ ...base, events: [walk, attempt({ outcome: 'needed_help', unitsExpressed: 1, timestamp: '2026-09-05T10:00:00' })] });
    expect(partial.stages[4]!.fraction).toBeCloseTo(1 / 3);
    expect(partial.stages[5]!.fraction).toBe(0);
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

describe('sentencesReadyToRevisit', () => {
  const now = new Date('2026-09-10T12:00:00');
  const walk = (sentenceId: string, timestamp: string) => ev({ action: 'walkthrough_completed', sentenceId, timestamp });
  it('suggests earlier-day walkthroughs without an independent attempt, oldest first', () => {
    const events = [
      walk('a', '2026-09-05T10:00:00'), walk('b', '2026-09-02T10:00:00'), walk('today', '2026-09-10T08:00:00'),
      walk('done', '2026-09-01T10:00:00'),
      ev({ action: 'expression_attempt', sentenceId: 'done', outcome: 'got_it', scaffold: 'none', unitsExpressed: 1, unitsTotal: 1 }),
      walk('cued', '2026-09-03T10:00:00'),
      ev({ action: 'expression_attempt', sentenceId: 'cued', outcome: 'got_it', scaffold: 'words', unitsExpressed: 1, unitsTotal: 1 }),
    ];
    expect(sentencesReadyToRevisit(events, now)).toEqual(['b', 'cued', 'a']);
  });
  it('treats a word-bank attempt as supported, not independent', () => {
    const walked = ev({ action: 'walkthrough_completed', timestamp: '2026-09-01T10:00:00' });
    const journey = buildSentenceJourney({ ...base, events: [walked, ev({ action: 'expression_attempt', outcome: 'got_it', scaffold: 'words', unitsExpressed: 2, unitsTotal: 2, timestamp: '2026-09-05T10:00:00' })] });
    expect(journey.stages[5]!.fraction).toBe(0);
  });
});
