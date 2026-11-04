import type { Review, SentenceLearningEvent, StudyItem } from '../domain/types';

/**
 * Sentence-level listening evidence (docs/ROADMAP.md, "Follow-up offers and activity
 * effectiveness"). Listening is not a word-strength facet: the word model only knows
 * reading and meaning, and a Dictation or Ear tiles result is about hearing a clip, not
 * one word. This module reads the outcomes of the listening activities per sentence so
 * the after-effect comparison has a listening outcome to look at.
 *
 * Sources:
 * - Reader Dictation: a `target_practice` event keyed `dictation:<sentenceId>:<tile>`
 *   (the learner's own "Got it" / "Needed help").
 * - Reader Ear tiles: a `target_practice` event keyed `eartiles:<sentenceId>`, graded
 *   from the slips in the round (`earTilesOutcome`). That is an observation, not a
 *   rating, and it carries no `assessmentSource`.
 * - Review cards `ear_tiles`, `dictation_tile:N`, `listening` (and the retired
 *   `dictation`): success is any rating but `again`, the learner's own explicit choice.
 *
 * Pure: callers fetch rows. Evidence only; it never chooses an FSRS rating.
 */

export const DICTATION_KEY_PREFIX = 'dictation:';
export const EAR_TILES_KEY_PREFIX = 'eartiles:';

export function earTilesTargetKey(sentenceId: string): string {
  return `${EAR_TILES_KEY_PREFIX}${sentenceId}`;
}

/** Slips in an Ear tiles round → outcome: clean is a pass, one or two slips is "close", more is a miss. */
export function earTilesOutcome(wrongTaps: number): 'got_it' | 'close' | 'needed_help' {
  if (wrongTaps <= 0) return 'got_it';
  return wrongTaps <= 2 ? 'close' : 'needed_help';
}

export type ListeningSource = 'dictation' | 'ear_tiles' | 'review';

export interface ListeningAttempt {
  sentenceId: string;
  at: number;
  source: ListeningSource;
  /** A clean pass. */
  success: boolean;
  /** An Ear tiles round with one or two slips: neither a clean pass nor a miss. Never true together with `success`. */
  close: boolean;
}

export interface SentenceListening {
  attempts: number;
  successes: number;
  lastAt: number;
  lastSuccess: boolean;
}

const LISTENING_ACTIVITIES = new Set(['ear_tiles', 'listening', 'dictation']);

function isListeningActivity(activityType: string): boolean {
  return LISTENING_ACTIVITIES.has(activityType) || activityType.startsWith('dictation_tile:');
}

export interface ListeningEvidenceInput {
  reviews: readonly Pick<Review, 'studyItemId' | 'timestamp' | 'rating' | 'contextSentenceId'>[];
  studyItems: readonly Pick<StudyItem, 'id' | 'subjectType' | 'subjectId' | 'activityType'>[];
  learningEvents: readonly Pick<SentenceLearningEvent, 'sentenceId' | 'timestamp' | 'action' | 'target' | 'outcome'>[];
}

/** Every listening attempt, oldest first. */
export function buildListeningAttempts(input: ListeningEvidenceInput): ListeningAttempt[] {
  const items = new Map(input.studyItems.map((item) => [item.id, item]));
  const attempts: ListeningAttempt[] = [];

  for (const review of input.reviews) {
    const item = items.get(review.studyItemId);
    if (!item || item.subjectType !== 'sentence' || !isListeningActivity(item.activityType)) continue;
    const at = Date.parse(review.timestamp);
    if (Number.isNaN(at)) continue;
    attempts.push({
      sentenceId: review.contextSentenceId ?? item.subjectId,
      at,
      source: 'review',
      success: review.rating !== 'again',
      close: false,
    });
  }

  for (const event of input.learningEvents) {
    if (event.action !== 'target_practice' || !event.outcome) continue;
    const key = event.target?.key ?? '';
    const source: ListeningSource | null = key.startsWith(DICTATION_KEY_PREFIX)
      ? 'dictation'
      : key.startsWith(EAR_TILES_KEY_PREFIX)
        ? 'ear_tiles'
        : null;
    if (!source) continue;
    const at = Date.parse(event.timestamp);
    if (Number.isNaN(at)) continue;
    attempts.push({
      sentenceId: event.sentenceId,
      at,
      source,
      success: event.outcome === 'got_it',
      close: event.outcome === 'close',
    });
  }

  return attempts.sort((a, b) => a.at - b.at);
}

/** Per-sentence roll-up of the attempts. Sentences with none are absent. */
export function summarizeListening(attempts: readonly ListeningAttempt[]): Map<string, SentenceListening> {
  const out = new Map<string, SentenceListening>();
  for (const attempt of [...attempts].sort((a, b) => a.at - b.at)) {
    const current = out.get(attempt.sentenceId) ?? { attempts: 0, successes: 0, lastAt: 0, lastSuccess: false };
    out.set(attempt.sentenceId, {
      attempts: current.attempts + 1,
      successes: current.successes + (attempt.success ? 1 : 0),
      lastAt: attempt.at,
      lastSuccess: attempt.success,
    });
  }
  return out;
}

/**
 * The first listening attempt on a sentence after `afterMs`, within `windowDays` (the "next
 * result" outcome the after-effect comparison uses for the listening aspect), or null.
 */
export function nextListeningAttempt(
  attempts: readonly ListeningAttempt[],
  sentenceId: string,
  afterMs: number,
  windowDays = 7,
): ListeningAttempt | null {
  const limit = afterMs + windowDays * 86_400_000;
  return attempts.find((attempt) => attempt.sentenceId === sentenceId && attempt.at > afterMs && attempt.at <= limit) ?? null;
}
