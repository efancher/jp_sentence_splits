import type { PuzzleEdge } from './puzzleShapes';

/** Fixed edge-strip width in SVG units (paired 1:1 with CSS px). */
export const PUZZLE_EDGE_WIDTH = 14;
export const PUZZLE_PATH_HEIGHT = 56;
/** Tab/socket depth; adjacent pieces overlap by this many CSS px. */
export const PUZZLE_TAB_DEPTH = 10;
/** Legend miniature width. */
export const PUZZLE_PATH_WIDTH = 100;

/**
 * Vertical edge profile from y=0 → y=H along spine `baseX`.
 * Bump moves toward `baseX + direction * depth` (tabs and sockets share geometry).
 */
function profileDown(
  edge: PuzzleEdge,
  height: number,
  baseX: number,
  direction: 1 | -1,
): string {
  const mid = height / 2;
  if (edge === 'flat') return `L ${baseX} ${height}`;

  const bump = direction * PUZZLE_TAB_DEPTH;

  switch (edge) {
    case 'round':
      return [
        `L ${baseX} ${mid - 14}`,
        `C ${baseX} ${mid - 7}, ${baseX + bump} ${mid - 5}, ${baseX + bump} ${mid}`,
        `C ${baseX + bump} ${mid + 5}, ${baseX} ${mid + 7}, ${baseX} ${mid + 14}`,
        `L ${baseX} ${height}`,
      ].join(' ');
    case 'deep-u': {
      const y1 = mid - 15;
      const y2 = mid + 15;
      return [
        `L ${baseX} ${y1}`,
        `L ${baseX + bump} ${y1}`,
        `L ${baseX + bump} ${y2}`,
        `L ${baseX} ${y2}`,
        `L ${baseX} ${height}`,
      ].join(' ');
    }
    case 'key-pin':
      return [
        `L ${baseX} ${mid - 13}`,
        `L ${baseX + bump} ${mid}`,
        `L ${baseX} ${mid + 13}`,
        `L ${baseX} ${height}`,
      ].join(' ');
    case 'bump':
      return [
        `L ${baseX} ${mid - 14}`,
        `Q ${baseX + bump} ${mid}, ${baseX} ${mid + 14}`,
        `L ${baseX} ${height}`,
      ].join(' ');
    case 'wide-bay': {
      const inset = bump * 0.85;
      return [
        `L ${baseX} ${mid - 17}`,
        `L ${baseX + inset} ${mid - 12}`,
        `L ${baseX + inset} ${mid + 12}`,
        `L ${baseX} ${mid + 17}`,
        `L ${baseX} ${height}`,
      ].join(' ');
    }
    case 'bridge': {
      const step = bump * 0.75;
      return [
        `L ${baseX} 12`,
        `L ${baseX + step} 12`,
        `L ${baseX + step} ${height - 12}`,
        `L ${baseX} ${height - 12}`,
        `L ${baseX} ${height}`,
      ].join(' ');
    }
    default:
      return `L ${baseX} ${height}`;
  }
}

/** Same profile, traced y=H → y=0. */
function profileUp(
  edge: PuzzleEdge,
  height: number,
  baseX: number,
  direction: 1 | -1,
): string {
  const mid = height / 2;
  if (edge === 'flat') return `L ${baseX} 0`;

  const bump = direction * PUZZLE_TAB_DEPTH;

  switch (edge) {
    case 'round':
      return [
        `L ${baseX} ${mid + 14}`,
        `C ${baseX} ${mid + 7}, ${baseX + bump} ${mid + 5}, ${baseX + bump} ${mid}`,
        `C ${baseX + bump} ${mid - 5}, ${baseX} ${mid - 7}, ${baseX} ${mid - 14}`,
        `L ${baseX} 0`,
      ].join(' ');
    case 'deep-u': {
      const y1 = mid - 15;
      const y2 = mid + 15;
      return [
        `L ${baseX} ${y2}`,
        `L ${baseX + bump} ${y2}`,
        `L ${baseX + bump} ${y1}`,
        `L ${baseX} ${y1}`,
        `L ${baseX} 0`,
      ].join(' ');
    }
    case 'key-pin':
      return [
        `L ${baseX} ${mid + 13}`,
        `L ${baseX + bump} ${mid}`,
        `L ${baseX} ${mid - 13}`,
        `L ${baseX} 0`,
      ].join(' ');
    case 'bump':
      return [
        `L ${baseX} ${mid + 14}`,
        `Q ${baseX + bump} ${mid}, ${baseX} ${mid - 14}`,
        `L ${baseX} 0`,
      ].join(' ');
    case 'wide-bay': {
      const inset = bump * 0.85;
      return [
        `L ${baseX} ${mid + 17}`,
        `L ${baseX + inset} ${mid + 12}`,
        `L ${baseX + inset} ${mid - 12}`,
        `L ${baseX} ${mid - 17}`,
        `L ${baseX} 0`,
      ].join(' ');
    }
    case 'bridge': {
      const step = bump * 0.75;
      return [
        `L ${baseX} ${height - 12}`,
        `L ${baseX + step} ${height - 12}`,
        `L ${baseX + step} 12`,
        `L ${baseX} 12`,
        `L ${baseX} 0`,
      ].join(' ');
    }
    default:
      return `L ${baseX} 0`;
  }
}

/**
 * Left edge strip path.
 * Socket opens at x=0 (receives previous tab); flat join to mid at x=W.
 */
export function buildLeftEdgePath(edge: PuzzleEdge): string {
  const w = PUZZLE_EDGE_WIDTH;
  const h = PUZZLE_PATH_HEIGHT;
  return [
    `M 0 0`,
    profileDown(edge, h, 0, 1),
    `L ${w} ${h}`,
    `L ${w} 0`,
    'Z',
  ].join(' ');
}

/**
 * Right edge strip path.
 * Flat join to mid at x=0; tab tip at x=W (plugs into next socket under overlap).
 */
export function buildRightEdgePath(edge: PuzzleEdge): string {
  const w = PUZZLE_EDGE_WIDTH;
  const h = PUZZLE_PATH_HEIGHT;
  if (edge === 'flat') {
    return `M 0 0 L 0 ${h} L ${w} ${h} L ${w} 0 Z`;
  }
  // Tab face sits at (W - TAB); tip reaches W so a -TAB px overlap nests into
  // the next piece's left socket (cavity from 0 → TAB).
  const base = w - PUZZLE_TAB_DEPTH;
  return [
    `M 0 0`,
    `L 0 ${h}`,
    `L ${base} ${h}`,
    profileUp(edge, h, base, 1),
    'Z',
  ].join(' ');
}

/**
 * Full miniature path for the legend (left socket + right tab).
 * Prefer {@link buildLeftEdgePath}/{@link buildRightEdgePath} for real pieces.
 */
export function buildPuzzlePiecePath(
  leftEdge: PuzzleEdge,
  rightEdge: PuzzleEdge,
): string {
  const w = PUZZLE_PATH_WIDTH;
  const h = PUZZLE_PATH_HEIGHT;
  const rightBase = rightEdge === 'flat' ? w : w - PUZZLE_TAB_DEPTH;
  return [
    `M 0 0`,
    profileDown(leftEdge, h, 0, 1),
    `L ${rightBase} ${h}`,
    profileUp(rightEdge, h, rightBase, 1),
    'Z',
  ].join(' ');
}

/** @deprecated Alias kept for older imports. */
export const buildLegendPath = buildPuzzlePiecePath;
