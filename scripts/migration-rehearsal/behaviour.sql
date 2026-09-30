\set ON_ERROR_STOP off
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b') on conflict do nothing;
grant usage on schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}',false);
-- every action, with new columns
insert into sentence_learning_events (id,owner_id,visit_id,action,book_id,sentence_id,help_level,resolution,outcome,modality,scaffold,assessment_source)
select 'ok_'||a,'00000000-0000-0000-0000-00000000000a','v',a,'b','s','less',case when a='report_resolved' then 'fixed' end,'got_it','typed','none','self'
from unnest(array['walkthrough_opened','walkthrough_completed','target_practice','compare_uses_viewed','content_report','gist_check','expression_attempt','report_resolved','transfer_attempt','transfer_recheck','held_back_check']) a;
select 'inserted_ok', count(*) from sentence_learning_events;
-- rejected
insert into sentence_learning_events (id,owner_id,visit_id,action,book_id,sentence_id) values ('bad1','00000000-0000-0000-0000-00000000000a','v','bogus','b','s');
insert into sentence_learning_events (id,owner_id,visit_id,action,book_id,sentence_id,help_level) values ('bad2','00000000-0000-0000-0000-00000000000a','v','gist_check','b','s','max');
insert into sentence_learning_events (id,owner_id,visit_id,action,book_id,sentence_id,resolution) values ('bad3','00000000-0000-0000-0000-00000000000a','v','report_resolved','b','s','ignored');
-- impersonation rejected
insert into sentence_learning_events (id,owner_id,visit_id,action,book_id,sentence_id) values ('bad4','00000000-0000-0000-0000-00000000000b','v','gist_check','b','s');
-- other user sees none
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}',false);
select 'other_user_sees', count(*) from sentence_learning_events;
-- other user cannot update/delete
update sentence_learning_events set outcome='needed_help';
delete from sentence_learning_events;
reset role;
select 'rows_after_other_user_writes', count(*), count(*) filter (where outcome='needed_help') as changed from sentence_learning_events;
