import type { ReactNode } from 'react';

export interface RubySegment {
  kind: 'ruby' | 'text';
  base: string;
  reading?: string;
}

/**
 * Parse Satori-style inline readings: 小鳥[ことり]
 * Falls back to plain text when the syntax cannot be parsed safely.
 */
export function parseInlineReadings(input: string): RubySegment[] {
  const text = input ?? '';
  if (!text.includes('[')) {
    return [{ kind: 'text', base: text }];
  }

  const segments: RubySegment[] = [];
  const pattern = /([^\s\[\]]+?)\[([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', base: text.slice(lastIndex, match.index) });
    }
    segments.push({
      kind: 'ruby',
      base: match[1] ?? '',
      reading: match[2] ?? '',
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', base: text.slice(lastIndex) });
  }

  if (!segments.some((segment) => segment.kind === 'ruby')) {
    return [{ kind: 'text', base: text }];
  }

  return segments;
}

export function FuriganaText({
  text,
  className,
}: {
  text: string;
  className?: string;
}): ReactNode {
  const segments = parseInlineReadings(text);
  return (
    <span className={className} lang="ja">
      {segments.map((segment, index) => {
        if (segment.kind === 'ruby' && segment.reading) {
          return (
            <ruby key={`${segment.base}-${index}`}>
              {segment.base}
              <rp>(</rp>
              <rt>{segment.reading}</rt>
              <rp>)</rp>
            </ruby>
          );
        }
        return <span key={`${segment.base}-${index}`}>{segment.base}</span>;
      })}
    </span>
  );
}
