-- Rolled-back production check: a client insert into EVERY table with a daily cap
-- (the 2026-10-29 outage), plus both caps still biting. Persists nothing.
--   supabase db query --linked -f scripts/sql-checks/daily-caps.sql
begin;
create temp table _o(k text, v text) on commit drop;
grant all on _o to authenticated;
do $$ declare a uuid; b uuid; begin
  select id into a from auth.users where email='vinall.support@gmail.com';
  select id into b from auth.users where id <> a order by created_at limit 1;
  perform set_config('vinall.a', a::text, true); perform set_config('vinall.b', b::text, true);
  perform set_config('vinall.c', (select id::text from auth.users where id not in (a, b) order by created_at limit 1), true);
end $$;
update public.profiles set ratings_visibility='public' where id = current_setting('vinall.a')::uuid;
delete from public.rating_daily_inserts where user_id = current_setting('vinall.a')::uuid;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vinall.a'), 'role','authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := current_setting('vinall.a')::uuid; b uuid := current_setting('vinall.b')::uuid; n int;
  procedure_note text;
begin
  begin insert into public.analytics_events(user_id,name,props) values (a,'smoke','{}'); get diagnostics n = row_count; insert into _o values ('analytics_events', 'ok rows='||n); exception when others then insert into _o values ('analytics_events', 'ERR '||sqlerrm); end;
  begin insert into public.follows(follower_id,following_id) values (a,b); get diagnostics n = row_count; insert into _o values ('follows', 'ok rows='||n); exception when others then insert into _o values ('follows', 'ERR '||sqlerrm); end;
  begin insert into public.lore_answers(user_id,item_kind,item_id,question_id,question_text,choice) values (a,'album','smoke-x','q1','Smoke?','Yes'); get diagnostics n = row_count; insert into _o values ('lore_answers', 'ok rows='||n); exception when others then insert into _o values ('lore_answers', 'ERR '||sqlerrm); end;
  begin insert into public.feed_comments(user_id,username,body,album_id) values (a,'x','Smoke comment','smoke-x'); get diagnostics n = row_count; insert into _o values ('feed_comments', 'ok rows='||n); exception when others then insert into _o values ('feed_comments', 'ERR '||sqlerrm); end;
  begin insert into public.liked_songs(user_id,track_key,name,artist) values (a,'smoke-t','T','A'); get diagnostics n = row_count; insert into _o values ('liked_songs', 'ok rows='||n); exception when others then insert into _o values ('liked_songs', 'ERR '||sqlerrm); end;
  begin insert into public.listening_plays(user_id,k,track,artist,plays) values (a,'a|t','T','A',1); get diagnostics n = row_count; insert into _o values ('listening_plays', 'ok rows='||n); exception when others then insert into _o values ('listening_plays', 'ERR '||sqlerrm); end;
  begin insert into public.grooves(name,owner_id) values ('Smoke groove',a); get diagnostics n = row_count; insert into _o values ('grooves', 'ok rows='||n); exception when others then insert into _o values ('grooves', 'ERR '||sqlerrm); end;
  begin insert into public.lists(user_id,title,kind,items) values (a,'Smoke list','album','[]'); get diagnostics n = row_count; insert into _o values ('lists', 'ok rows='||n); exception when others then insert into _o values ('lists', 'ERR '||sqlerrm); end;
  begin insert into public.leaderboard_times(user_id,username,game_type,mode_key,time_ms) values (a,'x','cover','artist',9000); get diagnostics n = row_count; insert into _o values ('leaderboard_times', 'ok rows='||n); exception when others then insert into _o values ('leaderboard_times', 'ERR '||sqlerrm); end;
  begin insert into public.crate_feed(user_id,username,kind,album_id,album_name,album_artist,score) values (a,'x','album_rating','smoke-f','Smoke F','Smoke',70); get diagnostics n = row_count; insert into _o values ('crate_feed', 'ok rows='||n); exception when others then insert into _o values ('crate_feed', 'ERR '||sqlerrm); end;
end $$;
reset role;
-- caps still bite: exhaust 'follow' (raise) and 'feed' (skip) for today
update public.rating_daily_inserts set n = 300 where user_id = current_setting('vinall.a')::uuid and kind='follow';
insert into public.rating_daily_inserts(user_id,day,kind,n) values (current_setting('vinall.a')::uuid,(now() at time zone 'utc')::date,'feed',600)
  on conflict (user_id,day,kind) do update set n = 600;
set local role authenticated;
do $$
declare a uuid := current_setting('vinall.a')::uuid; n int; c uuid;
begin
  c := current_setting('vinall.c')::uuid;
  begin insert into public.follows(follower_id,following_id) values (a,c); insert into _o values ('cap_follow_over_limit', 'NOT capped (bad)'); exception when others then insert into _o values ('cap_follow_over_limit', 'refused: '||sqlerrm); end;
  insert into public.crate_feed(user_id,username,kind,album_id,album_name,album_artist,score) values (a,'x','album_rating','smoke-new','New','Smoke',50);
  get diagnostics n = row_count; insert into _o values ('cap_feed_new_post_over_limit', 'rows='||n);
  insert into public.crate_feed(user_id,username,kind,album_id,album_name,album_artist,score) values (a,'x','album_rating','smoke-f','Smoke F','Smoke',99)
    on conflict (user_id,album_id) do update set score = excluded.score;
  insert into _o select 'cap_feed_repost_over_limit_score', score::text from public.crate_feed where user_id=a and album_id='smoke-f';
end $$;
reset role;
select k, v from _o;
rollback;
