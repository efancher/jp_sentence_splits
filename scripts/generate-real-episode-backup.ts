/**
 * Package one exported real chapter (see docs/STATUS.md "Real-chapter trial")
 * as a text-only backup for the private preview. Reads a local export
 * (default /tmp/real-chapter/data.json); the personal data never enters git.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { backupSchema } from '../src/domain/schemas';
import { APP_VERSION, BACKUP_FORMAT_VERSION } from '../src/appConfig';
import {
  remoteToBook, remoteToBookSentence, remoteToSentence,
  remoteToSentenceVocabulary, remoteToVocabularyItem,
} from '../src/sync/mappers';

const output = process.argv[2];
if (!output) throw new Error('Usage: tsx scripts/generate-real-episode-backup.ts OUTPUT.json [APP_ORIGIN] [EXPORT.json]');
const appBase = process.argv[3] ? `${new URL(process.argv[3]).origin}/` : '/';
const raw = JSON.parse(readFileSync(process.argv[4] ?? '/tmp/real-chapter/data.json', 'utf8'));
const now = new Date().toISOString();

const sentences = raw.sentences.map(remoteToSentence);
const live = new Set(sentences.map((s: { id: string }) => s.id));
const bookSentences = raw.bookSentences.map(remoteToBookSentence).filter((r: { sentenceId: string }) => live.has(r.sentenceId));
const book = { ...remoteToBook(raw.book), chapters: [raw.chapter], archived: false, suspendedAt: undefined };
const sentenceVocabulary = raw.sentenceVocabulary.map(remoteToSentenceVocabulary).filter((r: { sentenceId: string }) => live.has(r.sentenceId));
const data = {
  books: [book], sentences, bookSentences,
  analyses: [], vocabularyItems: raw.vocabularyItems.map(remoteToVocabularyItem), sentenceVocabulary,
  studyItems: [], reviews: [], importBatches: [], inbox: [], kanji: [], vocabularyKanji: [],
  grammarPatterns: [], sentenceGrammar: [], grammarRelationships: [], plannerSessions: [],
};
const payload = backupSchema.parse({
  formatVersion: BACKUP_FORMAT_VERSION, appVersion: APP_VERSION, exportedAt: now,
  counts: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.length])),
  ...data,
  settings: { id: 'settings', theme: 'system', hideSatoriEnglishInitially: true,
    showReadingsInitially: false, defaultImportDestination: 'new_book', textDisplayMode: 'plain' },
});
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(payload, null, 2));
const title = String(raw.chapter.title).replace(/[<>&]/g, '');
writeFileSync(`${dirname(output)}/real-episode.html`, `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Try the real episode</title>
<style>body{font:18px/1.6 system-ui;max-width:650px;margin:40px auto;padding:0 20px;background:#121411;color:#eee}a{color:#90d9ba}li{margin:16px 0}</style>
<h1>Try a real episode</h1>
<p>${title}: ${sentences.length} sentences with translations and vocabulary. Text only; backups do not include audio.</p>
<ol><li><a href="real-episode.json" download="real-episode.json">Download the episode</a>.</li>
<li>Open <a href="${appBase}#/settings">Settings</a>, choose <strong>Import backup JSON</strong>, select the file, then <strong>Merge into existing data</strong>.</li>
<li>Open <a href="${appBase}#/books/${book.id}/read?chapter=${raw.chapter.id}&amp;pack=1">the episode</a> (or Books, then the podcast, then this chapter, then Read). The <strong>Episode preparation</strong> box is near the top.</li></ol>
<p>Keep cloud sync disconnected in the preview so trial activity stays separate.</p>
</html>`);
console.log(`Created ${output}: ${sentences.length} sentences, ${bookSentences.length} memberships`);
