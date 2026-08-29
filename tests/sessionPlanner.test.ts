import { describe, expect, it } from 'vitest';

import type { SessionBucket } from '../src/domain/types';
import {
  ALL_SESSION_BUCKETS,
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
    mode: 'review',
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
  it('treats a bucket with no events at all as maximally neglected', () => {
    const distribution = computeRecentActivityDistribution([], NOW);
    expect(distribution.shadowing.daysSinceLast).toBeNull();
    const neglect = computeNeglectScores(distribution);
    expect(neglect.shadowing).toBe(1);
  });

  it('gives a bucket touched today a near-zero neglect score', () => {
    const events: RecentActivityEvent[] = [{ mode: 'review', timestamp: NOW.toISOString() }];
    const distribution = computeRecentActivityDistribution(events, NOW);
    const neglect = computeNeglectScores(distribution);
    expect(neglect.review).toBeCloseTo(0, 5);
  });

  it('scales neglect linearly up to the window, then clamps at 1', () => {
    const events: RecentActivityEvent[] = [{ mode: 'grammar', timestamp: daysAgo(30) }];
    const distribution = computeRecentActivityDistribution(events, NOW, 14);
    const neglect = computeNeglectScores(distribution, 14);
    expect(neglect.grammar).toBe(1);
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
  it("redistributes a capped bucket's leftover minutes to the others", () => {
    const neutralNeglect = Object.fromEntries(ALL_SESSION_BUCKETS.map((m) => [m, 0])) as Record<
      SessionBucket,
      number
    >;
    const allocation = allocateTimeAcrossModes({
      totalMinutes: 30,
      neglectScores: neutralNeglect,
      availableMinutesByMode: { review: 1 },
    });
    expect(allocation.review).toBe(1);
    expect(allocation.glossing + allocation.grammar + allocation.shadowing).toBe(29);
  });

  it('sums to the requested total minutes (rounding drift absorbed by the largest share)', () => {
    const neglect = { glossing: 0.2, grammar: 0.5, shadowing: 0.9, review: 0.1 };
    const allocation = allocateTimeAcrossModes({ totalMinutes: 10, neglectScores: neglect });
    const sum = ALL_SESSION_BUCKETS.reduce((total, mode) => total + allocation[mode], 0);
    expect(sum).toBe(10);
  });

  it('shifts share toward a heavily-neglected bucket relative to the baseline', () => {
    const neglected = { glossing: 0, grammar: 0, shadowing: 1, review: 0 };
    const untouched = { glossing: 0, grammar: 0, shadowing: 0, review: 0 };
    const withNeglect = allocateTimeAcrossModes({ totalMinutes: 60, neglectScores: neglected });
    const baseline = allocateTimeAcrossModes({ totalMinutes: 60, neglectScores: untouched });
    expect(withNeglect.shadowing).toBeGreaterThan(baseline.shadowing);
  });
});

describe('buildRecommendedSession', () => {
  it('a brand-new user with no history gets a non-crashing baseline plan', () => {
    const session = buildRecommendedSession(emptyPlannerInput());
    expect(session.targetMinutes).toBe(30);
    expect(session.steps).toEqual([]);
    expect(session.explanation.length).toBeGreaterThan(0);
  });

  it('review-heavy recent activity with neglected glossing/shadowing shifts allocation away from review', () => {
    const recentActivity: RecentActivityEvent[] = Array.from({ length: 10 }, (_, index) => ({
      mode: 'review' as const,
      timestamp: daysAgo(index * 0.5),
    }));
    const session = buildRecommendedSession(
      emptyPlannerInput({
        recentActivity,
        retainDue: [dueCandidate()],
      }),
    );
    expect(session.neglectScores.review).toBe(0);
    expect(session.neglectScores.glossing).toBe(1);
    expect(session.neglectScores.shadowing).toBe(1);
    expect(session.allocation.review).toBeLessThan(30 * 0.35 + 1);
  });

  it('neglected shadowing increases shadowing allocation and produces shadow steps', () => {
    const recentActivity: RecentActivityEvent[] = [
      { mode: 'review', timestamp: daysAgo(0) },
      { mode: 'glossing', timestamp: daysAgo(0) },
      { mode: 'grammar', timestamp: daysAgo(1) },
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
    expect(session.neglectScores.shadowing).toBeGreaterThan(0.4);
    const shadowSteps = session.steps.filter((step) => step.targetKind === 'shadow');
    expect(shadowSteps.length).toBeGreaterThan(0);
  });

  it('with no due reviews, review gets 0 minutes and the rest is spent elsewhere', () => {
    const exploreCandidates: ExploreCandidate[] = [
      {
        bookId: 'book_1',
        label: 'Episode 4',
        reason: 'Continue',
        sentences: Array.from({ length: 20 }, (_, i) => ({
          sentenceId: `sent_${i}`,
          preview: 'x',
          vocabularyConfirmed: false,
          vocabularyReady: false,
        })),
      },
    ];
    const session = buildRecommendedSession(
      emptyPlannerInput({ exploreCandidates }),
    );
    expect(session.allocation.review).toBe(0);
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
    const reviewStep = session.steps.find((step) => step.targetKind === 'review');
    expect(reviewStep).toBeDefined();
    // A 60-minute planning pass can't fit more than the reviewLimit of
    // 15 items even if the whole budget went to review — the batch step's
    // count is derived from the ranked (already-capped) list.
    expect(reviewStep!.targetCount).toBeLessThanOrEqual(15);
  });

  it('a recently-encountered, not-yet-tracked grammar pattern surfaces as a grammar step with a reason', () => {
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
    expect(step!.bucket).toBe('grammar');
    expect(step!.reason).toContain('Encountered 3 times');
  });

  it('a small (10-minute) planning pass produces a small, sensible mix that fits within budget', () => {
    const session = buildRecommendedSession(
      emptyPlannerInput({
        totalMinutes: 10,
        retainDue: Array.from({ length: 20 }, (_, i) => dueCandidate({ studyItemId: `q_${i}` })),
        exploreCandidates: [
          {
            bookId: 'b1',
            label: 'Book',
            reason: 'Continue',
            sentences: Array.from({ length: 10 }, (_, i) => ({
              sentenceId: `s${i}`,
              preview: 'x',
              vocabularyConfirmed: false,
              vocabularyReady: false,
            })),
          },
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

  it('a large (60-minute) planning pass covers all four buckets when candidates exist for each', () => {
    const session = buildRecommendedSession(
      emptyPlannerInput({
        totalMinutes: 60,
        retainDue: Array.from({ length: 20 }, (_, i) => dueCandidate({ studyItemId: `d_${i}` })),
        practiceDue: Array.from({ length: 20 }, (_, i) =>
          dueCandidate({ studyItemId: `dp_${i}`, activityType: 'cloze' }),
        ),
        exploreCandidates: [
          {
            bookId: 'b1',
            label: 'Book',
            reason: 'Continue',
            sentences: Array.from({ length: 30 }, (_, i) => ({
              sentenceId: `s${i}`,
              preview: 'x',
              vocabularyConfirmed: false,
              vocabularyReady: false,
            })),
          },
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
    const bucketsPresent = new Set(session.steps.map((step) => step.bucket));
    expect(bucketsPresent.size).toBe(4);
    const total = session.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0);
    expect(total).toBeLessThanOrEqual(60 + 1);
  });

  it('a large due-practice backlog does not crowd shadow candidates out (fully decoupled buckets)', () => {
    const session = buildRecommendedSession(
      emptyPlannerInput({
        practiceDue: Array.from({ length: 50 }, (_, i) =>
          dueCandidate({ studyItemId: `dp_${i}`, activityType: 'cloze' }),
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
            dueCandidate({ studyItemId: `${totalMinutes}p_${i}` }),
          ),
          exploreCandidates: [
            {
              bookId: 'b1',
              label: 'Book',
              reason: 'Continue',
              sentences: Array.from({ length: 50 }, (_, i) => ({
                sentenceId: `s${i}`,
                preview: 'x',
                vocabularyConfirmed: false,
                vocabularyReady: false,
              })),
            },
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

  it('a thin due queue does not balloon into a shadowing-dominated session when shadowing is a small share', () => {
    // Learner asked for a mostly-review hour, but only a handful of due
    // cards exist. The freed minutes must not all pour into shadowing.
    const recentActivity: RecentActivityEvent[] = [
      { mode: 'review', timestamp: daysAgo(0) },
      { mode: 'shadowing', timestamp: daysAgo(1) },
      { mode: 'glossing', timestamp: daysAgo(11) },
    ];
    const session = buildRecommendedSession(
      emptyPlannerInput({
        totalMinutes: 60,
        recentActivity,
        baseline: { glossing: 0, grammar: 0.05, shadowing: 0.05, review: 0.9 },
        retainDue: Array.from({ length: 14 }, (_, i) => dueCandidate({ studyItemId: `d_${i}` })),
        shadowCandidates: Array.from({ length: 10 }, (_, i) => ({
          sentenceId: `sh_${i}`,
          label: `Sentence ${i}`,
          reason: 'Not yet shadowed',
        })),
      }),
    );
    const shadowMinutes = session.steps
      .filter((step) => step.targetKind === 'shadow')
      .reduce((sum, step) => sum + step.estimatedMinutes, 0);
    const reviewStep = session.steps.find((step) => step.targetKind === 'review');
    expect(reviewStep).toBeDefined();
    // Shadowing is a 5% share — its slice of the plan should stay modest,
    // nowhere near the ~20 min the old redistribute-to-weight logic gave it.
    expect(shadowMinutes).toBeLessThan(reviewStep!.estimatedMinutes);
    expect(session.allocation.shadowing).toBeLessThan(10);
  });

  it('plans a shorter session, with an explanation, when no bucket can absorb the requested time', () => {
    const session = buildRecommendedSession(
      emptyPlannerInput({
        totalMinutes: 60,
        retainDue: Array.from({ length: 3 }, (_, i) => dueCandidate({ studyItemId: `d_${i}` })),
      }),
    );
    const planned = ALL_SESSION_BUCKETS.reduce((sum, b) => sum + session.allocation[b], 0);
    expect(planned).toBeLessThan(30);
    expect(session.explanation.some((line) => line.includes('shorter than'))).toBe(true);
  });

  it('does not claim to emphasize a neglected bucket the learner zeroed in their split', () => {
    const session = buildRecommendedSession(
      emptyPlannerInput({
        totalMinutes: 60,
        baseline: { glossing: 0, grammar: 0.05, shadowing: 0.05, review: 0.9 },
        recentActivity: [
          { mode: 'review', timestamp: daysAgo(0) },
          { mode: 'grammar', timestamp: daysAgo(0) },
          { mode: 'shadowing', timestamp: daysAgo(0) },
          { mode: 'glossing', timestamp: daysAgo(11) },
        ],
        retainDue: Array.from({ length: 14 }, (_, i) => dueCandidate({ studyItemId: `d_${i}` })),
      }),
    );
    expect(session.neglectScores.glossing).toBeGreaterThan(0.7);
    expect(session.explanation.some((line) => line.includes('glossing') && line.includes('emphasizes'))).toBe(
      false,
    );
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

  it('skips a redundant vocabulary_review step for a sentence whose vocab is already confirmed and proficient', () => {
    const exploreCandidates: ExploreCandidate[] = [
      {
        bookId: 'book_1',
        label: 'Book',
        reason: 'Continue',
        sentences: [
          { sentenceId: 'sent_confirmed', preview: 'x', vocabularyConfirmed: true, vocabularyReady: true },
        ],
      },
    ];
    const session = buildRecommendedSession(emptyPlannerInput({ exploreCandidates }));
    const stepsForSentence = session.steps.filter((step) => step.sentenceId === 'sent_confirmed');
    expect(stepsForSentence).toHaveLength(1);
    expect(stepsForSentence[0]!.targetKind).toBe('continue_book');
  });

  it('gives a not-yet-confirmed sentence only a vocabulary_review step, never continue_book in the same pass', () => {
    const exploreCandidates: ExploreCandidate[] = [
      {
        bookId: 'book_1',
        label: 'Book',
        reason: 'Continue',
        sentences: [
          { sentenceId: 'sent_new', preview: 'x', vocabularyConfirmed: false, vocabularyReady: false },
        ],
      },
    ];
    const session = buildRecommendedSession(emptyPlannerInput({ exploreCandidates }));
    const stepsForSentence = session.steps.filter((step) => step.sentenceId === 'sent_new');
    expect(stepsForSentence).toHaveLength(1);
    expect(stepsForSentence[0]!.targetKind).toBe('vocabulary_review');
  });

  it('vocabulary confirmations get first claim on the glossing budget, ahead of continue_book for already-confirmed sentences', () => {
    const exploreCandidates: ExploreCandidate[] = [
      {
        bookId: 'book_1',
        label: 'Book',
        reason: 'Continue',
        sentences: [
          // Confirmed + proficient sentences come first in reading order —
          // the old planner would have drafted their continue_book steps
          // before ever reaching the unconfirmed sentences below.
          { sentenceId: 'ready_1', preview: 'a', vocabularyConfirmed: true, vocabularyReady: true },
          { sentenceId: 'ready_2', preview: 'b', vocabularyConfirmed: true, vocabularyReady: true },
          ...Array.from({ length: 20 }, (_, i) => ({
            sentenceId: `new_${i}`,
            preview: `n${i}`,
            vocabularyConfirmed: false,
            vocabularyReady: false,
          })),
        ],
      },
    ];
    const session = buildRecommendedSession(emptyPlannerInput({ totalMinutes: 30, exploreCandidates }));
    const glossing = session.steps.filter((step) => step.bucket === 'glossing');
    expect(glossing.length).toBeGreaterThan(2);
    // The first glossing steps drafted are confirmations, not continue_book.
    expect(glossing[0]!.targetKind).toBe('vocabulary_review');
    const vocabMinutes = glossing
      .filter((step) => step.targetKind === 'vocabulary_review')
      .reduce((sum, step) => sum + step.estimatedMinutes, 0);
    const totalGlossingMinutes = glossing.reduce((sum, step) => sum + step.estimatedMinutes, 0);
    expect(vocabMinutes / totalGlossingMinutes).toBeGreaterThanOrEqual(0.6);
  });

  it('leaves the whole glossing bucket to structural analysis when there is no confirmation backlog', () => {
    const exploreCandidates: ExploreCandidate[] = [
      {
        bookId: 'book_1',
        label: 'Book',
        reason: 'Continue',
        sentences: Array.from({ length: 10 }, (_, i) => ({
          sentenceId: `ready_${i}`,
          preview: `r${i}`,
          vocabularyConfirmed: true,
          vocabularyReady: true,
        })),
      },
    ];
    const session = buildRecommendedSession(emptyPlannerInput({ totalMinutes: 30, exploreCandidates }));
    const glossing = session.steps.filter((step) => step.bucket === 'glossing');
    expect(glossing.length).toBeGreaterThan(0);
    expect(glossing.every((step) => step.targetKind === 'continue_book')).toBe(true);
  });

  it('gives no step at all to a sentence whose vocab is confirmed but not yet proficient, and moves on to the next sentence', () => {
    const exploreCandidates: ExploreCandidate[] = [
      {
        bookId: 'book_1',
        label: 'Book',
        reason: 'Continue',
        sentences: [
          { sentenceId: 'sent_maturing', preview: 'x', vocabularyConfirmed: true, vocabularyReady: false },
          { sentenceId: 'sent_next', preview: 'y', vocabularyConfirmed: false, vocabularyReady: false },
        ],
      },
    ];
    const session = buildRecommendedSession(emptyPlannerInput({ exploreCandidates }));
    expect(session.steps.some((step) => step.sentenceId === 'sent_maturing')).toBe(false);
    const nextSteps = session.steps.filter((step) => step.sentenceId === 'sent_next');
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]!.targetKind).toBe('vocabulary_review');
  });
});
