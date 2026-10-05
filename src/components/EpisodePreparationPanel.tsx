import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';

import {
  clearEpisodePreparation,
  getEpisodePreparationContext,
  listSentenceLearningEvents,
  saveEpisodePackReply,
  updatePreparedTarget,
} from '../db/repository';
import { buildEpisodePackPrompts, longReplyWarning, planEpisodePack } from '../lib/episodePack';
import { isPreparationStale } from '../lib/episodePreparation';

/**
 * Optional, inspectable episode "pack": copy one prompt (or a few, for a long
 * episode), paste each JSON reply back, and see exactly what survived
 * validation — focus targets and any missing translations. Nothing here gates
 * reading or schedules anything, and no AI service is called.
 */
export function EpisodePreparationPanel({
  bookId,
  chapterId,
  defaultOpen = false,
}: {
  bookId: string;
  chapterId: string;
  defaultOpen?: boolean;
}) {
  const loaded = useLiveQuery(
    () => getEpisodePreparationContext(bookId, chapterId).catch(() => null),
    [bookId, chapterId],
  );
  const reports = useLiveQuery(
    async () => (await listSentenceLearningEvents(bookId)).filter((event) => event.action === 'content_report' && (!event.chapterId || event.chapterId === chapterId)),
    [bookId, chapterId],
  );
  const [reply, setReply] = useState('');
  const [message, setMessage] = useState<string>();
  const [copiedPart, setCopiedPart] = useState<number>();
  const [forceTargets, setForceTargets] = useState(true);
  const [wantStructure, setWantStructure] = useState(true);
  const [wantConstructions, setWantConstructions] = useState(false);
  const [wantWalkthroughs, setWantWalkthroughs] = useState(true);
  const [splitIntoParts, setSplitIntoParts] = useState(false);
  const { prompts, warning } = useMemo(() => {
    if (!loaded) return { prompts: [] as string[], warning: undefined };
    const plan = planEpisodePack(loaded.context, loaded.preparation, {
      forceTargets,
      structureSentenceIds: wantStructure ? new Set(loaded.needsStructureIds) : undefined,
      constructionSentenceIds: wantConstructions ? new Set(loaded.needsConstructionIds) : undefined,
      walkthroughSentenceIds: wantWalkthroughs ? new Set(loaded.needsWalkthroughIds) : undefined,
    });
    return {
      prompts: buildEpisodePackPrompts(loaded.context, plan, { splitIntoParts }),
      warning: splitIntoParts ? undefined : longReplyWarning(plan),
    };
  }, [loaded, forceTargets, wantStructure, wantConstructions, wantWalkthroughs, splitIntoParts]);

  if (!loaded) return null;
  const { context, preparation } = loaded;
  const stale = preparation ? isPreparationStale(preparation, context.sentences) : false;
  const usable = preparation && preparation.targets.length > 0;

  async function submit() {
    setMessage(undefined);
    const result = await saveEpisodePackReply(bookId, chapterId, reply);
    if (result.error) {
      setMessage(`Could not use that reply: ${result.error} Nothing was changed.`);
      return;
    }
    setReply('');
    setForceTargets(false);
    const bits: string[] = [];
    if (result.preparation) {
      bits.push(
        result.preparation.status === 'failed'
          ? `focus targets not saved (${result.preparation.error ?? 'no valid targets'})${usable ? '; your earlier result was kept' : ''}`
          : `${result.preparation.targets.length} focus target${result.preparation.targets.length === 1 ? '' : 's'} saved${result.preparation.status === 'partial' ? ' (some rejected, listed below)' : ''}`,
      );
    }
    if (result.translationsSaved > 0 || result.rejectedTranslations.length > 0) {
      bits.push(
        `${result.translationsSaved} translation${result.translationsSaved === 1 ? '' : 's'} saved` +
          (result.rejectedTranslations.length > 0 ? `, ${result.rejectedTranslations.length} skipped (${result.rejectedTranslations[0]!.reason})` : ''),
      );
    }
    if (result.structureSaved > 0 || result.rejectedStructure.length > 0) {
      bits.push(
        `${result.structureSaved} sentence structure${result.structureSaved === 1 ? '' : 's'} saved` +
          (result.rejectedStructure.length > 0 ? `, ${result.rejectedStructure.length} skipped (${result.rejectedStructure[0]!.reason})` : ''),
      );
    }
    if (result.constructionsSaved > 0 || result.rejectedConstructions.length > 0) {
      bits.push(
        `${result.constructionsSaved} phrase explanation${result.constructionsSaved === 1 ? '' : 's'} saved` +
          (result.rejectedConstructions.length > 0 ? `, ${result.rejectedConstructions.length} layer${result.rejectedConstructions.length === 1 ? '' : 's'} skipped (${result.rejectedConstructions[0]!.reason})` : ''),
      );
    }
    if (result.walkthroughsSaved > 0 || result.rejectedWalkthroughs.length > 0) {
      bits.push(
        `${result.walkthroughsSaved} sentence walkthrough${result.walkthroughsSaved === 1 ? '' : 's'} saved` +
          (result.rejectedWalkthroughs.length > 0 ? `, ${result.rejectedWalkthroughs.length} with skipped parts (${result.rejectedWalkthroughs[0]!.reason})` : ''),
      );
    }
    setMessage(`Saved: ${bits.join('; ') || 'nothing new'}.`);
  }

  async function copyPrompt(index: number) {
    try {
      await navigator.clipboard.writeText(prompts[index] ?? '');
      setCopiedPart(index);
    } catch {
      setCopiedPart(undefined);
      setMessage('Copy failed; select the prompt text above and copy it manually.');
    }
  }

  return (
    <details className="episode-preparation" open={defaultOpen || undefined}>
      <summary>
        Episode preparation (optional)
        {preparation ? ` — ${stale ? 'out of date' : preparation.status}` : ''}
      </summary>
      <div className="stack" style={{ gap: '0.5rem' }}>
        <p className="muted" style={{ margin: 0 }}>
          One prompt for this whole episode: which words and patterns matter, plus English for any sentence that has none.
          You see each prompt and reply; anything invented (unknown sentences, ids, quoted text) is rejected, and your own
          translations are never overwritten. Reading never waits on this.
        </p>
        {prompts.length === 0 ? (
          <p style={{ margin: 0 }}>Nothing more to ask: focus targets are saved and every sentence has a translation.</p>
        ) : (
          <>
            {prompts.length > 1 ? (
              <p className="muted" style={{ margin: 0 }}>
                This episode needs {prompts.length} prompts. Copy one, paste its reply below and save; the next appears here.
                Only the first is shown at a time.
              </p>
            ) : null}
            <label className="stack" style={{ gap: '0.25rem' }}>
              <span>{prompts.length > 1 ? `Prompt to copy (1 of ${prompts.length} remaining)` : 'Prompt to copy'}</span>
              <textarea readOnly rows={4} value={prompts[0]} aria-label="Episode pack prompt" />
            </label>
            <div className="row">
              <button type="button" onClick={() => void copyPrompt(0)}>{copiedPart === 0 ? 'Copied' : 'Copy prompt'}</button>
            </div>
          </>
        )}
        {preparation && preparation.targets.length > 0 ? (
          <label className="row" style={{ gap: '0.35rem', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <input type="checkbox" checked={forceTargets} onChange={(event) => setForceTargets(event.target.checked)} />
            Ask for focus targets again
          </label>
        ) : null}
        {loaded.needsStructureIds.length > 0 ? (
          <label className="row" style={{ gap: '0.35rem', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <input type="checkbox" checked={wantStructure} onChange={(event) => setWantStructure(event.target.checked)} />
            <span>Also ask for sentence structure ({loaded.needsStructureIds.length} without an analysis) so walkthrough roles are not generic</span>
          </label>
        ) : null}
        {loaded.needsConstructionIds.length > 0 ? (
          <label className="row" style={{ gap: '0.35rem', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <input type="checkbox" checked={wantConstructions} onChange={(event) => setWantConstructions(event.target.checked)} />
            <span>Also ask how phrases are built ({loaded.needsConstructionIds.length} sentences without an explanation) for “How this phrase works”</span>
          </label>
        ) : null}
        {loaded.needsWalkthroughIds.length > 0 ? (
          <label className="row" style={{ gap: '0.35rem', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <input type="checkbox" checked={wantWalkthroughs} onChange={(event) => setWantWalkthroughs(event.target.checked)} />
            <span>Also ask how each sentence&rsquo;s parts make its meaning, using the sentences around it ({loaded.needsWalkthroughIds.length} without one) for “Walk through this sentence”</span>
          </label>
        ) : null}
        <label className="row" style={{ gap: '0.35rem', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <input type="checkbox" checked={splitIntoParts} onChange={(event) => setSplitIntoParts(event.target.checked)} />
          <span>Split into several prompts (for a very long episode; each reply is pasted separately)</span>
        </label>
        {warning ? <p role="alert" className="muted" style={{ margin: 0 }}>{warning}</p> : null}
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
        {reports && reports.length > 0 ? (
          <div className="stack" style={{ gap: '0.2rem' }}>
            <span className="muted">Prompts you flagged while practising ({reports.length}) — kept for content repair, never counted against you:</span>
            <ul style={{ margin: 0 }} aria-label="Flagged prompts">
              {reports.map((event) => (
                <li key={event.id}>
                  <strong className="jp">{event.target?.label ?? '(target)'}</strong>
                  <span className="muted">
                    {' '}— {event.report === 'poor_question' ? 'poor question' : 'another answer works'}
                    {event.learnerAnswer ? `: “${event.learnerAnswer}”` : ''}
                  </span>
                  <div className="jp muted">{context.sentences.find((sentence) => sentence.id === event.sentenceId)?.japanese ?? ''}</div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

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
                  {target.droppedOccurrences ? (
                    <div className="muted">
                      {target.droppedOccurrences} quoted {target.droppedOccurrences === 1 ? 'place' : 'places'} in the reply did not match the episode text and {target.droppedOccurrences === 1 ? 'was' : 'were'} dropped.
                    </div>
                  ) : null}
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
