import { useState } from 'react';

import { fetchTranscriptDifficulty, type DifficultyScore } from '../lib/miningApi';
import {
  editTranscriptSegText,
  formatTranscriptForAI,
  mergeTranscriptSegDown,
  parseAiSegmentedTranscript,
  splitTranscriptSeg,
  type WizardTranscriptSeg,
} from '../lib/miningTranscript';
import { DifficultyBadge } from './DifficultyBadge';
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
  /**
   * Fired (in addition to onSegsChange) only when "Segment with AI help"
   * replaces the transcript — real 2026-09-13 finding: "Apply & segment"'s
   * default merge/split pass assumes raw, uncurated ASR fragments and
   * re-splits on ANY sentence-final punctuation it finds inside a segment,
   * even one the AI/user deliberately kept merged on purpose (e.g. a bare
   * interjection like "しゃっ！" folded into the next clause rather than
   * left as its own throwaway "sentence"). The parent uses this signal to
   * skip that pass and trust the reviewed boundaries exactly.
   */
  onAiSegmentsApplied?: () => void;
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
  onAiSegmentsApplied,
  disabled,
}: {
  segs: WizardTranscriptSeg[];
  onSegsChange: (segs: WizardTranscriptSeg[]) => void;
  onAiSegmentsApplied?: () => void;
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
    onAiSegmentsApplied?.();
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

function DifficultyCheck({ segs, disabled }: { segs: WizardTranscriptSeg[]; disabled: boolean }) {
  const [score, setScore] = useState<DifficultyScore | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function check() {
    setBusy(true);
    setError('');
    try {
      setScore(await fetchTranscriptDifficulty(segs));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to score difficulty.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          Rough beginner/intermediate/advanced screen — check before spending time on
          segmenting/translating.
        </span>
        <button type="button" disabled={disabled || busy || segs.length === 0} onClick={() => void check()}>
          {busy ? 'Checking…' : 'Check difficulty'}
        </button>
      </div>
      {error ? <div style={{ color: 'var(--danger)' }}>{error}</div> : null}
      {score ? <DifficultyBadge score={score} /> : null}
    </section>
  );
}

export function TranscriptStage({
  segs,
  onSegsChange,
  fetchAudio,
  disabled = false,
  onAiSegmentsApplied,
}: TranscriptStageProps) {
  return (
    <div className="stack">
      <DifficultyCheck segs={segs} disabled={disabled} />
      <AiSegmentHelp
        segs={segs}
        onSegsChange={onSegsChange}
        onAiSegmentsApplied={onAiSegmentsApplied}
        disabled={disabled}
      />
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
                cacheKey={`${seg.startMs}-${seg.endMs}`}
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
