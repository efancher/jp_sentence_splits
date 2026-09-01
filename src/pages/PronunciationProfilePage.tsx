import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import { getPronunciationProfile } from '../db/repository';
import type { FocusArea, TrendDirection } from '../lib/pronunciationProfile';

/**
 * Cross-sentence shadowing learner profile (docs/ROADMAP.md) — the one
 * aggregate view of pronunciation practice: what keeps coming up as the
 * "Focus on this" issue across every analyzed attempt, and whether overall
 * timing/pitch are trending better. Read-only; every number is recomputed
 * from the per-attempt analysis summaries the shadowing flow already saves
 * (AttemptAnalysisSummary), so there's nothing to seed or maintain.
 */

const WINDOWS = [
  { label: 'All time', days: undefined },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
] as const;

function trendGlyph(trend: TrendDirection): string {
  switch (trend) {
    case 'improving':
      return 'improving';
    case 'worsening':
      return 'getting worse';
    case 'steady':
      return 'holding steady';
    case 'insufficient_data':
      return 'not enough data yet';
  }
}

function TrendLine({ label, trend }: { label: string; trend: TrendDirection }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span>{label}</span>
      <span className="muted">{trendGlyph(trend)}</span>
    </div>
  );
}

function FocusRow({ area }: { area: FocusArea }) {
  return (
    <div className="list-card stack" style={{ gap: '0.35rem' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{area.label}</strong>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {area.category}
        </span>
      </div>
      <div className="muted" style={{ fontSize: '0.85rem' }}>
        Top issue on {area.primaryCount} attempt{area.primaryCount === 1 ? '' : 's'} across{' '}
        {area.sentenceCount} sentence{area.sentenceCount === 1 ? '' : 's'} · {trendGlyph(area.trend)}
        {' · '}last seen {new Date(area.lastSeenAt).toLocaleDateString()}
      </div>
    </div>
  );
}

export function PronunciationProfilePage() {
  const [windowIndex, setWindowIndex] = useState(0);
  const sinceDays = WINDOWS[windowIndex]!.days;
  const profile = useLiveQuery(() => getPronunciationProfile({ sinceDays }), [sinceDays]);

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Pronunciation profile</h2>
          <select
            value={windowIndex}
            onChange={(event) => setWindowIndex(Number(event.target.value))}
          >
            {WINDOWS.map((window, index) => (
              <option key={window.label} value={index}>
                {window.label}
              </option>
            ))}
          </select>
        </div>

        {profile === undefined ? (
          <p className="muted">Loading…</p>
        ) : profile.attemptsAnalyzed === 0 ? (
          <p className="muted">
            No analyzed shadowing attempts in this window yet. Record an attempt on a sentence with
            reference audio and open its analysis to start building a profile.
          </p>
        ) : (
          <>
            {profile.headline ? <p style={{ margin: 0 }}>{profile.headline}</p> : null}
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {profile.attemptsAnalyzed} analyzed attempt
              {profile.attemptsAnalyzed === 1 ? '' : 's'} · {profile.sentencesPracticed} sentence
              {profile.sentencesPracticed === 1 ? '' : 's'}
              {profile.spanDays >= 1 ? ` · over ${Math.round(profile.spanDays)} days` : ''}
            </div>
          </>
        )}
      </section>

      {profile && profile.attemptsAnalyzed > 0 ? (
        <>
          <section className="panel stack">
            <h3 style={{ margin: 0 }}>Overall trend</h3>
            <TrendLine label="Timing" trend={profile.timingTrend} />
            <TrendLine label="Pitch" trend={profile.pitchTrend} />
            <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
              Compares the more recent half of your attempts to the earlier half. Pitch here is
              contour and accent shape, not how high or low your voice sits.
            </p>
          </section>

          <section className="panel stack">
            <h3 style={{ margin: 0 }}>Recurring focus areas</h3>
            {profile.focusAreas.length === 0 ? (
              <p className="muted">Nothing has come up as a top issue yet.</p>
            ) : (
              <div className="stack" style={{ gap: '0.5rem' }}>
                {profile.focusAreas.map((area) => (
                  <FocusRow key={area.kind} area={area} />
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
