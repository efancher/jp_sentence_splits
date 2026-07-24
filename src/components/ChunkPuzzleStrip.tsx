import type { CSSProperties } from 'react';

import { assignClauseIndices, isEngineRole } from '../lib/clauseBands';
import {
  buildPuzzlePiecePath,
  PUZZLE_PATH_HEIGHT,
  PUZZLE_PATH_WIDTH,
} from '../lib/puzzlePiecePath';
import {
  adjacentPuzzleFit,
  intrinsicLeftEdge,
  puzzleFitClassName,
  puzzleShapeClassName,
  puzzleShapeFamily,
  PUZZLE_LEGEND_ITEMS,
  PUZZLE_SHAPE_BLURBS,
  resolveLeftEdge,
  rightEdgeForFamily,
  type PuzzleEdge,
  type PuzzleShapeFamily,
} from '../lib/puzzleShapes';

export type PuzzleChunk = {
  id: string;
  japanese: string;
  role: string;
};

type ChunkPuzzleStripProps = {
  chunks: PuzzleChunk[];
  /** Speech / highlight target, e.g. `chunk-${id}`. */
  activeItemId?: string | null;
  /** When false, hide role labels on pieces (Practice before reveal). */
  revealRoles?: boolean;
  /** Compact shape key under the strip (Analyze only). */
  showLegend?: boolean;
};

const CLAUSE_TINT_COUNT = 4;

function PieceChrome({
  leftEdge,
  rightEdge,
}: {
  leftEdge: PuzzleEdge;
  rightEdge: PuzzleEdge;
}) {
  const d = buildPuzzlePiecePath(leftEdge, rightEdge);
  return (
    <svg
      className="chunk-puzzle-chrome"
      viewBox={`0 0 ${PUZZLE_PATH_WIDTH} ${PUZZLE_PATH_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={d} className="chunk-puzzle-chrome-fill" />
      <path d={d} className="chunk-puzzle-chrome-stroke" fill="none" />
    </svg>
  );
}

function LegendMini({ family }: { family: PuzzleShapeFamily }) {
  const left = intrinsicLeftEdge(family);
  const right = rightEdgeForFamily(family);
  const d = buildPuzzlePiecePath(left, right);
  return (
    <svg
      className="chunk-puzzle-legend-mini"
      viewBox={`0 0 ${PUZZLE_PATH_WIDTH} ${PUZZLE_PATH_HEIGHT}`}
      aria-hidden
    >
      <path d={d} className="chunk-puzzle-legend-mini-fill" />
    </svg>
  );
}

export function ChunkPuzzleStrip({
  chunks,
  activeItemId = null,
  revealRoles = true,
  showLegend = false,
}: ChunkPuzzleStripProps) {
  if (!chunks.length) return null;

  const clauseIndices = assignClauseIndices(chunks);
  const families = chunks.map((chunk) => puzzleShapeFamily(chunk.role));
  const rightEdges = families.map((family) => rightEdgeForFamily(family));

  return (
    <div className="chunk-puzzle-block">
      <div
        className="chunk-puzzle-strip"
        aria-label="Chunk structure strip"
      >
        {chunks.map((chunk, index) => {
          const clause = clauseIndices[index] ?? 0;
          const family = families[index]!;
          const engine = isEngineRole(chunk.role);
          const speaking =
            activeItemId === `chunk-${chunk.id}` || activeItemId === chunk.id;
          const nextClause = clauseIndices[index + 1];
          const clauseFinal =
            engine && (nextClause === undefined || nextClause !== clause);
          const previousRight =
            index > 0 ? (rightEdges[index - 1] ?? null) : null;
          const leftEdge = resolveLeftEdge(family, previousRight);
          const rightEdge = rightEdges[index]!;
          const fit =
            index > 0
              ? adjacentPuzzleFit(chunks[index - 1]!.role, chunk.role)
              : 'neutral';

          return (
            <div
              key={chunk.id}
              className={[
                'chunk-puzzle-piece',
                puzzleShapeClassName(family),
                engine ? 'chunk-puzzle-piece-engine' : '',
                clauseFinal ? 'chunk-puzzle-piece-clause-final' : '',
                speaking ? 'chunk-puzzle-piece-speaking' : '',
                puzzleFitClassName(fit),
              ]
                .filter(Boolean)
                .join(' ')}
              title={[
                PUZZLE_SHAPE_BLURBS[family],
                fit === 'good'
                  ? 'Fits the previous piece (heuristic).'
                  : fit === 'odd'
                    ? 'Unusual order after the previous piece (heuristic).'
                    : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-shape={family}
              data-fit={fit}
              style={
                {
                  '--clause-tint': `var(--clause-band-${clause % CLAUSE_TINT_COUNT})`,
                } as CSSProperties
              }
            >
              <PieceChrome leftEdge={leftEdge} rightEdge={rightEdge} />
              <div className="chunk-puzzle-body">
                <div className="jp chunk-puzzle-japanese">{chunk.japanese}</div>
                {revealRoles ? (
                  <div className="chunk-puzzle-role muted">
                    {chunk.role.trim() || '—'}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {showLegend ? (
        <div className="chunk-puzzle-legend" aria-label="Puzzle shape key">
          {PUZZLE_LEGEND_ITEMS.map((item) => (
            <div key={item.family} className="chunk-puzzle-legend-item">
              <LegendMini family={item.family} />
              <span>{item.label}</span>
            </div>
          ))}
          <span className="chunk-puzzle-legend-note muted">
            Soft green / amber edges = heuristic fit, not a grammar check
          </span>
        </div>
      ) : null}
    </div>
  );
}
