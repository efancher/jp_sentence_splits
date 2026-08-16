import { useCallback, useSyncExternalStore } from 'react';

import type { DualEarOptions, RecordingMicMode, TimeRangeMs } from '../lib/recording';
import { shadowingController, type ShadowReferenceOptions } from '../lib/shadowing';

export function useShadowing() {
  const snapshot = useSyncExternalStore(
    shadowingController.subscribe,
    shadowingController.getSnapshot,
  );
  const startRecording = useCallback(
    (micMode?: RecordingMicMode, shadowReference?: ShadowReferenceOptions) =>
      shadowingController.startRecording(micMode, shadowReference),
    [],
  );
  const stopRecording = useCallback(
    () => shadowingController.stopRecording(),
    [],
  );
  const cancelRecording = useCallback(
    () => shadowingController.cancelRecording(),
    [],
  );
  const playAlternate = useCallback(
    (
      referenceEl: HTMLAudioElement,
      attemptEl: HTMLAudioElement,
      attemptId: string,
      playbackRate?: number,
      referenceRange?: TimeRangeMs,
    ) =>
      shadowingController.playAlternate(
        referenceEl,
        attemptEl,
        attemptId,
        playbackRate,
        referenceRange,
      ),
    [],
  );
  const playDualEar = useCallback(
    (
      referenceBlob: Blob,
      attemptBlob: Blob,
      attemptId: string,
      options?: DualEarOptions,
    ) =>
      shadowingController.playDualEar(referenceBlob, attemptBlob, attemptId, options),
    [],
  );
  const stopComparison = useCallback(
    () => shadowingController.stopComparison(),
    [],
  );
  const getShadowAnalyser = useCallback(
    () => shadowingController.getShadowAnalyser(),
    [],
  );
  const getShadowMediaTime = useCallback(
    () => shadowingController.getShadowMediaTime(),
    [],
  );
  const getShadowSampleRate = useCallback(
    () => shadowingController.getShadowSampleRate(),
    [],
  );
  return {
    ...snapshot,
    startRecording,
    stopRecording,
    cancelRecording,
    playAlternate,
    playDualEar,
    stopComparison,
    getShadowAnalyser,
    getShadowMediaTime,
    getShadowSampleRate,
  };
}
