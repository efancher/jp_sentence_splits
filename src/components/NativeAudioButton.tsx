import { useState } from 'react';

import { reportAudioAlignmentIssue, setSentenceAudioTrimRange } from '../db/repository';
import type { SentenceAudio } from '../domain/types';
import { useJapaneseSpeech } from '../hooks/useJapaneseSpeech';
import { useNativeAudio } from '../hooks/useNativeAudio';
import type { TimeRangeMs } from '../lib/recording';

import { SentenceAudioAdjuster, useClipSourceUrl } from './SentenceAudioAdjuster';
import { ZoomedRangeEditor } from './ZoomedRangeEditor';

interface NativeAudioButtonProps {
  audio: SentenceAudio;
  displayLabel?: string;
  /** Called each time playback actually starts (not on stop) — e.g. for assistance tracking. */
  onPlay?: () => void;
  playbackRate?: number;
  /** Hide the "Adjust" trim editor — for tight/repeated layouts (e.g. a list row) that already offer it elsewhere for the same clip. */
  hideAdjust?: boolean;
  /** Headphone glyph only; accessible name and tooltip still say what it plays. */
  iconOnly?: boolean;
  /** Show a "Loop" toggle; when on, playback repeats until stopped. */
  loopable?: boolean;
  /** Hide the "Report" button that files this clip as misaligned with its text. */
  hideReport?: boolean;
}

export function NativeAudioButton({
  audio,
  displayLabel = 'Native',
  onPlay,
  playbackRate,
  hideAdjust = false,
  iconOnly = false,
  loopable = false,
  hideReport = false,
}: NativeAudioButtonProps) {
  const native = useNativeAudio();
  const speech = useJapaneseSpeech();
  const active = native.isPlaying && native.activeItemId === audio.id;
  const [editing, setEditing] = useState(false);
  const [loop, setLoop] = useState(false);
  const sourceUrl = useClipSourceUrl(audio);
  const [reported, setReported] = useState<'idle' | 'filed' | 'already'>('idle');

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
          title={iconOnly ? (displayLabel === 'Native' ? 'Play native recording' : `Play native recording (${displayLabel})`) : undefined}
          onClick={() => {
            if (active) {
              native.stop();
              return;
            }
            speech.stop();
            onPlay?.();
            void native.play(audio, playbackRate, loop ? { loop: true } : undefined);
          }}
        >
          {iconOnly ? '🎧' : active ? '🎧 Playing…' : `🎧 ${displayLabel}`}
        </button>
        {loopable ? (
          <label>
            <input
              type="checkbox"
              checked={loop}
              onChange={(event) => {
                setLoop(event.target.checked);
                // Changing mode mid-play: stop so the next press starts in the new mode.
                if (active) native.stop();
              }}
            />{' '}
            Loop
          </label>
        ) : null}
        {canAdjust && sourceUrl ? (
          <SentenceAudioAdjuster audio={audio} sourceUrl={sourceUrl} label="Adjust" />
        ) : canAdjust ? (
          <button type="button" aria-expanded={editing} onClick={() => setEditing((open) => !open)}>
            {editing ? 'Close' : hasOverride ? 'Adjusted' : 'Adjust'}
          </button>
        ) : null}
        {!hideReport && audio.sentenceId ? (
          <button
            type="button"
            className="muted"
            disabled={reported !== 'idle'}
            title="Flag this clip: the audio starts/ends off, includes another sentence, or doesn't match the text. Reviewed on the Issues page."
            onClick={() => {
              void reportAudioAlignmentIssue({
                sentenceId: audio.sentenceId,
                diagnostics: {
                  audioId: audio.id,
                  sourceTitle: audio.sourceTitle,
                  sourceUrl: audio.sourceUrl,
                  sourceStartMs: audio.startMs,
                  sourceEndMs: audio.endMs,
                  durationMs: audio.durationMs,
                  trimStartMs: audio.trimStartMs,
                  trimEndMs: audio.trimEndMs,
                  playbackRate,
                },
              }).then((filed) => setReported(filed ? 'filed' : 'already'));
            }}
          >
            {reported === 'filed' ? 'Reported ✓' : reported === 'already' ? 'Already reported' : 'Misaligned?'}
          </button>
        ) : null}
      </div>
      {canAdjust && !sourceUrl && editing ? (
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
