import type { ListeningAttempt } from './listeningEvidence';

/**
 * Which sentences are due for a planner Ear tiles or Dictation step (docs/ROADMAP.md,
 * "Follow-up offers and activity effectiveness"). The two reader tools replace the old
 * review cards, so the planner drafts them the way it drafts Read checks: from the
 * sentence's own evidence, no scheduler of its own and no FSRS.
 *
 * Ladder (mirrors the cards): Ear tiles first; Dictation once a sentence has a clean Ear
 * tiles round. Spacing from the sentence's last listening attempt: a clean pass waits
 * `CLEAN_WAIT_DAYS`, anything else is due again after `RETRY_WAIT_DAYS`. A sentence that
 * ended its last Read check in "needed help" comes first. Pure: callers fetch rows.
 */

export type ListeningTool = 'tiles' | 'dictate';

export const CLEAN_WAIT_DAYS = 7;
export const RETRY_WAIT_DAYS = 1;

const DAY_MS = 86_400_000;

export interface ListeningToolSentence {
  sentenceId: string;
  /** Ear tiles can open on it (audio, enough phrases). */
  tilesEligible: boolean;
  /** Dictation can open on it. */
  dictateEligible: boolean;
}

export interface ListeningToolDue {
  sentenceId: string;
  tool: ListeningTool;
  reason: string;
  /** The sentence's last Read check was "needed help" and nothing listening-related happened since. */
  struggling: boolean;
}

export function dueListeningTools(input: {
  sentences: readonly ListeningToolSentence[];
  attempts: readonly ListeningAttempt[];
  /** Latest Read check outcome per sentence: timestamp (ms) and whether it was "got it". */
  lastReadCheck: ReadonlyMap<string, { at: number; gotIt: boolean }>;
  now: number;
}): ListeningToolDue[] {
  const attemptsBySentence = new Map<string, ListeningAttempt[]>();
  for (const attempt of input.attempts) {
    const list = attemptsBySentence.get(attempt.sentenceId);
    if (list) list.push(attempt);
    else attemptsBySentence.set(attempt.sentenceId, [attempt]);
  }

  const due: ListeningToolDue[] = [];
  for (const sentence of input.sentences) {
    const attempts = (attemptsBySentence.get(sentence.sentenceId) ?? []).sort((a, b) => a.at - b.at);
    const last = attempts[attempts.length - 1];
    const cleanTiles = attempts.some((attempt) => attempt.source === 'ear_tiles' && attempt.success);
    const tool: ListeningTool | null =
      cleanTiles && sentence.dictateEligible ? 'dictate' : sentence.tilesEligible ? 'tiles' : sentence.dictateEligible ? 'dictate' : null;
    if (!tool) continue;

    const readCheck = input.lastReadCheck.get(sentence.sentenceId);
    const struggling = Boolean(readCheck && !readCheck.gotIt && (!last || last.at < readCheck.at));
    if (last) {
      const waitDays = last.success ? CLEAN_WAIT_DAYS : RETRY_WAIT_DAYS;
      if (!struggling && input.now - last.at < waitDays * DAY_MS) continue;
    }
    due.push({
      sentenceId: sentence.sentenceId,
      tool,
      struggling,
      reason: listeningReason(tool, struggling, last),
    });
  }

  // Struggling sentences first, then never-tried, then the longest-waiting.
  const lastAt = (id: string) => attemptsBySentence.get(id)?.reduce((max, a) => Math.max(max, a.at), 0) ?? 0;
  return due.sort((a, b) => Number(b.struggling) - Number(a.struggling) || lastAt(a.sentenceId) - lastAt(b.sentenceId));
}

function listeningReason(tool: ListeningTool, struggling: boolean, last: ListeningAttempt | undefined): string {
  const what = tool === 'tiles' ? 'Rebuild it from what you hear' : 'Type one phrase from what you hear';
  if (struggling) return `${what} — you needed help on its last Read check`;
  if (!last) return `${what} — not tried by ear yet`;
  return last.success ? `${what} — a clean pass a while ago` : `${what} — it slipped last time`;
}
