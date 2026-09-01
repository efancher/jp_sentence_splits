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
const HomePage = lazy(() =>
  import('./pages/HomePage').then((module) => ({
    default: module.HomePage,
  })),
);
const SessionRunnerPage = lazy(() =>
  import('./pages/SessionRunnerPage').then((module) => ({
    default: module.SessionRunnerPage,
  })),
);
const ImportPage = lazy(() =>
  import('./pages/ImportPage').then((module) => ({
    default: module.ImportPage,
  })),
);
const YouTubeMinePage = lazy(() =>
  import('./pages/YouTubeMinePage').then((module) => ({
    default: module.YouTubeMinePage,
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
const ReviewPage = lazy(() =>
  import('./pages/ReviewPage').then((module) => ({
    default: module.ReviewPage,
  })),
);
const BuildPage = lazy(() =>
  import('./pages/BuildPage').then((module) => ({
    default: module.BuildPage,
  })),
);
const CardIssuesPage = lazy(() =>
  import('./pages/CardIssuesPage').then((module) => ({
    default: module.CardIssuesPage,
  })),
);
const ResegmentSourcePage = lazy(() =>
  import('./pages/ResegmentSourcePage').then((module) => ({
    default: module.ResegmentSourcePage,
  })),
);
const SearchPage = lazy(() =>
  import('./pages/SearchPage').then((module) => ({
    default: module.SearchPage,
  })),
);
const ShadowPage = lazy(() =>
  import('./pages/ShadowPage').then((module) => ({
    default: module.ShadowPage,
  })),
);
const VocabularyListPage = lazy(() =>
  import('./pages/VocabularyListPage').then((module) => ({
    default: module.VocabularyListPage,
  })),
);
const VocabularyReviewPage = lazy(() =>
  import('./pages/VocabularyReviewPage').then((module) => ({
    default: module.VocabularyReviewPage,
  })),
);
const KanjiDetailPage = lazy(() =>
  import('./pages/KanjiDetailPage').then((module) => ({
    default: module.KanjiDetailPage,
  })),
);
const GrammarListPage = lazy(() =>
  import('./pages/GrammarListPage').then((module) => ({
    default: module.GrammarListPage,
  })),
);
const GrammarPatternDetailPage = lazy(() =>
  import('./pages/GrammarPatternDetailPage').then((module) => ({
    default: module.GrammarPatternDetailPage,
  })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({
    default: module.SettingsPage,
  })),
);
const StudyItemDebugPage = lazy(() =>
  import('./pages/StudyItemDebugPage').then((module) => ({
    default: module.StudyItemDebugPage,
  })),
);
const StudyItemsListPage = lazy(() =>
  import('./pages/StudyItemsListPage').then((module) => ({
    default: module.StudyItemsListPage,
  })),
);
const PronunciationProfilePage = lazy(() =>
  import('./pages/PronunciationProfilePage').then((module) => ({
    default: module.PronunciationProfilePage,
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
            <Route index element={<HomePage />} />
            <Route path="books" element={<BooksPage />} />
            <Route path="session/:sessionId" element={<SessionRunnerPage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="import/youtube" element={<YouTubeMinePage />} />
            <Route path="review" element={<ReviewPage />} />
            <Route path="issues" element={<CardIssuesPage />} />
            <Route path="study-items" element={<StudyItemsListPage />} />
            <Route path="pronunciation" element={<PronunciationProfilePage />} />
            <Route path="study-items/:studyItemId" element={<StudyItemDebugPage />} />
            <Route path="vocabulary" element={<VocabularyListPage />} />
            <Route path="kanji/:character" element={<KanjiDetailPage />} />
            <Route path="grammar" element={<GrammarListPage />} />
            <Route path="grammar/:patternId" element={<GrammarPatternDetailPage />} />
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
            <Route
              path="books/:bookId/vocabulary/:sentenceId"
              element={<VocabularyReviewPage />}
            />
            <Route path="books/:bookId/practice" element={<PracticePage />} />
            <Route
              path="books/:bookId/practice/:sentenceId"
              element={<PracticePage />}
            />
            <Route path="books/:bookId/review" element={<ReviewPage />} />
            <Route
              path="books/:bookId/resegment"
              element={<ResegmentSourcePage />}
            />
            <Route path="books/:bookId/build" element={<BuildPage />} />
            <Route
              path="books/:bookId/build/:sentenceId"
              element={<BuildPage />}
            />
            <Route
              path="books/:bookId/shadow/:sentenceId"
              element={<ShadowPage />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
