import { afterEach, describe, expect, it, vi } from 'vitest';

import { alignAudio, transcribeAudio } from '../src/lib/analysisApi';

const blob = new Blob(['audio'], { type: 'audio/webm' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('alignAudio', () => {
  it('returns the parsed result on success', async () => {
    const result = {
      durationSeconds: 1.7,
      words: [{ start: 0.5, end: 0.84, text: 'ちょっと', phones: [] }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(result), { status: 200 })),
    );

    expect(await alignAudio(blob, '今日はちょっと寒いですね')).toEqual(result);
  });

  it('returns null on a non-200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('service unavailable', { status: 503 })),
    );

    expect(await alignAudio(blob, '今日は')).toBeNull();
  });

  it('returns null on a network error, without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(alignAudio(blob, '今日は')).resolves.toBeNull();
  });

  it('returns null on malformed JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 200 })),
    );

    expect(await alignAudio(blob, '今日は')).toBeNull();
  });

  it('returns null when the response shape is unexpected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ oops: true }), { status: 200 })),
    );

    expect(await alignAudio(blob, '今日は')).toBeNull();
  });

  it('returns null when the request is aborted (timeout)', async () => {
    // Simulates what fetch does once AbortController.abort() fires,
    // without needing to fake the real 60s timer.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }),
    );

    await expect(alignAudio(blob, '今日は')).resolves.toBeNull();
  });
});

describe('transcribeAudio', () => {
  it('returns the recognized text on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ text: '今日はちょっと寒いですね' }), { status: 200 })),
    );

    expect(await transcribeAudio(blob, '今日はちょっと寒いですね')).toBe('今日はちょっと寒いですね');
  });

  it('works without a prompt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ text: 'hello' }), { status: 200 })),
    );

    expect(await transcribeAudio(blob)).toBe('hello');
  });

  it('returns null on a non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));

    expect(await transcribeAudio(blob)).toBeNull();
  });

  it('returns null on a network error, without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(transcribeAudio(blob)).resolves.toBeNull();
  });

  it('returns null when the response shape is unexpected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ oops: true }), { status: 200 })),
    );

    expect(await transcribeAudio(blob)).toBeNull();
  });

  it('returns null when the request is aborted (timeout)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }),
    );

    await expect(transcribeAudio(blob)).resolves.toBeNull();
  });
});
