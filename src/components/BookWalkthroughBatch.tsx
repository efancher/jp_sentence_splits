import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import { saveContextWalkthroughsByChapter } from '../db/repository';
import {
  formatBookWalkthroughPrompt,
  nextWalkthroughBatch,
  parseBookWalkthroughReply,
  planBookWalkthroughs,
  type BookWalkthroughPlan,
} from '../lib/bookWalkthroughs';
import { downloadTextFile } from '../lib/particleChecks';

/**
 * Book-wide import of contextual walkthroughs for existing books: download a prompt for the next batch of
 * sentences without one, upload the reply. Each reply merges into the chapters, so several can be applied in turn.
 */
export function BookWalkthroughBatch({ bookId }: { bookId: string }) {
  const plan = useLiveQuery(() => planBookWalkthroughs(bookId), [bookId]);
  const [asked, setAsked] = useState<BookWalkthroughPlan | null>(null);
  const [pasted, setPasted] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  if (!plan) return null;

  function download() {
    if (!plan) return;
    const handles = nextWalkthroughBatch(plan);
    setAsked(plan);
    downloadTextFile(`walkthroughs-${bookId}-${handles[0]}-${handles[handles.length - 1]}.txt`, formatBookWalkthroughPrompt(plan, handles));
    setStatus(`Downloaded a prompt for ${handles.length} sentences (${handles[0]}–${handles[handles.length - 1]}). Upload the assistant's reply below; ${plan.pending.length - handles.length} more will remain.`);
  }

  async function loadFile(file: File | undefined) {
    if (file) setPasted(await file.text());
  }

  async function apply() {
    if (!asked) return;
    const parsed = parseBookWalkthroughReply(pasted, asked);
    if (parsed.error) {
      setStatus(`Could not use that reply: ${parsed.error} Nothing was changed.`);
      return;
    }
    await saveContextWalkthroughsByChapter(bookId, parsed.byChapter);
    const note = parsed.rejected[0] ? ` ${parsed.rejected.length} had problems, e.g. ${parsed.rejected[0].handle}: ${parsed.rejected[0].reason}` : '';
    const left = (await planBookWalkthroughs(bookId)).pending.length;
    setStatus(`Saved explanations for ${parsed.saved} sentences.${note} ${left === 0 ? 'Nothing left to do.' : `${left} still pending; download the next batch (a failed or cut-off batch is simply requested again).`}`);
    setPasted('');
    setAsked(null);
  }

  return (
    <details className="panel">
      <summary>Walkthrough explanations: how the parts make the meaning ({plan.missing.length} without, {plan.outdated.length} to enrich, {plan.current} done)</summary>
      <div className="stack" style={{ marginTop: '0.75rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          Sentences prepared before contextual explanations existed only show generic role help in the walkthrough, and
          earlier explanations lack the nested structure, who-does-what and check questions. Existing ones keep showing until a richer reply replaces them.
          An assistant can explain, from the surrounding sentences, what each part means here and how it connects.
          The prompt file covers the next batch (sentences with none first, then older ones). Each reply is merged in, and your saved analyses and
          other drafts are never changed; if the assistant's reply is cut off, apply it anyway and download again for what's left. Explanations are shown as unverified drafts.
        </p>
        {plan.pending.length === 0 ? (
          <div className="muted">Nothing pending.</div>
        ) : (
          <div className="row">
            <button type="button" onClick={download}>
              Download next batch ({Math.min(plan.pending.length, nextWalkthroughBatch(plan).length)} of {plan.pending.length})
            </button>
          </div>
        )}
        {asked ? (
          <>
            <label className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
              Reply file{' '}
              <input type="file" accept=".txt,.json,.md,text/plain,application/json" onChange={(event) => void loadFile(event.target.files?.[0])} />
            </label>
            <textarea rows={8} placeholder="…or paste the JSON reply here" value={pasted} onChange={(event) => setPasted(event.target.value)} />
            <div className="row">
              <button type="button" className="primary" disabled={!pasted.trim()} onClick={() => void apply()}>
                Apply reply
              </button>
              <button type="button" onClick={() => setAsked(null)}>Cancel</button>
            </div>
          </>
        ) : null}
        {status ? <div className="muted" style={{ fontSize: '0.85rem' }}>{status}</div> : null}
      </div>
    </details>
  );
}
