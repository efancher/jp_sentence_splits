import { beforeEach, describe, expect, it } from 'vitest';

import { orderBookSentencesFromPaste } from '../src/lib/pasteOrder';
import {
  createBook,
  getDb,
  previewBookOrderFromPaste,
  reorderBookFromPaste,
} from '../src/db/repository';
import { resetDbForTests } from '../src/db/database';
import { createId } from '../src/lib/ids';
import { normalizeSentenceKey } from '../src/lib/normalize';

const TITLE = '春、第二話';
const S1 = 'ある日、１羽のひなが巣の端に立ちました。';
const S2 = 'そして、羽を大きく広げると、思い切って巣から飛び出しました。';
const S3 = 'ひなは必死に羽ばたいて、なんとか飛ぶことができました。';
const EXTRA = 'この文は貼り付けにありません。';

const ARTICLE = `${TITLE}
${S1}${S2}${S3}
他の２羽のひなたちは、巣からその様子を見ていました。`;

describe('orderBookSentencesFromPaste', () => {
  it('orders matched sentences by first appearance and appends unmatched', () => {
    const sentences = [
      { id: 'extra', japanese: EXTRA },
      { id: 's3', japanese: S3 },
      { id: 's1', japanese: S1 },
      { id: 'title', japanese: TITLE },
      { id: 's2', japanese: S2 },
    ];

    const result = orderBookSentencesFromPaste(ARTICLE, sentences);
    expect(result.matchedIds).toEqual(['title', 's1', 's2', 's3']);
    expect(result.unmatchedIds).toEqual(['extra']);
    expect(result.orderedIds).toEqual(['title', 's1', 's2', 's3', 'extra']);
  });

  it('matches full-width and ASCII digits via NFKC paste normalization', () => {
    const paste =
      'ある日、１羽のひなが巣の端に立ちました。他の２羽のひなたちは、巣からその様子を見ていました。';
    const result = orderBookSentencesFromPaste(paste, [
      {
        id: 'later',
        japanese: '他の2羽のひなたちは、巣からその様子を見ていました。',
      },
      {
        id: 'earlier',
        japanese: 'ある日、1羽のひなが巣の端に立ちました。',
      },
    ]);
    expect(result.matchedIds).toEqual(['earlier', 'later']);
    expect(result.unmatchedIds).toEqual([]);
  });

  it('orders episode-two sentences after episode-one when both are in the paste', () => {
    const episodeOne =
      '暖かい春がやって来ました。ある小鳥の夫婦が、木に巣を作りました。';
    const dayOne = 'ある日、１羽のひなが巣の端に立ちました。';
    const others = '他の２羽のひなたちは、巣からその様子を見ていました。';
    const paste = `春、第一話
${episodeOne}
春、第二話
${dayOne}${others}`;
    const result = orderBookSentencesFromPaste(paste, [
      { id: 'others', japanese: others },
      { id: 'day', japanese: 'ある日、1羽のひなが巣の端に立ちました。' },
      { id: 'spring', japanese: '暖かい春がやって来ました。' },
    ]);
    expect(result.orderedIds).toEqual(['spring', 'day', 'others']);
  });

  it('matches an episode-final sentence whose closing 。 is missing from the paste', () => {
    const s1 = 'ひなたちは、毎日少しずつ大きくなりました。';
    const s2 =
      'しばらくすると、お母さんとお父さんの真似をして、羽をバタバタさせ始めました。';
    // Satori drops the closing 。 on the last sentence before an episode header.
    const paste = `${s1}${s2.replace(/。$/, '')}\n春、第四話\nある日、１羽のひなが巣の端に立ちました。`;
    const result = orderBookSentencesFromPaste(paste, [
      { id: 'bata', japanese: s2 },
      { id: 'grew', japanese: s1 },
    ]);
    expect(result.matchedIds).toEqual(['grew', 'bata']);
    expect(result.unmatchedIds).toEqual([]);
  });

  it('treats spacing differences as the same via paste match normalization', () => {
    const result = orderBookSentencesFromPaste(
      `${S1}\n${S2}`,
      [
        { id: 'a', japanese: ` ${S2} ` },
        { id: 'b', japanese: S1 },
      ],
    );
    expect(result.orderedIds).toEqual(['b', 'a']);
  });

  it('keeps only the first membership when normalized keys collide', () => {
    const result = orderBookSentencesFromPaste(S1, [
      { id: 'first', japanese: S1 },
      { id: 'dup', japanese: S1 },
    ]);
    expect(result.matchedIds).toEqual(['first']);
    expect(result.unmatchedIds).toEqual(['dup']);
  });

  it('returns prior order when paste is empty', () => {
    const sentences = [
      { id: 'a', japanese: S1 },
      { id: 'b', japanese: S2 },
    ];
    expect(orderBookSentencesFromPaste('   ', sentences).orderedIds).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('reorderBookFromPaste', () => {
  beforeEach(() => {
    resetDbForTests(`paste-order-${createId('db')}`);
  });

  it('persists paste order for book memberships', async () => {
    const book = await createBook({ title: 'Hina' });
    const db = getDb();
    const rows = [
      { id: 'sent_extra', japanese: EXTRA },
      { id: 'sent_s2', japanese: S2 },
      { id: 'sent_title', japanese: TITLE },
      { id: 'sent_s1', japanese: S1 },
    ];
    const timestamp = new Date().toISOString();
    await db.sentences.bulkPut(
      rows.map((row, index) => ({
        id: row.id,
        japanese: row.japanese,
        readingOnly: '',
        inlineReading: '',
        translation: '',
        normalizedKey: normalizeSentenceKey(row.japanese),
        targetVocabulary: [],
        sourceReferences: [],
        importBatchIds: [],
        conflicts: [],
        firstOccurrenceIndex: index,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    );
    await db.bookSentences.bulkPut(
      rows.map((row, position) => ({
        id: createId('bs'),
        bookId: book.id,
        sentenceId: row.id,
        position,
        status: 'unstarted' as const,
        addedAt: timestamp,
      })),
    );

    const preview = await previewBookOrderFromPaste(book.id, ARTICLE);
    expect(preview.matchedIds[0]).toBe('sent_title');
    expect(preview.matchedJapanese[0]).toBe(TITLE);

    await reorderBookFromPaste(book.id, ARTICLE);
    const memberships = await db.bookSentences
      .where('bookId')
      .equals(book.id)
      .sortBy('position');
    expect(memberships.map((item) => item.sentenceId)).toEqual([
      'sent_title',
      'sent_s1',
      'sent_s2',
      'sent_extra',
    ]);
  });
});
