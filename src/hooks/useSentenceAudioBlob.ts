import { useEffect, useState } from 'react';

import type { SentenceAudio } from '../domain/types';

/**
 * A `SentenceAudio` row synced from another device may be metadata-only
 * (blob not downloaded yet) — fetches/repairs the clip before it can be
 * played. Extracted from `SegmentLoopPlayer` for reuse by anything else
 * that needs the raw blob to loop a range of a reference recording.
 */
export function useSentenceAudioBlob(audio: SentenceAudio): Blob | null {
  const [blob, setBlob] = useState<Blob | null>(
    audio.blob && audio.blob.size > 0 ? audio.blob : null,
  );

  useEffect(() => {
    if (blob) return;
    let cancelled = false;
    void import('../sync/audioSync').then(async ({ repairSentenceAudio }) => {
      const fetched = await repairSentenceAudio(audio.id);
      if (!cancelled && fetched) setBlob(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [audio.id, blob]);

  return blob;
}
