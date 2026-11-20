import { READER_KNOWN_STRENGTH } from './wordStrength';

/**
 * Which walked-through sentences are due for a standalone planner Grammar check step: the grammar twin of
 * `wordCheckSteps.ts`. Before this, a Grammar check only rode on a weak-grammar revisit, which needs earlier reader
 * taps, so a pattern nobody had tapped was never asked about. Here a sentence qualifies when it carries a linked
 * grammar pattern that is unchecked (no evidence) or below the reader's "known" line, a day or more after its
 * walkthrough. Spacing is per pattern, from the last Grammar check on it: a "got it" waits `CLEAN_WAIT_DAYS`,
 * anything else `RETRY_WAIT_DAYS`. Evidence only: the check is self-judged and never touches FSRS. Pure: callers
 * fetch rows.
 */

export const MIN_DAYS_AFTER_WALK = 1;
/** A walkthrough this recent puts the sentence ahead of older ones. */
export const RECENT_WALK_DAYS = 3;
export const CLEAN_WAIT_DAYS = 7;
export const RETRY_WAIT_DAYS = 2;

const DAY_MS = 86_400_000;

export interface GrammarCheckSentence {
  sentenceId: string;
  /** Last completed walkthrough (ms). */
  lastWalkedAt: number;
  /** Linked patterns, in the order the reader lists them. */
  patterns: Array<{
    patternId: string;
    name: string;
    /** Strength from reader taps; undefined when the pattern has no evidence yet. */
    strength?: number;
    /** Latest Grammar check logged on this pattern, any sentence. */
    lastCheck?: { at: number; gotIt: boolean };
  }>;
}

export interface GrammarCheckDue {
  sentenceId: string;
  patternId: string;
  patternName: string;
  reason: string;
}

export function dueGrammarChecks(input: { sentences: readonly GrammarCheckSentence[]; now: number }): GrammarCheckDue[] {
  const due: Array<GrammarCheckDue & { recent: boolean; strength: number; lastCheckAt: number }> = [];
  for (const sentence of input.sentences) {
    const sinceWalk = input.now - sentence.lastWalkedAt;
    if (sinceWalk < MIN_DAYS_AFTER_WALK * DAY_MS) continue;
    const eligible = sentence.patterns.filter((pattern) => {
      if (pattern.strength !== undefined && pattern.strength >= READER_KNOWN_STRENGTH) return false;
      if (!pattern.lastCheck) return true;
      const waitDays = pattern.lastCheck.gotIt ? CLEAN_WAIT_DAYS : RETRY_WAIT_DAYS;
      return input.now - pattern.lastCheck.at >= waitDays * DAY_MS;
    });
    if (eligible.length === 0) continue;
    // The reader's panel asks about the weakest pattern with evidence, else the first; rank by that same pick.
    const tapped = eligible.filter((pattern) => pattern.strength !== undefined);
    const pick = tapped.length > 0 ? tapped.reduce((a, b) => (b.strength! < a.strength! ? b : a)) : eligible[0];
    const recent = sinceWalk < RECENT_WALK_DAYS * DAY_MS;
    due.push({
      sentenceId: sentence.sentenceId,
      patternId: pick.patternId,
      patternName: pick.name,
      reason: grammarCheckReason(pick, recent),
      recent,
      // Unchecked patterns rank after ones known to be shaky: a miss is firmer evidence of a gap than no evidence.
      strength: pick.strength ?? READER_KNOWN_STRENGTH,
      lastCheckAt: pick.lastCheck?.at ?? 0,
    });
  }
  due.sort(
    (a, b) =>
      a.strength - b.strength ||
      Number(b.recent) - Number(a.recent) ||
      a.lastCheckAt - b.lastCheckAt ||
      a.sentenceId.localeCompare(b.sentenceId),
  );
  // One check per pattern per pass: the same pattern in two sentences would just repeat the question.
  const seen = new Set<string>();
  return due
    .filter((entry) => (seen.has(entry.patternId) ? false : (seen.add(entry.patternId), true)))
    .map(({ sentenceId, patternId, patternName, reason }) => ({ sentenceId, patternId, patternName, reason }));
}

function grammarCheckReason(pattern: GrammarCheckSentence['patterns'][number], recent: boolean): string {
  const what = 'Recall what the grammar here does';
  const why =
    pattern.lastCheck && !pattern.lastCheck.gotIt
      ? 'it slipped last time'
      : pattern.strength !== undefined
        ? "it hasn't stuck yet"
        : recent
          ? "you walked through this sentence recently and haven't checked its grammar"
          : "you haven't checked its grammar yet";
  return `${what} (${why}); you judge how it went`;
}
