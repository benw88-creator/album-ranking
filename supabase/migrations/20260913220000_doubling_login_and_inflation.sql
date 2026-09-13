-- A doubling login ladder, a 5x pass on everything else, and the end of the
-- album banner.
--
-- ---------------------------------------------------------------------------
-- 1. The ladder
-- ---------------------------------------------------------------------------
--   Day 1   1,000        Day 5   16,000
--   Day 2   2,000        Day 6   32,000
--   Day 3   4,000        Day 7   one album of your choice, free
--   Day 4   8,000
--
-- 63,000 Discs and one free record per seven-day cycle, against the ~1,750 a
-- week the old flat ladder paid. That is a 36x rise in login income on its own,
-- which is why everything else in this file moves too.
--
-- **It cycles now, and it did not before.** `wallet_daily_login` used to pay
-- `least(100 + (streak-1)*50, 400)` — a plateau — while the Rewards page drew
-- `streak % 7`, a cycle. The two disagreed from day eight onwards and nothing
-- said so. Position is now `((streak - 1) % 7) + 1` in both places, so week two
-- pays the same ladder again and the page is drawing what the server pays.
-- The plateau also has to go for a second reason: a doubling ladder that never
-- resets is 2^n, and n gets large.
--
-- The ladder is an array rather than `1000 * 2^(pos-1)` so it reads as the
-- seven numbers it is, and so it cannot silently produce a float.
--
-- **Logging in now pays far more than playing does**, which is worth saying out
-- loud because this file is where it happened. The daily ceiling from every
-- game put together is ~16,100; day six alone is 32,000. CLAUDE.md's own note
-- says rewarding *opening the app* is a weaker thing than rewarding the rating
-- streak beside it, and this inverts that. It is what was asked for and the
-- rates are explicitly due another pass — but if only one number gets revisited
-- later, make it this one.
--
-- ---------------------------------------------------------------------------
-- 2. The 5x pass
-- ---------------------------------------------------------------------------
-- Ratings, lore, every minigame, every shop price, every stored balance, every
-- stored collection price, and the collection's stream divisor. Ratios between
-- all of them are untouched, so nothing gets easier or harder relative to
-- anything else — only relative to logging in.
--
-- `api/collection-buy.js` holds the other half of the divisor change:
-- streams / 1,250,000 becomes streams / 250,000. Change one without the other
-- and every record is either free or unbuyable.
--
-- Bid War payouts are the one thing NOT scaled here. See section 5.
--
-- ---------------------------------------------------------------------------
-- 3. The spin costs 1,000, and what that forced
-- ---------------------------------------------------------------------------
-- Halving the spin while multiplying the shop by five breaks the rule that a
-- duplicate pays its shop price back: a 1,000-Disc spin cannot hand out a
-- 6,000-Disc theme's worth of Discs thirty times in a hundred and stay a sink.
--
-- So the rule becomes **a duplicate pays 20% of its shop price**. Shop prices
-- go up 5x and the `amount` column stays exactly where it is, which is the
-- same thing said twice — no number in `spin_items.amount` changes for any
-- cosmetic.
--
-- The Disc prizes are cut to match. Expected return across the whole pool is
-- ~887 against the 1,000 cost, a ratio of 0.89 — the same margin the pool had
-- at 2,000. Worked out for the worst case, somebody who owns every drawable
-- cosmetic and so converts every duplicate to Discs:
--
--   Common     150 x170 + 300 x130                      =  64.5
--   Rare       500 x120 + mono 320 x65 + sleeve 700 x65  = 126.3
--   Epic      1000 x100 + dusk 560 x50 + foil 900 x50    = 173.0
--   Legendary 2000 x40 + vhs 1200 x45 + static 720 x40   = 162.8
--             + 1 album pick x25                         =   0
--   Mythic   100000 x3 + tag 1000 x60 + 3 picks x34      = 360.0
--                                                   total  886.6
--
-- **An economy whose only sink pays out more than it takes is not a sink, it
-- is a printer.** Redo this sum before changing any weight, any amount, or
-- `v_cost`.
--
-- ---------------------------------------------------------------------------
-- 4. The album banner is gone
-- ---------------------------------------------------------------------------
-- Day seven pays a free *record* now — one `album_picks`, the same entitlement
-- the Mythic "3 albums of your choice" grants — so the banner feature has no
-- remaining way in and is removed rather than left stranded.
--
-- What goes: `wallet_claim_album_banner`, the `bannerpick` boost, the Draw's
-- Legendary banner-pick prize (now one album pick, so picks run 1 at Legendary
-- and 3 at Mythic), and every `album:<url>` entry already sitting in somebody's
-- `owned_banners`. Outstanding `banner_picks` are **converted** to album picks
-- rather than voided — they were earned.
--
-- `profiles.banner_picks` itself stays, zeroed and still pinned. Dropping a
-- column on a live table to save nothing is a worse trade than leaving it.
--
-- CLAUDE.md called album banners "the sink that makes the inflation safe",
-- because every claim was a different object and so could not be finished.
-- **That argument has not gone away, it has moved**: album picks feed the
-- Collection, which is priced off stream counts and is equally bottomless. If
-- the Collection is ever removed, this file's inflation loses its floor.

-- ------------------------------------------------------------------- login
create or replace function public.wallet_daily_login()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  p        public.profiles;
  v_today  date := (now() at time zone 'utc')::date;
  v_gap    integer;
  v_earn   integer := 0;
  v_pick   boolean := false;
  v_first  boolean := false;
  v_pos    integer;
  -- Day seven pays no Discs at all: the record is the reward.
  v_ladder integer[] := array[1000, 2000, 4000, 8000, 16000, 32000, 0];
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;

  if p.login_last_date = v_today then
    return jsonb_build_object(
      'earned', 0, 'claimed_already', true, 'album_pick', false,
      'login_streak', p.login_streak, 'login_best', p.login_best,
      'album_picks', p.album_picks, 'discs', p.discs);
  end if;

  v_first := p.login_last_date is null;
  v_gap := case when p.login_last_date is null then null
                else v_today - p.login_last_date end;

  if v_gap = 1 then p.login_streak := p.login_streak + 1;
  else p.login_streak := 1; end if;
  p.login_best := greatest(coalesce(p.login_best, 0), p.login_streak);
  p.login_last_date := v_today;

  -- Position inside the current week of seven. Mirrored exactly by payFor()
  -- and the ladder render in the Rewards module.
  v_pos  := ((p.login_streak - 1) % 7) + 1;
  v_earn := v_ladder[v_pos];

  if v_pos = 7 then
    v_pick := true;
    p.album_picks := coalesce(p.album_picks, 0) + 1;
  end if;

  update public.profiles set
    discs           = coalesce(discs, 0) + v_earn,
    login_streak    = p.login_streak,
    login_best      = p.login_best,
    login_last_date = p.login_last_date,
    album_picks     = p.album_picks
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'earned', v_earn, 'claimed_already', false, 'album_pick', v_pick,
    'first_ever', v_first, 'day', v_pos,
    'login_streak', p.login_streak, 'login_best', p.login_best,
    'album_picks', p.album_picks, 'discs', p.discs,
    'owned_banners', p.owned_banners, 'owned_themes', p.owned_themes,
    'streak_current', p.streak_current, 'streak_best', p.streak_best,
    'lifetime_xp', p.lifetime_xp, 'level', p.level);
end $$;

revoke all on function public.wallet_daily_login() from public, anon;
grant execute on function public.wallet_daily_login() to authenticated;

-- ----------------------------------------------------------------- earning
create or replace function public.wallet_record_rating()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  p       public.profiles;
  v_today date := (now() at time zone 'utc')::date;
  v_gap   integer;
  v_earn  integer := 0;
  v_miles integer[] := array[7, 30, 100, 365];
  v_hit   integer := null;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;

  if p.rating_awards_date is distinct from v_today then
    p.rating_awards_date := v_today;
    p.rating_awards_count := 0;
  end if;

  -- Caps are the anti-forgery defence, not the balance lever. Move the amount,
  -- never the 10.
  if p.rating_awards_count < 10 then
    v_earn := 160;
    p.rating_awards_count := p.rating_awards_count + 1;
  end if;

  if p.streak_last_date is distinct from v_today then
    v_gap := case when p.streak_last_date is null then null
                  else v_today - p.streak_last_date end;
    if v_gap is null then
      p.streak_current := 1;
    elsif v_gap = 1 then
      p.streak_current := p.streak_current + 1;
    elsif v_gap > 1 then
      if coalesce(p.streak_freezes, 0) > 0 then
        p.streak_freezes := p.streak_freezes - 1;
        p.streak_current := p.streak_current + 1;
      else
        p.streak_current := 1;
      end if;
    end if;
    p.streak_best := greatest(coalesce(p.streak_best, 0), p.streak_current);
    p.streak_last_date := v_today;
    if p.streak_current = any(v_miles) then v_hit := p.streak_current; end if;
  end if;

  update public.profiles set
    discs = coalesce(discs, 0) + v_earn,
    streak_current = p.streak_current, streak_best = p.streak_best,
    streak_last_date = p.streak_last_date, streak_freezes = p.streak_freezes,
    rating_awards_date = p.rating_awards_date, rating_awards_count = p.rating_awards_count
  where id = v_me
  returning * into p;

  return jsonb_build_object('earned', v_earn, 'milestone', v_hit,
                            'discs', p.discs, 'streak_current', p.streak_current,
                            'streak_best', p.streak_best, 'streak_freezes', p.streak_freezes);
end $$;

create or replace function public.award_lore_disc()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_count integer;
begin
  if new.skipped or new.choice is null then return new; end if;

  select case when lore_awards_date is distinct from v_today then 0
              else coalesce(lore_awards_count, 0) end
    into v_count
  from public.profiles where id = new.user_id;

  if v_count is null or v_count >= 20 then return new; end if;

  update public.profiles set
    discs = coalesce(discs, 0) + 100,
    lore_awards_date = v_today, lore_awards_count = v_count + 1
  where id = new.user_id;

  return new;
end $$;

drop trigger if exists award_lore_disc on public.lore_answers;
create trigger award_lore_disc
  after insert on public.lore_answers
  for each row execute function public.award_lore_disc();

create or replace function public.wallet_award_game(p_game text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  p       public.profiles;
  v_today date := (now() at time zone 'utc')::date;
  v_amt   integer;
  v_cap   integer;
  v_used  integer;
  v_earn  integer := 0;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  case p_game
    when 'earworm'     then v_amt := 1000; v_cap := 3;
    when 'drop'        then v_amt := 1500; v_cap := 1;
    when 'tournament'  then v_amt :=  800; v_cap := 2;
    when 'achievement' then v_amt :=  800; v_cap := 5;
    when 'higherlower' then v_amt :=  800; v_cap := 3;
    else raise exception 'Unknown game: %', p_game;
  end case;

  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;

  if p.game_awards_date is distinct from v_today then
    p.game_awards_date := v_today;
    p.game_awards      := '{}'::jsonb;
  end if;

  v_used := coalesce((p.game_awards ->> p_game)::integer, 0);
  if v_used < v_cap then
    v_earn := v_amt;
    p.game_awards := p.game_awards || jsonb_build_object(p_game, v_used + 1);
  end if;

  update public.profiles set
    discs = coalesce(discs, 0) + v_earn,
    game_awards_date = p.game_awards_date, game_awards = p.game_awards
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'earned', v_earn, 'capped', (v_earn = 0), 'discs', p.discs,
    'streak_current', p.streak_current, 'streak_best', p.streak_best,
    'streak_freezes', p.streak_freezes,
    'owned_themes', p.owned_themes, 'owned_banners', p.owned_banners);
end $$;

revoke all on function public.wallet_award_game(text) from public, anon;
grant execute on function public.wallet_award_game(text) to authenticated;

-- --------------------------------------------------------------- shop 5x
-- Every price, including the ones added this week. `where cost > 0` keeps the
-- two free rows (Crate, and the None banner) free.
update public.shop_items set cost = cost * 5 where cost > 0;

-- The album banner's boost has nothing left to top up.
delete from public.shop_items where kind = 'boost' and key = 'bannerpick';

-- ------------------------------------------------------------- the Draw
-- Amounts for cosmetics are deliberately unchanged: they were the old shop
-- price, the shop just went up 5x, so they are now 20% of it. See section 3.
alter table public.spin_items drop constraint if exists spin_items_kind_check;
delete from public.spin_items;
alter table public.spin_items
  add constraint spin_items_kind_check
  check (kind in ('discs', 'theme', 'banner', 'flair', 'frame', 'tag', 'picks'));

-- For kind='picks', `amount` is how many free records it grants, not a Disc
-- consolation — picks can never be a duplicate, so the column is free to mean
-- something else here.
insert into public.spin_items (key, kind, label, amount, ref, weight, tier) values
  -- Common — 300/1000
  ('d150',      'discs', '150 Discs',      150,    null,      170, 'common'),
  ('d300',      'discs', '300 Discs',      300,    null,      130, 'common'),
  -- Rare — 250/1000
  ('d500',      'discs', '500 Discs',      500,    null,      120, 'rare'),
  ('b_mono',    'banner','Mono Fade',      320,    'mono',     65, 'rare'),
  ('fr_sleeve', 'frame', 'Card Sleeve',    700,    'sleeve',   65, 'rare'),
  -- Epic — 200/1000
  ('d1000',     'discs', '1,000 Discs',    1000,   null,      100, 'epic'),
  ('b_dusk',    'banner','Dusk',           560,    'dusk',     50, 'epic'),
  ('fl_foil',   'flair', 'Gold Foil',      900,    'foil',     50, 'epic'),
  -- Legendary — 150/1000
  ('t_vhs',     'theme', 'VHS Tracking',   1200,   'vhs',      45, 'legendary'),
  ('b_static',  'banner','Static',         720,    'static',   40, 'legendary'),
  ('d2000',     'discs', '2,000 Discs',    2000,   null,       40, 'legendary'),
  ('picks1',    'picks', '1 album, free',  1,      null,       25, 'legendary'),
  -- Mythic — 100/1000
  ('tag',       'tag',   'Producer tag',   1000,   null,       60, 'mythic'),
  ('picks3',    'picks', '3 albums, free', 3,      null,       34, 'mythic'),
  ('d100000',   'discs', '100,000 Discs',  100000, null,        3, 'mythic')
on conflict (key) do update set
  kind = excluded.kind, label = excluded.label, amount = excluded.amount,
  ref = excluded.ref, weight = excluded.weight, tier = excluded.tier;

create or replace function public.wallet_spin()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  p        public.profiles;
  v_cost   integer := 1000;
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

  -- random() here rather than anywhere the client can reach: a browser that
  -- picked its own prize would be a browser that always drew a Mythic.
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

  elsif v_item.kind = 'picks' then
    p.album_picks := coalesce(p.album_picks, 0) + v_item.amount;

  elsif v_item.kind = 'tag' then
    -- No fixed ref: a random tag you do not own yet, from the same rows you
    -- could buy. Own them all and it pays out instead, which is what stops the
    -- top of the ladder becoming worthless to a completed account.
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
    album_picks   = p.album_picks
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'cost', case when coalesce(p.is_admin, false) then 0 else v_cost end,
    'key', v_item.key, 'kind', v_item.kind, 'label', v_item.label,
    'granted', v_shown, 'ref', v_ref, 'tier', v_item.tier,
    'gained', v_gain, 'duplicate', v_dupe,
    -- For kind='picks' this is how many records it just handed over.
    'picks', case when v_item.kind = 'picks' then v_item.amount else 0 end,
    'discs', p.discs, 'album_picks', p.album_picks,
    'owned_themes', p.owned_themes, 'owned_banners', p.owned_banners,
    'owned_tags', p.owned_tags, 'owned_flairs', p.owned_flairs,
    'owned_frames', p.owned_frames,
    'lifetime_xp', p.lifetime_xp, 'level', p.level);
end $$;

revoke all on function public.wallet_spin() from public, anon;
grant execute on function public.wallet_spin() to authenticated;

-- ------------------------------------------------------------ wallet_buy
-- The bannerpick boost is gone; 'freeze' is the only repeatable left, and so
-- the only bottomless thing in the Shop.
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
    streak_freezes = case when p_kind = 'boost' and p_key = 'freeze'
                          then coalesce(streak_freezes, 0) + 1 else streak_freezes end
  where id = v_me
  returning * into p;

  return jsonb_build_object('ok', true, 'discs', p.discs,
                            'owned_themes', p.owned_themes, 'owned_banners', p.owned_banners,
                            'owned_tags', p.owned_tags, 'owned_flairs', p.owned_flairs,
                            'owned_frames', p.owned_frames,
                            'streak_freezes', p.streak_freezes,
                            'album_picks', p.album_picks,
                            'lifetime_xp', p.lifetime_xp, 'level', p.level);
end $$;

revoke all on function public.wallet_buy(text, text) from public, anon;
grant execute on function public.wallet_buy(text, text) to authenticated;

-- --------------------------------------------------- the album banner, gone
drop function if exists public.wallet_claim_album_banner(text, text);
drop function if exists public.wallet_claim_album_banner(text);

-- ---------------------------------------------------------------------------
-- 5. Bid War payouts are NOT scaled here, on purpose
-- ---------------------------------------------------------------------------
-- They are still 30 / 8 / 15, which against a 32,000 login day is nothing, and
-- the Rewards table will read strangely because of it. Scaling them needs more
-- than a number change and should not be smuggled into an inflation pass:
--
--   * The payout lives inside `bid_war_submit`, which has no `create or
--     replace` anywhere since 20260907130000 — changing three integers means
--     re-declaring 150 lines of sealed-bid resolution, which is the most
--     safety-critical function in the schema.
--   * **There is no daily cap on war payouts.** At 30 Discs that did not
--     matter. At a scaled 1,500 it does: two accounts that follow each other
--     can create a war, both bid, and split the payout, as often as they like.
--     Every other game in this file is capped precisely because a client can
--     claim a win it did not earn — a war cannot be *forged*, but it can be
--     *manufactured*, and the inflation is what turns that from pointless into
--     profitable.
--
-- Doing it properly means a capped-award helper both players go through, in
-- its own migration, with the whole of bid_war_submit re-read first.

-- ---------------------------------------------------------------------------
-- 6. One-off data moves. NOT IDEMPOTENT — everything above this line is.
--    Running the file twice multiplies balances again. If you have to re-run
--    it, stop at this comment.
-- ---------------------------------------------------------------------------

-- Balances and stored collection prices scale with the prices, so nobody wakes
-- up poor.
update public.profiles   set discs = coalesce(discs, 0) * 5 where coalesce(discs, 0) > 0;
update public.collection set price = price * 5;

-- Outstanding banner picks become album picks. They were earned; the thing
-- they bought no longer exists.
update public.profiles
   set album_picks  = coalesce(album_picks, 0) + coalesce(banner_picks, 0),
       banner_picks = 0
 where coalesce(banner_picks, 0) > 0;

-- Album-cover banners already claimed have no renderer any more, so an
-- equipped one would show as a blank header.
update public.profiles
   set active_banner = null
 where active_banner like 'album:%';

update public.profiles
   set owned_banners = (
     select coalesce(array_agg(b), '{}'::text[])
     from unnest(coalesce(owned_banners, '{}'::text[])) b
     where b not like 'album:%')
 where exists (
   select 1 from unnest(coalesce(owned_banners, '{}'::text[])) b where b like 'album:%');
