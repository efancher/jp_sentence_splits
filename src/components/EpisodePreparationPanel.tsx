import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';

import {
  clearEpisodePreparation,
  getEpisodePreparationContext,
  saveEpisodePreparationReply,
  updatePreparedTarget,
} from '../db/repository';
import { buildPreparationPrompt, isPreparationStale } from '../lib/episodePreparation';

/**
 * Optional, inspectable whole-episode preparation: copy a prompt, paste the AI's
 * JSON reply, and see exactly which targets survived validation. Nothing here
 * gates reading or schedules anything.
 */
export function EpisodePreparationPanel({ bookId, chapterId }: { bookId: string; chapterId: string }) {
  const loaded = useLiveQuery(
    () => getEpisodePreparationContext(bookId, chapterId).catch(() => null),
    [bookId, chapterId],
  );
  const [reply, setReply] = useState('');
  const [message, setMessage] = useState<string>();
  const [copied, setCopied] = useState(false);
  const prompt = useMemo(() => (loaded ? buildPreparationPrompt(loaded.context) : ''), [loaded]);

  if (!loaded) return null;
  const { context, preparation } = loaded;
  const stale = preparation ? isPreparationStale(preparation, context.sentences) : false;
  const usable = preparation && preparation.targets.length > 0;

  async function submit() {
    setMessage(undefined);
    const result = await saveEpisodePreparationReply(bookId, chapterId, reply);
    if (result.status === 'failed') {
      setMessage(`Could not use that reply: ${result.error ?? 'unknown problem'}${usable ? ' Your earlier result was kept.' : ''}`);
    } else {
      setReply('');
      setMessage(result.status === 'partial' ? 'Saved; some proposed targets were rejected (listed below).' : 'Saved.');
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch {
      setCopied(false);
      setMessage('Copy failed; select the prompt text above and copy it manually.');
    }
  }

  return (
    <details className="episode-preparation">
      <summary>
        Episode preparation (optional)
        {preparation ? ` — ${stale ? 'out of date' : preparation.status}` : ''}
      </summary>
      <div className="stack" style={{ gap: '0.5rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          Ask an AI which words and patterns matter across this whole episode. You see the prompt and the reply;
          anything it invents (unknown sentences, ids or quoted text) is rejected. Reading never waits on this.
        </p>
        <label className="stack" style={{ gap: '0.25rem' }}>
          <span>Prompt to copy</span>
          <textarea readOnly rows={4} value={prompt} aria-label="Preparation prompt" />
        </label>
        <div className="row">
          <button type="button" onClick={() => void copyPrompt()}>{copied ? 'Copied' : 'Copy prompt'}</button>
        </div>
        <label className="stack" style={{ gap: '0.25rem' }}>
          <span>Paste the AI reply</span>
          <textarea rows={4} value={reply} onChange={(event) => setReply(event.target.value)} aria-label="AI reply" />
        </label>
        <div className="row">
          <button type="button" className="primary" disabled={!reply.trim()} onClick={() => void submit()}>
            Check and save reply
          </button>
        </div>
        {message ? <p role="status" style={{ margin: 0 }}>{message}</p> : null}

        {preparation ? (
          <div className="stack" style={{ gap: '0.35rem' }}>
            <p className="muted" style={{ margin: 0 }}>
              Status: {stale ? 'out of date (the episode changed since this was prepared)' : preparation.status}
              {' · '}from a pasted AI reply · {new Date(preparation.preparedAt).toLocaleString()}
            </p>
            {preparation.status === 'failed' && preparation.error ? <p style={{ margin: 0 }}>{preparation.error}</p> : null}
            <ul style={{ margin: 0 }}>
              {preparation.targets.map((target) => (
                <li key={target.id} style={{ opacity: target.decision === 'dismissed' ? 0.55 : 1 }}>
                  <strong className="jp">{target.label}</strong>
                  <span className="muted">
                    {' '}({target.kind}, {target.treatment === 'gloss_only' ? 'gloss only' : target.treatment}
                    {target.decision !== 'suggested' ? `, ${target.decision}` : ''}) · in {target.occurrences.length}{' '}
                    {target.occurrences.length === 1 ? 'place' : 'places'}
                  </span>
                  {target.reason ? <div className="muted">{target.reason}</div> : null}
                  <div className="row" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
                    <button
                      type="button"
                      onClick={() => void updatePreparedTarget(bookId, chapterId, target.id, { decision: 'accepted' })}
                      aria-pressed={target.decision === 'accepted'}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void updatePreparedTarget(bookId, chapterId, target.id, {
                          decision: target.decision === 'dismissed' ? 'suggested' : 'dismissed',
                        })
                      }
                    >
                      {target.decision === 'dismissed' ? 'Restore' : 'Dismiss'}
                    </button>
                    <input
                      type="text"
                      aria-label={`Your note on ${target.label}`}
                      placeholder="Your note"
                      defaultValue={target.learnerNote ?? ''}
                      onBlur={(event) => {
                        if (event.target.value.trim() !== (target.learnerNote ?? '')) {
                          void updatePreparedTarget(bookId, chapterId, target.id, { learnerNote: event.target.value });
                        }
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {preparation.rejected.length > 0 ? (
              <div>
                <span className="muted">Rejected by validation:</span>
                <ul style={{ margin: 0 }}>
                  {preparation.rejected.map((item, index) => (
                    <li key={`${item.label}-${index}`} className="muted">
                      <span className="jp">{item.label}</span>: {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="row">
              <button type="button" onClick={() => void clearEpisodePreparation(bookId, chapterId)}>
                Clear preparation
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
