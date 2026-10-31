import { useState } from 'react';

import { snoozeShadowSentence } from '../db/repository';
import { SHADOW_SNOOZE_OPTIONS } from '../lib/shadowSnooze';

/**
 * "Try again" tomorrow / in 5 days / in 2 weeks for a shadowing sentence. Hides
 * it from shadow candidates until then and skips its open session step; never
 * touches FSRS. `onSnoozed` lets the page leave (the sentence is parked).
 */
export function ShadowSnoozeButtons({
  sentenceId,
  onSnoozed,
}: {
  sentenceId: string;
  onSnoozed?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function snooze(days: number) {
    if (busy) return;
    setBusy(true);
    try {
      await snoozeShadowSentence(sentenceId, days);
      onSnoozed?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
      <span className="muted" style={{ fontSize: '0.85rem' }}>
        Try again:
      </span>
      {SHADOW_SNOOZE_OPTIONS.map((option) => (
        <button
          key={option.days}
          type="button"
          className="ghost"
          disabled={busy}
          onClick={() => void snooze(option.days)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
