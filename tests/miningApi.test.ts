import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clipMiningCue,
  createMiningJob,
  deleteMiningJob,
  fetchMiningClipAudio,
  getMiningJob,
} from '../src/lib/miningApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createMiningJob', () => {
  it('returns the created job id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ jobId: 'abc123' }), { status: 200 })),
    );
    expect(await createMiningJob('https://www.youtube.com/watch?v=xyz')).toBe('abc123');
  });

  it('throws with the server detail message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: 'invalid url' }), { status: 422 }),
      ),
    );
    await expect(createMiningJob('not a url')).rejects.toThrow('invalid url');
  });
});

describe('getMiningJob', () => {
  const readyResponse = {
    jobId: 'abc123',
    status: 'ready',
    stage: 'Ready — 2 sentence(s) found.',
    source: {
      id: 'source-vid123',
      type: 'youtube',
      url: 'https://www.youtube.com/watch?v=vid123',
      videoId: 'vid123',
      title: 'Fixture Video',
      channel: 'Fixture Channel',
      durationMs: 60000,
    },
    cues: [
      { index: 0, startMs: 0, endMs: 1000, japanese: 'こんにちは。', isAuto: false, englishGuess: 'Hello.' },
    ],
  };

  it('parses a ready job status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(readyResponse), { status: 200 })),
    );
    const status = await getMiningJob('abc123');
    expect(status.status).toBe('ready');
    expect(status.cues?.[0]?.japanese).toBe('こんにちは。');
    expect(status.source?.title).toBe('Fixture Video');
  });

  it('throws on a malformed response shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ oops: true }), { status: 200 })),
    );
    await expect(getMiningJob('abc123')).rejects.toThrow();
  });

  it('throws with a generic message when there is no detail field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404, statusText: 'Not Found' })),
    );
    await expect(getMiningJob('missing')).rejects.toThrow('404');
  });
});

describe('clipMiningCue', () => {
  it('returns the parsed clip result', async () => {
    const body = {
      sentenceId: 'sentence-001-abc123',
      japanese: 'こんにちは。',
      reading: null,
      english: 'Hello.',
      startMs: 0,
      endMs: 1000,
      subtitleStartMs: 0,
      subtitleEndMs: 1000,
      adjustedStartMs: 0,
      adjustedEndMs: 1250,
      transcriptStatus: 'manually-corrected',
      tokens: null,
      audio: { mimeType: 'audio/mp4', durationMs: 1250 },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await clipMiningCue('job1', 0, {
      japanese: 'こんにちは。',
      english: 'Hello.',
      generateKana: true,
    });
    expect(result.sentenceId).toBe('sentence-001-abc123');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/jobs/job1/cues/0/clip'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('fetchMiningClipAudio', () => {
  it('returns the response as a blob', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('fake-audio', { status: 200 })),
    );
    const result = await fetchMiningClipAudio('job1', 'sentence-001-abc123');
    expect(await result.text()).toBe('fake-audio');
  });

  it('throws on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('gone', { status: 404, statusText: 'Not Found' })),
    );
    await expect(fetchMiningClipAudio('job1', 'missing')).rejects.toThrow();
  });
});

describe('deleteMiningJob', () => {
  it('never throws, even on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(deleteMiningJob('job1')).resolves.toBeUndefined();
  });
});
