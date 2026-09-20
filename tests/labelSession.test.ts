import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearStoredSession,
  DEFAULT_SESSION_SIZE,
  getSessionSize,
  loadStoredSession,
  remainingLinkIds,
  saveStoredSession,
  setSessionSize,
} from '../src/lib/labelSession';

beforeEach(() => window.localStorage.clear());

describe('stored labelling session', () => {
  it('round-trips the plan and clears it', () => {
    saveStoredSession({ mode: 'targeted', linkIds: ['a', 'b'], paused: true, startedAt: 't' });
    expect(loadStoredSession()).toEqual({ mode: 'targeted', linkIds: ['a', 'b'], paused: true, startedAt: 't' });
    clearStoredSession();
    expect(loadStoredSession()).toBeNull();
  });

  it('ignores corrupt or foreign storage instead of throwing', () => {
    window.localStorage.setItem('wordBoundaryLabelSession', 'not json');
    expect(loadStoredSession()).toBeNull();
    window.localStorage.setItem('wordBoundaryLabelSession', JSON.stringify({ mode: 'weird', linkIds: [] }));
    expect(loadStoredSession()).toBeNull();
    window.localStorage.setItem('wordBoundaryLabelSession', JSON.stringify({ mode: 'random', linkIds: ['a', 7, null] }));
    expect(loadStoredSession()?.linkIds).toEqual(['a']);
  });

  it('what is left is the planned items with no label, in order — progress is never stored', () => {
    const session = { mode: 'random' as const, linkIds: ['a', 'b', 'c', 'd'], paused: false, startedAt: '' };
    expect(remainingLinkIds(session, new Set(['b']))).toEqual(['a', 'c', 'd']);
    expect(remainingLinkIds(session, new Set(['a', 'b', 'c', 'd']))).toEqual([]);
  });

  it('remembers the batch size and falls back to the default for anything unexpected', () => {
    expect(getSessionSize()).toBe(DEFAULT_SESSION_SIZE);
    setSessionSize(1);
    expect(getSessionSize()).toBe(1);
    window.localStorage.setItem('wordBoundarySessionSize', '7');
    expect(getSessionSize()).toBe(DEFAULT_SESSION_SIZE);
  });
});
