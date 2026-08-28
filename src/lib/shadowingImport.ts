import { strFromU8, unzip } from 'fflate';
import { z } from 'zod';

import type {
  ParsedSentenceDraft,
  SourceConflict,
  SourceReference,
} from '../domain/types';
import { sentenceIdFromNormalizedKey } from './ids';
import {
  type ExistingSentenceLookup,
  type ImportPreview,
  type ImportPreviewSentence,
} from './csvImport';
import {
  displayJapanese,
  normalizeSentenceKey,
} from './normalize';
import { inlineReadingFromTokens } from './inlineReadingFromTokens';
import { suggestionsFromTokens } from './vocabularySuggestions';

const SHADOWING_PACKAGE_FORMAT = 'japanese-shadowing-package';
const PREVIEW_IMPORT_BATCH_ID = 'preview';
const MAX_METADATA_FILE_BYTES = 5 * 1024 * 1024;
const REQUIRED_METADATA_PATHS = [
  'manifest.json',
  'source.json',
  'sentences.json',
] as const;

const manifestSchema = z.object({
  format: z.literal(SHADOWING_PACKAGE_FORMAT),
  version: z.union([z.literal(1), z.literal(2)]),
  createdAt: z.string(),
  generator: z.object({
    name: z.string(),
    version: z.string(),
  }),
});

const sourceSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'youtube',
    'uploaded-video',
    'uploaded-audio',
    'podcast',
    'manual',
    'other',
  ]),
  url: z.string().optional(),
  videoId: z.string().optional(),
  title: z.string().min(1),
  channel: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
});

const packageTokenSchema = z.object({
  surface: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  lemma: z.string().min(1),
  reading: z.string().optional(),
  pos: z.string().optional(),
});

const packageSentenceSchema = z.object({
  id: z.string().min(1),
  japanese: z.string().min(1),
  reading: z.string().optional(),
  english: z.string().optional(),
  startMs: z.number().nonnegative(),
  endMs: z.number().positive(),
  subtitleStartMs: z.number().nonnegative().optional(),
  subtitleEndMs: z.number().nonnegative().optional(),
  adjustedStartMs: z.number().nonnegative().optional(),
  adjustedEndMs: z.number().nonnegative().optional(),
  speaker: z.string().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  transcriptStatus: z.enum([
    'unverified',
    'auto-caption',
    'manually-corrected',
    'verified',
  ]),
  tokens: z.array(packageTokenSchema).optional(),
  audio: z.object({
    path: z.string().min(1),
    mimeType: z.string().min(1),
    durationMs: z.number().positive(),
  }),
});

const sentencesSchema = z.array(packageSentenceSchema).min(1);

type ShadowingManifest = z.infer<typeof manifestSchema>;
type ShadowingSource = z.infer<typeof sourceSchema>;
type ShadowingPackageSentence = z.infer<typeof packageSentenceSchema>;

/**
 * The subset of a package sentence that preview-building actually reads.
 * `buildDrafts` doesn't touch `audio` — narrowing the parameter to this
 * type lets callers that never had a zip's `audio` entry (e.g. the
 * YouTube-mining flow in src/pages/YouTubeMinePage.tsx, which clips audio
 * per-sentence directly from a server job rather than unzipping a
 * package) build a preview without inventing a fake one.
 */
export type ShadowingSentenceInput = Pick<
  ShadowingPackageSentence,
  | 'id'
  | 'japanese'
  | 'reading'
  | 'english'
  | 'startMs'
  | 'endMs'
  | 'speaker'
  | 'tags'
  | 'notes'
  | 'transcriptStatus'
  | 'tokens'
>;

export interface ShadowingAudioDraft {
  sourceSentenceId: string;
  normalizedKey: string;
  path: string;
  mimeType: string;
  durationMs: number;
  startMs: number;
  endMs: number;
  blob: Blob;
}

export interface ShadowingImportPreview extends ImportPreview {
  source: ShadowingSource;
  manifest: ShadowingManifest;
  audioDrafts: ShadowingAudioDraft[];
  audioBytes: number;
  repeatedOccurrenceCount: number;
}

function isSafeZipPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return (
    Boolean(normalized) &&
    !normalized.startsWith('/') &&
    !normalized.split('/').includes('..')
  );
}

function unzipSelected(
  bytes: Uint8Array,
  wanted: ReadonlySet<string>,
): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    let unsafePath: string | undefined;
    unzip(
      bytes,
      {
        filter: (entry) => {
          if (!isSafeZipPath(entry.name)) {
            unsafePath ??= entry.name;
            return false;
          }
          if (
            wanted.has(entry.name) &&
            REQUIRED_METADATA_PATHS.includes(
              entry.name as (typeof REQUIRED_METADATA_PATHS)[number],
            ) &&
            entry.originalSize > MAX_METADATA_FILE_BYTES
          ) {
            throw new Error(`Package metadata file is too large: ${entry.name}`);
          }
          return wanted.has(entry.name);
        },
      },
      (error, files) => {
        if (error) {
          reject(error);
          return;
        }
        if (unsafePath) {
          reject(new Error(`Unsafe path in package: ${unsafePath}`));
          return;
        }
        resolve(files);
      },
    );
  });
}

function parseJsonFile(
  files: Record<string, Uint8Array>,
  path: string,
): unknown {
  const bytes = files[path];
  if (!bytes) throw new Error(`Shadowing package is missing ${path}.`);
  try {
    return JSON.parse(strFromU8(bytes)) as unknown;
  } catch {
    throw new Error(`Shadowing package contains invalid JSON in ${path}.`);
  }
}

function describeSourceReference(
  source: ShadowingSource,
  sentence: ShadowingSentenceInput,
): string {
  const details = [
    `Shadowing project: ${source.title}`,
    `Video position: ${(sentence.startMs / 1000).toFixed(3)}–${(
      sentence.endMs / 1000
    ).toFixed(3)} seconds`,
    sentence.speaker ? `Speaker: ${sentence.speaker}` : '',
    sentence.tags.length ? `Tags: ${sentence.tags.join(', ')}` : '',
    sentence.notes ? `Notes: ${sentence.notes}` : '',
    `Transcript status: ${sentence.transcriptStatus}`,
  ];
  return details.filter(Boolean).join('\n');
}

function addConflict(
  conflicts: SourceConflict[],
  field: SourceConflict['field'],
  preferred: string,
  alternative: string,
): SourceConflict[] {
  if (!alternative || alternative === preferred) return conflicts;
  const existing = conflicts.find((item) => item.field === field);
  if (!existing) {
    return [...conflicts, { field, preferred, alternatives: [alternative] }];
  }
  if (
    existing.preferred === alternative ||
    existing.alternatives.includes(alternative)
  ) {
    return conflicts;
  }
  return conflicts.map((item) =>
    item === existing
      ? { ...item, alternatives: [...item.alternatives, alternative] }
      : item,
  );
}

function sourceReference(
  source: ShadowingSource,
  sentence: ShadowingSentenceInput,
): SourceReference {
  return {
    cardId: `${source.id}:${sentence.id}`,
    cardType: 'SHADOWING',
    contextNumber: 1,
    userNotes: describeSourceReference(source, sentence),
    importBatchId: PREVIEW_IMPORT_BATCH_ID,
  };
}

function buildDrafts(
  source: ShadowingSource,
  sentences: ShadowingSentenceInput[],
): {
  drafts: ParsedSentenceDraft[];
  repeatedOccurrenceCount: number;
} {
  const byKey = new Map<string, ParsedSentenceDraft>();
  // Timeline ordering: earliest clip start wins, with array index as a stable
  // tiebreaker so equal timestamps keep the package's original sequence.
  const orderMeta = new Map<string, { startMs: number; index: number }>();
  let repeatedOccurrenceCount = 0;

  sentences.forEach((sentence, index) => {
    const japanese = displayJapanese(sentence.japanese);
    const normalizedKey = normalizeSentenceKey(japanese);
    if (!normalizedKey) return;
    const ref = sourceReference(source, sentence);
    const current = byKey.get(normalizedKey);
    if (!current) {
      byKey.set(normalizedKey, {
        normalizedKey,
        japanese,
        readingOnly: sentence.reading?.trim() ?? '',
        inlineReading: inlineReadingFromTokens(japanese, sentence.tokens ?? []),
        translation: sentence.english?.trim() ?? '',
        targetVocabulary: [],
        vocabularySuggestions: suggestionsFromTokens(
          japanese,
          sentence.tokens ?? [],
        ),
        sourceReferences: [ref],
        conflicts: [],
        firstOccurrenceIndex: index,
      });
      orderMeta.set(normalizedKey, { startMs: sentence.startMs, index });
      return;
    }

    repeatedOccurrenceCount += 1;
    let conflicts = current.conflicts;
    conflicts = addConflict(
      conflicts,
      'translation',
      current.translation,
      sentence.english?.trim() ?? '',
    );
    conflicts = addConflict(
      conflicts,
      'readingOnly',
      current.readingOnly,
      sentence.reading?.trim() ?? '',
    );
    current.translation ||= sentence.english?.trim() ?? '';
    current.readingOnly ||= sentence.reading?.trim() ?? '';
    current.conflicts = conflicts;
    current.sourceReferences.push(ref);
    if (sentence.tokens?.length) {
      current.vocabularySuggestions = suggestionsFromTokens(
        japanese,
        sentence.tokens,
      );
      current.inlineReading ||= inlineReadingFromTokens(japanese, sentence.tokens);
    }

    const meta = orderMeta.get(normalizedKey);
    if (meta && sentence.startMs < meta.startMs) {
      meta.startMs = sentence.startMs;
    }
  });

  const orderedKeys = [...byKey.keys()].sort((a, b) => {
    const metaA = orderMeta.get(a)!;
    const metaB = orderMeta.get(b)!;
    if (metaA.startMs !== metaB.startMs) return metaA.startMs - metaB.startMs;
    return metaA.index - metaB.index;
  });

  // Reassign firstOccurrenceIndex to the timeline rank so downstream ordering
  // (first_occurrence) and the book reorder agree on package/video order.
  const drafts = orderedKeys.map((key, rank) => {
    const draft = byKey.get(key)!;
    draft.firstOccurrenceIndex = rank;
    return draft;
  });

  return {
    drafts,
    repeatedOccurrenceCount,
  };
}

function toPreviewSentences(
  drafts: ParsedSentenceDraft[],
  existing: ExistingSentenceLookup[],
): ImportPreviewSentence[] {
  const existingByKey = new Map(
    existing.map((sentence) => [sentence.normalizedKey, sentence]),
  );
  return drafts.map((draft) => {
    const current = existingByKey.get(draft.normalizedKey);
    const hasNewReference = draft.sourceReferences.some(
      (next) =>
        !current?.sourceReferences.some(
          (ref) =>
            ref.cardId === next.cardId &&
            ref.cardType === next.cardType &&
            ref.contextNumber === next.contextNumber,
        ),
    );
    const willUpdate = Boolean(
      current &&
        (hasNewReference ||
          (!current.translation && draft.translation) ||
          (!current.readingOnly && draft.readingOnly) ||
          draft.conflicts.length),
    );
    return {
      draft,
      proposedId:
        current?.id ?? sentenceIdFromNormalizedKey(draft.normalizedKey),
      isNew: !current,
      willUpdate,
      selected: true,
    };
  });
}

export async function parseShadowingPackage(
  file: File,
  existing: ExistingSentenceLookup[] = [],
): Promise<ShadowingImportPreview> {
  const archiveBytes = new Uint8Array(await file.arrayBuffer());
  const metadataPaths = new Set<string>(REQUIRED_METADATA_PATHS);
  const metadata = await unzipSelected(archiveBytes, metadataPaths);

  const manifestResult = manifestSchema.safeParse(
    parseJsonFile(metadata, 'manifest.json'),
  );
  if (!manifestResult.success) {
    throw new Error(
      `Unsupported shadowing package manifest: ${manifestResult.error.issues[0]?.message ?? 'invalid manifest'}`,
    );
  }
  const sourceResult = sourceSchema.safeParse(
    parseJsonFile(metadata, 'source.json'),
  );
  if (!sourceResult.success) {
    throw new Error(
      `Invalid shadowing source: ${sourceResult.error.issues[0]?.message ?? 'invalid source'}`,
    );
  }
  const sentencesResult = sentencesSchema.safeParse(
    parseJsonFile(metadata, 'sentences.json'),
  );
  if (!sentencesResult.success) {
    throw new Error(
      `Invalid shadowing sentences: ${sentencesResult.error.issues[0]?.message ?? 'invalid sentences'}`,
    );
  }

  const manifest = manifestResult.data;
  const source = sourceResult.data;
  const sentences = sentencesResult.data;
  for (const sentence of sentences) {
    if (sentence.endMs <= sentence.startMs) {
      throw new Error(`Sentence ${sentence.id} has invalid timestamps.`);
    }
    if (
      !isSafeZipPath(sentence.audio.path) ||
      !sentence.audio.path.startsWith('audio/')
    ) {
      throw new Error(`Invalid audio path: ${sentence.audio.path}`);
    }
  }

  const audioPaths = new Set(sentences.map((sentence) => sentence.audio.path));
  const audioFiles = await unzipSelected(archiveBytes, audioPaths);
  const audioDrafts: ShadowingAudioDraft[] = sentences.map((sentence) => {
    const bytes = audioFiles[sentence.audio.path];
    if (!bytes) {
      throw new Error(
        `Shadowing package is missing ${sentence.audio.path}.`,
      );
    }
    return {
      sourceSentenceId: sentence.id,
      normalizedKey: normalizeSentenceKey(sentence.japanese),
      path: sentence.audio.path,
      mimeType: sentence.audio.mimeType,
      durationMs: sentence.audio.durationMs,
      startMs: sentence.startMs,
      endMs: sentence.endMs,
      blob: new Blob([bytes.slice().buffer as ArrayBuffer], {
        type: sentence.audio.mimeType,
      }),
    };
  });

  return {
    ...buildShadowingPreview(source, manifest, sentences, audioDrafts, existing),
    filename: file.name,
  };
}

/**
 * Build a ShadowingImportPreview directly from already-known sentences +
 * audio clips, without a `.shadowing.zip` — used by the YouTube-mining
 * flow (src/pages/YouTubeMinePage.tsx), which gets sentences/clips one at
 * a time from a mining-job server rather than unzipping a package.
 * `parseShadowingPackage` above is a thin wrapper over this for the
 * zip-upload path.
 */
export function buildShadowingPreview(
  source: ShadowingSource,
  manifest: ShadowingManifest,
  sentences: ShadowingSentenceInput[],
  audioDrafts: ShadowingAudioDraft[],
  existing: ExistingSentenceLookup[] = [],
): ShadowingImportPreview {
  const { drafts, repeatedOccurrenceCount } = buildDrafts(source, sentences);
  const previewSentences = toPreviewSentences(drafts, existing);
  const conflictCount = drafts.reduce(
    (total, draft) => total + draft.conflicts.length,
    0,
  );
  const warnings = [];
  if (repeatedOccurrenceCount) {
    warnings.push({
      message: `${repeatedOccurrenceCount} repeated sentence occurrence(s) share one Glossbook sentence; their audio clips are all retained.`,
    });
  }
  if (conflictCount) {
    warnings.push({
      message: `${conflictCount} conflicting translation/reading value(s) found.`,
    });
  }

  return {
    filename: `${source.title}.shadowing.zip`,
    batchName: source.title,
    totalRows: sentences.length,
    drafts: previewSentences,
    counts: {
      totalRows: sentences.length,
      contextOccurrences: sentences.length,
      uniqueSentences: drafts.length,
      newSentences: previewSentences.filter((item) => item.isNew).length,
      updatedSentences: previewSentences.filter((item) => item.willUpdate)
        .length,
      exactDuplicatesIgnored: repeatedOccurrenceCount,
      newVocabularyAssociations: 0,
      rowsSkipped: 0,
      warningCount: warnings.length,
      conflictCount,
    },
    warnings,
    source,
    manifest,
    audioDrafts,
    audioBytes: audioDrafts.reduce(
      (total, audio) => total + audio.blob.size,
      0,
    ),
    repeatedOccurrenceCount,
  };
}
