import type { SentenceLearningEvent } from '../domain/types';

/**
 * Read checks: the reader's replacement for sentence review cards. A walked-through
 * sentence comes back as a quick "read it without help, then judge it yourself"
 * check; the learner's call is logged as a `gist_check` event (evidence only, no
 * `Review`, no FSRS). This module only chooses *which* sentences are due, from
 * those events; nothing is stored here.
 *
 * Spacing: the wait before the next check grows with each consecutive "got it" on
 * a separate day (1, 2, 4, 8, 16, 32, 64 days) and resets to the first rung after
 * "needed help". It is measured from the learner's latest contact with the
 * sentence (a walkthrough, a gist check or a say-it attempt), so a Fresh try also
 * pushes the next Read check out.
 */
export const READ_CHECK_GAP_DAYS = [1, 2, 4, 8, 16, 32, 64];

export interface ReadCheckDue {
  sentenceId: string;
  /** Days past the point the sentence became due (0 = due today). */
  overdueDays: number;
  /** Days since the last contact. */
  daysSinceContact: number;
  /** Consecutive "got it" checks on separate days since the last "needed help". */
  streak: number;
  /** The most recent check was "needed help". */
  neededHelpLast: boolean;
  /** No check has ever been logged for this sentence. */
  neverChecked: boolean;
}

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function daysBetween(fromIso: string, now: Date): number {
  const from = new Date(fromIso);
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / 86_400_000);
}

const CONTACT_ACTIONS = new Set(['walkthrough_completed', 'gist_check', 'expression_attempt']);

/**
 * Walked-through sentences whose next Read check has come due, most urgent first
 * (needed help last time, then furthest overdue). Sentences walked through today
 * are never due.
 */
export function sentencesDueForReadCheck(events: readonly SentenceLearningEvent[], now: Date = new Date()): ReadCheckDue[] {
  const bySentence = new Map<string, SentenceLearningEvent[]>();
  for (const event of events) {
    if (!CONTACT_ACTIONS.has(event.action)) continue;
    const list = bySentence.get(event.sentenceId) ?? [];
    list.push(event);
    bySentence.set(event.sentenceId, list);
  }

  const due: ReadCheckDue[] = [];
  for (const [sentenceId, list] of bySentence) {
    if (!list.some((event) => event.action === 'walkthrough_completed')) continue;
    const sorted = [...list].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const checks = sorted.filter((event) => event.action === 'gist_check' && event.outcome);

    let streak = 0;
    let streakDay: string | undefined;
    for (const check of checks) {
      if (check.outcome === 'needed_help') {
        streak = 0;
        streakDay = undefined;
      } else if (dayKey(check.timestamp) !== streakDay) {
        streak += 1;
        streakDay = dayKey(check.timestamp);
      }
    }

    const lastContact = sorted[sorted.length - 1]!.timestamp;
    const daysSinceContact = daysBetween(lastContact, now);
    const gap = READ_CHECK_GAP_DAYS[Math.min(streak, READ_CHECK_GAP_DAYS.length - 1)]!;
    if (daysSinceContact < gap) continue;
    due.push({
      sentenceId,
      overdueDays: daysSinceContact - gap,
      daysSinceContact,
      streak,
      neededHelpLast: checks.length > 0 && checks[checks.length - 1]!.outcome === 'needed_help',
      neverChecked: checks.length === 0,
    });
  }

  return due.sort(
    (a, b) =>
      Number(b.neededHelpLast) - Number(a.neededHelpLast) ||
      b.overdueDays - a.overdueDays ||
      a.sentenceId.localeCompare(b.sentenceId),
  );
}

/** One line saying why a sentence is up for a Read check, for the planner step. */
export function readCheckReason(due: ReadCheckDue): string {
  if (due.neededHelpLast) return `You needed help on this last time (${due.daysSinceContact}d ago)`;
  if (due.neverChecked) return `Walked through ${due.daysSinceContact}d ago — can you read it unaided?`;
  if (due.overdueDays > 0) return `Last seen ${due.daysSinceContact}d ago, ${due.overdueDays}d past its check`;
  return `Last seen ${due.daysSinceContact}d ago — time to check it`;
}
