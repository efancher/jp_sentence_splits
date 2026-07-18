# Satori Glossbook — user guide

## Install on iPhone or iPad

1. Open the deployed GitHub Pages site in Safari.
2. Tap **Share → Add to Home Screen**.
3. Launch Glossbook from the Home Screen.

After one successful online load, the application shell and existing study data
are available offline.

## Import a Satori Reader CSV

1. Export vocabulary from Satori Reader and save the CSV in Files.
2. Open **Import** and choose the CSV.
3. Review totals, warnings, conflicts, and the unique sentence list.
4. Select the sentences to import.
5. Send them to Inbox, a new book, or an existing book.

Glossbook examines Context1, Context2, and Context3. JE/EJ duplicates and
multiple target words for one sentence are merged. Reimporting is idempotent:
manual analyses, study statuses, chapter assignments, and book order are
preserved.

## Organize sentences

### Inbox

Select one or more unassigned sentences, choose or create a book, and tap
**Add to book**.

### Import batches

Inbox lists import history. Open **View batch** to:

- review every sentence linked to that import;
- inspect import warnings;
- rename the batch;
- select and add batch sentences to a book.

### Books and chapters

Inside a book:

- use **Edit details** for title, source title, URL, and notes;
- use **Edit order** for drag-and-drop, directional controls, or an exact
  position;
- select sentences to copy or move them to another book;
- create chapters and assign selected sentences to one;
- reorder, rename, or delete chapters.

Deleting a chapter does not delete its sentences. They become unassigned within
the same book.

### Search

Search Japanese, Satori English, target expressions/readings/meanings, and book
titles. Filters cover assignment, status, import warnings, vocabulary count,
missing translation, and missing analysis.

Select matching results to add them to a book or export them as a worksheet.

## Analyze a sentence

1. Open **Analyze** from a book or Search.
2. Add spaces to the editable Japanese copy to define chunk boundaries.
3. Optionally apply heuristic chunks and role suggestions.
4. Enter an editable role and Japanese-order literal English for each chunk.
5. Review the generated CHUNK, ROLE, and LIT lines.
6. Save or mark the sentence complete/needs review.

The non-whitespace source Japanese must remain unchanged. Autosave runs after a
short delay and on blur; the manual Save button is a fallback.

## Practice

Choose a session:

- Incomplete
- Needs review
- Unstarted
- All sentences
- One chapter

Practice supports deterministic shuffle, optional vocabulary, scratch notes,
staged reveals, reveal/hide all, progress, and status-and-advance actions.
Desktop users can navigate with the left and right arrow keys.

## Export

Sentence and book worksheets can be copied, shared, or downloaded. Worksheet
text includes Japanese, saved chunks, roles, literal English, Satori English,
and an ichi.moe link.

## Backup and restore

Use **Settings → Backup & restore** regularly.

- **Export all data** downloads a versioned JSON backup.
- **Merge** combines validated backup data with existing local data.
- **Replace all local data** clears local records only after validation and
  explicit confirmation.

Browser-local data does not automatically synchronize between an iPhone, iPad,
and desktop. Use backups to move or protect work.

## Troubleshooting

- **New release not visible:** accept the update banner, then reopen the app.
- **Old Home Screen icon:** remove and add the Home Screen app again.
- **Missing data on another device:** restore a backup; devices do not sync.
- **No sentences in a Practice scope:** select All or a different status.
- **Import warning:** open the batch or import preview; conflicts retain both
  preferred and alternative source values.
