import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BOOK_EXTRA_LABELS,
  planBookAssistExtras,
  saveBookAssistExtras,
  selectionOf,
  type BookExtrasPlan,
  type BookExtrasRunSnapshot,
} from '../lib/bookAssistExtras';
import { AssistRunActivity } from './AssistRunActivity';
import { BOOK_EXTRA_KINDS, type BookExtraKind } from '../lib/bookAssistRun';
import type { AssistBackend } from '../lib/assistRun';
import {
  cancelAssistRun,
  deleteAssistRun,
  getAssistRun,
  startBookExtrasRun,
  type AssistRunStatus,
} from '../lib/miningApi';

const ASSIST_BACKEND_KEY = 'quickmine.assistBackend';
const snapshotKey = (bookId: string) => `bookextras.snapshot.${bookId}`;
const savedKey = (bookId: string) => `bookextras.saved.${bookId}`;
const runIdFor = (bookId: string) => `book-extras-${bookId}`;

function loadSavedTaskIds(bookId: string): Set<string> {
  try {
    const raw = localStorage.getItem(savedKey(bookId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function loadSnapshot(bookId: string): BookExtrasRunSnapshot | null {
  try {
    const raw = localStorage.getItem(snapshotKey(bookId));
    return raw ? (JSON.parse(raw) as BookExtrasRunSnapshot) : null;
  } catch {
    return null;
  }
}

function formatSaved(result: Awaited<ReturnType<typeof saveBookAssistExtras>>): string {
  const parts = BOOK_EXTRA_KINDS.flatMap((kind) => {
    const saved = result.saved[kind];
    const kept = result.keptExisting[kind];
    if (!saved && !kept) return [];
    const bits = [`${saved ?? 0} saved`];
    if (kept) bits.push(`${kept} kept (gained one while the run was going)`);
    return [`${BOOK_EXTRA_LABELS[kind].label}: ${bits.join(', ')}`];
  });
  const text = parts.length > 0 ? parts.join('; ') : 'Nothing new to save.';
  return result.problems.length > 0 ? `${text} Notes: ${result.problems.join(' ')}` : text;
}

/**
 * Generates the per-sentence extras for an existing book on the mining box (same assistant as Quick import),
 * in the background. Sentences that already have an extra are never touched unless the learner approves replacing them.
 */
export function BookAssistExtras({ bookId }: { bookId: string }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<BookExtrasPlan | null>(null);
  const [include, setInclude] = useState<Set<BookExtraKind>>(new Set());
  const [replace, setReplace] = useState<Record<BookExtraKind, Set<number>>>(() => emptyReplace());
  const [reviewing, setReviewing] = useState<BookExtraKind | null>(null);
  const [backend, setBackend] = useState<AssistBackend>(() => (localStorage.getItem(ASSIST_BACKEND_KEY) as AssistBackend | null) ?? 'auto');
  const [run, setRun] = useState<AssistRunStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runRef = useRef<AssistRunStatus | null>(null);
  runRef.current = run;
  const savingRef = useRef(false);

  const refreshPlan = useCallback(async () => setPlan(await planBookAssistExtras(bookId)), [bookId]);

  // Each finished piece is written onto the book as soon as the box reports it, so a run that stops partway
  // (credits, a crash, a discard) never loses work. Only pieces not yet saved are sent.
  const savePending = useCallback(
    async (replies: Readonly<Record<string, string>>): Promise<boolean> => {
      const snap = loadSnapshot(bookId);
      if (!snap || savingRef.current) return false;
      const saved = loadSavedTaskIds(bookId);
      const fresh = Object.fromEntries(Object.entries(replies).filter(([id]) => !saved.has(id)));
      if (Object.keys(fresh).length === 0) return true;
      savingRef.current = true;
      try {
        const result = await saveBookAssistExtras(snap, fresh);
        if (result.problems.length > 0) {
          setMessage(formatSaved(result));
          return false;
        }
        for (const id of Object.keys(fresh)) saved.add(id);
        localStorage.setItem(savedKey(bookId), JSON.stringify([...saved]));
        const text = formatSaved(result);
        setMessage(text);
        await refreshPlan();
        return true;
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Could not save the results.');
        return false;
      } finally {
        savingRef.current = false;
      }
    },
    [bookId, refreshPlan],
  );

  useEffect(() => {
    if (!open) return;
    void refreshPlan().catch((err) => setMessage(err instanceof Error ? err.message : 'Could not load the book.'));
    let stopped = false;
    const poll = async () => {
      try {
        const next = await getAssistRun(runIdFor(bookId));
        if (stopped || !next) return;
        if (!loadSnapshot(bookId) && next.selection) {
          // The run was started on another device or browser (a Safari tab and the home-screen app keep separate storage): re-attach to it.
          const current = await planBookAssistExtras(bookId);
          if (next.bookSentences?.length === current.sentences.length && next.bookSentences.every((sentence, index) => {
            const here = current.sentences[index]!;
            return sentence.handle === here.handle && sentence.japanese === here.japanese && sentence.translation === here.translation;
          })) {
            const kinds: BookExtrasRunSnapshot['kinds'] = {};
            for (const kind of BOOK_EXTRA_KINDS) {
              const handles = next.selection[kind];
              if (handles?.length) kinds[kind] = { handles, replaceHandles: [] };
            }
            localStorage.setItem(snapshotKey(bookId), JSON.stringify({ bookId, sentenceIds: current.sentences.map((s) => s.id), kinds }));
          } else {
            setMessage('A run exists on the server, but its original sentences could not be verified against this book. Open it on the device that started it, or update the server and try again.');
          }
        }
        setRun(next);
        if (next.extraReplies) await savePending(next.extraReplies);
      } catch {
        // box unreachable (off the tailnet): leave the last known state
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (!runRef.current || runRef.current.status === 'running') void poll();
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [open, bookId, refreshPlan, savePending]);

  const snapshot = loadSnapshot(bookId);
  const active = run && snapshot;

  function toggleInclude(kind: BookExtraKind) {
    setInclude((current) => {
      const next = new Set(current);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });
  }

  function setReplaceAll(kind: BookExtraKind, on: boolean) {
    if (!plan) return;
    setReplace((current) => ({ ...current, [kind]: new Set(on ? plan.kinds[kind].existing.map((e) => e.handle) : []) }));
  }

  function toggleReplaceOne(kind: BookExtraKind, handle: number) {
    setReplace((current) => {
      const next = new Set(current[kind]);
      if (!next.delete(handle)) next.add(handle);
      return { ...current, [kind]: next };
    });
  }

  const selected = plan
    ? BOOK_EXTRA_KINDS.filter((kind) => include.has(kind)).map((kind) => ({
        kind,
        handles: [...plan.kinds[kind].missing, ...replace[kind]].sort((a, b) => a - b),
        replaceHandles: [...replace[kind]].sort((a, b) => a - b),
      }))
    : [];
  const totalPieces = selected.reduce((sum, item) => sum + item.handles.length, 0);

  async function start() {
    if (!plan || totalPieces === 0) return;
    setBusy(true);
    setMessage(null);
    const next: BookExtrasRunSnapshot = {
      bookId,
      sentenceIds: plan.sentences.map((s) => s.id),
      kinds: Object.fromEntries(
        selected.filter((item) => item.handles.length > 0).map((item) => [item.kind, { handles: item.handles, replaceHandles: item.replaceHandles }]),
      ),
    };
    try {
      setRun(
        await startBookExtrasRun({
          runId: runIdFor(bookId),
          sentences: plan.sentences.map((s) => ({ handle: s.handle, japanese: s.japanese, translation: s.translation })),
          selection: selectionOf(next) as Record<string, number[]>,
          backend,
        }),
      );
      localStorage.setItem(snapshotKey(bookId), JSON.stringify(next));
      localStorage.removeItem(savedKey(bookId));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not start the assistant.');
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    if (!plan || !snapshot) return;
    setBusy(true);
    setMessage(null);
    try {
      setRun(
        await startBookExtrasRun({
          runId: runIdFor(bookId),
          sentences: snapshot.sentenceIds.map((id, index) => {
            const sentence = plan.sentences.find((s) => s.id === id);
            return { handle: index + 1, japanese: sentence?.japanese ?? '', translation: sentence?.translation ?? '' };
          }),
          selection: selectionOf(snapshot) as Record<string, number[]>,
          backend,
        }),
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not resume the assistant.');
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    await deleteAssistRun(runIdFor(bookId));
    localStorage.removeItem(snapshotKey(bookId));
    localStorage.removeItem(savedKey(bookId));
    setRun(null);
    setMessage(null);
  }

  async function saveResults() {
    if (!run || !snapshot) return;
    setBusy(true);
    try {
      if (!(await savePending(run.extraReplies ?? {}))) return;
      await discard();
      await refreshPlan();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save the results.');
    } finally {
      setBusy(false);
    }
  }

  async function saveOnly() {
    if (!run || savingRef.current) return;
    setBusy(true);
    try {
      // Forget which pieces were saved, so a save that failed or was lost is attempted again; saving only fills sentences still missing.
      localStorage.removeItem(savedKey(bookId));
      await savePending(run.extraReplies ?? {});
    } finally {
      setBusy(false);
    }
  }

  const finishedPieces = Object.keys(run?.extraReplies ?? {}).length;

  return (
    <details className="panel" onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary>Generate extras with the assistant (in the background)</summary>
      <div className="stack" style={{ marginTop: '0.75rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          Runs the same assistant as Quick import on the server, over the whole book, and keeps going if you close this
          page. Tick the extras you want; by default only sentences that don't have one yet are sent. Sentences that already
          have one are left alone unless you choose to replace them.
        </p>

        {active ? (
          <div className="stack" style={{ gap: '0.4rem' }}>
            <div>
              {run.status === 'running'
                ? `Working: ${run.progress || 'starting…'}`
                : run.status === 'done'
                  ? 'Finished.'
                  : `Stopped (${run.status}).`}{' '}
              <span className="muted">{finishedPieces} part{finishedPieces === 1 ? '' : 's'} done</span>
            </div>
            <AssistRunActivity run={run} />
            {run.failure ? <div className="error">{run.failure}</div> : null}
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              {run.status === 'running' ? (
                <button type="button" onClick={() => void cancelAssistRun(runIdFor(bookId))}>Stop</button>
              ) : (
                <>
                  {run.status !== 'done' ? (
                    <button type="button" disabled={busy || !plan} onClick={() => void resume()}>Resume</button>
                  ) : null}
                  <button type="button" className="primary" disabled={busy || finishedPieces === 0} onClick={() => void saveOnly()}>
                    Save
                  </button>
                  <button type="button" disabled={busy || finishedPieces === 0} onClick={() => void saveResults()}>
                    {run.status === 'done' ? 'Save and clear' : 'Save what finished and clear'}
                  </button>
                  <button type="button" disabled={busy} onClick={() => void discard()}>Discard</button>
                </>
              )}
            </div>
          </div>
        ) : null}

        {!active && !plan ? <div className="muted">Loading…</div> : null}
        {!active && plan ? (
          <>
            {BOOK_EXTRA_KINDS.map((kind) => {
              const status = plan.kinds[kind];
              const labels = BOOK_EXTRA_LABELS[kind];
              const replacing = replace[kind].size;
              const total = status.missing.length + replacing;
              return (
                <div key={kind} className="stack" style={{ gap: '0.25rem' }}>
                  <label className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                    <input type="checkbox" checked={include.has(kind)} onChange={() => toggleInclude(kind)} />
                    <span>
                      <strong>{labels.label}</strong> <span className="muted">— {labels.hint}</span>
                    </span>
                  </label>
                  <div className="muted" style={{ marginLeft: '1.6rem', fontSize: '0.9rem' }}>
                    {status.missing.length} without · {status.existing.length} already have {labels.existingNoun}
                    {include.has(kind) ? ` · will generate for ${total}` : ''}
                  </div>
                  {include.has(kind) && status.existing.length > 0 ? (
                    <div className="stack" style={{ marginLeft: '1.6rem', gap: '0.25rem' }}>
                      <label className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={replacing === status.existing.length}
                          onChange={(event) => setReplaceAll(kind, event.target.checked)}
                        />
                        <span>Replace the {status.existing.length} existing too</span>
                      </label>
                      <button
                        type="button"
                        className="link"
                        style={{ alignSelf: 'flex-start' }}
                        onClick={() => setReviewing(reviewing === kind ? null : kind)}
                      >
                        {reviewing === kind ? 'Hide the list' : `Review the ${status.existing.length} existing…`}
                      </button>
                      {reviewing === kind ? (
                        <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', maxHeight: '16rem', overflowY: 'auto' }}>
                          {status.existing.map((entry) => {
                            const sentence = plan.sentences[entry.handle - 1];
                            return (
                              <li key={entry.handle}>
                                <label className="row" style={{ alignItems: 'flex-start', gap: '0.5rem' }}>
                                  <input
                                    type="checkbox"
                                    checked={replace[kind].has(entry.handle)}
                                    onChange={() => toggleReplaceOne(kind, entry.handle)}
                                  />
                                  <span>
                                    {sentence?.japanese}
                                    <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>{entry.summary}</span>
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <button type="button" className="primary" disabled={busy || Boolean(run) || totalPieces === 0} onClick={() => void start()}>
                Generate ({totalPieces} sentence-extras)
              </button>
              <label className="row" style={{ gap: '0.35rem' }}>
                <span className="muted">Primary</span>
                <select
                  value={backend}
                  onChange={(event) => {
                    const next = event.target.value as AssistBackend;
                    setBackend(next);
                    localStorage.setItem(ASSIST_BACKEND_KEY, next);
                  }}
                >
                  <option value="auto">Auto (Codex first)</option>
                  <option value="codex">Codex</option>
                  <option value="claude">Claude</option>
                </select>
              </label>
            </div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              Needs the mining box (tailnet). It handles about 100 sentences per assistant call (25 for walkthroughs), one call at a time, so a long
              book takes a while and waits behind any Quick import in progress. Each finished part is saved onto the book
              as soon as this page sees it (open it again later to catch up); focus targets are not part of this.
            </div>
          </>
        ) : null}
        {message ? <div className="muted">{message}</div> : null}
      </div>
    </details>
  );
}

function emptyReplace(): Record<BookExtraKind, Set<number>> {
  return Object.fromEntries(BOOK_EXTRA_KINDS.map((kind) => [kind, new Set<number>()])) as Record<BookExtraKind, Set<number>>;
}
