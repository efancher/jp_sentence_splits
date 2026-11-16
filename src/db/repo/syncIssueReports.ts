import type { ChunkIssueReport, SyncIssueReport, SyncIssueStatus } from '../../domain/types';
import { getDb } from '../database';
import { chunkIssueKey } from '../../lib/chunkIssues';
import { nowIso } from '../../lib/normalize';
import { createId } from '../../lib/ids';
import { notifySync } from '../syncNotify';
import { parseReadingFlagNote, applyReadingFlagFix } from '../../lib/readingFlagFix';
import { updateSentenceText } from './sentenceWrites';

// ---------------------------------------------------------------------------
// Sync issue reports: the same "flag it, deal with it later" mechanism as
// card issue reports, but for sync trouble ("more conflicts than
// expected") raised from ConflictPanel/AuthAndSyncSettings rather than
// ReviewPage — see docs/STATUS.md. Bundles the diagnostics snapshot
// (buildDiagnosticsSnapshot, src/sync/logger.ts) at report time so a later
// session can triage without the reporter pasting anything by hand.
// ---------------------------------------------------------------------------

export async function reportChunkIssues(
  source: ChunkIssueReport['source'],
  issues: ReadonlyArray<{ sentenceId: string; chunks: readonly string[]; note: string }>,
): Promise<number> {
  const db = getDb();
  const all = await db.chunkIssueReports.toArray();
  const dismissed = new Set(all.filter((r) => r.status === 'dismissed').map(chunkIssueKey));
  const open = all.filter((r) => r.status === 'open');
  let filed = 0;
  for (const issue of issues) {
    const joined = issue.chunks.join(' | ');
    if (dismissed.has(chunkIssueKey({ source, ...issue }))) continue;
    if (open.some((r) => r.source === source && r.sentenceId === issue.sentenceId && r.chunks.join(' | ') === joined && r.note === issue.note)) continue;
    const timestamp = nowIso();
    const report: ChunkIssueReport = {
      id: createId('chunk_issue'),
      source,
      sentenceId: issue.sentenceId,
      chunks: [...issue.chunks],
      note: issue.note,
      status: 'open',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await db.chunkIssueReports.put(report);
    notifySync('chunk_issue_reports', report.id, report);
    open.push(report);
    filed += 1;
  }
  return filed;
}

export async function listChunkIssueReports(): Promise<ChunkIssueReport[]> {
  const all = await getDb().chunkIssueReports.toArray();
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Settle reports (a UI group's ids) as resolved (fixed) or dismissed (not an issue; skipped on later imports). */
export async function settleChunkIssueReports(
  ids: readonly string[],
  status: 'resolved' | 'dismissed',
): Promise<void> {
  const db = getDb();
  const timestamp = nowIso();
  for (const id of ids) {
    const existing = await db.chunkIssueReports.get(id);
    if (!existing || existing.status !== 'open') continue;
    const updated: ChunkIssueReport = { ...existing, status, resolvedAt: timestamp, updatedAt: timestamp };
    await db.chunkIssueReports.put(updated);
    notifySync('chunk_issue_reports', updated.id, updated);
  }
}

/** Open reading-check flags (and other meaning-check issues) filed against one sentence. */
export async function listOpenMeaningCheckIssues(sentenceId: string): Promise<ChunkIssueReport[]> {
  const rows = await getDb().chunkIssueReports.where('sentenceId').equals(sentenceId).toArray();
  return rows
    .filter((row) => row.status === 'open' && row.source === 'meaning_checks')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * The learner listened and chose the assistant's reading for a flagged span:
 * rewrite the sentence's furigana (and `readingOnly` when it was the plain
 * kana of the old furigana) and mark the report resolved. A report whose span
 * no longer matches the sentence (already edited) is just resolved.
 */
export async function applyReadingFlagChoice(reportId: string): Promise<boolean> {
  const db = getDb();
  const report = await db.chunkIssueReports.get(reportId);
  if (!report || report.status !== 'open') return false;
  const flag = parseReadingFlagNote(report.note);
  const sentence = report.sentenceId ? await db.sentences.get(report.sentenceId) : undefined;
  const fix = flag && sentence ? applyReadingFlagFix(sentence, flag, { force: true }) : null;
  if (fix && sentence) await updateSentenceText(sentence.id, fix);
  await settleChunkIssueReports([reportId], 'resolved');
  return fix != null;
}

export async function reportSyncIssue(input: {
  note: string;
  diagnosticsSnapshot: string;
  conflictEntity?: string;
  conflictRecordId?: string;
}): Promise<SyncIssueReport> {
  const db = getDb();
  const timestamp = nowIso();
  const report: SyncIssueReport = {
    id: createId('sync_issue'),
    note: input.note,
    diagnosticsSnapshot: input.diagnosticsSnapshot,
    conflictEntity: input.conflictEntity,
    conflictRecordId: input.conflictRecordId,
    status: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.syncIssueReports.put(report);
  notifySync('sync_issue_reports', report.id, report);
  return report;
}

export async function listSyncIssueReports(
  status?: SyncIssueStatus,
): Promise<SyncIssueReport[]> {
  const db = getDb();
  const all = await db.syncIssueReports.toArray();
  const filtered = status ? all.filter((item) => item.status === status) : all;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function resolveSyncIssueReport(id: string): Promise<SyncIssueReport> {
  const db = getDb();
  const existing = await db.syncIssueReports.get(id);
  if (!existing) throw new Error('Sync issue report not found');
  const timestamp = nowIso();
  const updated: SyncIssueReport = {
    ...existing,
    status: 'resolved',
    resolvedAt: timestamp,
    updatedAt: timestamp,
  };
  await db.syncIssueReports.put(updated);
  notifySync('sync_issue_reports', updated.id, updated);
  return updated;
}
