import type { Sentence, SentenceLearningEvent } from '../domain/types';
import { buildTileDictation, dictationTileContaining, type TileDictation } from './earTiles';
import { READING_FEEDBACK_KEY_PREFIX } from './wordEvidence';

/**
 * Planner "Reading check" steps: a word the learner said (in the reader) they couldn't read gets one typed-reading
 * round on the phrase that holds it, in the sentence they missed it in. The phrase is shown without audio; the
 * learner types its reading, sees the answer, and judges it themselves. Pure: callers fetch events and sentences.
 *
 * Spacing needs no scheduler of its own: a miss is due until a reading check on that sentence is logged at or after
 * it. A "needed help" on the check itself is therefore not re-offered at once (the word stays weak in the strength
 * model, which the weak-word revisits and Word check already read).
 */
export const READING_MISS_WINDOW_DAYS = 7;

const DAY_MS = 86_400_000;

/** Key prefix of the marker event a finished reading check logs next to its word-evidence event. */
export const READING_CHECK_KEY_PREFIX = 'reading-check:';

export function readingCheckTargetKey(sentenceId: string): string {
  return `${READING_CHECK_KEY_PREFIX}${sentenceId}`;
}

export interface ReadingMiss {
  sentenceId: string;
  wordId: string;
  /** The word as written in the sentence, used to find its phrase. */
  surface: string;
  /** When the miss was recorded (ms). */
  at: number;
}

type MissEvent = Pick<SentenceLearningEvent, 'sentenceId' | 'timestamp' | 'action'> &
  Partial<Pick<SentenceLearningEvent, 'target' | 'outcome'>>;

/**
 * Words whose latest reader reading feedback was "needed help" within the window and that no later reading check
 * has covered, newest first, one per sentence (its most recent miss).
 */
export function recentReadingMisses(events: readonly MissEvent[], now: number, windowDays = READING_MISS_WINDOW_DAYS): ReadingMiss[] {
  const latestByWord = new Map<string, { at: number; sentenceId: string; surface: string; missed: boolean }>();
  const lastCheckBySentence = new Map<string, number>();
  for (const event of events) {
    if (event.action !== 'target_practice' || !event.target) continue;
    const at = Date.parse(event.timestamp);
    if (Number.isNaN(at)) continue;
    const { key, label } = event.target;
    if (key.startsWith(READING_CHECK_KEY_PREFIX)) {
      if (at > (lastCheckBySentence.get(event.sentenceId) ?? 0)) lastCheckBySentence.set(event.sentenceId, at);
      continue;
    }
    if (!key.startsWith(READING_FEEDBACK_KEY_PREFIX) || !event.outcome) continue;
    const wordId = key.slice(READING_FEEDBACK_KEY_PREFIX.length);
    if (at <= (latestByWord.get(wordId)?.at ?? 0)) continue;
    latestByWord.set(wordId, { at, sentenceId: event.sentenceId, surface: label, missed: event.outcome === 'needed_help' });
  }
  const bySentence = new Map<string, ReadingMiss>();
  for (const [wordId, latest] of latestByWord) {
    if (!latest.missed || !latest.surface || now - latest.at > windowDays * DAY_MS) continue;
    if (latest.at <= (lastCheckBySentence.get(latest.sentenceId) ?? 0)) continue;
    const seen = bySentence.get(latest.sentenceId);
    if (!seen || latest.at > seen.at) bySentence.set(latest.sentenceId, { sentenceId: latest.sentenceId, wordId, surface: latest.surface, at: latest.at });
  }
  return [...bySentence.values()].sort((a, b) => b.at - a.at);
}

export interface ReadingCheckTile {
  /** Tile index in the sentence's dictation split. */
  index: number;
  tile: TileDictation;
}

/**
 * The phrase holding `surface`, with its kana reading to type, or null when the sentence has no usable split, the word
 * isn't in it, or the phrase has no known reading.
 */
export function readingCheckTile(sentence: Pick<Sentence, 'japanese' | 'vocabularySuggestions'>, surface: string): ReadingCheckTile | null {
  const at = sentence.japanese.indexOf(surface);
  if (at < 0) return null;
  const index = dictationTileContaining(sentence, at);
  if (index === null) return null;
  const tile = buildTileDictation(sentence, index);
  return tile && tile.reading.trim() ? { index, tile } : null;
}
