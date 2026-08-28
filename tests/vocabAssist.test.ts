import { describe, expect, it } from 'vitest';

import { glossVocabulary } from '../src/lib/vocabAssist';

/**
 * No test signs in to a real Supabase session (same documented boundary as
 * grammarAssist.test.ts / sync.test.ts), so every call degrades — either
 * "not configured" or "sign in" depending on the environment's own `.env`.
 * It must resolve to a typed unavailable result, never throw.
 */
describe('vocabAssist (graceful degradation, no signed-in session)', () => {
  it('glossVocabulary degrades without throwing', async () => {
    const result = await glossVocabulary({
      sentence: '先輩に頼まれた仕事を頑張る。',
      words: [
        { expression: '先輩', reading: 'せんぱい' },
        { expression: '頑張る', reading: 'がんばる' },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('returns an unavailable result for an empty word list without a network call', async () => {
    const result = await glossVocabulary({ sentence: '先輩。', words: [] });
    expect(result.ok).toBe(false);
  });
});
