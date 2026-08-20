import { useEffect, useState } from 'react';

import { getReferenceAlignment, saveReferenceAlignment } from '../db/repository';
import type { SentenceAudio } from '../domain/types';
import { useNativeAudio } from '../hooks/useNativeAudio';
import { loadOrComputeAlignment } from '../lib/alignmentCache';

/**
 * Word-synced highlighting for a revealed sentence, computed lazily from the
 * tailnet-only forced-alignment service and cached via
 * getReferenceAlignment/saveReferenceAlignment (same cache as the shadowing
 * analysis flow) — the first review of a sentence pays the alignment cost,
 * every later one reuses it. Falls back to plain, unhighlighted text
 * whenever alignment isn't available (server unreachable/cold, or not
 * finished loading yet), since it's just a reading aid, not the source of
 * truth for the sentence's text.
 */
export function KaraokeSentenceText({
  audio,
  japanese,
}: {
  audio: SentenceAudio;
  japanese: string;
}) {
  const native = useNativeAudio();
  const [alignmentWords, setAlignmentWords] = useState<
    { text: string; start: number; end: number }[]
  >([]);
  const [activeWordIndex, setActiveWordIndex] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    setAlignmentWords([]);
    void loadOrComputeAlignment(
      audio.id,
      audio.blob,
      japanese,
      getReferenceAlignment,
      saveReferenceAlignment,
    ).then((result) => {
      if (cancelled || !result) return;
      setAlignmentWords(
        result.words.filter((word) => word.text && word.text !== '<eps>'),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [audio.id, audio.blob, japanese]);

  const active = native.isPlaying && native.activeItemId === audio.id;

  useEffect(() => {
    if (!active || alignmentWords.length === 0) {
      setActiveWordIndex(-1);
      return;
    }
    let frame: number;
    const tick = () => {
      const t = native.getCurrentTime();
      const index = alignmentWords.findIndex(
        (word) => t >= word.start && t < word.end,
      );
      setActiveWordIndex((prev) => (prev === index ? prev : index));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, alignmentWords, native.getCurrentTime]);

  if (alignmentWords.length === 0) {
    return <div className="jp jp-lg">{japanese}</div>;
  }

  return (
    <div className="jp jp-lg">
      {alignmentWords.map((word, index) => (
        <span
          key={`${word.text}-${index}`}
          className={`karaoke-word${index === activeWordIndex ? ' karaoke-word-active' : ''}`}
        >
          {word.text}
        </span>
      ))}
    </div>
  );
}
