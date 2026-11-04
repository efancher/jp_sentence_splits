import { describe, expect, it } from 'vitest';
import { buildListeningAttempts, earTilesOutcome, earTilesTargetKey, nextListeningAttempt, summarizeListening } from './listeningEvidence';

const DAY = 86_400_000;
const t = (day: number) => new Date(Date.UTC(2026, 10, day)).toISOString();

const studyItems = [
  { id: 'i_tiles', subjectType: 'sentence' as const, subjectId: 's1', activityType: 'ear_tiles' },
  { id: 'i_dict', subjectType: 'sentence' as const, subjectId: 's1', activityType: 'dictation_tile:2' },
  { id: 'i_read', subjectType: 'sentence' as const, subjectId: 's1', activityType: 'reading_in_context' },
  { id: 'i_word', subjectType: 'vocabularyItem' as const, subjectId: 'w1', activityType: 'ear_tiles' },
];

describe('earTilesOutcome', () => {
  it('grades a round by its slips', () => {
    expect([0, 1, 2, 3].map(earTilesOutcome)).toEqual(['got_it', 'close', 'close', 'needed_help']);
  });
});

describe('buildListeningAttempts', () => {
  const attempts = buildListeningAttempts({
    studyItems,
    reviews: [
      { studyItemId: 'i_tiles', timestamp: t(2), rating: 'good' },
      { studyItemId: 'i_dict', timestamp: t(3), rating: 'again', contextSentenceId: 's9' },
      { studyItemId: 'i_read', timestamp: t(3), rating: 'good' }, // not a listening card
      { studyItemId: 'i_word', timestamp: t(3), rating: 'good' }, // not a sentence subject
    ],
    learningEvents: [
      { sentenceId: 's1', timestamp: t(4), action: 'target_practice', target: { kind: 'expression', key: 'dictation:s1:0', label: 'x' }, outcome: 'needed_help' },
      { sentenceId: 's1', timestamp: t(1), action: 'target_practice', target: { kind: 'expression', key: earTilesTargetKey('s1'), label: 'Ear tiles' }, outcome: 'close' },
      { sentenceId: 's1', timestamp: t(5), action: 'target_practice', target: { kind: 'vocabulary', key: 'vocab:w1', label: 'w' }, outcome: 'got_it' }, // a word check
      { sentenceId: 's1', timestamp: t(5), action: 'gist_check', outcome: 'got_it' },
    ],
  });

  it('collects review cards and reader results oldest first, ignoring everything else', () => {
    expect(attempts.map((a) => [a.source, a.sentenceId, a.success, a.close])).toEqual([
      ['ear_tiles', 's1', false, true],
      ['review', 's1', true, false],
      ['review', 's9', false, false],
      ['dictation', 's1', false, false],
    ]);
  });

  it('rolls attempts up per sentence', () => {
    const summary = summarizeListening(attempts);
    expect(summary.get('s1')).toEqual({ attempts: 3, successes: 1, lastAt: Date.parse(t(4)), lastSuccess: false });
    expect(summary.get('s9')).toMatchObject({ attempts: 1, successes: 0 });
  });

  it('finds the next attempt within the window only', () => {
    const after = Date.parse(t(1));
    expect(nextListeningAttempt(attempts, 's1', after)?.source).toBe('review');
    expect(nextListeningAttempt(attempts, 's1', Date.parse(t(4)))).toBeNull();
    expect(nextListeningAttempt(attempts, 's1', after, 0.5)).toBeNull();
    expect(nextListeningAttempt(attempts, 's2', after)).toBeNull();
    expect(DAY).toBe(86_400_000);
  });
});
