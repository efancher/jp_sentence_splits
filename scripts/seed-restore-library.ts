/**
 * Seeds the disposable Postgres harness (the `rlspg` container from
 * `scripts/pg-test.sh`, KEEP=1) with a study library for the real-browser restore
 * measurement. It WIPES that database first, so it only ever touches the local
 * throwaway container, never Supabase. See docs/PERFORMANCE.md.
 *
 * Usage: npx tsx scripts/seed-restore-library.ts small|medium|large
 */
import { libraryRows, librarySeedStatements, RESTORE_SIZES } from '../tests/helpers/librarySeed';
import { resetDatabase, scalar, sql, USER_A } from '../tests/pgIntegration/harness';

const name = process.argv[2] ?? '';
const size = RESTORE_SIZES[name];
if (!size) {
  console.error('Usage: npx tsx scripts/seed-restore-library.ts small|medium|large');
  process.exit(1);
}
resetDatabase();
for (const statement of librarySeedStatements(USER_A, size)) sql(statement);
const reviews = Number(scalar('select count(*) from reviews'));
console.log(`Seeded "${name}": ${libraryRows(size)} rows (${size.sentences} sentences, ${reviews} reviews).`);
