import type { ChunkIssueReport } from '../domain/types';

/**
 * Identity of an assistant-flagged issue, used to group reports in the UI and
 * to recognise ones the learner already dismissed as "not an issue". Drops the
 * assistant's trailing "(explanation)" so the same boundary phrased with
 * different reasons matches. Particle-check issues are about the chunker, so
 * they match across sentences; meaning-check issues are about one sentence's
 * data, so the key includes the sentence.
 */
export function chunkIssueKey(issue: Pick<ChunkIssueReport, 'source' | 'sentenceId' | 'note'>): string {
  const core = issue.note.replace(/\s+\(.*\)\s*$/, '').replace(/\s+/g, ' ').trim();
  return issue.source === 'meaning_checks' ? `${issue.sentenceId}::${core}` : core;
}
