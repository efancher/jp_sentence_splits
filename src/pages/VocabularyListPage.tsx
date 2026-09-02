import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isHiragana, toHiragana } from 'wanakana';

import { PitchAccentDiagram } from '../components/PitchAccentDiagram';
import { getDb, readSettings, updateVocabularyItem } from '../db/repository';
import type { VocabularyItem } from '../domain/types';
import { isHanCharacter } from '../lib/kanji';
import { computeGraduatedSubjectIds } from '../lib/scheduling';

export function matchesVocabularySearch(item: VocabularyItem, query: string): boolean {
  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  if (!q) return true;
  // Lets typing romaji (e.g. "neko") match hiragana readings (e.g. "ねこ")
  // without an OS-level Japanese IME; only applied when fully convertible,
  // so plain English queries like "dog" can't partially mutate into kana.
  const qHiragana = toHiragana(trimmed);
  const readingQuery = isHiragana(qHiragana) ? qHiragana : null;
  return (
    item.expression.includes(trimmed) ||
    item.reading.includes(trimmed) ||
    (readingQuery !== null && item.reading.includes(readingQuery)) ||
    item.meaning.toLowerCase().includes(q)
  );
}

function VocabularyMeaningField({ item }: { item: VocabularyItem }) {
  const [meaning, setMeaning] = useState(item.meaning);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>(
    'idle',
  );

  useEffect(() => {
    setMeaning(item.meaning);
    setSaveState('idle');
  }, [item.id, item.meaning]);

  async function save() {
    if (meaning === item.meaning) return;
    setSaveState('saving');
    await updateVocabularyItem(item.id, { meaning: meaning.trim() });
    setSaveState('saved');
  }

  return (
    <div className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
      <input
        value={meaning}
        onChange={(event) => {
          setMeaning(event.target.value);
          setSaveState('idle');
        }}
        onBlur={() => void save()}
        placeholder="Meaning (English)…"
        aria-label={`Meaning for ${item.expression}`}
        style={{ flex: 1 }}
      />
      {saveState === 'saving' ? (
        <span className="muted">Saving…</span>
      ) : saveState === 'saved' ? (
        <span className="muted">Saved</span>
      ) : null}
    </div>
  );
}

export function VocabularyListPage() {
  const [query, setQuery] = useState('');
  const items = useLiveQuery(() => getDb().vocabularyItems.toArray(), []);
  const settings = useLiveQuery(() => readSettings(), []);
  const vocabularyStudyItems = useLiveQuery(
    () => getDb().studyItems.where('subjectType').equals('vocabularyItem').toArray(),
    [],
  );
  const graduatedItemIds = useMemo(() => {
    if (!vocabularyStudyItems || !settings) return new Set<string>();
    return computeGraduatedSubjectIds(vocabularyStudyItems, settings.graduationMinScheduledDays);
  }, [vocabularyStudyItems, settings]);

  const filtered = useMemo(() => {
    const all = [...(items ?? [])].sort((a, b) =>
      a.expression.localeCompare(b.expression, 'ja'),
    );
    if (!query.trim()) return all;
    return all.filter((item) => matchesVocabularySearch(item, query));
  }, [items, query]);

  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>Words</h2>
        <p className="muted" style={{ margin: 0 }}>
          Vocabulary confirmed via the picker on Analyze pages.
        </p>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Expression, reading (romaji ok), or meaning…"
          aria-label="Search vocabulary"
        />
      </section>

      <section className="stack">
        {items === undefined ? (
          <p className="muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="muted">
            {items.length === 0
              ? 'No confirmed vocabulary yet — confirm vocabulary selections on a sentence to see them here.'
              : 'No matching words.'}
          </p>
        ) : (
          filtered.map((item) => (
            <article key={item.id} className="list-card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="jp">
                  {Array.from(item.expression).map((char, index) =>
                    isHanCharacter(char) ? (
                      <Link key={index} to={`/kanji/${encodeURIComponent(char)}`}>
                        {char}
                      </Link>
                    ) : (
                      <span key={index}>{char}</span>
                    ),
                  )}
                </div>
                {graduatedItemIds.has(item.id) ? (
                  <span className="muted">Graduated</span>
                ) : null}
              </div>
              {item.reading ? <div className="muted">{item.reading}</div> : null}
              {item.reading && item.pitchAccentPositions?.length ? (
                <PitchAccentDiagram
                  reading={item.reading}
                  position={item.pitchAccentPositions[0]!}
                />
              ) : null}
              <VocabularyMeaningField item={item} />
              {item.partOfSpeech ? (
                <div className="muted">{item.partOfSpeech}</div>
              ) : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
