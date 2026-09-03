import { useState } from 'react';

import { recutSentenceAudioFromSource } from '../db/repository';
import type { SentenceAudio } from '../domain/types';
import { fetchSourceAudioRange, fetchSourceWaveform } from '../lib/miningApi';

import { BoundaryWaveform } from './BoundaryWaveform';

/** Context shown either side of the clip so a nearby pause is visible. */
const EDIT_PAD_MS = 6000;

/**
 * Nudge one sentence's reference-clip boundaries and re-cut it from the
 * pristine YouTube source — the per-sentence timing fix on `AnalyzePage`,
 * for a mining boundary that's a touch off. Unlike "Re-segment captions"
 * this touches only this one `sentenceAudio` row: no text change, no lost
 * chunk/grammar analysis, no study-progress remap. Needs a `sourceUrl`.
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
  const [draft, setDraft] = useState({ startMs: audio.startMs, endMs: audio.endMs });
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const dirty = draft.startMs !== audio.startMs || draft.endMs !== audio.endMs;

  const openEditor = () => {
    setDraft({ startMs: audio.startMs, endMs: audio.endMs });
    setState('idle');
    setOpen(true);
  };

  async function save() {
    setState('saving');
    setErrorMsg('');
    try {
      await recutSentenceAudioFromSource(audio.id, draft);
      setOpen(false); // the useLiveQuery-fed row updates; a reopen re-seeds from it
    } catch (error) {
      setState('error');
      setErrorMsg(error instanceof Error ? error.message : 'Re-cut failed.');
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={openEditor}>
        {label}
      </button>
    );
  }

  return (
    <div className="stack" style={{ gap: '0.4rem', width: '100%' }}>
      <BoundaryWaveform
        key={audio.id}
        startMs={draft.startMs}
        endMs={draft.endMs}
        minStartMs={0}
        maxEndMs={draft.endMs + 3_600_000}
        padStartMs={Math.min(audio.startMs, EDIT_PAD_MS)}
        padEndMs={EDIT_PAD_MS}
        waveformForRange={(s, e) => fetchSourceWaveform(sourceUrl, s, e)}
        audioForRange={(s, e) => fetchSourceAudioRange(sourceUrl, s, e)}
        onStartChange={(ms) => setDraft((d) => ({ ...d, startMs: ms }))}
        onEndChange={(ms) => setDraft((d) => ({ ...d, endMs: ms }))}
        disabled={state === 'saving'}
      />
      <div className="row" style={{ gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="primary"
          disabled={!dirty || state === 'saving'}
          onClick={() => void save()}
        >
          {state === 'saving' ? 'Re-cutting…' : 'Save & re-cut'}
        </button>
        <button
          type="button"
          disabled={state === 'saving'}
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
        {state === 'error' ? (
          <span className="muted" style={{ color: 'var(--danger)' }}>
            {errorMsg}
          </span>
        ) : null}
      </div>
    </div>
  );
}
