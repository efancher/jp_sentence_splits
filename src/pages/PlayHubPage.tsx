import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';

import { GAME_SIGNALS, SIGNAL_BLURBS, SIGNAL_LABELS } from '../lib/gamePicker';
import { GAMES, type GameDef } from '../games/registry';

function GameCard({ game }: { game: GameDef }) {
  // Live so the pool sizes track review progress, but only ever the *list* —
  // an in-progress round loads its items once (see WordDetectiveGame).
  const navigate = useNavigate();
  const pools = useLiveQuery(() => game.loadPools(), [game]);
  const playable = !!pools && pools.eligible >= game.roundSize;

  return (
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>{game.title}</h3>
      <p className="muted" style={{ margin: 0 }}>
        {game.blurb}
      </p>
      {!pools ? (
        <p className="muted" style={{ margin: 0 }}>
          Loading…
        </p>
      ) : !playable ? (
        <p className="muted" style={{ margin: 0 }}>
          Not enough to play yet: {game.needs} You have {pools.eligible}; a round needs{' '}
          {game.roundSize}.
        </p>
      ) : (
        <>
          <div>
            <button
              type="button"
              className="primary"
              onClick={() => navigate(`/play/${game.id}/auto`)}
            >
              Play a round
            </button>
          </div>
          <div className="row">
            {GAME_SIGNALS.map((signal) => {
              const count = pools.bySignal[signal];
              const enough = count >= game.roundSize;
              return enough ? (
                <Link
                  key={signal}
                  to={`/play/${game.id}/${signal}`}
                  className="chip"
                  title={SIGNAL_BLURBS[signal]}
                >
                  {SIGNAL_LABELS[signal]} ({count})
                </Link>
              ) : (
                <span
                  key={signal}
                  className="chip muted"
                  title={`Only ${count} — a round needs ${game.roundSize}.`}
                >
                  {SIGNAL_LABELS[signal]} ({count}) — not enough yet
                </span>
              );
            })}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
            &ldquo;Play a round&rdquo; aims at your weak spots when there are enough, otherwise
            falls back. Games never change your review schedule.
          </p>
        </>
      )}
    </section>
  );
}

export function PlayHubPage() {
  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Play</h2>
        <p className="muted" style={{ margin: 0 }}>
          Short rounds — a couple of minutes each — built from your own books and history. They
          are a break, not homework: results are kept as a log but never touch your review
          cards.
        </p>
      </section>
      {GAMES.map((game) => (
        <GameCard key={game.id} game={game} />
      ))}
    </div>
  );
}
