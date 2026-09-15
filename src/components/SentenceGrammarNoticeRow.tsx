import { useLiveQuery } from 'dexie-react-hooks';

import { ensureSentenceGrammar, getSentenceGrammarLinks, removeSentenceGrammar } from '../db/repository';
import { blankPatternInSentence } from '../lib/grammarPatterns';

/**
 * Ambient grammar strip for a review reveal — same "always-rendered info
 * row under the sentence" convention as `SentencePitchAccentRow`, but for
 * tagged grammar patterns instead of pitch. Replaces the retired
 * `grammar_comprehension`/`grammar_completion`/`grammar_contrast`/
 * `grammar_production` FSRS ladder (docs/ROADMAP.md, 2026-09-15): rather
 * than a dedicated card per pattern, every sentence's tagged patterns
 * surface their explanation here, and an unconfirmed tag doubles as the
 * lightweight "did you notice it" check — the same `SentenceGrammar.
 * confirmedByLearner` flag `GrammarPicker`'s "Got it" button sets, just
 * reachable inline during regular review instead of only from a separate
 * annotation panel.
 *
 * Explanation is the point, not an afterthought: this is now the *only*
 * place in the app that surfaces a tagged pattern's meaning/explanation on
 * a review reveal, so it renders for confirmed links too (pure
 * reinforcement, no action needed) — not just unconfirmed ones.
 */
export function SentenceGrammarNoticeRow({
  sentenceId,
  japanese,
}: {
  sentenceId: string;
  japanese: string;
}) {
  const links = useLiveQuery(() => getSentenceGrammarLinks(sentenceId), [sentenceId]);

  if (!links || links.length === 0) return null;

  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      {links.map(({ link, pattern }) => {
        const blank = blankPatternInSentence(japanese, pattern.canonicalName);
        return (
          <div key={link.id} className="panel stack" style={{ gap: '0.25rem', boxShadow: 'none' }}>
            <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="jp">
                {blank ? (
                  <>
                    {blank.before}
                    <mark>{blank.match}</mark>
                    {blank.after}
                  </>
                ) : (
                  pattern.canonicalName
                )}
              </span>
              {!link.confirmedByLearner ? (
                <span className="muted" style={{ fontSize: '0.85rem' }}>
                  Notice this?
                </span>
              ) : null}
            </div>
            {pattern.shortMeaning ? <div className="muted">{pattern.shortMeaning}</div> : null}
            {pattern.explanation ? <div className="muted">{pattern.explanation}</div> : null}
            {pattern.structuralNotes ? (
              <div className="muted">{pattern.structuralNotes}</div>
            ) : null}
            {!link.confirmedByLearner ? (
              <div className="row" style={{ gap: '0.35rem' }}>
                <button
                  type="button"
                  onClick={() =>
                    void ensureSentenceGrammar(sentenceId, pattern.id, {
                      confirmedByLearner: true,
                    })
                  }
                >
                  Got it
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void removeSentenceGrammar(link.id)}
                >
                  Not this
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
