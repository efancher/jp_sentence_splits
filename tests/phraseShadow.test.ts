import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  confirmSentenceVocabulary,
  createBook,
  getDb,
  getSessionPlannerInput,
  logPhraseShadow,
  setBookSentenceStatus,
  updateSettings,
} from '../src/db/repository';
import type { Sentence } from '../src/domain/types';
import { ALIGNMENT_VERSION } from '../src/lib/analysisApi';
import { createId } from '../src/lib/ids';
import {
  isPhraseRange,
  phraseShadowTargetKey,
  phraseShadowWordIds,
  phraseShadowsBySentence,
  phraseTextFromAlignment,
  dropLeadingParticles,
  snapRangeToWordBoundaries,
  wordIdsInPhrase,
} from '../src/lib/phraseShadow';
import { buildWordEvidence } from '../src/lib/wordEvidence';
import { remoteToSentenceLearningEvent, sentenceLearningEventToRemote } from '../src/sync/mappers';

const words = [
  { text: '猫', start: 0, end: 0.4 },
  { text: 'が', start: 0.4, end: 0.5 },
  { text: '寝て', start: 0.5, end: 1.0 },
  { text: 'います', start: 1.0, end: 1.6 },
];

describe('phrase shadow helpers', () => {
  it('accepts a real sub-span and rejects slivers and the whole clip', () => {
    expect(isPhraseRange({ startMs: 500, endMs: 1600 }, 2000)).toBe(true);
    expect(isPhraseRange({ startMs: 500, endMs: 650 }, 2000)).toBe(false);
    expect(isPhraseRange({ startMs: 0, endMs: 1900 }, 2000)).toBe(false);
    expect(isPhraseRange(null, 2000)).toBe(false);
  });

  it('takes the aligned words that sit mostly inside the span', () => {
    expect(phraseTextFromAlignment(words, { startMs: 450, endMs: 1650 })).toBe('寝ています');
    // A word clipped to less than half its length is left out.
    expect(phraseTextFromAlignment(words, { startMs: 800, endMs: 1650 })).toBe('います');
  });

  it('leaves aligner silence tokens out of the text', () => {
    const withSilence = [
      { text: 'サイト', start: 0, end: 0.6 },
      { text: 'に', start: 0.6, end: 0.7 },
      { text: '<eps>', start: 0.7, end: 1.5 },
    ];
    expect(phraseTextFromAlignment(withSilence, { startMs: 0, endMs: 1500 })).toBe('サイトに');
  });

  it('marks a word the aligner could not place instead of dropping it silently', () => {
    const withUnknown = [
      { text: '今回', start: 0.32, end: 1.3 },
      { text: '<eps>', start: 1.3, end: 1.89 },
      { text: '<unk>', start: 1.89, end: 2.89 },
      { text: 'の', start: 3.25, end: 4.42 },
    ];
    expect(phraseTextFromAlignment(withUnknown, { startMs: 320, endMs: 4420 })).toBe('今回…の');
  });

  it('fills a word the aligner could not place from the sentence text', () => {
    const japanese = '今回、30回目のエピソードは、日本の春の行事について話します。';
    const aligned = [
      { text: '<eps>', start: 0, end: 0.32 },
      { text: '今回', start: 0.32, end: 1.3 },
      { text: '<eps>', start: 1.3, end: 1.89 },
      { text: '<unk>', start: 1.89, end: 2.89 },
      { text: '<eps>', start: 2.89, end: 3.25 },
      { text: 'の', start: 3.25, end: 4.42 },
      { text: 'エピソード', start: 4.83, end: 6.31 },
    ];
    expect(phraseTextFromAlignment(aligned, { startMs: 320, endMs: 4420 }, japanese)).toBe('今回、30回目の');
    // Without the sentence there is nothing to fill from, so the gap is marked.
    expect(phraseTextFromAlignment(aligned, { startMs: 320, endMs: 4420 })).toBe('今回…の');
    // A neighbour that is not in the sentence leaves the gap marked rather than guessing.
    expect(phraseTextFromAlignment(aligned, { startMs: 320, endMs: 4420 }, '全然ちがう文です')).toBe('今回…の');
  });

  it('finds the vocabulary whose surface sits inside the phrase', () => {
    const links = [
      { vocabularyItemId: 'v-cat', surfaceForm: '猫' },
      { vocabularyItemId: 'v-sleep', surfaceForm: '寝て' },
      { vocabularyItemId: 'v-none' },
    ];
    expect(wordIdsInPhrase('寝ています', links)).toEqual(['v-sleep']);
    expect(wordIdsInPhrase('', links)).toEqual([]);
    expect(phraseShadowWordIds(phraseShadowTargetKey(['a', 'b']))).toEqual(['a', 'b']);
    expect(phraseShadowWordIds('vocab:a')).toEqual([]);
  });

  it('groups phrase passes per sentence in order and ignores other events', () => {
    const grouped = phraseShadowsBySentence([
      { action: 'phrase_shadow', sentenceId: 's', timestamp: '2026-11-03T10:00:00Z', outcome: 'got_it', rangeStartMs: 1, rangeEndMs: 2 },
      { action: 'phrase_shadow', sentenceId: 's', timestamp: '2026-11-03T09:00:00Z', outcome: 'needed_help', rangeStartMs: 1, rangeEndMs: 2 },
      { action: 'gist_check', sentenceId: 's', timestamp: '2026-11-03T08:00:00Z', outcome: 'got_it' },
    ]);
    expect(grouped.get('s')?.map((p) => p.outcome)).toEqual(['needed_help', 'got_it']);
  });
});

describe('phrase shadow evidence and sync', () => {
  const ts = '2026-11-03T10:00:00.000Z';
  const at = Date.parse(ts);
  const event = (outcome: 'got_it' | 'close' | 'needed_help') => ({
    action: 'phrase_shadow' as const,
    sentenceId: 's1',
    timestamp: ts,
    outcome,
    target: { kind: 'expression' as const, key: phraseShadowTargetKey(['w1', 'w2']), label: '寝ています' },
  });

  it('credits only the words in the phrase, and stays neutral on Close', () => {
    const base = { studyItems: [], reviews: [], wordsBySentence: new Map([['s1', ['w1', 'w2', 'w3']]]) };
    const got = buildWordEvidence({ ...base, learningEvents: [event('got_it')] });
    expect(got.get('w1')).toEqual([{ wordId: 'w1', facet: 'reading', kind: 'recognition', at, success: true }]);
    expect(got.has('w3')).toBe(false);
    const miss = buildWordEvidence({ ...base, learningEvents: [event('needed_help')] });
    expect(miss.get('w2')?.[0]).toMatchObject({ success: false });
    expect(buildWordEvidence({ ...base, learningEvents: [event('close')] }).size).toBe(0);
  });

  it('round-trips the span and the Close outcome through the remote mapper', () => {
    const full = {
      id: 'e1', timestamp: ts, visitId: 'v', action: 'phrase_shadow' as const, bookId: 'b', sentenceId: 's',
      target: { kind: 'expression' as const, key: phraseShadowTargetKey(['w1']), label: '寝ています' },
      outcome: 'close' as const, assessmentSource: 'self' as const, rangeStartMs: 500, rangeEndMs: 1600,
    };
    const remote = sentenceLearningEventToRemote(full, 'owner', 1);
    expect(remote).toMatchObject({ range_start_ms: 500, range_end_ms: 1600, outcome: 'close' });
    expect(remoteToSentenceLearningEvent(remote)).toEqual(full);
  });
});

function makeSentence(japanese: string): Sentence {
  const timestamp = new Date().toISOString();
  const id = createId('sent');
  return {
    id, normalizedKey: id, japanese, readingOnly: '', inlineReading: '', translation: 'x', targetVocabulary: [],
    vocabularySuggestions: [], sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0, importBatchIds: [],
    createdAt: timestamp, updatedAt: timestamp,
  };
}

describe('logPhraseShadow and the shadowing pause', () => {
  beforeEach(() => {
    resetDbForTests(`phrase-shadow-${createId('db')}`);
  });

  async function shadowReadySentence(book: { id: string }, japanese: string) {
    const db = getDb();
    const sentence = makeSentence(japanese);
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    await setBookSentenceStatus(book.id, sentence.id, 'in_progress');
    await confirmSentenceVocabulary(sentence.id, []);
    const audioId = `audio-${sentence.id}`;
    await db.sentenceAudio.add({
      id: audioId, sentenceId: sentence.id, sourceId: 'source-1', sourceSentenceId: `src-${sentence.id}`,
      sourceTitle: 'Test Source', mimeType: 'audio/mp3', durationMs: 2000, startMs: 0, endMs: 2000,
      blob: new Blob(['fake audio bytes'], { type: 'audio/mp3' }), importedAt: new Date().toISOString(),
    });
    return { sentence, audioId };
  }

  it('logs a self-rated event with the span, text and credited words, and no Review', async () => {
    const book = await createBook({ title: 'Phrases' });
    const { sentence, audioId } = await shadowReadySentence(book, '猫が寝ています。');
    const db = getDb();
    await db.referenceAlignments.put({
      id: audioId, alignmentVersion: 1, computedAt: new Date().toISOString(),
      result: { durationSeconds: 2, words: words.map((w) => ({ ...w, phones: [] })) },
    });
    await db.sentenceVocabulary.put({
      id: 'sv1', sentenceId: sentence.id, vocabularyItemId: 'v-sleep', surfaceForm: '寝て',
    } as never);

    const logged = await logPhraseShadow({
      bookId: book.id, sentenceId: sentence.id, sentenceAudioId: audioId, clipDurationMs: 2000,
      range: { startMs: 450, endMs: 1650 }, outcome: 'close',
    });
    expect(logged).toMatchObject({
      action: 'phrase_shadow', outcome: 'close', assessmentSource: 'self', rangeStartMs: 450, rangeEndMs: 1650,
      target: { label: '寝ています', key: phraseShadowTargetKey(['v-sleep']) },
    });
    expect(await db.sentenceLearningEvents.count()).toBe(1);
    expect(await db.reviews.count()).toBe(0);
  });

  it('still logs without a cached alignment, and refuses a whole-clip span', async () => {
    const book = await createBook({ title: 'Phrases' });
    const { sentence, audioId } = await shadowReadySentence(book, '猫が寝ています。');
    const input = { bookId: book.id, sentenceId: sentence.id, sentenceAudioId: audioId, clipDurationMs: 2000, outcome: 'got_it' as const };
    const noText = await logPhraseShadow({ ...input, range: { startMs: 500, endMs: 1200 } });
    expect(noText?.target).toEqual({ kind: 'expression', key: phraseShadowTargetKey([]), label: '' });
    expect(await logPhraseShadow({ ...input, range: { startMs: 0, endMs: 2000 } })).toBeNull();
  });

  it('does not count as a whole-sentence shadowing attempt', async () => {
    const book = await createBook({ title: 'Phrases' });
    const { sentence, audioId } = await shadowReadySentence(book, '猫が寝ています。');
    await logPhraseShadow({
      bookId: book.id, sentenceId: sentence.id, sentenceAudioId: audioId, clipDurationMs: 2000,
      range: { startMs: 500, endMs: 1200 }, outcome: 'got_it',
    });
    expect(await getDb().attempts.count()).toBe(0);
  });

  it('pausing sentence shadowing turns the planner shadow candidates into phrase shadows', async () => {
    await updateSettings({ sentenceLedFlow: false });
    const book = await createBook({ title: 'Pause' });
    const { sentence } = await shadowReadySentence(book, '今日は雨です。');
    const before = await getSessionPlannerInput(60);
    expect(before.shadowCandidates.map((c) => c.sentenceId)).toContain(sentence.id);
    expect(before.shadowCandidates.some((c) => c.phrase)).toBe(false);

    await updateSettings({ sentenceShadowingPaused: true });
    const during = await getSessionPlannerInput(60);
    expect(during.shadowCandidates.map((c) => c.sentenceId)).toContain(sentence.id);
    expect(during.shadowCandidates.every((c) => c.phrase === true)).toBe(true);

    await updateSettings({ sentenceShadowingPaused: false });
    const after = await getSessionPlannerInput(60);
    expect(after.shadowCandidates.map((c) => c.sentenceId)).toContain(sentence.id);
    expect(after.shadowCandidates.some((c) => c.phrase)).toBe(false);
  });

  it('a phrase step names its suggested phrase once the clip is aligned, and falls back to the sentence before that', async () => {
    // Default sentence-led flow: a completed walkthrough is what makes a sentence ready to shadow.
    await updateSettings({ sentenceShadowingPaused: true });
    const book = await createBook({ title: 'Named' });
    const { sentence, audioId } = await shadowReadySentence(book, '猫が寝ています。');
    const db = getDb();
    const stamp = new Date().toISOString();
    await db.sentenceLearningEvents.put({
      id: createId('sle'), visitId: 'v', action: 'walkthrough_completed', bookId: book.id, sentenceId: sentence.id, timestamp: stamp,
    });
    await db.vocabularyItems.put({ id: 'v-sleep', expression: '寝る', reading: 'ねる', createdAt: stamp, updatedAt: stamp } as never);
    await db.sentenceVocabulary.put({ id: 'sv-sleep', sentenceId: sentence.id, vocabularyItemId: 'v-sleep', surfaceForm: '寝て' } as never);

    const unaligned = await getSessionPlannerInput(60);
    expect(unaligned.shadowCandidates.find((c) => c.sentenceId === sentence.id)?.phraseText).toBeUndefined();

    await db.referenceAlignments.put({
      id: audioId, alignmentVersion: ALIGNMENT_VERSION, computedAt: stamp,
      result: { durationSeconds: 2, words: words.map((w) => ({ ...w, phones: [] })) },
    });
    const aligned = await getSessionPlannerInput(60);
    expect(aligned.shadowCandidates.find((c) => c.sentenceId === sentence.id)?.phraseText).toContain('寝て');
  });
});

describe('snapRangeToWordBoundaries', () => {
  const sentence = '日本で食べログという';
  const tokens = [
    { text: '日本', start: 0, end: 0.4 },
    { text: 'で', start: 0.4, end: 0.5 },
    { text: '食べ', start: 0.5, end: 0.9 },
    { text: 'ログ', start: 0.9, end: 1.3 },
    { text: 'という', start: 1.3, end: 1.8 },
  ];
  const spans = [
    { start: 0, end: 2 },
    { start: 2, end: 3 },
    { start: 3, end: 7 },
    { start: 7, end: 10 },
  ];

  it('widens an end that lands inside a word to the word end', () => {
    expect(snapRangeToWordBoundaries(tokens, sentence, spans, { startMs: 0, endMs: 900 })).toEqual({ startMs: 0, endMs: 1300 });
  });

  it('widens a start that lands inside a word to the word start', () => {
    expect(snapRangeToWordBoundaries(tokens, sentence, spans, { startMs: 900, endMs: 1800 })).toEqual({ startMs: 500, endMs: 1800 });
  });

  it('leaves a range on word edges alone', () => {
    expect(snapRangeToWordBoundaries(tokens, sentence, spans, { startMs: 0, endMs: 500 })).toEqual({ startMs: 0, endMs: 500 });
  });
});

describe('dropLeadingParticles', () => {
  // エピソード1で、私は…: the aligner gives the numeral an <unk> token, leaving で orphaned.
  const tokens = [
    { text: 'エピソード', start: 0.45, end: 1.8 },
    { text: '<eps>', start: 1.8, end: 1.97 },
    { text: '<unk>', start: 1.97, end: 2.48 },
    { text: 'で', start: 2.48, end: 2.84 },
    { text: '<eps>', start: 2.84, end: 3.58 },
    { text: '私', start: 3.58, end: 4.33 },
    { text: 'は', start: 4.33, end: 4.68 },
  ];

  it('starts after a particle whose host is outside the span', () => {
    expect(dropLeadingParticles(tokens, { startMs: 2480, endMs: 4680 })).toEqual({ startMs: 3580, endMs: 4680 });
  });

  it('keeps a phrase that opens on a content word', () => {
    expect(dropLeadingParticles(tokens, { startMs: 3580, endMs: 4680 })).toEqual({ startMs: 3580, endMs: 4680 });
  });

  it('keeps a particle when nothing usable would remain', () => {
    expect(dropLeadingParticles(tokens, { startMs: 2480, endMs: 3700 })).toEqual({ startMs: 2480, endMs: 3700 });
  });
});
