import type { NamedPodcastFeed } from '../../domain/types';
import { getDb } from '../database';
import { nowIso } from '../../lib/normalize';
import { createId } from '../../lib/ids';
import { notifySync } from '../syncNotify';

// ---------------------------------------------------------------------------
// Named podcast feeds: a learner-labeled shortlist ("S-Town" -> its RSS URL)
// so QuickMinePage/YouTubeMinePage's podcast import doesn't require
// remembering or re-finding a feed URL. Synced (unlike recentPodcastFeedUrls
// above, a per-device MRU list) — see docs/STATUS.md.
// ---------------------------------------------------------------------------

export async function listNamedPodcastFeeds(): Promise<NamedPodcastFeed[]> {
  const db = getDb();
  const all = await db.namedPodcastFeeds.toArray();
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createNamedPodcastFeed(input: {
  name: string;
  url: string;
}): Promise<NamedPodcastFeed> {
  const db = getDb();
  const timestamp = nowIso();
  const feed: NamedPodcastFeed = {
    id: createId('podcast_feed'),
    name: input.name.trim(),
    url: input.url.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.namedPodcastFeeds.put(feed);
  notifySync('named_podcast_feeds', feed.id, feed);
  return feed;
}

export async function renameNamedPodcastFeed(
  id: string,
  name: string,
): Promise<NamedPodcastFeed> {
  const db = getDb();
  const existing = await db.namedPodcastFeeds.get(id);
  if (!existing) throw new Error('Named podcast feed not found');
  const updated: NamedPodcastFeed = {
    ...existing,
    name: name.trim(),
    updatedAt: nowIso(),
  };
  await db.namedPodcastFeeds.put(updated);
  notifySync('named_podcast_feeds', updated.id, updated);
  return updated;
}

export async function deleteNamedPodcastFeed(id: string): Promise<void> {
  const db = getDb();
  await db.namedPodcastFeeds.delete(id);
  notifySync('named_podcast_feeds', id, { id }, 'delete');
}
