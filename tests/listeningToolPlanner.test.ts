import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { addMinutesToTodaySession, createBook, getDb, getSessionPlannerInput, updateSettings } from '../src/db/repository';
import type { Sentence, VocabularySuggestion } from '../src/domain/types';
import { createId } from '../src/lib/ids';
import { sessionStepTargetPath } from '../src/lib/sessionPlanner';
import { sessionStepCategory } from '../src/lib/sessionStepCategory';

const NOUN = '名詞/普通名詞/一般';
const KAKU = '助詞/格助詞';
const PIECES: [string, string][] = [['私', '代名詞'], ['は', '助詞/係助詞'], ['猫', NOUN], ['が', KAKU], ['魚', NOUN], ['を', KAKU], ['食べ', '動詞/一般'], ['ました', '助動詞'], ['。', '補助記号/句点']];

function splittableSentence(): Sentence {
  let cursor = 0;
  const suggestions: VocabularySuggestion[] = PIECES.map(([surface, pos], i) => {
    const suggestion: VocabularySuggestion = {
      id: `sg-${i}`, surface, start: cursor, end: cursor + surface.length, expression: surface, reading: surface, pos,
      source: 'morphology', selectedByDefault: pos === NOUN,
    };
    cursor += surface.length;
    return suggestion;
  });
  const now = new Date().toISOString();
  const id = createId('sent');
  return {
    id, normalizedKey: id, japanese: PIECES.map((p) => p[0]).join(''), readingOnly: '', inlineReading: '', translation: 'x',
    targetVocabulary: [], vocabularySuggestions: suggestions, sourceReferences: [], conflicts: [], firstOccurrenceIndex: 0,
    importBatchIds: [], createdAt: now, updatedAt: now,
  };
}

describe('Ear tiles and Dictation steps in the plan', () => {
  beforeEach(() => {
    resetDbForTests(`listening-tool-${createId('db')}`);
  });

  async function setup() {
    await updateSettings({ sentenceFirstPlanning: true });
    const book = await createBook({ title: 'Listening' });
    const db = getDb();
    const now = new Date().toISOString();
    const withAudio = splittableSentence();
    const noAudio = splittableSentence();
    const unintroduced = splittableSentence();
    await db.sentences.bulkPut([withAudio, noAudio, unintroduced]);
    await db.bookSentences.bulkPut([
      { id: createId('bs'), bookId: book.id, sentenceId: withAudio.id, position: 0, status: 'in_progress', addedAt: now },
      { id: createId('bs'), bookId: book.id, sentenceId: noAudio.id, position: 1, status: 'in_progress', addedAt: now },
      { id: createId('bs'), bookId: book.id, sentenceId: unintroduced.id, position: 2, status: 'unstarted', addedAt: now },
    ] as never);
    for (const sentence of [withAudio, unintroduced]) {
      await db.sentenceAudio.add({
        id: createId('audio'), sentenceId: sentence.id, sourceId: 's', sourceSentenceId: 'x', sourceTitle: 'Ref', mimeType: 'audio/mp4',
        durationMs: 1200, startMs: 0, endMs: 1200, blob: new Blob(['a'], { type: 'audio/mp4' }), importedAt: now,
      });
    }
    // Walked through today: introduced, but too fresh for a Fresh try or Read check, so the tool step is the only thing drafted for it.
    for (const sentence of [withAudio, noAudio]) {
      await db.sentenceLearningEvents.put({
        id: createId('sle'), visitId: createId('v'), sentenceId: sentence.id, bookId: book.id, action: 'walkthrough_completed', timestamp: now,
      } as never);
    }
    return { book, withAudio, noAudio, unintroduced };
  }

  it('lists only introduced sentences with native audio that split into phrases, starting with Ear tiles', async () => {
    const { withAudio } = await setup();
    const input = await getSessionPlannerInput(60);
    expect(input.listeningToolCandidates?.map((c) => [c.sentenceId, c.tool])).toEqual([[withAudio.id, 'tiles']]);
    expect(input.listeningToolCandidates![0]!.reason).toContain('not tried by ear yet');
  });

  it('leaves a sentence out for a week after a clean Ear tiles round, then moves it to Dictation', async () => {
    const { withAudio, book } = await setup();
    const day = 24 * 60 * 60 * 1000;
    const log = (daysAgo: number) =>
      getDb().sentenceLearningEvents.put({
        id: createId('sle'), visitId: createId('v'), sentenceId: withAudio.id, bookId: book.id, action: 'target_practice',
        target: { kind: 'expression', key: `eartiles:${withAudio.id}`, label: 'Ear tiles' }, outcome: 'got_it',
        timestamp: new Date(Date.now() - daysAgo * day).toISOString(),
      } as never);
    await log(2);
    expect((await getSessionPlannerInput(60)).listeningToolCandidates).toEqual([]);
    await getDb().sentenceLearningEvents.clear();
    await log(9);
    expect((await getSessionPlannerInput(60)).listeningToolCandidates?.map((c) => c.tool)).toEqual(['dictate']);
  });

  it('drafts review-bucket steps that open the reader tool and count as review, not lessons', async () => {
    const { withAudio } = await setup();
    const session = await addMinutesToTodaySession(60);
    const steps = session.steps.filter((step) => step.readerTool);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ bucket: 'review', targetKind: 'sentence_learning', sentenceId: withAudio.id, estimatedMinutes: 2, readerTool: 'tiles' });
    expect(steps[0]!.label).toMatch(/^Ear tiles:/);
    expect(sessionStepTargetPath(steps[0]!)).toBe(`/books/${steps[0]!.bookId}/tiles/${withAudio.id}`);
    expect(sessionStepCategory(steps[0]!)).toBe('review');
    expect((await getDb().plannerSessions.get(session.id))!.steps.filter((step) => step.readerTool)).toHaveLength(1);
  });
});
