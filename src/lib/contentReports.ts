import type { SentenceLearningEvent } from '../domain/types';

export interface OpenContentReport {
  reportEventId: string;
  bookId: string;
  sentenceId: string;
  target?: SentenceLearningEvent['target'];
  targetKey?: string;
  targetLabel?: string;
  report: NonNullable<SentenceLearningEvent['report']>;
  learnerAnswer?: string;
  timestamp: string;
}

/** Key identifying "the same prompt": a sentence plus (optionally) one target in it. */
export function contentReportKey(event: Pick<SentenceLearningEvent, 'sentenceId' | 'target'>): string {
  return `${event.sentenceId}::${event.target?.key ?? ''}`;
}

/** Content reports with no later `report_resolved` for the same sentence+target, newest first. Derived; nothing stored. */
export function openContentReports(events: SentenceLearningEvent[]): OpenContentReport[] {
  const latestResolved = new Map<string, string>();
  for (const event of events) {
    if (event.action !== 'report_resolved') continue;
    const key = contentReportKey(event);
    const seen = latestResolved.get(key);
    if (seen === undefined || event.timestamp > seen) latestResolved.set(key, event.timestamp);
  }
  const latestReport = new Map<string, SentenceLearningEvent>();
  for (const event of events) {
    if (event.action !== 'content_report' || !event.report) continue;
    const key = contentReportKey(event);
    const seen = latestReport.get(key);
    if (!seen || event.timestamp > seen.timestamp) latestReport.set(key, event);
  }
  return [...latestReport.entries()]
    .filter(([key, event]) => {
      const resolvedAt = latestResolved.get(key);
      return resolvedAt === undefined || resolvedAt < event.timestamp;
    })
    .map(([, event]) => ({
      reportEventId: event.id,
      bookId: event.bookId,
      sentenceId: event.sentenceId,
      target: event.target,
      targetKey: event.target?.key,
      targetLabel: event.target?.label,
      report: event.report!,
      learnerAnswer: event.learnerAnswer,
      timestamp: event.timestamp,
    }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
