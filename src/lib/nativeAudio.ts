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

  async play(record: SentenceAudio): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    const url = URL.createObjectURL(record.blob);
    const audio = new Audio(url);
    this.objectUrl = url;
    this.audio = audio;
    audio.onended = () => this.finish(generation);
    audio.onerror = () => {
      if (generation !== this.generation) return;
      console.error('Unable to play imported native sentence audio.');
      this.finish(
        generation,
        'Unable to play this sentence recording on this device.',
      );
    };
    this.notify({
      isPlaying: true,
      activeItemId: record.id,
      error: null,
    });
    try {
      await audio.play();
    } catch (error) {
      if (generation !== this.generation) return;
      console.error('Native sentence audio playback failed:', error);
      this.finish(
        generation,
        'Unable to play this sentence recording on this device.',
      );
    }
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
