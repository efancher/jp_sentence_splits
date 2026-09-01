import { useState } from 'react';

import {
  editTranscriptSegText,
  formatTranscriptForAI,
  mergeTranscriptSegDown,
  parseAiSegmentedTranscript,
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

function AiSegmentHelp({
  segs,
  onSegsChange,
  disabled,
}: {
  segs: WizardTranscriptSeg[];
  onSegsChange: (segs: WizardTranscriptSeg[]) => void;
  disabled: boolean;
}) {
  const [pasted, setPasted] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const prompt = formatTranscriptForAI(segs);
  const fallbackEndMs = segs.length ? Math.max(...segs.map((s) => s.endMs)) : 0;

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus('Copy failed — select the text above and copy it manually.');
    }
  }

  function applyPasted() {
    const next = parseAiSegmentedTranscript(pasted, fallbackEndMs);
    if (next.length === 0) {
      setStatus(
        "Couldn't read any [m:ss] sentence lines from that — paste the assistant's reply as-is.",
      );
      return;
    }
    onSegsChange(next);
    setStatus(`Replaced ${segs.length} fragment(s) with ${next.length} sentence(s).`);
    setPasted('');
  }

  return (
    <details className="panel">
      <summary>Segment with AI help</summary>
      <div className="stack" style={{ marginTop: '0.75rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          When the transcript is choppy and unpunctuated (auto-captions), copy this into
          ChatGPT / Claude, then paste the reply back below.
        </p>
        <textarea readOnly className="jp" rows={6} value={prompt} />
        <div className="row">
          <button type="button" onClick={() => void copyPrompt()}>
            {copied ? 'Copied ✓' : 'Copy prompt'}
          </button>
        </div>
        <textarea
          className="jp"
          rows={5}
          placeholder="Paste the assistant's reply here ([m:ss] sentence per line)…"
          value={pasted}
          disabled={disabled}
          onChange={(event) => setPasted(event.target.value)}
        />
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={disabled || !pasted.trim()}
            onClick={applyPasted}
          >
            Apply pasted sentences
          </button>
        </div>
        {status ? (
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            {status}
          </div>
        ) : null}
      </div>
    </details>
  );
}

export function TranscriptStage({
  segs,
  onSegsChange,
  fetchAudio,
  disabled = false,
}: TranscriptStageProps) {
  return (
    <div className="stack">
      <AiSegmentHelp segs={segs} onSegsChange={onSegsChange} disabled={disabled} />
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
