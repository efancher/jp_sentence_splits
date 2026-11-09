/**
 * Debug capture for the live shadow pitch chart: a rolling window of the exact
 * mic frames the chart analysed, with what it made of each, so a "my line is
 * flat" report can be replayed offline instead of guessed at. Nothing leaves
 * the device unless the learner taps the save button.
 */

export interface LivePitchCaptureEntry {
  /** performance.now() when the frame was analysed (ms). */
  at: number;
  rawMediaTime: number;
  leadInRemainingMs: number;
  held: boolean;
  /** Chart bucket the frame was drawn into (may be outside 0..buckets-1). */
  index: number;
  frame: Float32Array;
  voiced: boolean;
  hz: number | null;
  confidence: number;
  /** Hz after the octave guard (null = dropped, or not voiced). */
  guardedHz: number | null;
}

/** ~13 s of estimates at the chart's ~30 Hz cadence (≈1.6 MB of frames). */
export const LIVE_PITCH_CAPTURE_MAX_ENTRIES = 400;

export class LivePitchCapture {
  private entries: LivePitchCaptureEntry[] = [];

  push(entry: LivePitchCaptureEntry): void {
    this.entries.push(entry);
    if (this.entries.length > LIVE_PITCH_CAPTURE_MAX_ENTRIES) this.entries.shift();
  }

  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }

  toJson(meta: Record<string, unknown>): string {
    return JSON.stringify({
      version: 1,
      capturedAt: new Date().toISOString(),
      meta,
      entries: this.entries.map((entry) => ({
        ...entry,
        frame: float32ToBase64(entry.frame),
      })),
    });
  }
}

export function float32ToBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Share sheet where available (reliable on iOS PWAs), else a plain download. */
export async function saveCaptureFile(json: string, filename: string): Promise<void> {
  const file = new File([json], filename, { type: 'application/json' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
