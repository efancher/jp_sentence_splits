import { describe, expect, it } from 'vitest';

import { describePending } from '../src/sync/engine';

const item = (entity: string) => ({ entity }) as never;

describe('describePending', () => {
  it('names nothing for an empty queue', () => {
    expect(describePending([])).toBe('');
  });

  it('counts entities, most numerous first, and caps the list', () => {
    expect(describePending([item('books'), item('sentences'), item('sentences')])).toBe(' (sentences: 2, books: 1)');
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map(item);
    expect(describePending(many)).toBe(' (a: 1, b: 1, c: 1, d: 1, +2 more)');
  });
});
