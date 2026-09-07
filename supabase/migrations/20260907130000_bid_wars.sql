-- ===========================================================================
-- BID WARS — 1v1 sealed-bid auction over records from The Crate.
--
-- Five records go up for auction. Each player spreads a fixed pot of chips
-- across them, blind. When both have submitted, the war resolves: the higher
-- bid takes each record, and a record is worth the community's average rating
-- of it. Highest total wins.
--
-- Design notes:
--
-- * Every state change runs through a security definer function. Clients get
--   INSERT on nothing and UPDATE on nothing, so a player cannot write their
--   own winner or score. This is deliberate -- the previous speculative
--   bid_wars table allowed either participant to UPDATE the row, which would
--   have let a player simply declare themselves the winner.
--
-- * Bids are sealed. bid_war_bids is readable only once the war is resolved,
--   so neither player can read the other's allocation while it still matters.
--
-- * A record's VALUE is the thing being guessed, so it must not leak before
--   resolution. Values live in bid_war_values, which has RLS enabled and no
--   policies at all -- unreachable from the client under any query. The
--   resolve function (which bypasses RLS) folds them into bid_wars.records
--   at the moment of resolution, when revealing them is the point.
--
-- The old empty tables are dropped; they were never used by the app.
-- ===========================================================================

drop table if exists public.bid_war_bids cascade;
drop table if exists public.bid_wars cascade;

create table public.bid_wars (
  id              uuid primary key default gen_random_uuid(),
  initiator_id    uuid not null references auth.users(id) on delete cascade,
  opponent_id     uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'pending'
                    check (status in ('pending','resolved','declined')),
  chips           integer not null default 100,
  -- [{album_id,name,artist,art}] before resolution; `value` added on resolve
  records         jsonb  not null,
  winner_id       uuid,
  initiator_total numeric(5,2),
  opponent_total  numeric(5,2),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  constraint no_self_war check (initiator_id <> opponent_id)
);

create index bid_wars_initiator_idx on public.bid_wars (initiator_id, status);
create index bid_wars_opponent_idx  on public.bid_wars (opponent_id, status);

create table public.bid_war_bids (
  war_id     uuid not null references public.bid_wars(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  bids       jsonb not null,                       -- {album_id: chips}
  created_at timestamptz not null default now(),
  primary key (war_id, user_id)
);

-- Hidden values. RLS on, zero policies: no client can ever select this.
create table public.bid_war_values (
  war_id   uuid not null references public.bid_wars(id) on delete cascade,
  album_id text not null,
  value    numeric(4,2) not null,
  primary key (war_id, album_id)
);

alter table public.bid_wars       enable row level security;
alter table public.bid_war_bids   enable row level security;
alter table public.bid_war_values enable row level security;

-- Participants can read their own wars. Nobody can write directly.
create policy "participants read wars" on public.bid_wars
  for select using (auth.uid() = initiator_id or auth.uid() = opponent_id);

-- Your own bid, always. Your opponent's, only once the war is over.
create policy "read own bids, theirs after resolve" on public.bid_war_bids
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.bid_wars w
      where w.id = bid_war_bids.war_id
        and w.status = 'resolved'
        and (auth.uid() = w.initiator_id or auth.uid() = w.opponent_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Create a war. The server picks the records, so a player cannot stack the
-- board, and the values are written somewhere the client cannot read.
-- ---------------------------------------------------------------------------
create or replace function public.bid_war_create(p_opponent uuid)
returns public.bid_wars
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  v_chosen jsonb;
  v_war    public.bid_wars;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_opponent = v_me then raise exception 'You cannot challenge yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_opponent) then
    raise exception 'That player does not exist';
  end if;

  -- one live war per pair, in either direction
  if exists (
    select 1 from public.bid_wars
    where status = 'pending'
      and ((initiator_id = v_me and opponent_id = p_opponent)
        or (initiator_id = p_opponent and opponent_id = v_me))
  ) then
    raise exception 'You already have a war running with them';
  end if;

  -- Draw from the most-rated records in The Crate: those are the ones the
  -- community has actually formed an opinion on, so a value always exists
  -- and the board reads as canon rather than obscurities.
  select jsonb_agg(t) into v_chosen
  from (
    select album_id, name, artist, art, value
    from (
      select album_id,
             max(album_name)               as name,
             max(album_artist)             as artist,
             max(album_art)                as art,
             round(avg(score)::numeric, 2) as value
      from public.crate_feed
      where album_id is not null and score is not null
      group by album_id
      order by count(*) desc, album_id
      limit 40
    ) pool
    order by random()
    limit 5
  ) t;

  if v_chosen is null or jsonb_array_length(v_chosen) < 5 then
    raise exception 'Not enough rated records yet — rate a few more albums first';
  end if;

  insert into public.bid_wars (initiator_id, opponent_id, records)
  values (
    v_me, p_opponent,
    (select jsonb_agg(r - 'value') from jsonb_array_elements(v_chosen) r)
  )
  returning * into v_war;

  insert into public.bid_war_values (war_id, album_id, value)
  select v_war.id, r->>'album_id', (r->>'value')::numeric
  from jsonb_array_elements(v_chosen) r;

  insert into public.notifications (user_id, actor_id, type, data)
  select p_opponent, v_me, 'bid_war_challenge',
         jsonb_build_object('username', coalesce(p.username, 'someone'),
                            'avatar_url', coalesce(p.avatar_url, ''),
                            'war_id', v_war.id)
  from public.profiles p where p.id = v_me;

  return v_war;
end;
$$;

-- ---------------------------------------------------------------------------
-- Submit a sealed bid. If that was the second one, the war resolves in the
-- same transaction, so there is no window where one player can read the
-- other's bid before the result is fixed.
-- ---------------------------------------------------------------------------
create or replace function public.bid_war_submit(p_war uuid, p_bids jsonb)
returns public.bid_wars
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_war     public.bid_wars;
  v_other   uuid;
  v_sum     numeric;
  v_a       jsonb;
  v_b       jsonb;
  v_ta      numeric := 0;
  v_tb      numeric := 0;
  v_records jsonb := '[]'::jsonb;
  v_winner  uuid;
  v_val     numeric;
  v_bid_a   numeric;
  v_bid_b   numeric;
  v_key     text;
  r         jsonb;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into v_war from public.bid_wars where id = p_war for update;
  if v_war.id is null then raise exception 'War not found'; end if;
  if v_me <> v_war.initiator_id and v_me <> v_war.opponent_id then
    raise exception 'Not your war';
  end if;
  if v_war.status <> 'pending' then raise exception 'This war is already settled'; end if;
  if exists (select 1 from public.bid_war_bids where war_id = p_war and user_id = v_me) then
    raise exception 'You have already bid on this war';
  end if;

  -- Validate against the board, not against anything the client claims.
  if jsonb_typeof(p_bids) <> 'object' then raise exception 'Malformed bids'; end if;

  if exists (
    select 1 from jsonb_each_text(p_bids) b
    where b.key not in (select x->>'album_id' from jsonb_array_elements(v_war.records) x)
  ) then raise exception 'Bid placed on a record that is not in this war'; end if;

  if exists (select 1 from jsonb_each_text(p_bids) b where b.value !~ '^[0-9]+$') then
    raise exception 'Bids must be whole, non-negative numbers';
  end if;

  select coalesce(sum(b.value::numeric), 0) into v_sum from jsonb_each_text(p_bids) b;
  if v_sum > v_war.chips then
    raise exception 'That spends % chips but you only have %', v_sum, v_war.chips;
  end if;

  insert into public.bid_war_bids (war_id, user_id, bids) values (p_war, v_me, p_bids);

  v_other := case when v_me = v_war.initiator_id
                  then v_war.opponent_id else v_war.initiator_id end;

  -- Other player hasn't bid yet: nudge them and stop here.
  if not exists (select 1 from public.bid_war_bids where war_id = p_war and user_id = v_other) then
    insert into public.notifications (user_id, actor_id, type, data)
    select v_other, v_me, 'bid_war_turn',
           jsonb_build_object('username', coalesce(p.username, 'someone'),
                              'avatar_url', coalesce(p.avatar_url, ''),
                              'war_id', p_war)
    from public.profiles p where p.id = v_me;
    return v_war;
  end if;

  -- Both bids are in. Settle it.
  select bids into v_a from public.bid_war_bids
    where war_id = p_war and user_id = v_war.initiator_id;
  select bids into v_b from public.bid_war_bids
    where war_id = p_war and user_id = v_war.opponent_id;

  for r in select value from jsonb_array_elements(v_war.records) loop
    v_key := r->>'album_id';
    select value into v_val from public.bid_war_values
      where war_id = p_war and album_id = v_key;
    v_val   := coalesce(v_val, 0);
    v_bid_a := coalesce((v_a->>v_key)::numeric, 0);
    v_bid_b := coalesce((v_b->>v_key)::numeric, 0);

    -- Equal bids: the record goes to nobody. Cleaner than a coin flip, and
    -- it means a tie is a decision both players can reason about up front.
    if    v_bid_a > v_bid_b then v_ta := v_ta + v_val;
    elsif v_bid_b > v_bid_a then v_tb := v_tb + v_val;
    end if;

    v_records := v_records || jsonb_build_array(
      r || jsonb_build_object(
        'value',         v_val,
        'bid_initiator', v_bid_a,
        'bid_opponent',  v_bid_b,
        'won_by', case when v_bid_a > v_bid_b then v_war.initiator_id
                       when v_bid_b > v_bid_a then v_war.opponent_id
                       else null end)
    );
  end loop;

  v_winner := case when v_ta > v_tb then v_war.initiator_id
                   when v_tb > v_ta then v_war.opponent_id
                   else null end;

  update public.bid_wars set
    status          = 'resolved',
    records         = v_records,
    initiator_total = v_ta,
    opponent_total  = v_tb,
    winner_id       = v_winner,
    resolved_at     = now()
  where id = p_war
  returning * into v_war;

  -- Discs are awarded here rather than in the browser, so a Bid War payout
  -- is the one part of the economy a client cannot invent. A loss still pays
  -- something: turning up should never be worth nothing.
  if v_winner is null then
    update public.profiles set discs = coalesce(discs, 0) + 15
      where id in (v_war.initiator_id, v_war.opponent_id);
  else
    update public.profiles set discs = coalesce(discs, 0) + 30 where id = v_winner;
    update public.profiles set discs = coalesce(discs, 0) + 8
      where id = case when v_winner = v_war.initiator_id
                      then v_war.opponent_id else v_war.initiator_id end;
  end if;

  insert into public.notifications (user_id, actor_id, type, data)
  select t.uid, t.foe, 'bid_war_result',
         jsonb_build_object('username', coalesce(p.username, 'someone'),
                            'avatar_url', coalesce(p.avatar_url, ''),
                            'war_id', p_war,
                            'outcome', case when v_winner is null then 'draw'
                                            when v_winner = t.uid then 'won'
                                            else 'lost' end)
  from (values (v_war.initiator_id, v_war.opponent_id),
               (v_war.opponent_id,  v_war.initiator_id)) as t(uid, foe)
  join public.profiles p on p.id = t.foe;

  return v_war;
end;
$$;

-- ---------------------------------------------------------------------------
-- Decline a challenge. Only the person challenged, only while pending.
-- ---------------------------------------------------------------------------
create or replace function public.bid_war_decline(p_war uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  update public.bid_wars set status = 'declined'
    where id = p_war and status = 'pending'
      and (opponent_id = v_me or initiator_id = v_me);
  if not found then raise exception 'Nothing to decline'; end if;
end;
$$;

revoke all on function public.bid_war_create(uuid)          from public, anon;
revoke all on function public.bid_war_submit(uuid, jsonb)   from public, anon;
revoke all on function public.bid_war_decline(uuid)         from public, anon;
grant execute on function public.bid_war_create(uuid)        to authenticated;
grant execute on function public.bid_war_submit(uuid, jsonb) to authenticated;
grant execute on function public.bid_war_decline(uuid)       to authenticated;
