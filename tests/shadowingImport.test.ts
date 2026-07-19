import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  commitShadowingPackageImport,
  getDb,
  saveAnalysis,
  setBookSentenceStatus,
} from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { parseShadowingPackage } from '../src/lib/shadowingImport';

const SOURCE_ID = 'source-video-1';
const FIRST_SENTENCE_ID = 'source-sentence-1';
const SECOND_SENTENCE_ID = 'source-sentence-2';

interface PackageOptions {
  format?: string;
  includeAudio?: boolean;
  firstEnglish?: string;
}

function shadowingPackageFile(options: PackageOptions = {}): File {
  const sentences = [
    {
      id: FIRST_SENTENCE_ID,
      japanese: '暖かい春がやって来ました。',
      reading: 'あたたかいはるがやってきました。',
      english: options.firstEnglish ?? 'Warm spring has arrived.',
      startMs: 1_250,
      endMs: 3_500,
      tags: ['spring'],
      transcriptStatus: 'manually-corrected',
      audio: {
        path: 'audio/sentence-001.m4a',
        mimeType: 'audio/mp4',
        durationMs: 2_250,
      },
    },
    {
      id: SECOND_SENTENCE_ID,
      japanese: '桜も咲いています。',
      english: 'The cherry blossoms are blooming too.',
      startMs: 3_500,
      endMs: 5_100,
      tags: [],
      transcriptStatus: 'verified',
      audio: {
        path: 'audio/sentence-002.m4a',
        mimeType: 'audio/mp4',
        durationMs: 1_600,
      },
    },
  ];
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(
      JSON.stringify({
        format: options.format ?? 'japanese-shadowing-package',
        version: 1,
        createdAt: '2026-07-19T12:00:00Z',
        generator: { name: 'shadowmine', version: '0.1.0' },
      }),
    ),
    'source.json': strToU8(
      JSON.stringify({
        id: SOURCE_ID,
        type: 'youtube',
        url: 'https://www.youtube.com/watch?v=example',
        videoId: 'example',
        title: 'Spring Video',
        channel: 'Japanese Channel',
        durationMs: 10_000,
      }),
    ),
    'sentences.json': strToU8(JSON.stringify(sentences)),
  };
  if (options.includeAudio !== false) {
    files['audio/sentence-001.m4a'] = new Uint8Array([1, 2, 3, 4]);
    files['audio/sentence-002.m4a'] = new Uint8Array([5, 6, 7]);
  }
  return new File([zipSync(files)], 'spring.shadowing.zip', {
    type: 'application/zip',
  });
}

describe('shadowing project import', () => {
  beforeEach(() => {
    resetDbForTests(`shadowing-${createId('db')}`);
  });

  it('validates the package and preserves source sentence order and audio', async () => {
    const preview = await parseShadowingPackage(shadowingPackageFile());

    expect(preview.source.title).toBe('Spring Video');
    expect(preview.source.channel).toBe('Japanese Channel');
    expect(preview.counts.totalRows).toBe(2);
    expect(preview.counts.uniqueSentences).toBe(2);
    expect(preview.drafts.map((item) => item.draft.japanese)).toEqual([
      '暖かい春がやって来ました。',
      '桜も咲いています。',
    ]);
    expect(preview.drafts[0]?.draft.readingOnly).toBe(
      'あたたかいはるがやってきました。',
    );
    expect(preview.drafts[0]?.draft.translation).toBe(
      'Warm spring has arrived.',
    );
    expect(preview.audioDrafts).toHaveLength(2);
    expect(preview.audioBytes).toBe(7);
    expect(preview.audioDrafts[0]?.startMs).toBe(1_250);
  });

  it('rejects unsupported packages and missing referenced audio', async () => {
    await expect(
      parseShadowingPackage(
        shadowingPackageFile({ format: 'some-other-package' }),
      ),
    ).rejects.toThrow(/Unsupported shadowing package manifest/);
    await expect(
      parseShadowingPackage(
        shadowingPackageFile({ includeAudio: false }),
      ),
    ).rejects.toThrow(/missing audio\/sentence-001\.m4a/);
  });

  it('creates a source-linked book and stores native clips', async () => {
    const preview = await parseShadowingPackage(shadowingPackageFile());
    const result = await commitShadowingPackageImport(preview);
    const db = getDb();
    const book = await db.books.get(result.bookId);
    const memberships = await db.bookSentences
      .where('bookId')
      .equals(result.bookId)
      .sortBy('position');
    const sentences = await db.sentences.bulkGet(
      memberships.map((item) => item.sentenceId),
    );
    const audio = await db.sentenceAudio.toArray();

    expect(result.refreshed).toBe(false);
    expect(book).toMatchObject({
      title: 'Spring Video',
      subtitle: 'Japanese Channel',
      sourceKey: `shadowing:${SOURCE_ID}`,
      sourceUrl: 'https://www.youtube.com/watch?v=example',
    });
    expect(sentences.map((sentence) => sentence?.japanese)).toEqual([
      '暖かい春がやって来ました。',
      '桜も咲いています。',
    ]);
    expect(audio).toHaveLength(2);
    // fake-indexeddb/jsdom does not structured-clone Blob internals, but the
    // record and MIME metadata still prove the audio association was stored.
    expect(audio[0]?.mimeType).toBe('audio/mp4');
    expect(audio[0]?.blob).toBeTruthy();
    expect(audio.map((item) => item.sourceSentenceId).sort()).toEqual([
      FIRST_SENTENCE_ID,
      SECOND_SENTENCE_ID,
    ]);
  });

  it('refreshes the same project idempotently and preserves study work', async () => {
    const firstPreview = await parseShadowingPackage(shadowingPackageFile());
    const first = await commitShadowingPackageImport(firstPreview);
    const db = getDb();
    const membership = (
      await db.bookSentences.where('bookId').equals(first.bookId).sortBy('position')
    )[0]!;
    await setBookSentenceStatus(
      first.bookId,
      membership.sentenceId,
      'needs_review',
    );
    await saveAnalysis(
      membership.sentenceId,
      [
        {
          id: 'chunk-1',
          order: 0,
          japanese: '暖かい春がやって来ました。',
          role: 'engine',
          literalEnglish: 'warm spring arrived',
        },
      ],
      'Keep this analysis',
    );

    const existing = await db.sentences.toArray();
    const secondPreview = await parseShadowingPackage(
      shadowingPackageFile({ firstEnglish: 'Springtime has come.' }),
      existing,
    );
    const second = await commitShadowingPackageImport(secondPreview);

    expect(second.refreshed).toBe(true);
    expect(second.bookId).toBe(first.bookId);
    expect(await db.books.count()).toBe(1);
    expect(await db.sentences.count()).toBe(2);
    expect(await db.sentenceAudio.count()).toBe(2);
    expect(
      (await db.bookSentences.get(membership.id))?.status,
    ).toBe('needs_review');
    expect((await db.analyses.get(membership.sentenceId))?.notes).toBe(
      'Keep this analysis',
    );
  });
});
