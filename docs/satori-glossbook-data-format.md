# Satori Glossbook — backup data format

Versioned JSON backup used by Settings → Backup & restore.

## Envelope

```json
{
  "formatVersion": 1,
  "appVersion": "0.3.0",
  "exportedAt": "2026-07-18T00:00:00.000Z",
  "checksum": "optional-fnv-style-hex",
  "counts": {
    "books": 0,
    "sentences": 0,
    "bookSentences": 0,
    "analyses": 0,
    "importBatches": 0,
    "inbox": 0
  },
  "books": [],
  "sentences": [],
  "bookSentences": [],
  "analyses": [],
  "importBatches": [],
  "inbox": [],
  "settings": {
    "id": "settings",
    "theme": "system",
    "hideSatoriEnglishInitially": true,
    "showReadingsInitially": false,
    "defaultImportDestination": "inbox",
    "textDisplayMode": "plain"
  }
}
```

`formatVersion` is defined by `BACKUP_FORMAT_VERSION` in `src/appConfig.ts`. Imports are validated with Zod (`src/domain/schemas.ts`). A malformed backup must not erase the existing database; validation errors are reported and apply is aborted.

## Record shapes

### Book

- `id`, `title`, optional `subtitle` / `sourceUrl` / `notes`
- `archived`, `createdAt`, `updatedAt`, optional `lastOpenedAt`
- `chapters[]`: `{ id, title, position }`

### Sentence

- `id` (stable from normalized Japanese key)
- `normalizedKey`, `japanese`, `readingOnly`, `inlineReading`, `translation`
- `targetVocabulary[]` with paired `expression` / `reading` / `furigana` / `english` / `partsOfSpeech` / `sourceCardIds` / `cardTypes`
- `sourceReferences[]`, `conflicts[]`
- `earliestCreatedAt`, `latestCreatedAt`, `firstOccurrenceIndex`
- `importBatchIds[]`, `createdAt`, `updatedAt`

### BookSentence

- Unique on `(bookId, sentenceId)`
- `position`, `status` (`unstarted` | `in_progress` | `complete` | `needs_review`)
- `addedAt`, optional `lastStudiedAt`, optional `note`
- optional `chapterId` referencing a chapter embedded in that book

`chapters` and `chapterId` are additive fields in backup format version 1.
Older backups are accepted and receive an empty chapter list during validation.

### SentenceAnalysis

- Keyed by `sentenceId`
- `chunks[]`: `{ id, order, japanese, role, literalEnglish, notes? }`
- `notes`, `status`, `formatVersion`, `createdAt`, `updatedAt`

### ImportBatch / Inbox / Settings

See `src/domain/types.ts` and `src/domain/schemas.ts` for the authoritative TypeScript definitions.

## Restore modes

- **Merge**: upsert by id; preserve newer analyses; add missing book memberships; merge sentence vocab/source metadata
- **Replace**: clear local tables only after validation succeeds, then load backup (requires explicit confirmation in UI)

## Device note

Backups are the supported way to move data between iPhone and iPad. Local IndexedDB does not sync across devices automatically.
