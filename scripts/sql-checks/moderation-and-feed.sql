-- Rolled-back production check: duplicate-entry deletes, report targets, avatar
-- bucket limits and feed metadata (2026-10-29 sweep). Persists nothing.
--   supabase db query --linked -f scripts/sql-checks/moderation-and-feed.sql
begin;
create temp table _m(k text, v text) on commit drop;
grant all on _m to authenticated;
do $$ declare a uuid; x uuid; c uuid; begin
  select id into a from auth.users where email='vinall.support@gmail.com';
  select id into x from auth.users where id <> a order by created_at limit 1;
  select id into c from auth.users where id not in (a, x) order by created_at limit 1;
  perform set_config('m.a', a::text, true); perform set_config('m.x', x::text, true); perform set_config('m.c', c::text, true);
end $$;
update public.profiles set ratings_visibility='public' where id in (current_setting('m.a')::uuid, current_setting('m.x')::uuid);
-- A: two crate entries for one record, a post under each
insert into public.ratings(user_id,kind,item_id,data,updated_at) values
 (current_setting('m.a')::uuid,'album','dupL','{"name":"Dup Rec","artist":"Dup","score":90,"ratedAt":10}',now()),
 (current_setting('m.a')::uuid,'album','dupD','{"name":"Dup Rec","artist":"Dup","score":95,"ratedAt":20}',now()),
 (current_setting('m.a')::uuid,'album','solo1','{"name":"Solo Rec","artist":"Solo","score":60,"ratedAt":30}',now());
insert into public.crate_feed(user_id,username,kind,album_id,album_name,album_artist,score,created_at) values
 (current_setting('m.a')::uuid,'x','album_rating','dupL','Dup Rec','Dup',90,now()-interval '1 minute'),
 (current_setting('m.a')::uuid,'x','album_rating','dupD','Dup Rec','Dup',95,now()-interval '1 minute'),
 (current_setting('m.a')::uuid,'x','album_rating','solo1','Solo Rec','Solo',60,now()-interval '1 minute'),
 (current_setting('m.a')::uuid,'x','album_rating','solo1dz','Solo Rec','Solo',60,now()-interval '1 minute');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('m.a'), 'role','authenticated')::text, true);
set local role authenticated;
select public.rating_delete('album','dupL',(extract(epoch from now())*1000)::bigint+5000,current_setting('m.a')::uuid);
select public.rating_delete('album','solo1',(extract(epoch from now())*1000)::bigint+5000,current_setting('m.a')::uuid);
reset role;
insert into _m select 'A_dup_deleted_own_post', count(*)::text from public.crate_feed where album_id='dupL';
insert into _m select 'A_dup_survivor_post_kept', count(*)::text from public.crate_feed where album_id='dupD';
insert into _m select 'A_solo_all_posts_gone', count(*)::text from public.crate_feed where album_name='Solo Rec' and user_id=current_setting('m.a')::uuid;
-- B: a report naming an innocent account
insert into public.crate_feed(user_id,username,kind,album_id,album_name,album_artist,score,created_at) values
 (current_setting('m.x')::uuid,'x','album_rating','rptX','Rpt','Rpt',10,now());
set local role authenticated;
insert into public.reports(reporter_id,target_kind,target_id,target_user_id,reason)
  select current_setting('m.a')::uuid,'feed',(select id::text from public.crate_feed where album_id='rptX' and user_id=current_setting('m.x')::uuid),current_setting('m.c')::uuid,'Spam';
insert into public.reports(reporter_id,target_kind,target_id,target_user_id,reason) values (current_setting('m.a')::uuid,'user',current_setting('m.x'),current_setting('m.c')::uuid,'Spam');
insert into public.reports(reporter_id,target_kind,target_id,target_user_id,reason) values (current_setting('m.a')::uuid,'feed','00000000-0000-0000-0000-000000000000',current_setting('m.c')::uuid,'Spam');
reset role;
insert into _m select 'B_feed_report_author_is_real_poster', (target_user_id = current_setting('m.x')::uuid)::text from public.reports where reporter_id=current_setting('m.a')::uuid and target_kind='feed' and target_id <> '00000000-0000-0000-0000-000000000000';
insert into _m select 'B_user_report_author', (target_user_id = current_setting('m.x')::uuid)::text from public.reports where reporter_id=current_setting('m.a')::uuid and target_kind='user';
insert into _m select 'B_unknown_target_author_null', (target_user_id is null)::text from public.reports where target_id='00000000-0000-0000-0000-000000000000';
insert into _m select 'B_no_open_report_names_wrong_author', count(*)::text from public.reports r where r.status='open' and public.report_target_owner(r.target_kind,r.target_id) is not null and r.target_user_id is distinct from public.report_target_owner(r.target_kind,r.target_id);
-- C: bucket
insert into _m select 'C_avatars_bucket', file_size_limit::text||' '||array_to_string(allowed_mime_types,',') from storage.buckets where id='avatars';
-- D: feed metadata
set local role authenticated;
do $$ declare a uuid := current_setting('m.a')::uuid; n int; begin
  -- A real record whose title trips the word filter (Ol' Dirty Bastard) still posts.
  insert into public.crate_feed(user_id,username,kind,album_id,album_name,album_artist,album_art,score) values (a,'x','album_rating','realtitle','Nigga Please','Ol'' Dirty Bastard','',50);
  get diagnostics n = row_count; insert into _m values ('D_real_title_posted_rows', n::text);
  insert into public.crate_feed(user_id,username,kind,album_id,album_name,album_artist,album_art,score) values (a,'x','album_rating','badart','Fine','Smoke','https://evil.example/x.jpg',50);
  insert into public.crate_feed(user_id,username,kind,album_id,album_name,album_artist,album_art,score) values (a,'x','album_rating','goodart','Fine2','Smoke','https://cdn-images.dzcdn.net/images/cover/abc/500x500-000000-80-0-0.jpg',50);
end $$;
reset role;
insert into _m select 'D_foreign_art_blanked', (album_art = '')::text from public.crate_feed where album_id='badart';
insert into _m select 'D_catalogue_art_kept', (album_art <> '')::text from public.crate_feed where album_id='goodart';
select k, v from _m;
rollback;
