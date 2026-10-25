import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import type { TargetVocabulary, VocabularySuggestion } from '../domain/types';
import { segmentsInRange, type PositionedSegment } from '../lib/newWordFurigana';

export type SentenceToken = {
  text: string;
  /** Character offsets into the sentence this token was sliced from. */
  start: number;
  end: number;
  gloss?: string;
};

/**
 * Splits a sentence into display tokens straight from its
 * `vocabularySuggestions` — which carry exact `start`/`end` character
 * offsets into the sentence Japanese (`VocabularySelection.surface`'s
 * `validateSpan` guarantees `japanese.slice(start, end) === surface` at
 * creation), so no fuzzy string matching is involved and every content
 * morpheme lines up. Gaps between suggestions (and the whole sentence when
 * there are no suggestions at all — older imports) become plain, ungloissed
 * runs.
 *
 * Each token's gloss is the suggestion's own `english` (populated by the
 * offline JMDict backfill when it found an unambiguous match) or, failing
 * that, a `targetVocabulary` entry matched by the suggestion's dictionary
 * `expression` or `reading` — the curated deck chips already resolved the
 * homophone ambiguity the backfill declines to guess at (e.g. たつ:
 * 経つ/立つ/絶つ). Matching by `expression` (the lemma the suggestion
 * carries) rather than surface text is what lets a conjugated word like
 * 終わってる still pick up 終わる's gloss.
 */
export function buildSentenceTokens(
  japanese: string,
  suggestions: VocabularySuggestion[],
  targetVocabulary: TargetVocabulary[] = [],
): SentenceToken[] {
  const englishByKey = new Map<string, string>();
  for (const item of targetVocabulary) {
    if (!item.english) continue;
    for (const key of [item.expression, item.reading]) {
      if (key && !englishByKey.has(key)) englishByKey.set(key, item.english);
    }
  }

  const spans = suggestions
    .filter((s) => s.end > s.start && s.start >= 0 && s.end <= japanese.length)
    .slice()
    .sort((a, b) => a.start - b.start);

  const tokens: SentenceToken[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue; // overlapping/duplicate suggestion
    if (span.start > cursor) {
      tokens.push({ text: japanese.slice(cursor, span.start), start: cursor, end: span.start });
    }
    tokens.push({
      text: japanese.slice(span.start, span.end),
      start: span.start,
      end: span.end,
      gloss:
        span.english ||
        englishByKey.get(span.expression) ||
        englishByKey.get(span.reading) ||
        undefined,
    });
    cursor = span.end;
  }
  if (cursor < japanese.length) {
    tokens.push({ text: japanese.slice(cursor), start: cursor, end: japanese.length });
  }
  if (tokens.length === 0) {
    tokens.push({ text: japanese, start: 0, end: japanese.length });
  }
  return tokens;
}

/**
 * The sentence as real text (not the forced-alignment transcript), tokenized
 * from `vocabularySuggestions` (see `buildSentenceTokens`). Tapping a glossed
 * token pins a small popup with its English gloss. Playback-synced word
 * highlighting was removed (inaccurate, and it shifted the layout). A smaller
 * kana line underneath (`sentence.readingOnly`) is the actual pronunciation
 * guide, kept separate so the kanji sentence line isn't mistaken for it.
 */
export function KaraokeSentenceText({
  japanese,
  readingOnly,
  vocabularySuggestions,
  targetVocabulary,
  rubySegments,
}: {
  japanese: string;
  readingOnly?: string;
  vocabularySuggestions: VocabularySuggestion[];
  targetVocabulary?: TargetVocabulary[];
  /** Furigana to draw over the tokens (e.g. only the words not yet learned). */
  rubySegments?: PositionedSegment[];
}) {
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [glossPopup, setGlossPopup] = useState<{ text: string; left: number; top: number } | null>(
    null,
  );
  /** Tap-pinned token, lets a learner check a word's gloss. */
  const [tappedTokenIndex, setTappedTokenIndex] = useState<number | null>(null);

  const tokens = useMemo(
    () => buildSentenceTokens(japanese, vocabularySuggestions, targetVocabulary ?? []),
    [japanese, vocabularySuggestions, targetVocabulary],
  );
  // Reset any tapped word when the sentence itself changes underneath us.
  useEffect(() => {
    setTappedTokenIndex(null);
  }, [tokens]);

  const displayedTokenIndex = tappedTokenIndex ?? -1;

  useEffect(() => {
    const token = tokens[displayedTokenIndex];
    const el = wordRefs.current[displayedTokenIndex];
    if (!token?.gloss || !el) {
      setGlossPopup(null);
      return;
    }
    setGlossPopup({ text: token.gloss, left: el.offsetLeft, top: el.offsetTop + el.offsetHeight + 4 });
  }, [displayedTokenIndex, tokens]);

  return (
    <div className="stack" style={{ gap: '0.25rem' }}>
      <div className="jp jp-lg karaoke-line">
        {tokens.map((token, index) => (
          <span
            key={`${token.start}-${index}`}
            ref={(el) => {
              wordRefs.current[index] = el;
            }}
            className={`karaoke-word${index === displayedTokenIndex ? ' karaoke-word-active' : ''}${token.gloss ? ' karaoke-word-tappable' : ''}`}
            {...(token.gloss
              ? {
                  role: 'button',
                  tabIndex: 0,
                  onClick: () =>
                    setTappedTokenIndex((prev) => (prev === index ? null : index)),
                  onKeyDown: (event: KeyboardEvent) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    setTappedTokenIndex((prev) => (prev === index ? null : index));
                  },
                }
              : {})}
          >
            {rubySegments
              ? segmentsInRange(rubySegments, token.start, token.end).map((segment, segmentIndex) =>
                  segment.kind === 'ruby' && segment.reading ? (
                    <ruby key={segmentIndex}>
                      {segment.base}
                      <rp>(</rp>
                      <rt>{segment.reading}</rt>
                      <rp>)</rp>
                    </ruby>
                  ) : (
                    <span key={segmentIndex}>{segment.base}</span>
                  ),
                )
              : token.text}
          </span>
        ))}
        {glossPopup && (
          <div className="karaoke-gloss" style={{ left: glossPopup.left, top: glossPopup.top }}>
            {glossPopup.text}
          </div>
        )}
      </div>
      {readingOnly && <div className="jp muted jp-sm">{readingOnly}</div>}
    </div>
  );
}
