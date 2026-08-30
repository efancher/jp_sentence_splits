/**
 * Read-only: for each book, how many of its study_items (vocab + sentence)
 * are currently due, graduated, or scheduled into the future — to answer
 * "why am I only seeing review cards from the new book?"
 *
 * Usage: npx tsx scripts/analyze-due-by-book.ts
 */
import { createScriptSupabaseClient } from './lib/scriptSupabaseClient';

async function fetchAll(supabase: any, table: string, columns: string) {
  const rows: any[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .is('deleted_at', null)
      .range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < page) break;
    from += page;
  }
  return rows;
}

async function main() {
  const supabase = await createScriptSupabaseClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const [books, bookSentences, sentenceVocab, studyItems, reviews] = await Promise.all([
    fetchAll(supabase, 'books', 'id, title'),
    fetchAll(supabase, 'book_sentences', 'book_id, sentence_id'),
    fetchAll(supabase, 'sentence_vocabulary', 'sentence_id, vocabulary_item_id'),
    fetchAll(supabase, 'study_items', 'id, subject_type, subject_id, activity_type, fsrs_state'),
    fetchAll(supabase, 'reviews', 'study_item_id, timestamp'),
  ]);

  const bookTitle = new Map(books.map((b) => [b.id, b.title]));

  // sentence -> set(bookId)
  const sentenceBooks = new Map<string, Set<string>>();
  for (const bs of bookSentences) {
    if (!sentenceBooks.has(bs.sentence_id)) sentenceBooks.set(bs.sentence_id, new Set());
    sentenceBooks.get(bs.sentence_id)!.add(bs.book_id);
  }
  // vocab -> set(bookId) via any sentence it appears in
  const vocabBooks = new Map<string, Set<string>>();
  for (const sv of sentenceVocab) {
    const bset = sentenceBooks.get(sv.sentence_id);
    if (!bset) continue;
    if (!vocabBooks.has(sv.vocabulary_item_id)) vocabBooks.set(sv.vocabulary_item_id, new Set());
    for (const b of bset) vocabBooks.get(sv.vocabulary_item_id)!.add(b);
  }

  const lastReviewByItem = new Map<string, string>();
  for (const r of reviews) {
    const cur = lastReviewByItem.get(r.study_item_id);
    if (!cur || r.timestamp > cur) lastReviewByItem.set(r.study_item_id, r.timestamp);
  }

  type Bucket = {
    total: number;
    due: number;
    dueToday: number; // due and last reviewed today (short-step churn)
    future1d: number; // due within next day
    futureWeek: number;
    futureMonth: number;
    futureLonger: number;
    graduated: number; // review state, scheduledDays >= 180
    neverReviewed: number;
    states: Record<string, number>;
  };
  const fresh = (): Bucket => ({
    total: 0, due: 0, dueToday: 0, future1d: 0, futureWeek: 0, futureMonth: 0,
    futureLonger: 0, graduated: 0, neverReviewed: 0, states: {},
  });
  const byBook = new Map<string, Bucket>();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);

  let unlinked = 0;
  let unlinkedVocabDue = 0;
  const unlinkedByType: Record<string, number> = {};
  for (const si of studyItems) {
    let bookIds: Set<string> | undefined;
    if (si.subject_type === 'sentence') bookIds = sentenceBooks.get(si.subject_id);
    else if (si.subject_type === 'vocabularyItem') bookIds = vocabBooks.get(si.subject_id);
    if (!bookIds || bookIds.size === 0) {
      unlinked += 1;
      unlinkedByType[si.subject_type] = (unlinkedByType[si.subject_type] ?? 0) + 1;
      if (si.subject_type === 'vocabularyItem') {
        const d: string = (si.fsrs_state ?? {}).due ?? nowIso;
        if (d <= nowIso) unlinkedVocabDue += 1;
      }
      continue;
    }

    const fs = si.fsrs_state ?? {};
    const due: string = fs.due ?? nowIso;
    const scheduledDays: number = fs.scheduled_days ?? fs.scheduledDays ?? 0;
    const state: string = fs.state ?? 'new';
    const isDue = due <= nowIso;
    const graduated = state === 'review' && scheduledDays >= 180;
    const lastRev = lastReviewByItem.get(si.id);
    const dueDate = new Date(due);

    for (const bId of bookIds) {
      if (!byBook.has(bId)) byBook.set(bId, fresh());
      const bk = byBook.get(bId)!;
      bk.total += 1;
      bk.states[state] = (bk.states[state] ?? 0) + 1;
      if (!lastRev) bk.neverReviewed += 1;
      if (graduated) { bk.graduated += 1; continue; }
      if (isDue) {
        bk.due += 1;
        if (lastRev && lastRev >= startOfToday.toISOString()) bk.dueToday += 1;
      } else {
        const diffDays = (dueDate.getTime() - now.getTime()) / 86400000;
        if (diffDays <= 1) bk.future1d += 1;
        else if (diffDays <= 7) bk.futureWeek += 1;
        else if (diffDays <= 31) bk.futureMonth += 1;
        else bk.futureLonger += 1;
      }
    }
  }

  const sorted = [...byBook.entries()].sort((a, b) => b[1].due - a[1].due);
  console.log(`now = ${nowIso}`);
  console.log(`study_items total = ${studyItems.length}, unlinked to any book = ${unlinked}`);
  console.log(`  unlinked by subject_type = ${JSON.stringify(unlinkedByType)}  (unlinked vocab due now = ${unlinkedVocabDue})\n`);
  for (const [bId, bk] of sorted) {
    console.log(`## ${bookTitle.get(bId) ?? bId}`);
    console.log(
      `   total=${bk.total}  DUE=${bk.due} (reviewed-today=${bk.dueToday})  graduated=${bk.graduated}  neverReviewed=${bk.neverReviewed}`,
    );
    console.log(
      `   not-yet-due: <1d=${bk.future1d}  <1wk=${bk.futureWeek}  <1mo=${bk.futureMonth}  >1mo=${bk.futureLonger}`,
    );
    console.log(`   states: ${JSON.stringify(bk.states)}\n`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
