import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { BoundaryEdgeEditor } from '../components/BoundaryEdgeEditor';
import {
  deleteWordBoundaryLabel,
  listWordBoundaryLabels,
  loadWordBoundaryCandidates,
  newWordBoundaryLabelId,
  saveWordBoundaryLabel,
  type WordBoundaryCandidate,
} from '../db/wordBoundaryLabels';
import type { WordBoundaryLabel, WordBoundarySkipReason, WordBoundarySpan } from '../domain/types';
import { useSentenceAudioBlob } from '../hooks/useSentenceAudioBlob';
import { auditionRanges, clampEnd, clampStart } from '../lib/boundaryEditor';
import { RangePlayer } from '../lib/rangePlayer';
import { decodeAudioBuffer } from '../lib/waveform';
import {
  edgeErrors,
  edgesMoved,
  labelReason,
  LABEL_SESSION_SIZE,
  pickLabelQueue,
  startingSpan,
  summarizeErrors,
  WORD_SPAN_VERSION,
  type ErrorSummary,
} from '../lib/wordBoundaryLabels';
import { uploadPendingWordBoundaryLabels, type LabelUploadResult } from '../sync/wordBoundaryLabelsRemote';

type Mode = 'random' | 'targeted';

const SKIP_REASONS: { reason: WordBoundarySkipReason; label: string }[] = [
  { reason: 'wrong-word', label: 'Word isn’t in this clip' },
  { reason: 'audio-mismatch', label: 'Audio ≠ sentence text' },
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
  const [phase, setPhase] = useState<'setup' | 'loading' | 'labelling' | 'done'>('setup');
  const [mode, setMode] = useState<Mode>('random');
  const [queue, setQueue] = useState<WordBoundaryCandidate[]>([]);
  const [index, setIndex] = useState(0);
  const [sessionLabels, setSessionLabels] = useState<WordBoundaryLabel[]>([]);
  const [allLabels, setAllLabels] = useState<WordBoundaryLabel[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [upload, setUpload] = useState<LabelUploadResult | null>(null);

  const refresh = async () => setAllLabels(await listWordBoundaryLabels());
  useEffect(() => {
    void refresh();
    void uploadPendingWordBoundaryLabels().then(setUpload);
  }, []);

  async function start() {
    setPhase('loading');
    setMessage(null);
    const pool = await loadWordBoundaryCandidates();
    const picked = pickLabelQueue(pool, mode);
    if (picked.length === 0) {
      setPhase('setup');
      setMessage(
        mode === 'targeted'
          ? 'No items to review right now — the estimators agree on everything left in the pool. Try a random sample.'
          : 'Nothing to label: no confirmed word has both a recording and a cached alignment yet.',
      );
      return;
    }
    setQueue(picked);
    setIndex(0);
    setSessionLabels([]);
    setPhase('labelling');
  }

  async function record(label: WordBoundaryLabel) {
    await saveWordBoundaryLabel(label);
    setSessionLabels((prev) => [...prev, label]);
    await refresh();
    if (index + 1 >= queue.length) {
      setPhase('done');
      void uploadPendingWordBoundaryLabels().then(setUpload);
    } else {
      setIndex(index + 1);
    }
  }

  async function undoLast() {
    const last = sessionLabels[sessionLabels.length - 1];
    if (!last) return;
    await deleteWordBoundaryLabel(last.id);
    setSessionLabels((prev) => prev.slice(0, -1));
    setIndex((i) => Math.max(0, i - 1));
    setPhase('labelling');
    await refresh();
  }

  const random = allLabels.filter((l) => l.sampleKind === 'random');
  const pending = allLabels.filter((l) => !l.uploadedAt).length;

  return (
    <div className="stack" style={{ maxWidth: 720, margin: '0 auto' }}>
      <h2 style={{ margin: 0 }}>Label word audio</h2>

      {phase === 'setup' && (
        <SetupPanel
          mode={mode}
          onMode={setMode}
          onStart={() => void start()}
          message={message}
          total={allLabels.length}
          randomCount={random.length}
          pending={pending}
          upload={upload}
          onUpload={() => void uploadPendingWordBoundaryLabels().then((r) => { setUpload(r); void refresh(); })}
        />
      )}

      {phase === 'loading' && <p className="muted">Finding items to label…</p>}

      {phase === 'labelling' && queue[index] && (
        <>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="muted">
              {index + 1} / {queue.length}
            </span>
            <span className="chip">{labelReason(queue[index]!.estimates, mode)}</span>
            <button type="button" className="secondary" disabled={sessionLabels.length === 0} onClick={() => void undoLast()}>
              Undo last
            </button>
          </div>
          <LabelItem key={queue[index]!.linkId} candidate={queue[index]!} mode={mode} onSave={record} />
        </>
      )}

      {phase === 'done' && (
        <DonePanel
          session={sessionLabels}
          randomLabels={random}
          upload={upload}
          onAgain={() => setPhase('setup')}
          onUndo={() => void undoLast()}
        />
      )}
    </div>
  );
}

function SetupPanel({
  mode,
  onMode,
  onStart,
  message,
  total,
  randomCount,
  pending,
  upload,
  onUpload,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  onStart: () => void;
  message: string | null;
  total: number;
  randomCount: number;
  pending: number;
  upload: LabelUploadResult | null;
  onUpload: () => void;
}) {
  return (
    <section className="panel stack">
      <p className="muted" style={{ margin: 0 }}>
        Mark where a word really starts and ends in its recording. These labels are the ground truth for improving how the
        app cuts word audio. A session is {LABEL_SESSION_SIZE} items (about 10 minutes); accepting a correct span is one
        tap.
      </p>
      <div className="stack" style={{ gap: '0.4rem' }}>
        <label className="row" style={{ alignItems: 'baseline', gap: '0.5rem' }}>
          <input type="radio" name="mode" checked={mode === 'random'} onChange={() => onMode('random')} />
          <span>
            <strong>Random sample</strong> — spread across your books. Use these for an honest measurement.
          </span>
        </label>
        <label className="row" style={{ alignItems: 'baseline', gap: '0.5rem' }}>
          <input type="radio" name="mode" checked={mode === 'targeted'} onChange={() => onMode('targeted')} />
          <span>
            <strong>Needs review</strong> — where the two cutting methods disagree most. Best for fixing problems; not a
            fair sample.
          </span>
        </label>
      </div>
      <div>
        <button type="button" className="primary" onClick={onStart}>
          Start labelling
        </button>
      </div>
      {message ? <p className="muted" style={{ margin: 0 }}>{message}</p> : null}
      <p className="muted" style={{ margin: 0 }}>
        {total} labelled so far ({randomCount} from random samples — about 40 is enough for a first look).
      </p>
      {pending > 0 && (
        <div className="stack" style={{ gap: '0.25rem' }}>
          <UploadStatus upload={upload} pending={pending} />
          <div>
            <button type="button" className="secondary" onClick={onUpload}>
              Upload {pending} pending label{pending === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
      <RulesPanel defaultOpen={!hasSeenRules()} />
      <p className="muted" style={{ margin: 0 }}>
        <Link to="/settings">Back to settings</Link>
      </p>
    </section>
  );
}

function UploadStatus({ upload, pending }: { upload: LabelUploadResult | null; pending: number }) {
  if (upload?.status === 'table-missing') {
    return (
      <p className="muted" style={{ margin: 0 }}>
        {pending} label{pending === 1 ? ' is' : 's are'} saved on this device but the cloud table doesn’t exist yet. Run{' '}
        <code>supabase/migrations/20260920000000_word_boundary_labels.sql</code> in the Supabase SQL editor once; they’ll
        upload automatically after that.
      </p>
    );
  }
  if (upload?.status === 'unavailable') {
    return (
      <p className="muted" style={{ margin: 0 }}>
        {pending} label{pending === 1 ? ' is' : 's are'} waiting to upload{upload.message ? ` (${upload.message})` : ''}.
      </p>
    );
  }
  return (
    <p className="muted" style={{ margin: 0 }}>
      {pending} label{pending === 1 ? ' is' : 's are'} waiting to upload.
    </p>
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
          card plays. If the clip doesn’t contain the word, or you can’t tell, use “Can’t label this”.
        </p>
      </div>
    </details>
  );
}

function LabelItem({
  candidate,
  mode,
  onSave,
}: {
  candidate: WordBoundaryCandidate;
  mode: Mode;
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
    decodeAudioBuffer(blob)
      .then((b) => {
        if (!cancelled) setBuffer(b);
      })
      .catch(() => {
        if (!cancelled) setError('Couldn’t decode this recording on this device.');
      });
    return () => {
      cancelled = true;
    };
  }, [blob]);

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

      {error ? <p className="muted">{error}</p> : null}
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
  upload,
  onAgain,
  onUndo,
}: {
  session: WordBoundaryLabel[];
  randomLabels: WordBoundaryLabel[];
  upload: LabelUploadResult | null;
  onAgain: () => void;
  onUndo: () => void;
}) {
  const clean = session.filter((l) => l.verdict === 'clean').length;
  const corrected = session.filter((l) => l.verdict === 'corrected').length;
  const skipped = session.filter((l) => l.verdict === 'skipped').length;
  const pending = session.filter((l) => !l.uploadedAt).length;
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
      {upload && pending > 0 && <UploadStatus upload={upload} pending={pending} />}
      <div className="row" style={{ gap: '0.5rem' }}>
        <button type="button" className="primary" onClick={onAgain}>
          Label another {LABEL_SESSION_SIZE}
        </button>
        <button type="button" className="secondary" onClick={onUndo}>
          Undo last
        </button>
      </div>
    </section>
  );
}
