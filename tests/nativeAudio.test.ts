import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SentenceAudio } from '../src/domain/types';
import { NativeAudioController } from '../src/lib/nativeAudio';

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

  it('shows a user-safe error when playback fails', async () => {
    class RejectingAudio extends MockAudio {
      override play = vi.fn(async () => {
        throw new Error('codec details');
      });
    }
    vi.stubGlobal('Audio', RejectingAudio);
    const controller = new NativeAudioController();
    await controller.play(audioRecord('audio-1'));
    expect(controller.getSnapshot()).toMatchObject({
      isPlaying: false,
      activeItemId: null,
      error: 'Unable to play this sentence recording on this device.',
    });
  });
});
