import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import {
  getDb,
  getSentenceFullReviewReadiness,
  setSentenceComprehensionCheck,
} from '../db/repository';
import type { Sentence } from '../domain/types';
import {
  buildComprehensionCheck,
  formatBatchComprehensionPromptForAI,
  parseBatchComprehensionCheckReply,
} from '../lib/comprehensionCheck';

/**
 * Book-scoped batch authoring for comprehension checks — same AI
 * copy/paste round-trip as ComprehensionCheckPicker (single sentence),
 * but covers many eligible sentences (confirmed vocab, full-review-ready,
 * no check yet) in one prompt/reply, `batchSize` at a time. A sentence
 * drops out of the eligible list as soon as it gets a check (live query),
 * so repeated clicks work through the backlog without separate
 * "already generated" bookkeeping.
 */
export function BookComprehensionCheckBatch({ bookId }: { bookId: string }) {
  const [batchSize, setBatchSize] = useState(15);
  const [batch, setBatch] = useState<{ sentence: Sentence; before: Sentence[] }[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const eligible = useLiveQuery(async () => {
    const db = getDb();
    const memberships = await db.bookSentences.where('bookId').equals(bookId).sortBy('position');
    const sentenceIds = memberships.map((m) => m.sentenceId);
    const sentences = await db.sentences.bulkGet(sentenceIds);
    const analyses = await db.analyses.bulkGet(sentenceIds);
    const candidates: { sentence: Sentence; before: Sentence[] }[] = [];
    sentences.forEach((sentence, index) => {
      if (!sentence) return;
      const analysis = analyses[index];
      if (analysis?.vocabularyReviewStatus !== 'confirmed') return;
      if (analysis.comprehensionCheck) return;
      const before = sentences
        .slice(Math.max(0, index - 2), index)
        .filter((s): s is Sentence => Boolean(s));
      candidates.push({ sentence, before });
    });
    if (candidates.length === 0) return [];
    const readiness = await getSentenceFullReviewReadiness(candidates.map((c) => c.sentence.id));
    return candidates.filter((c) => readiness.get(c.sentence.id));
  }, [bookId]);

  if (!eligible) return null;

  function generateBatch() {
    setBatch(eligible!.slice(0, batchSize));
    setPasted('');
    setStatus(null);
  }

  async function copyPrompt() {
    if (!batch) return;
    try {
      await navigator.clipboard.writeText(formatBatchComprehensionPromptForAI(batch));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus('Copy failed — select the text above and copy it manually.');
    }
  }

  async function applyPasted() {
    if (!batch) return;
    const parsedResults = parseBatchComprehensionCheckReply(pasted, batch.length);
    let saved = 0;
    const failed: number[] = [];
    for (let i = 0; i < batch.length; i += 1) {
      const parsed = parsedResults[i];
      if (!parsed) {
        failed.push(i + 1);
        continue;
      }
      await setSentenceComprehensionCheck(
        batch[i]!.sentence.id,
        buildComprehensionCheck(parsed, 'ai_suggested'),
      );
      saved += 1;
    }
    setStatus(
      failed.length === 0
        ? `Saved ${saved} comprehension checks.`
        : `Saved ${saved}; couldn't parse sentence ${failed.join(', ')} — make sure those sections still have their "=== Sentence N ===" header.`,
    );
    setPasted('');
    setBatch(null);
  }

  const prompt = batch ? formatBatchComprehensionPromptForAI(batch) : '';

  return (
    <details className="panel">
      <summary>Comprehension checks: batch generate ({eligible.length} eligible, no check yet)</summary>
      <div className="stack" style={{ marginTop: '0.75rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          Confirmed-vocabulary, full-review-ready sentences with no comprehension
          check yet. One AI copy/paste round-trip per batch, same format as the
          single-sentence picker on AnalyzePage.
        </p>
        {eligible.length === 0 ? (
          <div className="muted">Nothing eligible right now.</div>
        ) : (
          <>
            <div className="row" style={{ alignItems: 'center' }}>
              <label>
                Batch size{' '}
                <input
                  type="number"
                  min={1}
                  max={eligible.length}
                  value={batchSize}
                  onChange={(event) => setBatchSize(Math.max(1, Number(event.target.value) || 1))}
                  style={{ width: '4rem' }}
                />
              </label>
              <button type="button" onClick={generateBatch}>
                Generate prompt for next {Math.min(batchSize, eligible.length)}
              </button>
            </div>
            {batch ? (
              <>
                <textarea readOnly className="jp" rows={10} value={prompt} />
                <div className="row">
                  <button type="button" onClick={() => void copyPrompt()}>
                    {copied ? 'Copied ✓' : 'Copy prompt'}
                  </button>
                </div>
                <textarea
                  rows={8}
                  placeholder={`Paste the assistant's reply here (${batch.length} "=== Sentence N ===" sections)…`}
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                />
                <div className="row">
                  <button
                    type="button"
                    className="primary"
                    disabled={!pasted.trim()}
                    onClick={() => void applyPasted()}
                  >
                    Apply pasted batch
                  </button>
                  <button type="button" onClick={() => setBatch(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : null}
          </>
        )}
        {status ? (
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            {status}
          </div>
        ) : null}
      </div>
    </details>
  );
}
