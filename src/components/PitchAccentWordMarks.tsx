import type { MoraPitchClass } from '../lib/pitchAccentShape';
import type { SentenceWordAccent } from '../lib/sentencePitchAccent';

/**
 * The stacked per-mora marks for one accent-bearing word — kana, the
 * dictionary H/L, and (when `showLearner`) the learner's own measured H/L
 * as a second line — plus the trailing particle-attachment mark. Shared by
 * the compact `SentencePitchAccentRow` and the inline
 * `SentencePitchAccentText`; each supplies its own outer `.pa-word`
 * wrapper (they differ on highlight / heading).
 *
 * `learnerClasses` is the learner's measured shape for this word (same
 * mora segmentation as `word.morae`); a mora the estimate couldn't reach
 * shows `·`, and one that disagrees with the dictionary is flagged.
 */
export function PitchAccentWordMarks({
  word,
  learnerClasses,
  showLearner = false,
}: {
  word: SentenceWordAccent;
  learnerClasses?: MoraPitchClass[];
  showLearner?: boolean;
}) {
  return (
    <>
      {word.morae.map((mora, moraIndex) => {
        const learnerClass = learnerClasses?.[moraIndex];
        return (
          <span key={moraIndex} className="pa-mora">
            <span className="pa-kana jp">{mora}</span>
            <span className="pa-hl" data-c={word.classes[moraIndex]}>
              {word.classes[moraIndex] === 'h' ? 'H' : 'L'}
            </span>
            {showLearner ? (
              <span
                className="pa-hl pa-hl-learner"
                data-c={learnerClass}
                data-mismatch={
                  learnerClass && learnerClass !== word.classes[moraIndex] ? '' : undefined
                }
                title={
                  learnerClass
                    ? learnerClass === word.classes[moraIndex]
                      ? 'Your recording matches here'
                      : 'Your recording differs here'
                    : 'Not enough voiced signal to estimate this mora'
                }
              >
                {learnerClass ? (learnerClass === 'h' ? 'H' : 'L') : '·'}
              </span>
            ) : null}
          </span>
        );
      })}
      <span className="pa-mora pa-particle">
        <span className="pa-kana" aria-hidden="true">
          ·
        </span>
        <span className="pa-hl" data-c={word.particleHigh ? 'h' : 'l'}>
          {word.particleHigh ? 'H' : 'L'}
        </span>
        {showLearner ? (
          <span className="pa-hl pa-hl-learner" aria-hidden="true">
            ·
          </span>
        ) : null}
      </span>
    </>
  );
}
