import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import { getDb, setSentenceComprehensionCheck } from '../db/repository';
import type { Book, Sentence } from '../domain/types';
import {
  buildComprehensionCheck,
  formatComprehensionPromptForAI,
  parseComprehensionCheckReply,
} from '../lib/comprehensionCheck';
import {
  MEANING_BANK_TARGET_SIZE,
  formatDistractorBankPromptForAI,
  getMeaningBank,
  mergeDistractors,
  parseDistractorBankReply,
  removeDistractor,
} from '../lib/meaningChoices';

/**
 * Authoring UI for a sentence's comprehension check
 * (docs/ROADMAP.md "Context-aware comprehension check…"), same panel
 * placement/precedent as `GrammarPicker`: an immediate, deliberate
 * repository write per action, not routed through AnalyzePage's
 * debounced chunk-editing autosave. Consumed by both `reading_in_context`
 * (gates its Reveal button) and `listening` (gates its "Reveal text"
 * button, 2026-09-25) — one authored check per sentence, reused by
 * whichever review card the sentence surfaces on. A sentence with no
 * authored check just leaves both cards in their existing plain
 * reveal-and-rate behavior — this panel is purely additive.
 */
export function ComprehensionCheckPicker({ sentenceId }: { sentenceId: string }) {
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualOptions, setManualOptions] = useState(['', '', '', '']);
  const [manualCorrectIndex, setManualCorrectIndex] = useState(0);
  const [bankCopied, setBankCopied] = useState(false);
  const [bankPasted, setBankPasted] = useState('');

  const data = useLiveQuery(async () => {
    const db = getDb();
    const sentence = await db.sentences.get(sentenceId);
    const analysis = await db.analyses.get(sentenceId);
    if (!sentence) return { sentence: null, before: [] as Sentence[], check: undefined };

    const memberships = await db.bookSentences.where('sentenceId').equals(sentenceId).toArray();
    let before: Sentence[] = [];
    if (memberships.length > 0) {
      const bookIds = [...new Set(memberships.map((m) => m.bookId))];
      const books = (await db.books.bulkGet(bookIds)).filter((b): b is Book => Boolean(b));
      const openedAt = (bookId: string) => {
        const value = books.find((b) => b.id === bookId)?.lastOpenedAt;
        return value ? Date.parse(value) : 0;
      };
      const home = [...memberships].sort((a, b) => openedAt(b.bookId) - openedAt(a.bookId))[0]!;
      const ordered = (await db.bookSentences.where('bookId').equals(home.bookId).toArray()).sort(
        (a, b) => a.position - b.position,
      );
      const index = ordered.findIndex((row) => row.sentenceId === sentenceId);
      const beforeIds =
        index === -1 ? [] : ordered.slice(Math.max(0, index - 2), index).map((row) => row.sentenceId);
      before = (await db.sentences.bulkGet(beforeIds)).filter((s): s is Sentence => Boolean(s));
    }
    return { sentence, before, check: analysis?.comprehensionCheck };
  }, [sentenceId]);

  const sentence = data?.sentence;
  const before = data?.before ?? [];
  const check = data?.check;

  if (!sentence) return null;
  const prompt = formatComprehensionPromptForAI(sentence, { before });

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
    const parsed = parseComprehensionCheckReply(pasted);
    if (!parsed) {
      setStatus(
        "Couldn't read 4 numbered options with exactly one marked correct (*) — paste the assistant's reply as-is.",
      );
      return;
    }
    await setSentenceComprehensionCheck(sentenceId, buildComprehensionCheck(parsed, 'ai_suggested'));
    setStatus('Saved comprehension check.');
    setPasted('');
  }

  async function saveManual() {
    const options = manualOptions.map((o) => o.trim());
    if (options.some((o) => !o)) {
      setStatus('All 4 options need text.');
      return;
    }
    await setSentenceComprehensionCheck(
      sentenceId,
      buildComprehensionCheck({ options, correctIndex: manualCorrectIndex }, 'manual'),
    );
    setStatus('Saved comprehension check.');
    setManualOpen(false);
    setManualOptions(['', '', '', '']);
    setManualCorrectIndex(0);
  }

  const bank = getMeaningBank(check);
  const bankPrompt =
    check && bank
      ? formatDistractorBankPromptForAI({
          japanese: sentence.japanese,
          correct: bank.correct,
          context: before.map((s) => `${s.japanese} — ${s.translation ?? ''}`.trim()),
          existing: bank.entries.map((entry) => entry.text),
        })
      : '';

  async function copyBankPrompt() {
    try {
      await navigator.clipboard.writeText(bankPrompt);
      setBankCopied(true);
      setTimeout(() => setBankCopied(false), 2000);
    } catch {
      setStatus('Copy failed — select the text and copy it manually.');
    }
  }

  async function applyBankReply() {
    if (!check) return;
    const incoming = parseDistractorBankReply(bankPasted);
    if (incoming.length === 0) {
      setStatus('No "- " lines found in the pasted reply.');
      return;
    }
    const result = mergeDistractors(check, incoming);
    if (result.added.length > 0) await setSentenceComprehensionCheck(sentenceId, result.check);
    const skipped = result.rejected.map((r) => `"${r.text}" (${r.issues.join(', ')})`).join('; ');
    setStatus(`Added ${result.added.length}.${skipped ? ` Rejected: ${skipped}` : ''}`);
    setBankPasted('');
  }

  async function removeFromBank(text: string) {
    if (!check) return;
    const next = removeDistractor(check, text);
    if (next === check) {
      setStatus('That is one of the 3 original wrong options and no extra exists to replace it — add more first.');
      return;
    }
    await setSentenceComprehensionCheck(sentenceId, next);
    setStatus('Removed.');
  }

  async function clearCheck() {
    await setSentenceComprehensionCheck(sentenceId, undefined);
    setStatus('Cleared.');
  }

  return (
    <details className="panel">
      <summary>Comprehension check{check ? ' ✓' : ''}</summary>
      <div className="stack" style={{ marginTop: '0.75rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          4-option "which English sentence fits this context" check shown before reveal
          on the reading_in_context review card, and before "Reveal text" on the
          listening review card. Optional — leave unset and both cards behave as before.
        </p>
        {check ? (
          <div className="stack" style={{ gap: '0.25rem' }}>
            {check.options.map((option, i) => (
              <div key={i} style={{ fontWeight: i === check.correctIndex ? 600 : 400 }}>
                {i === check.correctIndex ? '✓ ' : '  '}
                {option}
              </div>
            ))}
            <div className="row">
              <button type="button" onClick={() => void clearCheck()}>
                Clear
              </button>
            </div>
          </div>
        ) : null}
        {check && bank ? (
          <div className="stack" style={{ gap: '0.25rem' }}>
            <strong>
              Wrong-meaning bank · {bank.distractors.length} usable (target ~{MEANING_BANK_TARGET_SIZE})
            </strong>
            <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
              Each review shows the correct meaning plus 3 of these, rotating. Remove any that
              are actually right, ambiguous or nonsense.
            </p>
            {bank.entries.map((entry, i) => (
              <div className="row" key={`${i}-${entry.text}`} style={{ alignItems: 'baseline' }}>
                <span style={{ flex: 1, opacity: entry.usable ? 1 : 0.55 }}>
                  {entry.text}
                  {entry.issues.length > 0 ? (
                    <span className="muted"> [{entry.issues.join(', ')}{entry.usable ? '' : ' — not used'}]</span>
                  ) : null}
                </span>
                <button type="button" onClick={() => void removeFromBank(entry.text)}>
                  Remove
                </button>
              </div>
            ))}
            <textarea readOnly rows={5} value={bankPrompt} />
            <div className="row">
              <button type="button" onClick={() => void copyBankPrompt()}>
                {bankCopied ? 'Copied ✓' : 'Copy "more wrong meanings" prompt'}
              </button>
            </div>
            <textarea
              rows={4}
              placeholder='Paste the reply (one wrong meaning per line, starting with "- ")…'
              value={bankPasted}
              onChange={(event) => setBankPasted(event.target.value)}
            />
            <div className="row">
              <button type="button" className="primary" disabled={!bankPasted.trim()} onClick={() => void applyBankReply()}>
                Add to bank
              </button>
            </div>
          </div>
        ) : null}
        <textarea readOnly className="jp" rows={6} value={prompt} />
        <div className="row">
          <button type="button" onClick={() => void copyPrompt()}>
            {copied ? 'Copied ✓' : 'Copy prompt'}
          </button>
        </div>
        <textarea
          rows={5}
          placeholder="Paste the assistant's reply here (4 numbered options, correct one marked *)…"
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
        />
        <div className="row">
          <button type="button" className="primary" disabled={!pasted.trim()} onClick={() => void applyPasted()}>
            Apply pasted options
          </button>
          <button type="button" onClick={() => setManualOpen((v) => !v)}>
            {manualOpen ? 'Cancel manual entry' : 'Enter manually'}
          </button>
        </div>
        {manualOpen ? (
          <div className="stack">
            {manualOptions.map((option, i) => (
              <div className="row" key={i}>
                <input
                  type="radio"
                  name="comprehension-check-correct"
                  checked={manualCorrectIndex === i}
                  onChange={() => setManualCorrectIndex(i)}
                  aria-label={`Option ${i + 1} is correct`}
                />
                <input
                  style={{ flex: 1 }}
                  value={option}
                  placeholder={`Option ${i + 1}`}
                  onChange={(event) =>
                    setManualOptions((prev) =>
                      prev.map((o, idx) => (idx === i ? event.target.value : o)),
                    )
                  }
                />
              </div>
            ))}
            <div className="row">
              <button type="button" className="primary" onClick={() => void saveManual()}>
                Save
              </button>
            </div>
          </div>
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
