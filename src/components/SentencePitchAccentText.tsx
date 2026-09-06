import { useMemo } from 'react';

import type { MoraPitchClass } from '../lib/pitchAccentShape';
import {
  buildSentencePitchAccents,
  type SentencePitchAccentTarget,
  type SentenceWordAccent,
} from '../lib/sentencePitchAccent';
import { PitchAccentWordMarks } from './PitchAccentWordMarks';

/**
 * The whole sentence with each accent-bearing word's kana + H/L marks
 * stacked directly beneath it — as opposed to the compact
 * `SentencePitchAccentRow`, which lifts the marked words out into a
 * separate strip below the sentence. Reading the line and checking the
 * accent then happen in one downward glance (pitch-accent drill page).
 *
 * Words with dictionary accent data render as a column (surface form on
 * the sentence line, mora kana + dictionary H/L — and the learner's
 * measured H/L when `learnerClassesBySurface` is supplied — below);
 * particles, punctuation and dataless words stay inline as plain text.
 * Word positions come from `buildSentencePitchAccents` (first unclaimed
 * `indexOf` of the surface form); a word that can't be located, or that
 * overlaps one already placed, falls back to plain text.
 */
type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'word'; word: SentenceWordAccent };

export function SentencePitchAccentText({
  japanese,
  targets,
  learnerClassesBySurface,
}: {
  japanese: string;
  targets: SentencePitchAccentTarget[];
  learnerClassesBySurface?: Map<string, MoraPitchClass[]>;
}) {
  const segments = useMemo<Segment[]>(() => {
    const words = buildSentencePitchAccents(japanese, targets)
      .filter((word) => word.start >= 0)
      .sort((a, b) => a.start - b.start);

    const parts: Segment[] = [];
    let cursor = 0;
    for (const word of words) {
      if (word.start < cursor) continue; // overlaps a word already placed
      if (word.start > cursor) parts.push({ kind: 'text', text: japanese.slice(cursor, word.start) });
      parts.push({ kind: 'word', word });
      cursor = word.start + word.surfaceForm.length;
    }
    if (cursor < japanese.length) parts.push({ kind: 'text', text: japanese.slice(cursor) });
    return parts;
  }, [japanese, targets]);

  const showLearner = !!learnerClassesBySurface;

  return (
    <div
      className="pa-text jp jp-lg"
      aria-label={
        showLearner
          ? 'Sentence with pitch accent (top line = dictionary, bottom line = your recording; H = high mora, L = low mora)'
          : 'Sentence with pitch accent (H = high mora, L = low mora)'
      }
    >
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <span key={index} className="pa-text-plain">
            {segment.text}
          </span>
        ) : (
          <span
            key={index}
            className="pa-text-word"
            title={`${segment.word.surfaceForm} — ${segment.word.pattern}`}
          >
            <span className="pa-text-kanji">{segment.word.surfaceForm}</span>
            <span className="pa-row pa-text-marks">
              <span className="pa-word">
                <PitchAccentWordMarks
                  word={segment.word}
                  learnerClasses={learnerClassesBySurface?.get(segment.word.surfaceForm)}
                  showLearner={showLearner}
                />
              </span>
            </span>
          </span>
        ),
      )}
    </div>
  );
}
