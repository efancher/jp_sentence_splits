import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import {
  TOPUP_BELOW,
  applyMeaningBankResult,
  checkSentenceReading,
  autoGenerateMeaningChecks,
  findMeaningBankCandidates,
} from '../lib/meaningCheckAutogen';
import type { MeaningBankCandidate, MeaningBankMode } from '../lib/meaningCheckAutogen';
import { reportChunkIssues } from '../db/repository';
import { downloadTextFile, parseBookChunkIssues } from '../lib/particleChecks';
import { formatBatchMeaningBankPromptForAI, parseBatchMeaningBankReply } from '../lib/meaningChoices';

/**
 * Book-scoped bulk authoring of the meaning choices used by the sentence-led
 * review (correct meaning + ~10 wrong meanings per sentence). Two modes:
 * sentences with no check yet, and sentences whose bank is thin (legacy
 * 3-option checks). The copy/paste round-trip matches the other bulk AI
 * prompts; "Generate with AI now" does the same through the `meaning-assist`
 * Edge Function when it is deployed and you are signed in. The correct
 * meaning is the sentence's own stored translation whenever it has one.
 * Candidates drop out of the list as they are filled (live query), so
 * repeated clicks work through the backlog.
 */
export function BookComprehensionCheckBatch({ bookId }: { bookId: string }) {
  const [mode, setMode] = useState<MeaningBankMode>('missing');
  const [batchSize, setBatchSize] = useState(15);
  const [batch, setBatch] = useState<MeaningBankCandidate[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const counts = useLiveQuery(async () => {
    const [missing, topup] = await Promise.all([
      findMeaningBankCandidates({ mode: 'missing', limit: 100000, bookId }),
      findMeaningBankCandidates({ mode: 'topup', limit: 100000, bookId }),
    ]);
    return { missing: missing.length, topup: topup.length };
  }, [bookId]);

  if (!counts) return null;
  const eligible = mode === 'missing' ? counts.missing : counts.topup;

  async function generateBatch() {
    setBatch(await findMeaningBankCandidates({ mode, limit: batchSize, bookId }));
    setPasted('');
    setStatus(null);
  }

  const prompt = batch ? formatBatchMeaningBankPromptForAI(batch.map((item) => item.request)) : '';

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus('Copy failed — select the text above and copy it manually.');
    }
  }

  async function applyPasted() {
    if (!batch) return;
    const parsed = parseBatchMeaningBankReply(pasted, batch.length);
    let saved = 0;
    const failed: string[] = [];
    let readingsFixed = 0;
    const readingFlags: { sentenceId: string; chunks: string[]; note: string }[] = [];
    for (const [index, item] of batch.entries()) {
      const entry = parsed[index];
      if (entry?.reading) {
        const outcome = await checkSentenceReading(item.sentenceId, entry.reading);
        readingsFixed += outcome.fixed;
        for (const flag of outcome.flagged) {
          readingFlags.push({ sentenceId: item.sentenceId, chunks: [], note: `Reading check — ${flag}` });
        }
      }
      if (!entry || entry.wrong.length === 0) {
        failed.push(`${index + 1} (no "- " lines under its header)`);
      } else if (!(await applyMeaningBankResult(item.sentenceId, mode, entry, 'ai_suggested'))) {
        const reason =
          mode === 'missing' && !item.request.correct && !entry.correct
            ? 'no correct meaning given — the reply needs a "CORRECT: ..." line'
            : entry.wrong.length < 3
              ? `only ${entry.wrong.length} wrong meaning${entry.wrong.length === 1 ? '' : 's'}, need at least 3`
              : 'fewer than 3 survived validation, or a check already exists';
        failed.push(`${index + 1} (${reason})`);
      } else {
        saved += 1;
      }
    }
    const issues = parseBookChunkIssues(pasted, batch.length).flatMap((notes, i) =>
      notes.map((note) => ({ sentenceId: batch[i]!.sentenceId, chunks: [] as string[], note })),
    );
    const filed = await reportChunkIssues('meaning_checks', [...issues, ...readingFlags]);
    const filedNote =
      (readingsFixed ? ` Corrected ${readingsFixed} furigana reading${readingsFixed === 1 ? '' : 's'}.` : '') +
      (filed ? ` Filed ${filed} issue${filed === 1 ? '' : 's'} for review.` : '');
    setStatus(
      failed.length === 0
        ? `Saved ${saved}.${filedNote}`
        : `Saved ${saved}; nothing usable for sentence ${failed.join('; ')}.${filedNote}`,
    );
    setPasted('');
    setBatch(null);
  }

  async function generateNow(wholeBook = false) {
    setBusy(true);
    setStatus(wholeBook ? `Generating for all ${eligible} sentences… (this can take a while)` : 'Generating…');
    const summary = await autoGenerateMeaningChecks({
      mode,
      bookId,
      limit: wholeBook ? Math.max(eligible, 1) : batchSize,
      ignoreBackoff: true,
    });
    setBusy(false);
    setStatus(
      summary.unavailableReason
        ? `${summary.unavailableReason} Use the copy/paste prompt instead.`
        : `Saved ${summary.saved} of ${summary.attempted}.`,
    );
  }

  return (
    <details className="panel">
      <summary>
        Meaning choices: bulk generate ({counts.missing} without choices, {counts.topup} with a thin bank)
      </summary>
      <div className="stack" style={{ marginTop: '0.75rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          The sentence review shows the correct meaning plus 3 wrong ones drawn from a bank of about
          10. New sentences are filled in automatically when AI is available (Settings); use this to
          do a batch yourself. &ldquo;Thin&rdquo; means fewer than {TOPUP_BELOW} usable wrong
          meanings.
        </p>
        <div className="row" style={{ alignItems: 'center' }}>
          <label>
            Sentences{' '}
            <select value={mode} onChange={(event) => setMode(event.target.value as MeaningBankMode)}>
              <option value="missing">with no choices yet</option>
              <option value="topup">with a thin bank (add more)</option>
            </select>
          </label>
          <label>
            Batch size{' '}
            <input
              type="number"
              min={1}
              max={Math.max(1, eligible)}
              value={batchSize}
              onChange={(event) => setBatchSize(Math.max(1, Number(event.target.value) || 1))}
              style={{ width: '4rem' }}
            />
          </label>
        </div>
        {eligible === 0 ? (
          <div className="muted">Nothing to do in this mode.</div>
        ) : (
          <div className="row">
            <button type="button" onClick={() => void generateBatch()}>
              Generate prompt for next {Math.min(batchSize, eligible)}
            </button>
            <button type="button" disabled={busy} onClick={() => void generateNow()}>
              Generate with AI now
            </button>
            <button type="button" disabled={busy} onClick={() => void generateNow(true)}>
              Generate whole book with AI ({eligible})
            </button>
            <button
              type="button"
              onClick={() => {
                setBatchSize(eligible);
                setBatch(null);
              }}
            >
              Set batch to whole book
            </button>
          </div>
        )}
        {batch ? (
          <>
            <textarea readOnly className="jp" rows={10} value={prompt} />
            <div className="row">
              <button type="button" onClick={() => void copyPrompt()}>
                {copied ? 'Copied ✓' : 'Copy prompt'}
              </button>
              <button type="button" onClick={() => downloadTextFile(`meaning-choices-${bookId}.txt`, prompt)}>
                Download prompt (.txt)
              </button>
            </div>
            <label className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
              Reply file{' '}
              <input
                type="file"
                accept=".txt,.md,text/plain"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void file.text().then(setPasted);
                }}
              />
            </label>
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
        {status ? (
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            {status}
          </div>
        ) : null}
      </div>
    </details>
  );
}
