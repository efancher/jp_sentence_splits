/**
 * The whole "Send to assistant" pipeline for Quick import as one resumable
 * run: segment+translate in parts, then every ticked extra. Pure and
 * node-safe — it runs on the mining box (`scripts/assist-run.ts`) so the
 * browser can close; the page just starts a run and polls its state.
 * The state is the only thing that persists, and is saved after every
 * finished piece, so a stopped/failed/interrupted run resumes without
 * repeating work.
 */
import { MAX_ATTEMPTS_PER_CHUNK, chunkTranscript, mergeChunkReplies, runSegmentChunks } from './assistChunks';
import {
  mergeExtraReplies,
  planExtraTasks,
  runExtraTasks,
  type ExtrasSentence,
} from './assistExtras';
import { splitCombinedReply, type CombinedPromptOptions, type CombinedReplySections } from './combinedImportPrompt';
import { parseAiCombinedReply } from './miningQuickImport';
import type { WizardTranscriptSeg } from './miningTranscript';

export type AssistRunStatus = 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';

export interface AssistRunSpec {
  transcript: WizardTranscriptSeg[];
  options: CombinedPromptOptions;
}

export interface AssistRunState {
  status: AssistRunStatus;
  phase: 'sentences' | 'extras' | null;
  /** Human-readable line for the UI, e.g. "Part 2 of 5 — codex". */
  progress: string;
  failure: string | null;
  /** Finished segment parts by chunk index (null = still to do). */
  segmentReplies: (string | null)[];
  /** Finished extra pieces by task id. */
  extraReplies: Record<string, string>;
  /** Merged `=== SENTENCES ===` reply, set once every segment part is done. */
  sentencesReply: string | null;
  /** Merged extras so far (complete once status is `done`). */
  extras: CombinedReplySections | null;
  updatedAt: number;
}

export function emptyAssistRunState(): AssistRunState {
  return {
    status: 'running',
    phase: null,
    progress: 'Starting…',
    failure: null,
    segmentReplies: [],
    extraReplies: {},
    sentencesReply: null,
    extras: null,
    updatedAt: Date.now(),
  };
}

export async function runAssistPipeline(input: {
  spec: AssistRunSpec;
  state: AssistRunState;
  run: (prompt: string) => Promise<{ reply: string; backend: string | null }>;
  save: (state: AssistRunState) => void;
  isCancelled: () => boolean;
}): Promise<AssistRunState> {
  const { spec, run } = input;
  const state = input.state;
  const update = (patch: Partial<AssistRunState>) => {
    Object.assign(state, patch, { updatedAt: Date.now() });
    input.save(state);
  };
  const via = (backend: string | null) => (backend ? ` — ${backend}` : ' — asking the assistant…');

  const chunks = chunkTranscript(spec.transcript);
  if (state.segmentReplies.length !== chunks.length) {
    update({ segmentReplies: chunks.map(() => null), sentencesReply: null, extras: null });
  }
  update({ status: 'running', phase: 'sentences', failure: null });

  if (!state.sentencesReply) {
    const result = await runSegmentChunks({
      chunks,
      replies: state.segmentReplies,
      run,
      onChunkDone: (index, reply) => {
        const segmentReplies = [...state.segmentReplies];
        segmentReplies[index] = reply;
        update({ segmentReplies });
      },
      onProgress: (p) =>
        update({
          progress: `Sentences: part ${p.index + 1} of ${p.total}${
            p.attempt > 1 ? ` (retry ${p.attempt - 1})` : ''
          }${via(p.backend)}`,
        }),
      isCancelled: input.isCancelled,
    });
    if (result.cancelled) {
      update({ status: 'cancelled', progress: 'Stopped.' });
      return state;
    }
    if (result.failure) {
      const done = result.replies.filter(Boolean).length;
      update({
        status: 'failed',
        progress: '',
        failure:
          `Stopped at part ${result.failure.index + 1} of ${chunks.length} after ${MAX_ATTEMPTS_PER_CHUNK} tries: ` +
          `${result.failure.error} ${done} part${done === 1 ? '' : 's'} saved — resume to continue from there.`,
      });
      return state;
    }
    update({ sentencesReply: mergeChunkReplies(result.replies.filter((r): r is string => r !== null)) });
  }

  const wantsExtras = Object.values(spec.options).some(Boolean);
  if (!wantsExtras) {
    update({ status: 'done', phase: null, progress: '' });
    return state;
  }

  const rows = parseAiCombinedReply(
    splitCombinedReply(state.sentencesReply ?? '').sentences,
    spec.transcript.at(-1)?.endMs ?? 0,
  );
  const sentences: ExtrasSentence[] = rows.map((row, index) => ({
    handle: index + 1,
    japanese: row.japanese,
    translation: row.translation,
  }));
  const tasks = planExtraTasks(sentences, spec.options);
  update({ phase: 'extras' });
  const result = await runExtraTasks({
    tasks,
    sentences,
    replies: state.extraReplies,
    run,
    onTaskDone: (taskId, reply) => {
      const extraReplies = { ...state.extraReplies, [taskId]: reply };
      update({ extraReplies, extras: mergeExtraReplies(tasks, extraReplies) });
    },
    onProgress: (p) =>
      update({
        progress: `Extras: ${p.task.heading.toLowerCase()} ${p.task.from}–${p.task.to} (${p.position + 1} of ${p.total})${
          p.attempt > 1 ? `, retry ${p.attempt - 1}` : ''
        }${via(p.backend)}`,
      }),
    isCancelled: input.isCancelled,
  });
  if (result.cancelled) {
    update({ status: 'cancelled', progress: 'Stopped.' });
    return state;
  }
  if (result.failure) {
    const done = Object.keys(result.replies).length;
    update({
      status: 'failed',
      progress: '',
      failure:
        `Stopped at ${result.failure.task.heading.toLowerCase()} S${result.failure.task.from}–S${result.failure.task.to} ` +
        `after ${MAX_ATTEMPTS_PER_CHUNK} tries: ${result.failure.error} ${done} of ${tasks.length} extra parts saved — ` +
        'resume to continue, or commit without the rest.',
    });
    return state;
  }
  update({ status: 'done', phase: null, progress: '', extras: mergeExtraReplies(tasks, result.replies) });
  return state;
}
