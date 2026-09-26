import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';

import {
  createNamedPodcastFeed,
  deleteNamedPodcastFeed,
  listNamedPodcastFeeds,
} from '../db/repository';

/**
 * Saved, synced podcast feed shortcuts ("S-Town" -> its RSS URL) shown next
 * to QuickMinePage/YouTubeMinePage's feed URL input — lets a learner pick a
 * name instead of remembering/re-finding a URL that's often just a generic
 * host + opaque id. See recentPodcastFeedUrls (AppSettings) for the
 * separate, per-device "last few URLs typed" datalist this complements.
 */
export function NamedPodcastFeedPicker({
  url,
  onSelectUrl,
}: {
  url: string;
  onSelectUrl: (url: string) => void;
}) {
  const feeds = useLiveQuery(() => listNamedPodcastFeeds(), []);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [savingName, setSavingName] = useState('');

  const trimmedUrl = url.trim();
  const alreadySaved = feeds?.some((feed) => feed.url === trimmedUrl) ?? false;

  async function handleSave() {
    if (!trimmedUrl || !savingName.trim()) return;
    await createNamedPodcastFeed({ name: savingName.trim(), url: trimmedUrl });
    setSavingName('');
    setShowSaveInput(false);
  }

  return (
    <div className="stack" style={{ gap: '0.35rem' }}>
      {feeds && feeds.length > 0 ? (
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
          {feeds.map((feed) => (
            <span key={feed.id} className="row" style={{ gap: '0.15rem' }}>
              <button type="button" className="chip" onClick={() => onSelectUrl(feed.url)}>
                {feed.name}
              </button>
              <button
                type="button"
                className="chip"
                aria-label={`Forget saved feed "${feed.name}"`}
                onClick={() => void deleteNamedPodcastFeed(feed.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {showSaveInput ? (
        <div className="row" style={{ gap: '0.35rem' }}>
          <input
            style={{ flex: 1 }}
            value={savingName}
            placeholder="Name this feed (e.g. S-Town)"
            onChange={(event) => setSavingName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleSave();
            }}
            autoFocus
          />
          <button type="button" disabled={!savingName.trim()} onClick={() => void handleSave()}>
            Save
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setShowSaveInput(false);
              setSavingName('');
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="secondary"
          disabled={!trimmedUrl || alreadySaved}
          onClick={() => setShowSaveInput(true)}
        >
          {alreadySaved ? 'Feed already saved' : 'Save this feed as…'}
        </button>
      )}
    </div>
  );
}
