/**
 * Per-episode (chapter) view of sentence-first progress: how many of each
 * chapter's sentences have reached each stage of the learning journey,
 * derived only from lesson events. Read-only; nothing stored or scheduled.
 */
import type { Book, BookSentence, SentenceLearningEvent } from '../domain/types';

export type EpisodeStage = 'unseen' | 'walked' | 'gist' | 'retained' | 'expressed' | 'independent';

export const EPISODE_STAGE_LABELS: Record<EpisodeStage, string> = {
  unseen: 'Not started',
  walked: 'Walked through',
  gist: 'Gist checked',
  retained: 'Gist re-checked on another day',
  expressed: 'Said with help',
  independent: 'Said without cues',
};

export const EPISODE_STAGE_ORDER: EpisodeStage[] = ['unseen', 'walked', 'gist', 'retained', 'expressed', 'independent'];

export interface EpisodeProgressRow {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
  total: number;
  /** Sentences whose furthest evidence is exactly this stage. */
  byStage: Record<EpisodeStage, number>;
  /** Sentences with evidence at or beyond each stage (cumulative). */
  reached: Record<EpisodeStage, number>;
}

const dayKey = (iso: string) => new Date(iso).toDateString();

/** Furthest stage evidenced for one sentence from its events alone. */
export function sentenceEpisodeStage(events: SentenceLearningEvent[]): EpisodeStage {
  const walked = events.filter((e) => e.action === 'walkthrough_completed');
  const gists = events.filter((e) => e.action === 'gist_check' && e.outcome === 'got_it');
  const attempts = events.filter((e) => e.action === 'expression_attempt');
  const firstWalk = walked.map((e) => e.timestamp).sort()[0];
  const firstWalkDay = firstWalk ? dayKey(firstWalk) : undefined;
  const laterGistDays = new Set(
    gists.filter((e) => firstWalk !== undefined && e.timestamp > firstWalk && dayKey(e.timestamp) !== firstWalkDay).map((e) => dayKey(e.timestamp)),
  );
  const independent = attempts.some(
    (e) =>
      e.outcome === 'got_it' &&
      (e.scaffold ?? 'none') === 'none' &&
      firstWalk !== undefined &&
      e.timestamp > firstWalk &&
      dayKey(e.timestamp) !== firstWalkDay,
  );
  if (independent) return 'independent';
  if (attempts.length > 0) return 'expressed';
  if (laterGistDays.size >= 2) return 'retained';
  if (gists.length > 0) return 'gist';
  if (walked.length > 0) return 'walked';
  return 'unseen';
}

export function buildEpisodeProgress(
  books: Book[],
  memberships: BookSentence[],
  events: SentenceLearningEvent[],
): EpisodeProgressRow[] {
  const eventsBySentence = new Map<string, SentenceLearningEvent[]>();
  for (const event of events) {
    const list = eventsBySentence.get(event.sentenceId);
    if (list) list.push(event);
    else eventsBySentence.set(event.sentenceId, [event]);
  }
  const rows: EpisodeProgressRow[] = [];
  for (const book of books) {
    if (book.archived || book.suspendedAt) continue;
    const bookMemberships = memberships.filter((m) => m.bookId === book.id);
    for (const chapter of [...book.chapters].sort((a, b) => a.position - b.position)) {
      const sentenceIds = [...new Set(bookMemberships.filter((m) => m.chapterId === chapter.id).map((m) => m.sentenceId))];
      if (sentenceIds.length === 0) continue;
      const byStage = Object.fromEntries(EPISODE_STAGE_ORDER.map((s) => [s, 0])) as Record<EpisodeStage, number>;
      for (const id of sentenceIds) byStage[sentenceEpisodeStage(eventsBySentence.get(id) ?? [])] += 1;
      const reached = Object.fromEntries(EPISODE_STAGE_ORDER.map((s) => [s, 0])) as Record<EpisodeStage, number>;
      EPISODE_STAGE_ORDER.forEach((stage, index) => {
        reached[stage] = EPISODE_STAGE_ORDER.slice(index).reduce((sum, later) => sum + byStage[later], 0);
      });
      rows.push({
        bookId: book.id,
        bookTitle: book.title,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        total: sentenceIds.length,
        byStage,
        reached,
      });
    }
  }
  return rows;
}
