-- ROLLBACK for 20261029180000_audit_fixes.sql. Not a migration: it lives outside
-- supabase/migrations so `supabase db push` never runs it.
--
-- Restores the five functions exactly as they were live on 2026-10-29 before
-- the migration (captured with pg_get_functiondef), drops the feed-unposting
-- trigger and the Completionist ledger. The migration changed no existing rows,
-- so no data needs restoring; milestone_comp_items is new and is dropped.
--
-- Run in the SQL editor (or `supabase db query --linked -f`), then:
--   supabase migration repair --status reverted 20261029180000

begin;
drop trigger if exists unpost_deleted_album_trg on public.ratings;
drop function if exists public.unpost_deleted_album();
drop table if exists public.milestone_comp_items;

CREATE OR REPLACE FUNCTION public.wallet_claim_milestone(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me     uuid := auth.uid();
  p        public.profiles;
  v_n      integer;
  v_have   integer;
  v_artist text;
  v_amt    integer := 0;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_key is null then raise exception 'No milestone given'; end if;

  if p_key ~ '^albums:[0-9]+$' then
    v_n := split_part(p_key, ':', 2)::integer;
    v_amt := case v_n
      when 1   then 500     when 5   then 1000
      when 10  then 2500    when 25  then 6000
      when 50  then 12000   when 100 then 25000
      when 250 then 50000   when 500 then 100000
      else 0 end;
    if v_amt = 0 then raise exception 'Unknown milestone: %', p_key; end if;

    select count(*) into v_have
      from public.ratings where user_id = v_me and kind = 'album';
    if v_have < v_n then
      raise exception 'Not there yet — % of % albums', v_have, v_n;
    end if;

  -- Completionist. The server cannot know an artist's full discography, but it
  -- can check you have actually rated albums by them and pay in proportion.
  elsif p_key ~ '^comp:[A-Za-z0-9]+$' then
    v_artist := split_part(p_key, ':', 2);
    select count(*) into v_have
      from public.ratings
     where user_id = v_me and kind = 'album'
       and data ->> 'artistId' = v_artist;
    if v_have < 2 then
      raise exception 'Rate at least two of their albums first';
    end if;
    v_amt := least(v_have, 15) * 800;

  else
    raise exception 'Unknown milestone: %', p_key;
  end if;

  -- One claim per milestone, forever. The primary key is the enforcement.
  insert into public.milestone_claims (user_id, key, awarded)
  values (v_me, p_key, v_amt)
  on conflict (user_id, key) do nothing;

  if not found then
    select * into p from public.profiles where id = v_me;
    return jsonb_build_object('ok', false, 'already', true, 'earned', 0,
                              'discs', p.discs, 'lifetime_xp', p.lifetime_xp,
                              'level', p.level);
  end if;

  update public.profiles set discs = coalesce(discs, 0) + v_amt
   where id = v_me returning * into p;

  return jsonb_build_object('ok', true, 'already', false, 'key', p_key,
                            'earned', v_amt, 'discs', p.discs,
                            'lifetime_xp', p.lifetime_xp, 'level', p.level);
end $function$;


CREATE OR REPLACE FUNCTION public.rating_delete(p_kind text, p_item_id text, p_deleted_ms bigint, p_owner uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_me uuid := auth.uid(); v_ms bigint;
begin
  if v_me is null then raise exception 'not signed in'; end if;
  if p_owner is distinct from v_me then raise exception 'account changed'; end if;
  if p_kind is null or p_kind not in ('album', 'song') or p_item_id is null
     or length(p_item_id) not between 1 and 300 or p_deleted_ms is null
     or p_deleted_ms <= 0 or p_deleted_ms > 9007199254740991 then raise exception 'bad deletion'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_me::text, 1));
  insert into public.rating_deletions (user_id, kind, item_id, deleted_ms)
  values (v_me, p_kind, p_item_id, p_deleted_ms)
  on conflict (user_id, kind, item_id) do update
    set deleted_ms = greatest(rating_deletions.deleted_ms, excluded.deleted_ms)
  returning deleted_ms into v_ms;
  perform set_config('vinall.rating_delete_rpc', '1', true);
  delete from public.ratings where user_id = v_me and kind = p_kind and item_id = p_item_id
    and public.rating_item_stamp(data::jsonb) <= v_ms;
  perform set_config('vinall.rating_delete_rpc', '', true);
  update public.app_state set value = value where user_id = v_me
    and key = case p_kind when 'album' then 'crate_albums_v1' else 'crate_songs_v1' end;
  return v_ms;
end $function$;


CREATE OR REPLACE FUNCTION public.game_spec(p_game text, p_mode text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select (case
    when p_game in ('cover','coverx','tracklist','year') and p_mode = 'artist'
      then '{"artist":true,"daily":false,"max_ms":3600000}'
    when p_game = 'drop' and p_mode in ('album','song')
      then '{"artist":false,"daily":true,"max_ms":129600000}'
    when p_game = 'earworm' and p_mode = 'daily'
      then '{"artist":false,"daily":true,"max_ms":129600000}'
    when p_game = 'blitz' and p_mode = 'daily'
      then '{"artist":false,"daily":true,"max_ms":3600000}'
    when p_game = 'blitz' and p_mode = 'solo'
      then '{"artist":false,"daily":false,"max_ms":3600000}'
    when p_game = 'recall' and p_mode = 'daily'
      then '{"artist":false,"daily":true,"max_ms":129600000}'
    when p_game = 'recall' and p_mode = 'endless'
      then '{"artist":false,"daily":false,"max_ms":7200000}'
    when p_game = 'higherlower' and p_mode = 'streams'
      then '{"artist":false,"daily":false,"max_ms":7200000}'
  end)::jsonb
$function$;


CREATE OR REPLACE FUNCTION public.daily_row_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid;
begin
  if current_user <> 'authenticated' then return new; end if;   -- definer paths pass
  v_user := (to_jsonb(new) ->> tg_argv[2])::uuid;
  if public.rating_insert_allowed(v_user, tg_argv[0]) then return new; end if;
  if tg_argv[1] = 'raise' then raise exception 'Daily limit reached, try again tomorrow' using errcode = 'P0429'; end if;
  return null;
end $function$;


CREATE OR REPLACE FUNCTION public.guard_rating_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_kind text;
begin
  v_kind := case new.key when 'crate_albums_v1' then 'album' when 'crate_songs_v1' then 'song' end;
  if v_kind is null then return new; end if;
  if jsonb_typeof(new.value::jsonb) <> 'object' then raise exception 'bad rating state'; end if;
  new.value := coalesce((select jsonb_object_agg(e.key, e.value)
    from jsonb_each(new.value::jsonb) e where not exists (
      select 1 from public.rating_deletions d where d.user_id = new.user_id
      and d.kind = v_kind and d.item_id = e.key
      and public.rating_item_stamp(e.value) <= d.deleted_ms)), '{}'::jsonb);
  return new;
end $function$;


commit;
