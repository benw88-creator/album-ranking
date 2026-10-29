-- HOTFIX for 20261029180000_audit_fixes.sql, part 4.
--
-- That migration taught the SHARED daily_row_cap() trigger function about
-- crate_feed by reading `new.album_id`. The function is attached to ten tables
-- and only crate_feed (and feed_comments) has that column: PL/pgSQL resolves a
-- record field when it plans the expression, so the `tg_table_name = ...`
-- guard in front of it short-circuits nothing, and every direct client insert
-- on follows, lore_answers, analytics_events, liked_songs, listening_plays,
-- grooves, lists and leaderboard_times failed with
--   record "new" has no field "album_id".
-- Same mechanism as 20261016110000_fix_push_fanout.sql. A trigger function
-- shared by several tables must never name a column only one of them has.
--
-- Fix: daily_row_cap() goes back to its exact pre-audit body, and the feed's
-- re-post exemption moves into crate_feed_row_cap(), a function attached to
-- crate_feed alone. Same cap, same counter ('feed'), same 'skip' behaviour.
--
-- Idempotent. Apply by hand, then:
--   supabase migration repair --status applied 20261029200000

create or replace function public.daily_row_cap()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare v_user uuid;
begin
  if current_user <> 'authenticated' then return new; end if;   -- definer paths pass
  v_user := (to_jsonb(new) ->> tg_argv[2])::uuid;
  if public.rating_insert_allowed(v_user, tg_argv[0]) then return new; end if;
  if tg_argv[1] = 'raise' then raise exception 'Daily limit reached, try again tomorrow' using errcode = 'P0429'; end if;
  return null;
end $function$;

-- crate_feed only. An upsert of a post that already exists is an update, not a
-- new row (the conflict is found after this BEFORE INSERT trigger runs), so it
-- does not spend the daily allowance.
create or replace function public.crate_feed_row_cap()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user <> 'authenticated' then return new; end if;   -- definer paths pass
  if exists (select 1 from public.crate_feed f where f.user_id = new.user_id and f.album_id = new.album_id) then
    return new;
  end if;
  if public.rating_insert_allowed(new.user_id, 'feed') then return new; end if;
  return null;
end $function$;

drop trigger if exists daily_row_cap_trg on public.crate_feed;
create trigger daily_row_cap_trg before insert on public.crate_feed
  for each row execute function public.crate_feed_row_cap();

do $$
begin
  -- The shared function must not name a table-specific column again.
  if position('album_id' in pg_get_functiondef('public.daily_row_cap'::regproc)) > 0 then
    raise exception 'daily_row_cap must stay table-agnostic';
  end if;
  if (select count(*) from pg_trigger t join pg_proc p on p.oid = t.tgfoid
       where p.proname = 'daily_row_cap' and t.tgrelid = 'public.crate_feed'::regclass) > 0 then
    raise exception 'crate_feed must use crate_feed_row_cap';
  end if;
end $$;
