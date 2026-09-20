import { phraseFeedback, type PhrasePitchResult, type PhraseRow, type PhraseStatus } from '../lib/phrasePitch';

const STATUS_LABEL: Record<PhraseStatus, string> = {
  match: 'matches',
  different: 'differs',
  flat: 'flat',
  'weak-native': 'unclear',
  'no-learner': 'not measured',
};

const UNAVAILABLE_TEXT: Record<NonNullable<PhrasePitchResult['unavailable']>, string> = {
  'no-reading': 'Phrase pitch needs this sentence’s kana reading.',
  'no-reference-timing':
    'Phrase pitch needs the native audio lined up sound-by-sound; this sentence’s alignment doesn’t line up with its reading (roughly one sentence in four — e.g. a sound effect the aligner couldn’t place, or 今日は said こんにちは).',
  'no-pitch': 'Not enough voiced native pitch here to show phrases.',
};

/** A tiny bar for one mora's height within its phrase — the raw contour, so an invalid shape is visible beside the fitted H/L. */
function LevelBar({ level, label }: { level: number | null; label: string }) {
  return (
    <span className="pp-bar-slot" title={label}>
      {level === null ? (
        <span className="pp-bar pp-bar-none" />
      ) : (
        <span className="pp-bar" style={{ height: `${Math.round(6 + level * 14)}px` }} />
      )}
    </span>
  );
}

function PhraseBlock({ row, showLearner }: { row: PhraseRow; showLearner: boolean }) {
  return (
    <div className="pp-block" data-status={row.status}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
        <strong className="jp">{row.text}</strong>
        {showLearner ? <span className="pp-status">{STATUS_LABEL[row.status]}</span> : null}
      </div>
      <div className="pa-row" role="group" aria-label={`Pitch of ${row.text}`}>
        {row.kana.map((kana, index) => {
          const nativeClass = row.native[index]!;
          const learnerClass = row.learner?.[index];
          return (
            <span key={index} className="pa-mora">
              <span className="pa-kana jp">{kana}</span>
              <span className="pa-hl" data-c={nativeClass} title="Native">
                {nativeClass === 'h' ? 'H' : 'L'}
              </span>
              <LevelBar level={row.nativeLevels[index] ?? null} label="Native pitch height" />
              {showLearner ? (
                <>
                  <span
                    className="pa-hl pa-hl-learner"
                    data-c={learnerClass}
                    data-mismatch={learnerClass && learnerClass !== nativeClass ? '' : undefined}
                    title={
                      learnerClass
                        ? learnerClass === nativeClass
                          ? 'Your recording matches here'
                          : 'Your recording differs here'
                        : 'Your pitch could not be measured on this mora'
                    }
                  >
                    {learnerClass ? (learnerClass === 'h' ? 'H' : 'L') : '·'}
                  </span>
                  <LevelBar level={row.learnerLevels?.[index] ?? null} label="Your pitch height" />
                </>
              ) : null}
            </span>
          );
        })}
      </div>
      {showLearner ? <div className="muted pp-feedback">{phraseFeedback(row)}</div> : (
        <div className="muted pp-feedback">Native: {row.nativeSummary}.</div>
      )}
    </div>
  );
}

/**
 * Phrase-level pitch, native vs you (`buildPhrasePitch`). Each phrase — a content
 * word plus its particles/endings — shows the kana with the native H/L, and under
 * it yours with mismatches flagged, plus a small bar per mora for the raw contour
 * (the fitted H/L snaps to a valid Japanese shape; the bars show what you actually
 * did). One plain line says how each phrase moves and what to change.
 */
export function PhrasePitchView({ result, hasLearner }: { result: PhrasePitchResult; hasLearner: boolean }) {
  if (result.unavailable) {
    return <p className="muted" style={{ margin: 0 }}>{UNAVAILABLE_TEXT[result.unavailable]}</p>;
  }
  const showLearner = hasLearner && !result.learnerUnavailable;
  const judged = result.rows.filter((r) => r.status === 'match' || r.status === 'different' || r.status === 'flat');
  const matches = judged.filter((r) => r.status === 'match').length;
  return (
    <div className="stack pp-view" style={{ gap: '0.4rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong>Phrase pitch — native{showLearner ? ' vs you' : ''}</strong>
        {showLearner && judged.length > 0 ? (
          <span className="muted">
            {matches} of {judged.length} phrases match
          </span>
        ) : null}
      </div>
      {hasLearner && result.learnerUnavailable ? (
        <p className="muted" style={{ margin: 0 }}>
          Your recording couldn’t be lined up with the native words
          {result.learnerUnavailableReason === 'token-count'
            ? ' (the aligner found a different number of words)'
            : result.learnerUnavailableReason === 'no-span'
              ? ' (a word had no measurable timing)'
              : ''}
          , so only the native phrases are shown.
        </p>
      ) : null}
      {showLearner && result.learnerApproximateTokens > 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: '0.85em' }}>
          {result.learnerApproximateTokens} word{result.learnerApproximateTokens === 1 ? '' : 's'} of your recording could
          only be timed roughly, so those H/L marks are less certain.
        </p>
      ) : null}
      {result.rows.map((row, index) => (
        <PhraseBlock key={index} row={row} showLearner={showLearner} />
      ))}
      <p className="muted" style={{ fontSize: '0.8em', margin: 0 }}>
        H/L is fitted from each recording’s measured pitch, per phrase (a word plus its particles); the bars show the raw
        height of each sound. The native recording is the answer key — natives don’t always use the dictionary accent.
      </p>
    </div>
  );
}
