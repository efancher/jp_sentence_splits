/**
 * Box-side assistant run for an EXISTING book's extras (structure, constructions,
 * walkthroughs, comprehension, particles). Pure and node-safe like `assistRun.ts`:
 * the browser decides which sentences each extra covers, the runner just works
 * through them and saves every finished piece so a stopped run resumes.
 *
 * Handles are book-wide S-numbers (position in the whole book + 1), so pieces
 * from different ranges merge without remapping.
 */
import { describeStop, otherFailures } from './assistChunks';
import { EXTRA_RANGE_SENTENCES, describeTaskRange, mergeExtraReplies, runExtraTasks, type ExtraTask, type ExtrasSentence } from './assistExtras';
import { singleExtraBlock, type CombinedReplySections, type ExtraKind } from './combinedImportPrompt';
import { logPatch, type AssistBackend, type AssistRunState } from './assistRun';

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

export const BOOK_EXTRA_RANGE_SENTENCES = 100;
/** Walkthroughs are far more output per sentence; 100 per call outran the assistant timeout. */
const WALKTHROUGH_RANGE_SENTENCES = EXTRA_RANGE_SENTENCES;

function rangeSizeFor(kind: BookExtraKind, fallback: number): number {
  return kind === 'walkthroughs' ? Math.min(fallback, WALKTHROUGH_RANGE_SENTENCES) : fallback;
}
const CONTEXT_BEFORE = 3;
const CONTEXT_AFTER = 2;

/** Short stable fingerprint so a piece's id changes if its set of sentences does. */
function handleFingerprint(handles: number[]): string {
  let hash = 0;
  for (const handle of handles) hash = (Math.imul(hash, 31) + handle) >>> 0;
  return hash.toString(36);
}

/**
 * Selected sentences are grouped `rangeSize` at a time in book order, gaps included, so scattered
 * sentences share one assistant call (each shown with its neighbours as context) instead of costing a call per gap.
 */
export function planBookExtraTasks(
  sentences: ExtrasSentence[],
  selection: BookExtraSelection,
  rangeSize = BOOK_EXTRA_RANGE_SENTENCES,
): ExtraTask[] {
  const tasks: ExtraTask[] = [];
  for (const kind of BOOK_EXTRA_KINDS) {
    const handles = [...new Set(selection[kind] ?? [])]
      .filter((handle) => handle >= 1 && handle <= sentences.length)
      .sort((a, b) => a - b);
    const heading = singleExtraBlock(kind).heading;
    const size = rangeSizeFor(kind, rangeSize);
    for (let at = 0; at < handles.length; at += size) {
      const group = handles.slice(at, at + size);
      const from = group[0]!;
      const to = group[group.length - 1]!;
      const contiguous = to - from + 1 === group.length;
      const start = from - 1;
      const end = to - 1;
      tasks.push({
        id: contiguous ? `${kind}:${from}-${to}` : `${kind}:${from}-${to}~${handleFingerprint(group)}`,
        kind,
        heading,
        from,
        to,
        coveredFrom: start,
        coveredTo: end,
        shownFrom: Math.max(0, start - CONTEXT_BEFORE),
        shownTo: Math.min(sentences.length - 1, end + CONTEXT_AFTER),
        ...(contiguous ? {} : { handles: group }),
      });
    }
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
        progress: `${p.task.heading.toLowerCase()} ${describeTaskRange(p.task)} (${p.position + 1} of ${p.total})${
          p.attempt > 1 ? `, retry ${p.attempt - 1}` : ''
        }${p.backend ? ` — ${p.backend}` : ' — asking the assistant…'}`,
      }),
    onNote: (text) => update(logPatch(state, text)),
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
        `${result.failure.task.heading.toLowerCase()} ${describeTaskRange(result.failure.task)}`,
        result.failure.error,
        `${done} of ${tasks.length} parts saved${otherFailures(result.failures)}`,
      ),
    });
    return state;
  }
  update({ status: 'done', phase: null, progress: '' });
  return state;
}
