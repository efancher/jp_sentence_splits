import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  ensureGrammarPattern,
  ensureGrammarStudyItem,
  ensureSentenceGrammar,
  getAutoTrackEligibleGrammarCandidates,
  getDb,
  listGrammarPatternSummaries,
  listSentenceGrammarForPattern,
  logSentenceLearningEvent,
  pickContextSentenceForGrammarPattern,
} from '../src/db/repository';
import { SentencePatterns } from '../src/components/SentencePatterns';
import { createId } from '../src/lib/ids';
import { isPatternListed, isUnreviewedAiLink, visibleGrammarLinks } from '../src/lib/grammarLinkVisibility';
import { withAppProviders } from '../src/test/providers';

const link = (sentenceId: string, source: 'manual' | 'ai_suggested', confirmedByLearner: boolean) => ({
  sentenceId,
  source,
  confirmedByLearner,
});

describe('grammar link visibility rule', () => {
  it('treats only unconfirmed assistant links as unreviewed', () => {
    expect(isUnreviewedAiLink(link('a', 'ai_suggested', false))).toBe(true);
    expect(isUnreviewedAiLink(link('a', 'ai_suggested', true))).toBe(false);
    expect(isUnreviewedAiLink(link('a', 'manual', false))).toBe(false);
  });

  it('hides unreviewed assistant links on sentences not yet met, and nothing else', () => {
    const links = [link('met', 'ai_suggested', false), link('new', 'ai_suggested', false), link('new', 'manual', true), link('new', 'ai_suggested', true)];
    expect(visibleGrammarLinks(links, new Set(['met']))).toEqual([links[0], links[2], links[3]]);
  });

  it('lists an assistant-created pattern only once it has a visible link or a card', () => {
    expect(isPatternListed({ provenance: 'ai_suggested' }, 0, false)).toBe(false);
    expect(isPatternListed({ provenance: 'ai_suggested' }, 1, false)).toBe(true);
    expect(isPatternListed({ provenance: 'ai_suggested' }, 0, true)).toBe(true);
    expect(isPatternListed({ provenance: 'manual' }, 0, false)).toBe(true);
  });
});

describe('grammar link visibility in the data layer', () => {
  beforeEach(async () => {
    resetDbForTests(`grammar-link-visibility-${createId('db')}`);
    await ensureSettings();
  });

  const aiLink = (sentenceId: string, patternId: string) =>
    ensureSentenceGrammar(sentenceId, patternId, { source: 'ai_suggested', confirmedByLearner: false, surfaceForm: 'x', start: 0, end: 1 });
  const walk = (sentenceId: string) =>
    logSentenceLearningEvent({ visitId: 'v', action: 'walkthrough_completed', bookId: 'b', sentenceId });
  const addSentence = (id: string) =>
    getDb().sentences.put({
      id,
      normalizedKey: id,
      japanese: `文${id}`,
      readingOnly: '',
      inlineReading: '',
      translation: '',
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: '2026-10-31T00:00:00.000Z',
      updatedAt: '2026-10-31T00:00:00.000Z',
    } as never);

  it('keeps an unreviewed assistant link out of the pattern page until its sentence is walked through', async () => {
    const pattern = await ensureGrammarPattern('～ている', { provenance: 'ai_suggested' });
    await addSentence('s1');
    await aiLink('s1', pattern.id);
    expect(await listSentenceGrammarForPattern(pattern.id)).toEqual([]);
    expect((await listGrammarPatternSummaries()).map((s) => s.pattern.canonicalName)).toEqual([]);
    await walk('s1');
    expect((await listSentenceGrammarForPattern(pattern.id)).map((e) => e.sentence.id)).toEqual(['s1']);
    expect((await listGrammarPatternSummaries()).map((s) => [s.pattern.canonicalName, s.encounterCount])).toEqual([['～ている', 1]]);
  });

  it('hides an assistant-created pattern with only hidden links from the grammar list, and counts only visible links', async () => {
    const hidden = await ensureGrammarPattern('～てくる', { provenance: 'ai_suggested' });
    const mixed = await ensureGrammarPattern('～ている', { provenance: 'ai_suggested' });
    const own = await ensureGrammarPattern('～ましょう');
    await aiLink('s1', hidden.id);
    await aiLink('s1', mixed.id);
    await aiLink('s2', mixed.id);
    await ensureSentenceGrammar('s9', own.id, {});
    await walk('s1');

    const byName = new Map((await listGrammarPatternSummaries()).map((s) => [s.pattern.canonicalName, s.encounterCount]));
    expect(byName.has('～てくる')).toBe(true); // walked s1, so visible
    expect(byName.get('～ている')).toBe(1); // s2 not met yet
    expect(byName.get('～ましょう')).toBe(1);

    const other = await ensureGrammarPattern('～ながら', { provenance: 'ai_suggested' });
    await aiLink('s3', other.id);
    expect((await listGrammarPatternSummaries()).map((s) => s.pattern.canonicalName)).not.toContain('～ながら');
    await ensureGrammarStudyItem(other.id, 'grammar_recognition');
    expect((await listGrammarPatternSummaries()).map((s) => s.pattern.canonicalName)).toContain('～ながら');
  });

  it('never builds a card or starts tracking from an unreviewed assistant link', async () => {
    const pattern = await ensureGrammarPattern('～ている', { provenance: 'ai_suggested' });
    await aiLink('s1', pattern.id);
    await walk('s1');
    expect(await getAutoTrackEligibleGrammarCandidates(new Set())).toEqual([]);
    expect(await pickContextSentenceForGrammarPattern(pattern.id)).toBeUndefined();
  });

});

describe('SentencePatterns (walkthrough finish screen block)', () => {
  beforeEach(async () => {
    resetDbForTests(`sentence-patterns-${createId('db')}`);
    await ensureSettings();
  });

  const renderBlock = () =>
    render(withAppProviders(<MemoryRouter><SentencePatterns sentenceId="s1" /></MemoryRouter>));

  it('renders nothing when the sentence has no links', async () => {
    const { container } = renderBlock();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows the pattern, its span and note, lets an assistant link be dismissed, and keeps a confirmed link', async () => {
    const pattern = await ensureGrammarPattern('～ている', { shortMeaning: 'ongoing or resulting state' });
    const other = await ensureGrammarPattern('～ましょう', { shortMeaning: "let's" });
    await ensureSentenceGrammar('s1', pattern.id, {
      source: 'ai_suggested',
      confirmedByLearner: false,
      surfaceForm: '住んでいます',
      start: 3,
      end: 9,
      occurrenceExplanation: 'her current state',
    });
    await ensureSentenceGrammar('s1', other.id, { source: 'manual', confirmedByLearner: true, surfaceForm: '話しましょう', start: 10, end: 16 });
    await ensureSentenceGrammar('s2', pattern.id, { source: 'manual', confirmedByLearner: true });

    renderBlock();
    expect(await screen.findByText('Patterns here')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '～ている' })).toHaveAttribute('href', `/grammar/${pattern.id}`);
    expect(screen.getByText('住んでいます')).toBeInTheDocument();
    expect(screen.getByText('her current state')).toBeInTheDocument();
    expect(screen.getByText("let's")).toBeInTheDocument();
    expect(screen.getByText(/Also in 1 other sentence you have met/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Not this' })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Not this' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: '～ている' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: '～ましょう' })).toBeInTheDocument();
    expect(await getDb().sentenceGrammar.where('sentenceId').equals('s1').count()).toBe(1);
  });
});
