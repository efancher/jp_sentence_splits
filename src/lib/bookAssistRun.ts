/**
 * Box-side assistant run for an EXISTING book's extras (structure, constructions,
 * walkthroughs, comprehension, particles). Pure and node-safe like `assistRun.ts`:
 * the browser decides which sentences each extra covers, the runner just works
 * through them and saves every finished piece so a stopped run resumes.
 *
 * Handles are book-wide S-numbers (position in the whole book + 1), so pieces
 * from different ranges merge without remapping.
 */
import { describeStop } from './assistChunks';
import { EXTRA_RANGE_SENTENCES, mergeExtraReplies, runExtraTasks, type ExtraTask, type ExtrasSentence } from './assistExtras';
import { singleExtraBlock, type CombinedReplySections, type ExtraKind } from './combinedImportPrompt';
import type { AssistBackend, AssistRunState } from './assistRun';

export const BOOK_EXTRA_KINDS = ['structure', 'constructions', 'walkthroughs', 'comprehension', 'particles'] as const;
export type BookExtraKind = (typeof BOOK_EXTRA_KINDS)[number];

/** Handles (1-based book positions) each extra should be generated for. */
export type BookExtraSelection = Partial<Record<BookExtraKind, number[]>>;

export interface BookAssistRunSpec {
  /** The whole book in order; `handle` must equal position + 1. Only the selected handles get output, the rest is context. */
  sentences: ExtrasSentence[];
  selection: BookExtraSelection;
  backend?: AssistBackend;
}

const CONTEXT_BEFORE = 3;
const CONTEXT_AFTER = 2;

/** One task per run of consecutive selected sentences (at most `rangeSize` long). */
export function planBookExtraTasks(
  sentences: ExtrasSentence[],
  selection: BookExtraSelection,
  rangeSize = EXTRA_RANGE_SENTENCES,
): ExtraTask[] {
  const tasks: ExtraTask[] = [];
  for (const kind of BOOK_EXTRA_KINDS) {
    const handles = [...new Set(selection[kind] ?? [])]
      .filter((handle) => handle >= 1 && handle <= sentences.length)
      .sort((a, b) => a - b);
    const heading = singleExtraBlock(kind).heading;
    let run: number[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const from = run[0]!;
      const to = run[run.length - 1]!;
      const start = from - 1;
      const end = to - 1;
      tasks.push({
        id: `${kind}:${from}-${to}`,
        kind,
        heading,
        from,
        to,
        coveredFrom: start,
        coveredTo: end,
        shownFrom: Math.max(0, start - CONTEXT_BEFORE),
        shownTo: Math.min(sentences.length - 1, end + CONTEXT_AFTER),
      });
      run = [];
    };
    for (const handle of handles) {
      const last = run[run.length - 1];
      if (last !== undefined && (handle !== last + 1 || run.length >= rangeSize)) flush();
      run.push(handle);
    }
    flush();
  }
  return tasks;
}

/** Finished pieces for one kind, joined into the reply section the importer already understands. */
export function mergeBookExtraReplies(kind: BookExtraKind, replies: Readonly<Record<string, string>>): CombinedReplySections {
  const tasks = Object.keys(replies)
    .filter((id) => id.startsWith(`${kind}:`))
    .map((id) => ({ id, kind: kind as ExtraKind }) as ExtraTask);
  return mergeExtraReplies(tasks, replies);
}

export async function runBookExtrasPipeline(input: {
  spec: BookAssistRunSpec;
  state: AssistRunState;
  run: (prompt: string) => Promise<{ reply: string; backend: string | null }>;
  save: (state: AssistRunState) => void;
  isCancelled: () => boolean;
}): Promise<AssistRunState> {
  const { spec, state } = input;
  const update = (patch: Partial<AssistRunState>) => {
    Object.assign(state, patch, { updatedAt: Date.now() });
    input.save(state);
  };
  const tasks = planBookExtraTasks(spec.sentences, spec.selection);
  update({ status: 'running', phase: 'extras', failure: null });
  if (tasks.length === 0) {
    update({ status: 'done', phase: null, progress: '' });
    return state;
  }
  const result = await runExtraTasks({
    tasks,
    sentences: spec.sentences,
    replies: state.extraReplies,
    run: input.run,
    onTaskDone: (taskId, reply) => update({ extraReplies: { ...state.extraReplies, [taskId]: reply } }),
    onProgress: (p) =>
      update({
        progress: `${p.task.heading.toLowerCase()} S${p.task.from}–S${p.task.to} (${p.position + 1} of ${p.total})${
          p.attempt > 1 ? `, retry ${p.attempt - 1}` : ''
        }${p.backend ? ` — ${p.backend}` : ' — asking the assistant…'}`,
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
      failure: describeStop(
        `${result.failure.task.heading.toLowerCase()} S${result.failure.task.from}–S${result.failure.task.to}`,
        result.failure.error,
        `${done} of ${tasks.length} parts saved`,
      ),
    });
    return state;
  }
  update({ status: 'done', phase: null, progress: '' });
  return state;
}
