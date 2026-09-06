import type { MoraPitchClass } from '../lib/pitchAccentShape';
import type { SentenceWordAccent } from '../lib/sentencePitchAccent';

/**
 * The stacked per-mora marks for one accent-bearing word — an
 * OJAD/NHK-style overline contour drawn on the kana row (a bar over every
 * high mora, a vertical tick at the downstep), the dictionary H/L letters,
 * and (when `showLearner`) the learner's own measured H/L as a second line
 * with its own overline. When `word.particleTail` is non-empty the trailing
 * marks are the actual attached particle kana (each at the `particleHigh`
 * level); otherwise a single abstract `·` mora still shows what a following
 * particle would do. Shared by the compact `SentencePitchAccentRow` and the
 * inline `SentencePitchAccentText`; each supplies its own outer `.pa-word`
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
  const particleLevel: MoraPitchClass = word.particleHigh ? 'h' : 'l';
  // One trailing column per attached particle kana, or a single abstract dot
  // when nothing attaches — either way it carries the following-particle
  // level so heiban reads apart from odaka.
  const particleKana = word.particleTail.length > 0 ? word.particleTail : ['·'];

  // The dictionary H/L across morae *and* the trailing particle column(s),
  // so the overline's downstep tick can land on the last high mora even
  // when the fall is only audible on a following particle (odaka).
  const dictSeq: MoraPitchClass[] = [
    ...word.classes,
    ...particleKana.map(() => particleLevel),
  ];
  const dictFallAt = (index: number) =>
    dictSeq[index] === 'h' && dictSeq[index + 1] === 'l';
  const learnerFallAt = (index: number) =>
    !!learnerClasses && learnerClasses[index] === 'h' && learnerClasses[index + 1] === 'l';

  return (
    <>
      {word.morae.map((mora, moraIndex) => {
        const dictClass = word.classes[moraIndex]!;
        const learnerClass = learnerClasses?.[moraIndex];
        return (
          <span
            key={moraIndex}
            className="pa-mora"
            data-pa={dictClass}
            data-fall={dictFallAt(moraIndex) ? '' : undefined}
          >
            <span className="pa-kana jp">{mora}</span>
            <span className="pa-hl" data-c={dictClass}>
              {dictClass === 'h' ? 'H' : 'L'}
            </span>
            {showLearner ? (
              <span
                className="pa-hl pa-hl-learner"
                data-c={learnerClass}
                data-lpa={learnerClass}
                data-lfall={learnerFallAt(moraIndex) ? '' : undefined}
                data-mismatch={
                  learnerClass && learnerClass !== dictClass ? '' : undefined
                }
                title={
                  learnerClass
                    ? learnerClass === dictClass
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
      {particleKana.map((kana, tailIndex) => {
        const seqIndex = word.morae.length + tailIndex;
        const abstract = kana === '·';
        return (
          <span
            key={`tail-${tailIndex}`}
            className="pa-mora pa-particle"
            data-pa={particleLevel}
            data-fall={dictFallAt(seqIndex) ? '' : undefined}
          >
            <span className={abstract ? 'pa-kana' : 'pa-kana jp'} aria-hidden={abstract || undefined}>
              {kana}
            </span>
            <span className="pa-hl" data-c={particleLevel}>
              {particleLevel === 'h' ? 'H' : 'L'}
            </span>
            {showLearner ? (
              <span className="pa-hl pa-hl-learner" aria-hidden="true">
                ·
              </span>
            ) : null}
          </span>
        );
      })}
    </>
  );
}
