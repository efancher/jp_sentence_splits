import type { SentenceAudio } from '../domain/types';

interface NativeAudioSnapshot {
  isPlaying: boolean;
  activeItemId: string | null;
  error: string | null;
}

type Listener = () => void;

/**
 * Shared native/reference-audio player.
 *
 * Object URLs are short-lived and revoked whenever playback changes. A
 * generation counter prevents stale ended/error events from clearing a newer
 * clip's state.
 */
export class NativeAudioController {
  private listeners = new Set<Listener>();
  private snapshot: NativeAudioSnapshot = {
    isPlaying: false,
    activeItemId: null,
    error: null,
  };
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private generation = 0;

  getSnapshot = (): NativeAudioSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify(patch: Partial<NativeAudioSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  async play(record: SentenceAudio, playbackRate = 1): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    this.notify({
      isPlaying: true,
      activeItemId: record.id,
      error: null,
    });
    await this.attemptPlayback(record, playbackRate, generation, false);
  }

  private async attemptPlayback(
    record: SentenceAudio,
    playbackRate: number,
    generation: number,
    isRetry: boolean,
  ): Promise<void> {
    this.revokeObjectUrl();
    const url = URL.createObjectURL(record.blob);
    const audio = new Audio(url);
    audio.playbackRate = playbackRate;
    audio.preservesPitch = true;
    this.objectUrl = url;
    this.audio = audio;
    audio.onended = () => this.finish(generation);

    let handled = false;
    const handleFailure = () => {
      if (generation !== this.generation || handled) return;
      handled = true;
      void this.recoverAndRetry(record, playbackRate, generation, isRetry);
    };
    audio.onerror = handleFailure;

    try {
      await audio.play();
    } catch {
      if (generation === this.generation && !handled) {
        handled = true;
        await this.recoverAndRetry(record, playbackRate, generation, isRetry);
      }
    }
  }

  /**
   * Safari's IndexedDB occasionally hands back a Blob that fails to play
   * (WebKitBlobResource error) even though it looks intact locally. One
   * retry after refetching the clip from Supabase Storage recovers from
   * that without the user having to re-import the whole book.
   */
  private async recoverAndRetry(
    record: SentenceAudio,
    playbackRate: number,
    generation: number,
    isRetry: boolean,
  ): Promise<void> {
    if (isRetry) {
      console.error('Native sentence audio playback failed after repair attempt.');
      this.finish(
        generation,
        'Unable to play this sentence recording on this device.',
      );
      return;
    }
    const { repairSentenceAudio } = await import('../sync/audioSync');
    const freshBlob = await repairSentenceAudio(record.id);
    if (generation !== this.generation) return;
    if (!freshBlob) {
      console.error('Unable to play imported native sentence audio.');
      this.finish(
        generation,
        'Unable to play this sentence recording on this device.',
      );
      return;
    }
    await this.attemptPlayback({ ...record, blob: freshBlob }, playbackRate, generation, true);
  }

  stop(): void {
    this.generation += 1;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = null;
    }
    this.revokeObjectUrl();
    if (this.snapshot.isPlaying || this.snapshot.activeItemId) {
      this.notify({
        isPlaying: false,
        activeItemId: null,
      });
    }
  }

  private finish(generation: number, error: string | null = null): void {
    if (generation !== this.generation) return;
    this.audio = null;
    this.revokeObjectUrl();
    this.notify({
      isPlaying: false,
      activeItemId: null,
      error,
    });
  }

  private revokeObjectUrl(): void {
    if (!this.objectUrl) return;
    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}

export const nativeAudioController = new NativeAudioController();
