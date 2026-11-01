import { useEffect, useState } from 'react';

import { getWordMeaningCheckTarget } from '../db/repository';
import type { Sentence } from '../domain/types';
import { gradeDictation, typedAsKana } from '../lib/dictationAnswer';
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
  onClose,
}: {
  revealed: boolean;
  hasAudio: boolean;
  playing: boolean;
  onPlay: () => void;
  onReveal: () => void;
  onRecord: (outcome: ReaderToolOutcome) => void;
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
        <div className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
          <span className="muted">Recorded.</span>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      )}
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
