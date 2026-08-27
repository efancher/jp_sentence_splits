import { useEffect, useMemo, useRef, useState } from 'react';

import { getReferenceAlignment, saveReferenceAlignment } from '../db/repository';
import type { SentenceAudio, TargetVocabulary, VocabularySuggestion } from '../domain/types';
import { useNativeAudio } from '../hooks/useNativeAudio';
import { loadOrComputeAlignment } from '../lib/alignmentCache';

export type SentenceToken = {
  text: string;
  /** Character offsets into the sentence this token was sliced from. */
  start: number;
  end: number;
  gloss?: string;
};

type TimedWord = { start: number; end: number; text: string };

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
 * Best-effort character offset in `japanese` for each forced-alignment
 * word, so playback position (which the aligner reports in seconds against
 * its *own*, dictionary-normalized transcript) can be mapped back onto the
 * real sentence's tokens. Both lists run left-to-right over the same
 * utterance, so a forward `indexOf` from a running cursor resyncs after any
 * mis-segmentation; `<unk>`/`<eps>` (audio the aligner couldn't place) map
 * to -1 and just don't drive a highlight.
 */
export function alignmentCharPositions(japanese: string, words: TimedWord[]): number[] {
  const positions: number[] = [];
  let cursor = 0;
  for (const word of words) {
    if (!word.text || word.text === '<unk>' || word.text === '<eps>') {
      positions.push(-1);
      continue;
    }
    const found = japanese.indexOf(word.text, cursor);
    if (found >= 0 && found <= cursor + 8) {
      positions.push(found);
      cursor = found + word.text.length;
    } else {
      positions.push(Math.min(cursor, Math.max(0, japanese.length - 1)));
      cursor = Math.min(japanese.length, cursor + word.text.length);
    }
  }
  return positions;
}

function tokenIndexForChar(tokens: SentenceToken[], char: number): number {
  if (char < 0) return -1;
  return tokens.findIndex((token) => char >= token.start && char < token.end);
}

/**
 * The revealed sentence on the listening card (Phase 7.4), shown as the
 * real sentence text — not the forced-alignment transcript, which is
 * dictionary-normalized and can diverge (kanji where the audio was kana,
 * literal `<unk>` where it couldn't be placed). The sentence is tokenized
 * from `vocabularySuggestions` (see `buildSentenceTokens`); while the audio
 * plays, a `requestAnimationFrame` loop highlights whichever token the
 * playhead currently sits in, mapped through the aligner's word timings
 * (`alignmentCharPositions`), and a small popup shows that token's English
 * gloss. Falls back to plain, static text whenever alignment isn't cached
 * and the tailnet-only alignment service is unreachable — it's a reading
 * aid, not the source of truth. A smaller kana line underneath
 * (`sentence.readingOnly`) is the actual pronunciation guide, kept separate
 * so the kanji sentence line isn't mistaken for it.
 */
export function KaraokeSentenceText({
  audio,
  japanese,
  readingOnly,
  vocabularySuggestions,
  targetVocabulary,
}: {
  audio: SentenceAudio;
  japanese: string;
  readingOnly?: string;
  vocabularySuggestions: VocabularySuggestion[];
  targetVocabulary?: TargetVocabulary[];
}) {
  const native = useNativeAudio();
  const [alignmentWords, setAlignmentWords] = useState<TimedWord[]>([]);
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [glossPopup, setGlossPopup] = useState<{ text: string; left: number; top: number } | null>(
    null,
  );

  const tokens = useMemo(
    () => buildSentenceTokens(japanese, vocabularySuggestions, targetVocabulary ?? []),
    [japanese, vocabularySuggestions, targetVocabulary],
  );
  const charPositions = useMemo(
    () => alignmentCharPositions(japanese, alignmentWords),
    [japanese, alignmentWords],
  );

  useEffect(() => {
    let cancelled = false;
    setAlignmentWords([]);
    void loadOrComputeAlignment(
      audio.id,
      audio.blob,
      japanese,
      getReferenceAlignment,
      saveReferenceAlignment,
    ).then((result) => {
      if (cancelled || !result) return;
      setAlignmentWords(
        result.words
          .filter((word) => word.text && word.text !== '<eps>')
          .map((word) => ({ start: word.start, end: word.end, text: word.text })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [audio.id, audio.blob, japanese]);

  const active = native.isPlaying && native.activeItemId === audio.id;

  useEffect(() => {
    if (!active || alignmentWords.length === 0) {
      setActiveWordIndex(-1);
      return;
    }
    let frame: number;
    const tick = () => {
      const t = native.getCurrentTime();
      const index = alignmentWords.findIndex((word) => t >= word.start && t < word.end);
      setActiveWordIndex((prev) => (prev === index ? prev : index));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, alignmentWords, native.getCurrentTime]);

  const activeTokenIndex =
    activeWordIndex >= 0 ? tokenIndexForChar(tokens, charPositions[activeWordIndex] ?? -1) : -1;

  useEffect(() => {
    const token = tokens[activeTokenIndex];
    const el = wordRefs.current[activeTokenIndex];
    if (!token?.gloss || !el) {
      setGlossPopup(null);
      return;
    }
    setGlossPopup({ text: token.gloss, left: el.offsetLeft, top: el.offsetTop + el.offsetHeight + 4 });
  }, [activeTokenIndex, tokens]);

  return (
    <div className="stack" style={{ gap: '0.25rem' }}>
      <div className="jp jp-lg karaoke-line">
        {tokens.map((token, index) => (
          <span
            key={`${token.start}-${index}`}
            ref={(el) => {
              wordRefs.current[index] = el;
            }}
            className={`karaoke-word${index === activeTokenIndex ? ' karaoke-word-active' : ''}`}
          >
            {token.text}
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
