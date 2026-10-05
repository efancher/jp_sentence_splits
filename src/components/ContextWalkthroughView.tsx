import { useState } from 'react';

import { getEpisodePreparationContext, saveEpisodePackReply } from '../db/repository';
import type { ContextWalkthroughStep } from '../domain/types';
import { highlightSegments } from '../lib/contextWalkthrough';
import { buildEpisodePackPrompts } from '../lib/episodePack';

/** The whole sentence, always visible, with the explained span highlighted and the span it connects to underlined. */
export function HighlightedSentence({
  japanese,
  main,
  connect,
}: {
  japanese: string;
  main?: { start: number; end: number };
  connect?: { start: number; end: number };
}) {
  return (
    <div className="jp jp-lg" aria-label="Sentence with the explained part highlighted">
      {highlightSegments(japanese, main, connect).map((segment, index) =>
        segment.kind === 'plain' ? (
          <span key={index}>{segment.text}</span>
        ) : (
          <mark
            key={index}
            data-kind={segment.kind}
            style={{
              background: segment.kind === 'connect' ? 'transparent' : 'rgba(255, 200, 0, 0.4)',
              color: 'inherit',
              textDecoration: segment.kind === 'main' ? undefined : 'underline dotted',
              textUnderlineOffset: '0.25em',
              borderRadius: '0.2em',
            }}
          >
            {segment.text}
          </mark>
        ),
      )}
    </div>
  );
}

export interface RoleHelp {
  japanese: string;
  role: string;
  blurb?: string;
}

/**
 * One contextual step. The short fields are the main content; generic role guidance and longer detail
 * are supplementary and collapsed. `showGloss` / `showWhy` follow the walkthrough's help level.
 */
export function ContextStepCard({
  step,
  roleHelp,
  showGloss,
  showWhy,
  onAskGloss,
  onAskWhy,
}: {
  step: ContextWalkthroughStep;
  roleHelp: RoleHelp[];
  showGloss: boolean;
  showWhy: boolean;
  onAskGloss: () => void;
  onAskWhy: () => void;
}) {
  return (
    <div className="stack" style={{ gap: '0.3rem' }} aria-label="Contextual explanation">
      <div>
        <strong className="jp">{step.text}</strong>
        {' — '}
        {showGloss ? <>“{step.gloss}”</> : <button type="button" onClick={onAskGloss}>Show meaning here</button>}
      </div>
      {showWhy ? (
        <>
          <div>{step.explanation}</div>
          {step.connects ? (
            <div>
              <strong>Connects to </strong>
              <span className="jp">{step.connects.text}</span>: {step.connects.how}
            </div>
          ) : null}
          {step.mechanics ? <div><strong>How the pieces work: </strong>{step.mechanics}</div> : null}
          {step.implicit ? <div><strong>Left unsaid in Japanese: </strong>{step.implicit}</div> : null}
          {step.nuance ? <div><strong>Tone: </strong>{step.nuance}</div> : null}
          {step.inferred ? <div className="muted"><strong>From context (inferred, not stated in this sentence): </strong>{step.inferred}</div> : null}
          {step.detail ? (
            <details>
              <summary>More detail</summary>
              <div>{step.detail}</div>
            </details>
          ) : null}
        </>
      ) : (
        <button type="button" onClick={onAskWhy}>Explain this part</button>
      )}
      {showWhy && roleHelp.length > 0 ? (
        <details>
          <summary className="muted">Generic role help for the chunks here</summary>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {roleHelp.map((item, index) => (
              <li key={index} className="muted">
                <span className="jp">{item.japanese}</span> — <strong>{item.role || 'Unlabelled'}</strong>
                {item.blurb ? `: ${item.blurb}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Shown for a sentence with no contextual explanation (anything prepared before this existed): copy a prompt
 * that carries the surrounding sentences, paste the reply back, and it is validated and saved. Uses the same
 * episode-pack save path as the chapter panel, so the same validation applies.
 */
export function WalkthroughContentImport({
  bookId,
  chapterId,
  sentenceId,
}: {
  bookId: string;
  chapterId: string;
  sentenceId: string;
}) {
  const [prompt, setPrompt] = useState<string>();
  const [reply, setReply] = useState('');
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function makePrompt() {
    setMessage(undefined);
    try {
      const { context } = await getEpisodePreparationContext(bookId, chapterId);
      const index = context.sentences.findIndex((sentence) => sentence.id === sentenceId);
      if (index < 0) {
        setMessage('Could not find this sentence in its chapter.');
        return;
      }
      const prompts = buildEpisodePackPrompts(context, {
        wantsTargets: false,
        missingTranslationHandles: [],
        structureHandles: [],
        constructionHandles: [],
        walkthroughHandles: [`S${index + 1}`],
      });
      setPrompt(prompts[0]);
      try {
        await navigator.clipboard.writeText(prompts[0] ?? '');
        setMessage('Prompt copied. Paste it into your AI, then paste its reply below.');
      } catch {
        setMessage('Select the prompt text below and copy it manually.');
      }
    } catch {
      setMessage('Could not build the prompt.');
    }
  }

  async function save() {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await saveEpisodePackReply(bookId, chapterId, reply);
      if (result.error) setMessage(`Could not use that reply: ${result.error} Nothing was changed.`);
      else if (result.walkthroughsSaved > 0) {
        setReply('');
        setMessage(result.rejectedWalkthroughs.length > 0 ? `Saved. Some parts were skipped: ${result.rejectedWalkthroughs[0]!.reason}` : 'Saved.');
      } else setMessage(`Nothing usable in that reply${result.rejectedWalkthroughs[0] ? `: ${result.rejectedWalkthroughs[0].reason}` : '.'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="stack" style={{ gap: '0.3rem' }}>
      <summary>No explanation of how this sentence&rsquo;s parts make its meaning yet — add one</summary>
      <p className="muted" style={{ margin: 0 }}>
        This sentence was prepared before contextual explanations existed, so the walkthrough only has generic role help.
        Copy a prompt (it includes the sentences around this one), paste your AI&rsquo;s reply, and the walkthrough will
        use it. Nothing invented is kept: quoted text must match this sentence. For a whole episode at once, use Episode preparation.
      </p>
      <div className="row">
        <button type="button" onClick={() => void makePrompt()}>Copy prompt for this sentence</button>
      </div>
      {prompt ? <textarea readOnly rows={4} value={prompt} aria-label="Walkthrough prompt" /> : null}
      <textarea rows={4} value={reply} onChange={(event) => setReply(event.target.value)} aria-label="Walkthrough reply" placeholder="Paste the AI reply here" />
      <div className="row">
        <button type="button" disabled={!reply.trim() || busy} onClick={() => void save()}>Check and save reply</button>
      </div>
      {message ? <p role="status" style={{ margin: 0 }}>{message}</p> : null}
    </details>
  );
}
