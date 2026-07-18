import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './layouts/AppShell';
import { AnalyzePage } from './pages/AnalyzePage';
import { BookDetailPage } from './pages/BookDetailPage';
import { BooksPage } from './pages/BooksPage';
import { ImportPage } from './pages/ImportPage';
import { InboxPage } from './pages/InboxPage';
import { PracticePage } from './pages/PracticePage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { useTheme } from './hooks/useTheme';
import { UpdateBanner } from './components/UpdateBanner';

export default function App() {
  useTheme();
  return (
    <HashRouter>
      <UpdateBanner />
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<BooksPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="books/:bookId" element={<BookDetailPage />} />
          <Route path="books/:bookId/analyze/:sentenceId" element={<AnalyzePage />} />
          <Route path="books/:bookId/practice" element={<PracticePage />} />
          <Route
            path="books/:bookId/practice/:sentenceId"
            element={<PracticePage />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
