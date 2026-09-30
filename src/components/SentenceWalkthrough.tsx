import { useEffect, useMemo, useState } from 'react';

import type { AnalysisChunk, Sentence, StructureDraftChunk, SentenceAudio, SentenceLearningEvent } from '../domain/types';
import { previewHeuristicChunks } from '../lib/analysisHelpers';
import { isEngineRole } from '../lib/clauseBands';
import type { EpisodeFocusTarget } from '../lib/episodeFocus';
import { chunksMatchSource } from '../lib/chunking';
import { createId } from '../lib/ids';
import { roleGuideBlurb } from '../lib/roleGuide';
import { selectSentenceTargets, type CompareSentence } from '../lib/sentenceLearning';

import { ChunkPuzzleStrip } from './ChunkPuzzleStrip';
import { SentenceExpressionCard, meaningUnits } from './SentenceExpressionCard';
import { NativeAudioButton } from './NativeAudioButton';
import { TargetLessonCard, WordGlossList, type CompareAids, type LessonEventInput } from './TargetLessonCard';

export type SupportPreset = 'full' | 'less' | 'minimal';
const PRESET_KEY = 'glossbook.walkthroughSupport';
const PRESET_LABELS: Record<SupportPreset, string> = {
  full: 'Full help: role, gloss and explanation',
  less: 'Less help: role and gloss, explanation on request',
  minimal: 'Minimal: just the chunk, everything else on request',
};

function readPreset(): SupportPreset {
  try {
    const value = window.localStorage.getItem(PRESET_KEY);
    return value === 'less' || value === 'minimal' ? value : 'full';
  } catch {
    return 'full';
  }
}

export interface WalkthroughChunk {
  id: string;
  japanese: string;
  role: string;
  literalEnglish?: string;
  notes?: string;
}

/**
 * Prefer the learner's saved analysis; otherwise fall back to the generic
 * heuristic draft so the walkthrough never waits on analysis or vocabulary.
 * Zero-が chunks are inferred structure, not source text, so they are skipped.
 */
export function walkthroughChunks(
  sentence: Pick<Sentence, 'id' | 'japanese'>,
  saved?: AnalysisChunk[],
  aiDraft?: StructureDraftChunk[],
): { chunks: WalkthroughChunk[]; source: 'saved' | 'ai_draft' | 'draft' } {
  const surface = (saved ?? [])
    .filter((chunk) => chunk.kind !== 'zero_ga' && chunk.japanese)
    .sort((a, b) => a.order - b.order);
  if (surface.length > 0 && surface.map((chunk) => chunk.japanese).join('') === sentence.japanese.replace(/\s+/g, '')) {
    return {
      source: 'saved',
      chunks: surface.map((chunk) => ({
        id: chunk.id, japanese: chunk.japanese, role: chunk.role,
        literalEnglish: chunk.literalEnglish || undefined, notes: chunk.notes || undefined,
      })),
    };
  }
  if (aiDraft && aiDraft.length > 0 && chunksMatchSource(aiDraft.map((chunk) => chunk.japanese), sentence.japanese)) {
    return {
      source: 'ai_draft',
      chunks: aiDraft.map((chunk, index) => ({
        id: `${sentence.id}-ai-${index}`, japanese: chunk.japanese, role: chunk.role,
        literalEnglish: chunk.literalEnglish,
      })),
    };
  }
  const preview = previewHeuristicChunks(sentence.japanese);
  return {
    source: 'draft',
    chunks: preview.parts.map((japanese, index) => ({
      id: `${sentence.id}-draft-${index}`, japanese, role: preview.roles[index] ?? '',
    })),
  };
}

/** Engine chunk(s) first, then the rest in source order — the Cure Dolly sequence. */
export function walkthroughOrder<T extends { role: string }>(chunks: T[]): T[] {
  return [...chunks.filter((chunk) => isEngineRole(chunk.role)), ...chunks.filter((chunk) => !isEngineRole(chunk.role))];
}

const STAGES = ['Understand', 'Recognise', 'Recall', 'Use', 'Say it', 'Express it your way'];

export function SentenceWalkthrough({
  sentence,
  savedChunks,
  structureDraft,
  audio,
  focusTargets,
  episodeSentences = [],
  compareAids,
  events = [],
  onEvent,
  quietMode,
  shadowHref,
  onQuietModeChange,
  onClose,
}: {
  sentence: Sentence;
  savedChunks?: AnalysisChunk[];
  structureDraft?: StructureDraftChunk[];
  audio?: SentenceAudio;
  focusTargets: EpisodeFocusTarget[];
  /** The whole episode, for "Compare uses" excerpts. */
  episodeSentences?: CompareSentence[];
  /** Translation, word glosses and native audio per episode sentence, shown under Compare uses excerpts. */
  compareAids?: ReadonlyMap<string, CompareAids>;
  /** Earlier lesson events for this book, to show what has been practised/compared. */
  events?: SentenceLearningEvent[];
  onEvent?: (event: LessonEventInput) => void;
  quietMode: boolean;
  shadowHref?: string;
  onQuietModeChange: (quiet: boolean) => void;
  onClose: () => void;
}) {
  const { chunks, source } = useMemo(() => walkthroughChunks(sentence, savedChunks, structureDraft), [sentence, savedChunks, structureDraft]);
  const ordered = useMemo(() => walkthroughOrder(chunks), [chunks]);
  const [step, setStep] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const chunk = ordered[step];
  const done = step >= ordered.length;
  const revealedIds = new Set(ordered.slice(0, step + 1).map((item) => item.id));
  const here = focusTargets.filter((target) => target.sentenceIds.includes(sentence.id));
  const [showAllTargets, setShowAllTargets] = useState(false);
  const [gist, setGist] = useState<'closed' | 'asking' | 'revealed' | 'recorded'>('closed');
  const [gistAnswer, setGistAnswer] = useState('');
  const [expressing, setExpressing] = useState(false);
  const [preset, setPresetState] = useState<SupportPreset>(readPreset);
  const [askedFor, setAskedFor] = useState<{ role: Set<number>; gloss: Set<number>; why: Set<number> }>({ role: new Set(), gloss: new Set(), why: new Set() });
  const setPreset = (value: SupportPreset) => {
    setPresetState(value);
    try { window.localStorage.setItem(PRESET_KEY, value); } catch { /* preference is best-effort */ }
  };
  const ask = (kind: 'role' | 'gloss' | 'why') =>
    setAskedFor((current) => ({ ...current, [kind]: new Set(current[kind]).add(step) }));
  const showRole = preset !== 'minimal' || askedFor.role.has(step);
  const showGloss = preset !== 'minimal' || askedFor.gloss.has(step);
  const showWhy = preset === 'full' || askedFor.why.has(step);
  // Chosen once per opening so practising a card doesn't reshuffle or hide it under the learner.
  const [{ shown: shownTargets, hidden: hiddenTargets }] = useState(() => selectSentenceTargets(here, events));
  const blurb = chunk ? roleGuideBlurb(chunk.role) : undefined;
  const visitId = useMemo(() => createId('visit'), []);

  function recordGist(outcome: 'got_it' | 'needed_help') {
    onEvent?.({ id: createId('sl_event'), visitId, action: 'gist_check', sentenceId: sentence.id, outcome, assessmentSource: 'self', quietMode });
    setGist('recorded');
  }

  useEffect(() => {
    onEvent?.({ id: `${visitId}:opened`, visitId, action: 'walkthrough_opened', sentenceId: sentence.id, quietMode });
    // Once per opening; quietMode at that moment is what is recorded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId, sentence.id]);

  useEffect(() => {
    if (done && ordered.length > 0) onEvent?.({ id: `${visitId}:completed`, visitId, action: 'walkthrough_completed', sentenceId: sentence.id, quietMode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  if (expressing) {
    return (
      <SentenceExpressionCard
        sentence={sentence}
        translation={sentence.translation ?? ''}
        units={meaningUnits(chunks, sentence.translation ?? '')}
        visitId={visitId}
        quietMode={quietMode}
        wordBank={[...new Set(sentence.vocabularySuggestions.filter((item) => item.selectedByDefault).map((item) => item.expression))]}
        shadowHref={audio ? shadowHref : undefined}
        onEvent={(event) => onEvent?.(event)}
        onClose={() => setExpressing(false)}
      />
    );
  }

  return (
    <section className="panel stack sentence-walkthrough" aria-label="Sentence walkthrough" style={{ gap: '0.5rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <strong>Walk through this sentence</strong>
        <button type="button" onClick={onClose}>Back to reading</button>
      </div>
      <ol className="muted" aria-label="Learning stages" style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
        {STAGES.map((stage, index) => (
          <li key={stage} aria-current={index === 0 ? 'step' : undefined}>
            {stage}{index === 0 ? ' — guided here' : ' — not assessed yet'}
          </li>
        ))}
      </ol>
      <label className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
        <span className="muted">Help level</span>
        <select aria-label="Help level" value={preset} onChange={(event) => setPreset(event.target.value as SupportPreset)}>
          {(Object.keys(PRESET_LABELS) as SupportPreset[]).map((key) => <option key={key} value={key}>{PRESET_LABELS[key]}</option>)}
        </select>
      </label>
      <ChunkPuzzleStrip
        chunks={chunks.map(({ id, japanese, role }) => ({ id, japanese, role }))}
        revealedIds={done ? undefined : revealedIds}
        revealRoles={preset !== 'minimal'}
      />
      {done ? (
        <div className="stack" style={{ gap: '0.35rem' }}>
          <div className="jp jp-lg">{sentence.japanese}</div>
          {gist === 'closed' && !showTranslation && sentence.translation?.trim() ? (
            <button type="button" onClick={() => setGist('asking')}>Check my understanding</button>
          ) : null}
          {gist === 'asking' ? (
            <div className="stack" style={{ gap: '0.25rem' }} aria-label="Understanding check" aria-live="polite">
              <div>In your own words, what does this whole sentence say? Translation stays hidden until you ask.</div>
              <textarea rows={2} aria-label="Your understanding" value={gistAnswer} onChange={(event) => setGistAnswer(event.target.value)} />
              <button type="button" onClick={() => { setShowTranslation(true); setGist('revealed'); }}>Reveal the translation</button>
            </div>
          ) : null}
          {gist === 'revealed' ? (
            <div className="stack" style={{ gap: '0.25rem' }} aria-label="Understanding check" aria-live="polite">
              {gistAnswer.trim() ? <div className="muted">You wrote: {gistAnswer.trim()}</div> : null}
              <div>{sentence.translation}</div>
              <div className="muted">Your wording can differ. Count it only if you had the main meaning before looking.</div>
              <div className="row" style={{ gap: '0.35rem' }}>
                <button type="button" onClick={() => recordGist('got_it')}>I had the gist</button>
                <button type="button" onClick={() => recordGist('needed_help')}>I missed something</button>
              </div>
            </div>
          ) : null}
          {gist === 'recorded' ? <div className="muted" role="status">Noted. This says nothing about any single word or pattern, and your review schedule is unchanged.</div> : null}
          {gist === 'closed' || gist === 'asking' ? (
            showTranslation ? (
              <div>{sentence.translation || '(no translation saved)'}</div>
            ) : gist === 'closed' ? (
              <button type="button" onClick={() => setShowTranslation(true)}>Show natural translation</button>
            ) : null
          ) : null}
          {sentence.translation?.trim() ? (
            <button type="button" onClick={() => setExpressing(true)}>Say it in Japanese</button>
          ) : null}
          <button type="button" onClick={() => setStep(0)}>Walk through again</button>
        </div>
      ) : chunk ? (
        <div className="stack" style={{ gap: '0.25rem' }} aria-live="polite">
          <div className="jp jp-lg">{chunk.japanese}</div>
          <div>
            {showRole ? <strong>{chunk.role || 'Unlabelled'}</strong> : <button type="button" onClick={() => ask('role')}>Show role</button>}
            {chunk.literalEnglish ? (showGloss ? <> · “{chunk.literalEnglish}”</> : <> <button type="button" onClick={() => ask('gloss')}>Show gloss</button></>) : null}
          </div>
          {showRole && showWhy ? (
            <>
              {blurb ? <div className="muted">{blurb}</div> : <div className="muted">No guide text for this role yet.</div>}
              {chunk.notes ? <div className="muted">{chunk.notes}</div> : null}
            </>
          ) : showRole ? (
            <button type="button" onClick={() => ask('why')}>Explain this role</button>
          ) : null}
        </div>
      ) : null}
      {compareAids?.get(sentence.id)?.words.length ? (
        <div className="stack" style={{ gap: '0.15rem' }}>
          <span className="muted">Words in this sentence:</span>
          <WordGlossList words={compareAids.get(sentence.id)!.words} />
        </div>
      ) : null}
      <div className="row">
        <button type="button" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</button>
        <button type="button" className="primary" disabled={done} onClick={() => setStep((value) => value + 1)}>
          {step >= ordered.length - 1 ? 'Finish' : 'Continue'}
        </button>
        <span className="muted">{done ? 'Done' : `Step ${step + 1} of ${ordered.length}`}</span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
        {source === 'saved'
          ? 'From your saved analysis of this sentence.'
          : source === 'ai_draft'
            ? 'From the AI reply you pasted, not verified by you. Correct it on Analyze.'
            : 'Automatic draft: roles are generic, not verified for this sentence. Correct it on Analyze.'}
      </p>
      {here.length > 0 ? (
        <div className="stack" style={{ gap: '0.25rem' }}>
          <span className="muted">Worth noticing here (recurs in this episode). Practice is optional and never changes your review schedule.</span>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {(showAllTargets ? [...shownTargets, ...hiddenTargets] : shownTargets).map((target) => (
              <TargetLessonCard
                key={target.id}
                target={target}
                sentenceId={sentence.id}
                visitId={visitId}
                episodeSentences={episodeSentences}
                compareAids={compareAids}
                events={events}
                quietMode={quietMode}
                onEvent={(event) => onEvent?.(event)}
              />
            ))}
          </ul>
          {hiddenTargets.length > 0 && !showAllTargets ? (
            <button type="button" onClick={() => setShowAllTargets(true)}>
              Show {hiddenTargets.length} more {hiddenTargets.length === 1 ? 'target' : 'targets'}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        {audio ? (
          <NativeAudioButton audio={audio} displayLabel="Native audio" />
        ) : (
          <span className="muted">No native audio for this sentence; reading and the walkthrough still work.</span>
        )}
        <label className="row" style={{ gap: '0.35rem' }}>
          <input type="checkbox" checked={quietMode} onChange={(event) => onQuietModeChange(event.target.checked)} />
          Can&rsquo;t speak right now
        </label>
      </div>
    </section>
  );
}
