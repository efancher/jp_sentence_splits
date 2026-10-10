import { APP_VERSION } from '../appConfig';
import { getDb } from '../db/database';
import type { SentenceAudio, StudyItem } from '../domain/types';

import { getRecentErrors } from './recentErrors';
import { collectReportContext } from './reportContext';
import { decodeAudioBuffer } from './waveform';

const METADATA_TIMEOUT_MS = 1500;

/** What this device's browser reports as the blob's playable length — differs from `durationMs` when the local copy is partial. */
function probeBlobDuration(blob: Blob): Promise<number | string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const done = (value: number | string) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => done('timeout'), METADATA_TIMEOUT_MS);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () =>
      done(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : String(audio.duration));
    audio.onerror = () => done(`error:${audio.error?.code ?? '?'}`);
    audio.src = url;
  });
}

/** Decoded length via the same decodeAudioData path the Adjust editor uses — its end handle can't go past this. */
async function probeDecodedDuration(blob: Blob): Promise<number | string> {
  try {
    return Math.round((await decodeAudioBuffer(blob)).duration * 1000);
  } catch (error) {
    return `error:${error instanceof Error ? error.name : String(error)}`;
  }
}

async function summarizeAudio(audio: SentenceAudio) {
  const blobSize = audio.blob?.size ?? 0;
  return {
    id: audio.id,
    mimeType: audio.mimeType,
    blobType: audio.blob?.type,
    blobSizeBytes: blobSize,
    storedDurationMs: audio.durationMs,
    probedBlobDurationMs: blobSize > 0 ? await probeBlobDuration(audio.blob) : 'no-blob',
    decodedDurationMs: blobSize > 0 ? await probeDecodedDuration(audio.blob) : 'no-blob',
    sourceStartMs: audio.startMs,
    sourceEndMs: audio.endMs,
    trimStartMs: audio.trimStartMs ?? null,
    trimEndMs: audio.trimEndMs ?? null,
    importedAt: audio.importedAt,
    sourceId: audio.sourceId,
  };
}

export async function summarizeSentenceAudio(sentenceId: string) {
  const rows = await getDb().sentenceAudio.where('sentenceId').equals(sentenceId).toArray();
  return Promise.all(rows.map(summarizeAudio));
}

/** JSON snapshot attached to a card issue report so audio/playback complaints can be triaged without the reporter's device. */
export async function buildCardReportDiagnostics(studyItem: StudyItem, sentenceId: string): Promise<string> {
  return JSON.stringify(
    {
      kind: 'card_report',
      appVersion: APP_VERSION,
      buildId: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'unknown',
      studyItem: {
        id: studyItem.id,
        subjectType: studyItem.subjectType,
        subjectId: studyItem.subjectId,
        activityType: studyItem.activityType,
      },
      sentenceId,
      sentenceAudio: await summarizeSentenceAudio(sentenceId),
      online: navigator.onLine,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      userAgent: navigator.userAgent,
      recentErrors: getRecentErrors(),
      context: collectReportContext(),
      capturedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}
