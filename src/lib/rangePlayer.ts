/**
 * One AudioContext for the whole page, created lazily on the first play. iOS
 * Safari allows only a handful of live contexts, and closing one is
 * asynchronous — making a fresh context per labelling item could hit that cap
 * partway through a session. Sharing it also keeps it "unlocked" once a tap has
 * resumed it.
 */
let sharedContext: AudioContext | null = null;

function getContext(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedContext = new Ctor();
  }
  return sharedContext;
}

/**
 * Sample-accurate playback of one range of a decoded `AudioBuffer` via Web
 * Audio — for auditioning short slices around a boundary, where the
 * `<audio>` element's ~4 Hz `timeupdate` (what the loop players use) is far
 * too coarse to stop on a 300 ms edge. Create/resume happens inside `play`, so
 * call it from a tap handler (iOS only starts audio from a user gesture).
 * Slowed playback lowers the pitch (no time-stretch): fine for hearing where a
 * word starts, not for judging pitch.
 */
export class RangePlayer {
  private source: AudioBufferSourceNode | null = null;

  async play(
    buffer: AudioBuffer,
    range: { startMs: number; endMs: number },
    options: { rate?: number; onEnded?: () => void } = {},
  ): Promise<void> {
    this.stop();
    const startSec = Math.max(0, range.startMs / 1000);
    const durationSec = Math.min(buffer.duration, range.endMs / 1000) - startSec;
    if (durationSec <= 0) {
      options.onEnded?.();
      return;
    }
    const context = getContext();
    if (context.state === 'suspended') await context.resume();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.rate ?? 1;
    source.connect(context.destination);
    source.onended = () => {
      if (this.source === source) {
        this.source = null;
        options.onEnded?.();
      }
    };
    this.source = source;
    source.start(0, startSec, durationSec);
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
  }

  /** Stops playback. The shared context stays open for the next item. */
  dispose(): void {
    this.stop();
  }
}
