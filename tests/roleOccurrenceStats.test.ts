import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, getRoleOccurrenceStats } from '../src/db/repository';
import type { AnalysisChunk, SentenceAnalysis } from '../src/domain/types';
import { createId } from '../src/lib/ids';

function makeChunk(role: string, overrides: Partial<AnalysisChunk> = {}): AnalysisChunk {
  return {
    id: createId('chunk'),
    order: 0,
    japanese: '猫',
    role,
    literalEnglish: 'cat',
    ...overrides,
  };
}

function makeAnalysis(
  sentenceId: string,
  chunks: AnalysisChunk[],
  createdAt: string,
): SentenceAnalysis {
  return {
    sentenceId,
    chunks,
    notes: '',
    status: 'complete',
    formatVersion: 1,
    vocabularyReviewStatus: 'confirmed',
    vocabularySelections: [],
    grammarReviewStatus: 'unreviewed',
    grammarSuggestions: [],
    createdAt,
    updatedAt: createdAt,
  };
}

describe('getRoleOccurrenceStats', () => {
  beforeEach(() => {
    resetDbForTests(`role-occurrence-stats-${createId('db')}`);
  });

  it('counts occurrences per role and tracks first/most-recent by createdAt order', async () => {
    const db = getDb();
    await db.analyses.put(
      makeAnalysis('s1', [makeChunk('topic は'), makeChunk('engine')], '2026-01-01T00:00:00.000Z'),
    );
    await db.analyses.put(
      makeAnalysis('s2', [makeChunk('topic は'), makeChunk('を-car')], '2026-01-02T00:00:00.000Z'),
    );
    await db.analyses.put(
      makeAnalysis('s3', [makeChunk('topic は')], '2026-01-03T00:00:00.000Z'),
    );

    const stats = await getRoleOccurrenceStats();
    const topicHa = stats.get('topic は');
    expect(topicHa).toEqual({
      count: 3,
      firstSentenceId: 's1',
      mostRecentSentenceId: 's3',
    });
    expect(stats.get('engine')).toEqual({
      count: 1,
      firstSentenceId: 's1',
      mostRecentSentenceId: 's1',
    });
  });

  it('excludes the given sentence id, e.g. so a sentence does not count as having seen itself', async () => {
    const db = getDb();
    await db.analyses.put(
      makeAnalysis('s1', [makeChunk('topic は')], '2026-01-01T00:00:00.000Z'),
    );
    await db.analyses.put(
      makeAnalysis('s2', [makeChunk('topic は')], '2026-01-02T00:00:00.000Z'),
    );

    const stats = await getRoleOccurrenceStats('s2');
    expect(stats.get('topic は')).toEqual({
      count: 1,
      firstSentenceId: 's1',
      mostRecentSentenceId: 's1',
    });
  });

  it('skips blank/whitespace-only roles', async () => {
    const db = getDb();
    await db.analyses.put(
      makeAnalysis('s1', [makeChunk(''), makeChunk('  ')], '2026-01-01T00:00:00.000Z'),
    );

    const stats = await getRoleOccurrenceStats();
    expect(stats.size).toBe(0);
  });

  it('returns an empty map for an empty corpus', async () => {
    const stats = await getRoleOccurrenceStats();
    expect(stats.size).toBe(0);
  });
});
