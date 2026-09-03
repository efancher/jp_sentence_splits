import { extractPitch, type PitchAnalysisPayload } from './pitch';
import { canonicalizeAudioBuffer, decodeAudioBuffer } from './waveform';

/**
 * Checks the Dexie cache before running the (comparatively slow) YIN pitch
 * pass over a reference clip, and saves a successful result back to it.
 * Returns `undefined` on any failure — decoding audio needs a working
 * `AudioContext`, which is not always available (some iOS PWA / timer
 * contexts), and a corrupt/undecodable blob is an ordinary condition here,
 * not an error to surface. The overlay simply doesn't render in that case.
 *
 * Kept out of pitch.ts itself for the same test-mock reason as
 * `alignmentCache.ts`: tests `vi.mock('../src/lib/waveform', ...)` to stub
 * `decodeAudioBuffer`, which only intercepts calls from *other* modules
 * importing that export.
 */
export async function loadOrComputeReferencePitch(
  id: string,
  blob: Blob,
  get: (id: string) => Promise<PitchAnalysisPayload | undefined>,
  save: (id: string, payload: PitchAnalysisPayload) => Promise<void>,
): Promise<PitchAnalysisPayload | undefined> {
  const cached = await get(id);
  if (cached) return cached;
  try {
    const buffer = await decodeAudioBuffer(blob);
    const payload = extractPitch(canonicalizeAudioBuffer(buffer));
    await save(id, payload);
    return payload;
  } catch {
    return undefined;
  }
}
