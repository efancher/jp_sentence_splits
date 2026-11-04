import type { SentenceLearningEvent } from '../domain/types';
import { PHRASE_SHADOW_KEY_PREFIX } from './phraseShadow';

/**
 * Pronunciation outcomes per sentence, for the follow-up after-effect view
 * (docs/ROADMAP.md, "Follow-up offers and activity effectiveness"). Self-judged only:
 * measured pitch scores depend on the speaker and the analysis, so they are not the outcome.
 *
 * Sources, both the learner's own call, both evidence only (never a Review, no FSRS):
 * - the reader's docked Shadowing "How did your pronunciation go?" → `target_practice`
 *   event keyed `shadow:<sentenceId>`, "Good" = `got_it`, "Not good" = `needed_help`;
 * - a phrase shadow (`phrase_shadow` event, Got it / Close / Not yet) on that sentence.
 */

export const SHADOW_KEY_PREFIX = 'shadow:';

export function shadowTargetKey(sentenceId: string): string {
  return `${SHADOW_KEY_PREFIX}${sentenceId}`;
}

export interface PronunciationAttempt {
  sentenceId: string;
  at: number;
  /** "Good" / "Got it". */
  success: boolean;
  /** A phrase shadow rated "Close": a real middle result, neither good nor a miss. */
  close: boolean;
}

export function buildPronunciationAttempts(
  events: readonly Pick<SentenceLearningEvent, 'sentenceId' | 'timestamp' | 'action' | 'target' | 'outcome'>[],
): PronunciationAttempt[] {
  const attempts: PronunciationAttempt[] = [];
  for (const event of events) {
    if (!event.outcome) continue;
    const key = event.target?.key ?? '';
    const isSentenceRating = event.action === 'target_practice' && key.startsWith(SHADOW_KEY_PREFIX);
    const isPhrase = event.action === 'phrase_shadow' && key.startsWith(PHRASE_SHADOW_KEY_PREFIX);
    if (!isSentenceRating && !isPhrase) continue;
    const at = Date.parse(event.timestamp);
    if (Number.isNaN(at)) continue;
    attempts.push({ sentenceId: event.sentenceId, at, success: event.outcome === 'got_it', close: event.outcome === 'close' });
  }
  return attempts.sort((a, b) => a.at - b.at);
}
