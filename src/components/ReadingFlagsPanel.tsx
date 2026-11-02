import { useLiveQuery } from 'dexie-react-hooks';

import { applyReadingFlagChoice, listOpenMeaningCheckIssues, settleChunkIssueReports } from '../db/repository';
import type { Sentence } from '../domain/types';
import { parseInlineReadings } from '../lib/parseInlineReadings';
import { parseReadingFlagNote } from '../lib/readingFlagFix';

/**
 * Open "Reading check" flags for one sentence, shown beside the native audio so
 * the learner can listen and then pick the furigana: the assistant's reading
 * rewrites the sentence, "Keep" dismisses the flag (and stops it being filed
 * again on later imports). Renders nothing when the sentence has no open flags.
 */
export function ReadingFlagsPanel({ sentence }: { sentence: Pick<Sentence, 'id' | 'inlineReading' | 'japanese'> }) {
  const issues = useLiveQuery(() => listOpenMeaningCheckIssues(sentence.id), [sentence.id]);
  if (!issues || issues.length === 0) return null;

  const flags = issues.map((issue) => ({ issue, flag: parseReadingFlagNote(issue.note) }));
  const flagged = flags.flatMap(({ flag }) => (flag ? [`${flag.base}\u0000${flag.furigana}`] : []));
  const segments = sentence.inlineReading ? parseInlineReadings(sentence.inlineReading) : null;

  return (
    <div className="stack" style={{ gap: '0.4rem' }} aria-label="Reading flags">
      <strong>Check the reading — listen, then pick</strong>
      {segments ? (
        <div className="jp jp-lg">
          {segments.map((seg, index) =>
            seg.kind === 'ruby' && seg.reading ? (
              <ruby key={index}>
                {flagged.includes(`${seg.base}\u0000${seg.reading}`) ? <mark>{seg.base}</mark> : seg.base}
                <rt>{seg.reading}</rt>
              </ruby>
            ) : (
              <span key={index}>{seg.base}</span>
            ),
          )}
        </div>
      ) : (
        <div className="jp jp-lg">{sentence.japanese}</div>
      )}
      {flags.map(({ issue, flag }) =>
        flag ? (
          <div key={issue.id} className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="jp">{flag.base}</span>
            <button type="button" onClick={() => void settleChunkIssueReports([issue.id], 'dismissed')}>
              Keep {flag.furigana}
            </button>
            <button type="button" onClick={() => void applyReadingFlagChoice(issue.id)}>
              Use {flag.assistant}
            </button>
          </div>
        ) : (
          <div key={issue.id} className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="muted">{issue.note}</span>
            <button type="button" onClick={() => void settleChunkIssueReports([issue.id], 'dismissed')}>
              Not an issue
            </button>
            <button type="button" onClick={() => void settleChunkIssueReports([issue.id], 'resolved')}>
              Mark resolved
            </button>
          </div>
        ),
      )}
    </div>
  );
}
