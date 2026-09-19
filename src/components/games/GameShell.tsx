import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type GamePhase = 'intro' | 'play' | 'result';

interface GameShellProps {
  title: string;
  phase: GamePhase;
  /** Intro card: what this round is aimed at and why these items. */
  intro: {
    signalLabel: string;
    whyLine: string;
    roundDescription: string;
    onStart: () => void;
  };
  /** Pace bar for the play phase — a position indicator, never a countdown. */
  progress?: { current: number; total: number };
  children: ReactNode;
}

/**
 * Common frame for the short games under `/play` (docs/ROADMAP.md "Short
 * games"): intro → play → result. Games own their round state; the shell only
 * lays out the frame and the intro card so every game reads the same.
 *
 * Deliberate rules baked in here rather than left to each game:
 *  - the round is capped by item count, and the pace bar has no fail state
 *    (no timer to lose to);
 *  - nothing here settles a planner step or navigates away on its own — a
 *    finished round just shows its result, and the learner leaves via the
 *    links (explicit "Mark complete" stays in the SessionBar);
 *  - the "Start" tap is the one user gesture, so anything that needs a
 *    gesture-gated setup (iOS audio/mic) can do it in `onStart`; later audio
 *    is only ever played from a tap handler, never a timer or effect.
 */
export function GameShell({ title, phase, intro, progress, children }: GameShellProps) {
  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <Link to="/play" className="muted" style={{ fontSize: '0.85rem' }}>
            All games
          </Link>
        </div>

        {phase === 'intro' ? (
          <div className="stack">
            <div>
              <span className="chip">{intro.signalLabel}</span>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {intro.whyLine}
            </p>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              {intro.roundDescription} Nothing here changes your review schedule.
            </p>
            <div>
              <button type="button" className="primary" onClick={intro.onStart}>
                Start
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'play' && progress ? (
          <div
            className="progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.current}
            aria-label={`Word ${progress.current} of ${progress.total}`}
          >
            <span style={{ width: `${(progress.current / progress.total) * 100}%` }} />
          </div>
        ) : null}

        {phase !== 'intro' ? children : null}
      </section>
    </div>
  );
}
