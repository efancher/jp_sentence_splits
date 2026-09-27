import { describe, expect, it } from 'vitest';

import { buildThenAndNowClip, buildThenAndNowRound, describeThenAndNowClip } from '../src/lib/thenAndNow';

const NOW = new Date('2026-09-27T00:00:00Z');
const OLD = '2026-09-01T00:00:00Z'; // 26 days before NOW
const RECENT = '2026-09-25T00:00:00Z'; // 2 days before NOW

function baseInput(overrides: Partial<Parameters<typeof buildThenAndNowClip>[0]> = {}) {
  return {
    sentenceId: 's1',
    japanese: '彼は毎日勉強する。',
    translation: 'He studies every day.',
    thenAt: OLD,
    now: NOW,
    links: [{ vocabularyItemId: 'vi-1', expression: '勉強', createdAt: '2026-09-20T00:00:00Z' }],
    spanByVocabularyItemId: new Map([['vi-1', { startMs: 500, endMs: 900 }]]),
    ...overrides,
  };
}

describe('buildThenAndNowClip eligibility', () => {
  it('needs a translation', () => {
    expect(buildThenAndNowClip(baseInput({ translation: ' ' }))).toBeNull();
  });

  it('needs "then" to be far enough in the past', () => {
    expect(buildThenAndNowClip(baseInput({ thenAt: RECENT }))).toBeNull();
    expect(buildThenAndNowClip(baseInput({ thenAt: OLD }))).not.toBeNull();
  });

  it('needs at least one word confirmed after "then" with a resolvable span', () => {
    // confirmed before "then" — already known back then, nothing to demonstrate
    expect(
      buildThenAndNowClip(
        baseInput({ links: [{ vocabularyItemId: 'vi-1', expression: '勉強', createdAt: '2026-08-01T00:00:00Z' }] }),
      ),
    ).toBeNull();
    // confirmed after "then" but no span resolved — can't be ducked
    expect(
      buildThenAndNowClip(baseInput({ spanByVocabularyItemId: new Map() })),
    ).toBeNull();
  });

  it('sorts then-unknown words by start time and dedupes repeated links', () => {
    const clip = buildThenAndNowClip(
      baseInput({
        links: [
          { vocabularyItemId: 'vi-2', expression: '毎日', createdAt: '2026-09-21T00:00:00Z' },
          { vocabularyItemId: 'vi-1', expression: '勉強', createdAt: '2026-09-20T00:00:00Z' },
          { vocabularyItemId: 'vi-1', expression: '勉強', createdAt: '2026-09-20T00:00:00Z' },
        ],
        spanByVocabularyItemId: new Map([
          ['vi-1', { startMs: 500, endMs: 900 }],
          ['vi-2', { startMs: 0, endMs: 300 }],
        ]),
      }),
    )!;
    expect(clip.thenUnknownWords.map((w) => w.vocabularyItemId)).toEqual(['vi-2', 'vi-1']);
  });
});

describe('describeThenAndNowClip', () => {
  it('names the days since "then" and the then-unknown words', () => {
    const clip = buildThenAndNowClip(baseInput())!;
    const line = describeThenAndNowClip(clip, NOW);
    expect(line).toContain('26 days ago');
    expect(line).toContain('勉強');
    expect(line).toContain('this word');
  });

  it('pluralizes for more than one word', () => {
    const clip = buildThenAndNowClip(
      baseInput({
        links: [
          { vocabularyItemId: 'vi-1', expression: '勉強', createdAt: '2026-09-20T00:00:00Z' },
          { vocabularyItemId: 'vi-2', expression: '毎日', createdAt: '2026-09-21T00:00:00Z' },
        ],
        spanByVocabularyItemId: new Map([
          ['vi-1', { startMs: 500, endMs: 900 }],
          ['vi-2', { startMs: 0, endMs: 300 }],
        ]),
      }),
    )!;
    expect(describeThenAndNowClip(clip, NOW)).toContain('these 2 words');
  });
});

describe('buildThenAndNowRound', () => {
  it('caps at `size`, preserving order', () => {
    const clip = buildThenAndNowClip(baseInput())!;
    const other = buildThenAndNowClip(baseInput({ sentenceId: 's2' }))!;
    expect(buildThenAndNowRound([clip, other], 1)).toEqual([clip]);
    expect(buildThenAndNowRound([clip, other])).toEqual([clip, other]);
  });
});
