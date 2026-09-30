import { describe, expect, it } from 'vitest';

import type { SentenceLearningEvent } from '../domain/types';

import { remoteToSentenceLearningEvent, sentenceLearningEventToRemote, toRemoteRow } from './mappers';

const base: SentenceLearningEvent = {
  id: 'e1', timestamp: '2026-09-30T10:00:00.000Z', visitId: 'v1', action: 'walkthrough_opened',
  bookId: 'b', sentenceId: 's',
};

describe('sentence learning event mapping', () => {
  it('round-trips a full practice event, including the target and self assessment', () => {
    const full: SentenceLearningEvent = {
      ...base, action: 'target_practice', chapterId: 'c',
      target: { kind: 'grammar', key: 'expression:〜たり', label: '〜たり' },
      support: 'explanation_hidden', outcome: 'needed_help', assessmentSource: 'self',
      exposedSentenceId: 's2', quietMode: true, inventoryRevision: 'rev',
      report: 'another_answer_works', learnerAnswer: 'it marks the topic',
      modality: 'typed', scaffold: 'frame', unitsExpressed: 2, unitsTotal: 3,
    };
    expect(remoteToSentenceLearningEvent(sentenceLearningEventToRemote(full, 'owner', 1))).toEqual(full);
  });

  it('maps a minimal event to nulls and back to a clean object with no target', () => {
    const remote = sentenceLearningEventToRemote(base, 'owner', 1);
    expect(remote.target_key).toBeNull();
    expect(remote.quiet_mode).toBeNull();
    const back = remoteToSentenceLearningEvent(remote);
    expect(back.target).toBeUndefined();
    expect(back.outcome).toBeUndefined();
    expect(back.quietMode).toBeUndefined();
  });

  it('is routed by entity name, and is never a review or study item', () => {
    expect(toRemoteRow('sentence_learning_events', base, 'owner', 1)).toMatchObject({ id: 'e1', owner_id: 'owner', action: 'walkthrough_opened' });
  });
});
