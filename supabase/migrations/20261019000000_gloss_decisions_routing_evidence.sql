-- Routing-evidence links for gloss decisions (docs/ADAPTIVE_SCHEDULING_RESEARCH.md,
-- stage 1). Additive and nullable: rows recorded before this migration keep
-- nulls, and nothing reads these columns for scheduling or support level.

alter table public.gloss_decisions
  add column retry_of_id text,
  add column help_sequence text[],
  add column help_before_first_response smallint check (help_before_first_response is null or help_before_first_response >= 0),
  add column content_revision text,
  add column first_response_ms integer check (first_response_ms is null or first_response_ms >= 0);

alter table public.gloss_decisions
  add constraint gloss_decisions_help_sequence_check
  check (help_sequence is null or help_sequence <@ array['word', 'form', 'structure', 'unsure']::text[]);
