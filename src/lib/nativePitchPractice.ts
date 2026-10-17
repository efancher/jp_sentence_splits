import type { WordAlignment } from '../domain/types';
import { phonesToSoundedMorae } from './moraTiming';
import type { PitchAnalysisPayload } from './pitch';

export interface PracticeMora {
  kana: string;
  start: number;
  end: number;
  pitch: number | null;
}
export interface PracticeChunk {
  text: string;
  start: number;
  end: number;
  morae: PracticeMora[];
  incomplete: boolean;
}
const SILENCE = new Set(['', '<eps>', '<sil>', '<pad>', 'sil', 'sp']);

/** Pause groups for rehearsal, not claims about linguistic accent phrases.
 * Kana comes from aligned phones; unreadable tokens remain visible, never
 * shift the rest of the sentence or acquire invented mora boundaries.
 */
export function buildNativePractice(words: readonly WordAlignment[], pitch: PitchAnalysisPayload): PracticeChunk[] {
  const chunks: PracticeChunk[] = [];
  for (const word of words) {
    if (SILENCE.has(word.text) || !(word.end > word.start)) continue;
    let chunk = chunks.at(-1);
    if (!chunk || word.start - chunk.end >= 0.2) {
      chunk = { text: '', start: word.start, end: word.end, morae: [], incomplete: false };
      chunks.push(chunk);
    }
    chunk.text += word.text === '<unk>' ? '…' : word.text;
    chunk.end = word.end;
    const sounded = phonesToSoundedMorae(word.phones);
    if (!sounded?.length) {
      chunk.incomplete = true;
      // Keep an untimed-reading placeholder in the right location.
      chunk.morae.push({ kana: word.text === '<unk>' ? '…' : word.text, start: word.start, end: word.end, pitch: null });
      continue;
    }
    for (const mora of sounded) {
      const values = pitch.frames.filter(f => f.timeSeconds >= mora.start && f.timeSeconds < mora.end
        && f.voiced && f.relativeSemitones !== null && Number.isFinite(f.relativeSemitones))
        .map(f => f.relativeSemitones!).sort((a, b) => a - b);
      // A closure has no pitch target, even if the detector leaks a frame into it.
      const mid = Math.floor(values.length / 2);
      const level = mora.kana === 'っ' || values.length < 2 ? null
        : values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
      chunk.morae.push({ ...mora, pitch: level });
    }
  }
  return chunks;
}

/** Separate raw runs at every unvoiced frame; never draw through a silence. */
export function nativePitchRuns(pitch: PitchAnalysisPayload, start: number, end: number) {
  const runs: { time: number; pitch: number }[][] = [];
  let run: { time: number; pitch: number }[] = [];
  for (const frame of pitch.frames) {
    if (frame.timeSeconds < start || frame.timeSeconds > end) continue;
    if (!frame.voiced || frame.relativeSemitones === null || !Number.isFinite(frame.relativeSemitones)) {
      run = [];
      continue;
    }
    if (!run.length) runs.push(run);
    run.push({ time: frame.timeSeconds, pitch: frame.relativeSemitones });
  }
  return runs;
}
