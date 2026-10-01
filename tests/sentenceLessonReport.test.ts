import { describe, expect, it } from 'vitest';

import type { PlannerSession, SentenceLearningEvent } from '../src/domain/types';
import { buildSentenceLessonReport } from '../src/lib/sentenceLessonReport';

const NOW = new Date('2026-09-30T12:00:00');
const ago = (days: number) => new Date(NOW.getTime() - days * 86400000).toISOString();
const ev = (o: Partial<SentenceLearningEvent>): SentenceLearningEvent =>
  ({ id: Math.random().toString(), visitId: 'v', bookId: 'b', sentenceId: 's1', timestamp: ago(1), action: 'walkthrough_completed', ...o }) as SentenceLearningEvent;
const session = (date: string, kinds: string[], status = 'completed'): PlannerSession =>
  ({
    id: date, createdAt: ago(1), updatedAt: ago(1), date, targetMinutes: 30, allocation: {}, explanation: [], status: 'in_progress',
    steps: kinds.map((k, i) => ({ id: `${date}${i}`, targetKind: k, status })),
  }) as unknown as PlannerSession;

describe('buildSentenceLessonReport', () => {
  it('reports no data when nothing happened', () => {
    expect(buildSentenceLessonReport([], [], NOW).hasData).toBe(false);
  });

  it('joins supply, outcomes, quality and backlog', () => {
    const r = buildSentenceLessonReport(
      [
        ev({ sentenceId: 's1', timestamp: ago(5) }),
        ev({ sentenceId: 's2', timestamp: ago(1) }),
        ev({ action: 'gist_check', outcome: 'got_it' }),
        ev({ action: 'expression_attempt', outcome: 'got_it', scaffold: 'none', modality: 'spoken' }),
        ev({ action: 'target_practice' }),
        ev({ action: 'content_report', report: 'poor_question' }),
      ],
      [session('a', ['sentence_learning', 'review']), session('b', ['review'])],
      NOW,
    );
    expect(r.planned).toMatchObject({ lessons: 1, completed: 1 });
    expect(r.planDays).toBe(2);
    expect(r.planDaysWithoutLessons).toBe(1);
    expect(r.outcomes).toMatchObject({ sentencesWalked: 2, gistHad: 1, sentencesSaidIndependently: 1, spokenAttempts: 1 });
    expect(r.quality).toMatchObject({ contentReports: 1, practicedTargets: 1 });
    expect(r.backlog.readyToRevisit).toBe(1);
    expect(r.backlog.oldestDays).toBe(1);
  });
});
