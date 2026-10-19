import { describe, expect, it } from 'vitest';

import {
  delayBucket,
  reviewCoverage,
  summariseEvents,
  summariseGloss,
  summariseReviewMisses,
  type EventRow,
  type GlossRow,
  type ReviewRow,
  type StudyItemRow,
} from '../scripts/lib/routingEvidenceAudit';

const gloss = (over: Partial<GlossRow>): GlossRow => ({
  id: 'g',
  timestamp: '2026-10-02T00:00:00Z',
  visitId: 'v1',
  sentenceId: 's1',
  skill: 'particle',
  subskill: 'case',
  ruleKey: 'particle:を',
  levelShown: 4,
  firstCorrect: true,
  referenceConfidence: 'settled',
  hintMaxStep: 0,
  explanationOpened: false,
  blocker: null,
  vocabHelped: false,
  translationLevel: 0,
  outcome: 'independent_correct',
  ...over,
});

const review = (over: Partial<ReviewRow>): ReviewRow => ({
  id: 'r',
  studyItemId: 'i1',
  timestamp: '2026-10-02T00:00:00Z',
  rating: 'good',
  assistance: null,
  elapsedMs: null,
  predictedRetrievability: null,
  contextSentenceId: null,
  presentation: null,
  meaningChoice: null,
  comprehensionCheckCorrect: null,
  source: null,
  ...over,
});

const items = new Map<string, StudyItemRow>([
  ['i1', { id: 'i1', subjectType: 'sentence', subjectId: 's1', activityType: 'reading_in_context' }],
]);

describe('delayBucket', () => {
  it('buckets by elapsed days', () => {
    expect(delayBucket('2026-10-01T00:00:00Z', '2026-10-01T05:00:00Z')).toBe('<1d');
    expect(delayBucket('2026-10-01T00:00:00Z', '2026-10-03T00:00:00Z')).toBe('1-3d');
    expect(delayBucket('2026-10-01T00:00:00Z', '2026-10-05T00:00:00Z')).toBe('3-7d');
    expect(delayBucket('2026-10-01T00:00:00Z', '2026-10-20T00:00:00Z')).toBe('>7d');
  });
});

describe('summariseGloss', () => {
  it('finds same-item and transfer follow-ups only in later visits', () => {
    const rows = [
      gloss({ id: 'miss', visitId: 'v1', firstCorrect: false, outcome: 'assisted_correct', hintMaxStep: 2 }),
      gloss({ id: 'sameVisit', visitId: 'v1', timestamp: '2026-10-02T00:01:00Z' }),
      gloss({ id: 'transfer', visitId: 'v2', sentenceId: 's2', timestamp: '2026-10-04T00:00:00Z' }),
      gloss({ id: 'same', visitId: 'v3', timestamp: '2026-10-02T06:00:00Z' }),
      gloss({ id: 'ungraded', visitId: 'v4', firstCorrect: null, outcome: 'ungraded' }),
    ];
    const summary = summariseGloss(rows);
    expect(summary.gradable).toBe(3 + 0 + 1);
    expect(summary.misses).toBe(1);
    expect(summary.missesWithHelpRecorded).toBe(1);
    expect(summary.followUp.withSameItemFollowUp).toBe(1);
    expect(summary.followUp.sameItemDelay['<1d']).toBe(1);
    expect(summary.followUp.withTransferFollowUp).toBe(1);
    expect(summary.followUp.transferDelay?.['1-3d']).toBe(1);
    expect(summary.followUp.withoutAnyFollowUp).toBe(0);
  });

  it('counts a miss with no later attempt as having no follow-up', () => {
    const summary = summariseGloss([gloss({ firstCorrect: false, outcome: 'unresolved' })]);
    expect(summary.followUp.withoutAnyFollowUp).toBe(1);
  });

  it('restricts independent follow-ups to support level 4', () => {
    const summary = summariseGloss([
      gloss({ id: 'miss', firstCorrect: false, outcome: 'unresolved' }),
      gloss({ id: 'later', visitId: 'v2', levelShown: 2, timestamp: '2026-10-03T00:00:00Z' }),
    ]);
    expect(summary.followUp.withSameItemFollowUp).toBe(1);
    expect(summary.independentFollowUp.withSameItemFollowUp).toBe(0);
  });
});

describe('offered versus used help', () => {
  it('counts offered, used, and missed-while-unused per support, ignoring rows without a snapshot', () => {
    const summary = summariseGloss([
      gloss({ id: 'a', helpOffered: ['word_glosses', 'try_unaided', 'hints'], firstCorrect: false, outcome: 'assisted_correct' }),
      gloss({ id: 'b', helpOffered: ['word_glosses', 'hints'], vocabHelped: true, hintMaxStep: 1, outcome: 'assisted_correct' }),
      gloss({ id: 'c', helpOffered: ['try_unaided', 'hints'], unaidedChosen: true }),
      gloss({ id: 'd' }), // recorded before the snapshot existed
    ]);
    expect(summary.linkCoverage.helpOffered).toBe(3);
    expect(summary.offeredVsUsed.word_glosses).toEqual({ offered: 2, used: 1, missesOfferedUnused: 1 });
    expect(summary.offeredVsUsed.try_unaided).toEqual({ offered: 2, used: 1, missesOfferedUnused: 1 });
    expect(summary.offeredVsUsed.hints).toEqual({ offered: 3, used: 1, missesOfferedUnused: 1 });
  });
});

describe('review summaries', () => {
  it('treats an empty assistance array as recorded but not as help used', () => {
    const rows = [
      review({ id: 'a', assistance: [], rating: 'again' }),
      review({ id: 'b', timestamp: '2026-10-05T00:00:00Z', assistance: ['hint_shown'] }),
    ];
    const coverage = reviewCoverage(rows, items);
    expect(coverage[0]?.fields.assistance).toBe(1);
    const misses = summariseReviewMisses(rows, items);
    expect(misses[0]).toMatchObject({ misses: 1, missesWithAssistanceRecorded: 0, missesWithLaterReview: 1 });
    expect(misses[0]?.delay['3-7d']).toBe(1);
  });

  it('groups reviews with no known study item', () => {
    expect(reviewCoverage([review({ studyItemId: 'gone' })], items)[0]?.group).toBe('(study item missing)');
  });
});

describe('summariseEvents', () => {
  it('links a needed_help practice to a later-visit event on the same target', () => {
    const event = (over: Partial<EventRow>): EventRow => ({
      id: 'e',
      timestamp: '2026-10-02T00:00:00Z',
      visitId: 'v1',
      action: 'target_practice',
      sentenceId: 's1',
      targetKey: 'k',
      support: null,
      outcome: 'needed_help',
      helpLevel: null,
      exposedSentenceId: null,
      ...over,
    });
    const summary = summariseEvents([
      event({}),
      event({ id: 'later', visitId: 'v2', action: 'held_back_check', outcome: 'got_it', timestamp: '2026-10-10T00:00:00Z' }),
    ]);
    expect(summary.neededHelpWithLaterTargetEvent).toBe(1);
    expect(summary.laterDelay['>7d']).toBe(1);
    expect(summary.laterWithOutcome).toBe(1);
  });
});
