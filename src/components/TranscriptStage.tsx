import {
  editTranscriptSegText,
  mergeTranscriptSegDown,
  splitTranscriptSeg,
  type WizardTranscriptSeg,
} from '../lib/miningTranscript';
import { SpanAudioButton } from './SpanAudioButton';

/**
 * Mining wizard stage 1: correct the ASR/caption transcript against the
 * audio before resegmentation runs. Segment-level edits (text + coarse
 * merge/split); the fine sentence boundaries come next in the segment
 * stage. Each segment plays its own span from the cached source.
 */
interface TranscriptStageProps {
  segs: WizardTranscriptSeg[];
  onSegsChange: (segs: WizardTranscriptSeg[]) => void;
  fetchAudio: (startMs: number, endMs: number) => Promise<Blob>;
  disabled?: boolean;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${seconds}`;
}

export function TranscriptStage({
  segs,
  onSegsChange,
  fetchAudio,
  disabled = false,
}: TranscriptStageProps) {
  return (
    <div className="stack">
      {segs.map((seg, index) => (
        <section className="panel stack" key={index}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">
              #{index + 1} · {formatTimestamp(seg.startMs)}–{formatTimestamp(seg.endMs)}
              {seg.isAuto ? ' · auto' : ''}
              {seg.lowConfidence ? ' · ⚠ low confidence' : ''}
            </span>
            <div className="row">
              <SpanAudioButton
                fetchAudio={() => fetchAudio(seg.startMs, seg.endMs)}
                disabled={disabled}
              />
              <button
                type="button"
                disabled={disabled || index + 1 >= segs.length}
                onClick={() => onSegsChange(mergeTranscriptSegDown(segs, index))}
              >
                Merge next
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSegsChange(splitTranscriptSeg(segs, index))}
              >
                Split by 。
              </button>
            </div>
          </div>
          {seg.lowConfidence ? (
            <div style={{ color: 'var(--warning)' }}>
              ⚠ Low transcription confidence — check this line against the audio.
            </div>
          ) : null}
          <textarea
            className="jp"
            rows={2}
            value={seg.text}
            disabled={disabled}
            onChange={(event) =>
              onSegsChange(editTranscriptSegText(segs, index, event.target.value))
            }
          />
        </section>
      ))}
    </div>
  );
}
