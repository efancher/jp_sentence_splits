import { isEngineRole } from './clauseBands';

/**
 * Pedagogical puzzle-edge families (display-only).
 * Inspired by particle-as-socket / engine-as-anchor metaphors —
 * shapes cue role type; they do not validate grammar.
 */
export type PuzzleShapeFamily =
  | 'noun-flat'
  | 'wo-socket'
  | 'ni-de-slot'
  | 'ga-subject'
  | 'topic-band'
  | 'te-bridge'
  | 'other-car'
  | 'engine-anchor'
  | 'ending-cap'
  | 'connector'
  | 'generic';

/** Shared edge profile ids — left path is the mirror (socket) of right (tab). */
export type PuzzleEdge =
  | 'flat'
  | 'round'
  | 'deep-u'
  | 'key-pin'
  | 'bump'
  | 'wide-bay'
  | 'bridge';

export type PuzzleFit = 'good' | 'odd' | 'neutral';

const NI_DE_HE = new Set([
  'に-car',
  'で-car',
  'へ-car',
  'で-car + topic は',
  'に-car + topic は',
  'へ-car + topic は',
]);

const OTHER_CARS = new Set([
  'と-car',
  'から-car',
  'まで-car',
  'より-car',
  'の-car',
  'や-car',
  'と-car + topic は',
]);

/** Short hover/help gloss for each shape family. */
export const PUZZLE_SHAPE_BLURBS: Record<PuzzleShapeFamily, string> = {
  'noun-flat':
    'Flat right edge — a noun-like block that needs a particle socket to attach.',
  'wo-socket':
    'を socket — takes a direct-object noun on the left and locks into the engine.',
  'ni-de-slot':
    'に/で/へ slot — keyed for place, time, or target toward an active engine.',
  'ga-subject':
    'が subject — who/what the engine is about (including silent zero-が).',
  'topic-band':
    'Topic / focus band — は or も framing what we are talking about.',
  'te-bridge':
    'て-bridge — links toward the engine; stays inside the same clause.',
  'other-car':
    'Particle car — attaches a noun phrase into the clause toward the engine.',
  'engine-anchor':
    'Verb/engine anchor — flat right edge; sits at the end of the clause core.',
  'ending-cap':
    'Sentence ending — polite/plain close after the engine.',
  connector:
    'Clause connector — starts or joins the next clause band.',
  generic: 'Chunk piece — role-shaped when a known Cure Dolly role is set.',
};

/** Compact legend labels (Analyze strip). */
export const PUZZLE_LEGEND_ITEMS: readonly {
  family: PuzzleShapeFamily;
  label: string;
}[] = [
  { family: 'noun-flat', label: 'Noun' },
  { family: 'wo-socket', label: 'を' },
  { family: 'ni-de-slot', label: 'に/で' },
  { family: 'ga-subject', label: 'が' },
  { family: 'te-bridge', label: 'て' },
  { family: 'engine-anchor', label: 'Engine' },
  { family: 'ending-cap', label: 'Ending' },
] as const;

export function puzzleShapeFamily(role: string): PuzzleShapeFamily {
  const trimmed = role.trim();
  if (!trimmed) return 'generic';
  if (isEngineRole(trimmed)) return 'engine-anchor';
  if (trimmed === 'sentence ending') return 'ending-cap';
  if (trimmed === 'clause connector') return 'connector';
  if (trimmed === 'を-car') return 'wo-socket';
  if (NI_DE_HE.has(trimmed)) return 'ni-de-slot';
  if (
    trimmed === 'Aが' ||
    trimmed === 'zero-が (∅ subject)' ||
    trimmed.startsWith('zero-が')
  ) {
    return 'ga-subject';
  }
  if (trimmed === 'topic は' || trimmed === 'も-car') return 'topic-band';
  if (trimmed === 'て-car' || trimmed === 'って-car') return 'te-bridge';
  if (OTHER_CARS.has(trimmed)) return 'other-car';
  if (!trimmed.includes('-car') && !trimmed.includes('engine')) {
    return 'noun-flat';
  }
  return 'generic';
}

export function puzzleShapeClassName(family: PuzzleShapeFamily): string {
  return `chunk-puzzle-shape-${family}`;
}

/** Outbound (right) edge this family offers to the next piece. */
export function rightEdgeForFamily(family: PuzzleShapeFamily): PuzzleEdge {
  switch (family) {
    case 'noun-flat':
      return 'flat';
    case 'wo-socket':
      return 'deep-u';
    case 'ni-de-slot':
      return 'key-pin';
    case 'ga-subject':
      return 'bump';
    case 'topic-band':
      return 'wide-bay';
    case 'te-bridge':
      return 'bridge';
    case 'other-car':
      return 'round';
    case 'engine-anchor':
      return 'flat';
    case 'ending-cap':
      return 'flat';
    case 'connector':
      return 'round';
    case 'generic':
    default:
      return 'round';
  }
}

/** Intrinsic left edge when there is no previous neighbor. */
export function intrinsicLeftEdge(family: PuzzleShapeFamily): PuzzleEdge {
  switch (family) {
    case 'noun-flat':
      return 'flat';
    case 'wo-socket':
      return 'deep-u';
    case 'ni-de-slot':
      return 'key-pin';
    case 'ga-subject':
      return 'bump';
    case 'topic-band':
      return 'wide-bay';
    case 'te-bridge':
      return 'bridge';
    case 'other-car':
      return 'round';
    case 'engine-anchor':
      return 'round';
    case 'ending-cap':
      return 'flat';
    case 'connector':
      return 'round';
    case 'generic':
    default:
      return 'round';
  }
}

/**
 * Neighbor-aware left edge: mate to the previous piece’s right tab
 * (same profile id — rendered mirrored as a socket).
 */
export function resolveLeftEdge(
  family: PuzzleShapeFamily,
  previousRight: PuzzleEdge | null,
): PuzzleEdge {
  if (previousRight == null) return intrinsicLeftEdge(family);
  // Flat→flat is fine; otherwise inherit the neighbor’s profile so tabs nest.
  if (previousRight === 'flat' && family === 'engine-anchor') {
    return intrinsicLeftEdge(family);
  }
  return previousRight;
}

const GOOD_PAIRS = new Set<string>([
  'noun-flat>wo-socket',
  'noun-flat>ni-de-slot',
  'noun-flat>ga-subject',
  'noun-flat>other-car',
  'noun-flat>topic-band',
  'wo-socket>engine-anchor',
  'ni-de-slot>engine-anchor',
  'ga-subject>engine-anchor',
  'topic-band>engine-anchor',
  'other-car>engine-anchor',
  'te-bridge>engine-anchor',
  'te-bridge>te-bridge',
  'engine-anchor>ending-cap',
  'engine-anchor>connector',
  'connector>noun-flat',
  'connector>ga-subject',
  'connector>topic-band',
  'connector>wo-socket',
  'connector>ni-de-slot',
  'connector>other-car',
  'generic>engine-anchor',
  'topic-band>wo-socket',
  'topic-band>ni-de-slot',
  'topic-band>other-car',
  'ga-subject>wo-socket',
  'ga-subject>ni-de-slot',
  'ga-subject>te-bridge',
  'other-car>te-bridge',
  'wo-socket>te-bridge',
  'ni-de-slot>te-bridge',
]);

const ODD_PAIRS = new Set<string>([
  'engine-anchor>engine-anchor',
  'engine-anchor>wo-socket',
  'engine-anchor>ni-de-slot',
  'engine-anchor>ga-subject',
  'engine-anchor>noun-flat',
  'ending-cap>engine-anchor',
  'ending-cap>wo-socket',
  'ending-cap>noun-flat',
  'wo-socket>wo-socket',
  'wo-socket>noun-flat',
  'ni-de-slot>noun-flat',
  'noun-flat>engine-anchor',
  'noun-flat>ending-cap',
  'ending-cap>ending-cap',
]);

/** Soft pedagogical fit between adjacent roles (not a parser). */
export function adjacentPuzzleFit(
  previousRole: string,
  nextRole: string,
): PuzzleFit {
  const prev = puzzleShapeFamily(previousRole);
  const next = puzzleShapeFamily(nextRole);
  const key = `${prev}>${next}`;
  if (GOOD_PAIRS.has(key)) return 'good';
  if (ODD_PAIRS.has(key)) return 'odd';
  if (isEngineRole(nextRole) && prev !== 'engine-anchor' && prev !== 'ending-cap') {
    return 'good';
  }
  return 'neutral';
}

/** Fit class on the joint between piece index and index+1 (applied to the later piece). */
export function puzzleFitClassName(fit: PuzzleFit): string {
  if (fit === 'good') return 'chunk-puzzle-fit-good';
  if (fit === 'odd') return 'chunk-puzzle-fit-odd';
  return '';
}
