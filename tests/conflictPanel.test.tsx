import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictPanel } from '../src/components/ConflictPanel';
import { getDb, resetDbForTests } from '../src/db/database';
import { addConflict, listOpenConflicts, listPendingMutations } from '../src/sync/queue';

const sync = vi.hoisted(() => ({
  syncNow: vi.fn(async () => {}),
  buildDiagnostics: vi.fn(async () => 'diagnostics-snapshot'),
}));
vi.mock('../src/sync/SyncProvider', () => ({ useSync: () => sync }));

const report = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/db/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/db/repository')>();
  return {
    ...actual,
    reportSyncIssue: (input: Parameters<typeof actual.reportSyncIssue>[0]) => {
      if (report.fail) return Promise.reject(new Error('report upload failed'));
      return actual.reportSyncIssue(input);
    },
  };
});

const NOW = '2026-11-01T00:00:00.000Z';
type Chapter = { id: string; title: string; position: number };
const localBook = (id: string, title: string, chapters: Chapter[] = []) => ({
  id, title, archived: false, chapters, collapsedChapterIds: [], createdAt: NOW, updatedAt: NOW,
});
const remoteBook = (id: string, title: string, chapters: Chapter[] = []) => ({
  id, title, archived: false, chapters, collapsed_chapter_ids: [], created_at: NOW, updated_at: NOW, version: 5,
});

async function seedBookConflict(id: string, localTitle: string, remoteTitle: string) {
  await getDb().books.put(localBook(id, localTitle));
  await addConflict({
    entity: 'books', recordId: id,
    localPayload: localBook(id, localTitle), remotePayload: remoteBook(id, remoteTitle),
    localVersion: 3, remoteVersion: 5,
  });
}

const NOTE_PLACEHOLDER = 'What looks wrong about this conflict?';
const cardFor = (id: string) => screen.getByText(new RegExp(`books · ${id}`)).closest('.conflict-card') as HTMLElement;

beforeEach(() => {
  resetDbForTests();
  sync.syncNow.mockClear();
  sync.buildDiagnostics.mockClear();
  report.fail = false;
  vi.restoreAllMocks();
});

describe('ConflictPanel', () => {
  it('renders nothing when there are no open conflicts', async () => {
    const { container } = render(<ConflictPanel />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows each conflict with its versions and lazily opens the full payloads', async () => {
    await seedBookConflict('b1', 'Local title', 'Cloud title');
    render(<ConflictPanel />);
    expect(await screen.findByText('Conflicts need attention')).toBeInTheDocument();
    expect(screen.getByText('local v3 vs remote v5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep all local (1)' })).toBeInTheDocument();
    expect(screen.queryByText(/"title": "Local title"/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Full local version'));
    expect(await screen.findByText(/"title": "Local title"/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Full remote version'));
    expect(await screen.findByText(/"title": "Cloud title"/)).toBeInTheDocument();
  });

  it('Keep local keeps this device’s record, queues it against the remote version and syncs', async () => {
    await seedBookConflict('b1', 'Local title', 'Cloud title');
    render(<ConflictPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep local' }));

    await waitFor(async () => expect(await listOpenConflicts()).toHaveLength(0));
    expect((await getDb().books.get('b1'))?.title).toBe('Local title');
    const queued = await listPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ entity: 'books', recordId: 'b1', operation: 'upsert', expectedVersion: 5 });
    expect((await getDb().syncConflicts.toArray())[0].resolution).toBe('keep_local');
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Conflicts need attention')).not.toBeInTheDocument());
  });

  it('Keep remote adopts the cloud record without queuing an upload', async () => {
    await seedBookConflict('b1', 'Local title', 'Cloud title');
    render(<ConflictPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep remote' }));

    await waitFor(async () => expect(await listOpenConflicts()).toHaveLength(0));
    expect((await getDb().books.get('b1'))?.title).toBe('Cloud title');
    expect(await listPendingMutations()).toHaveLength(0);
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
  });

  it('Keep both stores the cloud record and a separately-queued local copy', async () => {
    await seedBookConflict('b1', 'Local title', 'Cloud title');
    render(<ConflictPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep both (duplicate local)' }));

    await waitFor(async () => expect(await listOpenConflicts()).toHaveLength(0));
    const books = await getDb().books.toArray();
    expect(books.map((b) => b.title).sort()).toEqual(['Cloud title', 'Local title (local copy)']);
    const copy = books.find((b) => b.id !== 'b1')!;
    const queued = await listPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ recordId: copy.id, operation: 'upsert', expectedVersion: null });
  });

  it('offers Keep both only for books and sentences', async () => {
    await addConflict({
      entity: 'inbox', recordId: 'i1',
      localPayload: { id: 'i1' }, remotePayload: { id: 'i1' }, localVersion: 1, remoteVersion: 2,
    });
    render(<ConflictPanel />);
    await screen.findByText('Conflicts need attention');
    expect(screen.getByRole('button', { name: 'Keep local' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Keep both/ })).not.toBeInTheDocument();
  });

  it('bulk resolve asks first; cancelling changes nothing, confirming resolves every conflict', async () => {
    await seedBookConflict('b1', 'Local one', 'Cloud one');
    await seedBookConflict('b2', 'Local two', 'Cloud two');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ConflictPanel />);
    const keepAllRemote = await screen.findByRole('button', { name: 'Keep all remote (2)' });

    fireEvent.click(keepAllRemote);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('all 2 open conflict(s)'));
    expect(await listOpenConflicts()).toHaveLength(2);
    expect(sync.syncNow).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(keepAllRemote);
    await waitFor(async () => expect(await listOpenConflicts()).toHaveLength(0));
    expect((await getDb().books.get('b1'))?.title).toBe('Cloud one');
    expect((await getDb().books.get('b2'))?.title).toBe('Cloud two');
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
  });

  it('Keep all local queues every local record for upload', async () => {
    await seedBookConflict('b1', 'Local one', 'Cloud one');
    await seedBookConflict('b2', 'Local two', 'Cloud two');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ConflictPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep all local (2)' }));

    await waitFor(async () => expect(await listOpenConflicts()).toHaveLength(0));
    const queued = await listPendingMutations();
    expect(queued.map((q) => q.recordId).sort()).toEqual(['b1', 'b2']);
  });

  it('merges a book chapter by chapter, defaulting each differing chapter to the cloud side', async () => {
    const shared = { id: 'c1', title: 'Shared', position: 0 };
    const local = localBook('b1', 'Same title', [shared, { id: 'c2', title: 'Local edit', position: 1 }, { id: 'c3', title: 'Only here', position: 2 }]);
    const remote = remoteBook('b1', 'Same title', [shared, { id: 'c2', title: 'Cloud edit', position: 1 }]);
    await getDb().books.put(local);
    await addConflict({ entity: 'books', recordId: 'b1', localPayload: local, remotePayload: remote, localVersion: 3, remoteVersion: 5 });

    render(<ConflictPanel />);
    expect(await screen.findByText(/2 chapter\(s\) differ; book details match/)).toBeInTheDocument();
    const card = cardFor('b1');
    expect(within(card).getByText(/edited on both/)).toBeInTheDocument();
    expect(within(card).getByText(/only on this device/)).toBeInTheDocument();

    // Keep this device's edit of c2; leave c3 on the cloud side (which drops it).
    const radios = within(card).getAllByLabelText('This device');
    fireEvent.click(radios[0]);
    fireEvent.click(within(card).getByRole('button', { name: 'Apply chapter choices' }));

    await waitFor(async () => expect(await listOpenConflicts()).toHaveLength(0));
    const chapters = (await getDb().books.get('b1'))!.chapters;
    expect(chapters.map((c) => c.title)).toEqual(['Shared', 'Local edit']);
    expect((await getDb().syncConflicts.toArray())[0].resolution).toBe('merge');
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
  });

  it('Report this conflict needs a note, saves a report with diagnostics and marks the card', async () => {
    await seedBookConflict('b1', 'Local title', 'Cloud title');
    render(<ConflictPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Report this conflict' }));

    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(NOTE_PLACEHOLDER), { target: { value: '  titles should have matched  ' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(await screen.findByText('✓ Reported')).toBeInTheDocument();
    const reports = await getDb().syncIssueReports.toArray();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      note: 'titles should have matched', diagnosticsSnapshot: 'diagnostics-snapshot',
      conflictEntity: 'books', conflictRecordId: 'b1', status: 'open',
    });
    // Reporting leaves the conflict open for the user to resolve.
    expect(await listOpenConflicts()).toHaveLength(1);
    expect(screen.queryByPlaceholderText(NOTE_PLACEHOLDER)).not.toBeInTheDocument();
  });

  it('shows a failed report, keeps the note, and Cancel discards the form', async () => {
    await seedBookConflict('b1', 'Local title', 'Cloud title');
    report.fail = true;
    render(<ConflictPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Report this conflict' }));
    const box = screen.getByPlaceholderText(NOTE_PLACEHOLDER);
    fireEvent.change(box, { target: { value: 'broken' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('report upload failed')).toBeInTheDocument();
    expect(box).toHaveValue('broken');
    expect(screen.queryByText('✓ Reported')).not.toBeInTheDocument();
    expect(await getDb().syncIssueReports.count()).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByPlaceholderText(NOTE_PLACEHOLDER)).not.toBeInTheDocument();
  });
});
