import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { SegmentationEditor } from '../components/SegmentationEditor';
import { ShadowingPreviewCard } from '../components/ShadowingPreviewCard';
import { TranscriptStage } from '../components/TranscriptStage';
import { getDb } from '../db/repository';
import { displayJapanese, normalizeSentenceKey } from '../lib/normalize';
import {
  applyJobSegments,
  clipMiningRange,
  createMiningJob,
  deleteMiningJob,
  fetchJobAudioRange,
  fetchMiningClipAudio,
  getMiningJob,
  translateJob,
  type MiningCue,
  type MiningSourceInfo,
} from '../lib/miningApi';
import type { WizardTranscriptSeg } from '../lib/miningTranscript';
import type { ResegmentReviewRow } from '../lib/resegmentPlan';
import { realignTranslations } from '../lib/sentenceRealign';
import {
  buildShadowingPreview,
  type ShadowingAudioDraft,
  type ShadowingImportPreview,
  type ShadowingSentenceInput,
} from '../lib/shadowingImport';

const POLL_INTERVAL_MS = 1500;

type Stage = 'idle' | 'starting' | 'transcript' | 'segment' | 'translate' | 'commit';

const STAGE_LABELS: { key: Stage; label: string }[] = [
  { key: 'transcript', label: 'Transcript' },
  { key: 'segment', label: 'Segment' },
  { key: 'translate', label: 'Translate' },
  { key: 'commit', label: 'Commit' },
];

const MANIFEST = {
  format: 'japanese-shadowing-package',
  version: 2,
  createdAt: '',
  generator: { name: 'jp-sentence-splits-youtube-mining', version: '2' },
} as const;

function rowsFromCues(cues: MiningCue[]): ResegmentReviewRow[] {
  return cues.map((cue) => ({
    japanese: cue.japanese,
    translation: cue.englishGuess?.trim() ?? '',
    readingOnly: '',
    inlineReading: '',
    tokens: [],
    sourceIndexes: cue.sourceIndexes ?? [cue.index],
    startMs: cue.startMs,
    endMs: cue.endMs,
    sourceTranslations: [],
    needsTranslationReview: !cue.englishGuess?.trim(),
  }));
}

export function YouTubeMinePage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('idle');
  const [url, setUrl] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [source, setSource] = useState<MiningSourceInfo | null>(null);
  const [progress, setProgress] = useState('Starting…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyNote, setBusyNote] = useState('');
  const [transcript, setTranscript] = useState<WizardTranscriptSeg[]>([]);
  const [rows, setRows] = useState<ResegmentReviewRow[]>([]);
  const [realignNote, setRealignNote] = useState('');
  const [preview, setPreview] = useState<ShadowingImportPreview | null>(null);

  const jobIdRef = useRef<string | null>(null);
  jobIdRef.current = jobId;

  // Best-effort cleanup of the server-side job if the user navigates away.
  useEffect(() => {
    return () => {
      if (jobIdRef.current) void deleteMiningJob(jobIdRef.current);
    };
  }, []);

  useEffect(() => {
    if (stage !== 'starting' || !jobId) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void getMiningJob(jobId).then(
        (job) => {
          if (cancelled) return;
          setProgress(job.message);
          if (job.status === 'error') {
            setError(job.error ?? 'Mining failed');
            setStage('idle');
          } else if (job.status === 'ready') {
            setSource(job.source ?? null);
            setTranscript(
              (job.transcript ?? []).map((seg) => ({
                text: seg.text,
                startMs: seg.startMs,
                endMs: seg.endMs,
                isAuto: seg.isAuto ?? false,
                lowConfidence: seg.lowConfidence ?? false,
              })),
            );
            setRows(rowsFromCues(job.cues ?? []));
            setStage('transcript');
          }
        },
        (err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : 'Failed to check job status');
          setStage('idle');
        },
      );
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [stage, jobId]);

  function reset() {
    if (jobId) void deleteMiningJob(jobId);
    setStage('idle');
    setUrl('');
    setJobId(null);
    setSource(null);
    setError('');
    setBusy(false);
    setBusyNote('');
    setTranscript([]);
    setRows([]);
    setRealignNote('');
    setPreview(null);
  }

  async function handleStart() {
    setError('');
    setProgress('Starting…');
    setStage('starting');
    try {
      const id = await createMiningJob(url.trim());
      setJobId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start mining job');
      setStage('idle');
    }
  }

  async function runApply(note: string, fn: () => Promise<void>) {
    if (!jobId) return;
    setBusy(true);
    setBusyNote(note);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
      setBusyNote('');
    }
  }

  const applyAndSegment = () =>
    runApply('Segmenting…', async () => {
      const job = await applyJobSegments(
        jobId!,
        transcript.map((seg) => ({
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          isAuto: seg.isAuto,
          lowConfidence: seg.lowConfidence,
        })),
      );
      setRows(rowsFromCues(job.cues ?? []));
      setRealignNote('');
      setStage('segment');
    });

  const applyAndTranslate = () =>
    runApply('Aligning translations…', async () => {
      // Sync the job's cues to the reviewed rows (no further merge/split),
      // then align the EN subtitle track onto them.
      await applyJobSegments(
        jobId!,
        rows.map((row) => ({
          text: row.japanese,
          startMs: row.startMs,
          endMs: row.endMs,
        })),
        { merge: false, split: false },
      );
      const job = await translateJob(jobId!);
      const aligned = job.rows ?? [];
      setRows((current) =>
        current.map((row, index) => {
          const english = aligned[index]?.english?.trim() ?? '';
          return {
            ...row,
            translation: english || row.translation,
            needsTranslationReview: !(english || row.translation.trim()),
          };
        }),
      );
      setStage('translate');
    });

  const autoFillTranslations = () =>
    runApply('Asking the translation AI…', async () => {
      setRealignNote('');
      const result = await realignTranslations([
        {
          originalJapanese: rows.map((row) => row.japanese).join(''),
          originalTranslation: rows
            .map((row) => row.translation.trim())
            .filter(Boolean)
            .join(' '),
          pieces: rows.map((row) => row.japanese),
        },
      ]);
      if (!result.ok) {
        setRealignNote(result.reason);
        return;
      }
      const pieces = result.groups[0]?.pieceTranslations ?? [];
      setRows((current) =>
        current.map((row, index) => {
          const next = pieces[index]?.trim();
          return next ? { ...row, translation: next, needsTranslationReview: true } : row;
        }),
      );
      setRealignNote('Filled by AI from the aligned subtitles — give them a glance.');
    });

  const buildPreview = () =>
    runApply('Clipping sentences…', async () => {
      if (!source) throw new Error('Source metadata is missing.');
      const sentences: ShadowingSentenceInput[] = [];
      const audio: ShadowingAudioDraft[] = [];
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i]!;
        setBusyNote(`Clipping sentence ${i + 1} / ${rows.length}…`);
        const clip = await clipMiningRange(jobId!, {
          japanese: row.japanese,
          english: row.translation.trim() || undefined,
          startMs: row.startMs,
          endMs: row.endMs,
          generateKana: true,
        });
        const blob = await fetchMiningClipAudio(jobId!, clip.sentenceId);
        const japanese = displayJapanese(clip.japanese);
        sentences.push({
          id: clip.sentenceId,
          japanese: clip.japanese,
          reading: clip.reading ?? undefined,
          english: clip.english ?? undefined,
          startMs: clip.startMs,
          endMs: clip.endMs,
          tags: [],
          transcriptStatus: clip.transcriptStatus,
          tokens: clip.tokens ?? undefined,
        });
        audio.push({
          sourceSentenceId: clip.sentenceId,
          normalizedKey: normalizeSentenceKey(japanese),
          path: `clips/${clip.sentenceId}.m4a`,
          mimeType: clip.audio.mimeType,
          durationMs: clip.audio.durationMs,
          startMs: clip.startMs,
          endMs: clip.endMs,
          blob,
        });
      }
      const existing = await getDb().sentences.toArray();
      setPreview(
        buildShadowingPreview(
          {
            id: source.id,
            type: 'youtube',
            url: source.url,
            videoId: source.videoId,
            title: source.title,
            channel: source.channel ?? undefined,
            durationMs: source.durationMs ?? undefined,
          },
          { ...MANIFEST, createdAt: new Date().toISOString() },
          sentences,
          audio,
          existing,
        ),
      );
      setStage('commit');
    });

  const vocabPreview = (() => {
    if (!preview) return { count: 0, sample: [] as string[] };
    const seen = new Set<string>();
    for (const item of preview.drafts) {
      for (const suggestion of item.draft.vocabularySuggestions) {
        seen.add(suggestion.expression);
      }
    }
    return { count: seen.size, sample: [...seen].slice(0, 12) };
  })();

  const currentStepIndex = STAGE_LABELS.findIndex((s) => s.key === stage);

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Import from YouTube</h2>
        <p className="muted" style={{ margin: 0 }}>
          Paste a YouTube URL. Glossbook downloads the audio and transcript,
          then walks you through fixing the transcript, the sentence
          boundaries, and the translations before adding a book.
        </p>
        {stage === 'idle' ? (
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
        {stage === 'starting' ? (
          <div className="stack">
            <div className="muted">{progress}</div>
            <button type="button" onClick={reset}>
              Cancel
            </button>
          </div>
        ) : null}
        {error ? <div style={{ color: 'var(--danger)' }}>{error}</div> : null}
      </section>

      {currentStepIndex >= 0 ? (
        <section className="panel stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>
              {source?.title ?? 'Mining'} — step {currentStepIndex + 1} of{' '}
              {STAGE_LABELS.length}: {STAGE_LABELS[currentStepIndex]!.label}
            </strong>
            <div className="row">
              {STAGE_LABELS.map((step, index) => (
                <span
                  key={step.key}
                  className="muted"
                  style={{
                    fontWeight: index === currentStepIndex ? 700 : 400,
                    color: index < currentStepIndex ? 'var(--accent)' : undefined,
                  }}
                >
                  {index + 1}.{step.label}
                </span>
              ))}
            </div>
          </div>
          {busy ? <div className="muted">{busyNote || 'Working…'}</div> : null}
        </section>
      ) : null}

      {stage === 'transcript' ? (
        <>
          <TranscriptStage
            segs={transcript}
            onSegsChange={setTranscript}
            fetchAudio={(s, e) => fetchJobAudioRange(jobId!, s, e)}
            disabled={busy}
          />
          <section className="panel">
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={busy || transcript.length === 0}
                onClick={() => void applyAndSegment()}
              >
                Apply &amp; segment →
              </button>
              <button type="button" disabled={busy} onClick={reset}>
                Start over
              </button>
            </div>
          </section>
        </>
      ) : null}

      {stage === 'segment' ? (
        <>
          <SegmentationEditor
            rows={rows}
            onRowsChange={setRows}
            disabled={busy}
            audioForRange={(s, e) => fetchJobAudioRange(jobId!, s, e)}
          />
          <section className="panel">
            <div className="row">
              <button type="button" disabled={busy} onClick={() => setStage('transcript')}>
                ← Back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void applyAndSegment()}
                title="Discard the edits below and re-split from the transcript"
              >
                ↻ Re-split from transcript
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || rows.length === 0}
                onClick={() => void applyAndTranslate()}
              >
                Apply &amp; translate →
              </button>
            </div>
          </section>
        </>
      ) : null}

      {stage === 'translate' ? (
        <>
          <section className="panel stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{rows.length} sentences</strong>
              <div className="row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void applyAndTranslate()}
                  title="Discard edits and re-align EN from the subtitle track"
                >
                  ↻ Re-align
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void autoFillTranslations()}
                >
                  Auto-fill translations (AI)
                </button>
              </div>
            </div>
            {realignNote ? <div className="muted">{realignNote}</div> : null}
          </section>
          {rows.map((row, index) => (
            <section className="panel stack" key={index}>
              <span className="jp">{row.japanese}</span>
              <input
                value={row.translation}
                disabled={busy}
                placeholder="English"
                onChange={(event) =>
                  setRows((current) =>
                    current.map((r, i) =>
                      i === index
                        ? { ...r, translation: event.target.value, needsTranslationReview: false }
                        : r,
                    ),
                  )
                }
                style={
                  row.needsTranslationReview ? { borderColor: 'var(--warning)' } : undefined
                }
              />
            </section>
          ))}
          <section className="panel">
            <div className="row">
              <button type="button" disabled={busy} onClick={() => setStage('segment')}>
                ← Back
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void buildPreview()}
              >
                Next →
              </button>
            </div>
          </section>
        </>
      ) : null}

      {stage === 'commit' && preview ? (
        <section className="panel stack">
          <h3 style={{ margin: 0 }}>Import preview</h3>
          <p className="muted" style={{ margin: 0 }}>
            {preview.counts.uniqueSentences} sentences (
            {preview.counts.newSentences} new,{' '}
            {preview.counts.updatedSentences} existing) · ~{vocabPreview.count} vocab
            suggestion{vocabPreview.count === 1 ? '' : 's'} to confirm when you first
            study the book
            {vocabPreview.sample.length
              ? `: ${vocabPreview.sample.join('、')}${
                  vocabPreview.count > vocabPreview.sample.length ? '…' : ''
                }`
              : ''}
          </p>
          <ShadowingPreviewCard
            preview={preview}
            retentionNote="Native clips are not included in Glossbook JSON backups. Re-mine this video to restore them if needed."
            onImported={(result) => {
              if (jobId) void deleteMiningJob(jobId);
              navigate(`/books/${result.bookId}`);
            }}
            onCancel={() => setStage('translate')}
          />
        </section>
      ) : null}
    </div>
  );
}
