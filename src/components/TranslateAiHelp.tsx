import { useState } from 'react';

import {
  formatRowsForTranslationAI,
  parseAiTranslations,
  type TranslationRow,
} from '../lib/miningTranslate';

/**
 * Mining wizard Translate stage: the manual copy/paste counterpart to the
 * in-app "Auto-fill translations (AI)" button. Copy every sentence + its
 * current draft into ChatGPT / Claude, paste the numbered reply back, and it
 * fills the blanks and replaces any weak/mis-scoped drafts. Sibling of
 * `TranscriptStage`'s `AiSegmentHelp`. See `lib/miningTranslate.ts`.
 */
interface TranslateAiHelpProps {
  rows: TranslationRow[];
  /**
   * `translations[i]` is the parsed English for row `i`, or `null` where the
   * reply didn't cover it (leave that row untouched).
   */
  onFill: (translations: (string | null)[]) => void;
  disabled?: boolean;
}

export function TranslateAiHelp({ rows, onFill, disabled = false }: TranslateAiHelpProps) {
  const [pasted, setPasted] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const prompt = formatRowsForTranslationAI(rows);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus('Copy failed — select the text above and copy it manually.');
    }
  }

  function applyPasted() {
    const parsed = parseAiTranslations(pasted, rows.length);
    const filled = parsed.filter((t) => t && t.trim()).length;
    if (filled === 0) {
      setStatus(
        "Couldn't read any numbered translation lines from that — paste the assistant's reply as-is.",
      );
      return;
    }
    onFill(parsed);
    setStatus(`Applied ${filled} of ${rows.length} translation(s) — give them a glance.`);
    setPasted('');
  }

  return (
    <details className="panel">
      <summary>Translate with AI help</summary>
      <div className="stack" style={{ marginTop: '0.75rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          Copy this into ChatGPT / Claude, then paste the numbered reply back below. It
          fills the blanks and rewrites any draft that reads wrong.
        </p>
        <textarea readOnly className="jp" rows={6} value={prompt} />
        <div className="row">
          <button type="button" onClick={() => void copyPrompt()}>
            {copied ? 'Copied ✓' : 'Copy prompt'}
          </button>
        </div>
        <textarea
          className="jp"
          rows={5}
          placeholder="Paste the assistant's reply here (one numbered line per sentence)…"
          value={pasted}
          disabled={disabled}
          onChange={(event) => setPasted(event.target.value)}
        />
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={disabled || !pasted.trim()}
            onClick={applyPasted}
          >
            Apply pasted translations
          </button>
        </div>
        {status ? (
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            {status}
          </div>
        ) : null}
      </div>
    </details>
  );
}
