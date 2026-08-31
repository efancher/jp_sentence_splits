import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyJobSegments,
  clipFromSource,
  clipMiningCue,
  clipMiningRange,
  createMiningJob,
  deleteMiningJob,
  fetchJobAudioRange,
  fetchMiningClipAudio,
  getMiningJob,
  translateJob,
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
    stage: 'ready',
    message: 'Ready — 2 sentence(s) found.',
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

describe('clipFromSource', () => {
  it('POSTs the cuts and decodes the base64 clips', async () => {
    const b64 = btoa('cut-bytes');
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            clips: [{ audioBase64: b64, mimeType: 'audio/mp4', durationMs: 1500 }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const [clip] = await clipFromSource('https://youtu.be/VID12345678', [
      { startMs: 1000, endMs: 2500 },
    ]);
    expect(clip!.durationMs).toBe(1500);
    expect(await clip!.blob.text()).toBe('cut-bytes');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/source-audio/clip'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws with the server detail on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ detail: 'not cached' }), { status: 502 })),
    );
    await expect(
      clipFromSource('https://youtu.be/VID12345678', [{ startMs: 0, endMs: 1 }]),
    ).rejects.toThrow('not cached');
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

describe('fetchJobAudioRange', () => {
  it('requests the rounded span and returns a blob', async () => {
    const fetchMock = vi.fn(async () => new Response('span-audio', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const blob = await fetchJobAudioRange('job1', 1000.4, 2500.9);
    expect(await blob.text()).toBe('span-audio');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/jobs/job1/audio?startMs=1000&endMs=2501'),
    );
  });

  it('throws with the server detail on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ detail: 'endMs must be greater than startMs' }), { status: 409 })),
    );
    await expect(fetchJobAudioRange('job1', 5000, 4000)).rejects.toThrow(
      'endMs must be greater than startMs',
    );
  });
});

describe('applyJobSegments / translateJob', () => {
  const jobStatus = {
    jobId: 'job1',
    status: 'ready',
    stage: 'segment',
    message: '',
    cues: [
      { index: 0, startMs: 0, endMs: 1000, japanese: 'ねこ。', isAuto: false, sourceIndexes: [0] },
    ],
  };

  it('POSTs the segments and parses the job status back', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(jobStatus), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await applyJobSegments('job1', [{ text: 'ねこ。', startMs: 0, endMs: 1000 }], {
      merge: false,
      split: false,
    });
    expect(out.cues?.[0]?.sourceIndexes).toEqual([0]);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      merge: false,
      split: false,
    });
  });

  it('translateJob POSTs to the translate route', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ...jobStatus, stage: 'translate', rows: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await translateJob('job1');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/jobs/job1/translate'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('clipMiningRange', () => {
  it('POSTs text + span to the cue-less clip route', async () => {
    const body = {
      sentenceId: 's-1',
      japanese: 'ねこ。',
      reading: null,
      english: 'Cat.',
      startMs: 100,
      endMs: 900,
      subtitleStartMs: 100,
      subtitleEndMs: 900,
      adjustedStartMs: 100,
      adjustedEndMs: 900,
      transcriptStatus: 'manually-corrected',
      tokens: null,
      audio: { mimeType: 'audio/mp4', durationMs: 800 },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await clipMiningRange('job1', {
      japanese: 'ねこ。',
      english: 'Cat.',
      startMs: 100,
      endMs: 900,
    });
    expect(result.sentenceId).toBe('s-1');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/jobs/job1/clip'),
      expect.objectContaining({ method: 'POST' }),
    );
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
