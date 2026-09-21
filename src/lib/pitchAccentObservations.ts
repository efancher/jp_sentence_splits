import type { WordAlignment } from '../domain/types';
import { segmentIntoMorae } from './mora';
import { phonesToMoraIntervals } from './moraTiming';
import type { PitchAnalysisPayload, PitchFrame } from './pitch';
import { diagnosePitchAccentDeviation } from './pitchAccentCorrections';
import { fitAccentShape } from './pitchShapeFit';
import {
  detectedDropPosition,
  expectedPitchShape,
  pitchPatternLabel,
  type MoraPitchClass,
} from './pitchAccentShape';
import type { TimingObservation } from './timingObservations';

/**
 * Ground-truth pitch-accent scoring: compares a learner's own recording
 * against a dictionary-predicted pitch shape (Kanjium, via
 * `scripts/backfill-pitch-accent.ts` -> `VocabularyItem.pitchAccentPositions`)
 * instead of a reference recording. Structurally different from
 * `pitchTimingObservations.ts`/`wordTimingObservations.ts`, which both
 * require a reference-clip alignment: this module only needs the
 * *learner's* alignment + pitch, so it works even for sentences with no
 * `SentenceAudio` at all (a step toward the not-yet-built audio-less
 * pronunciation drill mode).
 *
 * Because this is backed by real ground truth rather than another
 * recording's acoustic trend, it can make a more confident claim than
 * `pitchTimingObservations.ts` does — but it's still a rough,
 * mic/YIN-derived estimate over coarse equal-width mora buckets (not
 * true mora-duration-aware segmentation), so confidence still caps below
 * 'high' except for stark, well-covered mismatches. See
 * `pitchAccentShape.ts`'s module doc for the odaka/heiban ambiguity this
 * deliberately collapses rather than guesses at.
 */

export interface PitchAccentTarget {
  /** The exact inflected text as it appeared in the sentence (`SentenceVocabulary.surfaceForm`) — must exact-match a `WordAlignment.text`. */
  surfaceForm: string;
  reading: string;
  pitchAccentPositions: number[];
  /**
   * The run of single-kana bunsetsu particles right after this occurrence
   * in the sentence (`は`/`が`/`を`/… — `trailingBunsetsuParticles`), if any.
   * When present and its pitch can be measured in the recording, it lets the
   * scorer tell odaka (particle drops) from heiban (particle stays high) —
   * the one distinction that's invisible on the word's own morae.
   */
  followingMora?: string;
}

const MIN_VOICED_BUCKETS = 2;
const STARK_MORA_GAP = 2;
/**
 * How far (semitones) the following mora must sit below the word's own mean
 * pitch to count as "the particle dropped". Biased well past ordinary
 * utterance declination (~1–2 st) so a genuinely heiban phrase is never
 * misread as odaka; a real odaka downstep is 3+ st.
 */
const FOLLOWING_DROP_MARGIN_SEMITONES = 2;

function isSilence(word: WordAlignment): boolean {
  return !word.text || word.text === '<eps>';
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function voicedSemitones(frames: PitchFrame[]): number[] {
  return frames
    .filter((frame): frame is PitchFrame & { relativeSemitones: number } =>
      frame.voiced && frame.relativeSemitones !== null,
    )
    .map((frame) => frame.relativeSemitones);
}

export interface MoraeClassification {
  /** Per-word-mora mean relative semitones (null = no voiced frame in that bucket). Length `moraCount`. */
  bucketMeans: Array<number | null>;
  /** Mean relative semitones over the whole word's voiced frames. */
  overallMean: number;
  /** Length `moraCount`, or `moraCount + 1` when `measuredFollowing` — the last element is then the following mora. */
  classes: MoraPitchClass[];
  /** Word buckets with any voiced signal (the following mora is not counted here). */
  voicedBucketCount: number;
  /** Per-word-mora: true = measured directly, false = class carried forward from a neighbour. Length `moraCount`. */
  voicedBuckets: boolean[];
  /** Whether the following mora had enough voiced signal to append its class. */
  measuredFollowing: boolean;
}

/** Frames within `[start, end)` that are voiced and have a relative-semitone reading. */
function voicedFramesInSpan(
  pitch: PitchAnalysisPayload,
  start: number,
  end: number,
): PitchFrame[] {
  return pitch.frames.filter(
    (frame) =>
      frame.voiced &&
      frame.relativeSemitones !== null &&
      frame.timeSeconds >= start &&
      frame.timeSeconds < end,
  );
}

/**
 * Slices `word`'s time span into `moraCount` equal-width buckets
 * (an approximation — real mora durations aren't isochronous, same class
 * of simplification the rest of this feedback system already accepts)
 * and classifies each bucket 'h'/'l' relative to the word's own overall
 * mean pitch — never sentence-wide register. A bucket with no voiced
 * frames carries forward the previous bucket's class (defaulting to 'l'
 * before any voiced bucket is seen — silence more often coincides with
 * an unvoiced/low stretch than a high one). Returns null when too few
 * buckets have any voiced signal to classify at all.
 *
 * When `followingSpan` is given (the aligned particle after the word), one
 * extra class is appended for it — 'l' only if its mean sits a clear margin
 * below the word's mean (`FOLLOWING_DROP_MARGIN_SEMITONES`), else 'h'. That
 * asymmetry is deliberate: it's the odaka-vs-heiban cue and we'd rather
 * miss a real odaka than invent one from declination.
 */
export function classifyLearnerMorae(
  word: WordAlignment,
  moraCount: number,
  pitch: PitchAnalysisPayload,
  followingSpan?: { start: number; end: number } | null,
  /**
   * The word's own measured mora intervals (`phonesToMoraIntervals`, seconds). When
   * given and exactly `moraCount` long they replace the equal-width buckets. When omitted,
   * the word's own `phones` are tried (`phonesToMoraIntervals`) — every aligned word from
   * the reference or learner alignment carries them — so scoring is exact wherever the
   * aligner's phones and the expected reading agree, and unchanged where they don't. Morae
   * are not equal in length (a long vowel is two, a geminate is silent closure, a
   * devoiced vowel is short), so equal slices can put a high/low judgement on the
   * wrong part of the F0 track.
   */
  moraIntervals?: readonly { start: number; end: number }[] | null,
): MoraeClassification | null {
  if (moraCount <= 0) return null;
  const wordFrames = voicedFramesInSpan(pitch, word.start, word.end);
  const overallMean = average(voicedSemitones(wordFrames));
  if (overallMean === null) return null;

  const derived = moraIntervals === undefined && word.phones.length > 0 ? phonesToMoraIntervals(word.phones) : moraIntervals;
  const exact = derived && derived.length === moraCount ? derived : null;
  const bucketWidth = (word.end - word.start) / moraCount;
  const bucketMeans: Array<number | null> = [];
  for (let index = 0; index < moraCount; index += 1) {
    const bucketStart = exact ? exact[index]!.start : word.start + index * bucketWidth;
    const bucketEnd = exact ? exact[index]!.end : bucketStart + bucketWidth;
    const bucketFrames = wordFrames.filter(
      (frame) => frame.timeSeconds >= bucketStart && frame.timeSeconds < bucketEnd,
    );
    bucketMeans.push(average(voicedSemitones(bucketFrames)));
  }

  const voicedBuckets = bucketMeans.map((value) => value !== null);
  const voicedBucketCount = voicedBuckets.filter(Boolean).length;
  if (voicedBucketCount < Math.min(MIN_VOICED_BUCKETS, moraCount)) return null;

  let lastKnown: MoraPitchClass = 'l';
  const classes = bucketMeans.map((value) => {
    if (value !== null) lastKnown = value >= overallMean ? 'h' : 'l';
    return lastKnown;
  });

  let measuredFollowing = false;
  if (followingSpan && followingSpan.end > followingSpan.start) {
    const followingFrames = voicedFramesInSpan(pitch, followingSpan.start, followingSpan.end);
    const followingMean = average(voicedSemitones(followingFrames));
    if (followingMean !== null && followingFrames.length >= MIN_VOICED_BUCKETS) {
      classes.push(followingMean <= overallMean - FOLLOWING_DROP_MARGIN_SEMITONES ? 'l' : 'h');
      measuredFollowing = true;
    }
  }

  return { bucketMeans, overallMean, classes, voicedBucketCount, voicedBuckets, measuredFollowing };
}

/**
 * Below this high−low contrast (semitones) a take is "flat": its pitch barely
 * moved, so no accent can be read from it. Chosen from the native-clip audit
 * (`audit-pitch-accent-clips.ts`, 169 fitted clips): 0.5 st flags 11% of native
 * clips as flat and leaves agreement with the dictionary at 57%; raising it to
 * 2 st flags 40% for only 63%. Kept low on purpose — a flat verdict is soft
 * feedback, and a real accent should never be called flat.
 */
export const FLAT_CONTRAST_SEMITONES = 0.5;

export interface GradedMorae extends MoraeClassification {
  /** True when the take's high/low contrast is under `FLAT_CONTRAST_SEMITONES`; `classes` are then the descriptive per-mora reading. */
  flat: boolean;
  /** High − low contrast of the fitted shape, semitones; null when no shape could be fitted. */
  contrastSemitones: number | null;
}

/**
 * True when `raw` differs from `expected` only by a *sag at the end of the word*:
 * one or more trailing morae the raw rule calls low where the dictionary says
 * high (a flat-high word whose last morae drift a little under the word's mean).
 * That drift is the failure the shape fit exists to correct. Any other kind of
 * difference — a drop landing a mora early or late, a rise where the dictionary
 * has a fall — is a real deviation and is never rescued.
 */
function onlyTrailingSag(raw: readonly MoraPitchClass[], expected: readonly MoraPitchClass[]): boolean {
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 'l' && expected[end - 1] === 'h') end -= 1;
  for (let i = 0; i < end; i += 1) if (raw[i] !== expected[i]) return false;
  return true;
}

/**
 * The classification production feedback grades against the dictionary.
 * `classifyLearnerMorae` judges each mora against the word's mean, which reads a
 * long plateau (heiban `lhhh`) as accented — native speakers agreed with the
 * dictionary only 40% of the time under it, 4-mora heiban 10% — so a correct
 * production could be marked wrong. Two changes, both from the native-clip audit
 * (`audit-pitch-accent-clips.ts`; fitting valid shapes alone reached 57%, 4-mora
 * heiban 43%):
 *
 * - **The fit can rescue plateau sag, never rewrite a real deviation.** The
 *   per-mora pitches are fitted to the shapes Japanese allows (`fitAccentShape`);
 *   the fitted classes are used only when that fit equals the dictionary shape,
 *   agrees with the raw reading on the opening mora, *and* the raw reading
 *   differs from the dictionary only by trailing morae sagging below the mean
 *   (`onlyTrailingSag`). Anything else — a raised first mora, a drop a mora early
 *   or late — keeps the raw descriptive reading and its specific diagnosis.
 *   (A first version rescued on the opening-mora check alone and passed a real
 *   late drop: 元気 measured 1.3 / 0.7 / −4.2 st fit "hll" and read as correct.)
 * - **Flat takes are flagged, not graded.** A contour whose high/low difference
 *   is under `FLAT_CONTRAST_SEMITONES` sets `flat` — otherwise a level take could
 *   pass by fitting heiban.
 *
 * Without `expectedPosition` (or for one-mora words / too little voiced signal)
 * this is just `classifyLearnerMorae`.
 */
export function gradeLearnerMorae(
  word: WordAlignment,
  moraCount: number,
  pitch: PitchAnalysisPayload,
  followingSpan?: { start: number; end: number } | null,
  expectedPosition?: number,
): GradedMorae | null {
  const raw = classifyLearnerMorae(word, moraCount, pitch, followingSpan);
  if (!raw) return null;
  const fit = moraCount >= 2 ? fitAccentShape(raw.bucketMeans) : null;
  if (!fit) return { ...raw, flat: false, contrastSemitones: null };
  if (fit.contrastSemitones < FLAT_CONTRAST_SEMITONES) {
    return { ...raw, flat: true, contrastSemitones: fit.contrastSemitones };
  }
  const expected = expectedPosition === undefined ? null : expectedPitchShape(moraCount, expectedPosition);
  const rescued =
    expected !== null &&
    fit.shape.join('') === expected.join('') &&
    raw.classes[0] === fit.shape[0] &&
    onlyTrailingSag(raw.classes.slice(0, moraCount), expected);
  return {
    ...raw,
    classes: rescued ? [...fit.shape, ...raw.classes.slice(moraCount)] : raw.classes,
    flat: false,
    contrastSemitones: fit.contrastSemitones,
  };
}

/**
 * The time span of the aligned particle run right after `audibleWords[wordIndex]`,
 * matched against the expected `followingMora` kana so we never mistake the
 * next content word for the particle. `null` when there's no following mora
 * to look for or the alignment doesn't have it.
 */
export function followingMoraSpan(
  audibleWords: WordAlignment[],
  wordIndex: number,
  followingMora: string | undefined,
): { start: number; end: number } | null {
  if (!followingMora) return null;
  let consumed = '';
  let spanStart = Number.NaN;
  let spanEnd = Number.NaN;
  for (let index = wordIndex + 1; index < audibleWords.length; index += 1) {
    const token = audibleWords[index]!;
    if (!token.text) break;
    const next = consumed + token.text;
    if (!followingMora.startsWith(next)) break;
    if (Number.isNaN(spanStart)) spanStart = token.start;
    spanEnd = token.end;
    consumed = next;
    if (consumed === followingMora) break;
  }
  return Number.isNaN(spanStart) ? null : { start: spanStart, end: spanEnd };
}

export interface LearnerPitchAccentShape {
  /** The target word's surface form as it appeared in the sentence. */
  surfaceForm: string;
  /** Learner's measured high/low per mora — same length (and mora segmentation) as the dictionary row for this word. */
  classes: MoraPitchClass[];
  /**
   * Learner's measured level on the mora right after the word (the attached
   * particle), when `target.followingMora` was set and had voiced signal —
   * the odaka/heiban cue, shown under the dictionary particle mark.
   */
  followingClass?: MoraPitchClass;
  /** How many mora buckets carried any voiced signal; the rest are carried-forward guesses. */
  voicedBucketCount: number;
  moraCount: number;
  /** The take's pitch barely moved (`FLAT_CONTRAST_SEMITONES`): `classes` is then the raw per-mora reading. */
  flat?: boolean;
}

/**
 * The learner's own per-mora H/L shape for each pitch-accent target, for
 * displaying directly under the dictionary row so the two can be compared
 * mark-for-mark (`SentencePitchAccentRow`'s learner row). Same rough
 * per-mora estimate `buildPitchAccentShapeObservations` scores against —
 * this just surfaces it instead of only reporting mismatches, so a
 * correctly-produced accent is still visible as a match.
 */
export function buildLearnerPitchAccentShapes({
  learnerWords,
  learnerPitch,
  targets,
}: {
  learnerWords: WordAlignment[];
  learnerPitch: PitchAnalysisPayload;
  targets: PitchAccentTarget[];
}): LearnerPitchAccentShape[] {
  const audibleWords = learnerWords.filter((word) => !isSilence(word));
  const shapes: LearnerPitchAccentShape[] = [];

  for (const target of targets) {
    if (!target.pitchAccentPositions.length) continue;
    const wordIndex = audibleWords.findIndex((candidate) => candidate.text === target.surfaceForm);
    if (wordIndex < 0) continue;
    const word = audibleWords[wordIndex]!;

    const morae = segmentIntoMorae(target.reading);
    if (morae.length === 0) continue;

    const followingSpan = followingMoraSpan(audibleWords, wordIndex, target.followingMora);
    const learnerResult = gradeLearnerMorae(word, morae.length, learnerPitch, followingSpan, target.pitchAccentPositions[0]);
    if (!learnerResult) continue;

    shapes.push({
      flat: learnerResult.flat || undefined,
      surfaceForm: target.surfaceForm,
      classes: learnerResult.classes.slice(0, morae.length),
      followingClass: learnerResult.measuredFollowing
        ? learnerResult.classes[morae.length]
        : undefined,
      voicedBucketCount: learnerResult.voicedBucketCount,
      moraCount: morae.length,
    });
  }

  return shapes;
}

export function buildPitchAccentShapeObservations({
  learnerWords,
  learnerPitch,
  targets,
}: {
  learnerWords: WordAlignment[];
  learnerPitch: PitchAnalysisPayload;
  targets: PitchAccentTarget[];
}): TimingObservation[] {
  const observations: TimingObservation[] = [];
  const audibleWords = learnerWords.filter((word) => !isSilence(word));

  targets.forEach((target, targetIndex) => {
    if (!target.pitchAccentPositions.length) return;
    // MFA's word tier doesn't always line up with dictionary segmentation
    // (same caveat wordTimingObservations.ts documents) — no exact match
    // means silently skip, not an error.
    const wordIndex = audibleWords.findIndex((candidate) => candidate.text === target.surfaceForm);
    if (wordIndex < 0) return;
    const word = audibleWords[wordIndex]!;

    const morae = segmentIntoMorae(target.reading);
    if (morae.length === 0) return;

    const followingSpan = followingMoraSpan(audibleWords, wordIndex, target.followingMora);
    const learnerResult = gradeLearnerMorae(word, morae.length, learnerPitch, followingSpan, target.pitchAccentPositions[0]);
    if (!learnerResult) return;
    const { classes: learnerClasses, voicedBucketCount, voicedBuckets, measuredFollowing, flat } =
      learnerResult;

    const expectedPosition = target.pitchAccentPositions[0]!;
    const moraeText = morae.map((unit) => unit.text);
    if (flat) {
      // Nothing to grade: a level contour has no accent to compare, and fitting
      // one to it would let a flat take pass as heiban. Say so, softly.
      const raise = expectedPosition > 1 ? moraeText[Math.min(expectedPosition, morae.length) - 1] : undefined;
      observations.push({
        id: `pitch-accent-shape-${targetIndex}`,
        kind: 'pitch_accent_shape',
        subject: target.surfaceForm,
        confidence: 'low',
        severity: 0.3,
        segment: { startMs: word.start * 1000, endMs: word.end * 1000 },
        message: `Your pitch barely moved across 「${target.surfaceForm}」 (under ${FLAT_CONTRAST_SEMITONES} semitone between its highest and lowest morae), so no accent could be read from it.`,
        hint: `Japanese lexical accent is carried almost entirely by pitch height — English marks a word with stress and vowel length instead, so a flat contour is a common transfer. Push the movement past what feels natural: ${
          expectedPosition === 1
            ? `start 「${moraeText[0]}」 high and drop hard right after it`
            : expectedPosition === 0 || expectedPosition >= morae.length
              ? `start 「${moraeText[0]}」 low and step clearly up onto 「${moraeText[1] ?? moraeText[0]}」`
              : `start low, lift up by 「${moraeText[1] ?? moraeText[0]}」 and drop hard after 「${raise}」`
        }.`,
        detail:
          'Based on a rough per-mora pitch estimate from your recording — a very quiet or creaky take can also read as flat.',
      });
      return;
    }
    const detected = detectedDropPosition(learnerClasses);
    const expectedShape = expectedPitchShape(morae.length, expectedPosition, measuredFollowing);
    const perMoraMatch =
      learnerClasses.length === expectedShape.length &&
      learnerClasses.every((cls, index) => cls === expectedShape[index]);
    // Nothing diverged at all — not even a single mora.
    if (perMoraMatch) return;

    const correction = diagnosePitchAccentDeviation({
      surfaceForm: target.surfaceForm,
      moraeText,
      expected: expectedShape,
      actual: learnerClasses,
      hasFollowing: measuredFollowing,
      followingText: target.followingMora,
    });
    // Compare through the same shape->drop-position function on both sides,
    // not the raw dictionary position. Without a measured following mora an
    // odaka target is never scored as a mismatch against a correctly-
    // produced heiban-shaped attempt (see pitchAccentShape.ts); with one,
    // `expectedPitchShape` appends the particle level so odaka reads as a
    // drop at `morae.length` and the two are finally distinguishable.
    const effectiveExpected = detectedDropPosition(expectedShape);

    // The drop landed in the right place but individual morae are off (a
    // raised opening mora, a sagged plateau — the "just extra lows or
    // highs" case). Weaker signal than a misplaced drop, so only surface it
    // when every divergent word mora was actually measured, not a
    // carried-forward bucket guess.
    if (detected === effectiveExpected) {
      if (!correction) return;
      const divergentWordMoraCarried = learnerClasses.some(
        (cls, index) =>
          index < morae.length && cls !== expectedShape[index] && !voicedBuckets[index],
      );
      if (divergentWordMoraCarried) return;
      const diffCount = learnerClasses.filter(
        (cls, index) => cls !== expectedShape[index],
      ).length;
      observations.push({
        id: `pitch-accent-shape-${targetIndex}`,
        kind: 'pitch_accent_shape',
        subject: target.surfaceForm,
        confidence: voicedBucketCount === morae.length ? 'medium' : 'low',
        severity: Math.min(0.45, diffCount / expectedShape.length),
        segment: { startMs: word.start * 1000, endMs: word.end * 1000 },
        message: correction.summary,
        hint: correction.hint,
        detail:
          'The drop itself is in the right place — this is about the shape around it, read off a rough per-mora pitch estimate.',
      });
      return;
    }

    const gap = Math.abs(effectiveExpected - detected);
    const isStark = gap >= STARK_MORA_GAP;
    const fullCoverage = voicedBucketCount === morae.length;
    const expectedLabel = pitchPatternLabel(expectedPosition, morae.length);
    const detectedLabel = pitchPatternLabel(detected, morae.length);
    const alternates = target.pitchAccentPositions.slice(1);
    // The mismatch is on the particle when that's the only place the two
    // shapes diverge — i.e. the word's own morae were produced fine.
    const onFollowingMora =
      measuredFollowing &&
      detectedDropPosition(learnerClasses.slice(0, morae.length)) ===
        detectedDropPosition(expectedPitchShape(morae.length, expectedPosition));

    // Both the dictionary and the recording land in the same coarse
    // category (only nakadaka has more than one interior drop position,
    // so this is always nakadaka-vs-nakadaka) but the drop is one or more
    // morae off. "sounds like nakadaka instead" would be nonsense here —
    // name the mora the drop belongs on instead.
    const expectedDropMora = morae[effectiveExpected - 1]?.text;
    const detectedDropMora = morae[detected - 1]?.text;
    const sameLabel =
      !onFollowingMora &&
      expectedLabel === detectedLabel &&
      effectiveExpected > 0 &&
      detected > 0 &&
      !!expectedDropMora &&
      !!detectedDropMora;
    const moraGapWord = gap === 1 ? 'mora' : 'morae';

    observations.push({
      id: `pitch-accent-shape-${targetIndex}`,
      kind: 'pitch_accent_shape',
      subject: target.surfaceForm,
      // A single short following-mora bucket is a shakier read than the
      // multi-bucket word shape — never claim 'high' off it alone.
      confidence: isStark && fullCoverage && !onFollowingMora ? 'high' : 'medium',
      severity: Math.min(1, gap / morae.length),
      segment: { startMs: word.start * 1000, endMs: word.end * 1000 },
      hint: correction?.hint,
      message: onFollowingMora
        ? `Dictionaries mark 「${target.surfaceForm}」 as ${expectedLabel}: the pitch ${
            expectedLabel === 'heiban' ? 'stays up on' : 'drops on'
          } the particle after it, but yours ${
            expectedLabel === 'heiban' ? 'drops' : 'stays up'
          } there — it sounds like ${detectedLabel}.`
        : sameLabel
          ? `Both the dictionary and your recording read 「${target.surfaceForm}」 as ${expectedLabel} — the drop is just in the wrong place. It belongs after 「${expectedDropMora}」 (mora ${effectiveExpected}), but yours ${
              detected > effectiveExpected
                ? `stays high ${gap} ${moraGapWord} too long and drops after 「${detectedDropMora}」`
                : `drops ${gap} ${moraGapWord} early, after 「${detectedDropMora}」`
            } (mora ${detected}).`
          : `Dictionaries mark 「${target.surfaceForm}」 as ${expectedLabel}; your pitch here sounds like ${detectedLabel} instead.`,
      detail:
        'Based on a rough per-mora pitch estimate from your recording — mic quality and natural speech variation can shift this.' +
        (alternates.length ? ` Also acceptable: position ${alternates.join(', ')}.` : ''),
    });
  });

  return observations;
}
