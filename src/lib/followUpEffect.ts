import type { SentenceLearningEvent } from '../domain/types';
import { FOLLOW_UP_ASPECT, FOLLOW_UP_LABEL, type FollowUpSource, type FollowUpTool } from './followUpOffer';
import { nextListeningAttempt, type ListeningAttempt } from './listeningEvidence';
import { buildPronunciationAttempts } from './pronunciationOutcome';
import { MEANING_CHECK_KEY_PREFIX } from './wordEvidence';

/**
 * "What happened after each follow-up offer" (docs/ROADMAP.md, "Follow-up offers and
 * activity effectiveness"). Groups the reader's `follow_up_offer` events by the tool
 * offered and by whether the offer was a rule pick or a random baseline draw, and
 * looks at two outcomes on the same sentence afterwards:
 * - reading: the next Read check (`gist_check`) within `READ_WINDOW_DAYS`, and whether it was "got it";
 * - listening: the next listening attempt (`listeningEvidence.ts`) within `LISTENING_WINDOW_DAYS`
 *   that happened on a later occasion than the offer;
 * - meaning: the next Word check on a word of that sentence (a `vocab:<id>` target_practice event),
 *   same window and "later occasion" rule;
 * - pronunciation: the next self-rated shadow of the sentence or a phrase in it
 *   (`pronunciationOutcome.ts`), same window and rule.
 *
 * Only the `random` rows are a fair comparison between tools: the tool was assigned by chance.
 * `rule` offers are chosen because the sentence had a weak word or no audio problem, so their
 * outcomes mix the tool with the situation. Taken-versus-not is the learner's own choice and is
 * shown only as a count. One learner and few events: associations, not proof. Pure; callers fetch rows.
 */

export const READ_WINDOW_DAYS = 14;
export const LISTENING_WINDOW_DAYS = 7;
/** A listening attempt counts as a later occasion only if it happened this long after the offer. */
export const LATER_OCCASION_MS = 60 * 60 * 1000;

const DAY_MS = 86_400_000;

export interface OfferView {
  eventId: string;
  sentenceId: string;
  visitId: string;
  at: number;
  tool: FollowUpTool;
  source: FollowUpSource;
}

const TOOLS = new Set<string>(Object.keys(FOLLOW_UP_ASPECT));

/** Parses a `follow_up_offer` event's `followup:<tool>:<rule|random>` key; null for anything else. */
export function parseOffer(event: Pick<SentenceLearningEvent, 'id' | 'sentenceId' | 'visitId' | 'timestamp' | 'action' | 'target'>): OfferView | null {
  if (event.action !== 'follow_up_offer') return null;
  const [prefix, tool, source] = (event.target?.key ?? '').split(':');
  if (prefix !== 'followup' || !tool || !TOOLS.has(tool) || (source !== 'rule' && source !== 'random')) return null;
  const at = Date.parse(event.timestamp);
  if (Number.isNaN(at)) return null;
  return { eventId: event.id, sentenceId: event.sentenceId, visitId: event.visitId, at, tool: tool as FollowUpTool, source };
}

export interface FollowUpEffectRow {
  tool: FollowUpTool;
  source: FollowUpSource;
  label: string;
  aspect: string;
  offers: number;
  /** Offers where the follow-up tool logged an event under the Read check's visit. Shadowing counts only once the learner rates it. */
  taken: number;
  readNext: number;
  readGotIt: number;
  listenNext: number;
  listenGotIt: number;
  meaningNext: number;
  meaningGotIt: number;
  pronNext: number;
  pronGotIt: number;
}

export interface FollowUpEffectReport {
  hasData: boolean;
  rows: FollowUpEffectRow[];
  totalOffers: number;
}

type EventLike = Pick<SentenceLearningEvent, 'id' | 'sentenceId' | 'visitId' | 'timestamp' | 'action' | 'target' | 'outcome'>;

export function buildFollowUpEffect(input: { events: readonly EventLike[]; listening: readonly ListeningAttempt[] }): FollowUpEffectReport {
  const offers = input.events.flatMap((event) => {
    const offer = parseOffer(event);
    return offer ? [offer] : [];
  });
  const byVisit = new Map<string, EventLike[]>();
  const readChecksBySentence = new Map<string, Array<{ at: number; gotIt: boolean }>>();
  const wordChecksBySentence = new Map<string, Array<{ at: number; gotIt: boolean }>>();
  const pronunciation = buildPronunciationAttempts(input.events);
  for (const event of input.events) {
    const list = byVisit.get(event.visitId);
    if (list) list.push(event);
    else byVisit.set(event.visitId, [event]);
    if (event.action === 'target_practice' && event.outcome && event.target?.key.startsWith(MEANING_CHECK_KEY_PREFIX)) {
      const at = Date.parse(event.timestamp);
      if (!Number.isNaN(at)) {
        const checks = wordChecksBySentence.get(event.sentenceId) ?? [];
        checks.push({ at, gotIt: event.outcome === 'got_it' });
        wordChecksBySentence.set(event.sentenceId, checks);
      }
    }
    if (event.action === 'gist_check' && event.outcome) {
      const at = Date.parse(event.timestamp);
      if (Number.isNaN(at)) continue;
      const checks = readChecksBySentence.get(event.sentenceId) ?? [];
      checks.push({ at, gotIt: event.outcome === 'got_it' });
      readChecksBySentence.set(event.sentenceId, checks);
    }
  }

  const rows = new Map<string, FollowUpEffectRow>();
  for (const offer of offers) {
    const key = `${offer.tool}:${offer.source}`;
    const row = rows.get(key) ?? {
      tool: offer.tool,
      source: offer.source,
      label: FOLLOW_UP_LABEL[offer.tool],
      aspect: FOLLOW_UP_ASPECT[offer.tool],
      offers: 0,
      taken: 0,
      readNext: 0,
      readGotIt: 0,
      listenNext: 0,
      listenGotIt: 0,
      meaningNext: 0,
      meaningGotIt: 0,
      pronNext: 0,
      pronGotIt: 0,
    };
    row.offers += 1;
    if ((byVisit.get(offer.visitId) ?? []).some((event) => event.action !== 'gist_check' && event.action !== 'follow_up_offer')) row.taken += 1;

    const nextRead = (readChecksBySentence.get(offer.sentenceId) ?? [])
      .filter((check) => check.at > offer.at && check.at <= offer.at + READ_WINDOW_DAYS * DAY_MS)
      .sort((a, b) => a.at - b.at)[0];
    if (nextRead) {
      row.readNext += 1;
      if (nextRead.gotIt) row.readGotIt += 1;
    }

    const nextListen = nextListeningAttempt(input.listening, offer.sentenceId, offer.at + LATER_OCCASION_MS, LISTENING_WINDOW_DAYS);
    if (nextListen) {
      row.listenNext += 1;
      if (nextListen.success) row.listenGotIt += 1;
    }
    const laterStart = offer.at + LATER_OCCASION_MS;
    const laterEnd = offer.at + LISTENING_WINDOW_DAYS * DAY_MS;
    const nextWord = (wordChecksBySentence.get(offer.sentenceId) ?? [])
      .filter((check) => check.at > laterStart && check.at <= laterEnd)
      .sort((a, b) => a.at - b.at)[0];
    if (nextWord) {
      row.meaningNext += 1;
      if (nextWord.gotIt) row.meaningGotIt += 1;
    }
    const nextPron = pronunciation.find((attempt) => attempt.sentenceId === offer.sentenceId && attempt.at > laterStart && attempt.at <= laterEnd);
    if (nextPron) {
      row.pronNext += 1;
      if (nextPron.success) row.pronGotIt += 1;
    }
    rows.set(key, row);
  }

  const sorted = [...rows.values()].sort(
    (a, b) => (a.source === b.source ? 0 : a.source === 'random' ? -1 : 1) || a.label.localeCompare(b.label),
  );
  return { hasData: offers.length > 0, rows: sorted, totalOffers: offers.length };
}
