-- Reader follow-up offers: after a Read check ends in "needed help" the reader
-- offers one activity, logged as a sentence_learning_events row (never a review,
-- no FSRS) so the activities can later be compared by what they do for the next
-- Read check. Adds the 'follow_up_offer' action only.

alter table public.sentence_learning_events
  drop constraint if exists sentence_learning_events_action_check;
alter table public.sentence_learning_events
  add constraint sentence_learning_events_action_check check (action in
    ('walkthrough_opened', 'walkthrough_completed', 'target_practice', 'compare_uses_viewed', 'content_report', 'gist_check', 'expression_attempt', 'report_resolved', 'transfer_attempt', 'transfer_recheck', 'held_back_check', 'phrase_shadow', 'follow_up_offer'));
