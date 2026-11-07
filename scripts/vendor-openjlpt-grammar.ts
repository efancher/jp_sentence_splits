/**
 * Regenerates src/data/openJlptGrammar.json: a trimmed copy (id, pattern, level, formation) of OpenJLPT's grammar
 * dataset, https://github.com/evanclan/OpenJLPT (CC BY-SA 4.0), so i+1 grammar ranking works offline.
 * Examples, meanings and other fields are deliberately not copied. Share-alike applies to that JSON file only.
 *
 * Usage: npm run vendor:openjlpt-grammar
 */
import { writeFileSync } from 'node:fs';

import type { ReferencePattern } from '../src/lib/grammarReference';

const LEVELS = ['n5', 'n4', 'n3', 'n2', 'n1'];
const BASE = 'https://raw.githubusercontent.com/evanclan/OpenJLPT/main/data/json/grammar';
const OUT = new URL('../src/data/openJlptGrammar.json', import.meta.url);

async function main(): Promise<void> {
  const patterns: ReferencePattern[] = [];
  for (const level of LEVELS) {
    const response = await fetch(`${BASE}/${level}.json`);
    if (!response.ok) throw new Error(`Failed to fetch ${level}: ${response.status}`);
    const parsed: unknown = await response.json();
    const items = (Array.isArray(parsed) ? parsed : Object.values(parsed as object).find(Array.isArray)) as ReferencePattern[];
    for (const item of items) {
      patterns.push({ id: item.id, pattern: item.pattern, level: item.level, formation: item.formation });
    }
  }
  const file = {
    source: 'https://github.com/evanclan/OpenJLPT',
    license: 'CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)',
    attribution: 'Grammar patterns and JLPT levels from OpenJLPT by evanclan, trimmed to id/pattern/level/formation.',
    generatedAt: new Date().toISOString().slice(0, 10),
    patterns,
  };
  writeFileSync(OUT, `${JSON.stringify(file, null, 1)}\n`);
  console.log(`wrote ${patterns.length} patterns`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
