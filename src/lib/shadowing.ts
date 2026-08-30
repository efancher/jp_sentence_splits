import {
  MAX_RECORDING_DURATION_MS,
  PlaybackCoordinator,
  RecordingService,
  ShadowReferencePlayer,
  type DualEarOptions,
  type RecordingMicMode,
  type TimeRangeMs,
} from './recording';

export type ShadowingStatus = 'idle' | 'requesting-mic' | 'recording' | 'stopped';

export interface ShadowReferenceOptions {
  blob: Blob;
  playbackRate?: number;
}

interface ShadowingSnapshot {
  status: ShadowingStatus;
  recordingElapsedMs: number;
  lastRecording: { blob: Blob; durationMs: number } | null;
  comparison: { mode: 'alternate' | 'dualEar'; attemptId: string } | null;
  error: string | null;
  /** True once the shadow-mode reference/analyser graph is actually up (not just requested). */
  shadowActive: boolean;
}

type Listener = () => void;

const TICK_MS = 100;

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/**
 * Shared shadowing-practice controller: mic recording plus reference/attempt
 * comparison playback (docs/UNIFIED_APP_ARCHITECTURE.md §12, Phase 3).
 *
 * Deliberately a sibling to NativeAudioController, not a reuse of it — this
 * models materially different state (recording progress, comparison mode)
 * and coupling it to reference-only playback would risk regressing that
 * simpler, already-tested controller.
 */
export class ShadowingController {
  private listeners = new Set<Listener>();
  private snapshot: ShadowingSnapshot = {
    status: 'idle',
    recordingElapsedMs: 0,
    lastRecording: null,
    comparison: null,
    error: null,
    shadowActive: false,
  };
  private recordingService = new RecordingService();
  private playbackCoordinator = new PlaybackCoordinator();
  private shadowPlayer = new ShadowReferencePlayer();
  private timer: ReturnType<typeof setInterval> | undefined;
  private recordingStartedAt = 0;
  private stopping = false;
  private shadowLoop:
    | {
        onRep: (take: { blob: Blob; durationMs: number }) => void;
        clipSeconds: number;
        lastCurrentTime: number;
        cycling: boolean;
      }
    | undefined;

  getSnapshot = (): ShadowingSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify(patch: Partial<ShadowingSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  async startRecording(
    micMode?: RecordingMicMode,
    shadowReference?: ShadowReferenceOptions,
    options?: { reuseStream?: boolean },
  ): Promise<void> {
    if (
      this.snapshot.status === 'recording' ||
      this.snapshot.status === 'requesting-mic'
    ) {
      return;
    }
    this.notify({
      status: 'requesting-mic',
      recordingElapsedMs: 0,
      lastRecording: null,
      error: null,
      shadowActive: false,
    });
    try {
      await this.recordingService.start({
        ...(micMode ? { micMode } : {}),
        ...(options?.reuseStream ? { reuseStream: true } : {}),
      });
    } catch (error) {
      this.notify({ status: 'idle', error: messageFor(error) });
      return;
    }
    this.recordingStartedAt = Date.now();
    this.notify({ status: 'recording', recordingElapsedMs: 0 });
    this.timer = setInterval(() => this.tick(), TICK_MS);

    if (micMode === 'shadow' && shadowReference) {
      const stream = this.recordingService.getStream();
      if (stream) {
        try {
          await this.shadowPlayer.start(
            stream,
            shadowReference.blob,
            shadowReference.playbackRate,
          );
          this.notify({ shadowActive: true });
        } catch (error) {
          // Non-fatal: the mic recording itself is unaffected, only the
          // play-along reference/live-waveform side failed to start.
          this.notify({ error: messageFor(error) });
        }
      }
    }
  }

  /**
   * Hands-free shadow-rep loop (guided-shadowing stages 3-4). Unlike
   * `startRecording('shadow')` run repeatedly, all the gesture-gated setup
   * — `getUserMedia`, `AudioContext.resume()`, the first reference
   * `play()` — happens **once**, under the caller's tap; after that the
   * reference `<audio loop>` re-plays itself and only `MediaRecorder`
   * cycling runs, so it survives on iOS Safari. Each time the reference
   * wraps we cycle the recorder so `onRep` gets one take per rep. The
   * shared mic analyser stays up, so the live waveform works. End with
   * `stopShadowLoop()`.
   */
  async startShadowLoop(
    blob: Blob,
    opts: {
      playbackRate?: number;
      onRep: (take: { blob: Blob; durationMs: number }) => void;
    },
  ): Promise<void> {
    if (this.snapshot.status === 'recording' || this.snapshot.status === 'requesting-mic') {
      return;
    }
    this.notify({
      status: 'requesting-mic',
      recordingElapsedMs: 0,
      lastRecording: null,
      error: null,
      shadowActive: false,
    });
    try {
      await this.recordingService.start({ micMode: 'shadow', reuseStream: true });
    } catch (error) {
      this.notify({ status: 'idle', error: messageFor(error) });
      return;
    }
    const stream = this.recordingService.getStream();
    if (!stream) {
      this.recordingService.cancel();
      this.notify({ status: 'idle', error: 'No microphone stream available.' });
      return;
    }
    try {
      await this.shadowPlayer.start(stream, blob, opts.playbackRate ?? 1, { loop: true });
    } catch (error) {
      this.recordingService.cancel();
      this.notify({ status: 'idle', error: messageFor(error), shadowActive: false });
      return;
    }
    this.shadowLoop = {
      onRep: opts.onRep,
      clipSeconds: this.shadowPlayer.duration() ?? 3,
      lastCurrentTime: this.shadowPlayer.currentTime(),
      cycling: false,
    };
    this.recordingStartedAt = Date.now();
    this.notify({ status: 'recording', recordingElapsedMs: 0, shadowActive: true });
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stopShadowLoop(): void {
    const loop = this.shadowLoop;
    this.shadowLoop = undefined;
    this.clearTimer();
    if (!loop) return;
    void this.recordingService
      .stop()
      .then((take) => {
        loop.onRep(take);
        this.notify({ status: 'stopped', lastRecording: take, error: null, shadowActive: false });
      })
      .catch(() => this.notify({ status: 'idle', shadowActive: false }))
      .finally(() => {
        this.recordingService.releaseStream();
        this.shadowPlayer.teardown();
      });
  }

  private tick(): void {
    if (this.shadowLoop) {
      this.tickShadowLoop(this.shadowLoop);
      return;
    }
    const elapsed = Date.now() - this.recordingStartedAt;
    if (elapsed >= MAX_RECORDING_DURATION_MS) {
      this.notify({ recordingElapsedMs: MAX_RECORDING_DURATION_MS });
      void this.stopRecording();
      return;
    }
    this.notify({ recordingElapsedMs: elapsed });
  }

  private tickShadowLoop(loop: NonNullable<ShadowingController['shadowLoop']>): void {
    const now = this.shadowPlayer.currentTime();
    // The reference wrapped (loop=true restarts silently) when playback
    // position jumps back by more than half the clip. No per-tick notify —
    // nothing in loop mode shows elapsed time, and a 10 Hz snapshot churn
    // re-renders the panel + waveform enough to scroll on mobile.
    const wrapped = loop.lastCurrentTime - now > loop.clipSeconds / 2;
    loop.lastCurrentTime = now;
    if (wrapped && !loop.cycling) {
      loop.cycling = true;
      void this.recordingService
        .cycleRecorder()
        .then((take) => loop.onRep(take))
        .catch((error) => {
          // A rep that captured nothing (a quiet pass) is fine — keep going.
          // Anything else (mic track ended, recorder wedged) ends the loop
          // cleanly instead of spinning with the same error every wrap.
          if (error instanceof Error && error.message === 'No audio was captured.') {
            return;
          }
          this.endShadowLoop({ error: messageFor(error) });
        })
        .finally(() => {
          loop.cycling = false;
        });
    }
  }

  private endShadowLoop(opts: { error?: string } = {}): void {
    if (!this.shadowLoop) return;
    this.shadowLoop = undefined;
    this.clearTimer();
    this.recordingService.cancel();
    this.shadowPlayer.teardown();
    this.notify({
      status: 'idle',
      recordingElapsedMs: 0,
      shadowActive: false,
      ...(opts.error ? { error: opts.error } : {}),
    });
  }

  async stopRecording(): Promise<{ blob: Blob; durationMs: number } | null> {
    if (this.snapshot.status !== 'recording' || this.stopping) return null;
    this.stopping = true;
    this.clearTimer();
    this.shadowPlayer.stop();
    try {
      const result = await this.recordingService.stop();
      this.notify({ status: 'stopped', lastRecording: result, error: null, shadowActive: false });
      return result;
    } catch (error) {
      this.notify({
        status: 'idle',
        lastRecording: null,
        error: messageFor(error),
        shadowActive: false,
      });
      return null;
    } finally {
      this.stopping = false;
    }
  }

  cancelRecording(): void {
    this.shadowLoop = undefined;
    this.clearTimer();
    this.recordingService.cancel();
    this.shadowPlayer.teardown();
    this.notify({
      status: 'idle',
      recordingElapsedMs: 0,
      lastRecording: null,
      error: null,
      shadowActive: false,
    });
  }

  /**
   * Close the mic stream and shadow play-along graph. `stopShadowLoop`
   * already does this; kept as an explicit safety-net for callers that
   * tear down out-of-band (panel unmount / stage change).
   */
  releaseRecordingStream(): void {
    this.shadowLoop = undefined;
    this.recordingService.releaseStream();
    this.shadowPlayer.teardown();
  }

  /** Shared analyser from the active shadow-mode session (do not open a second AudioContext). */
  getShadowAnalyser(): AnalyserNode | undefined {
    return this.shadowPlayer.getAnalyser();
  }

  getShadowMediaTime(): number {
    return this.shadowPlayer.currentTime();
  }

  getShadowSampleRate(): number {
    return this.shadowPlayer.getSampleRate();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async playAlternate(
    referenceEl: HTMLAudioElement,
    attemptEl: HTMLAudioElement,
    attemptId: string,
    playbackRate = 1,
    referenceRange?: TimeRangeMs,
  ): Promise<void> {
    this.notify({ comparison: { mode: 'alternate', attemptId }, error: null });
    try {
      await this.playbackCoordinator.alternate(
        referenceEl,
        attemptEl,
        250,
        playbackRate,
        referenceRange,
      );
    } catch (error) {
      this.notify({ error: messageFor(error) });
    } finally {
      this.notify({ comparison: null });
    }
  }

  async playDualEar(
    referenceBlob: Blob,
    attemptBlob: Blob,
    attemptId: string,
    options?: DualEarOptions,
  ): Promise<void> {
    this.notify({ comparison: { mode: 'dualEar', attemptId }, error: null });
    try {
      await this.playbackCoordinator.dualEar(referenceBlob, attemptBlob, options);
    } catch (error) {
      this.notify({ error: messageFor(error) });
    } finally {
      this.notify({ comparison: null });
    }
  }

  stopComparison(): void {
    this.playbackCoordinator.cancel();
    this.notify({ comparison: null });
  }
}

export const shadowingController = new ShadowingController();
