import { useEffect, useState } from 'react';

import { recutSentenceAudioFromSource } from '../db/repository';
import type { SentenceAudio } from '../domain/types';
import { fetchSourceAudioRange } from '../lib/miningApi';

import { ZoomedRangeEditor } from './ZoomedRangeEditor';

/** Source audio fetched either side of the clip so the edges can be moved outward. */
const EDIT_PAD_MS = 4000;

/**
 * Nudge one sentence's reference-clip boundaries and re-cut it from the
 * pristine YouTube source — the per-sentence timing fix for a mining boundary
 * that's a touch off (e.g. a clipped-off front). Unlike "Re-segment captions"
 * this touches only this one `sentenceAudio` row: no text change, no lost
 * chunk/grammar analysis, no study-progress remap. Needs a `sourceUrl`.
 * Uses the same zoomed edge editor as the clip trim, over a padded source span.
 */
export function SentenceAudioAdjuster({
  audio,
  sourceUrl,
  label = 'Adjust clip',
}: {
  audio: SentenceAudio;
  sourceUrl: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [padded, setPadded] = useState<{ blob: Blob; padStartMs: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState('loading');
    setPadded(null);
    const padStartMs = Math.min(audio.startMs, EDIT_PAD_MS);
    void fetchSourceAudioRange(sourceUrl, audio.startMs - padStartMs, audio.endMs + EDIT_PAD_MS)
      .then((blob) => {
        if (cancelled) return;
        setPadded({ blob, padStartMs });
        setState('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setErrorMsg(error instanceof Error ? error.message : 'Could not load the source audio.');
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open, sourceUrl, audio.startMs, audio.endMs]);

  async function save(range: { startMs: number; endMs: number }) {
    if (!padded) return;
    const base = audio.startMs - padded.padStartMs;
    setState('saving');
    setErrorMsg('');
    try {
      await recutSentenceAudioFromSource(audio.id, {
        startMs: Math.round(base + range.startMs),
        endMs: Math.round(base + range.endMs),
      });
      setOpen(false);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Re-cut failed.');
      setState('error');
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  const cancel = () => setOpen(false);

  return (
    <div className="stack" style={{ gap: '0.4rem', width: '100%' }}>
      {state === 'loading' ? <p className="muted">Loading source audio…</p> : null}
      {state === 'saving' ? <p className="muted">Re-cutting…</p> : null}
      {state === 'error' ? (
        <>
          <p className="muted" style={{ color: 'var(--danger)' }}>{errorMsg}</p>
          <button type="button" onClick={cancel}>Close</button>
        </>
      ) : null}
      {padded && (state === 'ready' || state === 'saving') ? (
        <ZoomedRangeEditor
          blob={padded.blob}
          audioId={audio.id}
          value={{ startMs: padded.padStartMs, endMs: padded.padStartMs + (audio.endMs - audio.startMs) }}
          hasOverride={false}
          description="Move the start or end to recover audio cut off the clip (the waveform includes a few seconds either side), then Save to re-cut this sentence from the original video."
          onSave={(range) => void save(range)}
          onReset={cancel}
          onCancel={cancel}
        />
      ) : null}
    </div>
  );
}
