import { useState } from 'react';

import { setSentenceAudioTrimRange } from '../db/repository';
import type { SentenceAudio } from '../domain/types';
import { useJapaneseSpeech } from '../hooks/useJapaneseSpeech';
import { useNativeAudio } from '../hooks/useNativeAudio';
import type { TimeRangeMs } from '../lib/recording';

import { ZoomedRangeEditor } from './ZoomedRangeEditor';

interface NativeAudioButtonProps {
  audio: SentenceAudio;
  displayLabel?: string;
  /** Called each time playback actually starts (not on stop) — e.g. for assistance tracking. */
  onPlay?: () => void;
  playbackRate?: number;
  /** Hide the "Adjust" trim editor — for tight/repeated layouts (e.g. a list row) that already offer it elsewhere for the same clip. */
  hideAdjust?: boolean;
}

export function NativeAudioButton({
  audio,
  displayLabel = 'Native',
  onPlay,
  playbackRate,
  hideAdjust = false,
}: NativeAudioButtonProps) {
  const native = useNativeAudio();
  const speech = useJapaneseSpeech();
  const active = native.isPlaying && native.activeItemId === audio.id;
  const [editing, setEditing] = useState(false);

  const hasOverride = audio.trimStartMs != null && audio.trimEndMs != null;
  const editRange: TimeRangeMs = hasOverride
    ? { startMs: audio.trimStartMs!, endMs: audio.trimEndMs! }
    : { startMs: 0, endMs: audio.durationMs };
  const canAdjust = !hideAdjust && audio.blob.size > 0 && audio.durationMs > 0;

  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`speak-button${active ? ' speaking' : ''}`}
          aria-label={
            active
              ? 'Stop native sentence recording'
              : `Play native sentence recording from ${audio.sourceTitle}`
          }
          aria-pressed={active}
          onClick={() => {
            if (active) {
              native.stop();
              return;
            }
            speech.stop();
            onPlay?.();
            void native.play(audio, playbackRate);
          }}
        >
          {active ? '🎧 Playing…' : `🎧 ${displayLabel}`}
        </button>
        {canAdjust ? (
          <button type="button" aria-expanded={editing} onClick={() => setEditing((open) => !open)}>
            {editing ? 'Close' : hasOverride ? 'Adjusted' : 'Adjust'}
          </button>
        ) : null}
      </div>
      {canAdjust && editing ? (
        <ZoomedRangeEditor
          blob={audio.blob}
          audioId={audio.id}
          value={editRange}
          hasOverride={hasOverride}
          description="Trim room tone or bleed at the edges of this clip. Every playback of this sentence — including loops — uses this span."
          onSave={(next) => {
            if (active) native.stop();
            void setSentenceAudioTrimRange(audio.id, next);
            setEditing(false);
          }}
          onReset={() => {
            if (active) native.stop();
            void setSentenceAudioTrimRange(audio.id, null);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}
