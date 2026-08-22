import { useEffect, useRef, useState } from 'react';

import { getReferenceAlignment, saveReferenceAlignment } from '../db/repository';
import type { SentenceAudio, TargetVocabulary, VocabularySuggestion } from '../domain/types';
import { useNativeAudio } from '../hooks/useNativeAudio';
import { loadOrComputeAlignment } from '../lib/alignmentCache';

type AlignedWord = { text: string; start: number; end: number; gloss?: string };

/**
 * Attaches an English gloss to each aligner word by walking both lists in
 * reading order and matching surface text. The aligner and the morphology
 * tokenizer (source of `vocabularySuggestions`) are independent, so their
 * tokens don't line up index-for-index — one may split/merge what the other
 * treats as a single word — but both proceed left-to-right over the same
 * sentence, so a small lookahead window is enough to resync without ever
 * matching backwards. Words with no exact match (most function words, since
 * the offline backfill only glosses content words, or a genuine mismatch)
 * simply get no popup.
 *
 * `vocabularySuggestions.english` is only populated when the offline JMDict
 * backfill found an unambiguous match — a word written in kana whose lemma
 * has several equally-common kanji homophones (e.g. たつ: 経つ "to pass",
 * 立つ "to stand", 絶つ "to sever"...) is deliberately left unglossed there
 * rather than guessing. `targetVocabulary` (the curated chips shown below,
 * from linked source decks) already resolved that ambiguity for this
 * specific sentence, so it's consulted as a fallback, matched by dictionary
 * reading rather than surface text — the surface here is still the bare
 * conjugated kana (e.g. "たっ"), which can't be substring-matched against a
 * kanji expression like "経つ".
 */
export function attachGlosses(
  words: { text: string; start: number; end: number }[],
  suggestions: VocabularySuggestion[],
  targetVocabulary: TargetVocabulary[] = [],
): AlignedWord[] {
  const LOOKAHEAD = 4;
  const englishByReading = new Map(
    targetVocabulary.filter((item) => item.english).map((item) => [item.reading, item.english]),
  );
  let cursor = 0;
  return words.map((word) => {
    const limit = Math.min(suggestions.length, cursor + LOOKAHEAD);
    for (let i = cursor; i < limit; i++) {
      const suggestion = suggestions[i]!;
      if (suggestion.surface === word.text) {
        cursor = i + 1;
        const gloss = suggestion.english || englishByReading.get(suggestion.reading);
        return { ...word, gloss };
      }
    }
    return word;
  });
}

/**
 * Word-synced highlighting for a revealed sentence, computed lazily from the
 * tailnet-only forced-alignment service and cached via
 * getReferenceAlignment/saveReferenceAlignment (same cache as the shadowing
 * analysis flow) — the first review of a sentence pays the alignment cost,
 * every later one reuses it. Falls back to plain, unhighlighted text
 * whenever alignment isn't available (server unreachable/cold, or not
 * finished loading yet), since it's just a reading aid, not the source of
 * truth for the sentence's text.
 *
 * The aligner occasionally can't match a stretch of audio to its dictionary
 * and emits a literal `<unk>` token in that word's place — rendering it
 * as-is reads as garbled Japanese (e.g. "<unk>容思い出して"), so it's shown
 * as a flagged placeholder instead. Since the karaoke line is therefore
 * *derived* text and can diverge from the real sentence (this way or more
 * subtly — dictionary-normalized spellings, mis-segmented words), the
 * actual sentence text is always shown underneath too, so the learner can
 * cross-check rather than trust the aligner's transcript. A third, smaller
 * line shows the precomputed all-kana reading (`sentence.readingOnly`) when
 * present, purely as a mapping aid from audio to kana — it's optional
 * because not every sentence has one populated.
 *
 * While a word is highlighted, a small popup shows its English gloss (from
 * `vocabularySuggestions`, the same offline-backfilled glosses the
 * vocabulary picker uses) positioned under that word via its DOM offset
 * within the relatively-positioned word row — simpler and more reliable
 * than tracking viewport/scroll position, and correct even as the line
 * wraps. Only content words that were tokenized and glossed get a popup;
 * particles and anything the aligner couldn't match to a suggestion get
 * none.
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
  const [alignmentWords, setAlignmentWords] = useState<AlignedWord[]>([]);
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [glossPopup, setGlossPopup] = useState<{ text: string; left: number; top: number } | null>(
    null,
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
        attachGlosses(
          result.words.filter((word) => word.text && word.text !== '<eps>'),
          vocabularySuggestions,
          targetVocabulary,
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [audio.id, audio.blob, japanese, vocabularySuggestions, targetVocabulary]);

  const active = native.isPlaying && native.activeItemId === audio.id;

  useEffect(() => {
    if (!active || alignmentWords.length === 0) {
      setActiveWordIndex(-1);
      return;
    }
    let frame: number;
    const tick = () => {
      const t = native.getCurrentTime();
      const index = alignmentWords.findIndex(
        (word) => t >= word.start && t < word.end,
      );
      setActiveWordIndex((prev) => (prev === index ? prev : index));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, alignmentWords, native.getCurrentTime]);

  useEffect(() => {
    const word = alignmentWords[activeWordIndex];
    const el = wordRefs.current[activeWordIndex];
    if (!word?.gloss || !el) {
      setGlossPopup(null);
      return;
    }
    setGlossPopup({ text: word.gloss, left: el.offsetLeft, top: el.offsetTop + el.offsetHeight + 4 });
  }, [activeWordIndex, alignmentWords]);

  if (alignmentWords.length === 0) {
    return (
      <div className="stack" style={{ gap: '0.25rem' }}>
        <div className="jp jp-lg">{japanese}</div>
        {readingOnly && <div className="jp muted jp-sm">{readingOnly}</div>}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: '0.25rem' }}>
      <div className="jp jp-lg karaoke-line">
        {alignmentWords.map((word, index) => {
          const isUnknown = word.text === '<unk>';
          return (
            <span
              key={`${word.text}-${index}`}
              ref={(el) => {
                wordRefs.current[index] = el;
              }}
              className={`karaoke-word${index === activeWordIndex ? ' karaoke-word-active' : ''}${isUnknown ? ' karaoke-word-unknown' : ''}`}
              title={isUnknown ? 'Not recognized by the alignment service' : undefined}
            >
              {isUnknown ? '?' : word.text}
            </span>
          );
        })}
        {glossPopup && (
          <div
            className="karaoke-gloss"
            style={{ left: glossPopup.left, top: glossPopup.top }}
          >
            {glossPopup.text}
          </div>
        )}
      </div>
      <div className="jp muted">{japanese}</div>
      {readingOnly && <div className="jp muted jp-sm">{readingOnly}</div>}
    </div>
  );
}
