/**
 * Planning half of scripts/restore-kanji-sentences.ts: apply explicit
 * kana -> kanji substitutions to a sentence and remap the character offsets
 * (`sentence_grammar.start_index/end_index`) that were keyed to the old
 * string. Pure so it can be tested without credentials.
 */

export type Edit = readonly [from: string, to: string];

export interface Region {
  /** Half-open range in the ORIGINAL string. */
  start: number;
  end: number;
  replacement: string;
}

export interface RestorePlan {
  text: string;
  regions: Region[];
}

/** Each `from` must occur exactly once in `original` and not overlap another. */
export function planEdits(original: string, edits: readonly Edit[]): RestorePlan {
  const regions: Region[] = edits.map(([from, to]) => {
    const first = original.indexOf(from);
    if (from === '' || first < 0) throw new Error(`"${from}" not found in "${original}"`);
    if (original.indexOf(from, first + 1) >= 0) {
      throw new Error(`"${from}" occurs more than once in "${original}"`);
    }
    return { start: first, end: first + from.length, replacement: to };
  });
  regions.sort((a, b) => a.start - b.start);
  for (let i = 1; i < regions.length; i += 1) {
    if (regions[i]!.start < regions[i - 1]!.end) throw new Error(`overlapping edits in "${original}"`);
  }
  let text = '';
  let cursor = 0;
  for (const region of regions) {
    text += original.slice(cursor, region.start) + region.replacement;
    cursor = region.end;
  }
  text += original.slice(cursor);
  return { text, regions };
}

/** Maps an offset in the original string to the edited one. An offset strictly
 *  inside a replaced region has no meaningful image and throws. */
export function mapOffset(regions: readonly Region[], offset: number): number {
  let delta = 0;
  for (const region of regions) {
    if (offset > region.start && offset < region.end) {
      throw new Error(`offset ${offset} falls inside replaced range ${region.start}-${region.end}`);
    }
    if (region.end <= offset) delta += region.replacement.length - (region.end - region.start);
  }
  return offset + delta;
}
