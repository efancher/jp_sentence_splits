import { describe, expect, it } from 'vitest';

import {
  explainGrammarPattern,
  suggestGrammarPatterns,
} from '../src/lib/grammarAssist';

/**
 * No test signs in to a real Supabase session (and this suite has no
 * Supabase-mocking harness — same documented boundary sync.test.ts relies
 * on, see src/sync/engine.ts), so every call here degrades — either
 * "not configured" (no env vars) or "sign in" (configured, no session),
 * depending on the environment's own `.env`. Either way it must resolve
 * to a typed unavailable result, never throw and never claim success.
 */
describe('grammarAssist (graceful degradation, no signed-in session)', () => {
  it('suggestGrammarPatterns degrades without throwing', async () => {
    const result = await suggestGrammarPatterns({ sentence: '猫が好きです。' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('explainGrammarPattern degrades without throwing', async () => {
    const result = await explainGrammarPattern({
      sentence: 'そんなこと言うわけないでしょ。',
      patternName: '〜わけがない',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
