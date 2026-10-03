import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import { saveStructureDraftsByChapter } from '../db/repository';
import {
  findChunkingCandidates,
  formatBookChunkingPrompt,
  nextChunkingBatch,
  parseBookChunkingReply,
  type ChunkingCandidate,
} from '../lib/bookChunking';
import { downloadTextFile } from '../lib/particleChecks';

/**
 * Book-wide chunking by an assistant: download a prompt for the next batch of
 * sentences that have no saved analysis or usable draft, then upload its reply.
 * Drafts feed the walkthrough (labelled unverified); saved analyses always win.
 */
export function BookChunkingBatch({ bookId }: { bookId: string }) {
  const pending = useLiveQuery(() => findChunkingCandidates(bookId), [bookId]);
  const [batch, setBatch] = useState<ChunkingCandidate[] | null>(null);
  const [pasted, setPasted] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  if (!pending) return null;

  function download() {
    const items = nextChunkingBatch(pending ?? []);
    setBatch(items);
    downloadTextFile(`chunking-${bookId}.txt`, formatBookChunkingPrompt(items));
    setStatus(`Downloaded a prompt for ${items.length} sentences. Upload the assistant's reply below.`);
  }

  async function loadFile(file: File | undefined) {
    if (file) setPasted(await file.text());
  }

  async function apply() {
    if (!batch) return;
    const parsed = parseBookChunkingReply(pasted, batch);
    await saveStructureDraftsByChapter(bookId, parsed.byChapter);
    const skipped = batch.length - parsed.saved;
    setStatus(`Saved chunks for ${parsed.saved} of ${batch.length} sentences${skipped ? `; ${skipped} were missing, cut off or didn't rebuild the sentence and stay pending` : ''}.`);
    setPasted('');
    setBatch(null);
  }

  return (
    <details className="panel">
      <summary>Chunking: split sentences with AI help ({pending.length} sentences without chunks)</summary>
      <div className="stack" style={{ marginTop: '0.75rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          Sentences you haven&rsquo;t analysed yourself get automatic chunks with generic roles. An assistant can
          split them properly and add a role and a short English gloss for each chunk. These show in the
          walkthrough as unverified drafts; anything you save on Analyze replaces them.
        </p>
        {pending.length === 0 ? (
          <div className="muted">Nothing pending.</div>
        ) : (
          <div className="row">
            <button type="button" onClick={download}>
              Download prompt file ({Math.min(pending.length, nextChunkingBatch(pending).length)} of {pending.length})
            </button>
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
              placeholder={`…or paste the reply here (lines like "S1 | chunk | role | gloss")`}
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
