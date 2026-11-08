import { describe, expect, it } from 'vitest';
import type { ListeningAttempt } from './listeningEvidence';
import { dueListeningTools, type ListeningToolSentence } from './listeningTools';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 10);
const both = (sentenceId: string): ListeningToolSentence => ({ sentenceId, tilesEligible: true, dictateEligible: true });
const attempt = (sentenceId: string, daysAgo: number, success: boolean, source: ListeningAttempt['source'] = 'ear_tiles'): ListeningAttempt => ({
  sentenceId, at: NOW - daysAgo * DAY, source, success, close: false,
});

describe('dueListeningTools', () => {
  it('starts an untried sentence with Dictation, falls back to Ear tiles after a Dictation slip, and keeps Ear tiles for sentences Dictation cannot open on', () => {
    const due = dueListeningTools({
      sentences: [both('new'), both('slipped'), both('after-tiles'), { sentenceId: 'long', tilesEligible: true, dictateEligible: false }],
      attempts: [attempt('slipped', 2, false, 'dictation'), attempt('after-tiles', 8, true)],
      lastReadCheck: new Map(),
      now: NOW,
    });
    expect(Object.fromEntries(due.map((d) => [d.sentenceId, d.tool]))).toEqual({
      new: 'dictate', slipped: 'tiles', 'after-tiles': 'dictate', long: 'tiles',
    });
  });

  it('waits a week after a clean pass and a day after a slip', () => {
    const due = dueListeningTools({
      sentences: [both('clean-3d'), both('clean-8d'), both('slip-12h'), both('slip-2d')],
      attempts: [attempt('clean-3d', 3, true), attempt('clean-8d', 8, true), attempt('slip-12h', 0.5, false), attempt('slip-2d', 2, false)],
      lastReadCheck: new Map(),
      now: NOW,
    });
    expect(due.map((d) => d.sentenceId).sort()).toEqual(['clean-8d', 'slip-2d']);
  });

  it('puts a sentence whose last Read check needed help first, even inside the wait', () => {
    const due = dueListeningTools({
      sentences: [both('plain'), both('struggling')],
      attempts: [attempt('struggling', 3, true)],
      lastReadCheck: new Map([['struggling', { at: NOW - DAY, gotIt: false }]]),
      now: NOW,
    });
    expect(due[0]).toMatchObject({ sentenceId: 'struggling', struggling: true });
    expect(due[0]!.reason).toContain('needed help');
    // Once a listening attempt follows that Read check, it is no longer "struggling".
    const after = dueListeningTools({
      sentences: [both('struggling')],
      attempts: [attempt('struggling', 0.5, true)],
      lastReadCheck: new Map([['struggling', { at: NOW - DAY, gotIt: false }]]),
      now: NOW,
    });
    expect(after).toEqual([]);
  });

  it('uses the one tool a sentence supports, and skips a sentence that supports neither', () => {
    const due = dueListeningTools({
      sentences: [
        { sentenceId: 'dictate-only', tilesEligible: false, dictateEligible: true },
        { sentenceId: 'tiles-only', tilesEligible: true, dictateEligible: false },
        { sentenceId: 'neither', tilesEligible: false, dictateEligible: false },
      ],
      attempts: [attempt('tiles-only', 9, true)],
      lastReadCheck: new Map(),
      now: NOW,
    });
    expect(Object.fromEntries(due.map((d) => [d.sentenceId, d.tool]))).toEqual({ 'dictate-only': 'dictate', 'tiles-only': 'tiles' });
  });
});
