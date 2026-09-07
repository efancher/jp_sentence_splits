import type { MoraPitchClass } from '../lib/pitchAccentShape';
import type { SentenceWordAccent } from '../lib/sentencePitchAccent';

/**
 * The stacked per-mora marks for one accent-bearing word — kana, the
 * dictionary H/L, and (when `showLearner`) the learner's own measured H/L
 * as a second line. When `word.particleTail` is non-empty the trailing
 * marks are the actual attached particle kana (each at the `particleHigh`
 * level); otherwise a single abstract `·` mora still shows what a
 * following particle would do. Shared by the compact
 * `SentencePitchAccentRow` and the inline `SentencePitchAccentText`; each
 * supplies its own outer `.pa-word` wrapper (they differ on highlight /
 * heading).
 *
 * `learnerClasses` is the learner's measured shape for this word (same
 * mora segmentation as `word.morae`); a mora the estimate couldn't reach
 * shows `·`, and one that disagrees with the dictionary is flagged.
 * `learnerFollowingClass` is the learner's measured level on the attached
 * particle (`word.particleTail`) — the odaka/heiban cue — shown under the
 * dictionary particle mark; `·` when it wasn't measured.
 */
export function PitchAccentWordMarks({
  word,
  learnerClasses,
  learnerFollowingClass,
  showLearner = false,
}: {
  word: SentenceWordAccent;
  learnerClasses?: MoraPitchClass[];
  learnerFollowingClass?: MoraPitchClass;
  showLearner?: boolean;
}) {
  const dictParticleClass: MoraPitchClass = word.particleHigh ? 'h' : 'l';
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
      {word.particleTail.length > 0 ? (
        word.particleTail.map((kana, tailIndex) => (
          <span key={`tail-${tailIndex}`} className="pa-mora pa-particle">
            <span className="pa-kana jp">{kana}</span>
            <span className="pa-hl" data-c={dictParticleClass}>
              {dictParticleClass === 'h' ? 'H' : 'L'}
            </span>
            {showLearner ? (
              <span
                className="pa-hl pa-hl-learner"
                data-c={learnerFollowingClass}
                data-mismatch={
                  learnerFollowingClass && learnerFollowingClass !== dictParticleClass
                    ? ''
                    : undefined
                }
                title={
                  learnerFollowingClass
                    ? learnerFollowingClass === dictParticleClass
                      ? 'Your recording matches here'
                      : 'Your recording differs here'
                    : 'Not enough voiced signal to estimate the particle'
                }
              >
                {learnerFollowingClass ? (learnerFollowingClass === 'h' ? 'H' : 'L') : '·'}
              </span>
            ) : null}
          </span>
        ))
      ) : (
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
      )}
    </>
  );
}
