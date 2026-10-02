import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import {
  applyBookParticleReply,
  downloadTextFile,
  findParticleCheckCandidates,
  formatBookParticlePromptForAI,
  parseBookParticleReply,
  type ParticleCheckCandidate,
} from '../lib/particleChecks';

/**
 * Book-wide authoring of the sentence-specific particle questions used by the
 * glossing check. Download one prompt file covering every pending sentence,
 * hand it to an assistant, then upload (or paste) its reply. The reply is
 * matched by sentence number against the list captured at download time.
 */
export function BookParticleCheckBatch({ bookId }: { bookId: string }) {
  const pending = useLiveQuery(() => findParticleCheckCandidates(bookId), [bookId]);
  const [batch, setBatch] = useState<ParticleCheckCandidate[] | null>(null);
  const [pasted, setPasted] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  if (!pending) return null;
  const withMeaning = pending.filter((item) => item.request.translation).length;
  const meaningDone = pending.length > 0 && withMeaning === pending.length;

  function download() {
    const items = pending ?? [];
    setBatch(items);
    downloadTextFile(`particle-checks-${bookId}.txt`, formatBookParticlePromptForAI(items.map((item) => item.request)));
    setStatus(`Downloaded a prompt for ${items.length} sentences. Upload the assistant's reply below.`);
  }

  async function loadFile(file: File | undefined) {
    if (file) setPasted(await file.text());
  }

  async function apply() {
    if (!batch) return;
    const parsed = parseBookParticleReply(pasted, batch.length);
    const saved = await applyBookParticleReply(batch, parsed);
    const unusable = parsed.filter((entry) => entry === null).length;
    setStatus(`Saved ${saved} of ${batch.length} sentences${unusable ? `; ${unusable} had no usable section and stay pending` : ''}.`);
    setPasted('');
    setBatch(null);
  }

  return (
    <details className="panel">
      <summary>Particle checks: contextual questions ({pending.length} sentences pending)</summary>
      <div className="stack" style={{ marginTop: '0.75rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          The glossing check asks about particles (に で と を は から …) in the sentence&rsquo;s own words (&ldquo;what is
          the bin to the putting?&rdquo;) instead of generic roles. Without one, a sentence falls
          back to the generic question.
        </p>
        {pending.length === 0 ? (
          <div className="muted">Nothing pending.</div>
        ) : (
          <div role="status" style={{ fontSize: '0.9rem' }}>
            <strong>{meaningDone ? '✓' : '⚠'}</strong>{' '}
            {withMeaning} of {pending.length} pending sentences have an English meaning.{' '}
            {meaningDone ? (
              'The prompt will include them.'
            ) : (
              <span className="muted">
                Do translations / meaning choices first (the panel above): the prompt includes the
                meaning when it exists, and answers are more reliable with it. Sentences you apply now
                aren&rsquo;t redone later.
              </span>
            )}
          </div>
        )}
        {pending.length === 0 ? null : (
          <div className="row">
            <button type="button" onClick={download}>Download prompt file ({pending.length})</button>
          </div>
        )}
        {batch ? (
          <>
            <label className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
              Reply file{' '}
              <input type="file" accept=".txt,.md,text/plain" onChange={(event) => void loadFile(event.target.files?.[0])} />
            </label>
            <textarea
              rows={8}
              placeholder={`…or paste the reply here (${batch.length} "=== Sentence N ===" sections)`}
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
            />
            <div className="row">
              <button type="button" className="primary" disabled={!pasted.trim()} onClick={() => void apply()}>
                Apply reply
              </button>
              <button type="button" onClick={() => setBatch(null)}>Cancel</button>
            </div>
          </>
        ) : null}
        {status ? <div className="muted" style={{ fontSize: '0.85rem' }}>{status}</div> : null}
      </div>
    </details>
  );
}
