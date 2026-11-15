import { READER_KNOWN_STRENGTH } from './wordStrength';

/**
 * Which walked-through sentences are due for a planner Word check step (docs/ROADMAP.md,
 * "Separate Dictation and Word check from the Fresh try"). The Word check is the meaning step for
 * a sentence: it asks for the sentence's weakest-meaning word, on its own, a day or more after the
 * walkthrough, instead of riding beside a same-day Fresh try.
 *
 * A sentence qualifies when its weakest content word's meaning is below the reader's "known" line.
 * Spacing is per sentence, from the last meaning check logged on it: a "got it" waits
 * `CLEAN_WAIT_DAYS`, anything else `RETRY_WAIT_DAYS`. A sentence whose last Read check ended in
 * "needed help" (with no meaning check since) comes first and skips the wait. Evidence only: the
 * check is self-judged and never touches FSRS. Pure: callers fetch rows.
 */

export const MIN_DAYS_AFTER_WALK = 1;
/** A walkthrough this recent puts the sentence ahead of older ones ("a day or two after a Fresh try"). */
export const RECENT_WALK_DAYS = 3;
export const CLEAN_WAIT_DAYS = 7;
export const RETRY_WAIT_DAYS = 2;

const DAY_MS = 86_400_000;

export interface WordCheckSentence {
  sentenceId: string;
  /** Last completed walkthrough (ms). */
  lastWalkedAt: number;
  /** The word the reader's Word check would ask about (its weakest by meaning), when it has one. */
  word?: { label: string; meaningStrength: number; expression?: string };
  /** Latest meaning check logged on this sentence, any word. */
  lastCheck?: { at: number; gotIt: boolean };
  /** Latest Read check on this sentence. */
  lastReadCheck?: { at: number; gotIt: boolean };
}

export interface WordCheckDue {
  sentenceId: string;
  word: string;
  /** Dictionary form of `word`, used to find it in other sentences. */
  expression?: string;
  reason: string;
  /** The last Read check was "needed help" and no meaning check has followed it. */
  struggling: boolean;
}

export function dueWordChecks(input: { sentences: readonly WordCheckSentence[]; now: number }): WordCheckDue[] {
  const due: Array<WordCheckDue & { recent: boolean; strength: number; lastCheckAt: number }> = [];
  for (const sentence of input.sentences) {
    const { word, lastCheck, lastReadCheck } = sentence;
    if (!word || word.meaningStrength >= READER_KNOWN_STRENGTH) continue;
    const sinceWalk = input.now - sentence.lastWalkedAt;
    if (sinceWalk < MIN_DAYS_AFTER_WALK * DAY_MS) continue;
    const struggling = Boolean(lastReadCheck && !lastReadCheck.gotIt && (!lastCheck || lastCheck.at < lastReadCheck.at));
    if (lastCheck && !struggling) {
      const waitDays = lastCheck.gotIt ? CLEAN_WAIT_DAYS : RETRY_WAIT_DAYS;
      if (input.now - lastCheck.at < waitDays * DAY_MS) continue;
    }
    const recent = sinceWalk < RECENT_WALK_DAYS * DAY_MS;
    due.push({
      sentenceId: sentence.sentenceId,
      word: word.label,
      expression: word.expression,
      struggling,
      reason: wordCheckReason(word.label, struggling, recent, lastCheck),
      recent,
      strength: word.meaningStrength,
      lastCheckAt: lastCheck?.at ?? 0,
    });
  }
  // Struggling sentences first, then recently walked ones, then the weakest word; longest-unchecked breaks ties.
  due.sort(
    (a, b) =>
      Number(b.struggling) - Number(a.struggling) ||
      Number(b.recent) - Number(a.recent) ||
      a.strength - b.strength ||
      a.lastCheckAt - b.lastCheckAt ||
      a.sentenceId.localeCompare(b.sentenceId),
  );
  return due.map(({ sentenceId, word, expression, reason, struggling }) => ({ sentenceId, word, expression, reason, struggling }));
}

/**
 * A sentence the learner has not studied that also holds the word, so the Word check tests the word and not the
 * memory of a familiar sentence (on a sentence read many times, the whole line can carry a word's meaning; see
 * docs/ROADMAP.md, "Masked signal"). Callers offer only not-yet-introduced sentences in active books where the word is
 * checkable. The pick has the fewest other words whose meaning is not solid, so the word is the one gap; ties go to the
 * shorter sentence, then id. `taken` holds sentences already used by another check or step.
 */
export interface TransferSentenceOption {
  sentenceId: string;
  /** Checkable words in it, other than the asked word, whose meaning is below the reader's "known" line. */
  otherWeakWords: number;
  length: number;
}

export function pickTransferSentence(
  options: readonly TransferSentenceOption[],
  taken: ReadonlySet<string> = new Set(),
): TransferSentenceOption | undefined {
  return options
    .filter((option) => !taken.has(option.sentenceId))
    .sort((a, b) => a.otherWeakWords - b.otherWeakWords || a.length - b.length || a.sentenceId.localeCompare(b.sentenceId))[0];
}

/** Why a Word check is on a sentence the learner hasn't studied: the reason line names the word and where it was met. */
export function transferWordCheckReason(word: string): string {
  return `Recall what ${word} means in a sentence you haven't studied (you met it in a walked sentence, which can carry the meaning for you); you judge how it went`;
}

function wordCheckReason(
  word: string,
  struggling: boolean,
  recent: boolean,
  lastCheck: WordCheckSentence['lastCheck'],
): string {
  const what = `Recall what ${word} means here`;
  const why = struggling
    ? "you needed help on this sentence's last Read check"
    : lastCheck && !lastCheck.gotIt
      ? 'a word here slipped last time'
      : recent
        ? 'you walked through this sentence recently'
        : lastCheck
          ? 'its meaning is not solid yet'
          : "its meaning hasn't been checked";
  return `${what} (${why}); you judge how it went`;
}
