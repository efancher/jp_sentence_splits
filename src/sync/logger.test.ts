import { describe, expect, it } from 'vitest';

import { buildDiagnosticsSnapshot, summarizePendingItem, syncLog } from './logger';
import type { SyncQueueItem } from './types';

const item = (overrides: Partial<SyncQueueItem>): SyncQueueItem => ({
  id: 'opq_1',
  entity: 'sentence_grammar',
  recordId: 'sg_1',
  operation: 'upsert',
  expectedVersion: null,
  payload: {},
  localTimestamp: '2026-09-19T15:00:00.000Z',
  retryCount: 0,
  ...overrides,
});

describe('summarizePendingItem', () => {
  it('keeps the ids a foreign-key / RLS failure is about, never content', () => {
    const summary = summarizePendingItem(
      item({
        payload: {
          id: 'sg_1',
          sentenceId: 'sent_a',
          grammarPatternId: 'grammar_pattern_local',
          occurrenceExplanation: 'a private note that must not leak',
          surfaceForm: '今、',
          start: 3,
          confirmedByLearner: true,
        },
        retryCount: 4,
        lastError: 'new row violates row-level security policy for table "sentence_grammar"',
      }),
    );
    expect(summary.refs).toEqual({ sentenceId: 'sent_a', grammarPatternId: 'grammar_pattern_local' });
    expect(JSON.stringify(summary)).not.toContain('private note');
    expect(summary).toMatchObject({ entity: 'sentence_grammar', recordId: 'sg_1', retryCount: 4 });
  });

  it('includes study-item subject and activity discriminators', () => {
    const summary = summarizePendingItem(
      item({ entity: 'study_items', payload: { id: 's1', subjectType: 'grammarPattern', subjectId: 'gp_1', activityType: 'grammar_completion', fsrsState: { due: 'x' } } }),
    );
    expect(summary.refs).toEqual({ subjectType: 'grammarPattern', subjectId: 'gp_1', activityType: 'grammar_completion' });
  });

  it('tolerates a missing/odd payload and truncates a long error', () => {
    expect(summarizePendingItem(item({ payload: null })).refs).toEqual({});
    expect(summarizePendingItem(item({ payload: undefined })).lastError).toBeNull();
    expect(summarizePendingItem(item({ lastError: 'x'.repeat(500) })).lastError).toHaveLength(200);
  });
});

describe('buildDiagnosticsSnapshot', () => {
  it('includes the pending queue and each recent log event’s details (entity, recordId, message)', () => {
    syncLog('warn', 'Push failed', 'PUSH_FAIL', { entity: 'sentence_grammar', recordId: 'sg_1', message: 'row-level security' });
    syncLog('info', 'auth', 'AUTH', { accessToken: 'secret-token-value' });
    const parsed = JSON.parse(
      buildDiagnosticsSnapshot({
        online: true,
        pendingCount: 1,
        conflictCount: 0,
        status: 'error',
        pendingQueue: [summarizePendingItem(item({ payload: { grammarPatternId: 'gp_x' } }))],
      }),
    );
    expect(parsed.pendingQueue).toHaveLength(1);
    expect(parsed.pendingQueue[0].refs.grammarPatternId).toBe('gp_x');
    const fail = parsed.recentLogs.find((e: { code?: string }) => e.code === 'PUSH_FAIL');
    expect(fail.details).toMatchObject({ entity: 'sentence_grammar', recordId: 'sg_1', message: 'row-level security' });
    expect(JSON.stringify(parsed)).not.toContain('secret-token-value'); // still redacted
  });

  it('caps the queue at 30 entries', () => {
    const many = Array.from({ length: 50 }, (_, i) => summarizePendingItem(item({ recordId: `sg_${i}` })));
    const parsed = JSON.parse(buildDiagnosticsSnapshot({ online: true, pendingCount: 50, conflictCount: 0, status: 'pending', pendingQueue: many }));
    expect(parsed.pendingQueue).toHaveLength(30);
  });
});
