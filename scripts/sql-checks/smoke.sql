-- Rolled-back production smoke test: daily reward, ratings, sync merge, deletions,
-- Recall, shop and Collection purchases, as the support test account. Persists nothing.
--   supabase db query --linked -f scripts/sql-checks/smoke.sql
begin;
create temp table _o(k text, v text) on commit drop;
grant all on _o to authenticated, service_role;
do $$ declare a uuid; begin
  select id into a from auth.users where email = 'vinall.support@gmail.com';
  perform set_config('vinall.a', a::text, true);
end $$;
-- a clean slate for the test account, inside this transaction only
update public.profiles set login_last_date = (now() at time zone 'utc')::date - 1, login_streak = 1, discs = 100000, ratings_visibility = 'public'
 where id = current_setting('vinall.a')::uuid;
insert into public.app_state (user_id, key, value, updated_at)
values (current_setting('vinall.a')::uuid, 'crate_albums_v1', '{}', now())
on conflict (user_id, key) do nothing;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('vinall.a'), 'role','authenticated')::text, true);
set local role authenticated;

-- DAILY REWARDS
insert into _o select 'daily_1', (r->>'earned')||' streak '||(r->>'login_streak')||' already '||(r->>'claimed_already') from (select public.wallet_daily_login() r) x;
insert into _o select 'daily_2', (r->>'earned')||' already '||(r->>'claimed_already') from (select public.wallet_daily_login() r) x;

-- RATINGS (direct write as the app does), blob sync from two "devices"
insert into public.ratings (user_id, kind, item_id, data, updated_at) values
 (current_setting('vinall.a')::uuid, 'album', 'smoke-A', '{"id":"smoke-A","name":"Smoke A","artist":"Smoke","score":80,"ratedAt":1000}', now());
insert into _o select 'rating_saved', count(*)::text from public.ratings where user_id = current_setting('vinall.a')::uuid and item_id = 'smoke-A';
update public.app_state set value = '{"smoke-A":{"id":"smoke-A","score":80,"ratedAt":1000}}', updated_at = now() where user_id = current_setting('vinall.a')::uuid and key = 'crate_albums_v1';
update public.app_state set value = '{"smoke-B":{"id":"smoke-B","score":70,"ratedAt":2000}}', updated_at = now() where user_id = current_setting('vinall.a')::uuid and key = 'crate_albums_v1';
insert into _o select 'sync_merge_has_A_and_B', (value::jsonb ? 'smoke-A' and value::jsonb ? 'smoke-B')::text from public.app_state where user_id = current_setting('vinall.a')::uuid and key = 'crate_albums_v1';
-- an older copy from a stale device does not overwrite a newer score
update public.app_state set value = '{"smoke-A":{"id":"smoke-A","score":10,"ratedAt":500}}' where user_id = current_setting('vinall.a')::uuid and key = 'crate_albums_v1';
insert into _o select 'sync_newer_score_kept', (value::jsonb->'smoke-A'->>'score') from public.app_state where user_id = current_setting('vinall.a')::uuid and key = 'crate_albums_v1';
insert into public.crate_feed (user_id, username, kind, album_id, album_name, album_artist, score, created_at)
values (current_setting('vinall.a')::uuid, 'x', 'album_rating', 'smoke-A', 'Smoke A', 'Smoke', 80, now() - interval '1 minute');
insert into _o select 'feed_posted', count(*)::text from public.crate_feed where user_id = current_setting('vinall.a')::uuid and album_id = 'smoke-A';

-- DELETIONS
select public.rating_delete('album', 'smoke-A', (extract(epoch from now())*1000)::bigint + 5000, current_setting('vinall.a')::uuid);
insert into _o select 'deleted_rating_rows', count(*)::text from public.ratings where user_id = current_setting('vinall.a')::uuid and item_id = 'smoke-A';
insert into _o select 'deleted_feed_rows', count(*)::text from public.crate_feed where user_id = current_setting('vinall.a')::uuid and album_id = 'smoke-A';
insert into _o select 'deleted_gone_from_blob', (not (value::jsonb ? 'smoke-A'))::text from public.app_state where user_id = current_setting('vinall.a')::uuid and key = 'crate_albums_v1';
-- a stale device re-pushing the deleted rating does not bring it back
update public.app_state set value = '{"smoke-A":{"id":"smoke-A","score":80,"ratedAt":1000}}' where user_id = current_setting('vinall.a')::uuid and key = 'crate_albums_v1';
insert into _o select 'deleted_not_resurrected', (not (value::jsonb ? 'smoke-A'))::text from public.app_state where user_id = current_setting('vinall.a')::uuid and key = 'crate_albums_v1';

-- RECALL: tutorial board and an Endless board run
insert into _o select 'tutorial_start', coalesce(r->>'error', case when r ? 'already' then 'already has a result' else 'started' end) from (select public.recall_tutorial_start() r) x;
insert into _o select 'endless_start', coalesce(r->>'error','ok') from (select public.game_start('recall','endless') r) x;
reset role;
update public.recall_tutorial_runs set started_at = now() - interval '4 seconds' where user_id = current_setting('vinall.a')::uuid;
update public.game_runs set started_at = now() - interval '40 minutes' where user_id = current_setting('vinall.a')::uuid and game = 'recall' and status = 'open';
set local role authenticated;
insert into _o select 'tutorial_submit', coalesce(r->>'error', 'score '||(r->>'score')||' correct '||(r->>'correct')||' rank '||(r->>'rank')) from (select public.recall_tutorial_submit('Memories', 1, 1, 3000) r) x;
insert into _o select 'endless_finish', coalesce(r->>'error','score '||(r->>'score')) from (select public.game_finish((select id from public.game_runs where user_id = current_setting('vinall.a')::uuid and game='recall' and status='open' order by started_at desc limit 1), '{"score":1800,"played":3,"songs":2}'::jsonb) r) x;

insert into public.ratings (user_id, kind, item_id, data, updated_at) values
 (current_setting('vinall.a')::uuid, 'album', 'smoke-album', '{"id":"smoke-album","name":"Smoke Record","artist":"Smoke","score":75,"ratedAt":3000}', now());
-- PURCHASES: a shop boost, and a Collection record (route's service-role path)
insert into _o select 'shop_buy_freeze', coalesce((r->>'discs'), r::text) from (select public.wallet_buy('boost', 'freeze') r) x;
reset role;
set local role service_role;
insert into _o select 'collection_buy', coalesce(r->>'price', r::text) from (select public.collection_buy_from(current_setting('vinall.a')::uuid, 'smoke-album', 'Smoke Record', 'Smoke', null, 1234) r) x;
reset role;
select k, v from _o;
rollback;
