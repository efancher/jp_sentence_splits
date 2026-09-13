import { describe, expect, it, vi } from 'vitest';

import { realignTranslations, type RealignGroupInput } from '../src/lib/sentenceRealign';

const authedSession = { data: { session: { user: { id: 'u1' } } } };

function group(n: number): RealignGroupInput {
  return { originalJapanese: `J${n}`, originalTranslation: '', pieces: [`p${n}`] };
}

describe('realignTranslations', () => {
  it('returns "Nothing to realign" for an empty input', async () => {
    const result = await realignTranslations([]);
    expect(result).toEqual({ ok: false, reason: 'Nothing to realign.' });
  });

  it('makes one call and returns groups in order for a small batch', async () => {
    const invoke = vi.fn(async (_name: string, options: { body: { groups: RealignGroupInput[] } }) => ({
      data: { groups: options.body.groups.map((g) => ({ pieceTranslations: [`EN:${g.originalJapanese}`] })) },
      error: null,
    }));
    vi.doMock('../src/sync/supabaseClient', () => ({
      getSupabase: () => ({ auth: { getSession: async () => authedSession }, functions: { invoke } }),
    }));
    vi.resetModules();
    const { realignTranslations: fn } = await import('../src/lib/sentenceRealign');

    const groups = [group(1), group(2), group(3)];
    const result = await fn(groups);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      groups: [
        { pieceTranslations: ['EN:J1'] },
        { pieceTranslations: ['EN:J2'] },
        { pieceTranslations: ['EN:J3'] },
      ],
    });
    vi.doUnmock('../src/sync/supabaseClient');
  });

  it('chunks a large request into multiple calls capped at 60 groups and concatenates results in order', async () => {
    const invoke = vi.fn(async (_name: string, options: { body: { groups: RealignGroupInput[] } }) => ({
      data: { groups: options.body.groups.map((g) => ({ pieceTranslations: [`EN:${g.originalJapanese}`] })) },
      error: null,
    }));
    vi.doMock('../src/sync/supabaseClient', () => ({
      getSupabase: () => ({ auth: { getSession: async () => authedSession }, functions: { invoke } }),
    }));
    vi.resetModules();
    const { realignTranslations: fn } = await import('../src/lib/sentenceRealign');

    // 162 groups mirrors the real 2026-09-13 podcast-mining incident this
    // fix addresses — the server's own MAX_GROUPS cap is 60.
    const groups = Array.from({ length: 162 }, (_, i) => group(i));
    const result = await fn(groups);

    expect(invoke).toHaveBeenCalledTimes(3); // 60 + 60 + 42
    expect(invoke.mock.calls[0]![1].body.groups).toHaveLength(60);
    expect(invoke.mock.calls[1]![1].body.groups).toHaveLength(60);
    expect(invoke.mock.calls[2]![1].body.groups).toHaveLength(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.groups).toHaveLength(162);
      expect(result.groups[0]).toEqual({ pieceTranslations: ['EN:J0'] });
      expect(result.groups[161]).toEqual({ pieceTranslations: ['EN:J161'] });
    }
    vi.doUnmock('../src/sync/supabaseClient');
  });

  it('refuses a response whose length does not match the request, instead of silently misaligning it', async () => {
    // Reproduces the 2026-09-13 bug shape: the server drops one group, so
    // the reply is one short. Applying it positionally would have shifted
    // every later row's translation onto the wrong sentence.
    const invoke = vi.fn(async () => ({
      data: { groups: [{ pieceTranslations: ['EN:J0'] }, { pieceTranslations: ['EN:J1'] }] },
      error: null,
    }));
    vi.doMock('../src/sync/supabaseClient', () => ({
      getSupabase: () => ({ auth: { getSession: async () => authedSession }, functions: { invoke } }),
    }));
    vi.resetModules();
    const { realignTranslations: fn } = await import('../src/lib/sentenceRealign');

    const result = await fn([group(0), group(1), group(2)]);

    expect(result).toEqual({
      ok: false,
      reason: 'Translation AI returned an unexpected response.',
    });
    vi.doUnmock('../src/sync/supabaseClient');
  });

  it('stops and reports the reason if a later batch fails, without dropping earlier successful results', async () => {
    let call = 0;
    const invoke = vi.fn(async (_name: string, options: { body: { groups: RealignGroupInput[] } }) => {
      call += 1;
      if (call === 2) return { data: null, error: { message: 'boom' } };
      return {
        data: { groups: options.body.groups.map((g) => ({ pieceTranslations: [`EN:${g.originalJapanese}`] })) },
        error: null,
      };
    });
    vi.doMock('../src/sync/supabaseClient', () => ({
      getSupabase: () => ({ auth: { getSession: async () => authedSession }, functions: { invoke } }),
    }));
    vi.resetModules();
    const { realignTranslations: fn } = await import('../src/lib/sentenceRealign');

    const groups = Array.from({ length: 120 }, (_, i) => group(i));
    const result = await fn(groups);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: false, reason: 'Translation AI is unavailable right now.' });
    vi.doUnmock('../src/sync/supabaseClient');
  });
});
