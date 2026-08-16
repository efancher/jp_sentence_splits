/**
 * Ported from ~/projects/shadowing/web/src/services/recording.ts
 * (docs/UNIFIED_APP_ARCHITECTURE.md §12, Phase 3 — shadowing core loop).
 * Scoped down: live-overlay-only pieces (calibrateMicrophone,
 * playReferenceForShadowing, ShadowReferencePlayer, stopShadowReference) and
 * the unused PlaybackCoordinator.playSequence are not ported — see the
 * architecture doc / plan for the follow-up pass that would need them.
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
  private chunks: Blob[] = [];
  private startedAtMs = 0;

  static supportedMimeType(): string | undefined {
    if (!('MediaRecorder' in window)) return undefined;
    return RECORDING_MIME_TYPES.find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    );
  }

  async start(options?: { micMode?: RecordingMicMode }): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone recording is not supported in this browser.');
    }
    const micMode = options?.micMode ?? 'default';
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: micConstraintsForRecording(micMode),
    });
    const mimeType = RecordingService.supportedMimeType();
    this.recorder = mimeType
      ? new MediaRecorder(this.stream, { mimeType })
      : new MediaRecorder(this.stream);
    this.chunks = [];
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    this.startedAtMs = Date.now();
    this.recorder.start();
  }

  /** Active mic stream while recording; undefined after stop/cancel. */
  getStream(): MediaStream | undefined {
    return this.stream;
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
    this.cleanup();
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.recorder = undefined;
  }
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
