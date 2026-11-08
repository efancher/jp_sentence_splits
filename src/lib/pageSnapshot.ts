import { matchPath } from 'react-router-dom';

import { APP_VERSION } from '../appConfig';
import { getDb } from '../db/database';
import { summarizeSentenceAudio } from './cardReportDiagnostics';
import { getRecentErrors } from './recentErrors';
import { collectReportContext } from './reportContext';

const MAX_PAGE_TEXT = 4000;

const SENTENCE_ROUTES = [
  '/books/:bookId/analyze/:sentenceId',
  '/books/:bookId/vocabulary/:sentenceId',
  '/books/:bookId/practice/:sentenceId',
  '/books/:bookId/learn/:sentenceId',
  '/books/:bookId/check/:sentenceId',
  '/books/:bookId/grammar-check/:sentenceId',
  '/books/:bookId/recall/:sentenceId',
  '/books/:bookId/speak/:sentenceId',
  '/books/:bookId/tiles/:sentenceId',
  '/books/:bookId/dictate/:sentenceId',
  '/books/:bookId/shadow/:sentenceId',
  '/sentences/:sentenceId/deep-dive',
];

export async function buildPageSnapshot(pathname: string, search: string, selection: string): Promise<string> {
  let sentence: { id: string; japanese: string; translation: string } | undefined;
  let sentenceAudio: unknown;
  for (const pattern of SENTENCE_ROUTES) {
    const sentenceId = matchPath(pattern, pathname)?.params.sentenceId;
    if (!sentenceId) continue;
    const row = await getDb().sentences.get(sentenceId);
    if (row) sentence = { id: row.id, japanese: row.japanese, translation: row.translation };
    if (row) sentenceAudio = await summarizeSentenceAudio(row.id);
    break;
  }
  const main = document.querySelector('main');
  const pageText = (main?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim();
  return JSON.stringify(
    {
      kind: 'page_report',
      appVersion: APP_VERSION,
      buildId: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'unknown',
      route: pathname + search,
      title: main?.querySelector('h1, h2')?.textContent?.trim() ?? null,
      sentence,
      sentenceAudio,
      selectedText: selection || undefined,
      pageText: pageText.length > MAX_PAGE_TEXT ? `${pageText.slice(0, MAX_PAGE_TEXT)}…` : pageText,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      userAgent: navigator.userAgent,
      recentErrors: getRecentErrors(),
      context: collectReportContext(),
      capturedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}
