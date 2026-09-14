import { type RefObject, useEffect, useRef, useState } from 'react';

import { nativeAudioController } from '../lib/nativeAudio';
import { PlaybackCoordinator, type TimeRangeMs } from '../lib/recording';

export interface RangeLoop {
  audioElRef: RefObject<HTMLAudioElement | null>;
  objectUrl: string | null;
  isLooping: boolean;
  playbackError: string | null;
  speed: number;
  setSpeed: (speed: number) => void;
  toggleLoop: (range: TimeRangeMs) => Promise<void>;
  cancel: () => void;
}

/**
 * Loops an arbitrary time range of a `SentenceAudio` blob via a local
 * `<audio>` element + `PlaybackCoordinator` (pitch-preserving speed control),
 * not the `nativeAudioController` singleton — that has no range support.
 * Starting a loop stops the singleton so a whole-sentence play and a word
 * loop can't overlap.
 *
 * Extracted from `SegmentLoopPlayer` so multiple independent loop controls
 * can each own their own `<audio>`/coordinator over the same blob (e.g. the
 * pitch warm-up's word-alone and word+particle clips). `toggleLoop` retries
 * once off a freshly refetched blob when the initial `play()` fails —
 * Safari's IndexedDB occasionally hands back a Blob that looks intact
 * locally but won't actually decode (WebKitBlobResource error), which
 * previously left the loop button looking inert with zero feedback (user
 * report card_issue_ed8e9e5e, 2026-09-11). The retry sets the `<audio>`
 * element's `src` directly on a temporary object URL rather than going
 * through the objectUrl state, since that would re-trigger the objectUrl
 * effect's cleanup mid-playback and cancel the very retry it's attempting.
 */
export function useRangeLoop(audioId: string, blob: Blob | null): RangeLoop {
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const coordinatorRef = useRef(new PlaybackCoordinator());
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  useEffect(() => {
    const coordinator = coordinatorRef.current;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => {
      coordinator.cancel();
      URL.revokeObjectURL(url);
      setObjectUrl(null);
    };
  }, [blob]);

  function cancel() {
    coordinatorRef.current.cancel();
    setIsLooping(false);
  }

  async function toggleLoop(range: TimeRangeMs) {
    if (isLooping) {
      cancel();
      return;
    }
    const el = audioElRef.current;
    if (!el) return;
    nativeAudioController.stop();
    setIsLooping(true);
    setPlaybackError(null);
    try {
      await coordinatorRef.current.loopRange(el, range, speed);
    } catch {
      const { repairSentenceAudio } = await import('../sync/audioSync');
      const freshBlob = await repairSentenceAudio(audioId);
      if (!freshBlob) {
        setPlaybackError('Unable to play this word on this device.');
      } else {
        const retryUrl = URL.createObjectURL(freshBlob);
        el.src = retryUrl;
        try {
          await coordinatorRef.current.loopRange(el, range, speed);
        } catch {
          setPlaybackError('Unable to play this word on this device.');
        } finally {
          URL.revokeObjectURL(retryUrl);
          el.src = objectUrl ?? '';
        }
      }
    } finally {
      setIsLooping(false);
    }
  }

  return { audioElRef, objectUrl, isLooping, playbackError, speed, setSpeed, toggleLoop, cancel };
}
