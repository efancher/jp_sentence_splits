import { expectedPitchShape } from '../lib/pitchAccentShape';

/**
 * One pitch-accent contour choice, drawn in the NHK / OJAD textbook
 * convention: an overline sits above every high mora and ends in a
 * downward stroke at the downstep, so each button reads as a single whole
 * contour (a word falls once at most) rather than a list of events. A
 * trailing dot is the following particle — high only for heiban, which is
 * what separates it from odaka (identical within the word itself). Shape
 * comes straight from `expectedPitchShape`, the same function the grader
 * and `PitchAccentDiagram` use.
 *
 * Shared by the `pitch_accent` SRS card (`ReviewPage`) and the
 * pitch-accent drill's "predict the drop" step (`PitchAccentDrillPage`).
 */
export function PitchChoiceContour({ morae, position }: { morae: string[]; position: number }) {
  const shape = expectedPitchShape(morae.length, position);
  const particleHigh = position === 0;
  return (
    <span className="pa-choice jp" aria-hidden="true">
      {morae.map((mora, index) => {
        const high = shape[index] === 'h';
        const fallsAfter =
          high && (shape[index + 1] === 'l' || (index === morae.length - 1 && !particleHigh));
        return (
          <span
            key={index}
            className="pa-choice-mora"
            data-c={high ? 'h' : 'l'}
            data-fall={fallsAfter ? '' : undefined}
          >
            {mora}
          </span>
        );
      })}
      <span className="pa-choice-mora pa-choice-particle" data-c={particleHigh ? 'h' : 'l'}>
        ・
      </span>
    </span>
  );
}
