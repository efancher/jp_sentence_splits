/**
 * Offline feasibility probe for Remix: reads JSON dumps (sentences + vocabulary
 * items, as produced by `npm run db:query`) and reports how many sentences have
 * a skeleton, how big the noun pool is, and how many sentences can build a
 * puzzle. Usage: tsx scripts/remix-feasibility.ts <sentences.json>... -- <vocab.json>
 */
import { readFileSync } from 'node:fs';

import type { Sentence, VocabularyItem } from '../src/domain/types';
import { buildRemixNounPool, buildRemixPuzzle, findRemixSkeleton } from '../src/lib/remix';

const args = process.argv.slice(2);
const split = args.indexOf('--');
const sentenceFiles = args.slice(0, split);
const vocabFile = args[split + 1]!;

const sentences: Pick<Sentence, 'id' | 'japanese' | 'translation' | 'vocabularySuggestions'>[] = sentenceFiles
  .flatMap((file) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[])
  .map((row) => ({
    id: String(row.id),
    japanese: String(row.japanese),
    translation: String(row.translation ?? ''),
    vocabularySuggestions: (row.vocabulary_suggestions ?? []) as Sentence['vocabularySuggestions'],
  }));
const items = (JSON.parse(readFileSync(vocabFile, 'utf8')) as Record<string, string>[]).map(
  (row) =>
    ({
      id: row.id,
      expression: row.expression,
      reading: row.reading,
      meaning: row.meaning,
      partOfSpeech: row.part_of_speech,
    }) as VocabularyItem,
);

const pool = buildRemixNounPool(items);
const withSkeleton = sentences.filter((s) => findRemixSkeleton(s));
const buildable = withSkeleton.filter((s) => buildRemixPuzzle(s, pool, 'probe'));
console.log(`vocab items ${items.length}, usable swap nouns ${pool.length}`);
console.log(`sentences ${sentences.length}, with skeleton ${withSkeleton.length}, buildable ${buildable.length}`);
for (const sentence of withSkeleton.slice(0, 15)) {
  const skeleton = findRemixSkeleton(sentence)!;
  console.log(
    sentence.japanese,
    '→',
    skeleton.slots.map((slot) => `[${slot.noun}]${slot.particle}${slot.gloss ? `(${slot.gloss})` : ''}`).join(' '),
    skeleton.verbText,
  );
}
console.log('sample pool:', pool.slice(0, 12).map((n) => `${n.expression}=${n.gloss}`).join(', '));
