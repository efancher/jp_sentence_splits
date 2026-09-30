import { describe, expect, it } from 'vitest';

import type { SentenceLearningEvent } from '../src/domain/types';
import { openContentReports } from '../src/lib/contentReports';

const ev = (o: Partial<SentenceLearningEvent>): SentenceLearningEvent =>
  ({ id: Math.random().toString(), visitId: 'v', bookId: 'b', sentenceId: 's1', timestamp: '2026-09-30T10:00:00.000Z', action: 'content_report', report: 'poor_question', target: { kind: 'vocabulary', key: 'k', label: 'L' }, ...o }) as SentenceLearningEvent;

describe('openContentReports', () => {
  it('lists unresolved reports, dedupes repeats, newest first', () => {
    const open = openContentReports([
      ev({ id: 'a', timestamp: '2026-09-30T10:00:00.000Z' }),
      ev({ id: 'b', timestamp: '2026-09-30T11:00:00.000Z' }),
      ev({ id: 'c', sentenceId: 's2', timestamp: '2026-09-30T12:00:00.000Z' }),
    ]);
    expect(open.map((r) => r.reportEventId)).toEqual(['c', 'b']);
  });

  it('a later resolution closes it, but a newer report reopens it', () => {
    const resolved = ev({ id: 'r', action: 'report_resolved', resolution: 'fixed', report: undefined, timestamp: '2026-09-30T13:00:00.000Z' });
    expect(openContentReports([ev({}), resolved])).toEqual([]);
    const reopened = ev({ id: 'n', timestamp: '2026-09-30T14:00:00.000Z' });
    expect(openContentReports([ev({}), resolved, reopened]).map((r) => r.reportEventId)).toEqual(['n']);
  });

  it('keeps reports for different targets in one sentence separate', () => {
    const resolved = ev({ action: 'report_resolved', resolution: 'dismissed', report: undefined, timestamp: '2026-09-30T13:00:00.000Z' });
    const other = ev({ id: 'o', target: { kind: 'grammar', key: 'k2', label: 'G' } });
    expect(openContentReports([ev({}), resolved, other]).map((r) => r.reportEventId)).toEqual(['o']);
  });
});
