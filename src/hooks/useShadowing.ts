import { useCallback, useSyncExternalStore } from 'react';

import type { DualEarOptions, RecordingMicMode } from '../lib/recording';
import { shadowingController } from '../lib/shadowing';

export function useShadowing() {
  const snapshot = useSyncExternalStore(
    shadowingController.subscribe,
    shadowingController.getSnapshot,
  );
  const startRecording = useCallback(
    (micMode?: RecordingMicMode) => shadowingController.startRecording(micMode),
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
    ) => shadowingController.playAlternate(referenceEl, attemptEl, attemptId, playbackRate),
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
  return {
    ...snapshot,
    startRecording,
    stopRecording,
    cancelRecording,
    playAlternate,
    playDualEar,
    stopComparison,
  };
}
