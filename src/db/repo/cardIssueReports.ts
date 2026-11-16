import type { StudyActivityType, CardIssueReport, CardIssueStatus, Sentence, StudyItem, SentenceVocabulary, VocabularyItem } from '../../domain/types';
import { getDb } from '../database';
import { nowIso } from '../../lib/normalize';
import { createId } from '../../lib/ids';
import { notifySync } from '../syncNotify';

// ---------------------------------------------------------------------------
// Card issue reports: a lightweight "flag this card, deal with it later"
// mechanism raised from ReviewPage. Deliberately not part of
// backupSchema/restoreBackup (same reasoning Phase 1 used for `sources`) —
// these are synced like study_items/reviews, so cloud sync (or
// scripts/list-card-issues.ts, for a future Claude session) is the actual
// durability story, not the local JSON backup.
// ---------------------------------------------------------------------------

export async function reportCardIssue(input: {
  studyItemId: string;
  sentenceId?: string;
  activityType: StudyActivityType;
  note: string;
  diagnostics?: string;
}): Promise<CardIssueReport> {
  const db = getDb();
  const timestamp = nowIso();
  const report: CardIssueReport = {
    id: createId('card_issue'),
    studyItemId: input.studyItemId,
    sentenceId: input.sentenceId,
    activityType: input.activityType,
    note: input.note,
    diagnostics: input.diagnostics,
    status: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.cardIssueReports.put(report);
  notifySync('card_issue_reports', report.id, report);
  return report;
}

export async function listCardIssueReports(
  status?: CardIssueStatus,
): Promise<CardIssueReport[]> {
  const db = getDb();
  const all = await db.cardIssueReports.toArray();
  const filtered = status ? all.filter((item) => item.status === status) : all;
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export interface CardIssueReportWithContext {
  report: CardIssueReport;
  sentence?: Sentence;
  /** A book the reported sentence belongs to (lowest position), for the
   * "Open in Analyze" deep link. */
  bookId?: string;
  /** The reported card's vocabulary item (whether the study item's subject
   * is the item directly or a `sentenceVocabulary` link to it), for the
   * "Find in vocabulary" deep link. */
  vocabularyExpression?: string;
}

/**
 * listCardIssueReports plus enough context for the /issues list UI to link
 * each report straight to where you'd act on it — the sentence shown at
 * report time, a book it lives in (Analyze page), and the underlying
 * vocabulary item (vocabulary list). Batched, not per-report `.get()`s.
 */
export async function listCardIssueReportsWithContext(): Promise<
  CardIssueReportWithContext[]
> {
  const db = getDb();
  const reports = await listCardIssueReports();

  const studyItems = await db.studyItems.bulkGet(
    reports.map((report) => report.studyItemId),
  );
  const studyItemById = new Map(
    studyItems
      .filter((row): row is StudyItem => Boolean(row))
      .map((row) => [row.id, row]),
  );

  // Resolve each report's vocabulary item — directly for a `vocabularyItem`
  // subject, via the link for a `sentenceVocabulary` subject.
  const directVocabIds = new Set<string>();
  const linkIds = new Set<string>();
  for (const report of reports) {
    const studyItem = studyItemById.get(report.studyItemId);
    if (studyItem?.subjectType === 'vocabularyItem') directVocabIds.add(studyItem.subjectId);
    else if (studyItem?.subjectType === 'sentenceVocabulary') linkIds.add(studyItem.subjectId);
  }
  const links = await db.sentenceVocabulary.bulkGet([...linkIds]);
  const linkById = new Map(
    links
      .filter((row): row is SentenceVocabulary => Boolean(row))
      .map((row) => [row.id, row]),
  );
  for (const link of linkById.values()) directVocabIds.add(link.vocabularyItemId);
  const vocabularyItems = await db.vocabularyItems.bulkGet([...directVocabIds]);
  const vocabularyItemById = new Map(
    vocabularyItems
      .filter((row): row is VocabularyItem => Boolean(row))
      .map((row) => [row.id, row]),
  );

  const sentenceIds = [
    ...new Set(
      reports
        .map((report) => report.sentenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const sentences = await db.sentences.bulkGet(sentenceIds);
  const sentenceById = new Map(
    sentences.filter((row): row is Sentence => Boolean(row)).map((row) => [row.id, row]),
  );

  const memberships =
    sentenceIds.length > 0
      ? await db.bookSentences.where('sentenceId').anyOf(sentenceIds).toArray()
      : [];
  const bookIdBySentenceId = new Map<string, string>();
  for (const membership of [...memberships].sort((a, b) => a.position - b.position)) {
    if (!bookIdBySentenceId.has(membership.sentenceId)) {
      bookIdBySentenceId.set(membership.sentenceId, membership.bookId);
    }
  }

  return reports.map((report) => {
    const studyItem = studyItemById.get(report.studyItemId);
    let vocabularyItem: VocabularyItem | undefined;
    if (studyItem?.subjectType === 'vocabularyItem') {
      vocabularyItem = vocabularyItemById.get(studyItem.subjectId);
    } else if (studyItem?.subjectType === 'sentenceVocabulary') {
      const link = linkById.get(studyItem.subjectId);
      if (link) vocabularyItem = vocabularyItemById.get(link.vocabularyItemId);
    }
    return {
      report,
      sentence: report.sentenceId ? sentenceById.get(report.sentenceId) : undefined,
      bookId: report.sentenceId ? bookIdBySentenceId.get(report.sentenceId) : undefined,
      vocabularyExpression: vocabularyItem?.expression,
    };
  });
}

export async function resolveCardIssueReport(id: string): Promise<CardIssueReport> {
  const db = getDb();
  const existing = await db.cardIssueReports.get(id);
  if (!existing) throw new Error('Issue report not found');
  const timestamp = nowIso();
  const updated: CardIssueReport = {
    ...existing,
    status: 'resolved',
    resolvedAt: timestamp,
    updatedAt: timestamp,
  };
  await db.cardIssueReports.put(updated);
  notifySync('card_issue_reports', updated.id, updated);
  return updated;
}
