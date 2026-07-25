/**
 * Export confirmed vocabulary selections + native audio as an Anki mining ZIP.
 *
 * Format: japanese-shadowing-mining-package v1
 * Only sentences with vocabularyReviewStatus === 'confirmed' are included.
 */

import { zipSync, strToU8 } from 'fflate';

import { APP_VERSION } from '../appConfig';
import type {
  Book,
  Sentence,
  SentenceAnalysis,
  SentenceAudio,
  VocabularySelection,
} from '../domain/types';
import { validateSpan } from './vocabularySuggestions';

export const MINING_PACKAGE_FORMAT = 'japanese-shadowing-mining-package';
export const MINING_PACKAGE_VERSION = 1;

export interface MiningSelectedVocabulary {
  surface: string;
  start: number;
  end: number;
  expression: string;
  reading: string;
  english?: string;
  pos?: string;
}

export interface MiningPackageSentence {
  id: string;
  japanese: string;
  reading?: string;
  english?: string;
  startMs: number;
  endMs: number;
  transcriptStatus: 'verified';
  tags: string[];
  notes?: string;
  audio: {
    path: string;
    mimeType: string;
    durationMs: number;
  };
  selectedVocabulary: MiningSelectedVocabulary[];
}

export interface MiningPackageDocument {
  manifest: {
    format: typeof MINING_PACKAGE_FORMAT;
    version: typeof MINING_PACKAGE_VERSION;
    createdAt: string;
    generator: { name: string; version: string };
  };
  source: {
    id: string;
    type: 'other';
    title: string;
    url?: string;
    channel?: string;
  };
  sentences: MiningPackageSentence[];
}

export interface MiningExportInput {
  book: Book;
  sentences: Sentence[];
  analyses: SentenceAnalysis[];
  audio: SentenceAudio[];
}

export interface MiningExportResult {
  blob: Blob;
  filename: string;
  sentenceCount: number;
  selectionCount: number;
  skippedUnconfirmed: number;
}

function selectionToMining(
  japanese: string,
  selection: VocabularySelection,
): MiningSelectedVocabulary {
  if (!validateSpan(japanese, selection.start, selection.end, selection.surface)) {
    throw new Error(
      `Selection "${selection.expression}" span does not match sentence text.`,
    );
  }
  if (!selection.expression.trim()) {
    throw new Error('Selection is missing a dictionary expression.');
  }
  return {
    surface: selection.surface,
    start: selection.start,
    end: selection.end,
    expression: selection.expression.trim(),
    reading: selection.reading.trim(),
    english: selection.english?.trim() || undefined,
    pos: selection.pos?.trim() || undefined,
  };
}

function mimeExtension(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('aac')) return 'aac';
  return 'm4a';
}

export async function buildMiningPackage(
  input: MiningExportInput,
): Promise<MiningExportResult> {
  const analysisBySentence = new Map(
    input.analyses.map((item) => [item.sentenceId, item]),
  );
  const sentenceById = new Map(input.sentences.map((item) => [item.id, item]));

  const confirmedSentenceIds = new Set(
    input.analyses
      .filter((item) => item.vocabularyReviewStatus === 'confirmed')
      .map((item) => item.sentenceId),
  );

  const audioForConfirmed = input.audio
    .filter((item) => confirmedSentenceIds.has(item.sentenceId))
    .sort((a, b) => a.startMs - b.startMs);

  const skippedUnconfirmed = input.sentences.filter(
    (sentence) => !confirmedSentenceIds.has(sentence.id),
  ).length;

  if (!audioForConfirmed.length) {
    throw new Error(
      'No confirmed vocabulary sentences with native audio to export. Confirm vocabulary on Analyze first.',
    );
  }

  const sourceId =
    input.book.sourceKey?.startsWith('shadowing:')
      ? input.book.sourceKey.slice('shadowing:'.length)
      : input.book.id;

  const files: Record<string, Uint8Array> = {};
  const packageSentences: MiningPackageSentence[] = [];
  let selectionCount = 0;
  let index = 0;

  for (const audio of audioForConfirmed) {
    const sentence = sentenceById.get(audio.sentenceId);
    const analysis = analysisBySentence.get(audio.sentenceId);
    if (!sentence || !analysis) continue;

    const selectedVocabulary = (analysis.vocabularySelections ?? []).map(
      (selection) => selectionToMining(sentence.japanese, selection),
    );
    selectionCount += selectedVocabulary.length;
    index += 1;
    const ext = mimeExtension(audio.mimeType);
    const audioName = `sentence-${String(index).padStart(3, '0')}.${ext}`;
    const audioPath = `audio/${audioName}`;
    const bytes = new Uint8Array(await audio.blob.arrayBuffer());
    files[audioPath] = bytes;

    packageSentences.push({
      id: audio.sourceSentenceId || `glossbook-${sentence.id}-${index}`,
      japanese: sentence.japanese,
      reading: sentence.readingOnly || undefined,
      english: sentence.translation || undefined,
      startMs: audio.startMs,
      endMs: audio.endMs,
      transcriptStatus: 'verified',
      tags: ['glossbook-confirmed'],
      notes: analysis.notes || undefined,
      audio: {
        path: audioPath,
        mimeType: audio.mimeType,
        durationMs: Math.max(1, audio.durationMs || audio.endMs - audio.startMs),
      },
      selectedVocabulary,
    });
  }

  const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const document: MiningPackageDocument = {
    manifest: {
      format: MINING_PACKAGE_FORMAT,
      version: MINING_PACKAGE_VERSION,
      createdAt,
      generator: { name: 'satori-glossbook', version: APP_VERSION },
    },
    source: {
      id: sourceId,
      type: 'other',
      title: input.book.title,
      url: input.book.sourceUrl,
      channel: input.book.subtitle,
    },
    sentences: packageSentences,
  };

  files['manifest.json'] = strToU8(
    `${JSON.stringify(document.manifest, null, 2)}\n`,
  );
  files['source.json'] = strToU8(
    `${JSON.stringify(document.source, null, 2)}\n`,
  );
  files['sentences.json'] = strToU8(
    `${JSON.stringify(document.sentences, null, 2)}\n`,
  );

  const zipped = zipSync(files, { level: 6 });
  const safeTitle = input.book.title.replace(/[^\w\-]+/g, '_').slice(0, 60);
  return {
    blob: new Blob([zipped.slice().buffer as ArrayBuffer], {
      type: 'application/zip',
    }),
    filename: `${safeTitle || 'shadowing'}.mining.zip`,
    sentenceCount: packageSentences.length,
    selectionCount,
    skippedUnconfirmed,
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
