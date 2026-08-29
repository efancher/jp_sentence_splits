import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SentenceAudio } from '../src/domain/types';
import { NativeAudioController } from '../src/lib/nativeAudio';

const repairSentenceAudio = vi.fn(async (_audioId: string): Promise<Blob | null> => null);
vi.mock('../src/sync/audioSync', () => ({
  repairSentenceAudio: (audioId: string) => repairSentenceAudio(audioId),
}));

class MockAudio {
  static instances: MockAudio[] = [];
  src: string;
  currentTime = 0;
  playbackRate = 1;
  preservesPitch = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  removeAttribute = vi.fn();
  load = vi.fn();

  constructor(src: string) {
    this.src = src;
    MockAudio.instances.push(this);
  }
}

function audioRecord(id: string): SentenceAudio {
  return {
    id,
    sentenceId: 'sentence-1',
    sourceId: 'source-1',
    sourceSentenceId: `source-${id}`,
    sourceTitle: 'Video',
    mimeType: 'audio/mp4',
    durationMs: 1_000,
    startMs: 0,
    endMs: 1_000,
    blob: new Blob(['audio'], { type: 'audio/mp4' }),
    importedAt: '2026-07-19T00:00:00.000Z',
  };
}

describe('NativeAudioController', () => {
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    MockAudio.instances = [];
    vi.stubGlobal('Audio', MockAudio);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => `blob:${blob.size}`),
      revokeObjectURL,
    });
    revokeObjectURL.mockClear();
    repairSentenceAudio.mockReset();
    repairSentenceAudio.mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('plays a clip and clears state when it ends', async () => {
    const controller = new NativeAudioController();
    await controller.play(audioRecord('audio-1'));
    expect(controller.getSnapshot()).toMatchObject({
      isPlaying: true,
      activeItemId: 'audio-1',
    });
    expect(MockAudio.instances[0]?.play).toHaveBeenCalledOnce();

    MockAudio.instances[0]?.onended?.();
    expect(controller.getSnapshot()).toMatchObject({
      isPlaying: false,
      activeItemId: null,
    });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:5');
  });

  it('applies a custom playback rate with pitch preserved', async () => {
    const controller = new NativeAudioController();
    await controller.play(audioRecord('audio-1'), 0.75);
    expect(MockAudio.instances[0]).toMatchObject({
      playbackRate: 0.75,
      preservesPitch: true,
    });
  });

  it('defaults to normal playback rate when none is given', async () => {
    const controller = new NativeAudioController();
    await controller.play(audioRecord('audio-1'));
    expect(MockAudio.instances[0]).toMatchObject({
      playbackRate: 1,
      preservesPitch: true,
    });
  });

  it('stops the current clip before starting another', async () => {
    const controller = new NativeAudioController();
    await controller.play(audioRecord('audio-1'));
    const first = MockAudio.instances[0]!;
    await controller.play(audioRecord('audio-2'));
    expect(first.pause).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().activeItemId).toBe('audio-2');
  });

  it('prevents stale events from clearing newer playback', async () => {
    const controller = new NativeAudioController();
    await controller.play(audioRecord('audio-1'));
    const first = MockAudio.instances[0]!;
    await controller.play(audioRecord('audio-2'));
    first.onended?.();
    expect(controller.getSnapshot()).toMatchObject({
      isPlaying: true,
      activeItemId: 'audio-2',
    });
  });

  it('shows a user-safe error when playback fails and no cloud copy repairs it', async () => {
    class RejectingAudio extends MockAudio {
      override play = vi.fn(async () => {
        throw new Error('codec details');
      });
    }
    vi.stubGlobal('Audio', RejectingAudio);
    const controller = new NativeAudioController();
    await controller.play(audioRecord('audio-1'));
    expect(repairSentenceAudio).toHaveBeenCalledWith('audio-1');
    expect(controller.getSnapshot()).toMatchObject({
      isPlaying: false,
      activeItemId: null,
      error: 'Unable to play this sentence recording on this device.',
    });
  });

  it('fetches the blob before first play for a metadata-only row (synced from another device)', async () => {
    const freshBlob = new Blob(['downloaded-audio'], { type: 'audio/mp4' });
    repairSentenceAudio.mockResolvedValue(freshBlob);

    const controller = new NativeAudioController();
    const metadataOnly = { ...audioRecord('audio-1'), blob: new Blob([], { type: 'audio/mp4' }) };
    await controller.play(metadataOnly);

    expect(repairSentenceAudio).toHaveBeenCalledWith('audio-1');
    // Played the downloaded blob, not the empty placeholder — one Audio, no
    // error-retry.
    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0]?.src).toBe(`blob:${freshBlob.size}`);
    expect(controller.getSnapshot()).toMatchObject({ isPlaying: true, error: null });
  });

  it('recovers by refetching from the cloud when the local blob is corrupt (Safari WebKitBlobResource)', async () => {
    let failNext = true;
    class FlakyAudio extends MockAudio {
      override play = vi.fn(async () => {
        if (failNext) throw new Error('WebKitBlobResource error 1');
      });
    }
    vi.stubGlobal('Audio', FlakyAudio);
    const freshBlob = new Blob(['fresh'], { type: 'audio/mp4' });
    repairSentenceAudio.mockImplementation(async () => {
      failNext = false;
      return freshBlob;
    });

    const controller = new NativeAudioController();
    await controller.play(audioRecord('audio-1'));

    expect(repairSentenceAudio).toHaveBeenCalledOnce();
    expect(MockAudio.instances).toHaveLength(2);
    expect(MockAudio.instances[1]?.src).toBe('blob:5');
    expect(controller.getSnapshot()).toMatchObject({
      isPlaying: true,
      activeItemId: 'audio-1',
      error: null,
    });
  });
});
