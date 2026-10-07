import { getDb } from '../db/database';
import type { ContextWalkthrough } from '../domain/types';
import {
  WALKTHROUGH_SHAPE,
  buildWalkthroughInstructions,
  mergeChapterWalkthroughs,
  parseWalkthroughs,
  sentencesNeedingUpgrade,
  sentencesNeedingWalkthrough,
  walkthroughContextLines,
} from './contextWalkthrough';
import { EPISODE_PREPARATION_VERSION, extractJson } from './episodePreparation';

// Book-wide import of contextual walkthroughs for books prepared before they existed. Handles are the
// sentence's position in the whole book (S1..Sn), so several prompt files and replies can be applied one
// after another; each reply merges into the chapters and later replies never disturb earlier ones.

export interface BookWalkthroughPlan {
  title: string;
  /** Every distinct book sentence in order; the handle of index i is `S${i + 1}`. */
  sentences: { id: string; japanese: string; translation?: string; chapterId: string }[];
  /** Handles still needing work, in book order: first those with none, then older-format ones to enrich. */
  pending: string[];
  /** Subset of `pending` that have no walkthrough at all. */
  missing: string[];
  /** Subset of `pending` that have an older-format walkthrough (kept and shown until a richer reply replaces it). */
  outdated: string[];
  /** Sentences already on the current format. */
  current: number;
}

export const BOOK_WALKTHROUGH_BATCH_SIZE = 12;

/** The next batch to request. Stateless: whatever is still pending after a partial or failed reply is simply requested again. */
export function nextWalkthroughBatch(plan: Pick<BookWalkthroughPlan, 'pending'>, size = BOOK_WALKTHROUGH_BATCH_SIZE): string[] {
  return plan.pending.slice(0, size);
}

export async function planBookWalkthroughs(bookId: string): Promise<BookWalkthroughPlan> {
  const db = getDb();
  const [book, memberships] = await Promise.all([db.books.get(bookId), db.bookSentences.where('bookId').equals(bookId).sortBy('position')]);
  const seen = new Set<string>();
  const unique = memberships.filter((m) => m.chapterId && !seen.has(m.sentenceId) && seen.add(m.sentenceId));
  const rows = await db.sentences.bulkGet(unique.map((m) => m.sentenceId));
  const sentences: BookWalkthroughPlan['sentences'] = [];
  unique.forEach((m, i) => {
    const row = rows[i];
    if (row) sentences.push({ id: row.id, japanese: row.japanese, translation: row.translation?.trim() || undefined, chapterId: m.chapterId! });
  });
  const drafts = mergeChapterWalkthroughs(book?.chapters ?? []);
  const handleOf = new Map(sentences.map((s, i) => [s.id, `S${i + 1}`]));
  const missing = sentencesNeedingWalkthrough(sentences, drafts).map((id) => handleOf.get(id)!);
  const outdated = sentencesNeedingUpgrade(sentences, drafts).map((id) => handleOf.get(id)!);
  return {
    title: book?.title ?? '',
    sentences,
    pending: [...missing, ...outdated],
    missing,
    outdated,
    current: sentences.length - missing.length - outdated.length,
  };
}

export function formatBookWalkthroughPrompt(plan: BookWalkthroughPlan, handles: string[]): string {
  const byHandle = new Map(plan.sentences.map((s, i) => [`S${i + 1}`, s]));
  return [
    `You are helping a Japanese learner study a book: "${plan.title}".`,
    '',
    ...buildWalkthroughInstructions(),
    '',
    'SURROUNDING SENTENCES (read-only context, in order; "..." marks a gap):',
    ...walkthroughContextLines(plan, handles),
    '',
    'EXPLAIN THESE:',
    ...handles.map((handle) => `${handle}: ${byHandle.get(handle)?.japanese ?? ''}`),
    '',
    'Reply with ONLY this JSON, nothing else, using plain straight quotes. Save it to a file named walkthrough-reply.json if you can create files:',
    JSON.stringify({ version: EPISODE_PREPARATION_VERSION, walkthroughs: WALKTHROUGH_SHAPE }, null, 2),
    'Every "text" and "to" must be copied exactly from the sentence it names. Give every sentence listed under EXPLAIN THESE.',
  ].join('\n');
}

export interface BookWalkthroughReply {
  byChapter: Map<string, Record<string, ContextWalkthrough>>;
  saved: number;
  rejected: { handle: string; reason: string }[];
  error?: string;
}

/** Accepts `{walkthroughs: {...}}` or a bare handle-keyed object; handles are book positions. */
export function parseBookWalkthroughReply(reply: string, plan: BookWalkthroughPlan): BookWalkthroughReply {
  const empty = { byChapter: new Map<string, Record<string, ContextWalkthrough>>(), saved: 0, rejected: [] };
  let raw: unknown;
  try {
    raw = extractJson(reply);
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : 'Could not read the reply as JSON.' };
  }
  const object = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const walkthroughs = 'walkthroughs' in object ? object.walkthroughs : object;
  const parsed = parseWalkthroughs(walkthroughs, plan);
  const chapterBySentence = new Map(plan.sentences.map((s) => [s.id, s.chapterId]));
  const byChapter = new Map<string, Record<string, ContextWalkthrough>>();
  for (const [sentenceId, walkthrough] of parsed.drafts) {
    const chapterId = chapterBySentence.get(sentenceId);
    if (chapterId) byChapter.set(chapterId, { ...byChapter.get(chapterId), [sentenceId]: walkthrough });
  }
  return { byChapter, saved: parsed.drafts.size, rejected: parsed.rejected };
}
