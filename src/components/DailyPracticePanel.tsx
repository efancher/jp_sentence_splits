import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';

import { readSettings } from '../db/database';
import {
  getDailyPracticeCounts,
  getPitchAccentDrillWords,
  getPitchAccentFocusWords,
} from '../db/repository';
import { buildDailyPractice, dailyPracticeProgress, type DailyPracticeInput } from '../lib/dailyPractice';

/**
 * Today's small set of practice targets (docs/ROADMAP.md "Daily practice"):
 * "say 5 pitch-drill words". Not SRS and not session steps — progress is
 * counted live from the drill's own log, so it ticks itself and there's
 * nothing to mark complete by hand.
 */
export function DailyPracticePanel() {
  const navigate = useNavigate();
  const settings = useLiveQuery(() => readSettings(), []);
  const counts = useLiveQuery(() => getDailyPracticeCounts(), []);
  const drillWords = useLiveQuery(() => getPitchAccentDrillWords(), []);
  const focusWords = useLiveQuery(() => getPitchAccentFocusWords(), []);

  if (!counts || !settings || !drillWords || !focusWords) return null;

  const input: DailyPracticeInput = {
    quietMode: settings.quietMode ?? false,
    pitchDrill: {
      available: drillWords.length > 0 && !(settings.pitchAccentPaused ?? false),
      focusWordCount: focusWords.length,
      takesToday: counts.pitchDrillTakes,
    },
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
