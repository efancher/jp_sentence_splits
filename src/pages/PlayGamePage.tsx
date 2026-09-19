import { Link, useParams } from 'react-router-dom';

import type { GameSignal } from '../domain/types';
import { findGame } from '../games/registry';

/**
 * `/play/:gameId/:signal` — a query-free path on purpose: `useActiveSession`
 * matches a session step's route by exact pathname, so a future `game` planner
 * step could deep-link here without a `?signal=` breaking "Mark complete".
 * `auto` (the hub's default) just requests `weak`; the picker falls back
 * itself when that pool is too small.
 */
export function PlayGamePage() {
  const { gameId, signal } = useParams();
  const game = findGame(gameId);
  if (!game) {
    return (
      <section className="panel stack">
        <p className="muted" style={{ margin: 0 }}>
          No such game.
        </p>
        <Link to="/play">Back to games</Link>
      </section>
    );
  }
  const requested: GameSignal = game.signals.includes(signal as GameSignal)
    ? (signal as GameSignal)
    : 'weak';
  return <game.Component key={`${game.id}:${requested}`} signal={requested} />;
}
