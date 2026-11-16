import type { Sentence } from '../domain/types';
import { chunkSentenceIntoTileDetails, tileToolUnavailableReason } from './earTiles';

/**
 * Progress "What's stuck": met sentences that one specific requirement keeps out of a planner step.
 * Each reason names the requirement, so the counts say what would unblock them, not how much is ready.
 *
 * - `held_back`: met, but in no book currently being studied (every membership archived or suspended).
 * - `no_audio`: no native clip, so no shadowing, Ear tiles or Dictation.
 * - `no_word_analysis`: has audio, but no word analysis to split it into phrases for Ear tiles/Dictation.
 * - `no_phrase_split`: has an analysis, but too few or too many phrases for both listening tools.
 * - `outside_shadow_pool`: has audio, but shadowing only draws from the most recently opened books.
 */
export type StuckReason = 'held_back' | 'no_audio' | 'no_word_analysis' | 'no_phrase_split' | 'outside_shadow_pool';

export const STUCK_REASONS: readonly StuckReason[] = [
  'held_back',
  'no_audio',
  'no_word_analysis',
  'no_phrase_split',
  'outside_shadow_pool',
];

export interface StuckSentenceFacts {
  sentenceId: string;
  /** A study-rotation, non-shelved book holding the sentence; absent when there is none. */
  bookId?: string;
  hasAudio: boolean;
  /** Either listening tool can open on it. Ignored without audio. */
  listeningToolFits: boolean;
  /** Only needed when no listening tool fits, to tell a missing analysis from a bad phrase count. */
  sentence?: Pick<Sentence, 'japanese' | 'vocabularySuggestions'>;
  inShadowPool: boolean;
}

/** Why neither Ear tiles nor Dictation can open on a sentence with audio, or null when one can. */
export function listeningToolBlock(
  sentence: Pick<Sentence, 'japanese' | 'vocabularySuggestions'>,
): 'no_word_analysis' | 'no_phrase_split' | null {
  if (tileToolUnavailableReason(sentence, 'tiles', true) === null) return null;
  if (tileToolUnavailableReason(sentence, 'dictate', true) === null) return null;
  return chunkSentenceIntoTileDetails(sentence) ? 'no_phrase_split' : 'no_word_analysis';
}

/**
 * The requirements blocking one met sentence. A sentence held back or without audio is counted only there:
 * every later requirement needs a studied book and audio first.
 */
export function stuckReasons(facts: StuckSentenceFacts): StuckReason[] {
  if (!facts.bookId) return ['held_back'];
  if (!facts.hasAudio) return ['no_audio'];
  const reasons: StuckReason[] = [];
  if (!facts.listeningToolFits) reasons.push(facts.sentence ? (listeningToolBlock(facts.sentence) ?? 'no_phrase_split') : 'no_phrase_split');
  if (!facts.inShadowPool) reasons.push('outside_shadow_pool');
  return reasons;
}

export interface StuckRow {
  reason: StuckReason;
  count: number;
  /** A few sentence ids to open, in input order. */
  examples: string[];
}

export interface StuckSummary {
  /** How many met sentences were checked; zero means there is nothing to report yet. */
  metCount: number;
  rows: StuckRow[];
}

export function buildStuckSummary(facts: readonly StuckSentenceFacts[], exampleLimit = 3): StuckSummary {
  const rows = new Map<StuckReason, StuckRow>(STUCK_REASONS.map((reason) => [reason, { reason, count: 0, examples: [] }]));
  for (const entry of facts) {
    for (const reason of stuckReasons(entry)) {
      const row = rows.get(reason)!;
      row.count += 1;
      if (row.examples.length < exampleLimit) row.examples.push(entry.sentenceId);
    }
  }
  return { metCount: facts.length, rows: STUCK_REASONS.map((reason) => rows.get(reason)!) };
}
