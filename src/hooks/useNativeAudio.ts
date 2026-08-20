import { useCallback, useSyncExternalStore } from 'react';

import type { SentenceAudio } from '../domain/types';
import { nativeAudioController } from '../lib/nativeAudio';

export function useNativeAudio() {
  const snapshot = useSyncExternalStore(
    nativeAudioController.subscribe,
    nativeAudioController.getSnapshot,
  );
  const play = useCallback(
    (record: SentenceAudio, playbackRate?: number) =>
      nativeAudioController.play(record, playbackRate),
    [],
  );
  const stop = useCallback(() => nativeAudioController.stop(), []);
  const getCurrentTime = useCallback(
    () => nativeAudioController.getCurrentTime(),
    [],
  );
  return { ...snapshot, play, stop, getCurrentTime };
}
