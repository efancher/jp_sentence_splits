import {
  MAX_RECORDING_DURATION_MS,
  PlaybackCoordinator,
  RecordingService,
  type DualEarOptions,
  type RecordingMicMode,
} from './recording';

export type ShadowingStatus = 'idle' | 'requesting-mic' | 'recording' | 'stopped';

interface ShadowingSnapshot {
  status: ShadowingStatus;
  recordingElapsedMs: number;
  lastRecording: { blob: Blob; durationMs: number } | null;
  comparison: { mode: 'alternate' | 'dualEar'; attemptId: string } | null;
  error: string | null;
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
  };
  private recordingService = new RecordingService();
  private playbackCoordinator = new PlaybackCoordinator();
  private timer: ReturnType<typeof setInterval> | undefined;
  private recordingStartedAt = 0;
  private stopping = false;

  getSnapshot = (): ShadowingSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify(patch: Partial<ShadowingSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  async startRecording(micMode?: RecordingMicMode): Promise<void> {
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
    });
    try {
      await this.recordingService.start(micMode ? { micMode } : undefined);
    } catch (error) {
      this.notify({ status: 'idle', error: messageFor(error) });
      return;
    }
    this.recordingStartedAt = Date.now();
    this.notify({ status: 'recording', recordingElapsedMs: 0 });
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const elapsed = Date.now() - this.recordingStartedAt;
    if (elapsed >= MAX_RECORDING_DURATION_MS) {
      this.notify({ recordingElapsedMs: MAX_RECORDING_DURATION_MS });
      void this.stopRecording();
      return;
    }
    this.notify({ recordingElapsedMs: elapsed });
  }

  async stopRecording(): Promise<{ blob: Blob; durationMs: number } | null> {
    if (this.snapshot.status !== 'recording' || this.stopping) return null;
    this.stopping = true;
    this.clearTimer();
    try {
      const result = await this.recordingService.stop();
      this.notify({ status: 'stopped', lastRecording: result, error: null });
      return result;
    } catch (error) {
      this.notify({ status: 'idle', lastRecording: null, error: messageFor(error) });
      return null;
    } finally {
      this.stopping = false;
    }
  }

  cancelRecording(): void {
    this.clearTimer();
    this.recordingService.cancel();
    this.notify({
      status: 'idle',
      recordingElapsedMs: 0,
      lastRecording: null,
      error: null,
    });
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
  ): Promise<void> {
    this.notify({ comparison: { mode: 'alternate', attemptId }, error: null });
    try {
      await this.playbackCoordinator.alternate(referenceEl, attemptEl, 250, playbackRate);
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
