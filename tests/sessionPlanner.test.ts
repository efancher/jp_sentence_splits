import { describe, expect, it } from 'vitest';

import type { LearningMode } from '../src/domain/types';
import {
  ALL_LEARNING_MODES,
  allocateTimeAcrossModes,
  buildRecommendedSession,
  computeNeglectScores,
  computeRecentActivityDistribution,
  rankReviewPriorities,
  scoreReviewPriority,
  type ExploreCandidate,
  type RecentActivityEvent,
  type ReviewPriorityInput,
  type SessionPlannerInput,
  type ShadowCandidate,
  type UnderstandCandidate,
} from '../src/lib/sessionPlanner';

const NOW = new Date('2026-08-20T12:00:00.000Z');

function daysAgo(days: number, from: Date = NOW): string {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function dueCandidate(overrides: Partial<ReviewPriorityInput> = {}): ReviewPriorityInput {
  return {
    studyItemId: overrides.studyItemId ?? `item_${Math.random().toString(36).slice(2)}`,
    subjectType: 'vocabularyItem',
    activityType: 'reading_retrieval',
    mode: 'retain',
    due: daysAgo(1),
    scheduledDays: 7,
    state: 'review',
    distinctSourceCount: 1,
    distinctSentenceCount: 1,
    recentAgainCount: 0,
    recentReviewCount: 2,
    daysSinceLastEncounter: null,
    now: NOW,
    ...overrides,
  };
}

function emptyPlannerInput(overrides: Partial<SessionPlannerInput> = {}): SessionPlannerInput {
  return {
    now: NOW,
    totalMinutes: 30,
    recentActivity: [],
    retainDue: [],
    practiceDue: [],
    exploreCandidates: [],
    understandCandidates: [],
    shadowCandidates: [],
    ...overrides,
  };
}

describe('computeRecentActivityDistribution / computeNeglectScores', () => {
  it('treats a mode with no events at all as maximally neglected', () => {
    const distribution = computeRecentActivityDistribution([], NOW);
    expect(distribution.practice.daysSinceLast).toBeNull();
    const neglect = computeNeglectScores(distribution);
    expect(neglect.practice).toBe(1);
  });

  it('gives a mode touched today a near-zero neglect score', () => {
    const events: RecentActivityEvent[] = [{ mode: 'retain', timestamp: NOW.toISOString() }];
    const distribution = computeRecentActivityDistribution(events, NOW);
    const neglect = computeNeglectScores(distribution);
    expect(neglect.retain).toBeCloseTo(0, 5);
  });

  it('scales neglect linearly up to the window, then clamps at 1', () => {
    const events: RecentActivityEvent[] = [{ mode: 'understand', timestamp: daysAgo(30) }];
    const distribution = computeRecentActivityDistribution(events, NOW, 14);
    const neglect = computeNeglectScores(distribution, 14);
    expect(neglect.understand).toBe(1);
  });
});

describe('scoreReviewPriority / rankReviewPriorities', () => {
  it('ranks an overdue, multi-source, recently-struggled item above a fresh single-context one', () => {
    const strong = dueCandidate({
      studyItemId: 'strong',
      due: daysAgo(10),
      scheduledDays: 5,
      distinctSourceCount: 3,
      recentAgainCount: 2,
      recentReviewCount: 3,
    });
    const weak = dueCandidate({ studyItemId: 'weak', due: daysAgo(0.1), scheduledDays: 30 });
    const [first, second] = rankReviewPriorities([weak, strong], 10);
    expect(first!.studyItemId).toBe('strong');
    expect(second!.studyItemId).toBe('weak');
    expect(first!.reasons.length).toBeGreaterThan(0);
  });

  it('never fully zeroes out a stale, never-re-encountered item — it just scores lower', () => {
    const stale = scoreReviewPriority(
      dueCandidate({ daysSinceLastEncounter: 400, distinctSourceCount: 1 }),
    );
    expect(stale.score).toBeGreaterThan(0);
  });

  it('caps the ranked list at the requested limit even with a large backlog', () => {
    const backlog = Array.from({ length: 80 }, (_, index) =>
      dueCandidate({ studyItemId: `card_${index}`, due: daysAgo(index) }),
    );
    const ranked = rankReviewPriorities(backlog, 15);
    expect(ranked).toHaveLength(15);
  });
});

describe('allocateTimeAcrossModes', () => {
  it('redistributes a capped mode\'s leftover minutes to the others', () => {
    const neutralNeglect = Object.fromEntries(ALL_LEARNING_MODES.map((m) => [m, 0])) as Record<
      LearningMode,
      number
    >;
    const allocation = allocateTimeAcrossModes({
      totalMinutes: 30,
      neglectScores: neutralNeglect,
      availableMinutesByMode: { retain: 1 },
    });
    expect(allocation.retain).toBe(1);
    expect(allocation.explore + allocation.understand + allocation.practice).toBe(29);
  });

  it('sums to the requested total minutes (rounding drift absorbed by the largest share)', () => {
    const neglect = { explore: 0.2, understand: 0.5, practice: 0.9, retain: 0.1 };
    const allocation = allocateTimeAcrossModes({ totalMinutes: 10, neglectScores: neglect });
    const sum = ALL_LEARNING_MODES.reduce((total, mode) => total + allocation[mode], 0);
    expect(sum).toBe(10);
  });

  it('shifts share toward a heavily-neglected mode relative to the baseline', () => {
    const neglected = { explore: 0, understand: 0, practice: 1, retain: 0 };
    const untouched = { explore: 0, understand: 0, practice: 0, retain: 0 };
    const withNeglect = allocateTimeAcrossModes({ totalMinutes: 60, neglectScores: neglected });
    const baseline = allocateTimeAcrossModes({ totalMinutes: 60, neglectScores: untouched });
    expect(withNeglect.practice).toBeGreaterThan(baseline.practice);
  });
});

describe('buildRecommendedSession', () => {
  it('a brand-new user with no history gets a non-crashing baseline plan', () => {
    const session = buildRecommendedSession(emptyPlannerInput());
    expect(session.targetMinutes).toBe(30);
    expect(session.steps).toEqual([]);
    expect(session.explanation.length).toBeGreaterThan(0);
  });

  it('review-heavy recent activity with neglected explore/practice shifts allocation away from retain', () => {
    const recentActivity: RecentActivityEvent[] = Array.from({ length: 10 }, (_, index) => ({
      mode: 'retain' as const,
      timestamp: daysAgo(index * 0.5),
    }));
    const session = buildRecommendedSession(
      emptyPlannerInput({
        recentActivity,
        retainDue: [dueCandidate()],
      }),
    );
    expect(session.neglectScores.retain).toBe(0);
    expect(session.neglectScores.explore).toBe(1);
    expect(session.neglectScores.practice).toBe(1);
    expect(session.allocation.retain).toBeLessThan(30 * 0.25 + 1);
  });

  it('neglected shadowing increases practice allocation and produces shadow steps', () => {
    const recentActivity: RecentActivityEvent[] = [
      { mode: 'retain', timestamp: daysAgo(0) },
      { mode: 'explore', timestamp: daysAgo(0) },
      { mode: 'understand', timestamp: daysAgo(1) },
    ];
    const shadowCandidates: ShadowCandidate[] = Array.from({ length: 5 }, (_, index) => ({
      sentenceId: `sent_${index}`,
      bookId: 'book_1',
      label: `Sentence ${index}`,
      reason: 'Recently studied, not yet shadowed',
    }));
    const session = buildRecommendedSession(
      emptyPlannerInput({ recentActivity, shadowCandidates, totalMinutes: 60 }),
    );
    expect(session.neglectScores.practice).toBeGreaterThan(0.4);
    const shadowSteps = session.steps.filter((step) => step.targetKind === 'shadow');
    expect(shadowSteps.length).toBeGreaterThan(0);
  });

  it('with no due reviews, retain gets 0 minutes and the rest is spent elsewhere', () => {
    const exploreCandidates: ExploreCandidate[] = [
      { bookId: 'book_1', sentenceId: 'sent_1', label: 'Episode 4', reason: 'Continue', remainingCount: 20 },
    ];
    const session = buildRecommendedSession(
      emptyPlannerInput({ exploreCandidates }),
    );
    expect(session.allocation.retain).toBe(0);
    expect(session.explanation.some((line) => line.toLowerCase().includes('backlog'))).toBe(true);
    const total = session.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
    expect(total).toBeLessThanOrEqual(30);
  });

  it('a large review backlog only selects a bounded top-priority subset, not everything', () => {
    const retainDue = Array.from({ length: 200 }, (_, index) =>
      dueCandidate({ studyItemId: `card_${index}`, due: daysAgo(index) }),
    );
    const session = buildRecommendedSession(
      emptyPlannerInput({ retainDue, totalMinutes: 60, reviewLimit: 15 }),
    );
    const retainStep = session.steps.find((step) => step.mode === 'retain');
    expect(retainStep).toBeDefined();
    // A 60-minute planning pass can't fit more than the reviewLimit of
    // 15 items even if the whole budget went to retain — the batch step's
    // count is derived from the ranked (already-capped) list.
    expect(retainStep!.label).not.toMatch(/2\d\d|1[6-9]\d|[3-9]\d/);
  });

  it('a recently-encountered, not-yet-tracked grammar pattern surfaces as an Understand step with a reason', () => {
    const understandCandidates: UnderstandCandidate[] = [
      {
        grammarPatternId: 'pattern_temo',
        label: '～ても',
        reason: 'Encountered 3 times, not tracked yet.',
        sentenceId: 'sent_5',
      },
    ];
    const session = buildRecommendedSession(
      emptyPlannerInput({ understandCandidates }),
    );
    const step = session.steps.find((s) => s.grammarPatternId === 'pattern_temo');
    expect(step).toBeDefined();
    expect(step!.mode).toBe('understand');
    expect(step!.reason).toContain('Encountered 3 times');
  });

  it('a small (10-minute) planning pass produces a small, sensible mix that fits within budget', () => {
    const session = buildRecommendedSession(
      emptyPlannerInput({
        totalMinutes: 10,
        retainDue: Array.from({ length: 20 }, (_, i) => dueCandidate({ studyItemId: `q_${i}` })),
        exploreCandidates: [
          { bookId: 'b1', sentenceId: 's1', label: 'Book', reason: 'Continue', remainingCount: 10 },
        ],
        understandCandidates: [
          { grammarPatternId: 'p1', label: '～ても', reason: 'Encountered recently' },
        ],
        shadowCandidates: [{ sentenceId: 's2', label: 'Sentence', reason: 'Not yet shadowed' }],
      }),
    );
    expect(session.targetMinutes).toBe(10);
    const total = session.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
    expect(total).toBeLessThanOrEqual(10 + 1);
  });

  it('a large (60-minute) planning pass covers all four modes when candidates exist for each', () => {
    const session = buildRecommendedSession(
      emptyPlannerInput({
        totalMinutes: 60,
        retainDue: Array.from({ length: 20 }, (_, i) => dueCandidate({ studyItemId: `d_${i}` })),
        practiceDue: Array.from({ length: 20 }, (_, i) =>
          dueCandidate({ studyItemId: `dp_${i}`, mode: 'practice', activityType: 'cloze' }),
        ),
        exploreCandidates: [
          { bookId: 'b1', sentenceId: 's1', label: 'Book', reason: 'Continue', remainingCount: 30 },
        ],
        understandCandidates: [
          { grammarPatternId: 'p1', label: '～ても', reason: 'Encountered recently' },
          { grammarPatternId: 'p2', label: '～わけがない', reason: 'Encountered recently' },
        ],
        shadowCandidates: Array.from({ length: 10 }, (_, i) => ({
          sentenceId: `sh_${i}`,
          label: `Sentence ${i}`,
          reason: 'Not yet shadowed',
        })),
      }),
    );
    const modesPresent = new Set(session.steps.map((step) => step.mode));
    expect(modesPresent.size).toBe(4);
    const total = session.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
    expect(total).toBeLessThanOrEqual(60 + 1);
  });

  it('a large due-practice backlog does not crowd shadow candidates out entirely', () => {
    const session = buildRecommendedSession(
      emptyPlannerInput({
        practiceDue: Array.from({ length: 50 }, (_, i) =>
          dueCandidate({ studyItemId: `dp_${i}`, mode: 'practice', activityType: 'cloze' }),
        ),
        shadowCandidates: Array.from({ length: 10 }, (_, i) => ({
          sentenceId: `sh_${i}`,
          label: `Sentence ${i}`,
          reason: 'Not yet shadowed',
        })),
      }),
    );
    const shadowSteps = session.steps.filter((step) => step.targetKind === 'shadow');
    expect(shadowSteps.length).toBeGreaterThan(0);
  });

  it('never exceeds the requested time budget by an unreasonable amount, across all sizes', () => {
    for (const totalMinutes of [10, 30, 60] as const) {
      const session = buildRecommendedSession(
        emptyPlannerInput({
          totalMinutes,
          retainDue: Array.from({ length: 50 }, (_, i) => dueCandidate({ studyItemId: `${totalMinutes}_${i}` })),
          practiceDue: Array.from({ length: 50 }, (_, i) =>
            dueCandidate({ studyItemId: `${totalMinutes}p_${i}`, mode: 'practice' }),
          ),
          exploreCandidates: [
            { bookId: 'b1', sentenceId: 's1', label: 'Book', reason: 'Continue', remainingCount: 50 },
          ],
          understandCandidates: Array.from({ length: 10 }, (_, i) => ({
            grammarPatternId: `p_${i}`,
            label: `Pattern ${i}`,
            reason: 'Encountered recently',
          })),
          shadowCandidates: Array.from({ length: 20 }, (_, i) => ({
            sentenceId: `sh_${i}`,
            label: `Sentence ${i}`,
            reason: 'Not yet shadowed',
          })),
        }),
      );
      const total = session.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
      expect(total).toBeLessThanOrEqual(session.targetMinutes + 1);
    }
  });

  it('groups steps that share a sentenceId back to back (coherent chains)', () => {
    const session = buildRecommendedSession(
      emptyPlannerInput({
        totalMinutes: 60,
        understandCandidates: [
          { grammarPatternId: 'p1', label: '～ても', reason: 'Encountered recently', sentenceId: 'shared_sentence' },
        ],
        shadowCandidates: [
          { sentenceId: 'shared_sentence', label: 'Shared sentence', reason: 'Same sentence as the grammar pattern' },
          { sentenceId: 'other_sentence', label: 'Other sentence', reason: 'Unrelated' },
        ],
      }),
    );
    const sharedIndex = session.steps.findIndex((step) => step.sentenceId === 'shared_sentence');
    const nextStep = session.steps[sharedIndex + 1];
    expect(nextStep?.sentenceId).toBe('shared_sentence');
    expect(session.explanation.some((line) => line.includes('same sentence'))).toBe(true);
  });
});
