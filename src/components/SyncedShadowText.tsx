import { useEffect, useMemo, useState } from 'react';

import {
  getReferenceAlignment,
  getReferencePitchTrack,
  saveReferenceAlignment,
  saveReferencePitchTrack,
} from '../db/repository';
import type { SentenceAudio } from '../domain/types';
import { loadOrComputeAlignment } from '../lib/alignmentCache';
import type { MoraUnit } from '../lib/mora';
import type { PitchAnalysisPayload } from '../lib/pitch';
import { loadOrComputeReferencePitch } from '../lib/referencePitchCache';
import { MeasuredPitchContour } from './MeasuredPitchContour';
import { SentencePitchAccentRow } from './SentencePitchAccentRow';

/** Shadowing pronunciation-feedback Milestone 1 (docs/STATUS.md Phase 9). */
function MoraBreakdown({ units }: { units: MoraUnit[] }) {
  if (units.length === 0) return null;
  return (
    <div className="row mora-row" aria-label="Mora breakdown">
      {units.map((unit) => (
        <span key={unit.index} className="chip jp" data-kind={unit.kind}>
          {unit.text}
        </span>
      ))}
    </div>
  );
}

type AlignedWord = { text: string; start: number; end: number };

/**
 * Word-synced highlighting of the reference-audio transcript during
 * shadowing: as the clip plays, the corresponding slice of both the
 * Japanese sentence and the mora/hiragana row underneath it lights up
 * together. Mirrors KaraokeSentenceText's approach but ticks off the
 * caller's own <audio> element directly (via ref) rather than the global
 * nativeAudioController singleton that component relies on, since
 * shadowing plays reference audio through PlaybackCoordinator/a raw
 * <audio> element, not that controller. Used both at the top of
 * ShadowPage and (compactly, right above the action buttons) inside
 * ProgressiveShadowingPanel's guided stages, so the highlighted text is
 * always close to whichever controls the learner is about to press.
 *
 * The forced aligner's word boundaries are keyed to its own tokenization,
 * which can diverge from `japanese`'s literal characters (dictionary-
 * normalized spellings, re-segmentation) and from the mora sequence's own
 * word boundaries (`inlineReading` is an independently-authored field, not
 * guaranteed to be a lossless re-encoding of `japanese` — production data
 * has diverged, see scripts/fix-numeral-readings.ts). Rather than
 * string-matching across these independently-tokenized representations,
 * position is carried over by character-count proportion: the active
 * word's [start,end) fraction of the alignment's total (non-`<unk>`)
 * transcript length is applied to both `japanese` and the mora sequence to
 * pick the highlighted slice. This is an approximation of the true word
 * boundary, not an exact one, but needs no fragile text-matching and
 * degrades gracefully — worst case the highlighted span is a character or
 * two off.
 */
export function SyncedShadowText({
  audioRef,
  referenceAudio,
  japanese,
  moraUnits,
  sentenceId,
}: {
  audioRef: { current: HTMLAudioElement | null };
  referenceAudio: SentenceAudio | undefined;
  japanese: string;
  moraUnits: MoraUnit[];
  sentenceId?: string;
}) {
  const [words, setWords] = useState<AlignedWord[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [pitchTrack, setPitchTrack] = useState<PitchAnalysisPayload>();

  useEffect(() => {
    let cancelled = false;
    setWords([]);
    setActiveIndex(-1);
    if (!referenceAudio) return;
    void loadOrComputeAlignment(
      referenceAudio.id,
      referenceAudio.blob,
      japanese,
      getReferenceAlignment,
      saveReferenceAlignment,
    ).then((result) => {
      if (cancelled || !result) return;
      setWords(result.words.filter((word) => word.text && word.text !== '<eps>'));
    });
    return () => {
      cancelled = true;
    };
  }, [referenceAudio, japanese]);

  useEffect(() => {
    let cancelled = false;
    setPitchTrack(undefined);
    if (!referenceAudio) return;
    void loadOrComputeReferencePitch(
      referenceAudio.id,
      referenceAudio.blob,
      getReferencePitchTrack,
      saveReferencePitchTrack,
    ).then((payload) => {
      if (!cancelled) setPitchTrack(payload);
    });
    return () => {
      cancelled = true;
    };
  }, [referenceAudio]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || words.length === 0) return;
    const handlePlay = () => setIsPlaying(true);
    const handleStop = () => setIsPlaying(false);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handleStop);
    audio.addEventListener('ended', handleStop);
    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handleStop);
      audio.removeEventListener('ended', handleStop);
    };
  }, [audioRef, words.length]);

  useEffect(() => {
    if (!isPlaying || words.length === 0) {
      setActiveIndex(-1);
      return;
    }
    let frame: number;
    const tick = () => {
      const t = audioRef.current?.currentTime ?? 0;
      const index = words.findIndex((word) => t >= word.start && t < word.end);
      setActiveIndex((prev) => (prev === index ? prev : index));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, words, audioRef]);

  const range = useMemo(() => {
    const activeWord = words[activeIndex];
    if (!activeWord || activeWord.text === '<unk>') return null;
    let before = 0;
    let total = 0;
    words.forEach((word, index) => {
      if (word.text === '<unk>') return;
      if (index < activeIndex) before += word.text.length;
      total += word.text.length;
    });
    if (total === 0) return null;
    return { startFrac: before / total, endFrac: (before + activeWord.text.length) / total };
  }, [words, activeIndex]);

  if (words.length === 0) {
    return (
      <div className="stack" style={{ flex: 1, gap: '0.25rem' }}>
        <div className="jp jp-lg">{japanese}</div>
        <MoraBreakdown units={moraUnits} />
        <SentencePitchAccentRow japanese={japanese} sentenceId={sentenceId} />
        <MeasuredPitchContour payload={pitchTrack} />
      </div>
    );
  }

  const textStart = range ? Math.round(range.startFrac * japanese.length) : -1;
  const textEnd = range ? Math.round(range.endFrac * japanese.length) : -1;
  const moraStart = range ? Math.round(range.startFrac * moraUnits.length) : -1;
  const moraEnd = range ? Math.round(range.endFrac * moraUnits.length) : -1;

  return (
    <div className="stack" style={{ flex: 1, gap: '0.25rem' }}>
      <div className="jp jp-lg">
        {range ? (
          <>
            {japanese.slice(0, textStart)}
            <span className="karaoke-word-active">{japanese.slice(textStart, textEnd)}</span>
            {japanese.slice(textEnd)}
          </>
        ) : (
          japanese
        )}
      </div>
      {moraUnits.length > 0 && (
        <div className="row mora-row" aria-label="Mora breakdown">
          {moraUnits.map((unit) => (
            <span
              key={unit.index}
              className={`chip jp${range && unit.index >= moraStart && unit.index < moraEnd ? ' karaoke-word-active' : ''}`}
              data-kind={unit.kind}
            >
              {unit.text}
            </span>
          ))}
        </div>
      )}
      <SentencePitchAccentRow japanese={japanese} sentenceId={sentenceId} />
    </div>
  );
}
