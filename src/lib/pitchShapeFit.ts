import { expectedPitchShape, type MoraPitchClass } from './pitchAccentShape';

/**
 * Fits a measured per-mora pitch contour to the accent shapes Japanese actually
 * allows, instead of judging each mora against the word's average on its own.
 *
 * Why: the per-mora rule (`classifyLearnerMorae`: a mora is high if it is at or
 * above the word's mean) breaks on plateaus. In a long flat-high (heiban) word
 * the later morae drift a little below the mean and get called low, so a heiban
 * word reads as accented. Against the dictionary shape on 219 native clips
 * (`audit-pitch-accent-clips.ts`, EXACT_MORAE=1) the per-mora rule agreed 40% of
 * the time; fitting a valid shape agreed 55% (long `lhhh` words: 10% → 43%).
 * Trimming frames, medians, outlier removal and a drift term were all tried and
 * did not beat the plain fit (docs/STATUS.md 2026-09-20).
 *
 * Only for *native* audio, deliberately. A learner can produce a contour that is
 * not valid Japanese (flat, or high at the start with no drop), and forcing it
 * into a valid shape would hide the mistake — the learner classifier stays
 * descriptive. `contrastSemitones` says how strong the high/low difference is,
 * so a flat production still shows up as "no clear contrast".
 */

/** The distinct in-word shapes for `moraCount` morae (accent positions 0..n; heiban and odaka share one). */
export function validAccentShapes(moraCount: number): MoraPitchClass[][] {
  const seen = new Map<string, MoraPitchClass[]>();
  for (let position = 0; position <= moraCount; position += 1) {
    const shape = expectedPitchShape(moraCount, position);
    seen.set(shape.join(''), shape);
  }
  return [...seen.values()];
}

export interface ShapeFit {
  shape: MoraPitchClass[];
  /** Mean high-class pitch minus mean low-class pitch, semitones (always ≥ 0). */
  contrastSemitones: number;
  /** Runner-up's squared error minus the winner's (semitones²) — 0 means a coin flip between two shapes. */
  margin: number;
  /** Morae that had voiced pitch and took part in the fit. */
  voicedMorae: number;
}

export interface ShapeFitOptions {
  /** Fits whose high−low contrast is below this are rejected as "no clear contrast" (default 0). */
  minContrastSemitones?: number;
}

/**
 * The best-fitting valid shape for per-mora mean pitches (`null` = unvoiced),
 * by least squares with a free level per class and the constraint that high is
 * at least as high as low. Unvoiced morae simply don't vote. Returns null when
 * fewer than two morae are voiced, when no shape can split the voiced morae into
 * two classes, or when the best contrast is under `minContrastSemitones`.
 */
export function fitAccentShape(
  moraMeans: readonly (number | null)[],
  options: ShapeFitOptions = {},
): ShapeFit | null {
  const moraCount = moraMeans.length;
  const voiced = moraMeans.map((value, index) => ({ value, index })).filter((m): m is { value: number; index: number } => m.value !== null);
  if (voiced.length < Math.min(2, moraCount) || voiced.length < 2) return null;
  const minContrast = options.minContrastSemitones ?? 0;

  const scored: { shape: MoraPitchClass[]; cost: number; contrast: number }[] = [];
  for (const shape of validAccentShapes(moraCount)) {
    const high = voiced.filter((m) => shape[m.index] === 'h').map((m) => m.value);
    const low = voiced.filter((m) => shape[m.index] === 'l').map((m) => m.value);
    if (high.length === 0 || low.length === 0) continue; // both classes must be observed
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const highMean = mean(high);
    const lowMean = mean(low);
    const contrast = highMean - lowMean;
    if (contrast < minContrast || contrast < 0) continue; // high must not sit below low
    const cost = high.reduce((a, x) => a + (x - highMean) ** 2, 0) + low.reduce((a, x) => a + (x - lowMean) ** 2, 0);
    scored.push({ shape, cost, contrast });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => a.cost - b.cost);
  const [best, runnerUp] = scored;
  return {
    shape: best!.shape,
    contrastSemitones: best!.contrast,
    margin: runnerUp ? runnerUp.cost - best!.cost : Number.POSITIVE_INFINITY,
    voicedMorae: voiced.length,
  };
}
