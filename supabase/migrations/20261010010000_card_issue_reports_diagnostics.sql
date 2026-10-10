-- Auto-captured device state (JSON text) attached to a card issue report:
-- local audio blob size/duration vs. the stored duration, saved trim, recent
-- JS errors, etc. Additive and nullable.
alter table public.card_issue_reports
  add column diagnostics text;
