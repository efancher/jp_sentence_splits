import { useState } from 'react';

import { levelsToRuns, selfScaledLevels } from '../lib/attemptPitchGrid';
import { CONTOUR_POINTS_PER_MORA, type PhrasePitchResult, type PhraseRow } from '../lib/phrasePitch';

const UNAVAILABLE_TEXT: Record<NonNullable<PhrasePitchResult['unavailable']>, string> = {
  'no-reference-timing':
    'Phrase pitch needs the native audio lined up sound-by-sound, and none of this sentence’s words could be.',
  'no-pitch': 'Not enough voiced native pitch here to show phrases.',
};

const SLOT_W = 26;
const CHART_H = 56;

/**
 * One phrase as a drawn contour: the native's measured pitch (thick) with yours over it (thin), each
 * scaled from its own lowest to highest sound, and the kana under each point. An unvoiced mora breaks
 * the line rather than being bridged.
 */
function PhraseBlock({ row, showLearner }: { row: PhraseRow; showLearner: boolean }) {
  const width = Math.max(row.kana.length, 2) * SLOT_W;
  // The measured contour (4 samples per mora) keeps the line running through devoiced or very short morae,
  // which have no pitch of their own; the per-mora means are the fallback when no contour is stored.
  const contourOf = (contour: readonly (number | null)[] | null | undefined, levels: (number | null)[] | null) =>
    contour && contour.length === row.kana.length * CONTOUR_POINTS_PER_MORA
      ? { levels: selfScaledLevels(contour), pad: SLOT_W / (2 * CONTOUR_POINTS_PER_MORA) }
      : levels && levels.length === row.kana.length
        ? { levels, pad: SLOT_W / 2 }
        : null;
  const native = contourOf(row.nativeContour, row.nativeLevels);
  const learner = showLearner ? contourOf(row.learnerContour, row.learnerLevels) : null;
  const learnerLevels = learner?.levels ?? null;
  return (
    <div className="pp-block">
      <strong className="jp">{row.text}</strong>
      <svg
        width={width}
        height={CHART_H}
        viewBox={`0 0 ${width} ${CHART_H}`}
        role="img"
        aria-label={`Pitch of ${row.text}${learnerLevels ? ', native and yours' : ', native'}`}
      >
        {native
          ? levelsToRuns(native.levels, width, CHART_H, native.pad).map((points, i) => (
              <polyline key={`n${i}`} points={points} className="apg-line apg-line-native" />
            ))
          : null}
        {learner
          ? levelsToRuns(learner.levels, width, CHART_H, learner.pad).map((points, i) => (
              <polyline key={`l${i}`} points={points} className="apg-line apg-line-attempt" data-rank="1" />
            ))
          : null}
      </svg>
      <div className="row pp-kana" style={{ gap: 0 }}>
        {row.kana.map((kana, index) => (
          <span key={index} className="pa-kana jp" style={{ width: SLOT_W, textAlign: 'center' }}>
            {kana}
          </span>
        ))}
      </div>
      {showLearner && learnerLevels === null ? (
        <div className="muted pp-feedback">
          {row.learnerVoicedMorae === null
            ? 'Could not line your recording up with this phrase.'
            : `Could not measure your pitch here — only ${row.learnerVoicedMorae} of ${row.kana.length} sounds had a clear pitch.`}
        </div>
      ) : null}
    </div>
  );
}

/** One button that opens a small note box; sending saves the report (with diagnostics) for later triage. */
function ReportProblem({ onReport }: { onReport: (note: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  if (sent) return <p className="muted" style={{ margin: 0 }}>Reported — it will show up under Reported issues.</p>;
  if (!open) {
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)}>
          Report a problem with this
        </button>
      </div>
    );
  }
  async function send() {
    if (sending) return;
    setSending(true);
    setError('');
    try {
      await onReport(note.trim());
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      <textarea
        aria-label="What looks wrong?"
        placeholder="What looks wrong? (optional)"
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="row" style={{ gap: '0.5rem' }}>
        <button type="button" className="primary" disabled={sending} onClick={() => void send()}>
          {sending ? 'Sending…' : 'Send report'}
        </button>
        <button type="button" disabled={sending} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error ? <p className="muted" style={{ margin: 0 }}>{error}</p> : null}
    </div>
  );
}

/**
 * Phrase-level pitch, native vs you (`buildPhrasePitch`). Each phrase — a content word plus its
 * particles/endings — is drawn as the native's measured contour with yours over it. No H/L labels or
 * accent types: you compare the lines.
 */
export function PhrasePitchView({
  result,
  hasLearner,
  onReport,
}: {
  result: PhrasePitchResult;
  hasLearner: boolean;
  /** Saves a "this looks wrong" report with the panel's diagnostics; omit to hide the button. */
  onReport?: (note: string) => Promise<void>;
}) {
  if (result.unavailable) {
    return (
      <div className="stack" style={{ gap: '0.4rem' }}>
        <p className="muted" style={{ margin: 0 }}>{UNAVAILABLE_TEXT[result.unavailable]}</p>
        {onReport ? <ReportProblem onReport={onReport} /> : null}
      </div>
    );
  }
  const showLearner = hasLearner && !result.learnerUnavailable;
  return (
    <div className="stack pp-view" style={{ gap: '0.4rem' }}>
      <strong>Phrase pitch — native{showLearner ? ' vs you' : ''}</strong>
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
          only be timed roughly, so those parts of your line are less certain.
        </p>
      ) : null}
      {result.rows.map((row, index) => (
        <PhraseBlock key={index} row={row} showLearner={showLearner} />
      ))}
      {onReport ? <ReportProblem onReport={onReport} /> : null}
      <p className="muted" style={{ fontSize: '0.8em', margin: 0 }}>
        Each line is the measured pitch of that phrase’s sounds, scaled from its lowest to its highest — compare the
        shapes, not absolute pitch. The native recording is the answer key.
      </p>
    </div>
  );
}
