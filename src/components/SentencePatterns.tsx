import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';

import { getDb, removeSentenceGrammar, withoutUnseenAiLinks } from '../db/repository';

/**
 * "Patterns here": the grammar patterns linked to a sentence, shown on the walkthrough's finish screen (so only
 * once the sentence has been walked through). Links come from the book assistant's grammar extra or the learner's
 * own tagging; an assistant link may be wrong, so each has a one-tap "Not this". Showing a pattern grades nothing
 * and creates no card.
 */
export function SentencePatterns({ sentenceId }: { sentenceId: string }) {
  const rows = useLiveQuery(async () => {
    const db = getDb();
    const links = (await db.sentenceGrammar.where('sentenceId').equals(sentenceId).toArray()).sort(
      (a, b) => (a.start ?? Number.MAX_SAFE_INTEGER) - (b.start ?? Number.MAX_SAFE_INTEGER) || a.createdAt.localeCompare(b.createdAt),
    );
    const patterns = await db.grammarPatterns.bulkGet(links.map((link) => link.grammarPatternId));
    return Promise.all(
      links.flatMap((link, index) => {
        const pattern = patterns[index];
        if (!pattern) return [];
        return [
          (async () => {
            const sameElsewhere = await withoutUnseenAiLinks(
              await db.sentenceGrammar.where('grammarPatternId').equals(pattern.id).toArray(),
            );
            const others = new Set(sameElsewhere.map((item) => item.sentenceId));
            others.delete(sentenceId);
            return { link, pattern, otherSentences: others.size };
          })(),
        ];
      }),
    );
  }, [sentenceId]);

  if (!rows || rows.length === 0) return null;
  return (
    <div className="stack" style={{ gap: '0.3rem' }} aria-label="Patterns here">
      <strong>Patterns here</strong>
      {rows.map(({ link, pattern, otherSentences }) => (
        <div key={link.id} className="stack" style={{ gap: '0.1rem' }}>
          <div>
            <Link to={`/grammar/${encodeURIComponent(pattern.id)}`} className="jp">
              <strong>{pattern.canonicalName}</strong>
            </Link>
            {link.surfaceForm ? (
              <>
                {' '}
                in <span className="jp">{link.surfaceForm}</span>
              </>
            ) : null}
          </div>
          {link.occurrenceExplanation || pattern.shortMeaning ? (
            <div className="muted">{link.occurrenceExplanation || pattern.shortMeaning}</div>
          ) : null}
          <div className="row" style={{ gap: '0.5rem' }}>
            {otherSentences > 0 ? (
              <span className="muted">
                Also in {otherSentences} other sentence{otherSentences === 1 ? '' : 's'} you have met.
              </span>
            ) : null}
            {link.source === 'ai_suggested' && !link.confirmedByLearner ? (
              <button type="button" onClick={() => void removeSentenceGrammar(link.id)}>
                Not this
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
