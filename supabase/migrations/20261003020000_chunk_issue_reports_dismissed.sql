-- A chunk/meaning issue can be dismissed ("not an issue") as well as resolved;
-- dismissed patterns are skipped on later imports.
alter table public.chunk_issue_reports
  drop constraint chunk_issue_reports_status_check;
alter table public.chunk_issue_reports
  add constraint chunk_issue_reports_status_check
  check (status in ('open', 'resolved', 'dismissed'));
