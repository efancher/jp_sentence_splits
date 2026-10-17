/** Read-only inventory. --check validates bundled data without credentials or network. */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { CLAUSE_PILOT } from '../src/data/clausePilot';
import notes from '../src/data/clauseReviewNotes.json';
import { clausePilotFor } from '../src/lib/clausePilot';
import { activeQuestionCoverage, type CoverageBook } from '../src/lib/clauseQuestionCoverage';
import { fetchAll, requireAuthedUser } from './lib/scriptHelpers';
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

const { values } = parseArgs({ options: { check: { type: 'boolean' }, output: { type: 'string' } } });
const ids = new Set<string>(); const sources = new Set<string>();
for (const reference of CLAUSE_PILOT) {
  if (!reference.id || !reference.question.trim() || !reference.explanation.trim() ||
      ids.has(reference.id) || sources.has(reference.source) || clausePilotFor(reference.source, [reference]) !== reference) {
    throw new Error(`Invalid or duplicate question: ${reference.id}`);
  }
  ids.add(reference.id); sources.add(reference.source);
}
for (const note of notes) {
  if (!note.id || !note.source.trim() || !note.reason.trim() || ids.has(note.id) || sources.has(note.source)) {
    throw new Error(`Invalid, duplicate, or question-overlapping review note: ${note.id}`);
  }
  ids.add(note.id); sources.add(note.source);
}
console.log(`Validated ${CLAUSE_PILOT.length} questions and ${notes.length} review notes.`);
if (!values.check) {
  if (!values.output) throw new Error('Use --check or --output <new private JSON file>.');
  const client = await createScriptSupabaseClient();
  const user = await requireAuthedUser(client);
  const [books, memberships, sentences] = await Promise.all([
    fetchAll(client, 'books', 'id,title,archived,suspended_at,chapters', user.id, (r): CoverageBook => ({
      id: String(r.id), title: String(r.title), archived: Boolean(r.archived),
      suspendedAt: r.suspended_at ? String(r.suspended_at) : undefined,
      chapters: Array.isArray(r.chapters) ? r.chapters as CoverageBook['chapters'] : [],
    })),
    fetchAll(client, 'book_sentences', 'id,book_id,chapter_id,sentence_id,position', user.id, (r) => ({
      bookId: String(r.book_id), sentenceId: String(r.sentence_id),
      chapterId: r.chapter_id ? String(r.chapter_id) : undefined, position: Number(r.position),
    })),
    fetchAll(client, 'sentences', 'id,japanese,translation', user.id, (r) => ({
      id: String(r.id), japanese: String(r.japanese), translation: String(r.translation ?? ''),
    })),
  ]);
  const rows = activeQuestionCoverage(books, memberships, sentences);
  const counts = { ready: rows.filter((r) => r.status === 'ready').length,
    reviewed: rows.filter((r) => r.status === 'reviewed').length,
    missing: rows.filter((r) => r.status === 'missing').length };
  const report = { exportedAt: new Date().toISOString(), counts,
    activeMemberships: rows.reduce((total, row) => total + row.memberships.length, 0), sentences: rows };
  await writeFile(values.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...counts, uniqueSentences: rows.length, activeMemberships: report.activeMemberships }));
  console.log(`Read-only inventory saved to ${values.output}; no learner data changed.`);
}
