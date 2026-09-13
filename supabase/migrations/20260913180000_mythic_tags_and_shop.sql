-- Five rarities everyone already knows the names of, a Mythic tier worth
-- chasing, producer tags, and a Shop that sells more than wallpaper.
--
-- ---------------------------------------------------------------------------
-- 1. The ladder, renamed
-- ---------------------------------------------------------------------------
-- The crate-digger names (Bargain Bin / B-Side / Deep Cut / White Label / Holy
-- Grail) read well and nobody could rank them on sight. Half the point of a
-- rarity is that you know instantly where it sits, and that only works with
-- names people have already learnt somewhere else:
--
--   Common      30%
--   Rare        25%
--   Epic        20%
--   Legendary   15%
--   Mythic      10%
--
-- Weights sum to 1000, so the percentages are exact rather than rounded. The
-- odds table is gone from the page, but `spin_items` is still publicly
-- readable and the server still draws from these exact rows -- the disclosure
-- moved out of the UI, it did not stop being true. See the note in section 2.
--
-- ---------------------------------------------------------------------------
-- 2. What Mythic pays, and why the spin now costs 2,000
-- ---------------------------------------------------------------------------
-- Mythic is three things and nothing else:
--
--   * 100,000 Discs  -- 0.6% absolute. About one spin in 167, which at 2,000
--                       a spin is ~334,000 Discs of expected outlay for a
--                       100,000 payout. It is the tell-people-about-it prize,
--                       and it has to be rare enough that telling people about
--                       it means something.
--   * 3 albums of your choice -- 3.4%. Three records into your Collection at
--                       their real price, free. Views is 10,248 Discs, so this
--                       is worth ~25,000 to a net worth.
--   * A producer tag -- 6%. A random one you do not own yet.
--
-- The expected return per spin across the whole pool is ~1,788 Discs against a
-- 2,000 cost, so The Draw stays a sink even for somebody who owns every
-- cosmetic and therefore converts every duplicate to Discs. That margin is the
-- whole safety property: an economy whose only sink pays out more than it
-- takes is not a sink, it is a printer.
--
-- The reason picked records cannot be sold (section 5) is exactly this sum. At
-- a 70% refund, three free records are ~17,500 Discs of arbitrage, which on
-- its own would flip the pool from a sink to a faucet.
--
-- Odds are still published in the sense that matters -- `spin_items` has a
-- public select policy and the numbers above are the numbers in the table. The
-- on-page odds panel was removed at the owner's request. If VINALL ever goes
-- to the App Store, guideline 3.1.1 wants disclosed odds for anything loot-box
-- shaped, so that panel comes back before submission.
--
-- ---------------------------------------------------------------------------
-- 3. Producer tags, and why they are not `profiles.badges`
-- ---------------------------------------------------------------------------
-- `profiles.badges` already exists and holds status markers -- CEO, OG, Beta
-- Tester, Verified. Those are awarded and mean something about the account.
-- These are bought and mean something about taste, so they are a separate
-- column (`owned_tags` / `active_tag`) rather than a second meaning stacked
-- onto the same array. Mixing them would make "Verified" purchasable, which is
-- the one thing a verification marker must never be.

-- ------------------------------------------------------------------ columns
alter table public.profiles
  add column if not exists owned_tags   text[] not null default '{}'::text[],
  add column if not exists active_tag   text,
  add column if not exists owned_flairs text[] not null default '{}'::text[],
  add column if not exists active_flair text,
  add column if not exists owned_frames text[] not null default '{}'::text[],
  add column if not exists active_frame text,
  -- Free-record entitlements. Mythic only; deliberately not purchasable.
  add column if not exists album_picks  integer not null default 0;

-- ------------------------------------------------------------------- tiers
-- Order matters and is easy to get wrong: `add constraint` validates against
-- existing rows immediately, so the old rows have to be gone BEFORE the new
-- check exists. Adding it first fails with 23514 every time.
alter table public.spin_items drop constraint if exists spin_items_tier_check;
alter table public.spin_items drop constraint if exists spin_items_kind_check;

delete from public.spin_items;

alter table public.spin_items
  add constraint spin_items_tier_check
  check (tier in ('common', 'rare', 'epic', 'legendary', 'mythic'));
alter table public.spin_items
  add constraint spin_items_kind_check
  check (kind in ('discs', 'theme', 'banner', 'banner_pick', 'flair', 'frame', 'tag', 'picks'));

insert into public.spin_items (key, kind, label, amount, ref, weight, tier) values
  -- Common — 300/1000
  ('d400',      'discs',       '400 Discs',        400,    null,      170, 'common'),
  ('d800',      'discs',       '800 Discs',        800,    null,      130, 'common'),
  -- Rare — 250/1000
  ('d1600',     'discs',       '1,600 Discs',      1600,   null,      120, 'rare'),
  ('b_mono',    'banner',      'Mono Fade',        320,    'mono',     65, 'rare'),
  ('fr_sleeve', 'frame',       'Card Sleeve',      700,    'sleeve',   65, 'rare'),
  -- Epic — 200/1000
  ('d3000',     'discs',       '3,000 Discs',      3000,   null,      100, 'epic'),
  ('b_dusk',    'banner',      'Dusk',             560,    'dusk',     50, 'epic'),
  ('fl_foil',   'flair',       'Gold Foil',        900,    'foil',     50, 'epic'),
  -- Legendary — 150/1000
  ('t_vhs',     'theme',       'VHS Tracking',     1200,   'vhs',      45, 'legendary'),
  ('b_static',  'banner',      'Static',           720,    'static',   40, 'legendary'),
  ('d5000',     'discs',       '5,000 Discs',      5000,   null,       40, 'legendary'),
  ('album',     'banner_pick', 'Album banner',     0,      null,       25, 'legendary'),
  -- Mythic — 100/1000
  ('tag',       'tag',         'Producer tag',     2000,   null,       60, 'mythic'),
  ('picks3',    'picks',       '3 albums, free',   0,      null,       34, 'mythic'),
  ('d100000',   'discs',       '100,000 Discs',    100000, null,        6, 'mythic')
on conflict (key) do update set
  kind = excluded.kind, label = excluded.label, amount = excluded.amount,
  ref = excluded.ref, weight = excluded.weight, tier = excluded.tier;

-- --------------------------------------------------------------- shop kinds
alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items
  add constraint shop_items_kind_check
  check (kind in ('theme', 'banner', 'tag', 'flair', 'frame', 'boost'));

-- Producer tags. Every one of these is also what the Mythic `tag` prize draws
-- from, so buying the shop empties the prize pool -- which is the point: once
-- you own them all, the Mythic tag pays its price back in Discs instead.
insert into public.shop_items (kind, key, name, cost) values
  -- The house's own, cheapest in
  ('tag','crate',      'STRAIGHT OUT THE CRATE',              600),
  ('tag','needle',     'DROP THE NEEDLE',                     600),
  ('tag','noskips',    'NO SKIPS',                            900),
  ('tag','dollarbin',  'DOLLAR BIN DIGGER',                   900),
  ('tag','promo',      'PROMO USE ONLY',                     1500),
  ('tag','asintended', 'MONO. AS INTENDED.',                 2000),
  ('tag','firstpress', 'FIRST PRESS',                        2000),
  -- The real ones
  ('tag','pluh',       'pluh',                                800),
  ('tag','lit',        'IT’S LIT',                           800),
  ('tag','twentyone',  '21',                                  900),
  ('tag','mustard',    'MUSTARD ON THE BEAT',                1200),
  ('tag','pluto',      'PLUTO',                              1200),
  ('tag','sremm',      'SREMMLIFE!',                         1400),
  ('tag','maybach',    'M-M-M-MAYBACH MUSIC',                1600),
  ('tag','biscuits',   'IT’S BISCUITS, IT’S GRAVY',        1600),
  ('tag','profit',     'I GOT TOO MUCH PROFIT',              1800),
  ('tag','carti',      'CASH CARTI B!TCH',                   2000),
  ('tag','taykeith',   'TAY KEITH, FTNU',                    2400),
  ('tag','pierre',     'YO PIERRE, YOU WANNA COME OUT HERE?',2800),
  ('tag','metro',      'IF YOUNG METRO DON’T TRUST YOU',    3200),
  -- Name flair: how your username renders
  ('flair','foil',     'Gold Foil',                           900),
  ('flair','chrome',   'Chrome',                              900),
  ('flair','phosphor', 'Phosphor',                           1200),
  ('flair','ember',    'Ember',                              1200),
  ('flair','bleed',    'Ink Bleed',                          1600),
  ('flair','holo',     'Holographic',                        2400),
  -- Avatar frames
  ('frame','sleeve',   'Card Sleeve',                         700),
  ('frame','groove',   'Groove',                              900),
  ('frame','gold',     'Gold Ring',                          1200),
  ('frame','splice',   'Splice',                             1400),
  ('frame','spindle',  'Spindle',                            1600),
  -- Boosts: repeatable, not owned. The only bottomless part of the Shop.
  ('boost','freeze',     'Streak Freeze',                    1200),
  ('boost','bannerpick', 'Album Banner Pick',                3000)
on conflict (kind, key) do update set name = excluded.name, cost = excluded.cost;

-- --------------------------------------------------------------- the pin
-- Three more owned arrays and three more equipped slots, pinned the same way
-- as themes and banners: the client may equip, never grant. `album_picks` is
-- pinned outright -- it is an entitlement worth ~25,000 Discs of records, so a
-- client that could write it would be a client that owns the leaderboard.
--
-- The escape hatch is `current_user`, NOT auth.role(). See
-- 20260909160000_fix_economy_pin.sql: auth.role() reads the request's JWT
-- claim, which is identical on both sides of a security-definer boundary, so
-- a check based on it never fires and silently reverts every server write.
create or replace function public.pin_profile_economy()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    if tg_op = 'UPDATE' and coalesce(new.discs, 0) > coalesce(old.discs, 0) then
      new.lifetime_xp := coalesce(old.lifetime_xp, 0) + (coalesce(new.discs, 0) - coalesce(old.discs, 0));
      new.level := public.level_for_xp(new.lifetime_xp);
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.is_admin            := false;
    new.discs               := 0;
    new.streak_current      := 0;
    new.streak_best         := 0;
    new.streak_last_date    := null;
    new.streak_freezes      := 1;
    new.owned_themes        := '{classic}'::text[];
    new.owned_banners       := '{}'::text[];
    new.owned_tags          := '{}'::text[];
    new.owned_flairs        := '{}'::text[];
    new.owned_frames        := '{}'::text[];
    new.rating_awards_count := 0;
    new.lore_awards_count   := 0;
    new.game_awards_date    := null;
    new.game_awards         := '{}'::jsonb;
    new.login_streak        := 0;
    new.login_best          := 0;
    new.login_last_date     := null;
    new.banner_picks        := 0;
    new.album_picks         := 0;
    new.lifetime_xp         := 0;
    new.level               := 1;
    return new;
  end if;

  new.is_admin            := old.is_admin;
  new.discs               := old.discs;
  new.streak_current      := old.streak_current;
  new.streak_best         := old.streak_best;
  new.streak_last_date    := old.streak_last_date;
  new.streak_freezes      := old.streak_freezes;
  new.owned_themes        := old.owned_themes;
  new.owned_banners       := old.owned_banners;
  new.owned_tags          := old.owned_tags;
  new.owned_flairs        := old.owned_flairs;
  new.owned_frames        := old.owned_frames;
  new.rating_awards_date  := old.rating_awards_date;
  new.rating_awards_count := old.rating_awards_count;
  new.lore_awards_date    := old.lore_awards_date;
  new.lore_awards_count   := old.lore_awards_count;
  new.game_awards_date    := old.game_awards_date;
  new.game_awards         := old.game_awards;
  new.login_streak        := old.login_streak;
  new.login_best          := old.login_best;
  new.login_last_date     := old.login_last_date;
  new.banner_picks        := old.banner_picks;
  new.album_picks         := old.album_picks;
  new.lifetime_xp         := old.lifetime_xp;
  new.level               := old.level;

  if new.active_theme is not null
     and new.active_theme <> 'classic'
     and not (new.active_theme = any(coalesce(new.owned_themes, '{}'::text[]))) then
    new.active_theme := old.active_theme;
  end if;
  if new.active_banner is not null
     and not (new.active_banner = any(coalesce(new.owned_banners, '{}'::text[]))) then
    new.active_banner := old.active_banner;
  end if;
  if new.active_tag is not null
     and not (new.active_tag = any(coalesce(new.owned_tags, '{}'::text[]))) then
    new.active_tag := old.active_tag;
  end if;
  if new.active_flair is not null
     and not (new.active_flair = any(coalesce(new.owned_flairs, '{}'::text[]))) then
    new.active_flair := old.active_flair;
  end if;
  if new.active_frame is not null
     and not (new.active_frame = any(coalesce(new.owned_frames, '{}'::text[]))) then
    new.active_frame := old.active_frame;
  end if;

  return new;
end;
$$;

drop trigger if exists pin_profile_economy on public.profiles;
create trigger pin_profile_economy
  before insert or update on public.profiles
  for each row execute function public.pin_profile_economy();

-- ---------------------------------------------------------------- buying
-- Same contract as before: the client names a kind and a key, never a price.
-- Three new owned arrays, plus 'boost' -- which owns nothing and can be bought
-- again and again. That repeatability is the point. Every other thing in the
-- Shop can be finished; boosts are what stop a maxed-out account from having
-- nowhere left to put its Discs.
create or replace function public.wallet_buy(p_kind text, p_key text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  p       public.profiles;
  v_cost  integer;
  v_owned text[];
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select cost into v_cost from public.shop_items where kind = p_kind and key = p_key;
  if v_cost is null then raise exception 'No such item'; end if;

  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;

  if p_kind <> 'boost' then
    v_owned := case p_kind
      when 'theme'  then coalesce(p.owned_themes,  '{}'::text[])
      when 'banner' then coalesce(p.owned_banners, '{}'::text[])
      when 'tag'    then coalesce(p.owned_tags,    '{}'::text[])
      when 'flair'  then coalesce(p.owned_flairs,  '{}'::text[])
      when 'frame'  then coalesce(p.owned_frames,  '{}'::text[])
      else '{}'::text[] end;
    if p_key = any(v_owned) then raise exception 'Already owned'; end if;
  end if;

  if not coalesce(p.is_admin, false) and coalesce(p.discs, 0) < v_cost then
    raise exception 'Not enough Discs';
  end if;

  update public.profiles set
    discs = case when coalesce(is_admin, false) then discs else coalesce(discs, 0) - v_cost end,
    owned_themes  = case when p_kind = 'theme'  then array_append(coalesce(owned_themes,  '{}'::text[]), p_key) else owned_themes  end,
    owned_banners = case when p_kind = 'banner' then array_append(coalesce(owned_banners, '{}'::text[]), p_key) else owned_banners end,
    owned_tags    = case when p_kind = 'tag'    then array_append(coalesce(owned_tags,    '{}'::text[]), p_key) else owned_tags    end,
    owned_flairs  = case when p_kind = 'flair'  then array_append(coalesce(owned_flairs,  '{}'::text[]), p_key) else owned_flairs  end,
    owned_frames  = case when p_kind = 'frame'  then array_append(coalesce(owned_frames,  '{}'::text[]), p_key) else owned_frames  end,
    -- Boosts are consumed straight into the thing they top up.
    streak_freezes = case when p_kind = 'boost' and p_key = 'freeze'
                          then coalesce(streak_freezes, 0) + 1 else streak_freezes end,
    banner_picks   = case when p_kind = 'boost' and p_key = 'bannerpick'
                          then coalesce(banner_picks, 0) + 1 else banner_picks end
  where id = v_me
  returning * into p;

  return jsonb_build_object('ok', true, 'discs', p.discs,
                            'owned_themes', p.owned_themes, 'owned_banners', p.owned_banners,
                            'owned_tags', p.owned_tags, 'owned_flairs', p.owned_flairs,
                            'owned_frames', p.owned_frames,
                            'streak_freezes', p.streak_freezes,
                            'banner_picks', p.banner_picks, 'album_picks', p.album_picks,
                            'lifetime_xp', p.lifetime_xp, 'level', p.level);
end $$;

revoke all on function public.wallet_buy(text, text) from public, anon;
grant execute on function public.wallet_buy(text, text) to authenticated;

-- ---------------------------------------------------------------- the spin
create or replace function public.wallet_spin()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  p        public.profiles;
  v_cost   integer := 2000;
  v_total  integer;
  v_roll   integer;
  v_acc    integer := 0;
  v_item   public.spin_items;
  v_gain   integer := 0;
  v_dupe   boolean := false;
  v_ref    text;
  v_shown  text;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;
  if not coalesce(p.is_admin, false) and coalesce(p.discs, 0) < v_cost then
    raise exception 'That costs % Discs', v_cost;
  end if;

  select sum(weight) into v_total from public.spin_items;
  if coalesce(v_total, 0) < 1 then raise exception 'Nothing to win'; end if;

  -- Weighted pick, walked server-side. random() here rather than anywhere the
  -- client can reach: a browser that picked its own prize would be a browser
  -- that always drew a Mythic.
  v_roll := floor(random() * v_total) + 1;
  for v_item in select * from public.spin_items order by key loop
    v_acc := v_acc + v_item.weight;
    exit when v_acc >= v_roll;
  end loop;

  -- Spend first, so a failure below cannot hand out a free spin.
  if not coalesce(p.is_admin, false) then
    p.discs := p.discs - v_cost;
  end if;

  v_ref   := v_item.ref;
  v_shown := v_item.label;

  if v_item.kind = 'discs' then
    p.discs := p.discs + v_item.amount;
    v_gain := v_item.amount;

  elsif v_item.kind = 'banner_pick' then
    p.banner_picks := coalesce(p.banner_picks, 0) + 1;

  elsif v_item.kind = 'picks' then
    -- The Mythic worth the most to a Collection: three records at their real
    -- price, free. Deliberately three rather than one, because "an album of
    -- your choice" is already what a seven-day streak pays and a Mythic has to
    -- be visibly a different order of thing.
    p.album_picks := coalesce(p.album_picks, 0) + 3;

  elsif v_item.kind = 'tag' then
    -- A tag prize has no fixed ref: it grants a random one you do not own yet,
    -- drawn from the same shop rows you could otherwise buy. Own them all and
    -- it pays its price in Discs instead, which is what stops the top of the
    -- ladder becoming worthless to a completed account.
    select key into v_ref
      from public.shop_items
     where kind = 'tag'
       and not (key = any(coalesce(p.owned_tags, '{}'::text[])))
     order by random() limit 1;

    if v_ref is null then
      v_dupe := true;
      v_ref  := null;
      p.discs := p.discs + v_item.amount;
      v_gain := v_item.amount;
    else
      select name into v_shown from public.shop_items where kind = 'tag' and key = v_ref;
      p.owned_tags := (select array(select distinct unnest(coalesce(p.owned_tags, '{}'::text[]) || v_ref)));
    end if;

  elsif v_item.kind in ('theme', 'banner', 'flair', 'frame') then
    -- Owning it already must not mean winning nothing. A duplicate pays its
    -- shop price back in Discs, which is the only thing keeping the rare tiers
    -- worth landing on once you have them.
    if v_ref = any(coalesce(
         case v_item.kind
           when 'theme'  then p.owned_themes
           when 'banner' then p.owned_banners
           when 'flair'  then p.owned_flairs
           else p.owned_frames end, '{}'::text[])) then
      v_dupe := true;
      p.discs := p.discs + v_item.amount;
      v_gain := v_item.amount;
    elsif v_item.kind = 'theme' then
      p.owned_themes := (select array(select distinct unnest(coalesce(p.owned_themes, '{}'::text[]) || v_ref)));
    elsif v_item.kind = 'banner' then
      p.owned_banners := (select array(select distinct unnest(coalesce(p.owned_banners, '{}'::text[]) || v_ref)));
    elsif v_item.kind = 'flair' then
      p.owned_flairs := (select array(select distinct unnest(coalesce(p.owned_flairs, '{}'::text[]) || v_ref)));
    else
      p.owned_frames := (select array(select distinct unnest(coalesce(p.owned_frames, '{}'::text[]) || v_ref)));
    end if;
  end if;

  update public.profiles set
    discs         = p.discs,
    owned_themes  = p.owned_themes,
    owned_banners = p.owned_banners,
    owned_tags    = p.owned_tags,
    owned_flairs  = p.owned_flairs,
    owned_frames  = p.owned_frames,
    banner_picks  = p.banner_picks,
    album_picks   = p.album_picks
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'cost', case when coalesce(p.is_admin, false) then 0 else v_cost end,
    'key', v_item.key, 'kind', v_item.kind, 'label', v_item.label,
    -- What actually landed. For a tag this is the tag's own name, which is not
    -- knowable from the strip -- the tile says "Producer tag" and the result
    -- says which one.
    'granted', v_shown, 'ref', v_ref, 'tier', v_item.tier,
    'gained', v_gain, 'duplicate', v_dupe,
    'discs', p.discs, 'banner_picks', p.banner_picks, 'album_picks', p.album_picks,
    'owned_themes', p.owned_themes, 'owned_banners', p.owned_banners,
    'owned_tags', p.owned_tags, 'owned_flairs', p.owned_flairs,
    'owned_frames', p.owned_frames,
    'lifetime_xp', p.lifetime_xp, 'level', p.level);
end $$;

revoke all on function public.wallet_spin() from public, anon;
grant execute on function public.wallet_spin() to authenticated;

-- ------------------------------------------------------- 5. free records
-- A record claimed with an album pick is marked, and a marked record cannot be
-- sold. Without that, three free records are ~17,500 Discs at the 70% refund,
-- which on its own would make The Draw pay out more than it takes in -- see
-- the sum in section 2. It also reads correctly: a Mythic prize is a trophy,
-- not a bag of Discs with an album cover on it.
alter table public.collection
  add column if not exists via_pick boolean not null default false;

-- Service-role only, exactly like collection_buy_from: /api/collection-buy
-- values the album and calls this. A client that could name its own album AND
-- its own price would be a client with an unbounded net worth.
create or replace function public.collection_claim_pick_from(
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

  select * into p from public.profiles where id = p_user for update;
  if p.id is null then raise exception 'No profile'; end if;
  if coalesce(p.album_picks, 0) < 1 then raise exception 'You have no album picks left'; end if;

  if exists (select 1 from public.collection where user_id = p_user and album_id = p_album_id) then
    raise exception 'You already own that one';
  end if;

  insert into public.collection (user_id, album_id, name, artist, art, price, via_pick)
  values (p_user, p_album_id, coalesce(p_name, 'Unknown'), p_artist, p_art, p_price, true);

  update public.profiles set album_picks = album_picks - 1
   where id = p_user returning * into p;

  return jsonb_build_object(
    'ok', true, 'album_id', p_album_id, 'price', p_price, 'via_pick', true,
    'discs', p.discs, 'album_picks', p.album_picks,
    'net_worth', (select coalesce(sum(price), 0) from public.collection where user_id = p_user),
    'owned', (select count(*) from public.collection where user_id = p_user));
end $$;

revoke all on function public.collection_claim_pick_from(uuid, text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.collection_claim_pick_from(uuid, text, text, text, text, bigint)
  to service_role;

create or replace function public.collection_sell(p_album_id text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := auth.uid();
  v_row  public.collection;
  v_back bigint;
  p      public.profiles;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into v_row from public.collection
   where user_id = v_me and album_id = p_album_id;
  if v_row.album_id is null then raise exception 'You do not own that'; end if;
  if coalesce(v_row.via_pick, false) then
    raise exception 'That one was a Mythic pick — it is yours to keep, not to sell';
  end if;

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
