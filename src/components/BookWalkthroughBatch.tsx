import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import { saveContextWalkthroughsByChapter } from '../db/repository';
import {
  BOOK_WALKTHROUGH_BATCH,
  formatBookWalkthroughPrompt,
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
    const handles = plan.pending.slice(0, BOOK_WALKTHROUGH_BATCH);
    setAsked(plan);
    downloadTextFile(`walkthroughs-${bookId}.txt`, formatBookWalkthroughPrompt(plan, handles));
    setStatus(`Downloaded a prompt for ${handles.length} sentences. Upload the assistant's reply below.`);
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
    setStatus(`Saved explanations for ${parsed.saved} sentences.${note}`);
    setPasted('');
    setAsked(null);
  }

  return (
    <details className="panel">
      <summary>Walkthrough explanations: how the parts make the meaning ({plan.pending.length} sentences without)</summary>
      <div className="stack" style={{ marginTop: '0.75rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          Sentences prepared before contextual explanations existed only show generic role help in the walkthrough.
          An assistant can explain, from the surrounding sentences, what each part means here and how it connects.
          Prompts cover {BOOK_WALKTHROUGH_BATCH} sentences at a time; each reply is merged in, and your saved analyses and
          other drafts are never changed. Explanations are shown as unverified drafts.
        </p>
        {plan.pending.length === 0 ? (
          <div className="muted">Nothing pending.</div>
        ) : (
          <div className="row">
            <button type="button" onClick={download}>
              Download prompt file (next {Math.min(BOOK_WALKTHROUGH_BATCH, plan.pending.length)} of {plan.pending.length})
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
