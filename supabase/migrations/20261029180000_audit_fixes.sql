-- Audit fixes (2026-10-29). Five server-side changes, each small, each guarded.
--
--  1. Completionist can no longer be farmed by relabelling ratings. The claim
--     counted ratings whose client-written data->>'artistId' matched, so the
--     same 15 rows could be relabelled to a new "artist" and claimed again,
--     twice a day, for ever (~24,000 Discs a day). Now each rating can pay
--     towards ONE discography: milestone_comp_items records which ratings a
--     claim used, and only unused ratings count. Existing claims are
--     back-filled with the ratings that match them today, so a past claim
--     cannot be re-spent by relabelling either.
--  2. Deleting an album rating also takes down its public post. The deletion
--     RPC never touched crate_feed, and the client's own removal is not
--     retried, so a rating deleted offline stayed public for good. An AFTER
--     DELETE trigger covers every path that removes a ratings row; the RPC also
--     removes a post by id when there was no ratings row to fire it.
--  3. Recall Endless runs may finish up to 12.5h after they start (was 2h),
--     matching the 12-hour pause/resume window the game offers. A run paused
--     over lunch was voided as "expired".
--  4. The public-post daily cap no longer counts re-posts of a row that already
--     exists. The cap is a BEFORE INSERT trigger, and an upsert fires it before
--     the conflict is found — so after 600 posts in a day even re-rating a
--     record silently stopped updating its post.
--  5. The ratings blob in app_state is MERGED, not replaced. Every push sent a
--     device's whole crate, so two devices syncing close together dropped
--     whichever rating the other had not pulled yet. Each item now keeps the
--     newer of the stored and incoming copies (rating_item_stamp), and an item
--     missing from the push survives. Deletions are unaffected: they are
--     tombstoned (rating_deletions) and the existing filter removes them after
--     the merge, exactly as before.
--
-- Additive and idempotent (create ... if not exists / create or replace).
-- Apply by hand, then record it:
--   supabase migration repair --status applied 20261029180000

-- ---------------------------------------------------------------- 1. Completionist
create table if not exists public.milestone_comp_items (
  user_id  uuid not null references auth.users(id) on delete cascade,
  item_id  text not null,
  key      text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.milestone_comp_items enable row level security;

-- Back-fill: every rating that matches a discography already claimed is spent.
-- Oldest claim first, so a rating that matches two claims is charged to the
-- first one; `on conflict do nothing` keeps it to one.
insert into public.milestone_comp_items (user_id, item_id, key, created_at)
select r.user_id, r.item_id, c.key, c.created_at
  from public.milestone_claims c
  join public.ratings r
    on r.user_id = c.user_id and r.kind = 'album'
   and r.data ->> 'artistId' = split_part(c.key, ':', 2)
 where c.key like 'comp:%'
 order by c.created_at
on conflict (user_id, item_id) do nothing;

create or replace function public.wallet_claim_milestone(p_key text)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me     uuid := auth.uid();
  p        public.profiles;
  v_n      integer;
  v_have   integer;
  v_artist text;
  v_amt    integer := 0;
  v_items  text[];
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
  -- can check you have rated albums by them — and, since the artist on a rating
  -- is written by the client, that no rating pays towards two discographies.
  elsif p_key ~ '^comp:[A-Za-z0-9]+$' then
    v_artist := split_part(p_key, ':', 2);
    -- The same lock limit_comp_claims takes, held from here: two claims at once
    -- would otherwise both count the same unused ratings.
    perform pg_advisory_xact_lock(hashtextextended('comp_claims:' || v_me::text, 0));
    select array_agg(r.item_id) into v_items
      from public.ratings r
     where r.user_id = v_me and r.kind = 'album'
       and r.data ->> 'artistId' = v_artist
       and not exists (select 1 from public.milestone_comp_items m
                        where m.user_id = v_me and m.item_id = r.item_id);
    v_have := coalesce(array_length(v_items, 1), 0);
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

  if v_items is not null then
    insert into public.milestone_comp_items (user_id, item_id, key)
    select v_me, unnest(v_items), p_key
    on conflict (user_id, item_id) do nothing;
  end if;

  update public.profiles set discs = coalesce(discs, 0) + v_amt
   where id = v_me returning * into p;

  return jsonb_build_object('ok', true, 'already', false, 'key', p_key,
                            'earned', v_amt, 'discs', p.discs,
                            'lifetime_xp', p.lifetime_xp, 'level', p.level);
end $function$;

-- ---------------------------------------------------------------- 2. feed follows deletion
create or replace function public.unpost_deleted_album()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if old.kind <> 'album' then return old; end if;
  delete from public.crate_feed f
   where f.user_id = old.user_id
     and (f.album_id = old.item_id
          or (coalesce(old.data ->> 'name', '') <> '' and coalesce(old.data ->> 'artist', '') <> ''
              and lower(f.album_name) = lower(old.data ->> 'name')
              and lower(f.album_artist) = lower(old.data ->> 'artist')))
     and f.created_at <= clock_timestamp();
  return old;
end $function$;

drop trigger if exists unpost_deleted_album_trg on public.ratings;
create trigger unpost_deleted_album_trg after delete on public.ratings
  for each row execute function public.unpost_deleted_album();

-- rating_delete exactly as live, plus one statement: a deletion with no ratings
-- row behind it (never synced) still takes its post down. Only posts made
-- before the deletion: a re-rate posted afterwards on another device stays.
create or replace function public.rating_delete(p_kind text, p_item_id text, p_deleted_ms bigint, p_owner uuid)
returns bigint
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  if p_kind = 'album' then
    delete from public.crate_feed where user_id = v_me and album_id = p_item_id
      and created_at <= to_timestamp(v_ms / 1000.0);
  end if;
  update public.app_state set value = value where user_id = v_me
    and key = case p_kind when 'album' then 'crate_albums_v1' else 'crate_songs_v1' end;
  return v_ms;
end $function$;

-- ---------------------------------------------------------------- 3. Recall resume window
create or replace function public.game_spec(p_game text, p_mode text)
returns jsonb language sql immutable as $function$
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
    -- 12.5h: the client resumes a paused run for up to 12 hours (LIVE_TTL).
    when p_game = 'recall' and p_mode = 'endless'
      then '{"artist":false,"daily":false,"max_ms":45000000}'
    when p_game = 'higherlower' and p_mode = 'streams'
      then '{"artist":false,"daily":false,"max_ms":7200000}'
  end)::jsonb
$function$;

-- ---------------------------------------------------------------- 4. feed cap ignores re-posts
create or replace function public.daily_row_cap()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare v_user uuid;
begin
  if current_user <> 'authenticated' then return new; end if;   -- definer paths pass
  v_user := (to_jsonb(new) ->> tg_argv[2])::uuid;
  -- An upsert of a post that already exists is an update, not a new row: the
  -- conflict is only found after this BEFORE INSERT trigger has run.
  if tg_table_name = 'crate_feed' and exists (
       select 1 from public.crate_feed f where f.user_id = v_user and f.album_id = new.album_id) then
    return new;
  end if;
  if public.rating_insert_allowed(v_user, tg_argv[0]) then return new; end if;
  if tg_argv[1] = 'raise' then raise exception 'Daily limit reached, try again tomorrow' using errcode = 'P0429'; end if;
  return null;
end $function$;

-- ---------------------------------------------------------------- 5. ratings blob merges
create or replace function public.guard_rating_state()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_kind text;
begin
  v_kind := case new.key when 'crate_albums_v1' then 'album' when 'crate_songs_v1' then 'song' end;
  if v_kind is null then return new; end if;
  if jsonb_typeof(new.value::jsonb) <> 'object' then raise exception 'bad rating state'; end if;
  -- Merge with what is stored: per item, the newer copy wins (ties go to the
  -- push), and an item the push did not carry is kept. Removal is only ever by
  -- tombstone, applied below.
  if tg_op = 'UPDATE' and old.value is not null and jsonb_typeof(old.value::jsonb) = 'object' then
    new.value := coalesce((select jsonb_object_agg(x.k, x.v) from (
      select coalesce(n.key, o.key) as k,
             case when n.key is null then o.value
                  when o.key is null then n.value
                  when public.rating_item_stamp(o.value) > public.rating_item_stamp(n.value) then o.value
                  else n.value end as v
        from jsonb_each(new.value::jsonb) n
        full join jsonb_each(old.value::jsonb) o on o.key = n.key) x), '{}'::jsonb);
  end if;
  new.value := coalesce((select jsonb_object_agg(e.key, e.value)
    from jsonb_each(new.value::jsonb) e where not exists (
      select 1 from public.rating_deletions d where d.user_id = new.user_id
      and d.kind = v_kind and d.item_id = e.key
      and public.rating_item_stamp(e.value) <= d.deleted_ms)), '{}'::jsonb);
  return new;
end $function$;

-- ---------------------------------------------------------------- guards
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'milestone_comp_items') then
    raise exception 'milestone_comp_items must have no policy: only wallet_claim_milestone writes it';
  end if;
  if (public.game_spec('recall', 'endless') ->> 'max_ms')::bigint < 43200000 then
    raise exception 'Recall endless must outlast the 12-hour resume window';
  end if;
end $$;
