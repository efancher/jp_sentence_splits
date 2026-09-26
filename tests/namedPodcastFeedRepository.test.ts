import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  createNamedPodcastFeed,
  deleteNamedPodcastFeed,
  getDb,
  listNamedPodcastFeeds,
  renameNamedPodcastFeed,
} from '../src/db/repository';
import { createId } from '../src/lib/ids';

describe('named podcast feed repository', () => {
  beforeEach(() => {
    resetDbForTests(`named-feed-repo-${createId('db')}`);
  });

  it('creates, lists alphabetically, renames, and deletes', async () => {
    await createNamedPodcastFeed({ name: 'S-Town', url: 'https://feeds.example.com/s-town' });
    const zebra = await createNamedPodcastFeed({
      name: 'Zebra Cast',
      url: 'https://feeds.example.com/zebra',
    });

    expect((await listNamedPodcastFeeds()).map((f) => f.name)).toEqual(['S-Town', 'Zebra Cast']);

    await renameNamedPodcastFeed(zebra.id, 'Aardvark Cast');
    expect((await listNamedPodcastFeeds()).map((f) => f.name)).toEqual([
      'Aardvark Cast',
      'S-Town',
    ]);

    await deleteNamedPodcastFeed(zebra.id);
    expect(await listNamedPodcastFeeds()).toHaveLength(1);
    expect(await getDb().namedPodcastFeeds.get(zebra.id)).toBeUndefined();
  });

  it('trims whitespace on the name and url', async () => {
    const feed = await createNamedPodcastFeed({
      name: '  My Show  ',
      url: '  https://feeds.example.com/my-show  ',
    });
    expect(feed.name).toBe('My Show');
    expect(feed.url).toBe('https://feeds.example.com/my-show');
  });
});
