import type { AnalysisChunk } from '../domain/types';
import { chunksMatchSource } from './chunking';

/** Reviewed boundary moves only; never regenerate an entire saved analysis. */
export const PILOT_CHUNK_REPAIRS = [
  { sentenceId: 'sent_24ed9098', source: 'お母さん鳥は、「そうね」と答えた後、「でもね」と続けました。',
    before: ['答えた後、「でも', 'ね」と'],
    after: [
      { japanese: '答えた後、', role: 'time', literalEnglish: 'after answering' },
      { japanese: '「でもね」と', role: 'と-car', literalEnglish: '“but, you know”, as quoted speech' },
    ] },
  { sentenceId: 'sent_b7b4b892', source: 'ひなは必死に羽ばたいて、なんとか飛ぶことができました。',
    before: ['なんと', 'か飛ぶことが'],
    after: [
      { japanese: 'なんとか', role: 'adverb', literalEnglish: 'somehow' },
      { japanese: '飛ぶことが', role: 'nominalizer + Aが', literalEnglish: 'the act of flying (subject)' },
    ] },
] as const;

export function repairPilotChunks(sentenceId: string, source: string, chunks: AnalysisChunk[]): AnalysisChunk[] | null {
  const repair = PILOT_CHUNK_REPAIRS.find((item) => item.sentenceId === sentenceId && item.source === source);
  if (!repair || !chunksMatchSource(chunks.filter((c) => c.kind !== 'zero_ga').map((c) => c.japanese), source)) return null;
  const positions = chunks.flatMap((chunk, index) =>
    chunk.japanese === repair.before[0] && chunks[index + 1]?.japanese === repair.before[1] ? [index] : []);
  if (positions.length !== 1) return null;
  const at = positions[0]!;
  // Notes may depend on the old span. Leave annotated cases for manual review.
  if (chunks.slice(at, at + 2).some((chunk) => chunk.notes)) return null;
  const next = chunks.map((chunk, index) => index === at || index === at + 1
    ? { ...chunk, ...repair.after[index - at]! } : chunk);
  return chunksMatchSource(next.filter((c) => c.kind !== 'zero_ga').map((c) => c.japanese), source) ? next : null;
}
