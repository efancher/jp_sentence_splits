import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ShadowingPreviewCard } from '../components/ShadowingPreviewCard';
import { SpanAudioButton } from '../components/SpanAudioButton';
import {
  commitSeriesEpisodeImport,
  getDb,
  getSeriesImportedSourceIds,
  rememberPodcastFeedUrl,
} from '../db/repository';
import { hashString } from '../lib/ids';
import { displayJapanese, normalizeSentenceKey } from '../lib/normalize';
import {
  commitMiningJob,
  createMiningJob,
  deleteMiningJob,
  fetchJobAudioRange,
  fetchPodcastFeed,
  getMiningJob,
  listMiningJobs,
  type MiningJobStatus,
  type MiningJobSummary,
  type MiningSourceInfo,
  type MiningTranscriptSource,
  type PodcastEpisode,
  type PodcastFeed,
} from '../lib/miningApi';
import { formatCombinedPromptForAI, parseAiCombinedReply } from '../lib/miningQuickImport';
import type { WizardTranscriptSeg } from '../lib/miningTranscript';
import { extractYouTubeId } from '../lib/youtubeUrl';
import {
  buildShadowingPreview,
  type ShadowingAudioDraft,
  type ShadowingImportPreview,
  type ShadowingSentenceInput,
} from '../lib/shadowingImport';

const POLL_INTERVAL_MS = 1500;
const PODCAST_PAGE_SIZE = 30;

/** Separate from YouTubeMinePage's own `ytmine.activeJob` pointer — the two
 * pages resume independently, but `listMiningJobs()` still offers either
 * page's in-flight job on both, since commit doesn't care which page (or
 * which wizard stage) a job has reached. */
const ACTIVE_JOB_KEY = 'quickmine.activeJob';
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

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
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

type Stage = 'idle' | 'starting' | 'combine' | 'review' | 'commit';

interface QuickRow {
  japanese: string;
  translation: string;
  startMs: number;
  endMs: number;
}

const MANIFEST = {
  format: 'japanese-shadowing-package',
  version: 2,
  createdAt: '',
  generator: { name: 'jp-sentence-splits-youtube-mining', version: '2' },
} as const;

/**
 * One-page alternative to {@link YouTubeMinePage}'s 4-step wizard, for the
 * common case of "just import it": one combined prompt merges the wizard's
 * separate Segment-with-AI-help and Translate-with-AI-help round trips into
 * a single copy/paste, then a lightweight editable list stands in for the
 * wizard's SegmentationEditor/waveform review before landing on the same
 * commit preview. Skips the server's `/segment` and `/translate` stage
 * endpoints entirely — `POST /jobs/{id}/commit` only requires
 * `job.status === 'ready'` (transcript downloaded), not that those stages
 * ran; each row's `japanese`/`english`/timing is taken straight from what
 * the AI reply parsed to.
 */
export function QuickMinePage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('idle');
  const [url, setUrl] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [source, setSource] = useState<MiningSourceInfo | null>(null);
  const [transcriptSource, setTranscriptSource] = useState<MiningTranscriptSource | null>(null);
  const [transcript, setTranscript] = useState<WizardTranscriptSeg[]>([]);
  const [progress, setProgress] = useState('Starting…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyNote, setBusyNote] = useState('');
  const [resuming, setResuming] = useState(true);
  const [resumable, setResumable] = useState<MiningJobSummary[]>([]);
  const [minedVideos, setMinedVideos] = useState<Map<string, { title: string; createdAt: string }>>(
    new Map(),
  );

  const [pasted, setPasted] = useState('');
  const [pasteStatus, setPasteStatus] = useState('');
  const [copied, setCopied] = useState(false);
  const [rows, setRows] = useState<QuickRow[]>([]);
  const [preview, setPreview] = useState<ShadowingImportPreview | null>(null);

  const [podcastFeedUrl, setPodcastFeedUrl] = useState('');
  const [podcastFeed, setPodcastFeed] = useState<PodcastFeed | null>(null);
  const [podcastFeedSort, setPodcastFeedSort] = useState<'newest' | 'oldest'>('newest');
  const [podcastFeedPage, setPodcastFeedPage] = useState(0);
  const [podcastFeedSearch, setPodcastFeedSearch] = useState('');
  const [podcastFeedLoading, setPodcastFeedLoading] = useState(false);
  const [podcastFeedError, setPodcastFeedError] = useState('');
  const [podcastEpisodeDate, setPodcastEpisodeDate] = useState<string | null>(null);
  const [podcastEpisodeSourceUrl, setPodcastEpisodeSourceUrl] = useState('');

  const progressStartedAtRef = useRef<number>(Date.now());
  const [, forceTick] = useState(0);
  const jobIdRef = useRef<string | null>(null);
  jobIdRef.current = jobId;

  useEffect(() => {
    if (jobId) storeActiveJob(jobId);
  }, [jobId]);

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
      (err: unknown) => {
        if (cancelled) return;
        clearActiveJob();
        setError(
          `Could not reconnect to your last mining job: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
        setResuming(false);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setTranscriptSource(job.transcriptSource ?? null);
    setProgress(job.message);
    progressStartedAtRef.current = Date.now() - (job.elapsedSeconds ?? 0) * 1000;
    if (job.status === 'ready') {
      setTranscript(transcriptFromJob(job));
      setStage('combine');
    } else {
      setStage('starting');
    }
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
    } catch (err) {
      setError(
        `Could not resume that import: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }

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
            setTranscriptSource(job.transcriptSource ?? null);
            setTranscript(transcriptFromJob(job));
            setStage('combine');
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
    setTranscriptSource(null);
    setTranscript([]);
    setError('');
    setBusy(false);
    setBusyNote('');
    setPasted('');
    setPasteStatus('');
    setRows([]);
    setPreview(null);
    setPodcastFeedUrl('');
    setPodcastFeed(null);
    setPodcastFeedSort('newest');
    setPodcastFeedPage(0);
    setPodcastFeedSearch('');
    setPodcastFeedError('');
    setPodcastEpisodeDate(null);
    setPodcastEpisodeSourceUrl('');
  }

  async function startJob(
    jobUrl: string,
    options: { title?: string; sourceType?: 'youtube' | 'podcast' } = {},
  ) {
    setError('');
    setProgress('Starting…');
    setStage('starting');
    try {
      const id = await createMiningJob(jobUrl, options);
      setJobId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start mining job');
      setStage('idle');
    }
  }

  async function handleStart() {
    await startJob(url.trim());
  }

  async function handleLoadPodcastFeed() {
    setPodcastFeedError('');
    setPodcastFeed(null);
    setPodcastFeedPage(0);
    setPodcastFeedSearch('');
    setPodcastFeedLoading(true);
    try {
      const trimmedUrl = podcastFeedUrl.trim();
      setPodcastFeed(await fetchPodcastFeed(trimmedUrl));
      void rememberPodcastFeedUrl(trimmedUrl);
    } catch (err) {
      setPodcastFeedError(err instanceof Error ? err.message : 'Failed to load podcast feed');
    } finally {
      setPodcastFeedLoading(false);
    }
  }

  async function handleStartPodcastEpisode(episode: PodcastEpisode) {
    setPodcastEpisodeDate(episode.publishedAt ?? null);
    setPodcastEpisodeSourceUrl(episode.url);
    await startJob(episode.url, { title: episode.title, sourceType: 'podcast' });
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(formatCombinedPromptForAI(transcript));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setPasteStatus('Copy failed — select the text above and copy it manually.');
    }
  }

  function applyPasted() {
    const fallbackEndMs = transcript.at(-1)?.endMs ?? 0;
    const parsed = parseAiCombinedReply(pasted, fallbackEndMs);
    if (parsed.length === 0) {
      setPasteStatus(
        "Couldn't read any \"[m:ss] japanese || english\" lines from that — paste the assistant's reply as-is.",
      );
      return;
    }
    setRows(parsed);
    setPasteStatus('');
    setPasted('');
    setStage('review');
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

  const podcastSeriesId = podcastFeedUrl.trim()
    ? `podcast-series-${hashString(podcastFeedUrl.trim())}`
    : null;
  const importedPodcastSourceIds = useLiveQuery(
    () => (podcastSeriesId ? getSeriesImportedSourceIds(podcastSeriesId) : new Set<string>()),
    [podcastSeriesId],
    new Set<string>(),
  );
  const visibleResumable = useMemo(
    () =>
      resumable.filter((job) => {
        if (importedPodcastSourceIds?.has(job.url)) return false;
        const videoId = extractYouTubeId(job.url);
        return !(videoId && minedVideos.has(videoId));
      }),
    [resumable, importedPodcastSourceIds, minedVideos],
  );

  const recentPodcastFeedUrls = useLiveQuery(
    async () => (await getDb().settings.get('settings'))?.recentPodcastFeedUrls ?? [],
    [],
    [],
  );

  const sortedPodcastEpisodes = podcastFeed
    ? podcastFeedSort === 'oldest'
      ? [...podcastFeed.episodes].reverse()
      : podcastFeed.episodes
    : [];
  const searchedPodcastEpisodes = podcastFeedSearch.trim()
    ? sortedPodcastEpisodes.filter((episode) =>
        episode.title.toLowerCase().includes(podcastFeedSearch.trim().toLowerCase()),
      )
    : sortedPodcastEpisodes;
  const podcastPageCount = Math.max(1, Math.ceil(searchedPodcastEpisodes.length / PODCAST_PAGE_SIZE));
  const clampedPodcastFeedPage = Math.min(podcastFeedPage, podcastPageCount - 1);
  const visiblePodcastEpisodes = searchedPodcastEpisodes.slice(
    clampedPodcastFeedPage * PODCAST_PAGE_SIZE,
    (clampedPodcastFeedPage + 1) * PODCAST_PAGE_SIZE,
  );

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Quick import</h2>
        <p className="muted" style={{ margin: 0 }}>
          One combined prompt for both segmenting and translating — copy it into
          ChatGPT/Claude once, paste the reply back, skim the result, and commit.
          For fine-grained control over sentence boundaries (waveform editing, a
          separate translate pass), use the full{' '}
          <a href="#/import/youtube">import wizard</a> instead.
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
        {!resuming && stage === 'idle' ? (
          <details className="stack" style={{ gap: '0.4rem' }}>
            <summary className="muted" style={{ cursor: 'pointer' }}>
              Or import a podcast episode
            </summary>
            <div className="stack" style={{ gap: '0.4rem' }}>
              <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
                Paste a show's RSS feed URL (not its Apple/Spotify page) and pick an
                episode — title and date fill in automatically from the feed.
              </p>
              <div className="row">
                <input
                  style={{ flex: 1 }}
                  value={podcastFeedUrl}
                  placeholder="https://example.com/feed/podcast"
                  list="recent-podcast-feed-urls-quick"
                  onChange={(event) => setPodcastFeedUrl(event.target.value)}
                />
                <datalist id="recent-podcast-feed-urls-quick">
                  {recentPodcastFeedUrls?.map((feedUrl) => (
                    <option key={feedUrl} value={feedUrl} />
                  ))}
                </datalist>
                <button
                  type="button"
                  disabled={!podcastFeedUrl.trim() || podcastFeedLoading}
                  onClick={() => void handleLoadPodcastFeed()}
                >
                  {podcastFeedLoading ? 'Loading…' : 'Load episodes'}
                </button>
              </div>
              {podcastFeedError ? (
                <div className="muted" style={{ color: 'var(--warning)', fontSize: '0.85rem' }}>
                  {podcastFeedError}
                </div>
              ) : null}
              {podcastFeed ? (
                <div className="stack" style={{ gap: '0.4rem' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {podcastFeed.title} — {podcastFeed.episodes.length} episodes
                    </div>
                    <div className="row" style={{ gap: '0.25rem' }}>
                      <button
                        type="button"
                        className={podcastFeedSort === 'newest' ? 'primary' : undefined}
                        onClick={() => {
                          setPodcastFeedSort('newest');
                          setPodcastFeedPage(0);
                        }}
                      >
                        Newest first
                      </button>
                      <button
                        type="button"
                        className={podcastFeedSort === 'oldest' ? 'primary' : undefined}
                        onClick={() => {
                          setPodcastFeedSort('oldest');
                          setPodcastFeedPage(0);
                        }}
                      >
                        Oldest first
                      </button>
                    </div>
                  </div>
                  <input
                    value={podcastFeedSearch}
                    placeholder="Search episode titles…"
                    onChange={(event) => {
                      setPodcastFeedSearch(event.target.value);
                      setPodcastFeedPage(0);
                    }}
                  />
                  {!podcastFeedSearch.trim() ? (
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <button
                        type="button"
                        disabled={clampedPodcastFeedPage === 0}
                        onClick={() => setPodcastFeedPage((page) => Math.max(0, page - 1))}
                      >
                        ← Back
                      </button>
                      <span className="muted" style={{ fontSize: '0.85rem' }}>
                        Page {clampedPodcastFeedPage + 1} of {podcastPageCount} (
                        {podcastFeedSort === 'newest' ? 'newest' : 'oldest'} first)
                      </span>
                      <button
                        type="button"
                        disabled={clampedPodcastFeedPage >= podcastPageCount - 1}
                        onClick={() =>
                          setPodcastFeedPage((page) => Math.min(podcastPageCount - 1, page + 1))
                        }
                      >
                        Forward →
                      </button>
                    </div>
                  ) : (
                    <div className="muted" style={{ fontSize: '0.85rem' }}>
                      {searchedPodcastEpisodes.length} match
                      {searchedPodcastEpisodes.length === 1 ? '' : 'es'}
                    </div>
                  )}
                  <div className="stack" style={{ gap: '0.25rem', maxHeight: '16rem', overflowY: 'auto' }}>
                    {visiblePodcastEpisodes.map((episode) => {
                      const imported = importedPodcastSourceIds?.has(episode.url);
                      const publishedDate = episode.publishedAt ? new Date(episode.publishedAt) : null;
                      return (
                        <button
                          key={episode.url}
                          type="button"
                          className="row"
                          style={{ justifyContent: 'space-between', textAlign: 'left', gap: '1rem' }}
                          onClick={() => void handleStartPodcastEpisode(episode)}
                        >
                          <span>
                            {imported ? (
                              <span className="status-pill" style={{ marginRight: '0.4rem' }}>
                                Imported
                              </span>
                            ) : null}
                            {episode.title}
                          </span>
                          <span className="muted" style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                            {publishedDate && !Number.isNaN(publishedDate.getTime())
                              ? publishedDate.toLocaleDateString()
                              : ''}
                            {episode.durationSeconds ? ` · ${formatElapsed(episode.durationSeconds)}` : ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
        {!resuming && stage === 'idle' && visibleResumable.length > 0 ? (
          <div className="stack" style={{ gap: '0.4rem' }}>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              Or pick up an import already in progress:
            </div>
            {visibleResumable.map((job) => (
              <button
                key={job.jobId}
                type="button"
                className="row"
                style={{ justifyContent: 'space-between', textAlign: 'left', gap: '1rem' }}
                onClick={() => void resumeJob(job.jobId)}
              >
                <span>{job.title || job.url}</span>
                <span className="muted">{job.status === 'ready' ? 'ready to review' : job.message}</span>
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
            </div>
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              You can leave this page — the job keeps running and you'll reconnect to it
              when you come back.
            </p>
            <button type="button" onClick={reset}>
              Cancel
            </button>
          </div>
        ) : null}
        {error ? <div style={{ color: 'var(--danger)' }}>{error}</div> : null}
      </section>

      {transcriptSource === 'auto-caption' && (stage === 'combine' || stage === 'review') ? (
        <section className="panel stack" style={{ borderColor: 'var(--warning)', gap: '0.35rem' }}>
          <strong style={{ color: 'var(--warning)' }}>
            ⚠ Segmented from YouTube auto-captions
          </strong>
          <span className="muted" style={{ fontSize: '0.9em' }}>
            The transcription service was unavailable, so this used YouTube&rsquo;s
            auto-caption track — no punctuation, and timestamps rounded to whole
            seconds. Give the AI's segmentation an extra look in the review step
            below, or start over once the service is back.
          </span>
        </section>
      ) : null}

      {stage === 'combine' ? (
        <section className="panel stack">
          <strong>{source?.title ?? 'Segment + translate with AI help'}</strong>
          <p className="muted" style={{ margin: 0 }}>
            Copy this into ChatGPT / Claude, then paste its reply back below.
          </p>
          <textarea readOnly className="jp" rows={10} value={formatCombinedPromptForAI(transcript)} />
          <div className="row">
            <button type="button" onClick={() => void copyPrompt()}>
              {copied ? 'Copied ✓' : 'Copy prompt'}
            </button>
          </div>
          <textarea
            className="jp"
            rows={8}
            placeholder="Paste the assistant's reply here (one [m:ss] japanese || english line per sentence)…"
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
          />
          <div className="row">
            <button type="button" disabled={busy} onClick={reset}>
              Start over
            </button>
            <button type="button" className="primary" disabled={!pasted.trim()} onClick={applyPasted}>
              Apply pasted reply →
            </button>
          </div>
          {pasteStatus ? <div className="muted">{pasteStatus}</div> : null}
        </section>
      ) : null}

      {stage === 'review' ? (
        <>
          <section className="panel stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{rows.length} sentences — give them a skim before committing</strong>
              <button type="button" onClick={() => setStage('combine')}>
                ← Back to prompt
              </button>
            </div>
          </section>
          {rows.map((row, index) => (
            <section className="panel stack" key={index}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <SpanAudioButton
                  fetchAudio={() => fetchJobAudioRange(jobId!, row.startMs, row.endMs)}
                  cacheKey={`${row.startMs}-${row.endMs}`}
                  disabled={busy}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
              <textarea
                className="jp"
                rows={2}
                value={row.japanese}
                disabled={busy}
                onChange={(event) =>
                  setRows((current) =>
                    current.map((r, i) => (i === index ? { ...r, japanese: event.target.value } : r)),
                  )
                }
              />
              <input
                value={row.translation}
                placeholder="English"
                disabled={busy}
                onChange={(event) =>
                  setRows((current) =>
                    current.map((r, i) => (i === index ? { ...r, translation: event.target.value } : r)),
                  )
                }
              />
            </section>
          ))}
          <section className="panel">
            <div className="row">
              <button type="button" disabled={busy} onClick={() => setStage('combine')}>
                ← Back
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || rows.length === 0}
                onClick={() => void buildPreview()}
              >
                Next →
              </button>
            </div>
            {busy ? <div className="muted">{busyNote || 'Working…'}</div> : null}
            {error ? <div style={{ color: 'var(--danger)' }}>{error}</div> : null}
          </section>
        </>
      ) : null}

      {stage === 'commit' && preview ? (
        <section className="panel stack">
          <h3 style={{ margin: 0 }}>Import preview</h3>
          <p className="muted" style={{ margin: 0 }}>
            {preview.counts.uniqueSentences} sentences (
            {preview.counts.newSentences} new, {preview.counts.updatedSentences} existing) · ~
            {vocabPreview.count} vocab suggestion{vocabPreview.count === 1 ? '' : 's'} to confirm
            when you first study the book
            {vocabPreview.sample.length
              ? `: ${vocabPreview.sample.join('、')}${
                  vocabPreview.count > vocabPreview.sample.length ? '…' : ''
                }`
              : ''}
          </p>
          <ShadowingPreviewCard
            preview={preview}
            retentionNote="Native clips are not included in Glossbook JSON backups. Re-mine this video to restore them if needed."
            {...(source?.type === 'podcast' && podcastFeedUrl.trim()
              ? {
                  commitLabel: 'Add as a new chapter',
                  onCommit: (p: ShadowingImportPreview) =>
                    commitSeriesEpisodeImport({
                      seriesId: `podcast-series-${hashString(podcastFeedUrl.trim())}`,
                      seriesTitle: podcastFeed?.title || source.title,
                      seriesUrl: podcastFeedUrl.trim(),
                      episodeTitle: source.title,
                      sourceId: podcastEpisodeSourceUrl || source.url,
                      sourceDate: podcastEpisodeDate ?? new Date().toISOString(),
                      preview: p,
                    }),
                }
              : {})}
            onImported={(result) => {
              if (jobId) void deleteMiningJob(jobId);
              clearActiveJob();
              navigate(`/books/${result.bookId}?imported=1`);
            }}
            onCancel={() => setStage('review')}
          />
        </section>
      ) : null}
    </div>
  );
}
