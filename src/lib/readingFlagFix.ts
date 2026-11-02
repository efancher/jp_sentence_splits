import { parseInlineReadings } from './parseInlineReadings';
import { applyReadingFixes, inlineKana, isCompoundSoundChange, type SpanReadings } from './readingConsensus';

export interface ReadingFlag {
  base: string;
  furigana: string;
  assistant: string;
  /** The aligned audio also disagreed; such flags are never auto-fixed. */
  hasAudio: boolean;
}

/** Parse a note written by `checkSentenceReading`: "Reading check — 頃: furigana ころ, assistant ごろ". */
export function parseReadingFlagNote(note: string): ReadingFlag | null {
  const match = /^Reading check — (.+?): furigana (\S+?), (.*)$/.exec(note.trim());
  if (!match) return null;
  const heard = match[3]!;
  const assistant = /assistant (\S+)$/.exec(heard)?.[1];
  if (!assistant) return null;
  return { base: match[1]!, furigana: match[2]!, assistant, hasAudio: /\baudio\b/.test(heard) };
}

const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}々]/u.test(char);

export interface ReadingFlagFix {
  inlineReading: string;
  /** Set only when `readingOnly` was the plain kana of the old furigana. */
  readingOnly?: string;
}

/**
 * Apply a stored flag to a sentence when it is a compound sound change (the
 * same rule `checkSentenceReading` now applies at import). Every ruby span
 * matching the flag's base and furigana is corrected. Returns null when the
 * flag isn't one, nothing matches (already fixed, or the sentence changed),
 * or the markup can't be rebuilt exactly. `force` skips the sound-change
 * test, for a learner who listened and chose the assistant's reading.
 */
export function applyReadingFlagFix(
  sentence: { inlineReading?: string | null; readingOnly?: string | null },
  flag: ReadingFlag,
  options: { force?: boolean } = {},
): ReadingFlagFix | null {
  const inline = sentence.inlineReading;
  if (!inline || (flag.hasAudio && !options.force)) return null;
  const segments = parseInlineReadings(inline);
  const fixes: SpanReadings = new Map();
  segments.forEach((seg, index) => {
    if (seg.kind !== 'ruby' || seg.base !== flag.base || seg.reading !== flag.furigana) return;
    const near = {
      before: isWordChar(Array.from(segments[index - 1]?.base ?? '').pop()),
      after: isWordChar(Array.from(segments[index + 1]?.base ?? '')[0]),
    };
    if (options.force || isCompoundSoundChange(flag.furigana, flag.assistant, near)) fixes.set(index, flag.assistant);
  });
  if (fixes.size === 0) return null;
  const rewritten = applyReadingFixes(inline, fixes);
  if (!rewritten) return null;
  const oldKana = inlineKana(inline).kana.replace(/\s+/g, '');
  const readingOnlyMatches = (sentence.readingOnly ?? '').replace(/\s+/g, '') === oldKana;
  return {
    inlineReading: rewritten,
    ...(readingOnlyMatches ? { readingOnly: inlineKana(rewritten).kana } : {}),
  };
}
