import type { PuzzleEdge } from './puzzleShapes';

/** viewBox size for piece chrome + legend miniatures. */
export const PUZZLE_PATH_WIDTH = 100;
export const PUZZLE_PATH_HEIGHT = 56;
const TAB = 10;

/**
 * Trace an edge from top (y=0) to bottom (y=H).
 * Left side: sockets dent inward (+x). Right side: tabs push outward.
 */
function edgePoints(
  edge: PuzzleEdge,
  side: 'left' | 'right',
  height: number,
): string {
  const x0 = side === 'left' ? 0 : PUZZLE_PATH_WIDTH;
  const inward = side === 'left' ? 1 : -1;
  const mid = height / 2;

  switch (edge) {
    case 'flat':
      return `L ${x0} ${height}`;

    case 'round': {
      const d = TAB * inward;
      return [
        `L ${x0} ${mid - 14}`,
        `C ${x0} ${mid - 8}, ${x0 + d} ${mid - 6}, ${x0 + d} ${mid}`,
        `C ${x0 + d} ${mid + 6}, ${x0} ${mid + 8}, ${x0} ${mid + 14}`,
        `L ${x0} ${height}`,
      ].join(' ');
    }

    case 'deep-u': {
      // を-style deep hollow / tall tab
      const d = 12 * inward;
      const y1 = mid - 16;
      const y2 = mid + 16;
      return [
        `L ${x0} ${y1}`,
        `L ${x0 + d} ${y1}`,
        `C ${x0 + d + 2 * inward} ${y1}, ${x0 + d + 2 * inward} ${y2}, ${x0 + d} ${y2}`,
        `L ${x0} ${y2}`,
        `L ${x0} ${height}`,
      ].join(' ');
    }

    case 'key-pin': {
      // に/で triangular key
      const d = 11 * inward;
      return [
        `L ${x0} ${mid - 12}`,
        `L ${x0 + d} ${mid}`,
        `L ${x0} ${mid + 12}`,
        `L ${x0} ${height}`,
      ].join(' ');
    }

    case 'bump': {
      const d = 11 * inward;
      return [
        `L ${x0} ${mid - 14}`,
        `Q ${x0 + d} ${mid}, ${x0} ${mid + 14}`,
        `L ${x0} ${height}`,
      ].join(' ');
    }

    case 'wide-bay': {
      const d = 8 * inward;
      return [
        `L ${x0} ${mid - 18}`,
        `L ${x0 + d} ${mid - 14}`,
        `L ${x0 + d} ${mid + 14}`,
        `L ${x0} ${mid + 18}`,
        `L ${x0} ${height}`,
      ].join(' ');
    }

    case 'bridge': {
      // て-bridge: step notch top and bottom
      const d = 8 * inward;
      return [
        `L ${x0} 10`,
        `L ${x0 + d} 10`,
        `L ${x0 + d} ${height - 10}`,
        `L ${x0} ${height - 10}`,
        `L ${x0} ${height}`,
      ].join(' ');
    }

    default:
      return `L ${x0} ${height}`;
  }
}

/**
 * Closed SVG path for a puzzle piece with neighbor-aware edges.
 * Coordinates: viewBox 0 0 100 56.
 */
export function buildPuzzlePiecePath(
  leftEdge: PuzzleEdge,
  rightEdge: PuzzleEdge,
): string {
  const w = PUZZLE_PATH_WIDTH;
  const h = PUZZLE_PATH_HEIGHT;
  const leftX = 0;
  const rightX = w;

  // Top edge left → right, then right edge top→bottom, bottom right→left, left bottom→top.
  // Easier: start top-left, go down left edge, across bottom, up right edge (reversed), across top.
  // Build left top→bottom, bottom to right, right bottom→top via reverse, top close.

  const leftDown = edgePoints(leftEdge, 'left', h);

  // Start top-left, down the left edge, across the bottom, up the right edge, close.
  return [
    `M ${leftX} 0`,
    leftDown,
    `L ${rightX} ${h}`,
    reverseRightEdge(rightEdge, h),
    `L ${leftX} 0`,
    'Z',
  ].join(' ');
}

/** Trace right edge from bottom (y=H) to top (y=0). */
function reverseRightEdge(edge: PuzzleEdge, height: number): string {
  const x0 = PUZZLE_PATH_WIDTH;
  const inward = -1;
  const mid = height / 2;

  switch (edge) {
    case 'flat':
      return `L ${x0} 0`;

    case 'round': {
      const d = TAB * inward;
      return [
        `L ${x0} ${mid + 14}`,
        `C ${x0} ${mid + 8}, ${x0 + d} ${mid + 6}, ${x0 + d} ${mid}`,
        `C ${x0 + d} ${mid - 6}, ${x0} ${mid - 8}, ${x0} ${mid - 14}`,
        `L ${x0} 0`,
      ].join(' ');
    }

    case 'deep-u': {
      const d = 12 * inward;
      const y1 = mid - 16;
      const y2 = mid + 16;
      return [
        `L ${x0} ${y2}`,
        `L ${x0 + d} ${y2}`,
        `C ${x0 + d + 2 * inward} ${y2}, ${x0 + d + 2 * inward} ${y1}, ${x0 + d} ${y1}`,
        `L ${x0} ${y1}`,
        `L ${x0} 0`,
      ].join(' ');
    }

    case 'key-pin': {
      const d = 11 * inward;
      return [
        `L ${x0} ${mid + 12}`,
        `L ${x0 + d} ${mid}`,
        `L ${x0} ${mid - 12}`,
        `L ${x0} 0`,
      ].join(' ');
    }

    case 'bump': {
      const d = 11 * inward;
      return [
        `L ${x0} ${mid + 14}`,
        `Q ${x0 + d} ${mid}, ${x0} ${mid - 14}`,
        `L ${x0} 0`,
      ].join(' ');
    }

    case 'wide-bay': {
      const d = 8 * inward;
      return [
        `L ${x0} ${mid + 18}`,
        `L ${x0 + d} ${mid + 14}`,
        `L ${x0 + d} ${mid - 14}`,
        `L ${x0} ${mid - 18}`,
        `L ${x0} 0`,
      ].join(' ');
    }

    case 'bridge': {
      const d = 8 * inward;
      return [
        `L ${x0} ${height - 10}`,
        `L ${x0 + d} ${height - 10}`,
        `L ${x0 + d} 10`,
        `L ${x0} 10`,
        `L ${x0} 0`,
      ].join(' ');
    }

    default:
      return `L ${x0} 0`;
  }
}

/** Miniature path for legend chips (same edges as a solo piece of that family). */
export function buildLegendPath(
  leftEdge: PuzzleEdge,
  rightEdge: PuzzleEdge,
): string {
  return buildPuzzlePiecePath(leftEdge, rightEdge);
}
