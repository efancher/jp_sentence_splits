-- Progressive glossing phase 2: self-reported difficulty rows, and the
-- noun-modifier attachment skill. Still append-only, observations only.

alter table public.gloss_decisions add column felt text
  check (felt in ('too_easy', 'right', 'too_hard'));

alter table public.gloss_decisions drop constraint gloss_decisions_skill_check;
alter table public.gloss_decisions add constraint gloss_decisions_skill_check
  check (skill in ('predicate', 'particle', 'attachment'));

alter table public.gloss_decisions drop constraint gloss_decisions_subskill_check;
alter table public.gloss_decisions add constraint gloss_decisions_subskill_check
  check (subskill in ('predicate', 'case', 'topic', 'noun_modifier'));

alter table public.gloss_decisions drop constraint gloss_decisions_outcome_check;
alter table public.gloss_decisions add constraint gloss_decisions_outcome_check
  check (outcome in
    ('independent_correct', 'assisted_correct', 'unresolved', 'skipped', 'disputed', 'ungraded', 'self_report'));
