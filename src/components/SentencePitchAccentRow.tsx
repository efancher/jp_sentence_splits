import { useEffect, useMemo, useState } from 'react';

import { getVocabularyTargetCandidates } from '../db/repository';
import {
  buildSentencePitchAccents,
  type SentencePitchAccentTarget,
} from '../lib/sentencePitchAccent';
import type { MoraPitchClass } from '../lib/pitchAccentShape';
import { PitchAccentWordMarks } from './PitchAccentWordMarks';

/**
 * "H's and L's under the kana" — a compact per-word pitch-accent contour
 * for the words in a sentence that carry dictionary accent data, shown on
 * the shadowing panels (`SyncedShadowText`), the post-recording
 * `AnalysisPanel`, and the `pitch_accent` review card reveal. (The
 * pitch-accent drill page uses `SentencePitchAccentText` instead — the
 * same per-word marks via `PitchAccentWordMarks`, but stacked inline
 * under each word of the full sentence rather than in a separate strip.)
 *
 * Per-word, not a joined sentence contour — see `sentencePitchAccent.ts`
 * for why. Words with no Kanjium/UniDic data (many particles, unparsed
 * runs, ~79 still-blank vocab items) are simply absent; the component
 * renders nothing at all when the sentence has no accented words.
 *
 * Pass `targets` when the caller already has them (AnalysisPanel loads the
 * same list for scoring); otherwise pass `sentenceId` and the row loads
 * its own from the confirmed `sentence_vocabulary` links.
 *
 * `learnerClassesBySurface` (AnalysisPanel) adds a second H/L line per
 * mora — the learner's own measured shape from
 * `buildLearnerPitchAccentShapes` — under the dictionary line, so the two
 * can be compared mark-for-mark. Morae the estimate couldn't reach show a
 * `·`; morae that disagree with the dictionary are flagged.
 */
export function SentencePitchAccentRow({
  japanese,
  targets,
  sentenceId,
  highlightSurfaceForm,
  learnerClassesBySurface,
}: {
  japanese: string;
  targets?: SentencePitchAccentTarget[];
  sentenceId?: string;
  highlightSurfaceForm?: string;
  learnerClassesBySurface?: Map<string, MoraPitchClass[]>;
}) {
  const [loaded, setLoaded] = useState<SentencePitchAccentTarget[] | null>(null);

  useEffect(() => {
    if (targets || !sentenceId) return;
    let active = true;
    void getVocabularyTargetCandidates([sentenceId]).then((candidates) => {
      if (!active) return;
      setLoaded(
        candidates.map((candidate) => ({
          surfaceForm: candidate.surfaceForm,
          reading: candidate.vocabularyItem.reading,
          pitchAccentPositions: candidate.vocabularyItem.pitchAccentPositions,
        })),
      );
    });
    return () => {
      active = false;
    };
  }, [targets, sentenceId]);

  const words = useMemo(
    () => buildSentencePitchAccents(japanese, targets ?? loaded ?? []),
    [japanese, targets, loaded],
  );

  if (words.length === 0) return null;

  const showLearner = !!learnerClassesBySurface;

  return (
    <div
      className="pa-row"
      aria-label={
        showLearner
          ? 'Pitch accent (top line = dictionary, bottom line = your recording; H = high mora, L = low mora)'
          : 'Pitch accent (H = high mora, L = low mora)'
      }
    >
      {words.map((word, index) => {
        const learnerClasses = learnerClassesBySurface?.get(word.surfaceForm);
        return (
          <span
            key={`${word.surfaceForm}-${word.start}-${index}`}
            className="pa-word"
            data-highlight={highlightSurfaceForm === word.surfaceForm ? '' : undefined}
            title={`${word.surfaceForm} — ${word.pattern}`}
          >
            <PitchAccentWordMarks
              word={word}
              learnerClasses={learnerClasses}
              showLearner={showLearner}
            />
          </span>
        );
      })}
    </div>
  );
}
