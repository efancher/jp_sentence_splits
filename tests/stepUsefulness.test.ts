import { describe, expect, it } from 'vitest';

import { buildStepUsefulness, type StepUsefulnessInput } from '../src/lib/stepUsefulness';

describe('buildStepUsefulness', () => {
  it('reports no data for an empty input', () => {
    const result = buildStepUsefulness([], 30);
    expect(result.hasData).toBe(false);
    expect(result.rows).toEqual([]);
  });

  it('groups by targetKind, counting only completed/skipped steps', () => {
    const steps: StepUsefulnessInput[] = [
      { targetKind: 'shadow', status: 'completed' },
      { targetKind: 'shadow', status: 'completed' },
      { targetKind: 'shadow', status: 'skipped' },
      { targetKind: 'continue_book', status: 'skipped' },
      { targetKind: 'continue_book', status: 'skipped' },
      { targetKind: 'continue_book', status: 'pending' },
      { targetKind: 'continue_book', status: 'active' },
      { targetKind: 'grammar_detail', status: 'replaced' },
    ];
    const result = buildStepUsefulness(steps, 56);
    expect(result.hasData).toBe(true);
    expect(result.windowDays).toBe(56);
    const shadow = result.rows.find((r) => r.targetKind === 'shadow')!;
    expect(shadow.completed).toBe(2);
    expect(shadow.skipped).toBe(1);
    expect(shadow.total).toBe(3);
    expect(shadow.skipRate).toBeCloseTo(1 / 3);
    const continueBook = result.rows.find((r) => r.targetKind === 'continue_book')!;
    expect(continueBook.completed).toBe(0);
    expect(continueBook.skipped).toBe(2);
    expect(continueBook.total).toBe(2);
    // pending/active never counted, and a targetKind with only 'replaced' steps drops out entirely.
    expect(result.rows.some((r) => r.targetKind === 'grammar_detail')).toBe(false);
  });

  it('sorts rows by skip rate, highest first', () => {
    const steps: StepUsefulnessInput[] = [
      { targetKind: 'low_skip', status: 'completed' },
      { targetKind: 'low_skip', status: 'completed' },
      { targetKind: 'low_skip', status: 'skipped' },
      { targetKind: 'high_skip', status: 'skipped' },
      { targetKind: 'high_skip', status: 'completed' },
    ];
    const result = buildStepUsefulness(steps, 30);
    expect(result.rows.map((r) => r.targetKind)).toEqual(['high_skip', 'low_skip']);
  });
});
