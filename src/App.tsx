import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './layouts/AppShell';
import { useTheme } from './hooks/useTheme';
import { UpdateBanner } from './components/UpdateBanner';

const AnalyzePage = lazy(() =>
  import('./pages/AnalyzePage').then((module) => ({
    default: module.AnalyzePage,
  })),
);
const BookDetailPage = lazy(() =>
  import('./pages/BookDetailPage').then((module) => ({
    default: module.BookDetailPage,
  })),
);
const BooksPage = lazy(() =>
  import('./pages/BooksPage').then((module) => ({
    default: module.BooksPage,
  })),
);
const ImportPage = lazy(() =>
  import('./pages/ImportPage').then((module) => ({
    default: module.ImportPage,
  })),
);
const HelpPage = lazy(() =>
  import('./pages/HelpPage').then((module) => ({
    default: module.HelpPage,
  })),
);
const ImportBatchPage = lazy(() =>
  import('./pages/ImportBatchPage').then((module) => ({
    default: module.ImportBatchPage,
  })),
);
const InboxPage = lazy(() =>
  import('./pages/InboxPage').then((module) => ({
    default: module.InboxPage,
  })),
);
const PracticePage = lazy(() =>
  import('./pages/PracticePage').then((module) => ({
    default: module.PracticePage,
  })),
);
const SearchPage = lazy(() =>
  import('./pages/SearchPage').then((module) => ({
    default: module.SearchPage,
  })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({
    default: module.SettingsPage,
  })),
);

export default function App() {
  useTheme();
  return (
    <HashRouter>
      <UpdateBanner />
      <Suspense fallback={<div className="route-loading">Loading…</div>}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<BooksPage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route
              path="import-batches/:batchId"
              element={<ImportBatchPage />}
            />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="books/:bookId" element={<BookDetailPage />} />
            <Route
              path="books/:bookId/analyze/:sentenceId"
              element={<AnalyzePage />}
            />
            <Route path="books/:bookId/practice" element={<PracticePage />} />
            <Route
              path="books/:bookId/practice/:sentenceId"
              element={<PracticePage />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
