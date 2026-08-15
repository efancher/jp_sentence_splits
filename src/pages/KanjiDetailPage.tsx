import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useParams } from 'react-router-dom';

import { getDb } from '../db/repository';
import type { VocabularyItem } from '../domain/types';

export function KanjiDetailPage() {
  const { character } = useParams<{ character: string }>();

  const data = useLiveQuery(async () => {
    if (!character) return undefined;
    const db = getDb();
    const kanji = await db.kanji.where('character').equals(character).first();
    if (!kanji) return { kanji: null, words: [] as VocabularyItem[] };
    const links = await db.vocabularyKanji
      .where('kanjiId')
      .equals(kanji.id)
      .toArray();
    // A word can use the same kanji more than once (e.g. 主 twice in
    // 民主主義), producing multiple vocabularyKanji links for one word —
    // dedup by vocabularyItemId so it's listed once.
    const vocabularyItemIds = [...new Set(links.map((link) => link.vocabularyItemId))];
    const words = (await db.vocabularyItems.bulkGet(vocabularyItemIds)).filter(
      (item): item is VocabularyItem => Boolean(item),
    );
    words.sort((a, b) => a.expression.localeCompare(b.expression, 'ja'));
    return { kanji, words };
  }, [character]);

  return (
    <div className="stack">
      <section className="panel stack">
        <Link to="/vocabulary">
          <button type="button">Back to words</button>
        </Link>
        <div className="jp jp-lg">{character}</div>
        {data === undefined ? (
          <p className="muted">Loading…</p>
        ) : !data.kanji ? (
          <p className="muted">Unknown kanji.</p>
        ) : (
          <>
            {data.kanji.meanings.length ? (
              <div>{data.kanji.meanings.join(', ')}</div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                No meanings recorded yet.
              </p>
            )}
            {data.kanji.onyomi.length ? (
              <div className="muted">On: {data.kanji.onyomi.join('、')}</div>
            ) : null}
            {data.kanji.kunyomi.length ? (
              <div className="muted">Kun: {data.kanji.kunyomi.join('、')}</div>
            ) : null}
            {data.kanji.nanori.length ? (
              <div className="muted">Nanori: {data.kanji.nanori.join('、')}</div>
            ) : null}
          </>
        )}
      </section>

      <section className="stack">
        <h3 style={{ margin: 0 }}>Words containing this kanji</h3>
        {!data || data.words.length === 0 ? (
          <p className="muted">No confirmed words use this kanji yet.</p>
        ) : (
          data.words.map((item) => (
            <div key={item.id} className="list-card">
              <div className="jp">{item.expression}</div>
              {item.reading ? <div className="muted">{item.reading}</div> : null}
              <div>{item.meaning || '(no meaning yet)'}</div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
