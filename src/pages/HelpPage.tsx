import { Link } from 'react-router-dom';

import { RoleGuideContent } from '../lib/roleGuide';

export function HelpPage() {
  return (
    <article className="help-guide stack">
      <section className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>Satori Glossbook guide</h2>
            <p className="muted" style={{ margin: '0.25rem 0 0' }}>
              A local-first workspace for analyzing Satori Reader sentences.
            </p>
          </div>
          <Link to="/settings">
            <button type="button">Back to Settings</button>
          </Link>
        </div>
      </section>

      <nav className="panel help-toc" aria-label="Guide sections">
        <strong>On this page</strong>
        <a href="#getting-started">Getting started</a>
        <a href="#organizing">Books and chapters</a>
        <a href="#analyzing">Analyzing sentences</a>
        <a href="#roles">Chunk roles</a>
        <a href="#practice">Practice sessions</a>
        <a href="#build">Build mode</a>
        <a href="#review">Review (spaced repetition)</a>
        <a href="#sync">Sync and backups</a>
      </nav>

      <section id="getting-started" className="panel stack">
        <h3>Getting started</h3>
        <p>
          For a shadowing project, choose its <code>.shadowing.zip</code> on
          the Import page. Glossbook creates or refreshes one ordered book and
          imports each native sentence clip. No changes to the project are
          required.
        </p>
        <ol>
          <li>
            Export your vocabulary from Satori Reader and save the CSV in
            Files.
          </li>
          <li>
            Open <Link to="/import">Import</Link>, choose the CSV, and review
            the sentence preview.
          </li>
          <li>
            Select all or some sentences and send them to Inbox, a new book, or
            an existing book. For a book destination, you can also put them in
            an existing chapter or create a new chapter during import.
          </li>
        </ol>
        <p>
          Reimporting the same or a later full export is safe: matching
          sentences and target vocabulary are merged while your analysis,
          status, and book order remain intact. Choosing a chapter also assigns
          selected sentences that were already in that book.
        </p>
      </section>

      <section id="organizing" className="panel stack">
        <h3>Books, chapters, Search, and import batches</h3>
        <ul>
          <li>
            In <Link to="/inbox">Inbox</Link>, select sentences and assign them
            to a book.
          </li>
          <li>
            In a book, select sentences to copy or move them, or assign them to
            a chapter.
          </li>
          <li>
            Use <strong>Edit order</strong> for drag-and-drop, directional
            controls, or an exact position. Use <strong>Order from paste</strong>{' '}
            to paste Satori chapter-page text and reorder matching sentences by
            first appearance (unmatched stay at the end).
          </li>
          <li>
            Open an import batch from Inbox to revisit every sentence linked to
            that CSV import.
          </li>
          <li>
            In <Link to="/search">Search</Link>, filter and select all matching
            results to add them to a book or export a worksheet.
          </li>
        </ul>
        <p className="muted">
          Automatic sorting is only a convenience; it does not reconstruct the
          original Satori article order.
        </p>
      </section>

      <section id="analyzing" className="panel stack">
        <h3>Analyzing a sentence</h3>
        <ol>
          <li>
            Open a sentence with <strong>Analyze</strong>.
          </li>
          <li>
            Insert spaces in the Japanese copy to define chunks, or use{' '}
            <strong>Preview heuristic</strong> /{' '}
            <strong>Apply heuristic chunking</strong> as a starting point.
          </li>
          <li>
            Give each chunk a role and your own Japanese-order literal “sticky
            English.” For an invisible が subject, check{' '}
            <strong>Add zero-が (∅) subject</strong> to insert a practice chunk
            you can edit and reorder without changing the source sentence.
          </li>
          <li>
            Check <strong>Review suggestions</strong> for local tips (missing
            fields, role mismatches, sticky-English alternatives), then mark the
            sentence complete or needs review.
          </li>
        </ol>
        <p>
          Glossbook protects the source sentence: the non-whitespace Japanese
          characters must remain unchanged (zero-が chunks are excluded). Work
          autosaves locally, and a manual Save button remains available.
        </p>
        <p>
          Tap 🔊 to hear the sentence or a chunk using the device's Japanese
          voice, or use <strong>Play by chunks</strong> to hear each chunk in
          order. Configure the voice and speed in Settings.
        </p>
        <p>
          When chunks exist, a <strong>puzzle strip</strong> shows role-shaped
          SVG pieces (を sockets, に/で slots, flat-right{' '}
          <strong>engine anchors</strong>, て-bridges) with soft{' '}
          <strong>clause bands</strong>. Neighbor edges nest, and soft green /
          amber outlines hint at likely vs unusual order (heuristic only). Analyze
          includes a small shape key. Hover a piece for a gloss.
        </p>
        <p>
          Below the chunk editor, a <strong>Vocabulary</strong> panel shows
          morphology suggestions for the sentence. Drag a piece into the tray
          to select it (or onto an adjacent selected piece to combine them,
          e.g. やっ onto て → やって), then tap{' '}
          <strong>Confirm vocabulary</strong>. This is what makes a word
          reviewable — see <a href="#review">Review</a> below; a sentence's
          words aren't eligible for vocabulary-based review cards until
          they've been confirmed here at least once.
        </p>
      </section>

      <section id="roles" className="panel stack">
        <h3>Chunk roles</h3>
        <p className="muted" style={{ margin: 0 }}>
          Cure Dolly–style labels for the Analyze role dropdown. The same guide
          is also available under <strong>Role guide</strong> while analyzing.
        </p>
        <RoleGuideContent />
      </section>

      <section id="practice" className="panel stack">
        <h3>Practice sessions</h3>
        <p>
          Start Practice from a book, then choose incomplete, needs-review,
          unstarted, all, or one chapter. You can shuffle, hide vocabulary, and
          reveal chunks, roles, literal English, and Satori English in stages.
        </p>
        <p>
          <strong>Complete &amp; next</strong> and{' '}
          <strong>Needs review &amp; next</strong> update status while moving
          through the session. On a desktop, use the left and right arrow keys.
        </p>
        <p>
          If a sentence has confirmed vocabulary, a{' '}
          <strong>&ldquo;Recognized these without hints?&rdquo;</strong> panel
          appears below the vocab chips — rate a word there if you knew it
          while just reading. Nothing is hidden, so it's a self-report, not a
          test, but it still counts as real evidence toward that word's
          Review schedule.
        </p>
      </section>

      <section id="build" className="panel stack">
        <h3>Build mode</h3>
        <p>
          Invert the glossbook: you see the English prompt and assemble the
          Japanese from shuffled chunk tiles using your saved analysis as the
          answer key. Only sentences with chunks appear in the session.
        </p>
        <ol>
          <li>Start from a book → <strong>Build</strong>.</li>
          <li>Read the English; tap tiles from the bank into your assembly.</li>
          <li>
            Use <strong>More hint</strong> for vocabulary, slot count, sticky
            English, roles/shapes, then Japanese on tiles.
          </li>
          <li>
            <strong>Check</strong> compares your order to Analyze. Reveal shows
            the puzzle strip answer.
          </li>
        </ol>
      </section>

      <section id="review" className="panel stack">
        <h3>Review (spaced repetition)</h3>
        <p>
          Open <Link to="/review">Review</Link> from the nav (every book) or{' '}
          <strong>Review</strong> inside a book (that book only). Rate each
          card <strong>Again</strong> / <strong>Hard</strong> /{' '}
          <strong>Good</strong> / <strong>Easy</strong> — this schedules when
          it comes back, using the FSRS spaced-repetition algorithm.
        </p>
        <p>
          Every sentence gets two baseline cards automatically —{' '}
          <strong>Comprehension</strong> and <strong>Reading in context</strong>{' '}
          (read, reveal translation, rate). One with reference audio also gets
          a <strong>Listening</strong> card (audio plays first, Japanese
          stays hidden until reveal).
        </p>
        <p>
          The rest only appear for a word once you've{' '}
          <strong>confirmed</strong> it in Analyze (see above) — by far the
          most common reason a card type seems to be missing:
        </p>
        <ul>
          <li>
            <strong>Reading retrieval</strong> — word shown, reading hidden.
          </li>
          <li>
            <strong>Cloze</strong> — the word itself is blanked out.
          </li>
          <li>
            <strong>Reading production</strong> — type the reading instead of
            just revealing it.
          </li>
          <li>
            <strong>Sentence transformation</strong> — type a specific
            conjugated form (only for words with a recognized part of
            speech).
          </li>
          <li>
            <strong>Contrastive pair</strong> — two confusable words shown
            together (e.g. 付く/付ける) so you have to distinguish them, not
            just recall one. Rare by design — only a handful of curated
            pairs.
          </li>
        </ul>
        <p>
          Every card has a <strong>Why?</strong> link showing its full
          scheduling state, maturity, and complete review history (including
          anything logged from Practice's natural-encounter panel). Once a
          card's interval passes a threshold (
          <strong>Settings → &ldquo;Graduate after this many days between
          reviews&rdquo;</strong>, default 180 days), it stops being
          quizzed — set that to 0 to disable graduation entirely.{' '}
          <strong>Settings → &ldquo;New cards per review session&rdquo;</strong>{' '}
          caps how many brand-new cards get introduced per sitting;
          already-due reviews are never capped by it.
        </p>
        <p className="muted">
          Fastest way to get more out of Review: keep confirming vocabulary
          in Analyze as you go. If it still looks thin, check whether your
          confirmed words have a part of speech recorded (visible on{' '}
          <Link to="/vocabulary">Words</Link>) — words without one are
          recognized but never get a sentence-transformation card.
        </p>
      </section>

      <section id="sync" className="panel stack">
        <h3>Sync and backups</h3>
        <ul>
          <li>
            Imported study data stays in this browser's IndexedDB and is
            usable offline after the application has loaded successfully.
          </li>
          <li>
            Sign in under <strong>Settings → Account &amp; sync</strong> to
            sync data across an iPhone, iPad, and desktop automatically.
            Without signing in, each device's data stays local to it.
          </li>
          <li>
            Export a JSON backup regularly from Settings regardless — it's
            independent of sync, and the only way to protect against a
            sync-side mistake or move data to a device you don't want to
            sign in on.
          </li>
          <li>
            Merge adds data safely; Replace All should only be used after
            confirming the backup preview.
          </li>
        </ul>
        <p className="muted">
          If an update is available, accept the update banner. If the Home
          Screen icon remains old, remove and add the app to the Home Screen
          again.
        </p>
      </section>
    </article>
  );
}
