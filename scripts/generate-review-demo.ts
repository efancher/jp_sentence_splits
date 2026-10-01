/** Generate a portable, fictional review fixture; never reads personal data. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { backupSchema } from '../src/domain/schemas';
import { APP_VERSION, BACKUP_FORMAT_VERSION } from '../src/appConfig';

const output = process.argv[2];
if (!output) throw new Error('Usage: tsx scripts/generate-review-demo.ts OUTPUT.json [APP_ORIGIN]');
// Host the instructions outside the app's service-worker origin. Its navigation
// fallback otherwise replaces this HTML with the app after the first visit.
const appBase = process.argv[3] ? `${new URL(process.argv[3]).origin}/` : '/';
const now = new Date().toISOString();
const future = '2099-01-01T00:00:00.000Z';
const due = '2020-01-01T00:00:00.000Z';
const bookId = 'review-layout-demo';
const chapterId = `${bookId}-chapter`;
const lines = [
  ['土曜日の朝、雨が降っていました。', 'On Saturday morning, it was raining.'],
  ['私は駅の近くの図書館に行きました。', 'I went to the library near the station.'],
  ['入口で友達の美咲に会いました。', 'At the entrance, I met my friend Misaki.'],
  ['美咲は旅行の本を探していました。', 'Misaki was looking for a travel book.'],
  ['「来月、京都に行くつもりです」と美咲は言いました。', '“I intend to go to Kyoto next month,” Misaki said.'],
  ['私たちは窓のそばの席に座りました。', 'We sat down by the window.'],
  ['私は図書館で借りた本を読みました。', 'I read a book I had borrowed from the library.'],
  ['その本には、小さな喫茶店の写真がありました。', 'The book had a photograph of a small café.'],
  ['写真を見ているうちに、コーヒーが飲みたくなりました。', 'While looking at the photograph, I began to want some coffee.'],
  ['外を見ると、雨はもうやんでいました。', 'When I looked outside, the rain had already stopped.'],
  ['美咲と駅の前の喫茶店に入りました。', 'Misaki and I went into a café in front of the station.'],
  ['「次の土曜日も、ここで会うつもりですか」と私は聞きました。', '“Do you intend to meet here next Saturday too?” I asked.'],
];
const stamp = { createdAt: now, updatedAt: now };
const sentences = lines.map(([japanese, translation], i) => ({
  id: `${bookId}-s${i}`, normalizedKey: japanese, japanese, translation,
  readingOnly: '', inlineReading: '', targetVocabulary: [], vocabularySuggestions: [],
  sourceReferences: [], conflicts: [], firstOccurrenceIndex: i, importBatchIds: [], ...stamp,
}));
const fsrs = (date: string) => ({ due: date, stability: 10, difficulty: 3,
  elapsedDays: 0, scheduledDays: 10, learningSteps: 0, reps: 3, lapses: 0, state: 'review' });
const study = (subjectType: string, subjectId: string, activityType: string, date: string) => ({
  id: `${subjectId}-${activityType}`, subjectType, subjectId, activityType,
  fsrsState: fsrs(date), ...stamp,
});
const words = [
  { expression: '本', reading: 'ほん', meaning: 'book', sentence: 6, activity: 'cloze' },
  { expression: '図書館', reading: 'としょかん', meaning: 'library', sentence: 1, activity: 'reading_retrieval' },
  { expression: '喫茶店', reading: 'きっさてん', meaning: 'café; coffee shop', sentence: 10, activity: 'reading_retrieval' },
];
const vocabularyItems = words.map((w, i) => ({ id: `${bookId}-v${i}`,
  expression: w.expression, reading: w.reading, meaning: w.meaning, ...stamp }));
const patternId = `${bookId}-intention`;
const data = {
  books: [{ id: bookId, title: 'Sample · A rainy Saturday', archived: false,
    chapters: [{ id: chapterId, title: '図書館から喫茶店へ', position: 0 }],
    collapsedChapterIds: [], ...stamp }],
  sentences,
  bookSentences: sentences.map((s, i) => ({ id: `${bookId}-bs${i}`, bookId,
    sentenceId: s.id, chapterId, position: i, status: 'unstarted', addedAt: now })),
  analyses: sentences.map(s => ({ sentenceId: s.id, chunks: [], notes: '', status: 'empty',
    formatVersion: 2, vocabularyReviewStatus: 'confirmed', vocabularySelections: [], ...stamp })),
  vocabularyItems,
  sentenceVocabulary: words.map((w, i) => ({ id: `${bookId}-sv${i}`,
    sentenceId: sentences[w.sentence].id, vocabularyItemId: vocabularyItems[i].id,
    surfaceForm: w.expression, ...stamp })),
  grammarPatterns: [{ id: patternId, canonicalName: '〜つもりだ', normalizedKey: 'つもりだ',
    aliases: [], shortMeaning: 'intend to; plan to', provenance: 'manual',
    explanation: 'A plain nonpast verb followed by つもり expresses the speaker’s intention. 行くつもりです means “I intend to go.” The polite ending here is です.',
    structuralTemplate: 'Verb (plain nonpast) + つもりだ / つもりです', ...stamp }],
  sentenceGrammar: [4, 11].map(i => ({ id: `${bookId}-sg${i}`, sentenceId: sentences[i].id,
    grammarPatternId: patternId, surfaceForm: 'つもりです', confirmedByLearner: true,
    source: 'manual', ...stamp })),
  studyItems: [
    ...sentences.map(s => study('sentence', s.id, 'reading_in_context', future)),
    ...words.flatMap((w, i) => ['reading_retrieval', 'cloze', 'reading_production'].map(a =>
      study('vocabularyItem', vocabularyItems[i].id, a, a === w.activity ? due : future))),
    study('grammarPattern', patternId, 'grammar_recognition', due),
    study('grammarPattern', patternId, 'grammar_completion', future),
  ],
  importBatches: [], inbox: [], reviews: [], kanji: [], vocabularyKanji: [],
  grammarRelationships: [], plannerSessions: [],
};
const payload = backupSchema.parse({ formatVersion: BACKUP_FORMAT_VERSION,
  appVersion: APP_VERSION, exportedAt: now,
  counts: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.length])),
  ...data, settings: { id: 'settings', theme: 'system', hideSatoriEnglishInitially: true,
    showReadingsInitially: false, defaultImportDestination: 'new_book', textDisplayMode: 'plain' },
});
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(payload, null, 2));
writeFileSync(`${dirname(output)}/review-demo.html`, `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Try the review layouts</title>
<style>body{font:18px/1.6 system-ui;max-width:650px;margin:40px auto;padding:0 20px;background:#121411;color:#eee}a{color:#90d9ba}li{margin:16px 0}</style>
<h1>Try the review layouts</h1>
<p>A fictional 12-sentence chapter, with three vocabulary reviews and one grammar review ready to try. Text only, with no generated audio.</p>
<ol><li><a href="review-demo.json" download="review-demo.json">Download the sample chapter</a>.</li>
<li>Open <a href="${appBase}#/settings">Settings</a>, choose <strong>Import backup JSON</strong>, select the downloaded file, then choose <strong>Merge into existing data</strong>.</li>
<li>Open <a href="${appBase}#/review">Review</a>. Use <strong>Review layout</strong> to switch between Original · sentence and New · chapter.</li></ol>
<p>The sample is for this preview. Keep cloud sync disconnected if you want trial progress to remain separate from your normal study history.</p>
</html>`);
console.log(`Created validated sample backup: ${output}`);
