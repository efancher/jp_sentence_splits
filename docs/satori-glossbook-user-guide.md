# Satori Glossbook — user guide

## Install on iPhone or iPad

1. Open the deployed GitHub Pages site in Safari.
2. Tap **Share → Add to Home Screen**.
3. Launch Glossbook from the Home Screen.

After one successful online load, the application shell and existing study data
are available offline.

## Import a shadowing project ZIP

1. Export the project from `shadowmine` as a `.shadowing.zip`.
2. Open **Import → Shadowing project ZIP** and choose it from Files.
3. Review the source, sentence count, native clip count, and storage size.
4. Tap **Import complete project**.

Glossbook creates a book named after the source and imports Japanese, reading,
English, creator/channel, source URL, transcript metadata, and each sentence's
native audio clip. Sentences are ordered by clip start time (video/extraction
order), so the book always matches the timeline.

Reimporting a package with the same source ID refreshes that book and its
clips. It does not duplicate the book, and it preserves manual analysis and
study statuses. New sentences are added. Because the extraction order is
authoritative, reimporting also restores the book to video order — any manual
reordering of shadowing sentences is replaced on the next refresh (Satori CSV
imports still respect the Import "Initial order" dropdown). If the same
normalized Japanese sentence occurs more than once in one video, Glossbook
keeps all native clips but represents the text once in the book and shows a
warning in the preview.

On Analyze and Practice, **🎧 Native** plays the imported source clip. **🔊**
remains available for device TTS, and chunk audio continues to use TTS.

## Import a Satori Reader CSV

1. Export vocabulary from Satori Reader and save the CSV in Files.
2. Open **Import** and choose the CSV.
3. Review totals, warnings, conflicts, and the unique sentence list.
4. Select the sentences to import.
5. Send them to Inbox, a new book, or an existing book.
6. When importing into a book, optionally assign them to an existing chapter or
   create a new chapter in the same step (handy for one Satori article export).

Glossbook examines Context1, Context2, and Context3. JE/EJ duplicates and
multiple target words for one sentence are merged. Reimporting is idempotent:
manual analyses, study statuses, and book order are preserved. Importing into a
chapter also assigns any selected sentences that were already in that book.

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
- use **Order from paste** to paste Satori chapter-page text and reorder
  matching sentences by first appearance (episode-title lines count as
  sentences when already in the book; unmatched stay at the end);
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
3. Optionally **Preview heuristic** to see suggested chunk boundaries and roles
   without changing your work, or **Apply heuristic chunking** to use them.
4. Optionally check **Add zero-が (∅) subject** when the が subject is
   invisible. That inserts an editable practice chunk (default `∅が`) that is
   not part of the source sentence; move it with **Move up** / **Move down**.
5. Enter an editable role and Japanese-order literal English for each chunk.
   Use **Suggest sticky English** for a local alternative built from
   particles/engines, target vocabulary, and a small lexicon (not cloud
   translation).
6. Review the generated CHUNK, ROLE, and LIT lines.
7. Check **Review suggestions** for missing fields, role mismatches, and
   sticky-English alternatives.
8. Save or mark the sentence complete/needs review.

The non-whitespace source Japanese must remain unchanged (zero-が chunks are
excluded from that check). Autosave runs after a short delay and on blur; the
manual Save button is a fallback.

### Confirm vocabulary

Below the chunk editor, Analyze shows a **Vocabulary** panel with morphology
suggestions pulled from the sentence (content words start pre-selected). Drag
a piece into the tray to select it, or onto an adjacent selected piece to
combine them (e.g. やっ onto て → やって); tap also toggles selection.

Tap **Confirm vocabulary** (or **Confirm vocabulary and next**, which advances
to the next sentence) to save your picks. This is the *only* thing that turns
a suggestion into real, reviewable vocabulary — it creates (or reuses) a
`vocabulary_item` for each confirmed word, links it to this sentence with the
exact inflected form you saw here, and is what makes that word eligible for
every vocabulary-based review card (see **Review** below). Sentences whose
vocabulary was imported some other way (e.g. from a Satori CSV or shadowing
package) don't get this link automatically — confirming here is what
activates review for them.

When chunks exist, Analyze (and Practice after **Reveal chunks**) shows a
**puzzle strip**: SVG role-shaped pieces with neighbor-mating edges (particle
sockets, flat-right engine anchors, て-bridges, endings), soft clause bands, and
heuristic green/amber “fit” hints. Analyze also shows a compact shape key. Hover
a piece for the gloss. This is a study aid, not a full syntactic parse.

### Chunk roles

Analyze’s role dropdown uses Cure Dolly–style labels (Aが, を-car, engine,
clause connector, …). Open **Role guide** on the Analyze page, or **Help →
Chunk roles**, for a one-line meaning of each preset. Example: **clause
connector** fits そして / しかし; **て-car** is for verb て-form links, not the
word そして.

## Listen with device text-to-speech

Speaker buttons appear beside the Japanese sentence on the Analyze and
Practice screens, and beside each chunk in the Analyze editor.

- Tap 🔊 to hear the sentence or chunk with the device's Japanese voice.
- Tap the active 🔊 button (or **Stop audio**) to stop playback.
- **Play by chunks** reads each chunk in order, highlighting the current one.
- Playback always starts from a tap; nothing plays automatically.

Configure the voice and speaking rate under **Settings → Text-to-speech**.
Preferences persist on the device. Voices are provided by iOS/the browser —
no internet TTS service is used, and no audio leaves the device. If the
browser lists no Japanese voice, playback still works with the system
default. Downloading higher-quality Japanese voices in iOS Settings
(Accessibility → Spoken Content → Voices) can improve quality, though not
every system voice is exposed to web apps.

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

If a sentence has confirmed vocabulary (see **Confirm vocabulary** above), a
**"Recognized these without hints?"** panel appears below the vocab chips.
Rate a word there if you recognized it while just reading — unlike Review,
nothing is hidden here, so it's a self-report, not a test. This still counts
as real evidence for that word's schedule (tagged as a natural encounter,
visible on its **Why?** page — see **Review** below), letting words you
already know well progress even between formal review sessions.

## Build

**Build** inverts Analyze/Practice: you get the English prompt and assemble
Japanese from shuffled chunk tiles. Sessions only include sentences that already
have analysis chunks.

1. Open **Build** from a book (or **Build this** from Analyze).
2. Tap bank tiles into your assembly (tap a placed tile to return it).
3. Raise hints step by step: vocabulary → slot count → sticky English → roles /
   shapes → Japanese on tiles.
4. **Check** scores chunk order against your saved analysis; **Reveal answer**
   shows the puzzle strip.

## Review

**Review** is spaced repetition (FSRS): a self-paced queue you rate
**Again** / **Hard** / **Good** / **Easy**, which schedules the next time
each card comes back. Open it from the nav (all books) or **Review** inside
a book (that book only).

### Card types

Every sentence automatically gets two baseline cards (**Comprehension**,
**Reading in context**) — read it, reveal the translation, rate yourself.
A sentence with reference audio also gets a **Listening** card (audio
plays first, Japanese stays hidden until reveal).

The rest only appear for a word once you've **confirmed** it in Analyze
(see **Confirm vocabulary** above) — this is the single most common reason
a card type seems to be "missing":

- **Reading retrieval** — the word is shown, its reading is hidden.
- **Cloze** — the word itself is blanked out.
- **Reading production** — type the reading instead of just revealing it.
- **Sentence transformation** — type a specific conjugated form (only for
  words with a recognized part of speech; shown as "Conjugate to: ...").
- **Contrastive pair** — two confusable words shown together (e.g.
  transitive/intransitive pairs like 付く/付ける), so you have to
  distinguish them rather than recall either alone. Rare by design — it
  only exists for a handful of curated pairs.

Cards from every eligible category are mixed into one session rather than
shown one whole category at a time, and a limited number of brand-new
(never-before-seen) cards are introduced per sitting so a big book doesn't
front-load an overwhelming batch — both configurable in **Settings**.

### Why a card is there — and when one stops appearing

Every card has a **Why?** link showing its full scheduling state (interval,
stability, reps, due date), maturity, and complete review history —
including anything logged from Practice's natural-encounter panel.

Once a card's interval grows past a threshold (**Settings → "Graduate
after this many days between reviews"**, default 180), it stops being
quizzed — the scheduler's own signal that you've retained it long-term.
Set that to `0` to turn graduation off entirely; a graduated card's
**Why?** page still shows everything, it just won't come up again unless
you raise or disable the threshold.

### Settings

- **New cards per review session** — caps how many never-before-seen
  words/sentences get introduced per sitting. Already-due reviews are
  never capped by this.
- **Graduate after this many days between reviews** — see above.

### How to get more out of Review

The fastest way to unlock more card variety is simply **confirming
vocabulary** in Analyze as you go — every confirmed word becomes eligible
for reading retrieval/cloze/reading production/sentence transformation
immediately, and pairs it happens to share a curated confusion with become
eligible for contrastive review too. If Review still looks thin after a
lot of confirming, check whether your confirmed words have a part of
speech recorded (visible on `/vocabulary`) — words without one are
recognized but never get a sentence-transformation card, since there's
nothing to conjugate them with.

## Export

Sentence and book worksheets can be copied, shared, or downloaded. Worksheet
text includes Japanese, saved chunks, roles, literal English, Satori English,
and an ichi.moe link.

## Sync across devices

**Settings → Account & sync**: sign in (or create an account) to sync study
data to the cloud and share it across an iPhone, iPad, and desktop
automatically. **Sync now** forces an immediate sync; the status line shows
pending changes and the last successful sync time. Reference audio syncs
separately (a toggle, since it's larger) — imported shadowing audio does
not sync regardless.

Without signing in, data stays entirely local to that browser/device.

## Backup and restore

Use **Settings → Backup & restore** regularly — independent of sync, and
still the only way to move data to a device you don't want to sign in on,
or to protect against a sync-side mistake.

- **Export all data** downloads a versioned JSON backup.
- **Merge** combines validated backup data with existing local data.
- **Replace all local data** clears local records only after validation and
  explicit confirmation.

Imported shadowing audio is not included in the lightweight JSON backup.
Retain each original `.shadowing.zip`; reimporting it restores its native
clips. **Replace all local data** also removes locally imported audio.

## Troubleshooting

- **New release not visible:** accept the update banner, then reopen the app
  (a hard refresh works too if the banner hasn't shown up yet).
- **Old Home Screen icon:** remove and add the Home Screen app again.
- **Missing data on another device:** sign in and sync on both, or restore a
  backup — without signing in, devices don't share data.
- **No sentences in a Practice scope:** select All or a different status.
- **Review only ever shows plain sentences, never vocabulary-based cards:**
  confirm some vocabulary in Analyze first — see **Confirm vocabulary** and
  **How to get more out of Review** above.
- **Import warning:** open the batch or import preview; conflicts retain both
  preferred and alternative source values.
