import { useEffect, useState } from 'react';

import { getWordMeaningCheckTarget } from '../db/repository';
import type { Sentence } from '../domain/types';
import { gradeDictation, typedAsKana } from '../lib/dictationAnswer';
import { FOLLOW_UP_LABEL, FOLLOW_UP_PURPOSE, type FollowUpTool } from '../lib/followUpOffer';
import type { TileDictation } from '../lib/earTiles';

/**
 * Study tools that act on the reader's focused sentence in place (docs/ROADMAP.md
 * "reader as the single study surface"). Each reports the learner's own
 * "got it / needed help" call; nothing here grades FSRS or picks a rating.
 */
export type ReaderToolOutcome = 'got_it' | 'needed_help';

/** The blanked sentence line for dictation: the sentence with the target phrase cut out. */
export function DictationBlankLine({ tile }: { tile: TileDictation }) {
  return (
    <div className="jp jp-lg" lang="ja" aria-label="Sentence with a phrase blanked">
      {tile.before}
      <span aria-hidden="true">＿＿＿</span>
      {tile.after}
    </div>
  );
}

export function DictationBlankPanel({
  tile,
  hasAudio,
  playing,
  onPlay,
  onAnotherPhrase,
  onRecord,
  onClose,
}: {
  tile: TileDictation;
  hasAudio: boolean;
  playing: boolean;
  onPlay: () => void;
  onAnotherPhrase: () => void;
  onRecord: (outcome: ReaderToolOutcome) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const grade = checked ? gradeDictation(typed, tile.text, tile.reading || undefined) : null;
  const asKana = typedAsKana(typed);

  return (
    <div className="stack" style={{ gap: '0.35rem' }} role="group" aria-label="Dictation">
      <p className="muted" style={{ margin: 0 }}>
        Listen and type the missing phrase (kanji, kana or romaji).
      </p>
      <div className="row" style={{ gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {hasAudio ? (
          <button type="button" onClick={onPlay}>{playing ? 'Stop' : 'Play'}</button>
        ) : (
          <span className="muted">No audio for this sentence.</span>
        )}
        <button type="button" onClick={onAnotherPhrase}>Another phrase</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      {!checked ? (
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            if (typed.trim()) setChecked(true);
          }}
        >
          <label>
            Missing phrase
            <input type="text" value={typed} autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
          </label>
          <button type="submit">Check</button>
        </form>
      ) : (
        <div className="stack" style={{ gap: '0.25rem' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{grade?.correct ? '✓ Matches' : '✗ Not quite'}</p>
          <p style={{ margin: 0 }}>
            Answer: <span className="jp">{tile.text}</span>
            {tile.reading && tile.reading !== tile.text ? <span className="muted"> ({tile.reading})</span> : null}
          </p>
          {!grade?.correct ? (
            <p className="muted" style={{ margin: 0 }}>
              You typed: <span className="jp">{typed.trim()}</span>
              {asKana ? <> → <span className="jp">{asKana}</span></> : null}
            </p>
          ) : null}
          {!recorded ? (
            <div className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
              <span className="muted">How was that?</span>
              <button type="button" onClick={() => { onRecord('got_it'); setRecorded(true); }}>Got it</button>
              <button type="button" onClick={() => { onRecord('needed_help'); setRecorded(true); }}>Needed help</button>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>Recorded. Close this or try another phrase.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Read check: the sentence is shown plain (no furigana, word help or translation), the learner reads
 * it, optionally listens, then reveals the help and judges how it went. Their call is evidence only.
 */
export function ReadCheckPanel({
  revealed,
  hasAudio,
  playing,
  onPlay,
  onReveal,
  onRecord,
  offer,
  onTakeOffer,
  onClose,
}: {
  revealed: boolean;
  hasAudio: boolean;
  playing: boolean;
  onPlay: () => void;
  onReveal: () => void;
  onRecord: (outcome: ReaderToolOutcome) => void;
  /** The follow-up suggested once "Needed help" is recorded; taking it opens that tool on this sentence. */
  offer?: FollowUpTool;
  onTakeOffer?: () => void;
  onClose: () => void;
}) {
  const [recorded, setRecorded] = useState(false);
  return (
    <div className="stack" style={{ gap: '0.35rem' }} role="group" aria-label="Read check">
      {!revealed ? (
        <>
          <p style={{ margin: 0 }}>Read it without help: what does this sentence say?</p>
          <div className="row" style={{ gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="primary" onClick={onReveal}>Show help and meaning</button>
            {hasAudio ? <button type="button" onClick={onPlay}>{playing ? 'Stop' : 'Listen'}</button> : null}
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </>
      ) : !recorded ? (
        <div className="row" style={{ gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted">Did you understand it before the reveal?</span>
          <button type="button" onClick={() => { onRecord('got_it'); setRecorded(true); }}>Got it</button>
          <button type="button" onClick={() => { onRecord('needed_help'); setRecorded(true); }}>Needed help</button>
        </div>
      ) : (
        <div className="row" style={{ gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="muted">Recorded.</span>
          {offer && onTakeOffer ? (
            <>
              <span>Try {FOLLOW_UP_LABEL[offer]} on it? <span className="muted">({FOLLOW_UP_PURPOSE[offer]})</span></span>
              <button type="button" className="primary" onClick={onTakeOffer}>Try it</button>
              <button type="button" onClick={onClose}>Not now</button>
            </>
          ) : (
            <button type="button" onClick={onClose}>Close</button>
          )}
        </div>
      )}
    </div>
  );
}

/** A content word of the selected sentence the learner can tap to say whether they knew it. */
export interface ReaderWord {
  vocabularyItemId: string;
  surface: string;
  expression: string;
  reading: string;
  meaning: string;
}

/**
 * The learner taps a word and says, in their own words, whether they knew its reading and meaning.
 * Nothing is graded: each answer is evidence for the word-strength model (recall when the answer was
 * hidden while they read, recognition when it was showing). Looking a word up records nothing.
 */
export function WordFeedbackPanel({
  word,
  readingHidden,
  meaningHidden,
  onRecord,
  onShadowPhrase,
  onClose,
}: {
  word: ReaderWord;
  /** Whether the reading / meaning was hidden (no furigana, no word help) when the learner read the word. */
  readingHidden: boolean;
  meaningHidden: boolean;
  onRecord: (facet: 'reading' | 'meaning', outcome: ReaderToolOutcome) => void;
  /** Offered after "I didn't" on the reading: open phrase shadowing on this word's phrase. Absent when the sentence has no clip or sound is off. */
  onShadowPhrase?: () => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [given, setGiven] = useState<{ reading?: ReaderToolOutcome; meaning?: ReaderToolOutcome }>({});
  const record = (facet: 'reading' | 'meaning', outcome: ReaderToolOutcome) => {
    if (given[facet]) return;
    onRecord(facet, outcome);
    setGiven((current) => ({ ...current, [facet]: outcome }));
    setShown(true);
  };
  const row = (facet: 'reading' | 'meaning', label: string, hidden: boolean) => (
    <div className="row" style={{ gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ minWidth: '4.5rem' }}>{label}</span>
      {given[facet] ? (
        <span className="muted">{given[facet] === 'got_it' ? 'You knew it' : 'You didn’t know it'}</span>
      ) : (
        <>
          <button type="button" onClick={() => record(facet, 'got_it')}>I knew it</button>
          <button type="button" onClick={() => record(facet, 'needed_help')}>I didn’t</button>
          <span className="muted" style={{ fontSize: '0.8rem' }}>{hidden ? 'was hidden' : 'was showing'}</span>
        </>
      )}
    </div>
  );
  return (
    <div className="stack" style={{ gap: '0.35rem' }} role="group" aria-label="Word feedback">
      <p style={{ margin: 0 }}>
        How well did you know <strong className="jp">{word.surface}</strong>?
      </p>
      {row('reading', 'Reading', readingHidden)}
      {row('meaning', 'Meaning', meaningHidden)}
      {shown ? (
        <p style={{ margin: 0 }}>
          <span className="jp">{word.expression}</span>
          {word.reading ? <span className="muted"> ({word.reading})</span> : null}
          {word.meaning ? <> — {word.meaning}</> : null}
        </p>
      ) : (
        <div><button type="button" onClick={() => setShown(true)}>Show reading and meaning</button></div>
      )}
      {onShadowPhrase && given.reading === 'needed_help' ? (
        <div><button type="button" onClick={onShadowPhrase}>Shadow this phrase</button></div>
      ) : null}
      <div><button type="button" onClick={onClose}>Close</button></div>
    </div>
  );
}

/** A grammar pattern linked to a sentence, with where it sits in the text. */
export interface ReaderPattern {
  patternId: string;
  name: string;
  shortMeaning: string;
  /** What the construction does in this very sentence, when the link records it. */
  occurrenceExplanation?: string;
  surface: string;
  start: number;
  end: number;
}

/**
 * The learner taps a grammar pattern in the sentence and says whether they spotted it as a construction and
 * whether they understood what it does here. Evidence only, like the word panel; the pattern's name and meaning
 * stay hidden until they have answered (or asked to see them).
 */
export function PatternFeedbackPanel({
  pattern,
  onRecord,
  onClose,
}: {
  pattern: ReaderPattern;
  onRecord: (facet: 'spot' | 'use', outcome: ReaderToolOutcome) => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [given, setGiven] = useState<{ spot?: ReaderToolOutcome; use?: ReaderToolOutcome }>({});
  const record = (facet: 'spot' | 'use', outcome: ReaderToolOutcome) => {
    if (given[facet]) return;
    onRecord(facet, outcome);
    setGiven((current) => ({ ...current, [facet]: outcome }));
    setShown(true);
  };
  const row = (facet: 'spot' | 'use', label: string, hint: string) => (
    <div className="row" style={{ gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ minWidth: '6.5rem' }}>{label}</span>
      {given[facet] ? (
        <span className="muted">{given[facet] === 'got_it' ? 'You knew it' : 'You didn’t know it'}</span>
      ) : (
        <>
          <button type="button" onClick={() => record(facet, 'got_it')}>I knew it</button>
          <button type="button" onClick={() => record(facet, 'needed_help')}>I didn’t</button>
          <span className="muted" style={{ fontSize: '0.8rem' }}>{hint}</span>
        </>
      )}
    </div>
  );
  return (
    <div className="stack" style={{ gap: '0.35rem' }} role="group" aria-label="Grammar feedback">
      <p style={{ margin: 0 }}>
        How well did you know the grammar in <strong className="jp">{pattern.surface}</strong>?
      </p>
      {row('spot', 'Spotting it', 'saw it as a pattern')}
      {row('use', 'What it does', 'understood it here')}
      {shown ? (
        <p style={{ margin: 0 }}>
          <strong className="jp">{pattern.name}</strong>
          {pattern.occurrenceExplanation || pattern.shortMeaning ? <> — {pattern.occurrenceExplanation || pattern.shortMeaning}</> : null}
        </p>
      ) : (
        <div><button type="button" onClick={() => setShown(true)}>Show the pattern</button></div>
      )}
      <div><button type="button" onClick={onClose}>Close</button></div>
    </div>
  );
}

type MeaningTarget = Awaited<ReturnType<typeof getWordMeaningCheckTarget>>;

export function WordMeaningPanel({
  sentence,
  onRecord,
  onClose,
}: {
  sentence: Pick<Sentence, 'id' | 'japanese' | 'vocabularySuggestions'>;
  onRecord: (outcome: ReaderToolOutcome, target: NonNullable<MeaningTarget>) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<MeaningTarget | 'loading'>('loading');
  const [revealed, setRevealed] = useState(false);
  const [recorded, setRecorded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // A snapshot per open: the word must not change while the learner is thinking of its meaning.
    void getWordMeaningCheckTarget(sentence).then(
      (found) => { if (!cancelled) setTarget(found); },
      () => { if (!cancelled) setTarget(undefined); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by sentence id; the object identity changes on every render
  }, [sentence.id]);

  if (target === 'loading') return <p className="muted">Picking a word…</p>;
  if (!target) {
    return (
      <div className="stack" style={{ gap: '0.25rem' }}>
        <p className="muted" style={{ margin: 0 }}>No word with a saved meaning to check in this sentence.</p>
        <div><button type="button" onClick={onClose}>Close</button></div>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: '0.35rem' }} role="group" aria-label="Word meaning check">
      <p style={{ margin: 0 }}>
        What does <strong className="jp">{target.surface}</strong> mean here?
      </p>
      {!revealed ? (
        <div className="row" style={{ gap: '0.4rem' }}>
          <button type="button" onClick={() => setRevealed(true)}>Show meaning</button>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      ) : (
        <div className="stack" style={{ gap: '0.25rem' }}>
          <p style={{ margin: 0 }}>
            <span className="jp">{target.expression}</span>
            {target.reading ? <span className="muted"> ({target.reading})</span> : null} — {target.meaning}
          </p>
          {!recorded ? (
            <div className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
              <span className="muted">Did you have it?</span>
              <button type="button" onClick={() => { onRecord('got_it', target); setRecorded(true); }}>Got it</button>
              <button type="button" onClick={() => { onRecord('needed_help', target); setRecorded(true); }}>Needed help</button>
            </div>
          ) : (
            <div className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
              <span className="muted">Recorded.</span>
              <button type="button" onClick={onClose}>Close</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The learner's own call on how a shadowing pass at the whole sentence sounded: "Good" or "Not good".
 * Evidence only (a `target_practice` event); it grades no card and replaces no measured analysis.
 */
export function ShadowSelfRating({ onRecord }: { onRecord: (outcome: ReaderToolOutcome) => void }) {
  const [given, setGiven] = useState<ReaderToolOutcome | undefined>();
  return (
    <div className="row" style={{ gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }} role="group" aria-label="Rate your pronunciation">
      <span className="muted">How did your pronunciation go?</span>
      <button type="button" aria-pressed={given === 'needed_help'} onClick={() => { onRecord('needed_help'); setGiven('needed_help'); }}>Not good</button>
      <button type="button" aria-pressed={given === 'got_it'} onClick={() => { onRecord('got_it'); setGiven('got_it'); }}>Good</button>
    </div>
  );
}
