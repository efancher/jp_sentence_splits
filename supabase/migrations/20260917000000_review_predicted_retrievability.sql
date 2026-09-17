-- FSRS predicted-vs-actual calibration foundation (ROADMAP.md "FSRS
-- calibration surfacing"). "FSRS confidence" on /progress only shows a
-- live snapshot of *current* predicted retrievability because nothing
-- persisted what FSRS predicted at the moment a review was actually
-- graded. Additive, nullable — existing rows stay unset; only reviews
-- recorded from here on populate it (recordReview in src/db/repository.ts).
alter table public.reviews
  add column predicted_retrievability double precision;
