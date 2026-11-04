import { describe, expect, it } from 'vitest';
import type { SentenceLearningEvent } from '../domain/types';
import { buildFollowUpEffect, parseOffer } from './followUpEffect';
import type { ListeningAttempt } from './listeningEvidence';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 1);
const iso = (ms: number) => new Date(ms).toISOString();

let n = 0;
function event(partial: Partial<SentenceLearningEvent> & Pick<SentenceLearningEvent, 'action' | 'timestamp'>): SentenceLearningEvent {
  n += 1;
  return { id: `e${n}`, visitId: `v${n}`, bookId: 'b', sentenceId: 's1', ...partial };
}
const offer = (tool: string, source: string, at: number, extra: Partial<SentenceLearningEvent> = {}) =>
  event({ action: 'follow_up_offer', timestamp: iso(at), target: { kind: 'expression', key: `followup:${tool}:${source}`, label: 'x' }, ...extra });

describe('parseOffer', () => {
  it('reads tool and source, and rejects malformed keys and other actions', () => {
    expect(parseOffer(offer('tiles', 'random', T0))).toMatchObject({ tool: 'tiles', source: 'random', sentenceId: 's1' });
    expect(parseOffer(offer('piano', 'random', T0))).toBeNull();
    expect(parseOffer(offer('tiles', 'coin', T0))).toBeNull();
    expect(parseOffer(event({ action: 'gist_check', timestamp: iso(T0) }))).toBeNull();
  });
});

describe('buildFollowUpEffect', () => {
  it('reports no data without offers', () => {
    expect(buildFollowUpEffect({ events: [event({ action: 'gist_check', timestamp: iso(T0), outcome: 'got_it' })], listening: [] }).hasData).toBe(false);
  });

  it('counts offers, taken, and the next Read check and listening result on the same sentence', () => {
    const taken = offer('tiles', 'random', T0, { visitId: 'v-a' });
    const events = [
      event({ action: 'gist_check', timestamp: iso(T0 - 1000), visitId: 'v-a', outcome: 'needed_help' }), // the check that led to the offer
      taken,
      event({ action: 'target_practice', timestamp: iso(T0 + 60_000), visitId: 'v-a', outcome: 'got_it' }), // the tool, same visit
      event({ action: 'gist_check', timestamp: iso(T0 + 3 * DAY), outcome: 'got_it' }), // next Read check
      event({ action: 'gist_check', timestamp: iso(T0 + 5 * DAY), outcome: 'needed_help' }), // later ones don't count
      offer('tiles', 'random', T0 + 20 * DAY, { sentenceId: 's2' }), // not taken, nothing after
      offer('meaning', 'rule', T0, { sentenceId: 's3' }),
      event({ action: 'gist_check', timestamp: iso(T0 + DAY), sentenceId: 's3', outcome: 'needed_help' }),
      event({ action: 'gist_check', timestamp: iso(T0 + 30 * DAY), sentenceId: 's3', outcome: 'got_it' }), // past the 14-day window
    ];
    const listening: ListeningAttempt[] = [
      { sentenceId: 's1', at: T0 + 30 * 60_000, source: 'ear_tiles', success: true, close: false }, // the same occasion: ignored
      { sentenceId: 's1', at: T0 + 2 * DAY, source: 'review', success: true, close: false },
      { sentenceId: 's1', at: T0 + 4 * DAY, source: 'review', success: false, close: false },
    ];

    const report = buildFollowUpEffect({ events, listening });
    expect(report.totalOffers).toBe(3);
    const tiles = report.rows.find((row) => row.tool === 'tiles' && row.source === 'random')!;
    expect(tiles).toMatchObject({ offers: 2, taken: 1, readNext: 1, readGotIt: 1, listenNext: 1, listenGotIt: 1, aspect: 'listening' });
    const meaning = report.rows.find((row) => row.tool === 'meaning')!;
    expect(meaning).toMatchObject({ source: 'rule', offers: 1, taken: 0, readNext: 1, readGotIt: 0, listenNext: 0 });
    expect(tiles).toMatchObject({ meaningNext: 0, pronNext: 0 });
    // Random rows come first so the fair comparison is on top.
    expect(report.rows.map((row) => row.source)).toEqual(['random', 'rule']);
  });

  it('reads the next Word check and the next self-rated shadow on a later occasion within 7 days', () => {
    const events = [
      offer('shadow', 'random', T0, { visitId: 'v-s' }),
      event({ action: 'target_practice', timestamp: iso(T0 + 60_000), visitId: 'v-s', outcome: 'got_it', target: { kind: 'expression', key: 'shadow:s1', label: 'Shadowing' } }), // same occasion: opened, not an outcome
      event({ action: 'target_practice', timestamp: iso(T0 + 2 * DAY), outcome: 'needed_help', target: { kind: 'vocabulary', key: 'vocab:w1', label: 'w' } }),
      event({ action: 'phrase_shadow', timestamp: iso(T0 + 3 * DAY), outcome: 'got_it', target: { kind: 'expression', key: 'phrase-shadow:w1', label: 'p' } }),
      event({ action: 'target_practice', timestamp: iso(T0 + 10 * DAY), outcome: 'got_it', target: { kind: 'expression', key: 'shadow:s1', label: 'Shadowing' } }), // past the window
    ];
    const row = buildFollowUpEffect({ events, listening: [] }).rows[0]!;
    expect(row).toMatchObject({ tool: 'shadow', aspect: 'pronunciation', offers: 1, taken: 1, meaningNext: 1, meaningGotIt: 0, pronNext: 1, pronGotIt: 1 });
  });
});
