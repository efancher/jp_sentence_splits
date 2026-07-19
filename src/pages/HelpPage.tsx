import { Link } from 'react-router-dom';

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
        <a href="#practice">Practice sessions</a>
        <a href="#backup">Offline data and backups</a>
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
            an existing book.
          </li>
        </ol>
        <p>
          Reimporting the same or a later full export is safe: matching
          sentences and target vocabulary are merged while your analysis,
          status, and book order remain intact.
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
            controls, or an exact position.
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
            Insert spaces in the Japanese copy to define chunks, or apply the
            optional heuristic as a starting point.
          </li>
          <li>
            Give each chunk a role and your own Japanese-order literal “sticky
            English.”
          </li>
          <li>
            Check <strong>Review suggestions</strong> for local tips (missing
            fields, role mismatches, sticky-English alternatives), then mark the
            sentence complete or needs review.
          </li>
        </ol>
        <p>
          Glossbook protects the source sentence: the non-whitespace Japanese
          characters must remain unchanged. Work autosaves locally, and a
          manual Save button remains available.
        </p>
        <p>
          Tap 🔊 to hear the sentence or a chunk using the device's Japanese
          voice, or use <strong>Play by chunks</strong> to hear each chunk in
          order. Configure the voice and speed in Settings.
        </p>
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
      </section>

      <section id="backup" className="panel stack">
        <h3>Offline data, updates, and backups</h3>
        <ul>
          <li>
            Imported study data stays in this browser's IndexedDB and is usable
            offline after the application has loaded successfully.
          </li>
          <li>
            iPhone, iPad, and desktop data do not synchronize automatically.
          </li>
          <li>
            Export a JSON backup regularly from Settings, especially before
            clearing browser data or replacing a device.
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
