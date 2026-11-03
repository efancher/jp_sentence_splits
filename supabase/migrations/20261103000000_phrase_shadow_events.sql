-- Phrase shadowing: a self-rated pass at a marked span of a sentence's reference
-- clip, logged as a sentence_learning_events row (never a review, no FSRS).
-- Adds the 'phrase_shadow' action, a middle 'close' outcome, and the span columns.

alter table public.sentence_learning_events
  drop constraint if exists sentence_learning_events_action_check;
alter table public.sentence_learning_events
  add constraint sentence_learning_events_action_check check (action in
    ('walkthrough_opened', 'walkthrough_completed', 'target_practice', 'compare_uses_viewed', 'content_report', 'gist_check', 'expression_attempt', 'report_resolved', 'transfer_attempt', 'transfer_recheck', 'held_back_check', 'phrase_shadow'));

alter table public.sentence_learning_events
  drop constraint if exists sentence_learning_events_outcome_check;
alter table public.sentence_learning_events
  add constraint sentence_learning_events_outcome_check check (outcome in ('got_it', 'needed_help', 'close'));

alter table public.sentence_learning_events
  add column if not exists range_start_ms integer check (range_start_ms >= 0),
  add column if not exists range_end_ms integer check (range_end_ms >= 0);
