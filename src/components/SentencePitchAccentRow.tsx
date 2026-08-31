import { useEffect, useMemo, useState } from 'react';

import { getVocabularyTargetCandidates } from '../db/repository';
import {
  buildSentencePitchAccents,
  type SentencePitchAccentTarget,
} from '../lib/sentencePitchAccent';

/**
 * "H's and L's under the kana" — a compact per-word pitch-accent contour
 * for the words in a sentence that carry dictionary accent data, shown on
 * the shadowing panels (`SyncedShadowText`), the post-recording
 * `AnalysisPanel`, and the `pitch_accent` review card reveal.
 *
 * Per-word, not a joined sentence contour — see `sentencePitchAccent.ts`
 * for why. Words with no Kanjium/UniDic data (many particles, unparsed
 * runs, ~79 still-blank vocab items) are simply absent; the component
 * renders nothing at all when the sentence has no accented words.
 *
 * Pass `targets` when the caller already has them (AnalysisPanel loads the
 * same list for scoring); otherwise pass `sentenceId` and the row loads
 * its own from the confirmed `sentence_vocabulary` links.
 */
export function SentencePitchAccentRow({
  japanese,
  targets,
  sentenceId,
  highlightSurfaceForm,
}: {
  japanese: string;
  targets?: SentencePitchAccentTarget[];
  sentenceId?: string;
  highlightSurfaceForm?: string;
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

  return (
    <div className="pa-row" aria-label="Pitch accent (H = high mora, L = low mora)">
      {words.map((word, index) => (
        <span
          key={`${word.surfaceForm}-${word.start}-${index}`}
          className="pa-word"
          data-highlight={highlightSurfaceForm === word.surfaceForm ? '' : undefined}
          title={`${word.surfaceForm} — ${word.pattern}`}
        >
          {word.morae.map((mora, moraIndex) => (
            <span key={moraIndex} className="pa-mora">
              <span className="pa-kana jp">{mora}</span>
              <span className="pa-hl" data-c={word.classes[moraIndex]}>
                {word.classes[moraIndex] === 'h' ? 'H' : 'L'}
              </span>
            </span>
          ))}
          <span className="pa-mora pa-particle">
            <span className="pa-kana" aria-hidden="true">
              ·
            </span>
            <span className="pa-hl" data-c={word.particleHigh ? 'h' : 'l'}>
              {word.particleHigh ? 'H' : 'L'}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}
