import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_RECORDING_DURATION_MS } from '../src/lib/recording';
import { ShadowingController } from '../src/lib/shadowing';

class FakeMediaStreamTrack {
  stop = vi.fn();
}

class FakeMediaStream {
  private tracks = [new FakeMediaStreamTrack()];
  getTracks() {
    return this.tracks;
  }
}

type DataHandler = (event: { data: Blob }) => void;

class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }

  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: DataHandler | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public stream: FakeMediaStream) {}

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['chunk'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function stubMediaDevices(
  getUserMedia: () => Promise<FakeMediaStream> = async () => new FakeMediaStream(),
) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(getUserMedia) },
  });
}

class FakeAudioElement {
  listeners: Record<string, Array<() => void>> = {};
  currentTime = 0;
  playbackRate = 1;
  preservesPitch = false;
  play = vi.fn(async () => undefined);
  pause = vi.fn();

  addEventListener(type: string, handler: () => void) {
    (this.listeners[type] ??= []).push(handler);
  }

  removeEventListener(type: string, handler: () => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (existing) => existing !== handler,
    );
  }

  dispatch(type: string) {
    for (const handler of [...(this.listeners[type] ?? [])]) handler();
  }
}

describe('ShadowingController recording lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    stubMediaDevices();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('transitions idle -> requesting-mic -> recording -> stopped', async () => {
    const controller = new ShadowingController();
    expect(controller.getSnapshot().status).toBe('idle');

    const startPromise = controller.startRecording();
    expect(controller.getSnapshot().status).toBe('requesting-mic');
    await startPromise;
    expect(controller.getSnapshot().status).toBe('recording');

    const result = await controller.stopRecording();
    expect(controller.getSnapshot().status).toBe('stopped');
    expect(controller.getSnapshot().lastRecording).toEqual(result);
    expect(result?.blob.size).toBeGreaterThan(0);
  });

  it('surfaces an error when mic access is denied', async () => {
    stubMediaDevices(async () => {
      throw new Error('Permission denied');
    });
    const controller = new ShadowingController();
    await controller.startRecording();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'idle',
      error: 'Permission denied',
    });
  });

  it('cancelRecording resets to idle without producing a recording', async () => {
    const controller = new ShadowingController();
    await controller.startRecording();
    controller.cancelRecording();
    expect(controller.getSnapshot()).toMatchObject({
      status: 'idle',
      lastRecording: null,
      recordingElapsedMs: 0,
    });
  });

  it('ticks elapsed time and auto-stops at the max duration', async () => {
    vi.useFakeTimers();
    try {
      const controller = new ShadowingController();
      await controller.startRecording();
      expect(controller.getSnapshot().status).toBe('recording');

      await vi.advanceTimersByTimeAsync(MAX_RECORDING_DURATION_MS + 500);

      expect(controller.getSnapshot().status).toBe('stopped');
      expect(controller.getSnapshot().recordingElapsedMs).toBe(
        MAX_RECORDING_DURATION_MS,
      );
      expect(controller.getSnapshot().lastRecording?.blob.size).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ShadowingController comparison playback', () => {
  it('sets comparison state during alternate playback and clears it after', async () => {
    const controller = new ShadowingController();
    const reference = new FakeAudioElement();
    const learner = new FakeAudioElement();

    const done = controller.playAlternate(
      reference as unknown as HTMLAudioElement,
      learner as unknown as HTMLAudioElement,
      'attempt-1',
    );
    expect(controller.getSnapshot().comparison).toEqual({
      mode: 'alternate',
      attemptId: 'attempt-1',
    });

    reference.dispatch('ended');
    // playAlternate's default inter-clip gap is 250ms; wait past it so the
    // learner's `ended` listener is actually attached before we dispatch.
    await new Promise((resolve) => setTimeout(resolve, 300));
    learner.dispatch('ended');
    await done;

    expect(controller.getSnapshot().comparison).toBeNull();
  });

  it('passes a custom playbackRate through to both elements', async () => {
    const controller = new ShadowingController();
    const reference = new FakeAudioElement();
    const learner = new FakeAudioElement();

    const done = controller.playAlternate(
      reference as unknown as HTMLAudioElement,
      learner as unknown as HTMLAudioElement,
      'attempt-1',
      0.5,
    );
    expect(reference.playbackRate).toBe(0.5);
    expect(learner.playbackRate).toBe(0.5);

    reference.dispatch('ended');
    await new Promise((resolve) => setTimeout(resolve, 300));
    learner.dispatch('ended');
    await done;
  });

  it('stopComparison cancels an in-flight comparison', async () => {
    const controller = new ShadowingController();
    const reference = new FakeAudioElement();
    const learner = new FakeAudioElement();

    const done = controller.playAlternate(
      reference as unknown as HTMLAudioElement,
      learner as unknown as HTMLAudioElement,
      'attempt-1',
    );
    controller.stopComparison();
    await done;

    expect(controller.getSnapshot().comparison).toBeNull();
    expect(learner.play).not.toHaveBeenCalled();
  });
});
