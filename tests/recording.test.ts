import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PlaybackCoordinator,
  RecordingService,
  micConstraintsForRecording,
  playDualEar,
} from '../src/lib/recording';

class FakeMediaStreamTrack {
  readyState: 'live' | 'ended' = 'live';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
}

class FakeMediaStream {
  private tracks = [new FakeMediaStreamTrack()];
  getTracks() {
    return this.tracks;
  }
}

type DataHandler = (event: { data: Blob }) => void;

class FakeMediaRecorder {
  static supportedType = 'audio/webm;codecs=opus';
  static isTypeSupported(type: string) {
    return type === FakeMediaRecorder.supportedType;
  }

  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: DataHandler | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  /** When false, stop() never delivers a data chunk (simulates a silent take). */
  emitsData = true;

  constructor(
    public stream: FakeMediaStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? '';
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    if (this.emitsData) {
      this.ondataavailable?.({
        data: new Blob(['chunk'], { type: this.mimeType || 'audio/webm' }),
      });
    }
    this.onstop?.();
  }
}

function stubMediaDevices(stream: FakeMediaStream) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });
}

describe('micConstraintsForRecording', () => {
  it('uses stricter constraints by default and softer ones for shadow mode', () => {
    expect(micConstraintsForRecording('default')).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
    });
    expect(micConstraintsForRecording('shadow')).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
    });
  });
});

describe('RecordingService.supportedMimeType', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('selects the first supported recording MIME type', () => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    expect(RecordingService.supportedMimeType()).toBe('audio/webm;codecs=opus');
  });
});

describe('RecordingService', () => {
  let stream: FakeMediaStream;

  beforeEach(() => {
    stream = new FakeMediaStream();
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    stubMediaDevices(stream);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('records and stops, returning the captured blob', async () => {
    const service = new RecordingService();
    await service.start();
    expect(service.getStream()).toBe(stream);

    const { blob, durationMs } = await service.stop();
    expect(blob.size).toBeGreaterThan(0);
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(stream.getTracks()[0]?.stop).toHaveBeenCalledOnce();
    expect(service.getStream()).toBeUndefined();
  });

  it('rejects stop() when nothing is recording', async () => {
    const service = new RecordingService();
    await expect(service.stop()).rejects.toThrow('No recording is in progress.');
  });

  it('rejects stop() when no audio was captured', async () => {
    class SilentMediaRecorder extends FakeMediaRecorder {
      override emitsData = false;
    }
    vi.stubGlobal('MediaRecorder', SilentMediaRecorder);
    const service = new RecordingService();
    await service.start();
    await expect(service.stop()).rejects.toThrow('No audio was captured.');
  });

  it('cancel() stops tracks and clears state without requiring stop()', async () => {
    const service = new RecordingService();
    await service.start();
    service.cancel();
    expect(stream.getTracks()[0]?.stop).toHaveBeenCalledOnce();
    expect(service.getStream()).toBeUndefined();
  });

  it('reuseStream: keeps the mic across stop(), skips getUserMedia next start()', async () => {
    const getUserMedia = (navigator.mediaDevices as unknown as { getUserMedia: ReturnType<typeof vi.fn> })
      .getUserMedia;
    const service = new RecordingService();

    await service.start({ micMode: 'shadow', reuseStream: true });
    await service.stop();
    expect(stream.getTracks()[0]?.stop).not.toHaveBeenCalled();
    expect(service.getStream()).toBe(stream);

    await service.start({ micMode: 'shadow', reuseStream: true });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await service.stop();

    service.releaseStream();
    expect(stream.getTracks()[0]?.stop).toHaveBeenCalledOnce();
    expect(service.getStream()).toBeUndefined();
  });

  it('reuseStream: re-acquires if the mic mode changes', async () => {
    const getUserMedia = (navigator.mediaDevices as unknown as { getUserMedia: ReturnType<typeof vi.fn> })
      .getUserMedia;
    const service = new RecordingService();
    await service.start({ micMode: 'shadow', reuseStream: true });
    await service.stop();
    await service.start({ micMode: 'default', reuseStream: true });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    service.releaseStream();
  });
});

class FakeAudioElement {
  listeners: Record<string, Array<() => void>> = {};
  currentTime = 0;
  preload = '';
  playbackRate = 1;
  preservesPitch = true;
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  removeAttribute = vi.fn();

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

describe('PlaybackCoordinator.alternate', () => {
  it('plays reference then learner after the gap, then resolves', async () => {
    const coordinator = new PlaybackCoordinator();
    const reference = new FakeAudioElement();
    const learner = new FakeAudioElement();

    const done = coordinator.alternate(
      reference as unknown as HTMLAudioElement,
      learner as unknown as HTMLAudioElement,
      0,
    );
    expect(reference.play).toHaveBeenCalledOnce();
    reference.dispatch('ended');

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(learner.play).toHaveBeenCalledOnce();
    learner.dispatch('ended');

    await done;
  });

  it('cancel() aborts mid-sequence before the learner plays', async () => {
    const coordinator = new PlaybackCoordinator();
    const reference = new FakeAudioElement();
    const learner = new FakeAudioElement();

    const done = coordinator.alternate(
      reference as unknown as HTMLAudioElement,
      learner as unknown as HTMLAudioElement,
      1_000,
    );
    coordinator.cancel();
    await done;

    expect(reference.pause).toHaveBeenCalledOnce();
    expect(learner.play).not.toHaveBeenCalled();
  });

  it('applies playbackRate and preservesPitch to both elements before playing', async () => {
    const coordinator = new PlaybackCoordinator();
    const reference = new FakeAudioElement();
    const learner = new FakeAudioElement();

    const done = coordinator.alternate(
      reference as unknown as HTMLAudioElement,
      learner as unknown as HTMLAudioElement,
      0,
      0.75,
    );
    expect(reference.playbackRate).toBe(0.75);
    expect(reference.preservesPitch).toBe(true);
    expect(learner.playbackRate).toBe(0.75);
    expect(learner.preservesPitch).toBe(true);

    reference.dispatch('ended');
    await new Promise((resolve) => setTimeout(resolve, 20));
    learner.dispatch('ended');
    await done;
  });

  it('scopes only the reference side to a range, learner still plays in full', async () => {
    const coordinator = new PlaybackCoordinator();
    const reference = new FakeAudioElement();
    const learner = new FakeAudioElement();

    const done = coordinator.alternate(
      reference as unknown as HTMLAudioElement,
      learner as unknown as HTMLAudioElement,
      0,
      1,
      { startMs: 500, endMs: 1500 },
    );
    expect(reference.currentTime).toBe(0.5);

    reference.currentTime = 1.5;
    reference.dispatch('timeupdate');
    expect(reference.pause).toHaveBeenCalledOnce();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(learner.play).toHaveBeenCalledOnce();
    expect(learner.currentTime).toBe(0);
    learner.dispatch('ended');
    await done;
  });
});

describe('PlaybackCoordinator.loopRange', () => {
  it('seeks to the start and jumps back whenever playback crosses the end', async () => {
    const coordinator = new PlaybackCoordinator();
    const audio = new FakeAudioElement();

    const done = coordinator.loopRange(audio as unknown as HTMLAudioElement, {
      startMs: 1000,
      endMs: 2000,
    });
    expect(audio.currentTime).toBe(1);
    expect(audio.play).toHaveBeenCalledOnce();

    audio.currentTime = 2.1;
    audio.dispatch('timeupdate');
    expect(audio.currentTime).toBe(1);

    coordinator.cancel();
    await done;
    expect(audio.pause).toHaveBeenCalledOnce();
  });

  it('applies playbackRate and preservesPitch', async () => {
    const coordinator = new PlaybackCoordinator();
    const audio = new FakeAudioElement();

    const done = coordinator.loopRange(
      audio as unknown as HTMLAudioElement,
      { startMs: 0, endMs: 1000 },
      0.5,
    );
    expect(audio.playbackRate).toBe(0.5);
    expect(audio.preservesPitch).toBe(true);

    coordinator.cancel();
    await done;
  });

  it('resolves without throwing if play() rejects (e.g. unsupported source)', async () => {
    const coordinator = new PlaybackCoordinator();
    const audio = new FakeAudioElement();
    audio.play = vi.fn(async () => {
      throw new Error('NotSupportedError');
    });

    await expect(
      coordinator.loopRange(audio as unknown as HTMLAudioElement, {
        startMs: 0,
        endMs: 1000,
      }),
    ).resolves.toBeUndefined();
  });

  it('cancelling one loop does not affect a fresh one on the same coordinator', async () => {
    const coordinator = new PlaybackCoordinator();
    const first = new FakeAudioElement();
    const second = new FakeAudioElement();

    const firstDone = coordinator.loopRange(first as unknown as HTMLAudioElement, {
      startMs: 0,
      endMs: 1000,
    });
    const secondDone = coordinator.loopRange(second as unknown as HTMLAudioElement, {
      startMs: 0,
      endMs: 1000,
    });
    await firstDone; // superseded by the second loopRange's implicit cancel()
    expect(first.pause).toHaveBeenCalledOnce();
    expect(second.pause).not.toHaveBeenCalled();

    coordinator.cancel();
    await secondDone;
    expect(second.pause).toHaveBeenCalledOnce();
  });
});

function chainableNode() {
  const node: { connect: (target?: unknown) => unknown } = {
    connect: vi.fn((target?: unknown) => target ?? node),
  };
  return node;
}

class FakeAudioContext {
  state: 'running' | 'suspended' = 'running';
  destination = {};
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  createMediaElementSource = vi.fn(() => chainableNode());
  createStereoPanner = vi.fn(() => ({ pan: { value: 0 }, ...chainableNode() }));
}

class DualEarFakeAudio extends FakeAudioElement {
  static instances: DualEarFakeAudio[] = [];
  src: string;

  constructor(src: string) {
    super();
    this.src = src;
    DualEarFakeAudio.instances.push(this);
  }

  load = vi.fn(() => this.dispatch('canplaythrough'));
}

describe('PlaybackCoordinator.dualEar / playDualEar', () => {
  beforeEach(() => {
    DualEarFakeAudio.instances = [];
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('Audio', DualEarFakeAudio);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => `blob:${blob.size}`),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('resolves immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const blob = new Blob(['x'], { type: 'audio/webm' });
    await expect(
      playDualEar(blob, blob, {}, controller.signal),
    ).resolves.toBeUndefined();
  });

  it('pans reference/learner hard left/right and resolves once both end', async () => {
    const coordinator = new PlaybackCoordinator();
    const reference = new Blob(['ref'], { type: 'audio/webm' });
    const learner = new Blob(['learner'], { type: 'audio/webm' });

    const done = coordinator.dualEar(reference, learner);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(DualEarFakeAudio.instances).toHaveLength(2);
    const [referenceAudio, learnerAudio] = DualEarFakeAudio.instances;
    expect(referenceAudio?.play).toHaveBeenCalledOnce();
    expect(learnerAudio?.play).toHaveBeenCalledOnce();

    referenceAudio?.dispatch('ended');
    learnerAudio?.dispatch('ended');

    await done;
  });

  it('trims only the reference side when referenceRange is given', async () => {
    const coordinator = new PlaybackCoordinator();
    const reference = new Blob(['ref'], { type: 'audio/webm' });
    const learner = new Blob(['learner'], { type: 'audio/webm' });

    const done = coordinator.dualEar(reference, learner, {
      referenceRange: { startMs: 500, endMs: 1500 },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const [referenceAudio, learnerAudio] = DualEarFakeAudio.instances;
    expect(referenceAudio?.currentTime).toBe(0.5);
    expect(learnerAudio?.currentTime).toBe(0);

    referenceAudio!.currentTime = 1.5;
    referenceAudio!.dispatch('timeupdate');
    expect(referenceAudio?.pause).toHaveBeenCalledOnce();

    learnerAudio?.dispatch('ended');
    await done;
  });
});

describe('ShadowReferencePlayer loop mode', () => {
  class ShadowFakeAudio extends FakeAudioElement {
    static instances: ShadowFakeAudio[] = [];
    readyState = 2;
    loop = false;
    constructor() {
      super();
      ShadowFakeAudio.instances.push(this);
    }
    load = vi.fn(() => this.dispatch('canplaythrough'));
  }
  class ShadowFakeContext extends FakeAudioContext {
    static instances: ShadowFakeContext[] = [];
    createMediaStreamSource = vi.fn(() => chainableNode());
    createAnalyser = vi.fn(() => ({ fftSize: 0, ...chainableNode() }));
    constructor() {
      super();
      ShadowFakeContext.instances.push(this);
    }
  }

  beforeEach(() => {
    ShadowFakeAudio.instances = [];
    ShadowFakeContext.instances = [];
    vi.stubGlobal('AudioContext', ShadowFakeContext);
    vi.stubGlobal('Audio', ShadowFakeAudio);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn((blob: Blob) => `blob:${blob.size}`),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loop mode: plain <audio loop> playback, no AudioContext at all', async () => {
    const { ShadowReferencePlayer } = await import('../src/lib/recording');
    const player = new ShadowReferencePlayer();
    const stream = new FakeMediaStream() as unknown as MediaStream;

    await player.start(stream, new Blob(['ref']), 1, { loop: true });
    const audio = ShadowFakeAudio.instances[0]!;
    expect(audio.loop).toBe(true);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(ShadowFakeContext.instances).toHaveLength(0); // no Web Audio

    player.stop(); // end of a rep — element keeps looping
    expect(audio.pause).toHaveBeenCalledOnce();

    player.teardown();
    expect(audio.loop).toBe(false);
  });

  it('non-loop start builds a graph and closes the previous context on restart', async () => {
    const { ShadowReferencePlayer } = await import('../src/lib/recording');
    const player = new ShadowReferencePlayer();
    const stream = new FakeMediaStream() as unknown as MediaStream;

    await player.start(stream, new Blob(['a']), 1);
    await player.start(stream, new Blob(['b']), 1);

    expect(ShadowFakeContext.instances).toHaveLength(2);
    expect(ShadowFakeContext.instances[0]!.close).toHaveBeenCalledOnce();
  });
});
