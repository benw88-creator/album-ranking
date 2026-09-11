-- Bid Wars: values are shown at creation, and wars get a mode.
--
-- ---------------------------------------------------------------------------
-- Why the values stop being secret
-- ---------------------------------------------------------------------------
-- The seal never actually held. `/api/album-streams?album=<id>` is public and
-- read-only by design — it exists so a wrong valuation can be diagnosed in one
-- request — and it returns exactly the number a war stores. A player could
-- always look up all five records on their own board before bidding.
--
-- So the position was the worst of both: the values were hidden from the
-- honest player and available to anyone who opened the network tab. Hiding
-- something that is one request away is not a defence, it is a handicap on
-- whoever did not think to check.
--
-- Revealed, the game is cleaner. Both players see all five values and spread
-- 100 chips across them, blind to each other. That is a simultaneous
-- allocation game — Colonel Blotto, essentially — and the skill moves from
-- "who knows more about streaming numbers" to "where will they commit, and can
-- I take the big one for less than they paid". The bids stay sealed, which is
-- where the tension actually lives.
--
-- bid_war_values keeps its RLS-on-no-policies isolation and stays the
-- authoritative source at resolution. Only the copy inside bid_wars.records is
-- now visible, and bid_war_submit overwrites it from the sealed table anyway,
-- so a tampered records blob cannot change a result.

alter table public.bid_wars
  add column if not exists mode text not null default 'streams';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bid_wars_mode_check') then
    alter table public.bid_wars
      add constraint bid_wars_mode_check check (mode in ('streams', 'market'));
  end if;
end $$;

-- The signature gains p_mode, so the old three-argument version has to go
-- first: a default parameter does not replace a narrower overload, it creates
-- an ambiguous pair.
drop function if exists public.bid_war_create_from(uuid, uuid, jsonb);

-- p_records: [{album_id,name,artist,art,value}] — `value` is now kept.
create or replace function public.bid_war_create_from(
  p_initiator uuid, p_opponent uuid, p_records jsonb, p_mode text default 'streams')
returns public.bid_wars
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_war public.bid_wars;
begin
  if p_initiator is null or p_opponent is null then raise exception 'Missing player'; end if;
  if p_initiator = p_opponent then raise exception 'You cannot challenge yourself'; end if;
  if p_mode not in ('streams', 'market') then raise exception 'Unknown mode: %', p_mode; end if;
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

  -- The records go in whole. This is the one line that changed: it used to be
  -- `r - 'value'`, stripping the number the players are now meant to see.
  insert into public.bid_wars (initiator_id, opponent_id, records, mode)
  values (p_initiator, p_opponent, p_records, p_mode)
  returning * into v_war;

  insert into public.bid_war_values (war_id, album_id, value)
  select v_war.id, r->>'album_id', (r->>'value')::bigint
  from jsonb_array_elements(p_records) r;

  insert into public.notifications (user_id, actor_id, type, data)
  select p_opponent, p_initiator, 'bid_war_challenge',
         jsonb_build_object('username', coalesce(p.username, 'someone'),
                            'avatar_url', coalesce(p.avatar_url, ''),
                            'war_id', v_war.id,
                            'mode', p_mode)
  from public.profiles p where p.id = p_initiator;

  return v_war;
end;
$$;

revoke all on function public.bid_war_create_from(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.bid_war_create_from(uuid, uuid, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- Market mode's cache
-- ---------------------------------------------------------------------------
-- Same shape and same isolation as album_plays. Kept separate rather than
-- widening that table, because the two have different staleness: a stream total
-- only goes up and a fortnight of drift is nothing, whereas a Discogs asking
-- price moves with what is actually for sale that week.
--
-- Prices are stored in minor units (pence/cents) as bigint, because
-- bid_war_values.value is bigint and a war value of 2.19 would truncate to 2.
create table if not exists public.album_market (
  album_id     text primary key,
  name         text,
  artist       text,
  release_id   text,
  price_minor  bigint,
  currency     text,
  have         integer,
  want         integer,
  rating_avg   numeric(3,2),
  rating_count integer,
  source       text not null default 'discogs',
  fetched_at   timestamptz not null default now()
);

-- RLS on, no policies: unreachable from the browser, exactly like album_plays.
alter table public.album_market enable row level security;
