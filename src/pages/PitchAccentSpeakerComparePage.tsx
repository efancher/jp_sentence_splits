import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { PitchAccentDiagram } from '../components/PitchAccentDiagram';
import { WordPitchContour } from '../components/WordPitchContour';
import {
  getPitchAccentSpeakerComparisons,
  type PitchAccentSpeakerClip,
} from '../db/repository';
import { useRangeLoop } from '../hooks/useRangeLoop';
import { useSentenceAudioBlob } from '../hooks/useSentenceAudioBlob';
import { splitOnSurfaceForm } from '../lib/surfaceForm';
import { matchesVocabularySearch } from './VocabularyListPage';

/** One recording of the word: play it, see its measured pitch under the play control. */
function SpeakerClipTile({
  clip,
  surfaceForm,
  playingId,
  onPlay,
}: {
  clip: PitchAccentSpeakerClip;
  surfaceForm: string;
  playingId: string | null;
  onPlay: (id: string | null) => void;
}) {
  const tileId = `${clip.bookId}:${clip.audio.id}`;
  const blob = useSentenceAudioBlob(clip.audio);
  const loop = useRangeLoop(clip.audio.id, blob);
  const loopRef = useRef(loop);
  loopRef.current = loop;

  // Only one clip plays at a time: another tile taking over stops this one.
  useEffect(() => {
    if (playingId !== tileId && loopRef.current.isLooping) loopRef.current.cancel();
  }, [playingId, tileId]);

  function togglePlay() {
    if (loop.isLooping) {
      onPlay(null);
      loop.cancel();
      return;
    }
    onPlay(tileId);
    void loop.toggleLoop(clip.span);
  }

  const [before, match, after] = splitOnSurfaceForm(clip.sentence.japanese, surfaceForm);

  return (
    <div className="list-card stack" style={{ gap: '0.5rem' }}>
      <audio ref={loop.audioElRef} src={loop.objectUrl ?? undefined} hidden />
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{clip.bookTitle}</strong>
        <button
          type="button"
          className={`speak-button${loop.isLooping ? ' speaking' : ''}`}
          onClick={togglePlay}
          disabled={!blob}
          aria-label={`${loop.isLooping ? 'Stop' : 'Play'} ${clip.bookTitle}'s clip of ${surfaceForm}`}
        >
          {loop.isLooping ? '⏸' : '▶'} Play
        </button>
      </div>
      {loop.playbackError ? (
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {loop.playbackError}
        </span>
      ) : null}
      <div className="jp muted">
        {before}
        {match ? <mark>{match}</mark> : null}
        {after}
      </div>
      <WordPitchContour
        audioId={clip.audio.id}
        blob={blob}
        span={clip.span}
        ariaLabel={`Measured pitch of ${surfaceForm} from ${clip.bookTitle}`}
      />
    </div>
  );
}

/**
 * Browse tool (docs/ROADMAP.md): words mined in citation form from 2+
 * different books, played back to back against each other and against the
 * dictionary pitch pattern (`getPitchAccentSpeakerComparisons`). Not a
 * drill — nothing is scored or scheduled, this is for listening around a
 * word's real-world pitch variation.
 */
export function PitchAccentSpeakerComparePage() {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const comparisons = useLiveQuery(() => getPitchAccentSpeakerComparisons(), []);
  const filtered = (comparisons ?? []).filter((entry) =>
    matchesVocabularySearch(entry.vocabularyItem, query),
  );
  const selected =
    filtered.find((entry) => entry.vocabularyItem.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Compare speakers</h2>
          <Link to="/pitch-accent">
            <button type="button">Back to drill</button>
          </Link>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Words mined from 2+ different books, so you can hear how the same
          word's pitch accent sounds across recordings next to the dictionary
          pattern. A book stands in for a speaker here — not a verified
          per-clip identity, so a multi-narrator book can show up as one
          "speaker."
        </p>
      </section>

      {comparisons === undefined ? (
        <p className="muted">Loading…</p>
      ) : comparisons.length === 0 ? (
        <p className="muted">No words yet have audio in 2+ different books.</p>
      ) : (
        <div className="row" style={{ gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <section
            className="panel stack"
            style={{ flex: '1 1 16rem', maxHeight: '32rem', overflowY: 'auto' }}
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search word or meaning…"
              aria-label="Search words"
            />
            <div className="stack" style={{ gap: '0.35rem' }}>
              {filtered.map(({ vocabularyItem, clips }) => (
                <button
                  key={vocabularyItem.id}
                  type="button"
                  className="list-card"
                  onClick={() => setSelectedId(vocabularyItem.id)}
                  style={
                    vocabularyItem.id === selected?.vocabularyItem.id
                      ? { borderColor: 'var(--accent)' }
                      : undefined
                  }
                >
                  <div>
                    <span className="jp">{vocabularyItem.expression}</span>{' '}
                    <span className="muted">{vocabularyItem.reading}</span>
                  </div>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>
                    {clips.length} recordings · {vocabularyItem.meaning || '(no meaning yet)'}
                  </div>
                </button>
              ))}
              {filtered.length === 0 ? <p className="muted">No matches.</p> : null}
            </div>
          </section>

          <section className="panel stack" style={{ flex: '2 1 24rem' }}>
            {selected ? (
              <>
                <div className="row" style={{ alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <div className="jp jp-lg">{selected.vocabularyItem.expression}</div>
                    <div className="muted">
                      {selected.vocabularyItem.reading} — {selected.vocabularyItem.meaning}
                    </div>
                  </div>
                  <PitchAccentDiagram
                    reading={selected.vocabularyItem.reading}
                    position={selected.vocabularyItem.pitchAccentPositions![0]!}
                  />
                </div>
                <div className="stack" style={{ gap: '0.75rem' }}>
                  {selected.clips.map((clip) => (
                    <SpeakerClipTile
                      key={`${clip.bookId}:${clip.audio.id}`}
                      clip={clip}
                      surfaceForm={selected.vocabularyItem.expression}
                      playingId={playingId}
                      onPlay={setPlayingId}
                    />
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">Pick a word from the list.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
