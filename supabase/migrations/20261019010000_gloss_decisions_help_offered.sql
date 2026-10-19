-- Offered-versus-used help for gloss decisions (docs/ADAPTIVE_SCHEDULING_RESEARCH.md,
-- stage 1). Additive and nullable: rows recorded before this migration keep
-- nulls, and nothing reads these columns for scheduling or support level.

alter table public.gloss_decisions
  add column help_offered text[],
  add column unaided_chosen boolean,
  add column glosses_auto_opened boolean;

alter table public.gloss_decisions
  add constraint gloss_decisions_help_offered_check
  check (help_offered is null or help_offered <@ array['word_glosses', 'try_unaided', 'hints']::text[]);
