/**
 * The in-progress labelling session, kept in localStorage so a refresh (or
 * closing the tab) resumes the same batch instead of drawing a new random one.
 * Only the *plan* is stored — the ordered item ids and the sample kind — never
 * progress: what's left is always "planned items with no label yet", so undo,
 * labels made elsewhere, and a crash all stay consistent for free.
 */

export type LabelMode = 'random' | 'targeted';

export const SESSION_SIZES = [1, 5, 10, 25] as const;
export type SessionSize = (typeof SESSION_SIZES)[number];
export const DEFAULT_SESSION_SIZE: SessionSize = 10;

export interface StoredLabelSession {
  mode: LabelMode;
  /** The full planned batch, in order. */
  linkIds: string[];
  /** True once the user chose "Stop for now" — resume is offered, not automatic. */
  paused: boolean;
  startedAt: string;
}

const SESSION_KEY = 'wordBoundaryLabelSession';
const SIZE_KEY = 'wordBoundarySessionSize';

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function loadStoredSession(): StoredLabelSession | null {
  try {
    const raw = storage()?.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLabelSession>;
    if ((parsed.mode !== 'random' && parsed.mode !== 'targeted') || !Array.isArray(parsed.linkIds)) return null;
    return {
      mode: parsed.mode,
      linkIds: parsed.linkIds.filter((id): id is string => typeof id === 'string'),
      paused: !!parsed.paused,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
    };
  } catch {
    return null;
  }
}

export function saveStoredSession(session: StoredLabelSession): void {
  try {
    storage()?.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // storage full / disabled: the session just won't survive a refresh
  }
}

export function clearStoredSession(): void {
  try {
    storage()?.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

/** The planned items that still have no label. */
export function remainingLinkIds(session: StoredLabelSession, labelledLinkIds: ReadonlySet<string>): string[] {
  return session.linkIds.filter((id) => !labelledLinkIds.has(id));
}

export function getSessionSize(): SessionSize {
  const value = Number(storage()?.getItem(SIZE_KEY));
  return (SESSION_SIZES as readonly number[]).includes(value) ? (value as SessionSize) : DEFAULT_SESSION_SIZE;
}

export function setSessionSize(size: SessionSize): void {
  try {
    storage()?.setItem(SIZE_KEY, String(size));
  } catch {
    // ignore
  }
}
