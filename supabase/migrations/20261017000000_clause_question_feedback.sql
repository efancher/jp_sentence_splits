-- Learner reactions to the ungraded clause-question preview ("This explanation
-- helped" / "Another answer works"). Previously device-local only
-- (localStorage), so the dispute rate behind the independent reference review
-- could not be measured. Append-only like gloss_decisions: insert/select only,
-- never a review, never read by FSRS; the latest row per (reference_id) is the
-- learner's current reaction. reference_id is the question id including its
-- revision suffix, so feedback never attaches to reworded content.
-- sentence_id is deliberately NOT a foreign key so evidence survives removal.

create table public.clause_question_feedback (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  "timestamp" timestamptz not null default now(),
  sentence_id text not null,
  reference_id text not null,
  value text not null check (value in ('helpful', 'disputed')),
  -- What the learner picked before the reveal (null if they revealed without
  -- choosing, or for reactions imported from the old localStorage store) and the
  -- draft answer at that time, so "disputed while picking the draft answer" can
  -- be told apart from "disputed after picking something else".
  chosen_option text,
  draft_answer text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version bigint not null default 1,
  client_id text,
  last_modified_by uuid references auth.users (id)
);

create index clause_question_feedback_owner_id_idx on public.clause_question_feedback (owner_id);
create index clause_question_feedback_reference_id_idx on public.clause_question_feedback (reference_id);
create index clause_question_feedback_timestamp_idx on public.clause_question_feedback ("timestamp");

create trigger clause_question_feedback_set_updated_at before update on public.clause_question_feedback
  for each row execute function sync_private.set_updated_at();
create trigger clause_question_feedback_bump_version before update on public.clause_question_feedback
  for each row execute function sync_private.bump_version();
create trigger clause_question_feedback_sync_event after insert or update on public.clause_question_feedback
  for each row execute function sync_private.append_sync_event();

alter table public.clause_question_feedback enable row level security;

create policy clause_question_feedback_select on public.clause_question_feedback
  for select to authenticated
  using (owner_id = auth.uid());
create policy clause_question_feedback_insert on public.clause_question_feedback
  for insert to authenticated
  with check (owner_id = auth.uid());
