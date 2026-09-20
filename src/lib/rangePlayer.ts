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
  private context: AudioContext | null = null;
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
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context ??= new Ctor();
    if (this.context.state === 'suspended') await this.context.resume();
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.rate ?? 1;
    source.connect(this.context.destination);
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

  dispose(): void {
    this.stop();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
