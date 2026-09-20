import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { BoundaryEdgeEditor } from '../components/BoundaryEdgeEditor';
import {
  deleteWordBoundaryLabel,
  listWordBoundaryLabels,
  loadWordBoundaryCandidates,
  loadWordBoundaryCandidatesForLinks,
  newWordBoundaryLabelId,
  saveWordBoundaryLabel,
  type WordBoundaryCandidate,
} from '../db/wordBoundaryLabels';
import type { WordBoundaryLabel, WordBoundarySkipReason, WordBoundarySpan } from '../domain/types';
import { useSentenceAudioBlob } from '../hooks/useSentenceAudioBlob';
import { auditionRanges, clampEnd, clampStart } from '../lib/boundaryEditor';
import {
  clearStoredSession,
  getSessionSize,
  type LabelMode,
  loadStoredSession,
  remainingLinkIds,
  saveStoredSession,
  SESSION_SIZES,
  setSessionSize,
  type ItemSampling,
  type SessionSize,
  type StoredLabelSession,
} from '../lib/labelSession';
import { RangePlayer } from '../lib/rangePlayer';
import { getLastSaveTime, saveLabelsFile, unsavedLabelCount } from '../lib/wordBoundaryLabelExport';
import { decodeWithRepair } from '../lib/decodeWithRepair';
import {
  edgeErrors,
  edgesMoved,
  labelReason,
  pickLabelQueue,
  startingSpan,
  stratumCounts,
  stratumOf,
  summarizeErrors,
  WORD_SPAN_VERSION,
  type ErrorSummary,
  type LabelStratum,
} from '../lib/wordBoundaryLabels';

type Mode = LabelMode;

const SKIP_REASONS: { reason: WordBoundarySkipReason; label: string }[] = [
  { reason: 'wrong-word', label: 'Word isn’t in this clip' },
  { reason: 'audio-mismatch', label: 'Audio ≠ sentence text' },
  { reason: 'reduced', label: 'Word is slurred / merged into its neighbour' },
  { reason: 'overlap', label: 'Overlapping speech / music' },
  { reason: 'noisy', label: 'Too noisy' },
  { reason: 'unsure', label: 'Can’t tell' },
];

const RULES_SEEN_KEY = 'wordBoundaryRulesSeen';

/**
 * Hand-labelling of word boundaries (docs/ROADMAP.md "Word-audio ground
 * truth"). Each item shows the automatic span for one target word; drag/nudge
 * the two edges onto where the word really starts and ends, or accept them.
 * The labels are the ground truth the aligner, the mora cut, the pad and the
 * ASR judges are measured against — they are stored separately from a card's
 * loop range (`audioStartMs/EndMs`), because a label is the strict word while a
 * pitch card's range deliberately includes its ending/particle.
 */
export function LabelWordAudioPage() {
  const [phase, setPhase] = useState<'setup' | 'loading' | 'labelling' | 'done'>(() => {
    // A refresh mid-batch goes straight back in (see the mount effect) — don't flash the setup screen.
    const session = loadStoredSession();
    return session && !session.paused ? 'loading' : 'setup';
  });
  const [mode, setMode] = useState<Mode>('random');
  const [size, setSize] = useState<SessionSize>(() => getSessionSize());
  /** The items still to do this run, in order. After a resume this is only what was left. */
  const [queue, setQueue] = useState<WordBoundaryCandidate[]>([]);
  const [index, setIndex] = useState(0);
  /** The whole planned batch (ids) and how many of it were already done before this run — for "3 / 10". */
  const [plannedIds, setPlannedIds] = useState<string[]>([]);
  const [sampling, setSampling] = useState<Record<string, ItemSampling>>({});
  const [doneBefore, setDoneBefore] = useState(0);
  /** Labels made in this page load — what "Undo last" can take back. */
  const [runLabels, setRunLabels] = useState<WordBoundaryLabel[]>([]);
  const [allLabels, setAllLabels] = useState<WordBoundaryLabel[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(() => getLastSaveTime());
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [stored, setStored] = useState<StoredLabelSession | null>(() => loadStoredSession());

  const refresh = async () => {
    const labels = await listWordBoundaryLabels();
    setAllLabels(labels);
    return labels;
  };

  /** Enters labelling for the still-unlabelled items of a stored session. Returns false when none can be shown. */
  async function resume(session: StoredLabelSession, labels: WordBoundaryLabel[]): Promise<boolean> {
    const labelled = new Set(labels.map((l) => l.sentenceVocabularyId));
    const remaining = remainingLinkIds(session, labelled);
    if (remaining.length === 0) {
      clearStoredSession();
      setStored(null);
      setPhase('setup');
      return false;
    }
    setPhase('loading');
    const candidates = await loadWordBoundaryCandidatesForLinks(remaining);
    if (candidates.length === 0) {
      // Everything left has since become unlabellable (no alignment, deleted) — drop the stale plan.
      clearStoredSession();
      setStored(null);
      setPhase('setup');
      return false;
    }
    saveStoredSession({ ...session, paused: false });
    setStored({ ...session, paused: false });
    setMode(session.mode);
    setSampling(session.sampling ?? {});
    setQueue(candidates);
    setIndex(0);
    setPlannedIds(session.linkIds);
    setDoneBefore(session.linkIds.length - remaining.length);
    setRunLabels([]);
    setPhase('labelling');
    return true;
  }

  // First load: read the labels, and pick up a session that a refresh interrupted.
  useEffect(() => {
    void (async () => {
      const labels = await refresh();
      const session = loadStoredSession();
      if (session && !session.paused) await resume(session, labels);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Hands every label on this device to the user as a file (share sheet or download). */
  async function saveFile() {
    const labels = await listWordBoundaryLabels();
    const result = await saveLabelsFile(labels);
    if (result === 'cancelled') return;
    setLastSaved(getLastSaveTime());
    setSaveNote(result === 'shared' ? 'Labels shared.' : 'Labels downloaded as a file.');
  }

  async function start() {
    setPhase('loading');
    setMessage(null);
    setSessionSize(size);
    const pool = await loadWordBoundaryCandidates();
    const picked = pickLabelQueue(pool, mode, size);
    if (picked.length === 0) {
      setPhase('setup');
      setMessage(
        mode === 'targeted'
          ? 'No items in the tricky situations right now (none flagged, mid-word, very short, repeated or with digits/Latin in this pool). Try a random sample.'
          : 'Nothing to label: no confirmed word has both a recording and a cached alignment yet.',
      );
      return;
    }
    // What each drawn item's situation was, and how common it is in the pool — recorded on its label.
    const counts = stratumCounts(pool);
    const drawn: Record<string, ItemSampling> = {};
    for (const c of picked) {
      const stratum = stratumOf(c);
      drawn[c.linkId] = { stratum, stratumCount: counts[stratum], poolSize: pool.length };
    }
    const session: StoredLabelSession = {
      mode,
      linkIds: picked.map((c) => c.linkId),
      sampling: drawn,
      paused: false,
      startedAt: new Date().toISOString(),
    };
    saveStoredSession(session);
    setStored(session);
    setSampling(drawn);
    setQueue(picked);
    setIndex(0);
    setPlannedIds(session.linkIds);
    setDoneBefore(0);
    setRunLabels([]);
    setPhase('labelling');
  }

  async function record(label: WordBoundaryLabel) {
    await saveWordBoundaryLabel(label);
    setRunLabels((prev) => [...prev, label]);
    await refresh();
    if (index + 1 >= queue.length) {
      clearStoredSession();
      setStored(null);
      setPhase('done');
    } else {
      setIndex(index + 1);
    }
  }

  async function undoLast() {
    const last = runLabels[runLabels.length - 1];
    if (!last) return;
    await deleteWordBoundaryLabel(last.id);
    setRunLabels((prev) => prev.slice(0, -1));
    setIndex((i) => Math.max(0, i - 1));
    setPhase('labelling');
    await refresh();
  }

  /** Leave mid-batch. The plan stays stored, so "Resume" picks up exactly where you were. */
  function stopForNow() {
    if (stored) {
      const paused = { ...stored, paused: true };
      saveStoredSession(paused);
      setStored(paused);
    }
    setPhase('setup');
  }

  function discardSession() {
    clearStoredSession();
    setStored(null);
  }

  const random = allLabels.filter((l) => l.sampleKind === 'random');
  const unsaved = unsavedLabelCount(allLabels, lastSaved);
  const labelledIds = useMemo(() => new Set(allLabels.map((l) => l.sentenceVocabularyId)), [allLabels]);
  const leftInStored = stored ? remainingLinkIds(stored, labelledIds).length : 0;
  const plannedSet = new Set(plannedIds);
  const summaryLabels = allLabels.filter((l) => plannedSet.has(l.sentenceVocabularyId));

  return (
    <div className="stack" style={{ maxWidth: 720, margin: '0 auto' }}>
      <h2 style={{ margin: 0 }}>Label word audio</h2>

      {phase === 'setup' && (
        <SetupPanel
          mode={mode}
          onMode={setMode}
          size={size}
          onSize={setSize}
          onStart={() => void start()}
          message={message}
          total={allLabels.length}
          randomCount={random.length}
          unsaved={unsaved}
          saveNote={saveNote}
          onSaveFile={() => void saveFile()}
          resumeInfo={stored && leftInStored > 0 ? { left: leftInStored, planned: stored.linkIds.length } : null}
          onResume={() => stored && void resume(stored, allLabels)}
          onDiscard={discardSession}
        />
      )}

      {phase === 'loading' && <p className="muted">Finding items to label…</p>}

      {phase === 'labelling' && queue[index] && (
        <>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span className="muted">
              {doneBefore + index + 1} / {plannedIds.length}
            </span>
            <span className="chip">{labelReason(queue[index]!.estimates, mode, sampling[queue[index]!.linkId]?.stratum as LabelStratum | undefined)}</span>
            <span className="row" style={{ gap: '0.4rem' }}>
              <button type="button" className="secondary" disabled={runLabels.length === 0} onClick={() => void undoLast()}>
                Undo last
              </button>
              <button type="button" className="secondary" onClick={stopForNow}>
                Stop for now
              </button>
            </span>
          </div>
          <LabelItem key={queue[index]!.linkId} candidate={queue[index]!} mode={mode} sampling={sampling[queue[index]!.linkId]} onSave={record} />
        </>
      )}

      {phase === 'done' && (
        <DonePanel
          session={summaryLabels}
          randomLabels={random}
          unsaved={unsaved}
          saveNote={saveNote}
          onSaveFile={() => void saveFile()}
          onAgain={() => setPhase('setup')}
          onUndo={() => void undoLast()}
          canUndo={runLabels.length > 0}
          size={size}
        />
      )}
    </div>
  );
}

function SetupPanel({
  mode,
  onMode,
  size,
  onSize,
  onStart,
  message,
  total,
  randomCount,
  unsaved,
  saveNote,
  onSaveFile,
  resumeInfo,
  onResume,
  onDiscard,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  size: SessionSize;
  onSize: (s: SessionSize) => void;
  onStart: () => void;
  message: string | null;
  total: number;
  randomCount: number;
  unsaved: number;
  saveNote: string | null;
  onSaveFile: () => void;
  resumeInfo: { left: number; planned: number } | null;
  onResume: () => void;
  onDiscard: () => void;
}) {
  return (
    <section className="panel stack">
      {resumeInfo && (
        <div className="panel stack" style={{ boxShadow: 'none', gap: '0.4rem' }}>
          <strong>You have a batch in progress</strong>
          <span className="muted">
            {resumeInfo.left} of {resumeInfo.planned} left — it picks up exactly where you stopped.
          </span>
          <div className="row" style={{ gap: '0.5rem' }}>
            <button type="button" className="primary" onClick={onResume}>
              Resume
            </button>
            <button type="button" className="secondary" onClick={onDiscard}>
              Discard this batch
            </button>
          </div>
        </div>
      )}
      <p className="muted" style={{ margin: 0 }}>
        Mark where a word really starts and ends in its recording. These labels are the ground truth for improving how the
        app cuts word audio. Every label is saved the moment you finish it, so you can stop any time; accepting a correct
        span is one tap.
      </p>
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }} role="group" aria-label="Batch size">
        <span>Batch size:</span>
        {SESSION_SIZES.map((n) => (
          <button
            key={n}
            type="button"
            className={size === n ? 'primary' : 'secondary'}
            aria-pressed={size === n}
            onClick={() => onSize(n)}
          >
            {n === 1 ? '1 at a time' : n}
          </button>
        ))}
      </div>
      <div className="stack" style={{ gap: '0.4rem' }}>
        <label className="row" style={{ alignItems: 'baseline', gap: '0.5rem' }}>
          <input type="radio" name="mode" checked={mode === 'random'} onChange={() => onMode('random')} />
          <span>
            <strong>Random sample</strong> — picked at random, spread across your books. Measures overall accuracy.
          </span>
        </label>
        <label className="row" style={{ alignItems: 'baseline', gap: '0.5rem' }}>
          <input type="radio" name="mode" checked={mode === 'targeted'} onChange={() => onMode('targeted')} />
          <span>
            <strong>Tricky cases</strong> — picked at random from the situations we want to check (timing flagged
            unreliable, a word ending mid-token, very short words, a word repeated in the sentence, digits or Latin
            letters). Measures accuracy per situation. Both kinds are random — nothing is chosen because it looked
            wrong.
          </span>
        </label>
      </div>
      <div>
        <button type="button" className="primary" onClick={onStart}>
          {resumeInfo ? 'Start a new batch' : 'Start labelling'}
        </button>
      </div>
      {message ? <p className="muted" style={{ margin: 0 }}>{message}</p> : null}
      <p className="muted" style={{ margin: 0 }}>
        {total} labelled so far ({randomCount} from random samples — about 40 is enough for a first look).
      </p>
      <SaveLabels total={total} unsaved={unsaved} note={saveNote} onSave={onSaveFile} />
      <RulesPanel defaultOpen={!hasSeenRules()} />
      <p className="muted" style={{ margin: 0 }}>
        <Link to="/settings">Back to settings</Link>
      </p>
    </section>
  );
}

function SaveLabels({
  total,
  unsaved,
  note,
  onSave,
}: {
  total: number;
  unsaved: number;
  note: string | null;
  onSave: () => void;
}) {
  if (total === 0) return null;
  return (
    <div className="stack" style={{ gap: '0.25rem' }}>
      <p className="muted" style={{ margin: 0 }}>
        Labels are kept on this device only. Save them to a file to keep a copy and to analyse them
        {unsaved > 0 ? ` — ${unsaved} not in a saved file yet.` : ' — all of them are in a saved file.'}
      </p>
      <div className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
        <button type="button" className={unsaved > 0 ? 'primary' : 'secondary'} onClick={onSave}>
          Save labels
        </button>
        {note ? <span className="muted">{note}</span> : null}
      </div>
    </div>
  );
}

function hasSeenRules(): boolean {
  try {
    return window.localStorage.getItem(RULES_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function RulesPanel({ defaultOpen }: { defaultOpen: boolean }) {
  return (
    <details
      open={defaultOpen}
      onToggle={(e) => {
        if (!(e.currentTarget as HTMLDetailsElement).open) {
          try {
            window.localStorage.setItem(RULES_SEEN_KEY, '1');
          } catch {
            // ignore
          }
        }
      }}
    >
      <summary>How to place the edges</summary>
      <div className="stack" style={{ gap: '0.4rem', marginTop: '0.5rem' }}>
        <p style={{ margin: 0 }}>
          <strong>Start</strong> — the earliest moment you hear the first sound of the word, with nothing of the previous
          word before it. For stops (k, t, p) the burst counts as the start.
        </p>
        <p style={{ margin: 0 }}>
          <strong>End</strong> — the moment the last sound has died away, before the next word begins. A whispered or
          devoiced final vowel still counts as part of the word.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Check each edge by ear:</strong> “Hear before” should contain none of the word at the start edge, and
          “Hear after” should begin exactly with its first sound. At the end edge it’s the other way round.
        </p>
        <p style={{ margin: 0 }}>
          The target is the highlighted <em>word only</em> — not the particle or ending after it, even if that’s what a
          card plays. If the clip doesn’t contain the word, or you can’t tell, use “Can’t label this”. If the speaker
          slurs it so a sound merges into the word next to it (に行って sounding like “nitte”), pick “slurred / merged”
          — there is no clean edge to mark, and it is worth counting.
        </p>
      </div>
    </details>
  );
}

function LabelItem({
  candidate,
  mode,
  sampling,
  onSave,
}: {
  candidate: WordBoundaryCandidate;
  mode: Mode;
  sampling?: ItemSampling;
  onSave: (label: WordBoundaryLabel) => Promise<void>;
}) {
  const blob = useSentenceAudioBlob(candidate.audio);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => startingSpan(candidate.estimates)!, [candidate]);
  const [edges, setEdges] = useState<WordBoundarySpan>(shown);
  const [playing, setPlaying] = useState(false);
  const [withContext, setWithContext] = useState(false);
  const [slow, setSlow] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const playerRef = useRef(new RangePlayer());
  const startedAt = useRef(Date.now());

  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);

  useEffect(() => {
    if (!blob) return;
    let cancelled = false;
    void (async () => {
      try {
        const { repairSentenceAudio } = await import('../sync/audioSync');
        const decoded = await decodeWithRepair(blob, candidate.audio.id, repairSentenceAudio);
        if (!cancelled) setBuffer(decoded);
      } catch (err) {
        if (!cancelled) setError(`Couldn’t decode this recording on this device (${err instanceof Error ? err.message : String(err)}).`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob, candidate.audio.id]);

  const durationMs = buffer ? buffer.duration * 1000 : 0;
  const moved = edgesMoved(shown, edges);
  const rate = slow ? 0.5 : 1;

  const playRange = (range: { startMs: number; endMs: number }, loop = false) => {
    if (!buffer) return;
    setPlaying(loop);
    void playerRef.current.play(buffer, range, { rate, onEnded: () => setPlaying(false) });
  };

  const togglePlay = () => {
    if (playing) {
      playerRef.current.stop();
      setPlaying(false);
      return;
    }
    const pad = withContext ? 500 : 0;
    playRange({ startMs: Math.max(0, edges.startMs - pad), endMs: Math.min(durationMs, edges.endMs + pad) }, true);
  };

  const audition = (kind: 'start' | 'end', which: 'outside' | 'inside') => {
    const edge = kind === 'start' ? edges.startMs : edges.endMs;
    playRange(auditionRanges(kind, edge, durationMs)[which]);
  };

  async function finish(verdict: WordBoundaryLabel['verdict'], skipReason?: WordBoundarySkipReason) {
    if (saving) return;
    setSaving(true);
    playerRef.current.stop();
    const label: WordBoundaryLabel = {
      id: newWordBoundaryLabelId(),
      sentenceVocabularyId: candidate.linkId,
      sentenceId: candidate.sentenceId,
      sentenceAudioId: candidate.audio.id,
      bookId: candidate.bookId,
      surfaceForm: candidate.surfaceForm,
      verdict,
      skipReason,
      shown,
      label: verdict === 'skipped' ? undefined : { ...edges },
      estimates: candidate.estimates,
      sampleKind: mode,
      stratum: sampling?.stratum,
      stratumCount: sampling?.stratumCount,
      poolSize: sampling?.poolSize,
      spanVersion: WORD_SPAN_VERSION,
      elapsedMs: Date.now() - startedAt.current,
      createdAt: new Date().toISOString(),
    };
    try {
      await onSave(label);
    } finally {
      setSaving(false);
    }
  }

  const target = candidate.japanese.indexOf(candidate.surfaceForm);

  return (
    <div className="stack">
      <section className="panel stack" style={{ gap: '0.4rem' }}>
        <div className="jp jp-lg">
          {target >= 0 ? (
            <>
              {candidate.japanese.slice(0, target)}
              <span className="karaoke-word-active">{candidate.surfaceForm}</span>
              {candidate.japanese.slice(target + candidate.surfaceForm.length)}
            </>
          ) : (
            candidate.japanese
          )}
        </div>
        <div className="muted">
          Target: <strong className="jp">{candidate.surfaceForm}</strong> — just this word.
        </div>
        <RulesPanel defaultOpen={false} />
      </section>

      {error ? (
        <section className="panel stack">
          <p className="muted" style={{ margin: 0 }}>{error}</p>
          <div>
            <button type="button" className="secondary" disabled={saving} onClick={() => void finish('skipped', 'undecodable')}>
              Skip this one
            </button>
          </div>
        </section>
      ) : null}
      {!buffer && !error ? <p className="muted">Loading audio…</p> : null}

      {buffer && (
        <>
          <section className="panel stack">
            <BoundaryEdgeEditor
              kind="start"
              buffer={buffer}
              edgeMs={edges.startMs}
              otherEdgeMs={edges.endMs}
              onChange={(ms) => setEdges((e) => ({ ...e, startMs: clampStart(ms, e.endMs) }))}
              onAudition={(which) => audition('start', which)}
              disabled={saving}
            />
          </section>
          <section className="panel stack">
            <BoundaryEdgeEditor
              kind="end"
              buffer={buffer}
              edgeMs={edges.endMs}
              otherEdgeMs={edges.startMs}
              onChange={(ms) => setEdges((e) => ({ ...e, endMs: clampEnd(ms, e.startMs, durationMs) }))}
              onAudition={(which) => audition('end', which)}
              disabled={saving}
            />
          </section>

          <section className="panel stack" style={{ gap: '0.5rem' }}>
            <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <button type="button" className="primary" onClick={togglePlay} disabled={saving}>
                {playing ? '■ Stop' : '▶ Play the word'}
              </button>
              <label className="row" style={{ gap: '0.3rem', alignItems: 'center' }}>
                <input type="checkbox" checked={withContext} onChange={(e) => setWithContext(e.target.checked)} />
                with 0.5 s of context
              </label>
              <label className="row" style={{ gap: '0.3rem', alignItems: 'center' }}>
                <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} />
                half speed (lower pitch)
              </label>
            </div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              Word span: {Math.round(edges.startMs)}–{Math.round(edges.endMs)} ms ({Math.round(edges.endMs - edges.startMs)} ms)
              {moved ? ' — edited' : ' — as detected'}
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              <button
                type="button"
                className="primary"
                disabled={saving}
                onClick={() => void finish(moved ? 'corrected' : 'clean')}
              >
                {moved ? 'Save my edits' : 'Both edges are right'}
              </button>
              <button type="button" className="secondary" disabled={saving} onClick={() => setSkipOpen((o) => !o)}>
                Can’t label this…
              </button>
              {moved && (
                <button type="button" className="secondary" disabled={saving} onClick={() => setEdges(shown)}>
                  Reset edges
                </button>
              )}
            </div>
            {skipOpen && (
              <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
                {SKIP_REASONS.map(({ reason, label }) => (
                  <button key={reason} type="button" className="secondary" disabled={saving} onClick={() => void finish('skipped', reason)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const fmt = (n: number) => (Number.isFinite(n) ? `${n > 0 ? '+' : ''}${Math.round(n)}` : '—');
const pct = (n: number) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—');

function EstimatorRow({ name, labels, estimator }: { name: string; labels: WordBoundaryLabel[]; estimator: 'token' | 'mora' }) {
  const errors = edgeErrors(labels, estimator);
  const start: ErrorSummary = summarizeErrors(errors.start);
  const end: ErrorSummary = summarizeErrors(errors.end);
  if (start.n === 0) return null;
  return (
    <tr>
      <td>{name}</td>
      <td>{start.n}</td>
      <td>{fmt(start.medianMs)} / {fmt(end.medianMs)}</td>
      <td>{Math.round(start.medianAbsMs)} / {Math.round(end.medianAbsMs)}</td>
      <td>{pct(start.within50)} / {pct(end.within50)}</td>
    </tr>
  );
}

function DonePanel({
  session,
  randomLabels,
  unsaved,
  saveNote,
  onSaveFile,
  onAgain,
  onUndo,
  canUndo,
  size,
}: {
  size: SessionSize;
  canUndo: boolean;
  session: WordBoundaryLabel[];
  randomLabels: WordBoundaryLabel[];
  unsaved: number;
  saveNote: string | null;
  onSaveFile: () => void;
  onAgain: () => void;
  onUndo: () => void;
}) {
  const clean = session.filter((l) => l.verdict === 'clean').length;
  const corrected = session.filter((l) => l.verdict === 'corrected').length;
  const skipped = session.filter((l) => l.verdict === 'skipped').length;
  return (
    <section className="panel stack">
      <h3 style={{ margin: 0 }}>Session done</h3>
      <p style={{ margin: 0 }}>
        {session.length} items: {clean} accepted as detected, {corrected} corrected, {skipped} skipped.
      </p>
      {randomLabels.some((l) => l.verdict !== 'skipped') && (
        <div className="stack" style={{ gap: '0.25rem' }}>
          <strong>How the automatic cuts compare so far (random samples only)</strong>
          <table>
            <thead>
              <tr>
                <th>Cut</th>
                <th>n</th>
                <th>Median error start / end (ms; + = late)</th>
                <th>Typical miss (ms)</th>
                <th>Within 50 ms</th>
              </tr>
            </thead>
            <tbody>
              <EstimatorRow name="Whole token" labels={randomLabels} estimator="token" />
              <EstimatorRow name="Mora cut" labels={randomLabels} estimator="mora" />
            </tbody>
          </table>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            Small samples are noisy — this becomes meaningful past ~40 random labels.
          </span>
        </div>
      )}
      <SaveLabels total={session.length} unsaved={unsaved} note={saveNote} onSave={onSaveFile} />
      <div className="row" style={{ gap: '0.5rem' }}>
        <button type="button" className="primary" onClick={onAgain}>
          {size === 1 ? 'Label another one' : `Label another ${size}`}
        </button>
        <button type="button" className="secondary" disabled={!canUndo} onClick={onUndo}>
          Undo last
        </button>
      </div>
    </section>
  );
}
