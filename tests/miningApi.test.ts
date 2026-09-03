import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyJobSegments,
  clipFromSource,
  clipMiningRange,
  commitMiningJob,
  createMiningJob,
  deleteMiningJob,
  fetchJobAudioRange,
  fetchJobWaveform,
  fetchMiningClipAudio,
  fetchSourceAudioRange,
  fetchSourceWaveform,
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

describe('fetchJobWaveform / fetchSourceWaveform', () => {
  it('parses the job waveform into {min,max} peaks and passes the rounded span', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ peaks: [[-0.5, 0.5], [-1, 1]], silenceMidsMs: [1200, 3400] }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const waveform = await fetchJobWaveform('job1', 1000.4, 2500.9);
    expect(waveform.peaks).toEqual([
      { min: -0.5, max: 0.5 },
      { min: -1, max: 1 },
    ]);
    expect(waveform.silenceMidsMs).toEqual([1200, 3400]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/jobs/job1/waveform?startMs=1000&endMs=2501'),
    );
  });

  it('posts the url + span for the source waveform', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ peaks: [], silenceMidsMs: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchSourceWaveform('https://youtu.be/VID', 1000.6, 4000.2);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      url: 'https://youtu.be/VID',
      startMs: 1001,
      endMs: 4000,
    });
  });

  it('throws with the server detail on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ detail: 'boom' }), { status: 502 })),
    );
    await expect(fetchJobWaveform('job1', 0, 1000)).rejects.toThrow('boom');
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

describe('commitMiningJob', () => {
  it('POSTs the rows once and decodes the inline audio', async () => {
    const clip = {
      sentenceId: 's-1',
      japanese: 'ねこ。',
      reading: null,
      english: 'Cat.',
      startMs: 0,
      endMs: 900,
      subtitleStartMs: 0,
      subtitleEndMs: 900,
      adjustedStartMs: 0,
      adjustedEndMs: 900,
      transcriptStatus: 'manually-corrected',
      tokens: null,
      audio: { mimeType: 'audio/mp4', durationMs: 800 },
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ sentences: [{ ...clip, audioBase64: btoa('clip-bytes') }] }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await commitMiningJob('job1', [
      { japanese: 'ねこ。', english: 'Cat.', startMs: 0, endMs: 900 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.clip.sentenceId).toBe('s-1');
    expect(await out[0]!.blob.text()).toBe('clip-bytes');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/jobs/job1/commit'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends rows in batches and reports running progress', async () => {
    const clip = {
      sentenceId: 's',
      japanese: 'ねこ。',
      reading: null,
      english: null,
      startMs: 0,
      endMs: 900,
      subtitleStartMs: 0,
      subtitleEndMs: 900,
      adjustedStartMs: 0,
      adjustedEndMs: 900,
      transcriptStatus: 'manually-corrected',
      tokens: null,
      audio: { mimeType: 'audio/mp4', durationMs: 800 },
    };
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { rows: unknown[] };
      return new Response(
        JSON.stringify({
          sentences: body.rows.map((_, i) => ({
            ...clip,
            sentenceId: `s-${i}`,
            audioBase64: btoa('x'),
          })),
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = Array.from({ length: 5 }, () => ({
      japanese: 'ねこ。',
      startMs: 0,
      endMs: 900,
    }));
    const progress: Array<[number, number]> = [];
    const out = await commitMiningJob('job1', rows, {
      chunkSize: 2,
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(out).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(progress).toEqual([
      [2, 5],
      [4, 5],
      [5, 5],
    ]);
  });
});

describe('fetchSourceAudioRange', () => {
  it('POSTs url + rounded span and returns a blob', async () => {
    const fetchMock = vi.fn(async () => new Response('span', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = await fetchSourceAudioRange('https://youtu.be/VID', 1000.6, 4000.2);
    expect(await blob.text()).toBe('span');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/source-audio/range');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      url: 'https://youtu.be/VID',
      startMs: 1001,
      endMs: 4000,
    });
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
