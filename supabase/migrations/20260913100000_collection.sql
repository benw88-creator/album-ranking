-- The Collection: buy records with Discs, hold them, build a net worth.
--
-- ---------------------------------------------------------------------------
-- What this is
-- ---------------------------------------------------------------------------
-- Every record has a price. You buy it with Discs, you own it permanently, and
-- what you hold adds up to a net worth that ranks you against everyone else.
--
-- It is deliberately NOT exclusive: two people can own the same album. A
-- one-owner-per-record version is a far sharper game, but it needs a way to
-- take a record off somebody, and without that the first week permanently
-- decides the standings.
--
-- The distinction from Bid Wars is worth keeping clear. A war is a match: it
-- starts, it resolves, the records were never yours. This is a position you
-- hold. The same valuation feeds both, which is the point — knowing what a
-- record is worth pays off in two different games.
--
-- ---------------------------------------------------------------------------
-- Why price never comes from the browser
-- ---------------------------------------------------------------------------
-- `collection_buy_from` is service-role only, and the only caller is
-- /api/collection-buy, which values the album itself from kworb. A client that
-- could name its own price could buy Views for one Disc. Same rule as
-- wallet_buy taking a key and never a cost, and bid_war_create_from being
-- unreachable from the browser.
--
-- Selling refunds 70% of what the record cost. Churning a collection should
-- cost something, or "net worth" just measures how many times you have been
-- round the loop.

create table if not exists public.collection (
  user_id    uuid   not null references auth.users(id) on delete cascade,
  album_id   text   not null,
  name       text   not null,
  artist     text,
  art        text,
  -- What it cost, in Discs. Prices are fixed, so this is also what it is worth
  -- and what a net worth sums — no second lookup, no drift between the two.
  price      bigint not null check (price >= 0),
  bought_at  timestamptz not null default now(),
  primary key (user_id, album_id)
);

create index if not exists collection_user_idx  on public.collection (user_id, bought_at desc);
create index if not exists collection_album_idx on public.collection (album_id);

alter table public.collection enable row level security;

-- Collections are public, like ratings: the whole point is that other people
-- can see what you have built. Writing is another matter — there is no INSERT
-- or UPDATE policy at all, so the only way in is the definer functions below.
drop policy if exists "collections are public" on public.collection;
create policy "collections are public" on public.collection for select using (true);

-- ---------------------------------------------------------------- buying
-- Called only by /api/collection-buy, with a price that route computed.
create or replace function public.collection_buy_from(
  p_user uuid, p_album_id text, p_name text, p_artist text, p_art text, p_price bigint)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  p public.profiles;
begin
  if p_user is null or p_album_id is null then raise exception 'Missing album'; end if;
  if p_price is null or p_price < 0 then raise exception 'Bad price'; end if;

  if exists (select 1 from public.collection where user_id = p_user and album_id = p_album_id) then
    raise exception 'You already own that one';
  end if;

  select * into p from public.profiles where id = p_user for update;
  if p.id is null then raise exception 'No profile'; end if;
  if not coalesce(p.is_admin, false) and coalesce(p.discs, 0) < p_price then
    raise exception 'That costs % Discs and you have %', p_price, coalesce(p.discs, 0);
  end if;

  insert into public.collection (user_id, album_id, name, artist, art, price)
  values (p_user, p_album_id, coalesce(p_name, 'Unknown'), p_artist, p_art, p_price);

  if not coalesce(p.is_admin, false) then
    update public.profiles set discs = discs - p_price where id = p_user returning * into p;
  end if;

  return jsonb_build_object(
    'ok', true, 'album_id', p_album_id, 'price', p_price,
    'discs', p.discs,
    'net_worth', (select coalesce(sum(price), 0) from public.collection where user_id = p_user),
    'owned', (select count(*) from public.collection where user_id = p_user));
end $$;

revoke all on function public.collection_buy_from(uuid, text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.collection_buy_from(uuid, text, text, text, text, bigint)
  to service_role;

-- ---------------------------------------------------------------- selling
-- No price in the request: the refund is derived from the row, which was
-- written by the server. Safe to expose directly to a signed-in client.
create or replace function public.collection_sell(p_album_id text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  v_row   public.collection;
  v_back  bigint;
  p       public.profiles;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into v_row from public.collection
   where user_id = v_me and album_id = p_album_id;
  if v_row.album_id is null then raise exception 'You do not own that'; end if;

  -- 70%, rounded down. The 30% is the whole reason holding means anything.
  v_back := floor(v_row.price * 0.7);

  delete from public.collection where user_id = v_me and album_id = p_album_id;
  update public.profiles set discs = coalesce(discs, 0) + v_back
   where id = v_me returning * into p;

  return jsonb_build_object(
    'ok', true, 'album_id', p_album_id, 'refund', v_back, 'paid', v_row.price,
    'discs', p.discs,
    'net_worth', (select coalesce(sum(price), 0) from public.collection where user_id = v_me),
    'owned', (select count(*) from public.collection where user_id = v_me));
end $$;

revoke all on function public.collection_sell(text) from public, anon;
grant execute on function public.collection_sell(text) to authenticated;

-- ---------------------------------------------------------------- standings
-- Net worth for anybody, and the table of everybody. Definer because it reads
-- across users; it returns nothing that is not already public, since the
-- collection table is readable and usernames are on public profiles.
create or replace function public.collection_net_worth(p_user uuid default auth.uid())
returns jsonb
language sql security definer stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'net_worth', coalesce(sum(price), 0),
    'owned', count(*),
    'best', (select jsonb_build_object('name', name, 'artist', artist, 'art', art, 'price', price)
               from public.collection where user_id = p_user order by price desc limit 1))
  from public.collection where user_id = p_user;
$$;

create or replace function public.collection_leaderboard(p_limit integer default 25)
returns table (
  user_id uuid, username text, avatar_url text,
  net_worth bigint, owned bigint, level integer
)
language sql security definer stable
set search_path = public, pg_temp
as $$
  select c.user_id,
         coalesce(pr.username, 'someone'),
         coalesce(pr.avatar_url, ''),
         sum(c.price)::bigint,
         count(*)::bigint,
         coalesce(pr.level, 1)
  from public.collection c
  join public.profiles pr on pr.id = c.user_id
  group by c.user_id, pr.username, pr.avatar_url, pr.level
  order by sum(c.price) desc
  limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

revoke all on function public.collection_net_worth(uuid)     from public, anon;
revoke all on function public.collection_leaderboard(integer) from public, anon;
grant execute on function public.collection_net_worth(uuid)     to authenticated;
grant execute on function public.collection_leaderboard(integer) to authenticated;

-- ---------------------------------------------------------------- deletion
-- A table holding user rows means a line in delete_my_data(). Missing this is
-- how app_state survived account deletion for weeks.
create or replace function public.delete_my_data()
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  t    text;
  c    text;
  pairs text[][] := array[
    ['lore_answers','user_id'], ['ratings','user_id'], ['crate_feed','user_id'],
    ['feed_likes','user_id'], ['feed_comments','user_id'], ['follows','follower_id'],
    ['follows','following_id'], ['groove_members','user_id'], ['grooves','owner_id'],
    ['lists','user_id'], ['leaderboard_times','user_id'], ['analytics_events','user_id'],
    ['reports','reporter_id'], ['blocks','blocker_id'], ['blocks','blocked_id'],
    ['notifications','user_id'], ['notifications','actor_id'],
    ['app_state','user_id'], ['listening_plays','user_id'], ['collection','user_id']
  ];
  i int;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  for i in 1 .. array_length(pairs, 1) loop
    t := pairs[i][1];
    c := pairs[i][2];
    if to_regclass('public.' || t) is not null
       and exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = t and column_name = c) then
      execute format('delete from public.%I where %I = $1', t, c) using v_me;
    end if;
  end loop;

  delete from public.profiles where id = v_me;
end;
$$;

revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
