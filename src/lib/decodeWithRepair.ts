import { decodeAudioBuffer } from './waveform';

/** "EncodingError: Unable to decode audio data" — the error's name and message, for a useful on-screen hint. */
export function describeDecodeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 120);
  return String(error).slice(0, 120);
}

/**
 * Decodes a reference recording, healing a bad local copy on the way. Safari's
 * IndexedDB occasionally hands back a Blob that looks intact (right size and
 * type) but won't decode — the cloud original is fine, so on failure the blob is
 * re-fetched (`repairSentenceAudio` also fixes the local cache) and decoded
 * again. Throws an Error naming the underlying failure when both attempts fail
 * (or when there is no cloud copy to repair from).
 */
export async function decodeWithRepair(
  blob: Blob,
  audioId: string,
  repair: (audioId: string) => Promise<Blob | null>,
  decode: (blob: Blob) => Promise<AudioBuffer> = decodeAudioBuffer,
): Promise<AudioBuffer> {
  try {
    return await decode(blob);
  } catch (first) {
    let fresh: Blob | null = null;
    try {
      fresh = await repair(audioId);
    } catch {
      // no network / not signed in — report the original failure
    }
    if (!fresh) throw new Error(`${describeDecodeError(first)} (no cloud copy to repair from)`);
    try {
      return await decode(fresh);
    } catch (second) {
      throw new Error(`${describeDecodeError(second)} (still failing after re-downloading)`);
    }
  }
}
