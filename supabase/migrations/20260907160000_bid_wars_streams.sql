-- ===========================================================================
-- BID WARS: value a record by total plays instead of community rating.
--
-- Spotify does not expose stream counts (not in the Web API at all, and this
-- app no longer even receives `popularity`), so "total streams" comes from
-- Last.fm's album.getinfo playcount -- total scrobbles, i.e. total plays.
--
-- Postgres cannot fetch that itself, and the browser must not: a player who
-- fetches the playcounts knows what every record is worth before bidding.
-- So war creation moves to /api/bid-war-create, which fetches server-side,
-- caches into album_plays, and calls bid_war_create_from with the values.
--
-- album_plays and bid_war_create_from are therefore reachable only with the
-- service role. Clients get no policy on album_plays at all -- otherwise the
-- values in a live war could simply be read out of it.
-- ===========================================================================

-- Play counts run to hundreds of millions; the rating-scale numerics can't hold them.
alter table public.bid_war_values alter column value type bigint using round(value)::bigint;
alter table public.bid_wars alter column initiator_total type bigint using round(initiator_total)::bigint;
alter table public.bid_wars alter column opponent_total  type bigint using round(opponent_total)::bigint;

create table if not exists public.album_plays (
  album_id   text primary key,
  name       text,
  artist     text,
  plays      bigint,
  source     text not null default 'lastfm',
  fetched_at timestamptz not null default now()
);

-- RLS on, no policies: unreachable from the browser under any query.
alter table public.album_plays enable row level security;

-- ---------------------------------------------------------------------------
-- Candidate records. Still drawn from The Crate -- the albums this community
-- has actually put in front of itself -- but valued by plays, not by score.
-- ---------------------------------------------------------------------------
create or replace function public.bid_war_pool(p_limit integer default 24)
returns table (album_id text, name text, artist text, art text)
language sql security definer
set search_path = public, pg_temp
as $$
  select album_id, name, artist, art
  from (
    select album_id,
           max(album_name)   as name,
           max(album_artist) as artist,
           max(album_art)    as art
    from public.crate_feed
    where album_id is not null and album_name is not null
    group by album_id
    order by count(*) desc, album_id
    limit 40
  ) pool
  order by random()
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Create a war from records the API route has already valued. Same guards as
-- before; the difference is only where the values came from.
-- p_records: [{album_id,name,artist,art,value}]
-- ---------------------------------------------------------------------------
create or replace function public.bid_war_create_from(
  p_initiator uuid, p_opponent uuid, p_records jsonb)
returns public.bid_wars
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_war public.bid_wars;
begin
  if p_initiator is null or p_opponent is null then raise exception 'Missing player'; end if;
  if p_initiator = p_opponent then raise exception 'You cannot challenge yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_opponent) then
    raise exception 'That player does not exist';
  end if;
  if jsonb_array_length(p_records) <> 5 then raise exception 'A war needs five records'; end if;

  if exists (
    select 1 from public.bid_wars
    where status = 'pending'
      and ((initiator_id = p_initiator and opponent_id = p_opponent)
        or (initiator_id = p_opponent and opponent_id = p_initiator))
  ) then
    raise exception 'You already have a war running with them';
  end if;

  insert into public.bid_wars (initiator_id, opponent_id, records)
  values (p_initiator, p_opponent,
          (select jsonb_agg(r - 'value') from jsonb_array_elements(p_records) r))
  returning * into v_war;

  insert into public.bid_war_values (war_id, album_id, value)
  select v_war.id, r->>'album_id', (r->>'value')::bigint
  from jsonb_array_elements(p_records) r;

  insert into public.notifications (user_id, actor_id, type, data)
  select p_opponent, p_initiator, 'bid_war_challenge',
         jsonb_build_object('username', coalesce(p.username, 'someone'),
                            'avatar_url', coalesce(p.avatar_url, ''),
                            'war_id', v_war.id)
  from public.profiles p where p.id = p_initiator;

  return v_war;
end;
$$;

-- The old rating-valued creator is gone: leaving it callable would let a
-- client open a war scored the old way.
drop function if exists public.bid_war_create(uuid);

revoke all on function public.bid_war_pool(integer) from public, anon, authenticated;
revoke all on function public.bid_war_create_from(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.bid_war_pool(integer) to service_role;
grant execute on function public.bid_war_create_from(uuid, uuid, jsonb) to service_role;
