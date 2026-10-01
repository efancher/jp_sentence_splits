import { parseInlineReadings, type RubySegment } from './parseInlineReadings';

export interface PositionedSegment extends RubySegment {
  start: number;
  end: number;
}

interface WordSpan {
  start: number;
  end: number;
  expression: string;
}

/**
 * Inline-reading segments positioned in `japanese`, with the ruby dropped for
 * any word the learner already knows. Returns null when the inline reading
 * doesn't line up with the sentence text, so callers can fall back to plain.
 */
export function newWordSegments(
  japanese: string,
  inlineReading: string | undefined,
  spans: WordSpan[],
  knownExpressions: ReadonlySet<string>,
): PositionedSegment[] | null {
  if (!inlineReading) return null;
  const parsed = parseInlineReadings(inlineReading);
  if (parsed.map((segment) => segment.base).join('') !== japanese) return null;
  const known = spans.filter((span) => knownExpressions.has(span.expression));
  let cursor = 0;
  return parsed.map((segment) => {
    const start = cursor;
    cursor += segment.base.length;
    const isKnown = known.some((span) => start >= span.start && cursor <= span.end);
    return {
      kind: segment.kind === 'ruby' && isKnown ? 'text' : segment.kind,
      base: segment.base,
      reading: segment.reading,
      start,
      end: cursor,
    };
  });
}

/** The part of `segments` inside [start, end); a ruby segment belongs to the range holding its first character. */
export function segmentsInRange(segments: PositionedSegment[], start: number, end: number): PositionedSegment[] {
  const out: PositionedSegment[] = [];
  for (const segment of segments) {
    if (segment.end <= start || segment.start >= end) continue;
    if (segment.kind === 'ruby') {
      if (segment.start >= start) out.push(segment);
      continue;
    }
    const from = Math.max(start, segment.start);
    const to = Math.min(end, segment.end);
    out.push({ ...segment, base: segment.base.slice(from - segment.start, to - segment.start), start: from, end: to });
  }
  return out;
}
