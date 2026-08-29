const WK_API_BASE = 'https://api.wanikani.com/v2';
const WK_REVISION = '20170710';

export interface WkReading {
  reading: string;
  type: string;
  primary?: boolean;
  accepted_answer?: boolean;
}

export interface WkMeaning {
  meaning: string;
  primary?: boolean;
  accepted_answer?: boolean;
}

export interface WkKanjiSubject {
  id: number;
  object: string;
  data: {
    characters: string | null;
    hidden_at: string | null;
    meanings: WkMeaning[];
    readings?: WkReading[];
    meaning_mnemonic?: string;
    meaning_hint?: string;
    reading_mnemonic?: string;
    reading_hint?: string;
  };
}

export function isHiddenSubject(subject: WkKanjiSubject): boolean {
  return Boolean(subject.data.hidden_at);
}

/** Primary/accepted-answer meanings, falling back to all meanings if none are flagged. */
export function primaryMeanings(subject: WkKanjiSubject): string[] {
  const meanings = subject.data.meanings ?? [];
  const primary = meanings.filter((m) => m.primary || m.accepted_answer);
  return (primary.length ? primary : meanings).map((m) => m.meaning);
}

/**
 * Readings grouped by type (onyomi/kunyomi/nanori). Within each type
 * independently: primary/accepted-answer readings of that type if any
 * exist, else all readings of that type — the fallback must not be decided
 * globally, since one type having a primary reading says nothing about
 * whether another type does.
 */
export function readingsByType(subject: WkKanjiSubject): {
  onyomi: string[];
  kunyomi: string[];
  nanori: string[];
} {
  const readings = subject.data.readings ?? [];
  const grouped = { onyomi: [] as string[], kunyomi: [] as string[], nanori: [] as string[] };
  for (const type of ['onyomi', 'kunyomi', 'nanori'] as const) {
    const ofType = readings.filter((r) => r.type === type);
    const primary = ofType.filter((r) => r.primary || r.accepted_answer);
    const source = primary.length ? primary : ofType;
    grouped[type] = source.map((r) => r.reading);
  }
  return grouped;
}

export interface KanjiFields {
  character: string;
  meanings: string[];
  onyomi: string[];
  kunyomi: string[];
  nanori: string[];
  /** WaniKani mnemonics/hints — null when absent (radical-only kanji occasionally lack a reading mnemonic). */
  meaningMnemonic: string | null;
  meaningHint: string | null;
  readingMnemonic: string | null;
  readingHint: string | null;
  externalId: string;
}

/** Pure transform from a WK kanji subject to the fields Kanji needs. Returns null for malformed subjects (no character). */
export function wanikaniSubjectToKanjiFields(subject: WkKanjiSubject): KanjiFields | null {
  const character = subject.data.characters;
  if (!character) return null;
  const readings = readingsByType(subject);
  return {
    character,
    meanings: primaryMeanings(subject),
    onyomi: readings.onyomi,
    kunyomi: readings.kunyomi,
    nanori: readings.nanori,
    meaningMnemonic: subject.data.meaning_mnemonic?.trim() || null,
    meaningHint: subject.data.meaning_hint?.trim() || null,
    readingMnemonic: subject.data.reading_mnemonic?.trim() || null,
    readingHint: subject.data.reading_hint?.trim() || null,
    externalId: `wk:${subject.id}`,
  };
}

interface WkPage<T = WkKanjiSubject> {
  data: T[];
  pages: { next_url: string | null };
}

async function wkGet<T = WkKanjiSubject>(url: string, token: string): Promise<WkPage<T>> {
  const headers = {
    Authorization: `Bearer ${token.trim()}`,
    'Wanikani-Revision': WK_REVISION,
    Accept: 'application/json',
  };
  for (;;) {
    const response = await fetch(url, { headers });
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after') ?? '5');
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }
    if (!response.ok) {
      throw new Error(`WaniKani API error ${response.status} for ${url}: ${await response.text()}`);
    }
    return (await response.json()) as WkPage<T>;
  }
}

/** Fetches every non-hidden kanji subject from the WaniKani catalog (not the user's own progress). */
export async function fetchWanikaniKanjiSubjects(token: string): Promise<WkKanjiSubject[]> {
  const out: WkKanjiSubject[] = [];
  let url: string | null = `${WK_API_BASE}/subjects?types=kanji`;
  while (url) {
    const page: WkPage<WkKanjiSubject> = await wkGet<WkKanjiSubject>(url, token);
    out.push(...page.data.filter((subject) => !isHiddenSubject(subject)));
    url = page.pages.next_url;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vocabulary subjects — mnemonics only (scripts/backfill-wanikani-mnemonics.ts).
// WaniKani has both `vocabulary` and `kana_vocabulary` subject types; only
// `vocabulary` carries kanji + the `<radical>`/`<kanji>` mnemonic markup we
// want, but kana_vocabulary still has plain meaning/reading mnemonics worth
// keeping, so both are fetched.
// ---------------------------------------------------------------------------

export interface WkVocabSubject {
  id: number;
  object: string;
  data: {
    characters: string | null;
    hidden_at: string | null;
    readings?: WkReading[];
    meaning_mnemonic?: string;
    reading_mnemonic?: string;
  };
}

export interface VocabMnemonics {
  /** The vocabulary's written form, e.g. 一つ — matched against VocabularyItem.expression. */
  characters: string;
  /** Accepted readings (primary first) — the homophone tiebreaker. */
  readings: string[];
  meaningMnemonic: string | null;
  readingMnemonic: string | null;
}

/** Pure transform from a WK vocabulary subject to its mnemonic fields. Returns null when there's nothing usable (no characters, or both mnemonics empty). */
export function wanikaniVocabSubjectToMnemonics(
  subject: WkVocabSubject,
): VocabMnemonics | null {
  const characters = subject.data.characters;
  if (!characters) return null;
  const meaningMnemonic = subject.data.meaning_mnemonic?.trim() || null;
  const readingMnemonic = subject.data.reading_mnemonic?.trim() || null;
  if (!meaningMnemonic && !readingMnemonic) return null;
  const readings = subject.data.readings ?? [];
  const primary = readings.filter((r) => r.primary || r.accepted_answer);
  return {
    characters,
    readings: (primary.length ? primary : readings).map((r) => r.reading),
    meaningMnemonic,
    readingMnemonic,
  };
}

/** Fetches every non-hidden vocabulary + kana_vocabulary subject from the WaniKani catalog. */
export async function fetchWanikaniVocabularySubjects(
  token: string,
): Promise<WkVocabSubject[]> {
  const out: WkVocabSubject[] = [];
  let url: string | null = `${WK_API_BASE}/subjects?types=vocabulary,kana_vocabulary`;
  while (url) {
    const page: WkPage<WkVocabSubject> = await wkGet<WkVocabSubject>(url, token);
    out.push(...page.data.filter((subject) => !subject.data.hidden_at));
    url = page.pages.next_url;
  }
  return out;
}
