/**
 * Automated extras for Quick import: once the sentences are settled, ask the
 * server-side assistant for each ticked extra (structure, comprehension,
 * particles, constructions, walkthroughs) over small ranges of sentences, and
 * focus targets once over the whole episode. Every piece is keyed by the
 * sentences' own handles (S-numbers), so ranges concatenate without any
 * remapping. Pieces are validated one at a time and handed to `onTaskDone` as
 * they land so a stopped run resumes where it left off; a piece gets
 * {@link MAX_ATTEMPTS_PER_CHUNK} tries and then the run stops for the user.
 */
import { MAX_ATTEMPTS_PER_CHUNK } from './assistChunks';
import {
  singleExtraBlock,
  type CombinedPromptOptions,
  type CombinedReplySections,
  type ExtraKind,
} from './combinedImportPrompt';
import { EPISODE_PREPARATION_VERSION, extractJson } from './episodePreparation';

export const EXTRA_RANGE_SENTENCES = 25;
const CONTEXT_BEFORE = 3;
const CONTEXT_AFTER = 2;

export interface ExtrasSentence {
  handle: number;
  japanese: string;
  translation: string;
}

export interface ExtraTask {
  id: string;
  kind: ExtraKind;
  heading: string;
  /** Handles this piece must cover. */
  from: number;
  to: number;
  /** Inclusive positions in the sentence list that are shown (covered ± context). */
  shownFrom: number;
  shownTo: number;
  coveredFrom: number;
  coveredTo: number;
}

const KIND_ORDER: ExtraKind[] = ['structure', 'comprehension', 'particles', 'constructions', 'walkthroughs', 'targets'];

export function planExtraTasks(
  sentences: ExtrasSentence[],
  options: CombinedPromptOptions,
  rangeSize = EXTRA_RANGE_SENTENCES,
): ExtraTask[] {
  const tasks: ExtraTask[] = [];
  if (sentences.length === 0) return tasks;
  for (const kind of KIND_ORDER) {
    if (!options[kind]) continue;
    const heading = singleExtraBlock(kind).heading;
    const size = kind === 'targets' ? sentences.length : rangeSize;
    for (let start = 0; start < sentences.length; start += size) {
      const end = Math.min(start + size, sentences.length) - 1;
      const from = sentences[start]!.handle;
      const to = sentences[end]!.handle;
      tasks.push({
        id: `${kind}:${from}-${to}`,
        kind,
        heading,
        from,
        to,
        coveredFrom: start,
        coveredTo: end,
        shownFrom: kind === 'targets' ? 0 : Math.max(0, start - CONTEXT_BEFORE),
        shownTo: kind === 'targets' ? sentences.length - 1 : Math.min(sentences.length - 1, end + CONTEXT_AFTER),
      });
    }
  }
  return tasks;
}

export function buildExtraPrompt(task: ExtraTask, sentences: ExtrasSentence[]): string {
  const block = singleExtraBlock(task.kind);
  const lines = block.lines.map((line) =>
    line
      .replace('in "STRUCTURE THESE"', 'in the requested range')
      .replace('Cover every sentence from PART 1', 'Cover every sentence in the requested range')
      .replace('You have the whole transcript above', 'You have the neighbouring sentences below')
      .replace(/PART 1/g, 'the numbered sentences'),
  );
  const range =
    task.kind === 'targets'
      ? 'Work across ALL the sentences below.'
      : `Work on ONLY S${task.from} to S${task.to}. Sentences marked (context) are shown for reference — do not produce any output for them.`;
  const shown = sentences
    .slice(task.shownFrom, task.shownTo + 1)
    .map((sentence, offset) => {
      const position = task.shownFrom + offset;
      const covered = position >= task.coveredFrom && position <= task.coveredTo;
      return `${covered ? '' : '(context) '}S${sentence.handle} ${sentence.japanese} || ${sentence.translation}`;
    });
  return [
    'You are helping prepare a Japanese episode for study. The episode\'s sentences are listed below, each numbered S<n>.',
    '',
    `TASK — ${block.heading}.`,
    ...lines,
    '',
    range,
    'Reply with the result as plain text in your message — no attachment, no code fence, no files written, and no commentary.',
    '',
    '--- sentences ---',
    ...shown,
    '',
  ].join('\n');
}

function stripFences(reply: string): string {
  return reply
    .split(/\r?\n/)
    .filter((line) => !/^\s*```/.test(line))
    .join('\n')
    .trim();
}

function jsonObject(reply: string): Record<string, unknown> | null {
  try {
    const raw = extractJson(reply);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Returns an error message when `reply` can't be used for `task`, else null. */
export function validateExtraReply(task: ExtraTask, reply: string): string | null {
  const text = stripFences(reply);
  if (!text) return 'The reply was empty.';
  switch (task.kind) {
    case 'targets': {
      const object = jsonObject(text);
      return object && Array.isArray(object.targets) ? null : 'The reply was not the expected JSON with a "targets" list.';
    }
    case 'constructions': {
      const object = jsonObject(text);
      const value = object?.constructions;
      return value && typeof value === 'object' && !Array.isArray(value)
        ? null
        : 'The reply was not the expected JSON with a "constructions" object.';
    }
    case 'walkthroughs': {
      const object = jsonObject(text);
      const value = object?.walkthroughs;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return 'The reply was not the expected JSON with a "walkthroughs" object.';
      }
      return `S${task.to}` in value ? null : `The walkthroughs stop before S${task.to} — the reply was probably cut off.`;
    }
    case 'structure':
      if (!new RegExp(`(^|\\n)\\s*S${task.to}\\s*\\|`).test(text)) {
        return `The structure lines stop before S${task.to} — the reply was probably cut off.`;
      }
      return null;
    case 'comprehension':
    case 'particles':
      return new RegExp(`=+\\s*Sentence\\s+${task.to}\\s*=+`, 'i').test(text)
        ? null
        : `The reply stops before "Sentence ${task.to}" — it was probably cut off.`;
  }
}

/** Joins the finished pieces (by task id) into the reply sections the commit step already understands. */
export function mergeExtraReplies(
  tasks: ExtraTask[],
  replies: Readonly<Record<string, string>>,
): CombinedReplySections {
  const text = (kind: ExtraKind) =>
    tasks
      .filter((task) => task.kind === kind && replies[task.id])
      .map((task) => stripFences(replies[task.id]!));
  const pack: Record<string, unknown> = { version: EPISODE_PREPARATION_VERSION };
  const targets = text('targets')[0];
  if (targets) pack.targets = (jsonObject(targets)?.targets as unknown[]) ?? [];
  for (const kind of ['constructions', 'walkthroughs'] as const) {
    const pieces = text(kind);
    if (pieces.length === 0) continue;
    pack[kind] = Object.assign({}, ...pieces.map((piece) => (jsonObject(piece)?.[kind] as object) ?? {}));
  }
  return {
    sentences: '',
    pack: Object.keys(pack).length > 1 ? JSON.stringify(pack) : '',
    structure: text('structure').join('\n'),
    comprehension: text('comprehension').join('\n\n'),
    particles: text('particles').join('\n\n'),
  };
}

export interface ExtraProgress {
  task: ExtraTask;
  position: number;
  total: number;
  attempt: number;
  backend: string | null;
}

export interface ExtraRunResult {
  replies: Record<string, string>;
  failure: { task: ExtraTask; error: string } | null;
  cancelled: boolean;
}

export async function runExtraTasks(input: {
  tasks: ExtraTask[];
  sentences: ExtrasSentence[];
  /** Replies kept from an earlier run, by task id. */
  replies: Readonly<Record<string, string>>;
  run: (prompt: string) => Promise<{ reply: string; backend: string | null }>;
  onTaskDone: (taskId: string, reply: string) => void;
  onProgress: (progress: ExtraProgress) => void;
  isCancelled: () => boolean;
}): Promise<ExtraRunResult> {
  const replies: Record<string, string> = {};
  for (const task of input.tasks) {
    const kept = input.replies[task.id];
    if (kept) replies[task.id] = kept;
  }
  for (const [position, task] of input.tasks.entries()) {
    if (replies[task.id]) continue;
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CHUNK; attempt++) {
      if (input.isCancelled()) return { replies, failure: null, cancelled: true };
      input.onProgress({ task, position, total: input.tasks.length, attempt, backend: null });
      try {
        const { reply, backend } = await input.run(buildExtraPrompt(task, input.sentences));
        input.onProgress({ task, position, total: input.tasks.length, attempt, backend });
        const problem = validateExtraReply(task, reply);
        if (problem) {
          lastError = problem;
          continue;
        }
        replies[task.id] = reply;
        input.onTaskDone(task.id, reply);
        break;
      } catch (err) {
        if (input.isCancelled()) return { replies, failure: null, cancelled: true };
        lastError = err instanceof Error ? err.message : 'Assistant failed';
      }
    }
    if (!replies[task.id]) return { replies, failure: { task, error: lastError }, cancelled: false };
  }
  return { replies, failure: null, cancelled: false };
}
