import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { readSettings } from '../db/database';
import {
  getDailyPracticeCounts,
  getPitchAccentDrillWords,
  getPitchAccentFocusWords,
} from '../db/repository';
import { GAMES } from '../games/registry';
import {
  buildDailyPractice,
  dailyPracticeProgress,
  ODD_EAR_OUT_PRACTICE_ID,
  rotatingGameOrder,
  type DailyPracticeInput,
} from '../lib/dailyPractice';

/**
 * Today's small set of practice targets (docs/ROADMAP.md "Daily practice"):
 * "say 5 pitch-drill words", "one Odd Ear Out round", plus one rotating game.
 * Not SRS and not session steps — progress is counted live from the logs the
 * activities already write, so it ticks itself and there's nothing to mark
 * complete by hand. Whether a game can actually fill a round is checked once
 * on mount (the hub does the same `loadPools` check); until then a game is
 * assumed playable, and one found not to be is simply left out.
 */
export function DailyPracticePanel() {
  const navigate = useNavigate();
  const settings = useLiveQuery(() => readSettings(), []);
  const counts = useLiveQuery(() => getDailyPracticeCounts(), []);
  const drillWords = useLiveQuery(() => getPitchAccentDrillWords(), []);
  const focusWords = useLiveQuery(() => getPitchAccentFocusWords(), []);

  // One-shot playability check for the games we might recommend.
  const [playable, setPlayable] = useState<Record<string, boolean>>({});
  const [rotatingGameId, setRotatingGameId] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const known: Record<string, boolean> = {};
      const check = async (gameId: string) => {
        const game = GAMES.find((entry) => entry.id === gameId);
        if (!game) return false;
        try {
          const pools = await game.loadPools();
          return pools.eligible >= game.roundSize;
        } catch {
          return false;
        }
      };
      known[ODD_EAR_OUT_PRACTICE_ID] = await check(ODD_EAR_OUT_PRACTICE_ID);
      let chosen: string | undefined;
      const others = GAMES.filter((game) => game.id !== ODD_EAR_OUT_PRACTICE_ID).map((game) => game.id);
      for (const gameId of rotatingGameOrder(others, new Date())) {
        known[gameId] = await check(gameId);
        if (known[gameId]) {
          chosen = gameId;
          break;
        }
      }
      if (!cancelled) {
        setPlayable(known);
        setRotatingGameId(chosen);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!counts || !settings || !drillWords || !focusWords) return null;

  const rotating = GAMES.find((game) => game.id === rotatingGameId);
  const input: DailyPracticeInput = {
    quietMode: settings.quietMode ?? false,
    pitchDrill: {
      available: drillWords.length > 0,
      focusWordCount: focusWords.length,
      takesToday: counts.pitchDrillTakes,
    },
    oddEarOut: {
      available: playable[ODD_EAR_OUT_PRACTICE_ID] ?? true,
      roundsToday: counts.roundsByGame[ODD_EAR_OUT_PRACTICE_ID] ?? 0,
    },
    rotatingGame: rotating
      ? { id: rotating.id, title: rotating.title, roundsToday: counts.roundsByGame[rotating.id] ?? 0 }
      : undefined,
  };
  const items = buildDailyPractice(input);
  if (items.length === 0) return null;
  const { done, total } = dailyPracticeProgress(items);

  return (
    <section className="panel stack" aria-label="Daily practice">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>Daily practice</h3>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {done}/{total} done today
        </span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Extra reps outside your review schedule — nothing here changes your cards.
      </p>
      <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((entry) => (
          <li key={entry.id} className="list-card stack" style={{ gap: '0.3rem' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong>
                {entry.complete ? '✓ ' : ''}
                {entry.title}
              </strong>
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                {Math.min(entry.done, entry.target)}/{entry.target} {entry.unit}
                {entry.target === 1 ? '' : 's'}
              </span>
            </div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {entry.detail}
            </div>
            <div className="progress-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((Math.min(entry.done, entry.target) / entry.target) * 100)}%` }} />
            </div>
            <div>
              <button
                type="button"
                className={entry.complete ? 'ghost' : 'primary'}
                onClick={() => navigate(entry.path)}
              >
                {entry.complete ? 'Do more' : entry.done > 0 ? 'Continue' : 'Start'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
