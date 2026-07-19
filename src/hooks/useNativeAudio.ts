import { useCallback, useSyncExternalStore } from 'react';

import type { SentenceAudio } from '../domain/types';
import { nativeAudioController } from '../lib/nativeAudio';

export function useNativeAudio() {
  const snapshot = useSyncExternalStore(
    nativeAudioController.subscribe,
    nativeAudioController.getSnapshot,
  );
  const play = useCallback(
    (record: SentenceAudio) => nativeAudioController.play(record),
    [],
  );
  const stop = useCallback(() => nativeAudioController.stop(), []);
  return { ...snapshot, play, stop };
}
