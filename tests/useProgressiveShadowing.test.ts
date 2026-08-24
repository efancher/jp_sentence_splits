import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  initProgressiveShadowingState,
  progressiveShadowingReducer,
  PROGRESSIVE_STAGES,
  useProgressiveShadowing,
} from '../src/hooks/useProgressiveShadowing';

describe('progressiveShadowingReducer', () => {
  it('advances listen -> repeat -> delayed -> close -> compare and stays on compare', () => {
    let state = initProgressiveShadowingState();
    expect(PROGRESSIVE_STAGES[state.stageIndex]).toBe('listen');

    for (const expected of ['repeat', 'delayed', 'close', 'compare']) {
      state = progressiveShadowingReducer(state, { type: 'advance' });
      expect(PROGRESSIVE_STAGES[state.stageIndex]).toBe(expected);
    }

    // Advancing past the last stage is a no-op on the index (the panel's
    // "Done" exits guided mode entirely, handled outside the reducer).
    state = progressiveShadowingReducer(state, { type: 'advance' });
    expect(PROGRESSIVE_STAGES[state.stageIndex]).toBe('compare');
  });

  it('previous steps back and does not go below listen', () => {
    let state = initProgressiveShadowingState();
    state = progressiveShadowingReducer(state, { type: 'advance' });
    state = progressiveShadowingReducer(state, { type: 'advance' });
    expect(PROGRESSIVE_STAGES[state.stageIndex]).toBe('delayed');

    state = progressiveShadowingReducer(state, { type: 'previous' });
    expect(PROGRESSIVE_STAGES[state.stageIndex]).toBe('repeat');

    state = progressiveShadowingReducer(state, { type: 'previous' });
    state = progressiveShadowingReducer(state, { type: 'previous' });
    expect(PROGRESSIVE_STAGES[state.stageIndex]).toBe('listen');
  });

  it('advance and previous clear the ephemeral take', () => {
    const blob = new Blob(['x'], { type: 'audio/webm' });
    let state = initProgressiveShadowingState();
    state = progressiveShadowingReducer(state, {
      type: 'setEphemeralTake',
      take: { blob, durationMs: 1200 },
    });
    expect(state.ephemeralTake).not.toBeNull();

    state = progressiveShadowingReducer(state, { type: 'advance' });
    expect(state.ephemeralTake).toBeNull();

    state = progressiveShadowingReducer(state, {
      type: 'setEphemeralTake',
      take: { blob, durationMs: 1200 },
    });
    state = progressiveShadowingReducer(state, { type: 'previous' });
    expect(state.ephemeralTake).toBeNull();
  });

  it('retry clears only the ephemeral take, keeping the current stage', () => {
    const blob = new Blob(['x'], { type: 'audio/webm' });
    let state = initProgressiveShadowingState();
    state = progressiveShadowingReducer(state, { type: 'advance' });
    state = progressiveShadowingReducer(state, {
      type: 'setEphemeralTake',
      take: { blob, durationMs: 900 },
    });

    state = progressiveShadowingReducer(state, { type: 'retry' });
    expect(PROGRESSIVE_STAGES[state.stageIndex]).toBe('repeat');
    expect(state.ephemeralTake).toBeNull();
  });

  it('restart resets stage, ephemeral take, final attempt, and mints a new session id', () => {
    const blob = new Blob(['x'], { type: 'audio/webm' });
    let state = initProgressiveShadowingState();
    const firstSessionId = state.sessionId;
    state = progressiveShadowingReducer(state, { type: 'advance' });
    state = progressiveShadowingReducer(state, { type: 'advance' });
    state = progressiveShadowingReducer(state, {
      type: 'setEphemeralTake',
      take: { blob, durationMs: 900 },
    });
    state = progressiveShadowingReducer(state, { type: 'setFinalAttempt', attemptId: 'attempt-1' });

    state = progressiveShadowingReducer(state, { type: 'restart' });
    expect(PROGRESSIVE_STAGES[state.stageIndex]).toBe('listen');
    expect(state.ephemeralTake).toBeNull();
    expect(state.finalAttemptId).toBeNull();
    expect(state.sessionId).not.toBe(firstSessionId);
  });

  it('setFinalAttempt records the saved final attempt id', () => {
    let state = initProgressiveShadowingState();
    state = progressiveShadowingReducer(state, { type: 'setFinalAttempt', attemptId: 'attempt-1' });
    expect(state.finalAttemptId).toBe('attempt-1');
  });
});

describe('useProgressiveShadowing', () => {
  it('restarts automatically when resetKey changes (segment/sentence change)', () => {
    const { result, rerender } = renderHook(
      ({ resetKey }: { resetKey: string }) => useProgressiveShadowing(resetKey),
      { initialProps: { resetKey: 'sentence-1:full' } },
    );

    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.stage).toBe('delayed');
    const firstSessionId = result.current.sessionId;

    rerender({ resetKey: 'sentence-1:0-3000' });
    expect(result.current.stage).toBe('listen');
    expect(result.current.sessionId).not.toBe(firstSessionId);
  });

  it('does not restart when resetKey is unchanged across rerenders', () => {
    const { result, rerender } = renderHook(
      ({ resetKey }: { resetKey: string }) => useProgressiveShadowing(resetKey),
      { initialProps: { resetKey: 'sentence-1:full' } },
    );

    act(() => result.current.next());
    expect(result.current.stage).toBe('repeat');

    rerender({ resetKey: 'sentence-1:full' });
    expect(result.current.stage).toBe('repeat');
  });

  it('skip behaves like next (advances a stage, clears ephemeral take)', () => {
    const { result } = renderHook(() => useProgressiveShadowing('sentence-1:full'));
    const blob = new Blob(['x'], { type: 'audio/webm' });

    act(() => result.current.setEphemeralTake({ blob, durationMs: 500 }));
    expect(result.current.ephemeralTake).not.toBeNull();

    act(() => result.current.skip());
    expect(result.current.stage).toBe('repeat');
    expect(result.current.ephemeralTake).toBeNull();
  });

  it('exposes isFirstStage/isLastStage correctly', () => {
    const { result } = renderHook(() => useProgressiveShadowing('sentence-1:full'));
    expect(result.current.isFirstStage).toBe(true);
    expect(result.current.isLastStage).toBe(false);

    act(() => {
      result.current.next();
      result.current.next();
      result.current.next();
      result.current.next();
    });
    expect(result.current.stage).toBe('compare');
    expect(result.current.isFirstStage).toBe(false);
    expect(result.current.isLastStage).toBe(true);
  });
});
