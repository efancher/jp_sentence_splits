import { describe, expect, it } from 'vitest';

import { isVisibleSubject, latestDataUpdatedAt } from '../scripts/lib/wanikaniCache';
import type { WkRawSubject } from '../scripts/lib/wanikani';

function raw(overrides: Partial<WkRawSubject> = {}): WkRawSubject {
  return {
    id: 1,
    object: 'kanji',
    data_updated_at: '2024-01-01T00:00:00.000000Z',
    data: {},
    ...overrides,
  };
}

describe('latestDataUpdatedAt', () => {
  it('returns null for an empty set (first populate — full pull)', () => {
    expect(latestDataUpdatedAt([])).toBeNull();
  });

  it('returns the newest timestamp — the incremental cursor', () => {
    expect(
      latestDataUpdatedAt([
        { data_updated_at: '2024-01-01T00:00:00Z' },
        { data_updated_at: '2024-06-15T12:00:00Z' },
        { data_updated_at: '2024-03-01T00:00:00Z' },
      ]),
    ).toBe('2024-06-15T12:00:00Z');
  });
});

describe('isVisibleSubject', () => {
  it('keeps a subject WaniKani has not hidden', () => {
    expect(isVisibleSubject(raw())).toBe(true);
    expect(isVisibleSubject(raw({ data: { hidden_at: null } }))).toBe(true);
  });

  it('drops a subject WaniKani has since hidden', () => {
    expect(isVisibleSubject(raw({ data: { hidden_at: '2024-05-01T00:00:00Z' } }))).toBe(false);
  });
});
