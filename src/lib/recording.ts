/**
 * Ported from ~/projects/shadowing/web/src/services/recording.ts
 * (docs/UNIFIED_APP_ARCHITECTURE.md §12, Phase 3 — shadowing core loop;
 * calibrateMicrophone/playReferenceForShadowing/ShadowReferencePlayer/
 * stopShadowReference added in Phase 8.3). The unused
 * PlaybackCoordinator.playSequence is still not ported — nothing in this
 * app needs an arbitrary N-clip sequence.
 */

const RECORDING_MIME_TYPES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
] as const;

export const MAX_RECORDING_DURATION_MS = 30_000;

/** Ported from shadowing/web's services/shared.ts (Phase 8.1). */
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25] as const;

export type RecordingMicMode = 'default' | 'shadow';

/** Mic constraints for normal vs play-while-record (AirPods-friendly) modes. */
export function micConstraintsForRecording(
  mode: RecordingMicMode,
): MediaTrackConstraints {
  if (mode === 'shadow') {
    return { echoCancellation: false, noiseSuppression: false };
  }
  return { echoCancellation: true, noiseSuppression: true };
}

export class RecordingService {
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private streamMicMode?: RecordingMicMode;
  /** True while the current stream should outlive a stop() (loop reps). */
  private holdStream = false;
  private chunks: Blob[] = [];
  private startedAtMs = 0;

  static supportedMimeType(): string | undefined {
    if (!('MediaRecorder' in window)) return undefined;
    return RECORDING_MIME_TYPES.find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    );
  }

  private streamIsLive(): boolean {
    return (
      Boolean(this.stream) &&
      this.stream!.getTracks().some((track) => track.readyState === 'live')
    );
  }

  /**
   * `reuseStream: true` keeps the mic open across a stop() so the next
   * start() can skip getUserMedia — for back-to-back loop reps, where
   * re-acquiring the mic every rep both adds latency and (on some
   * browsers) transiently fails with NotAllowedError. Call releaseStream()
   * when the loop ends.
   */
  async start(options?: {
    micMode?: RecordingMicMode;
    reuseStream?: boolean;
  }): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone recording is not supported in this browser.');
    }
    const micMode = options?.micMode ?? 'default';
    this.holdStream = Boolean(options?.reuseStream);
    if (!(this.holdStream && this.streamIsLive() && this.streamMicMode === micMode)) {
      this.stopStream();
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: micConstraintsForRecording(micMode),
        });
      } catch (error) {
        throw new Error(
          `Microphone access failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      this.streamMicMode = micMode;
    }
    this.makeRecorder();
  }

  private makeRecorder(): void {
    const mimeType = RecordingService.supportedMimeType();
    this.recorder = mimeType
      ? new MediaRecorder(this.stream!, { mimeType })
      : new MediaRecorder(this.stream!);
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    this.startedAtMs = Date.now();
    this.recorder.start();
  }

  /**
   * Close the current recording and immediately open a fresh one on the
   * same held-open mic stream — for a hands-free loop that wants a
   * separate take per rep without a `getUserMedia` (or any user gesture)
   * in between. Requires a stream kept alive by `reuseStream: true`.
   */
  async cycleRecorder(): Promise<{ blob: Blob; durationMs: number }> {
    if (!this.streamIsLive()) throw new Error('No live mic stream to cycle.');
    this.holdStream = true;
    const take = await this.stop();
    this.makeRecorder();
    return take;
  }

  /**
   * Active mic stream while recording; also kept between reps when the last
   * start() passed `reuseStream`. Otherwise undefined after stop/cancel.
   */
  getStream(): MediaStream | undefined {
    return this.stream;
  }

  /** Close a stream kept alive by `reuseStream: true`. Safe to call anytime. */
  releaseStream(): void {
    this.holdStream = false;
    this.stopStream();
  }

  async stop(): Promise<{ blob: Blob; durationMs: number }> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      throw new Error('No recording is in progress.');
    }
    const mimeType =
      recorder.mimeType || RecordingService.supportedMimeType() || 'audio/mp4';
    return new Promise((resolve, reject) => {
      recorder.onerror = () => {
        this.cleanup();
        reject(new Error('Recording failed.'));
      };
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: mimeType });
        const durationMs = Date.now() - this.startedAtMs;
        this.cleanup();
        if (!blob.size) reject(new Error('No audio was captured.'));
        else resolve({ blob, durationMs });
      };
      recorder.stop();
    });
  }

  cancel(): void {
    if (this.recorder?.state !== 'inactive') this.recorder?.stop();
    this.holdStream = false;
    this.cleanup();
  }

  private cleanup(): void {
    this.recorder = undefined;
    this.chunks = [];
    if (!this.holdStream) this.stopStream();
  }

  private stopStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.streamMicMode = undefined;
  }
}

/**
 * Let the audio session settle after mic open before starting reference
 * playback. Opening a second AudioContext for the live waveform used to
 * interrupt this opener.
 */
export const SHADOW_AUDIO_SETTLE_MS = 200;

export interface CalibrationResult {
  ambientRms: number;
  speechRms: number;
  peak: number;
  clipping: boolean;
  guidance: string[];
}

export async function calibrateMicrophone(durationMs = 2500): Promise<CalibrationResult> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  const samples: number[] = [];
  const started = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      let peak = 0;
      for (const sample of data) {
        sum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      samples.push(Math.sqrt(sum / data.length), peak);
      if (performance.now() - started >= durationMs) resolve();
      else requestAnimationFrame(tick);
    };
    tick();
  });
  stream.getTracks().forEach((track) => track.stop());
  await context.close().catch(() => undefined);
  const rmsValues = samples.filter((_, index) => index % 2 === 0);
  const peaks = samples.filter((_, index) => index % 2 === 1);
  const ambientRms =
    rmsValues.slice(0, Math.ceil(rmsValues.length / 3)).reduce((a, b) => a + b, 0) /
    Math.max(1, Math.ceil(rmsValues.length / 3));
  const speechRms =
    rmsValues.slice(Math.ceil(rmsValues.length / 3)).reduce((a, b) => a + b, 0) /
    Math.max(1, rmsValues.length - Math.ceil(rmsValues.length / 3));
  const peak = Math.max(...peaks, 0);
  const clipping = peak > 0.98;
  const guidance: string[] = [];
  if (speechRms < 0.02) guidance.push('Move closer to the microphone.');
  if (clipping) {
    guidance.push('The recording is clipping. Move farther away or lower input volume.');
  }
  if (ambientRms > 0.03) guidance.push('Background noise may interfere with pitch detection.');
  if (guidance.length === 0) guidance.push('Microphone levels look usable.');
  return { ambientRms, speechRms, peak, clipping, guidance };
}

/** Start an HTMLAudioElement from the beginning at the given rate (shadow play-along). */
export async function playReferenceForShadowing(
  audio: HTMLAudioElement,
  playbackRate = 1,
): Promise<void> {
  audio.pause();
  audio.playbackRate = playbackRate;
  audio.preservesPitch = true;
  if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Reference audio failed to load.'));
      };
      const cleanup = () => {
        audio.removeEventListener('loadedmetadata', onLoaded);
        audio.removeEventListener('error', onError);
      };
      audio.addEventListener('loadedmetadata', onLoaded, { once: true });
      audio.addEventListener('error', onError, { once: true });
    });
  }
  audio.currentTime = 0;
  if (audio.currentTime > 0.02) {
    await new Promise<void>((resolve) => {
      const onSeeked = () => {
        window.clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(() => {
        audio.removeEventListener('seeked', onSeeked);
        resolve();
      }, 250);
      audio.addEventListener('seeked', onSeeked, { once: true });
      audio.currentTime = 0;
    });
  }
  await audio.play();
}

/**
 * Play-along reference while recording: one AudioContext for mic analysis +
 * reference playback so a second context cannot chop the sentence opener.
 *
 * `loop` mode (the hands-free shadow-rep loop, iOS-safe): the reference
 * `<audio>` element is set `loop = true` and started once, so it replays
 * itself with no further `play()` calls, and `stop()` only pauses instead
 * of closing the graph — `teardown()` does the real cleanup. iOS Safari
 * gates `getUserMedia`, `AudioContext.resume()` and `HTMLMediaElement.
 * play()` on a user gesture, so anything the loop does after the starting
 * tap (from a timer) has to reuse the already-unlocked graph.
 */
export class ShadowReferencePlayer {
  private audio?: HTMLAudioElement;
  private objectUrl?: string;
  private context?: AudioContext;
  private analyser?: AnalyserNode;
  private micSource?: MediaStreamAudioSourceNode;
  private elementSource?: MediaElementAudioSourceNode;
  private looping = false;

  currentTime(): number {
    return this.audio?.currentTime ?? 0;
  }

  /** Reference clip length in seconds once loaded, else undefined. */
  duration(): number | undefined {
    const value = this.audio?.duration;
    return value && Number.isFinite(value) ? value : undefined;
  }

  getAnalyser(): AnalyserNode | undefined {
    return this.analyser;
  }

  getSampleRate(): number {
    return this.context?.sampleRate ?? 48_000;
  }

  async start(
    stream: MediaStream,
    blob: Blob,
    playbackRate = 1,
    options?: { loop?: boolean },
  ): Promise<void> {
    this.teardown();
    this.looping = Boolean(options?.loop);

    const objectUrl = URL.createObjectURL(blob);
    this.objectUrl = objectUrl;
    const audio = new Audio(objectUrl);
    audio.preload = 'auto';
    audio.loop = this.looping;
    audio.playbackRate = playbackRate;
    audio.preservesPitch = true;
    this.audio = audio;

    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Reference audio failed to load.'));
      };
      const cleanup = () => {
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('error', onError);
      };
      audio.addEventListener('canplaythrough', onReady, { once: true });
      audio.addEventListener('error', onError, { once: true });
      audio.load();
    });

    if (this.looping) {
      // Loop mode: plain element playback — no AudioContext at all, so
      // nothing after the starting tap is user-gesture-gated and there's
      // no Web Audio graph for iOS to suspend and starve. The mic goes
      // straight to MediaRecorder; the live waveform is skipped.
      audio.currentTime = 0;
      await audio.play();
      return;
    }

    // One shadow-along rep: route mic + reference through a single
    // AudioContext so the live waveform shares the graph and a second
    // context can't chop the opener.
    const context = new AudioContext();
    this.context = context;
    if (context.state === 'suspended') await context.resume();

    const micSource = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    micSource.connect(analyser);
    this.micSource = micSource;
    this.analyser = analyser;

    const elementSource = context.createMediaElementSource(audio);
    elementSource.connect(context.destination);
    this.elementSource = elementSource;

    await new Promise((resolve) => window.setTimeout(resolve, SHADOW_AUDIO_SETTLE_MS));
    await playReferenceForShadowing(audio, playbackRate);
  }

  /** End a rep: in loop mode just pause (graph stays up); else tear down. */
  stop(): void {
    if (this.looping) {
      this.audio?.pause();
      return;
    }
    this.teardown();
  }

  /** Fully release the graph — AudioContext, element, object URL. */
  teardown(): void {
    this.looping = false;
    if (this.audio) {
      this.audio.pause();
      this.audio.loop = false;
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    this.audio = undefined;
    try {
      this.elementSource?.disconnect();
      this.micSource?.disconnect();
      this.analyser?.disconnect();
    } catch {
      // already disconnected
    }
    this.elementSource = undefined;
    this.micSource = undefined;
    this.analyser = undefined;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = undefined;
    }
    const context = this.context;
    this.context = undefined;
    void context?.close().catch(() => undefined);
  }
}

export function stopShadowReference(audio: HTMLAudioElement | null | undefined): void {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
}

export interface TimeRangeMs {
  startMs: number;
  endMs: number;
}

/**
 * Plays `audio` from `range.startMs` (or 0) until it either ends naturally
 * or, if `range.endMs` is given, crosses that point — resolving either way.
 */
function playUntilEnded(
  audio: HTMLAudioElement,
  signal?: AbortSignal,
  range?: TimeRangeMs,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const startSec = range ? range.startMs / 1000 : 0;
    const endSec = range ? range.endMs / 1000 : undefined;
    const onAbort = () => {
      audio.pause();
      audio.currentTime = startSec;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      if (endSec !== undefined) audio.removeEventListener('timeupdate', onTimeUpdate);
      signal?.removeEventListener('abort', onAbort);
    };
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onTimeUpdate = () => {
      if (endSec !== undefined && audio.currentTime >= endSec) {
        audio.pause();
        onEnded();
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error('Audio playback failed.'));
    };
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    if (endSec !== undefined) audio.addEventListener('timeupdate', onTimeUpdate);
    signal?.addEventListener('abort', onAbort, { once: true });
    audio.currentTime = startSec;
    audio.play().catch((error: unknown) => {
      cleanup();
      reject(error);
    });
  });
}

/**
 * Plays `audio` repeatedly within `range`, jumping back to the start
 * whenever playback crosses the end — until `signal` aborts. Backs Phase
 * 8.2's practice-target isolation (new code, not ported from anywhere).
 */
function playLoopedRange(
  audio: HTMLAudioElement,
  range: TimeRangeMs,
  signal: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const startSec = range.startMs / 1000;
    const endSec = range.endMs / 1000;
    if (signal.aborted) {
      resolve();
      return;
    }
    const cleanup = () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      signal.removeEventListener('abort', onAbort);
    };
    const onTimeUpdate = () => {
      if (audio.currentTime >= endSec) audio.currentTime = startSec;
    };
    const onAbort = () => {
      audio.pause();
      cleanup();
      resolve();
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    signal.addEventListener('abort', onAbort, { once: true });
    audio.currentTime = startSec;
    audio.play().catch(() => {
      cleanup();
      resolve();
    });
  });
}

export interface DualEarOptions {
  swapEars?: boolean;
  playbackRate?: number;
  /** Trims only the reference side to this range; the learner side always plays in full. */
  referenceRange?: TimeRangeMs;
}

/**
 * Play reference and learner simultaneously, hard-panned to opposite ears.
 * Default: reference left (-1), learner right (+1).
 */
export async function playDualEar(
  referenceBlob: Blob,
  learnerBlob: Blob,
  options: DualEarOptions = {},
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  if (typeof AudioContext === 'undefined') {
    throw new Error('Web Audio is not supported in this browser.');
  }

  const playbackRate = options.playbackRate ?? 1;
  const swapEars = Boolean(options.swapEars);
  const referenceUrl = URL.createObjectURL(referenceBlob);
  const learnerUrl = URL.createObjectURL(learnerBlob);
  const context = new AudioContext();
  const referenceAudio = new Audio(referenceUrl);
  const learnerAudio = new Audio(learnerUrl);
  referenceAudio.preload = 'auto';
  learnerAudio.preload = 'auto';
  referenceAudio.playbackRate = playbackRate;
  learnerAudio.playbackRate = playbackRate;
  referenceAudio.preservesPitch = true;
  learnerAudio.preservesPitch = true;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    referenceAudio.pause();
    learnerAudio.pause();
    referenceAudio.removeAttribute('src');
    learnerAudio.removeAttribute('src');
    URL.revokeObjectURL(referenceUrl);
    URL.revokeObjectURL(learnerUrl);
    void context.close().catch(() => undefined);
  };

  try {
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        referenceAudio.addEventListener('canplaythrough', () => resolve(), {
          once: true,
        });
        referenceAudio.addEventListener(
          'error',
          () => reject(new Error('Reference audio failed to load.')),
          { once: true },
        );
        referenceAudio.load();
      }),
      new Promise<void>((resolve, reject) => {
        learnerAudio.addEventListener('canplaythrough', () => resolve(), {
          once: true,
        });
        learnerAudio.addEventListener(
          'error',
          () => reject(new Error('Learner audio failed to load.')),
          { once: true },
        );
        learnerAudio.load();
      }),
    ]);

    if (signal?.aborted) {
      cleanup();
      return;
    }

    if (context.state === 'suspended') await context.resume();

    const referenceSource = context.createMediaElementSource(referenceAudio);
    const learnerSource = context.createMediaElementSource(learnerAudio);
    const referencePan = context.createStereoPanner();
    const learnerPan = context.createStereoPanner();
    referencePan.pan.value = swapEars ? 1 : -1;
    learnerPan.pan.value = swapEars ? -1 : 1;
    referenceSource.connect(referencePan).connect(context.destination);
    learnerSource.connect(learnerPan).connect(context.destination);

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        resolve();
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });

      let ended = 0;
      const onEnded = () => {
        ended += 1;
        if (ended >= 2) {
          signal?.removeEventListener('abort', onAbort);
          cleanup();
          resolve();
        }
      };
      const onError = () => {
        signal?.removeEventListener('abort', onAbort);
        cleanup();
        reject(new Error('Dual-ear playback failed.'));
      };

      const referenceEndSec = options.referenceRange
        ? options.referenceRange.endMs / 1000
        : undefined;
      const onReferenceTimeUpdate = () => {
        if (referenceEndSec !== undefined && referenceAudio.currentTime >= referenceEndSec) {
          referenceAudio.removeEventListener('timeupdate', onReferenceTimeUpdate);
          referenceAudio.pause();
          onEnded();
        }
      };

      referenceAudio.addEventListener('ended', onEnded, { once: true });
      learnerAudio.addEventListener('ended', onEnded, { once: true });
      referenceAudio.addEventListener('error', onError, { once: true });
      learnerAudio.addEventListener('error', onError, { once: true });
      if (referenceEndSec !== undefined) {
        referenceAudio.addEventListener('timeupdate', onReferenceTimeUpdate);
      }

      referenceAudio.currentTime = options.referenceRange
        ? options.referenceRange.startMs / 1000
        : 0;
      learnerAudio.currentTime = 0;
      Promise.all([referenceAudio.play(), learnerAudio.play()]).catch(
        (error: unknown) => {
          signal?.removeEventListener('abort', onAbort);
          cleanup();
          reject(error);
        },
      );
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}

export class PlaybackCoordinator {
  private controller?: AbortController;

  cancel(): void {
    this.controller?.abort();
    this.controller = undefined;
  }

  async alternate(
    reference: HTMLAudioElement,
    learner: HTMLAudioElement,
    gapMs = 250,
    playbackRate = 1,
    referenceRange?: TimeRangeMs,
  ): Promise<void> {
    this.cancel();
    this.controller = new AbortController();
    const { signal } = this.controller;
    reference.playbackRate = playbackRate;
    reference.preservesPitch = true;
    learner.playbackRate = playbackRate;
    learner.preservesPitch = true;
    await playUntilEnded(reference, signal, referenceRange);
    if (signal.aborted) return;
    await new Promise((resolve) => window.setTimeout(resolve, gapMs));
    if (signal.aborted) return;
    await playUntilEnded(learner, signal);
  }

  async dualEar(
    referenceBlob: Blob,
    learnerBlob: Blob,
    options: DualEarOptions = {},
  ): Promise<void> {
    this.cancel();
    this.controller = new AbortController();
    await playDualEar(referenceBlob, learnerBlob, options, this.controller.signal);
  }

  /** Plays `audio` once, optionally bounded to `range`, then resolves. */
  async playRange(
    audio: HTMLAudioElement,
    range?: TimeRangeMs,
    playbackRate = 1,
  ): Promise<void> {
    this.cancel();
    this.controller = new AbortController();
    const { signal } = this.controller;
    audio.playbackRate = playbackRate;
    audio.preservesPitch = true;
    await playUntilEnded(audio, signal, range);
  }

  /** Loops `audio` within `range` until `cancel()` is called. */
  async loopRange(
    audio: HTMLAudioElement,
    range: TimeRangeMs,
    playbackRate = 1,
  ): Promise<void> {
    this.cancel();
    this.controller = new AbortController();
    const { signal } = this.controller;
    audio.playbackRate = playbackRate;
    audio.preservesPitch = true;
    await playLoopedRange(audio, range, signal);
  }
}
