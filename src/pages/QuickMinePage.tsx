import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { NamedPodcastFeedPicker } from '../components/NamedPodcastFeedPicker';
import { ShadowingPreviewCard } from '../components/ShadowingPreviewCard';
import { SpanAudioButton } from '../components/SpanAudioButton';
import {
  commitSeriesEpisodeImport,
  getDb,
  getSeriesImportedSourceIds,
  rememberPodcastFeedUrl,
} from '../db/repository';
import { canonicalSourceId, hashString } from '../lib/ids';
import { displayJapanese, normalizeSentenceKey } from '../lib/normalize';
import {
  cancelAssistRun,
  commitMiningJob,
  createMiningJob,
  deleteAssistRun,
  deleteMiningJob,
  fetchJobAudioRange,
  fetchPodcastFeed,
  getAssistRun,
  getMiningJob,
  listMiningJobs,
  startAssistRun,
  type AssistRunStatus,
  type MiningJobStatus,
  type MiningJobSummary,
  type MiningSourceInfo,
  type MiningTranscriptSource,
  type PodcastEpisode,
  type PodcastFeed,
  runAssist,
} from '../lib/miningApi';
import {
  COMBINED_PROMPT_FILENAME,
  checkCombinedReply,
  formatCombinedPromptForAI,
  splitCombinedReply,
  type CombinedPromptOptions,
  type CombinedReplySections,
} from '../lib/combinedImportPrompt';
import { mergeExtraReplies, planExtraTasks, runExtraTasks } from '../lib/assistExtras';
import { MAX_ATTEMPTS_PER_CHUNK, NO_EXTRAS } from '../lib/assistChunks';
import { parseAiCombinedReply } from '../lib/miningQuickImport';
import type { WizardTranscriptSeg } from '../lib/miningTranscript';
import { downloadTextFile } from '../lib/particleChecks';
import { applyQuickImportExtras, hasQuickImportExtras } from '../lib/quickImportExtras';
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
const ASSIST_RUN_POLL_MS = 3000;
const ASSIST_EXTRAS_KEY_PREFIX = 'quickmine.assistExtras.';
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

const QUEUE_KEY = 'quickmine.podcastQueue';

interface PersistedQueue {
  queue: QueuedEpisode[];
  queueTotal: number;
  episodeDate: string | null;
  episodeSourceUrl: string;
}

function writePersistedQueue(state: PersistedQueue | null): void {
  try {
    if (!state) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch {
    // Private mode / storage disabled — the queue just won't survive a reload.
  }
}

function readPersistedQueue(): PersistedQueue | null {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedQueue> & { savedAt?: unknown };
    if (typeof parsed.savedAt === 'number' && Date.now() - parsed.savedAt > ACTIVE_JOB_MAX_AGE_MS) {
      return null;
    }
    if (!Array.isArray(parsed.queue)) return null;
    const queue = parsed.queue.filter(
      (item): item is QueuedEpisode =>
        typeof item?.episode?.url === 'string' && typeof item.episode.title === 'string',
    );
    return {
      queue,
      queueTotal: typeof parsed.queueTotal === 'number' ? parsed.queueTotal : queue.length,
      episodeDate: typeof parsed.episodeDate === 'string' ? parsed.episodeDate : null,
      episodeSourceUrl: typeof parsed.episodeSourceUrl === 'string' ? parsed.episodeSourceUrl : '',
    };
  } catch {
    return null;
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

interface QueuedEpisode {
  episode: PodcastEpisode;
  /** Set once the next episode's download/ASR job has been started in the background. */
  jobId?: string;
}

type Stage = 'idle' | 'starting' | 'combine' | 'review' | 'commit';

const EXTRA_OPTION_LABELS: { key: keyof CombinedPromptOptions; label: string }[] = [
  { key: 'targets', label: 'Focus targets' },
  { key: 'constructions', label: 'Phrase constructions' },
  { key: 'walkthroughs', label: 'Sentence walkthroughs (how the parts make the meaning)' },
  { key: 'structure', label: 'Chunk structure' },
  { key: 'comprehension', label: 'Comprehension checks' },
  { key: 'particles', label: 'Particle questions' },
];
const LONG_TRANSCRIPT_FRAGMENTS = 80;

interface QuickRow {
  /** The assistant's S-number for this sentence; extras in the reply are keyed by it. */
  handle: number;
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
  const [promptOptions, setPromptOptions] = useState<Required<CombinedPromptOptions>>({
    targets: true,
    constructions: true,
    walkthroughs: true,
    structure: true,
    comprehension: true,
    particles: true,
  });
  const [extras, setExtras] = useState<CombinedReplySections | null>(null);
  const [replyWarnings, setReplyWarnings] = useState<string[]>([]);
  const [assistRunning, setAssistRunning] = useState(false);
  const [assistProgress, setAssistProgress] = useState('');
  const [assistFailure, setAssistFailure] = useState('');
  const [partialRun, setPartialRun] = useState<AssistRunStatus | null>(null);
  const [extrasRunning, setExtrasRunning] = useState(false);
  const [extrasProgress, setExtrasProgress] = useState('');
  const [extrasFailure, setExtrasFailure] = useState('');
  const assistCancelRef = useRef(false);
  const assistRunningRef = useRef(false);
  assistRunningRef.current = assistRunning;
  const attachedRunRef = useRef(new Set<string>());
  const [sentenceIdByHandle, setSentenceIdByHandle] = useState<Map<number, string>>(new Map());
  const [preview, setPreview] = useState<ShadowingImportPreview | null>(null);

  const [podcastFeedUrl, setPodcastFeedUrl] = useState('');
  const [podcastFeed, setPodcastFeed] = useState<PodcastFeed | null>(null);
  const [podcastFeedSort, setPodcastFeedSort] = useState<'newest' | 'oldest'>('newest');
  const [podcastFeedPage, setPodcastFeedPage] = useState(0);
  const [podcastFeedSearch, setPodcastFeedSearch] = useState('');
  const [podcastFeedLoading, setPodcastFeedLoading] = useState(false);
  const [podcastFeedError, setPodcastFeedError] = useState('');
  const [restoredQueue] = useState(readPersistedQueue);
  const [podcastEpisodeDate, setPodcastEpisodeDate] = useState<string | null>(
    restoredQueue?.episodeDate ?? null,
  );
  const [podcastEpisodeSourceUrl, setPodcastEpisodeSourceUrl] = useState(
    restoredQueue?.episodeSourceUrl ?? '',
  );

  const [podcastSelected, setPodcastSelected] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<QueuedEpisode[]>(() => readPersistedQueue()?.queue ?? []);
  const [queueTotal, setQueueTotal] = useState(() => readPersistedQueue()?.queueTotal ?? 0);
  const queueRef = useRef<QueuedEpisode[]>([]);
  queueRef.current = queue;
  const prefetchingRef = useRef<string | null>(null);

  const progressStartedAtRef = useRef<number>(Date.now());
  const [, forceTick] = useState(0);
  const jobIdRef = useRef<string | null>(null);
  jobIdRef.current = jobId;

  useEffect(() => {
    if (jobId) storeActiveJob(jobId);
  }, [jobId]);

  useEffect(() => {
    writePersistedQueue(
      queue.length > 0 || (queueTotal > 1 && podcastEpisodeSourceUrl)
        ? {
            queue,
            queueTotal,
            episodeDate: podcastEpisodeDate,
            episodeSourceUrl: podcastEpisodeSourceUrl,
          }
        : null,
    );
  }, [queue, queueTotal, podcastEpisodeDate, podcastEpisodeSourceUrl]);

  useEffect(() => {
    const savedJobId = readActiveJob();
    if (!savedJobId) {
      setResuming(false);
      if (queueRef.current.length > 0) {
        void advanceQueue('Resumed your episode queue.');
      } else {
        setPodcastEpisodeDate(null);
        setPodcastEpisodeSourceUrl('');
        setQueueTotal(0);
      }
      return;
    }
    let cancelled = false;
    void getMiningJob(savedJobId).then(
      (job) => {
        if (cancelled) return;
        if (job.status === 'error') {
          clearActiveJob();
          if (queueRef.current.length > 0) {
            void advanceQueue(`${job.error ?? 'The previous mining job failed.'} — skipped to the next episode.`);
          } else {
            setError(job.error ?? 'The previous mining job failed.');
          }
        } else {
          applyResumedJob(savedJobId, job);
        }
        setResuming(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        clearActiveJob();
        const message = `Could not reconnect to your last mining job: ${
          err instanceof Error ? err.message : 'unknown error'
        }`;
        if (queueRef.current.length > 0) void advanceQueue(`${message} — skipped to the next episode.`);
        else setError(message);
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
            failCurrent(job.error ?? 'Mining failed');
          } else if (job.status === 'ready') {
            setSource(job.source ?? null);
            setTranscriptSource(job.transcriptSource ?? null);
            setTranscript(transcriptFromJob(job));
            setStage('combine');
          }
        },
        (err: unknown) => {
          if (cancelled) return;
          failCurrent(err instanceof Error ? err.message : 'Failed to check job status');
        },
      );
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [stage, jobId]);

  function reset() {
    if (jobId) {
      void deleteAssistRun(jobId);
      void deleteMiningJob(jobId);
    }
    for (const queued of queueRef.current) {
      if (queued.jobId) void deleteMiningJob(queued.jobId);
    }
    queueRef.current = [];
    prefetchingRef.current = null;
    setQueue([]);
    setQueueTotal(0);
    setPodcastSelected(new Set());
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
    setExtras(null);
    setReplyWarnings([]);
    setAssistFailure('');
    setAssistProgress('');
    setExtrasFailure('');
    setExtrasProgress('');
    setSentenceIdByHandle(new Map());
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
    setPodcastSelected(new Set());
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

  async function handleStartSelectedEpisodes() {
    const picked = sortedPodcastEpisodes.filter((episode) => podcastSelected.has(episode.url));
    const [first, ...rest] = picked;
    if (!first) return;
    prefetchingRef.current = null;
    queueRef.current = rest.map((episode) => ({ episode }));
    setQueue(queueRef.current);
    setQueueTotal(picked.length);
    setPodcastSelected(new Set());
    await handleStartPodcastEpisode(first);
  }

  function toggleEpisodeSelected(url: string) {
    setPodcastSelected((current) => {
      const next = new Set(current);
      if (!next.delete(url)) next.add(url);
      return next;
    });
  }

  /** Move on to the next queued episode, resuming its background job if one was prefetched. */
  async function advanceQueue(notice?: string): Promise<void> {
    const [head, ...rest] = queueRef.current;
    if (!head) return;
    queueRef.current = rest;
    setQueue(rest);
    prefetchingRef.current = null;
    setRows([]);
    setExtras(null);
    setReplyWarnings([]);
    setAssistFailure('');
    setAssistProgress('');
    setExtrasFailure('');
    setExtrasProgress('');
    setSentenceIdByHandle(new Map());
    setPreview(null);
    setPasted('');
    setPasteStatus('');
    setSource(null);
    setTranscript([]);
    setTranscriptSource(null);
    setBusy(false);
    setBusyNote('');
    setPodcastEpisodeDate(head.episode.publishedAt ?? null);
    setPodcastEpisodeSourceUrl(head.episode.url);
    if (head.jobId) {
      try {
        const job = await getMiningJob(head.jobId);
        if (job.status !== 'error') {
          applyResumedJob(head.jobId, job);
          setError(notice ?? '');
          return;
        }
      } catch {
        // fall through and start it fresh
      }
    }
    const started = startJob(head.episode.url, { title: head.episode.title, sourceType: 'podcast' });
    if (notice) setError(notice);
    await started;
  }

  function failCurrent(message: string): void {
    if (queueRef.current.length > 0) {
      void advanceQueue(`${message} — skipped to the next episode.`);
    } else {
      setError(message);
      setStage('idle');
    }
  }

  useEffect(() => {
    if (stage !== 'combine' && stage !== 'review') return;
    const head = queue[0];
    if (!head || head.jobId || prefetchingRef.current === head.episode.url) return;
    prefetchingRef.current = head.episode.url;
    void createMiningJob(head.episode.url, {
      title: head.episode.title,
      sourceType: 'podcast',
    }).then(
      (id) => {
        if (!queueRef.current.some((item) => item.episode.url === head.episode.url)) {
          void deleteMiningJob(id);
          return;
        }
        const withJob = queueRef.current.map((item) =>
          item.episode.url === head.episode.url ? { ...item, jobId: id } : item,
        );
        queueRef.current = withJob;
        setQueue(withJob);
      },
      () => {
        // Prefetch is best-effort; advanceQueue starts the job itself if this failed.
      },
    );
  }, [stage, queue]);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(formatCombinedPromptForAI(transcript, promptOptions));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setPasteStatus('Copy failed — select the text above and copy it manually.');
    }
  }

  function downloadPrompt() {
    downloadTextFile(COMBINED_PROMPT_FILENAME, formatCombinedPromptForAI(transcript, promptOptions));
  }

  async function sendToAssistant() {
    if (!jobId || assistRunning) return;
    setAssistFailure('');
    setPartialRun(null);
    setAssistProgress('Starting…');
    setAssistRunning(true);
    try {
      const run = await startAssistRun({ runId: jobId, transcript, options: promptOptions });
      if (run.status !== 'running') finishAssistRun(run);
    } catch (err) {
      setAssistRunning(false);
      setAssistProgress('');
      setAssistFailure(err instanceof Error ? err.message : 'Could not start the assistant.');
    }
  }

  function stopAssistant() {
    if (jobId) void cancelAssistRun(jobId);
  }

  /** Review what the box produced so far: the sentences, plus whichever extras finished. */
  function reviewAssistRun(run: AssistRunStatus) {
    if (!run.sentencesReply) return;
    const applied = applyReply(run.sentencesReply, NO_EXTRAS);
    if (applied && run.extras && hasQuickImportExtras(run.extras)) setExtras(run.extras);
  }

  function finishAssistRun(run: AssistRunStatus) {
    setAssistRunning(false);
    setAssistProgress('');
    if (run.status === 'done') {
      reviewAssistRun(run);
      return;
    }
    if (run.status === 'cancelled') return;
    setPartialRun(run.sentencesReply ? run : null);
    setAssistFailure(
      `${run.failure ?? 'The assistant run stopped.'} Press "Resume with assistant" to continue from the saved parts, or use the prompt manually.`,
    );
  }

  useEffect(() => {
    if (stage !== 'combine' || !jobId) return;
    let cancelled = false;
    const check = async (first: boolean) => {
      try {
        const run = await getAssistRun(jobId);
        if (cancelled || !run) return;
        if (run.status === 'running') {
          setAssistRunning(true);
          setAssistProgress(run.progress);
          return;
        }
        // A run that finished while this page was closed is picked up once;
        // after that, going back to this step must not re-apply it over edits.
        if (first && !attachedRunRef.current.has(jobId)) {
          attachedRunRef.current.add(jobId);
          finishAssistRun(run);
        } else if (assistRunningRef.current) {
          finishAssistRun(run);
        }
      } catch {
        // transient: the next poll retries
      }
    };
    void check(true);
    const timer = setInterval(() => void check(false), ASSIST_RUN_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, jobId]);


  async function generateExtras(given?: QuickRow[]) {
    const source = given ?? rows;
    if (!jobId || extrasRunning || source.length === 0) return;
    const sentences = source.map((row) => ({
      handle: row.handle,
      japanese: row.japanese,
      translation: row.translation,
    }));
    const tasks = planExtraTasks(sentences, promptOptions);
    if (tasks.length === 0) return;
    const storageKey = `${ASSIST_EXTRAS_KEY_PREFIX}${jobId}`;
    let kept: Record<string, string> = {};
    try {
      const raw = localStorage.getItem(storageKey);
      const parsedKept: unknown = raw ? JSON.parse(raw) : {};
      if (parsedKept && typeof parsedKept === 'object' && !Array.isArray(parsedKept)) {
        kept = Object.fromEntries(
          Object.entries(parsedKept).filter(([, value]) => typeof value === 'string'),
        ) as Record<string, string>;
      }
    } catch {
      kept = {};
    }
    assistCancelRef.current = false;
    const startedJobId = jobId;
    const movedOn = () => jobIdRef.current !== startedJobId;
    setExtrasRunning(true);
    setExtrasFailure('');
    const result = await runExtraTasks({
      tasks,
      sentences,
      replies: kept,
      run: (prompt) =>
        runAssist(prompt, { isCancelled: () => assistCancelRef.current || movedOn() }),
      onTaskDone: (taskId, reply) => {
        kept[taskId] = reply;
        localStorage.setItem(storageKey, JSON.stringify(kept));
      },
      onProgress: (p) =>
        setExtrasProgress(
          `${p.task.heading.toLowerCase()} ${p.task.from}–${p.task.to} (${p.position + 1} of ${p.total})${
            p.attempt > 1 ? `, retry ${p.attempt - 1}` : ''
          }${p.backend ? ` — ${p.backend}` : ' — asking the assistant…'}`,
        ),
      isCancelled: () => assistCancelRef.current || movedOn(),
    });
    setExtrasRunning(false);
    setExtrasProgress('');
    // The queue may have advanced to another episode mid-run; its S-numbers must not receive these replies.
    if (result.cancelled || movedOn()) return;
    if (result.failure) {
      const done = Object.keys(result.replies).length;
      setExtrasFailure(
        `Stopped at ${result.failure.task.heading.toLowerCase()} S${result.failure.task.from}–S${result.failure.task.to} after ${MAX_ATTEMPTS_PER_CHUNK} tries: ${result.failure.error} ` +
          `${done} of ${tasks.length} parts saved — press "Resume extras" to continue, or commit without the rest.`,
      );
      return;
    }
    localStorage.removeItem(storageKey);
    setExtras(mergeExtraReplies(tasks, result.replies));
  }

  function applyReply(
    reply: string,
    options: Required<CombinedPromptOptions> = promptOptions,
  ): QuickRow[] | null {
    const fallbackEndMs = transcript.at(-1)?.endMs ?? 0;
    const sections = splitCombinedReply(reply);
    const parsed = parseAiCombinedReply(sections.sentences, fallbackEndMs);
    if (parsed.length === 0) {
      setPasteStatus(
        "Couldn't read any \"[m:ss] japanese || english\" lines from that — use the assistant's reply (or its file) as-is.",
      );
      return null;
    }
    setReplyWarnings(
      checkCombinedReply({ reply, sections, rows: parsed, transcript, options }),
    );
    const numbered = parsed.map((row, index) => ({ ...row, handle: index + 1 }));
    setRows(numbered);
    setExtras(hasQuickImportExtras(sections) ? sections : null);
    setPasteStatus('');
    setPasted('');
    setStage('review');
    return numbered;
  }

  function applyPasted() {
    applyReply(pasted);
  }

  async function handleReplyFile(file: File | undefined) {
    if (!file) return;
    try {
      applyReply(await file.text());
    } catch {
      setPasteStatus('Could not read that file — upload the plain-text file the assistant generated.');
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
        const clipIdByHandle = new Map<number, string>();
        if (clipped.length === rows.length) {
          clipped.forEach(({ clip }, index) => clipIdByHandle.set(rows[index]!.handle, clip.sentenceId));
        }
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
        const builtPreview = buildShadowingPreview(
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
        );
        // The clip ids are temporary; the committed sentence id is the preview's proposedId.
        const clipById = new Map(clipped.map(({ clip }) => [clip.sentenceId, clip]));
        const idByHandle = new Map<number, string>();
        clipIdByHandle.forEach((clipId, handle) => {
          const clip = clipById.get(clipId);
          if (!clip) return;
          const key = normalizeSentenceKey(displayJapanese(clip.japanese));
          const item = builtPreview.drafts.find((candidate) => candidate.draft.normalizedKey === key);
          if (item?.proposedId) idByHandle.set(handle, item.proposedId);
        });
        setSentenceIdByHandle(idByHandle);
        setPreview(builtPreview);
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
        if (importedPodcastSourceIds?.has(canonicalSourceId(job.url))) return false;
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
              <NamedPodcastFeedPicker url={podcastFeedUrl} onSelectUrl={setPodcastFeedUrl} />
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
                  <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() =>
                        setPodcastSelected((current) => {
                          const next = new Set(current);
                          for (const episode of visiblePodcastEpisodes) {
                            if (!importedPodcastSourceIds?.has(canonicalSourceId(episode.url))) next.add(episode.url);
                          }
                          return next;
                        })
                      }
                    >
                      Select page
                    </button>
                    <button
                      type="button"
                      disabled={podcastSelected.size === 0}
                      onClick={() => setPodcastSelected(new Set())}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={podcastSelected.size === 0}
                      onClick={() => void handleStartSelectedEpisodes()}
                    >
                      Import {podcastSelected.size || ''} selected →
                    </button>
                  </div>
                  <div className="stack" style={{ gap: '0.25rem', maxHeight: '16rem', overflowY: 'auto' }}>
                    {visiblePodcastEpisodes.map((episode) => {
                      const imported = importedPodcastSourceIds?.has(canonicalSourceId(episode.url));
                      const publishedDate = episode.publishedAt ? new Date(episode.publishedAt) : null;
                      return (
                        <div key={episode.url} className="row" style={{ gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${episode.title}`}
                          checked={podcastSelected.has(episode.url)}
                          onChange={() => toggleEpisodeSelected(episode.url)}
                        />
                        <button
                          type="button"
                          className="row"
                          style={{ flex: 1, justifyContent: 'space-between', textAlign: 'left', gap: '1rem' }}
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
                        </div>
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
        {queueTotal > 1 && stage !== 'idle' ? (
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            Episode {queueTotal - queue.length} of {queueTotal}
            {queue.length > 0 ? ` — "${queue[0]!.episode.title}" is next` : ' — last one'}
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
            Copy or download this prompt for ChatGPT / Claude. It asks the assistant to
            return one file; upload that file below (or paste its text).
          </p>
          <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
            {EXTRA_OPTION_LABELS.map(({ key, label }) => (
              <label key={key} className="row" style={{ gap: '0.3rem' }}>
                <input
                  type="checkbox"
                  checked={promptOptions[key]}
                  onChange={(event) =>
                    setPromptOptions((current) => ({ ...current, [key]: event.target.checked }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
          {transcript.length > LONG_TRANSCRIPT_FRAGMENTS &&
          Object.values(promptOptions).some(Boolean) ? (
            <div className="muted">
              This is a long transcript — with every extra on, the assistant's reply may be cut
              off. Untick some extras (the book page can ask for them later) if that happens.
            </div>
          ) : null}
          <div className="stack" style={{ gap: '0.35rem' }}>
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <button
                type="button"
                className="primary"
                disabled={assistRunning || !jobId}
                onClick={() => void sendToAssistant()}
              >
                {assistFailure ? 'Resume with assistant' : 'Send to assistant'}
              </button>
              {assistRunning ? (
                <button type="button" onClick={stopAssistant}>
                  Stop
                </button>
              ) : null}
              {assistProgress ? <span className="muted">{assistProgress}</span> : null}
            </div>
            <div className="muted">
              Runs Codex (Claude as backup) on the server in small parts, segmenting and
              translating, then generates the ticked extras above too. It keeps going if you close
              this page — come back to this import and the result is picked up. A part is retried
              once; after that it stops and keeps what's done.
            </div>
            {assistFailure ? <div className="error">{assistFailure}</div> : null}
            {assistFailure && partialRun ? (
              <div>
                <button type="button" onClick={() => reviewAssistRun(partialRun)}>
                  Review the sentences now (skip the rest)
                </button>
              </div>
            ) : null}
          </div>
          <textarea
            readOnly
            className="jp"
            rows={10}
            value={formatCombinedPromptForAI(transcript, promptOptions)}
          />
          <div className="row">
            <button type="button" onClick={() => void copyPrompt()}>
              {copied ? 'Copied ✓' : 'Copy prompt'}
            </button>
            <button type="button" onClick={downloadPrompt}>
              Download prompt file
            </button>
            <label className="button">
              Upload reply file…
              <input
                type="file"
                accept=".txt,.md,.text,text/plain,text/markdown"
                style={{ display: 'none' }}
                onChange={(event) => {
                  void handleReplyFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
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

      {stage === 'review' && replyWarnings.length > 0 ? (
        <section className="panel stack" style={{ borderColor: 'var(--warning)', gap: '0.35rem' }}>
          <strong style={{ color: 'var(--warning)' }}>⚠ This reply may be incomplete</strong>
          {replyWarnings.map((warning) => (
            <span key={warning} className="muted" style={{ fontSize: '0.9em' }}>
              {warning}
            </span>
          ))}
          <span className="muted" style={{ fontSize: '0.9em' }}>
            You can still import it as-is, or go back and ask the assistant to continue.
          </span>
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
          <section className="panel stack" style={{ gap: '0.5rem' }}>
            <strong>Extras with the assistant</strong>
            <div className="muted">
              &ldquo;Send to assistant&rdquo; runs these automatically after the sentences. Use
              this to resume a stopped run, or to regenerate after you&rsquo;ve removed or edited
              sentences. They&rsquo;re saved when you commit.
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
              {EXTRA_OPTION_LABELS.map(({ key, label }) => (
                <label key={key} className="row" style={{ gap: '0.3rem' }}>
                  <input
                    type="checkbox"
                    checked={promptOptions[key]}
                    disabled={extrasRunning}
                    onChange={(event) =>
                      setPromptOptions((current) => ({ ...current, [key]: event.target.checked }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <button
                type="button"
                className="primary"
                disabled={extrasRunning || busy || !Object.values(promptOptions).some(Boolean)}
                onClick={() => void generateExtras()}
              >
                {extrasFailure ? 'Resume extras' : extras ? 'Regenerate extras' : 'Generate extras'}
              </button>
              {extrasRunning ? (
                <button type="button" onClick={() => (assistCancelRef.current = true)}>
                  Stop
                </button>
              ) : null}
              {extrasProgress ? <span className="muted">{extrasProgress}</span> : null}
            </div>
            {extrasFailure ? <div className="error">{extrasFailure}</div> : null}
            {extras && !extrasRunning && !extrasFailure ? (
              <div className="muted">Extras are ready and will be saved with the commit.</div>
            ) : null}
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
            onImported={async (result) => {
              if (extras) {
                const maxHandle = rows.reduce((max, row) => Math.max(max, row.handle), 0);
                const byNumber = Array.from({ length: maxHandle }, (_, i) => sentenceIdByHandle.get(i + 1));
                try {
                  await applyQuickImportExtras(result.bookId, result.chapterId, extras, byNumber);
                } catch (err) {
                  console.error('Quick import extras failed', err);
                }
              }
              if (jobId) {
                void deleteAssistRun(jobId);
                void deleteMiningJob(jobId);
              }
              if (queueRef.current.length > 0) {
                await advanceQueue();
                return;
              }
              clearActiveJob();
              writePersistedQueue(null);
              navigate(
                result.chapterId
                  ? `/books/${result.bookId}/read?chapter=${encodeURIComponent(result.chapterId)}&pack=1&imported=1`
                  : `/books/${result.bookId}?imported=1`,
              );
            }}
            onCancel={() => setStage('review')}
          />
        </section>
      ) : null}
    </div>
  );
}
