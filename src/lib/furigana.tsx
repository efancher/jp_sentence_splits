import type { ReactNode } from 'react';

import { parseInlineReadings, splitOkurigana } from './parseInlineReadings';

export function FuriganaText({
  text,
  className,
}: {
  text: string;
  className?: string;
}): ReactNode {
  const segments = splitOkurigana(parseInlineReadings(text));
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
