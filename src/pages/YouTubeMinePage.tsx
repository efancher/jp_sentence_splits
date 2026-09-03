import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { SegmentationEditor } from '../components/SegmentationEditor';
import { ShadowingPreviewCard } from '../components/ShadowingPreviewCard';
import { SpanAudioButton } from '../components/SpanAudioButton';
import { TranscriptStage } from '../components/TranscriptStage';
import { TranslateAiHelp } from '../components/TranslateAiHelp';
import { getDb } from '../db/repository';
import { displayJapanese, normalizeSentenceKey } from '../lib/normalize';
import {
  applyJobSegments,
  commitMiningJob,
  createMiningJob,
  deleteMiningJob,
  fetchJobAudioRange,
  getMiningJob,
  listMiningJobs,
  translateJob,
  type MiningCue,
  type MiningJobStatus,
  type MiningJobSummary,
  type MiningSourceInfo,
} from '../lib/miningApi';
import type { WizardTranscriptSeg } from '../lib/miningTranscript';
import {
  buildMiningRealignGroups,
  type ResegmentReviewRow,
} from '../lib/resegmentPlan';
import { realignTranslations } from '../lib/sentenceRealign';
import { extractYouTubeId } from '../lib/youtubeUrl';
import {
  buildShadowingPreview,
  type ShadowingAudioDraft,
  type ShadowingImportPreview,
  type ShadowingSentenceInput,
} from '../lib/shadowingImport';

const POLL_INTERVAL_MS = 1500;

/**
 * The in-flight job id is kept in `localStorage` so a refresh / accidental
 * nav-away / phone unloading the tab can reconnect instead of restarting a
 * 20-minute mine. The server checkpoints jobs to disk and keeps them
 * resumable up to `JOB_HARD_TTL_SECONDS` (48h); resuming on a *different*
 * machine goes through the `GET /jobs` picker on the idle screen instead of
 * this pointer.
 */
const ACTIVE_JOB_KEY = 'ytmine.activeJob';
const ACTIVE_JOB_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function storeActiveJob(jobId: string): void {
  try {
    localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId, savedAt: Date.now() }));
  } catch {
    // Private mode / storage disabled — resume just won't be available.
  }
}

function clearActiveJob(): void {
  try {
    localStorage.removeItem(ACTIVE_JOB_KEY);
  } catch {
    // ignore
  }
}

function readActiveJob(): string | null {
  try {
    const raw = localStorage.getItem(ACTIVE_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { jobId?: unknown; savedAt?: unknown };
    if (typeof parsed.jobId !== 'string') return null;
    if (typeof parsed.savedAt === 'number' && Date.now() - parsed.savedAt > ACTIVE_JOB_MAX_AGE_MS) {
      return null;
    }
    return parsed.jobId;
  } catch {
    return null;
  }
}

/** m:ss for a live elapsed counter. */
function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * A soft "usually about this long" hint for the current step, so the long
 * transcription wait is legible. Transcription scales with the video's
 * length (~0.4x realtime with word timestamps off — see the analysis
 * service config); the others are quick and get no hint.
 */
function stepEtaHint(message: string, durationMs: number | null | undefined): string | null {
  if (message.startsWith('Transcribing')) {
    if (!durationMs) return null;
    const minutes = Math.max(1, Math.round((durationMs / 1000) * 0.4 / 60));
    return `usually ~${minutes} min`;
  }
  if (message.startsWith('Downloading')) return 'usually under a minute';
  return null;
}

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

function transcriptFromJob(job: MiningJobStatus): WizardTranscriptSeg[] {
  return (job.transcript ?? []).map((seg) => ({
    text: seg.text,
    startMs: seg.startMs,
    endMs: seg.endMs,
    isAuto: seg.isAuto ?? false,
    lowConfidence: seg.lowConfidence ?? false,
  }));
}

/** Segment-stage rows with each row's EN overlaid from `job.rows` (same shape `applyAndTranslate` produces). */
function translatedRowsFromJob(job: MiningJobStatus): ResegmentReviewRow[] {
  const base = rowsFromCues(job.cues ?? []);
  const aligned = job.rows ?? [];
  return base.map((row, index) => {
    const english = aligned[index]?.english?.trim() ?? '';
    return {
      ...row,
      translation: english || row.translation,
      needsTranslationReview: !(english || row.translation.trim()),
    };
  });
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
  const [resuming, setResuming] = useState(true);
  const [resumable, setResumable] = useState<MiningJobSummary[]>([]);
  // videoId -> the book it was already imported as, so the idle screen can
  // warn before you re-mine something (re-mining is still allowed — it's how
  // you restore native clips — it just shouldn't be a surprise).
  const [minedVideos, setMinedVideos] = useState<
    Map<string, { title: string; createdAt: string }>
  >(new Map());
  // Wall-clock ms at which the current progress message started (server's
  // elapsedSeconds, converted). A 1s tick forces the "N:NN elapsed" re-render.
  const progressStartedAtRef = useRef<number>(Date.now());
  const [, forceTick] = useState(0);

  const jobIdRef = useRef<string | null>(null);
  jobIdRef.current = jobId;

  // Persist the in-flight job id so a refresh can reconnect (see readActiveJob).
  useEffect(() => {
    if (jobId) storeActiveJob(jobId);
  }, [jobId]);

  // Deliberately NOT cleaning up the job on unmount anymore — that's what
  // made a refresh lose a 20-minute mine. Abandoned jobs are reclaimed by
  // the server's TTL sweep; explicit "Start over" / "Cancel" / a finished
  // import still delete right away.

  // Resume an in-flight job on mount (refresh, accidental nav-away, phone
  // reloading the PWA). The server's `stage` is authoritative for how far
  // the pipeline got.
  useEffect(() => {
    const savedJobId = readActiveJob();
    if (!savedJobId) {
      setResuming(false);
      return;
    }
    let cancelled = false;
    void getMiningJob(savedJobId).then(
      (job) => {
        if (cancelled) return;
        if (job.status === 'error') {
          setError(job.error ?? 'The previous mining job failed.');
          clearActiveJob();
        } else {
          applyResumedJob(savedJobId, job);
        }
        setResuming(false);
      },
      () => {
        if (cancelled) return;
        clearActiveJob(); // gone / swept
        setResuming(false);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Offer to resume any import the service still holds — including one whose
  // transcription was kicked off on another device (the server checkpoints
  // jobs to disk). Refreshed whenever we return to the idle screen.
  useEffect(() => {
    if (stage !== 'idle') return;
    let cancelled = false;
    void listMiningJobs().then(
      (list) => {
        if (!cancelled) setResumable(list.filter((job) => job.status !== 'error'));
      },
      () => {
        /* service down / offline — nothing to resume */
      },
    );
    return () => {
      cancelled = true;
    };
  }, [stage]);

  // Index every already-imported YouTube book by its video id (from the
  // stored sourceUrl, falling back to the `shadowing:source-<id>` sourceKey).
  useEffect(() => {
    if (stage !== 'idle') return;
    let cancelled = false;
    void getDb()
      .books.toArray()
      .then((books) => {
        if (cancelled) return;
        const map = new Map<string, { title: string; createdAt: string }>();
        for (const book of books) {
          const videoId =
            extractYouTubeId(book.sourceUrl ?? '') ??
            (book.sourceKey?.startsWith('shadowing:source-')
              ? book.sourceKey.slice('shadowing:source-'.length)
              : null);
          if (videoId && !map.has(videoId)) {
            map.set(videoId, { title: book.title, createdAt: book.createdAt });
          }
        }
        setMinedVideos(map);
      });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  const alreadyMined = (() => {
    const videoId = extractYouTubeId(url);
    return videoId ? minedVideos.get(videoId) ?? null : null;
  })();

  function applyResumedJob(id: string, job: MiningJobStatus): void {
    setJobId(id);
    setSource(job.source ?? null);
    setProgress(job.message);
    progressStartedAtRef.current = Date.now() - (job.elapsedSeconds ?? 0) * 1000;
    hydrateStageFromJob(job);
    storeActiveJob(id);
  }

  async function resumeJob(id: string): Promise<void> {
    setError('');
    try {
      const job = await getMiningJob(id);
      if (job.status === 'error') {
        setError(job.error ?? 'That mining job failed.');
        return;
      }
      applyResumedJob(id, job);
    } catch {
      setError('Could not resume that import — it may have expired.');
    }
  }

  function hydrateStageFromJob(job: MiningJobStatus): void {
    switch (job.stage) {
      case 'fetching':
        setStage('starting');
        break;
      case 'segment':
        setRows(rowsFromCues(job.cues ?? []));
        setStage('segment');
        break;
      case 'translate':
        setRows(translatedRowsFromJob(job));
        setStage('translate');
        break;
      case 'transcript':
      case 'ready':
      default:
        setTranscript(transcriptFromJob(job));
        setRows(rowsFromCues(job.cues ?? []));
        setStage('transcript');
        break;
    }
  }

  // Live "N:NN elapsed" ticker while a step is in progress.
  useEffect(() => {
    if (stage !== 'starting') return;
    const timer = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    if (stage !== 'starting' || !jobId) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void getMiningJob(jobId).then(
        (job) => {
          if (cancelled) return;
          progressStartedAtRef.current = Date.now() - (job.elapsedSeconds ?? 0) * 1000;
          setProgress(job.message);
          if (job.status === 'error') {
            setError(job.error ?? 'Mining failed');
            setStage('idle');
          } else if (job.status === 'ready') {
            setSource(job.source ?? null);
            setTranscript(transcriptFromJob(job));
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
    clearActiveJob();
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
      // Group by transcript-segment provenance so each group's EN is
      // redistributed only across its own sentences — a single whole-span
      // group lets unrelated translations bleed.
      const { groups, assignments } = buildMiningRealignGroups(rows);
      const result = await realignTranslations(groups);
      if (!result.ok) {
        setRealignNote(result.reason);
        return;
      }
      setRows((current) =>
        current.map((row, index) => {
          const assignment = assignments[index];
          const next =
            assignment &&
            result.groups[assignment.groupIndex]?.pieceTranslations[assignment.rank]?.trim();
          return next ? { ...row, translation: next, needsTranslationReview: true } : row;
        }),
      );
      setRealignNote('Filled by AI from the aligned subtitles — give them a glance.');
    });

  // Manual copy/paste counterpart to autoFillTranslations: apply a parsed
  // reply from <TranslateAiHelp>. `translations[i] === null` -> leave row i.
  const fillTranslationsFromAi = (translations: (string | null)[]) => {
    setRealignNote('Filled from a pasted AI reply — give them a glance.');
    setRows((current) =>
      current.map((row, index) => {
        const next = translations[index]?.trim();
        return next ? { ...row, translation: next, needsTranslationReview: true } : row;
      }),
    );
  };

  const buildPreview = () =>
    runApply(
      `Clipping ${rows.length} sentences from the source (up to a minute for a long video)…`,
      async () => {
        if (!source) throw new Error('Source metadata is missing.');
        const clipped = await commitMiningJob(
          jobId!,
          rows.map((row) => ({
            japanese: row.japanese,
            english: row.translation.trim() || undefined,
            startMs: row.startMs,
            endMs: row.endMs,
          })),
          {
            onProgress: (done, total) =>
              setBusyNote(`Clipping sentences from the source… ${done}/${total}`),
          },
        );
        const sentences: ShadowingSentenceInput[] = [];
        const audio: ShadowingAudioDraft[] = [];
        for (const { clip, blob } of clipped) {
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
      },
    );

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
        {resuming && stage === 'idle' ? (
          <div className="muted">Reconnecting to your last mining job…</div>
        ) : null}
        {!resuming && stage === 'idle' ? (
          <div className="stack" style={{ gap: '0.4rem' }}>
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
                {alreadyMined ? 'Mine again' : 'Start'}
              </button>
            </div>
            {alreadyMined ? (
              <div className="muted" style={{ color: 'var(--warning)', fontSize: '0.85rem' }}>
                Already imported as “{alreadyMined.title}” on{' '}
                {new Date(alreadyMined.createdAt).toLocaleDateString()}. Mining it again
                re-clips the audio and updates that book.
              </div>
            ) : null}
          </div>
        ) : null}
        {!resuming && stage === 'idle' && resumable.length > 0 ? (
          <div className="stack" style={{ gap: '0.4rem' }}>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              Or pick up an import already in progress — transcription runs on
              the server, so you can start it on one device and finish here:
            </div>
            {resumable.map((job) => (
              <button
                key={job.jobId}
                type="button"
                className="row"
                style={{ justifyContent: 'space-between', textAlign: 'left', gap: '1rem' }}
                onClick={() => void resumeJob(job.jobId)}
              >
                <span>{job.title || job.url}</span>
                <span className="muted">
                  {job.status === 'ready' ? 'ready to review' : job.message}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {stage === 'starting' ? (
          <div className="stack">
            <div className="muted">
              {progress}
              {' · '}
              {formatElapsed((Date.now() - progressStartedAtRef.current) / 1000)} elapsed
              {(() => {
                const hint = stepEtaHint(progress, source?.durationMs);
                return hint ? ` (${hint})` : '';
              })()}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              You can leave this page — the job keeps running and you'll reconnect to it when you
              come back.
            </p>
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
          <TranslateAiHelp
            rows={rows.map((row) => ({ japanese: row.japanese, translation: row.translation }))}
            onFill={fillTranslationsFromAi}
            disabled={busy}
          />
          {rows.map((row, index) => (
            <section className="panel stack" key={index}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="jp">{row.japanese}</span>
                <SpanAudioButton
                  fetchAudio={() => fetchJobAudioRange(jobId!, row.startMs, row.endMs)}
                  disabled={busy}
                />
              </div>
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
              clearActiveJob();
              navigate(`/books/${result.bookId}`);
            }}
            onCancel={() => setStage('translate')}
          />
        </section>
      ) : null}
    </div>
  );
}
