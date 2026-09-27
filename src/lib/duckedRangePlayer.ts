/**
 * One AudioContext for the whole page, created lazily on the first play —
 * same reasoning as `rangePlayer.ts` (iOS's live-context cap).
 */
let sharedContext: AudioContext | null = null;

function getContext(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedContext = new Ctor();
  }
  return sharedContext;
}

export interface DuckRange {
  startMs: number;
  endMs: number;
}

/** How quiet a ducked word gets — reduced, not silenced, so it still reads as "there but faint." */
export const DUCK_LEVEL = 0.12;
/** Fade in/out either side of a duck, so the level change isn't an audible click. */
const FADE_SECONDS = 0.03;

/**
 * Plays one range of a decoded `AudioBuffer` (Then & Now, docs/ROADMAP.md
 * "Short games") with a `GainNode` automated down to `DUCK_LEVEL` over each
 * `duckRanges` span and back up outside it — the same single-source-node
 * shape as `RangePlayer`, with a gain stage inserted between the source and
 * the destination. `duckRanges` are in the buffer's own timeline (ms from
 * the start of the *decoded audio*, matching `WordAlignment.start/end`
 * converted to ms), not relative to `range`.
 *
 * Automation times are clamped to be non-decreasing (`cursor`) so two duck
 * ranges close enough together can't schedule an earlier `AudioParam` time
 * after a later one, which Web Audio rejects.
 */
export class DuckedRangePlayer {
  private source: AudioBufferSourceNode | null = null;

  async play(
    buffer: AudioBuffer,
    range: { startMs: number; endMs: number },
    duckRanges: readonly DuckRange[],
    options: { onEnded?: () => void } = {},
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
    const gain = context.createGain();

    const playStart = context.currentTime;
    const playEnd = playStart + durationSec;
    gain.gain.setValueAtTime(1, playStart);
    let cursor = playStart;
    const at = (timeSec: number) => {
      cursor = Math.max(cursor, Math.min(timeSec, playEnd));
      return cursor;
    };
    for (const duck of [...duckRanges].sort((a, b) => a.startMs - b.startMs)) {
      const duckStart = playStart + duck.startMs / 1000 - startSec;
      const duckEnd = playStart + duck.endMs / 1000 - startSec;
      if (duckEnd <= playStart || duckStart >= playEnd) continue;
      gain.gain.setValueAtTime(1, at(duckStart - FADE_SECONDS));
      gain.gain.linearRampToValueAtTime(DUCK_LEVEL, at(duckStart));
      gain.gain.setValueAtTime(DUCK_LEVEL, at(duckEnd - FADE_SECONDS));
      gain.gain.linearRampToValueAtTime(1, at(duckEnd));
    }

    source.connect(gain);
    gain.connect(context.destination);
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
  }
}
