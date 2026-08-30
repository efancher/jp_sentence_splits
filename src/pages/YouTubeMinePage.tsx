import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ShadowingPreviewCard } from '../components/ShadowingPreviewCard';
import { getDb } from '../db/repository';
import { displayJapanese, normalizeSentenceKey } from '../lib/normalize';
import {
  clipMiningCue,
  createMiningJob,
  deleteMiningJob,
  fetchCuePreviewAudio,
  fetchMiningClipAudio,
  getMiningJob,
  type MiningCue,
  type MiningJobStatus,
} from '../lib/miningApi';
import {
  buildShadowingPreview,
  type ShadowingAudioDraft,
  type ShadowingImportPreview,
  type ShadowingSentenceInput,
} from '../lib/shadowingImport';

const POLL_INTERVAL_MS = 1500;

type Phase = 'idle' | 'fetching' | 'reviewing' | 'preview';

function formatTimestamp(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(2).padStart(5, '0');
  return `${minutes}:${seconds}`;
}

export function YouTubeMinePage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('idle');
  const [url, setUrl] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<MiningJobStatus | null>(null);
  const [error, setError] = useState('');
  const [cueIndex, setCueIndex] = useState(0);
  const [japaneseText, setJapaneseText] = useState('');
  const [englishText, setEnglishText] = useState('');
  const [generateKana, setGenerateKana] = useState(true);
  const [clipping, setClipping] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  /** How many *following* cues the reviewer has merged into the current one. */
  const [mergedCount, setMergedCount] = useState(0);
  const [confirmed, setConfirmed] = useState<{
    sentences: ShadowingSentenceInput[];
    audio: ShadowingAudioDraft[];
  }>({ sentences: [], audio: [] });
  const [preview, setPreview] = useState<ShadowingImportPreview | null>(null);

  const jobIdRef = useRef<string | null>(null);
  jobIdRef.current = jobId;

  // Best-effort cleanup of the server-side scratch dir if the user
  // navigates away mid-job — the server also sweeps abandoned jobs on a
  // timer, this just avoids leaving it around unnecessarily.
  useEffect(() => {
    return () => {
      if (jobIdRef.current) void deleteMiningJob(jobIdRef.current);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'fetching' || !jobId) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void getMiningJob(jobId).then(
        (status) => {
          if (cancelled) return;
          setJobStatus(status);
          if (status.status === 'ready') {
            setPhase('reviewing');
            setCueIndex(0);
          } else if (status.status === 'error') {
            setError(status.error ?? 'Mining failed');
            setPhase('idle');
          }
        },
        (err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : 'Failed to check job status');
          setPhase('idle');
        },
      );
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, jobId]);

  const cues: MiningCue[] = jobStatus?.cues ?? [];
  const currentCue = cues[cueIndex];
  const throughIndex = cueIndex + mergedCount;
  const lastMergedCue = cues[throughIndex];
  const canMergeNext = throughIndex + 1 < cues.length;

  // Reset the per-cue edit fields (and any pending merge) whenever the cue
  // under review changes.
  useEffect(() => {
    if (!currentCue) return;
    setJapaneseText(currentCue.japanese);
    setEnglishText(currentCue.englishGuess ?? '');
    setMergedCount(0);
  }, [currentCue]);

  // Pull the cue's audio so it can be heard before deciding to keep it —
  // the review step's whole point is catching a mis-transcription by ear.
  // Covers the full span when the reviewer has merged following cues in.
  useEffect(() => {
    if (phase !== 'reviewing' || !jobId || !currentCue) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setPreviewUrl(null);
    setPreviewFailed(false);
    void fetchCuePreviewAudio(jobId, currentCue.index, currentCue.index + mergedCount).then(
      (blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      },
      () => {
        if (!cancelled) setPreviewFailed(true);
      },
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [phase, jobId, currentCue, mergedCount]);

  function mergeNext() {
    const next = cues[throughIndex + 1];
    if (!next) return;
    setJapaneseText((prev) => `${prev.trimEnd()}${next.japanese}`);
    setEnglishText((prev) =>
      next.englishGuess ? `${prev} ${next.englishGuess}`.trim() : prev,
    );
    setMergedCount((c) => c + 1);
  }

  function unmerge() {
    if (mergedCount === 0 || !currentCue) return;
    const to = cueIndex + mergedCount - 1;
    setJapaneseText(
      cues.slice(cueIndex, to + 1).map((c) => c.japanese).join(''),
    );
    setEnglishText(
      cues
        .slice(cueIndex, to + 1)
        .map((c) => c.englishGuess ?? '')
        .filter(Boolean)
        .join(' '),
    );
    setMergedCount((c) => c - 1);
  }

  async function handleStart() {
    setError('');
    setPhase('fetching');
    try {
      const id = await createMiningJob(url.trim());
      setJobId(id);
      setJobStatus(null);
      setConfirmed({ sentences: [], audio: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start mining job');
      setPhase('idle');
    }
  }

  async function finish(withCue?: { sentence: ShadowingSentenceInput; audio: ShadowingAudioDraft }) {
    if (!jobStatus?.source) return;
    const sentences = withCue
      ? [...confirmed.sentences, withCue.sentence]
      : confirmed.sentences;
    const audio = withCue ? [...confirmed.audio, withCue.audio] : confirmed.audio;
    const existing = await getDb().sentences.toArray();
    const nextPreview = buildShadowingPreview(
      {
        id: jobStatus.source.id,
        type: 'youtube',
        url: jobStatus.source.url,
        videoId: jobStatus.source.videoId,
        title: jobStatus.source.title,
        channel: jobStatus.source.channel ?? undefined,
        durationMs: jobStatus.source.durationMs ?? undefined,
      },
      {
        format: 'japanese-shadowing-package',
        version: 2,
        createdAt: new Date().toISOString(),
        generator: { name: 'jp-sentence-splits-youtube-mining', version: '1' },
      },
      sentences,
      audio,
      existing,
    );
    setPreview(nextPreview);
    setPhase('preview');
    if (jobId) void deleteMiningJob(jobId);
  }

  async function handleKeepAndClip() {
    if (!jobId || !currentCue || !japaneseText.trim()) return;
    setClipping(true);
    setError('');
    try {
      const result = await clipMiningCue(jobId, currentCue.index, {
        japanese: japaneseText.trim(),
        english: englishText.trim() || undefined,
        generateKana,
        ...(mergedCount > 0 && lastMergedCue
          ? { startMs: currentCue.startMs, endMs: lastMergedCue.endMs }
          : {}),
      });
      const blob = await fetchMiningClipAudio(jobId, result.sentenceId);
      const japanese = displayJapanese(result.japanese);
      const sentence: ShadowingSentenceInput = {
        id: result.sentenceId,
        japanese: result.japanese,
        reading: result.reading ?? undefined,
        english: result.english ?? undefined,
        startMs: result.startMs,
        endMs: result.endMs,
        tags: [],
        transcriptStatus: result.transcriptStatus,
        tokens: result.tokens ?? undefined,
      };
      const audioDraft: ShadowingAudioDraft = {
        sourceSentenceId: result.sentenceId,
        normalizedKey: normalizeSentenceKey(japanese),
        path: `clips/${result.sentenceId}.m4a`,
        mimeType: result.audio.mimeType,
        durationMs: result.audio.durationMs,
        startMs: result.startMs,
        endMs: result.endMs,
        blob,
      };
      if (throughIndex + 1 >= cues.length) {
        await finish({ sentence, audio: audioDraft });
      } else {
        setConfirmed((prev) => ({
          sentences: [...prev.sentences, sentence],
          audio: [...prev.audio, audioDraft],
        }));
        setCueIndex((index) => index + 1 + mergedCount);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clip sentence');
    } finally {
      setClipping(false);
    }
  }

  function handleSkip() {
    if (throughIndex + 1 >= cues.length) {
      void finish();
    } else {
      setCueIndex((index) => index + 1 + mergedCount);
    }
  }

  function reset() {
    setPhase('idle');
    setUrl('');
    setJobId(null);
    setJobStatus(null);
    setError('');
    setCueIndex(0);
    setConfirmed({ sentences: [], audio: [] });
    setPreview(null);
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Import from YouTube</h2>
        <p className="muted" style={{ margin: 0 }}>
          Paste a YouTube URL. Glossbook downloads the audio and subtitles,
          splits them into sentences, and lets you review each one — with
          its own audio clip — before adding it to a book.
        </p>
        {phase === 'idle' ? (
          <div className="row">
            <input
              style={{ flex: 1 }}
              value={url}
              placeholder="https://www.youtube.com/watch?v=…"
              onChange={(event) => setUrl(event.target.value)}
            />
            <button
              type="button"
              className="primary"
              disabled={!url.trim()}
              onClick={() => void handleStart()}
            >
              Start
            </button>
          </div>
        ) : null}
        {phase === 'fetching' ? (
          <div className="stack">
            <div className="muted">{jobStatus?.stage ?? 'Starting…'}</div>
            <button
              type="button"
              onClick={() => {
                if (jobId) void deleteMiningJob(jobId);
                reset();
              }}
            >
              Cancel
            </button>
          </div>
        ) : null}
        {error ? <div style={{ color: 'var(--danger)' }}>{error}</div> : null}
      </section>

      {phase === 'reviewing' && currentCue ? (
        <section className="panel stack">
          <h3 style={{ margin: 0 }}>
            Cue {cueIndex + 1}
            {mergedCount > 0 ? `–${throughIndex + 1}` : ''} / {cues.length}
          </h3>
          <div className="muted">
            {formatTimestamp(currentCue.startMs)} –{' '}
            {formatTimestamp((lastMergedCue ?? currentCue).endMs)}
            {currentCue.isAuto ? ' · auto captions' : ''}
            {mergedCount > 0 ? ` · ${mergedCount + 1} cues merged` : ''}
          </div>
          {previewUrl ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio controls src={previewUrl} style={{ width: '100%' }} />
          ) : previewFailed ? (
            <div className="muted">Cue audio unavailable.</div>
          ) : (
            <div className="muted">Loading cue audio…</div>
          )}
          {currentCue.lowConfidence ? (
            <div style={{ color: 'var(--warning)' }}>
              ⚠ Low transcription confidence — check this line against the audio.
            </div>
          ) : null}
          <label>
            Japanese
            <textarea
              value={japaneseText}
              rows={2}
              onChange={(event) => setJapaneseText(event.target.value)}
            />
          </label>
          <label>
            English (optional)
            <input
              value={englishText}
              onChange={(event) => setEnglishText(event.target.value)}
            />
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={generateKana}
              onChange={(event) => setGenerateKana(event.target.checked)}
            />
            Generate kana reading
          </label>
          <div className="row">
            <button
              type="button"
              disabled={clipping || !canMergeNext}
              onClick={mergeNext}
              title="Fold the next cue into this one"
            >
              + Merge next
            </button>
            {mergedCount > 0 ? (
              <button type="button" disabled={clipping} onClick={unmerge}>
                Unmerge
              </button>
            ) : null}
          </div>
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={clipping || !japaneseText.trim()}
              onClick={() => void handleKeepAndClip()}
            >
              Keep &amp; clip
            </button>
            <button type="button" disabled={clipping} onClick={handleSkip}>
              Skip
            </button>
            <button
              type="button"
              disabled={clipping || cueIndex === 0}
              onClick={() => setCueIndex((index) => Math.max(0, index - 1))}
            >
              Prev
            </button>
            <button
              type="button"
              disabled={clipping || confirmed.sentences.length === 0}
              onClick={() => void finish()}
            >
              Finish now ({confirmed.sentences.length} kept)
            </button>
          </div>
        </section>
      ) : null}

      {phase === 'preview' && preview ? (
        <section className="panel stack">
          <h3 style={{ margin: 0 }}>Import preview</h3>
          <ShadowingPreviewCard
            preview={preview}
            retentionNote="Native clips are not included in Glossbook JSON backups. Re-mine this video to restore them if needed."
            onImported={(result) => navigate(`/books/${result.bookId}`)}
            onCancel={reset}
          />
        </section>
      ) : null}
    </div>
  );
}
