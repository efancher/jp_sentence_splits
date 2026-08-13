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
    externalId: `wk:${subject.id}`,
  };
}

interface WkPage {
  data: WkKanjiSubject[];
  pages: { next_url: string | null };
}

async function wkGet(url: string, token: string): Promise<WkPage> {
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
    return (await response.json()) as WkPage;
  }
}

/** Fetches every non-hidden kanji subject from the WaniKani catalog (not the user's own progress). */
export async function fetchWanikaniKanjiSubjects(token: string): Promise<WkKanjiSubject[]> {
  const out: WkKanjiSubject[] = [];
  let url: string | null = `${WK_API_BASE}/subjects?types=kanji`;
  while (url) {
    const page = await wkGet(url, token);
    out.push(...page.data.filter((subject) => !isHiddenSubject(subject)));
    url = page.pages.next_url;
  }
  return out;
}
