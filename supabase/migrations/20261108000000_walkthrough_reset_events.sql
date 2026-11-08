-- "Reset walked-through": the learner can say a sentence was never really walked
-- through (an accidental or click-through walkthrough). Logged as a
-- sentence_learning_events row (append-only, no review, no FSRS); walkthroughs
-- before it stop counting as walked. Adds the 'walkthrough_reset' action only.

alter table public.sentence_learning_events
  drop constraint if exists sentence_learning_events_action_check;
alter table public.sentence_learning_events
  add constraint sentence_learning_events_action_check check (action in
    ('walkthrough_opened', 'walkthrough_completed', 'target_practice', 'compare_uses_viewed', 'content_report', 'gist_check', 'expression_attempt', 'report_resolved', 'transfer_attempt', 'transfer_recheck', 'held_back_check', 'phrase_shadow', 'follow_up_offer', 'walkthrough_reset'));
