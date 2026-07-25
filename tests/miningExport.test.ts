import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

import type {
  Book,
  Sentence,
  SentenceAnalysis,
  SentenceAudio,
} from '../src/domain/types';
import { buildMiningPackage } from '../src/lib/miningExport';

function book(): Book {
  return {
    id: 'book1',
    title: 'Fixture Video',
    sourceKey: 'shadowing:source-1',
    sourceUrl: 'https://example.com',
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    chapters: [],
    collapsedChapterIds: [],
  };
}

function sentence(): Sentence {
  return {
    id: 'sent1',
    normalizedKey: '世話をしました',
    japanese: '世話をしました。',
    readingOnly: '',
    inlineReading: '',
    translation: 'They took care.',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('miningExport', () => {
  it('exports only confirmed selections with audio', async () => {
    const analysis: SentenceAnalysis = {
      sentenceId: 'sent1',
      chunks: [],
      notes: '',
      status: 'empty',
      formatVersion: 2,
      vocabularyReviewStatus: 'confirmed',
      vocabularySelections: [
        {
          id: 'v1',
          surface: 'し',
          start: 3,
          end: 4,
          expression: 'する',
          reading: 'する',
          source: 'suggestion',
        },
      ],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const audio: SentenceAudio = {
      id: 'a1',
      sentenceId: 'sent1',
      sourceId: 'source-1',
      sourceSentenceId: 'sentence-001',
      sourceTitle: 'Fixture Video',
      mimeType: 'audio/mp4',
      durationMs: 1000,
      startMs: 100,
      endMs: 1100,
      blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mp4' }),
      importedAt: '2026-01-01T00:00:00Z',
    };

    const result = await buildMiningPackage({
      book: book(),
      sentences: [sentence()],
      analyses: [analysis],
      audio: [audio],
    });
    expect(result.sentenceCount).toBe(1);
    expect(result.selectionCount).toBe(1);

    const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
    const sentences = JSON.parse(strFromU8(files['sentences.json']!));
    expect(sentences[0].selectedVocabulary[0].expression).toBe('する');
    expect(sentences[0].selectedVocabulary[0].surface).toBe('し');
    expect(files[sentences[0].audio.path]).toBeTruthy();
  });

  it('rejects unconfirmed books', async () => {
    await expect(
      buildMiningPackage({
        book: book(),
        sentences: [sentence()],
        analyses: [
          {
            sentenceId: 'sent1',
            chunks: [],
            notes: '',
            status: 'empty',
            formatVersion: 2,
            vocabularyReviewStatus: 'unreviewed',
            vocabularySelections: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        audio: [],
      }),
    ).rejects.toThrow(/No confirmed vocabulary/);
  });
});
