import { useEffect, useReducer, useRef } from 'react';

export type ProgressiveStage = 'listen' | 'repeat' | 'delayed' | 'close' | 'compare';

/** Listen -> Pause&Repeat -> Delayed Shadow -> Close Shadow -> Record&Compare (docs/AI_OVERVIEW.md §6). */
export const PROGRESSIVE_STAGES: ProgressiveStage[] = [
  'listen',
  'repeat',
  'delayed',
  'close',
  'compare',
];

export interface EphemeralTake {
  blob: Blob;
  durationMs: number;
}

export interface ProgressiveShadowingState {
  sessionId: string;
  stageIndex: number;
  /** The current stage's unsaved rep, for instant self-playback. Stages 1-4 never reach the attempts table. */
  ephemeralTake: EphemeralTake | null;
  /** Set once the final (Record & Compare) take is saved as a real Attempt. */
  finalAttemptId: string | null;
}

export type ProgressiveShadowingAction =
  | { type: 'advance' }
  | { type: 'previous' }
  | { type: 'retry' }
  | { type: 'restart' }
  | { type: 'setEphemeralTake'; take: EphemeralTake }
  | { type: 'clearEphemeralTake' }
  | { type: 'setFinalAttempt'; attemptId: string };

function newSessionId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function initProgressiveShadowingState(): ProgressiveShadowingState {
  return { sessionId: newSessionId(), stageIndex: 0, ephemeralTake: null, finalAttemptId: null };
}

export function progressiveShadowingReducer(
  state: ProgressiveShadowingState,
  action: ProgressiveShadowingAction,
): ProgressiveShadowingState {
  switch (action.type) {
    case 'advance':
      return {
        ...state,
        stageIndex: Math.min(state.stageIndex + 1, PROGRESSIVE_STAGES.length - 1),
        ephemeralTake: null,
      };
    case 'previous':
      return { ...state, stageIndex: Math.max(state.stageIndex - 1, 0), ephemeralTake: null };
    case 'retry':
      return { ...state, ephemeralTake: null };
    case 'restart':
      return initProgressiveShadowingState();
    case 'setEphemeralTake':
      return { ...state, ephemeralTake: action.take };
    case 'clearEphemeralTake':
      return { ...state, ephemeralTake: null };
    case 'setFinalAttempt':
      return { ...state, finalAttemptId: action.attemptId };
    default:
      return state;
  }
}

/**
 * Page-local orchestration state for the guided/progressive shadowing flow
 * (docs/AI_OVERVIEW.md §6). Deliberately a plain reducer, not a new
 * external-store controller like ShadowingController (src/lib/shadowing.ts)
 * — this only sequences UI stages and tracks the current unsaved rep.
 * Actual recording/playback stays entirely on the existing
 * ShadowingController/useShadowing() and PlaybackCoordinator.
 *
 * `resetKey` should identify "the thing being practiced" (sentence id +
 * selected segment). Changing it starts a fresh session automatically, same
 * as calling `restart()` by hand.
 */
export function useProgressiveShadowing(resetKey: string) {
  const [state, dispatch] = useReducer(
    progressiveShadowingReducer,
    undefined,
    initProgressiveShadowingState,
  );
  const previousResetKey = useRef(resetKey);

  useEffect(() => {
    if (previousResetKey.current !== resetKey) {
      previousResetKey.current = resetKey;
      dispatch({ type: 'restart' });
    }
  }, [resetKey]);

  return {
    stage: PROGRESSIVE_STAGES[state.stageIndex]!,
    stageIndex: state.stageIndex,
    stageCount: PROGRESSIVE_STAGES.length,
    sessionId: state.sessionId,
    ephemeralTake: state.ephemeralTake,
    finalAttemptId: state.finalAttemptId,
    isFirstStage: state.stageIndex === 0,
    isLastStage: state.stageIndex === PROGRESSIVE_STAGES.length - 1,
    next: () => dispatch({ type: 'advance' }),
    skip: () => dispatch({ type: 'advance' }),
    previous: () => dispatch({ type: 'previous' }),
    retryStage: () => dispatch({ type: 'retry' }),
    restart: () => dispatch({ type: 'restart' }),
    setEphemeralTake: (take: EphemeralTake) => dispatch({ type: 'setEphemeralTake', take }),
    clearEphemeralTake: () => dispatch({ type: 'clearEphemeralTake' }),
    setFinalAttempt: (attemptId: string) => dispatch({ type: 'setFinalAttempt', attemptId }),
  };
}
