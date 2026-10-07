import { describe, expect, it } from 'vitest';

import type { SentenceLearningEvent } from '../src/domain/types';
import { computeSequentialStatus, type SequentialInputSentence } from '../src/lib/sequentialStudy';
import { sentencesDueForFreshTry } from '../src/lib/sentenceJourney';

let n = 0;
const ev = (sentenceId: string, action: SentenceLearningEvent['action'], timestamp: string, extra: Partial<SentenceLearningEvent> = {}): SentenceLearningEvent => ({
  id: `e${n++}`, timestamp, visitId: 'v', action, bookId: 'b', sentenceId, ...extra,
});

describe('sentencesDueForFreshTry', () => {
  const now = new Date('2026-10-20T12:00:00');
  const walk = (id: string, ts: string) => ev(id, 'walkthrough_completed', ts);
  const attempt = (id: string, ts: string) => ev(id, 'expression_attempt', ts, { outcome: 'needed_help', scaffold: 'frame', unitsExpressed: 1, unitsTotal: 2 });

  it('offers a never-tried sentence the day after its walkthrough, not the same day', () => {
    expect(sentencesDueForFreshTry([walk('a', '2026-10-19T10:00:00')], now)).toEqual(['a']);
    expect(sentencesDueForFreshTry([walk('a', '2026-10-20T08:00:00')], now)).toEqual([]);
  });

  it('waits longer after each day with an attempt (1, 3, 7 ...)', () => {
    const base = [walk('a', '2026-10-01T10:00:00')];
    expect(sentencesDueForFreshTry([...base, attempt('a', '2026-10-18T10:00:00')], now)).toEqual([]);
    expect(sentencesDueForFreshTry([...base, attempt('a', '2026-10-17T10:00:00')], now)).toEqual(['a']);
    const twoDays = [...base, attempt('a', '2026-10-05T10:00:00'), attempt('a', '2026-10-15T10:00:00')];
    expect(sentencesDueForFreshTry(twoDays, now)).toEqual([]);
    const spaced = [...base, attempt('a', '2026-10-05T10:00:00'), attempt('a', '2026-10-12T10:00:00')];
    expect(sentencesDueForFreshTry(spaced, now)).toEqual(['a']);
  });

  it('drops a sentence once said without cues', () => {
    const done = ev('a', 'expression_attempt', '2026-10-05T10:00:00', { outcome: 'got_it', scaffold: 'none', unitsExpressed: 2, unitsTotal: 2 });
    expect(sentencesDueForFreshTry([walk('a', '2026-10-01T10:00:00'), done], now)).toEqual([]);
  });
});

describe('episode groups in sequential gating', () => {
  const s = (id: string, position: number, groupId?: string): SequentialInputSentence => ({
    sentenceId: id, position, hasUsableCheck: true, reviews: [], introduced: false, ...(groupId ? { groupId } : {}),
  });

  it('opens the first sentence of every episode but still gates within one', () => {
    const status = computeSequentialStatus([s('a1', 1, 'ep1'), s('a2', 2, 'ep1'), s('b1', 3, 'ep2'), s('b2', 4, 'ep2')]);
    const access = Object.fromEntries(status.sentences.map((x) => [x.sentenceId, x.accessible]));
    expect(access).toEqual({ a1: true, a2: false, b1: true, b2: false });
    expect(status.frontier?.sentenceId).toBe('a2');
    expect(status.gatingSentence?.sentenceId).toBe('a1');
  });

  it('keeps one book-wide sequence without groups', () => {
    const status = computeSequentialStatus([s('a1', 1), s('b1', 2)]);
    expect(status.sentences.map((x) => x.accessible)).toEqual([true, false]);
  });
});
