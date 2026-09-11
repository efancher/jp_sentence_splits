-- Shelve a book: no session-planner work and its exclusive review cards are
-- held back until the learner resumes it. Distinct from `archived`.
alter table public.books
  add column if not exists suspended_at timestamptz;
