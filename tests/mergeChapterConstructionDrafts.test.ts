import { describe, expect, it } from 'vitest';

import type { ConstructionLayer } from '../src/domain/types';
import { mergeChapterConstructionDrafts } from '../src/lib/contextWalkthrough';

const layer = (key: string) => ({ key, text: 'x', start: 0, end: 1 }) as unknown as ConstructionLayer;

describe('mergeChapterConstructionDrafts', () => {
  it('lets a chapter see drafts stored under another chapter for a repeated sentence', () => {
    const merged = mergeChapterConstructionDrafts([
      { constructionDrafts: { sent_a: [layer('te_kureru')] } },
      {},
      { constructionDrafts: { sent_b: [layer('other')] } },
    ]);
    expect(merged.sent_a?.[0]?.key).toBe('te_kureru');
    expect(merged.sent_b?.[0]?.key).toBe('other');
  });

  it('keeps the fuller draft when chapters disagree', () => {
    const merged = mergeChapterConstructionDrafts([
      { constructionDrafts: { sent_a: [layer('one')] } },
      { constructionDrafts: { sent_a: [layer('one'), layer('two')] } },
    ]);
    expect(merged.sent_a).toHaveLength(2);
  });
});
