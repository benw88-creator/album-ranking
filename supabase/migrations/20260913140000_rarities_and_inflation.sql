-- Five rarities with names worth saying out loud, and a 4x inflation pass.
--
-- ---------------------------------------------------------------------------
-- The ladder
-- ---------------------------------------------------------------------------
-- Four tiers called common/uncommon/rare/legendary is the naming of every
-- loot box ever made, and it says nothing about records. Five now, and they
-- are a crate-digger's ladder rather than a video game's:
--
--   Bargain Bin    35%   the 50p crate by the door
--   B-Side         30%   worth flipping over
--   Deep Cut       20%   the one only you play
--   White Label    10%   an unmarked promo — you have to know
--   Holy Grail      5%   the one you tell people about
--
-- Exactly the split asked for, and the weights sum to 1000 so the published
-- percentages are exact rather than rounded — the odds table on the page reads
-- from these same rows, so "5%" on screen is 5% in the machine.
--
-- Holy Grail carries the album banner and the biggest Disc prize, so the top
-- of the ladder is the only place either can come from.
--
-- ---------------------------------------------------------------------------
-- The inflation
-- ---------------------------------------------------------------------------
-- Everything earned and everything priced moves by 4x together. The ratios are
-- untouched, so nothing gets easier or harder — the numbers just get chunkier,
-- which is the whole reason to do it. A game where a good session pays 1,200
-- reads as more generous than one paying 300 even when they buy the same
-- things.
--
-- The collection's own price divisor moves with it, in api/collection-buy.js:
-- streams / 5,000,000 becomes streams / 1,250,000. Change one without the
-- other and records become either free or unbuyable.

-- ---------------------------------------------------------------- tiers
-- Order matters here and it is easy to get wrong: `add constraint` validates
-- against existing rows immediately, so the old common/uncommon/rare/legendary
-- rows have to be gone BEFORE the new check exists, not after. Adding it first
-- fails with 23514 every time.
alter table public.spin_items drop constraint if exists spin_items_tier_check;

delete from public.spin_items;

alter table public.spin_items
  add constraint spin_items_tier_check
  check (tier in ('bargain', 'bside', 'deepcut', 'whitelabel', 'grail'));

insert into public.spin_items (key, kind, label, amount, ref, weight, tier) values
  -- Bargain Bin — 350/1000
  ('d300',     'discs',       '300 Discs',     300,  null,      200, 'bargain'),
  ('d600',     'discs',       '600 Discs',     600,  null,      150, 'bargain'),
  -- B-Side — 300/1000
  ('d1200',    'discs',       '1,200 Discs',   1200, null,      180, 'bside'),
  ('b_mono',   'banner',      'Mono Fade',     320,  'mono',     60, 'bside'),
  ('b_tape',   'banner',      'Tape Loop',     560,  'tape',     60, 'bside'),
  -- Deep Cut — 200/1000
  ('d2500',    'discs',       '2,500 Discs',   2500, null,      110, 'deepcut'),
  ('b_dusk',   'banner',      'Dusk',          560,  'dusk',     45, 'deepcut'),
  ('b_static', 'banner',      'Static',        720,  'static',   45, 'deepcut'),
  -- White Label — 100/1000
  ('t_vhs',    'theme',       'VHS Tracking',  1200, 'vhs',      35, 'whitelabel'),
  ('t_bone',   'theme',       'Bone China',    1200, 'bone',     35, 'whitelabel'),
  ('d6000',    'discs',       '6,000 Discs',   6000, null,       30, 'whitelabel'),
  -- Holy Grail — 50/1000
  ('t_neon',   'theme',       'Neon Vault',    1400, 'neon',     20, 'grail'),
  ('d20000',   'discs',       '20,000 Discs',  20000, null,      15, 'grail'),
  ('album',    'banner_pick', 'Album banner',  0,    null,       15, 'grail')
on conflict (key) do update set
  kind = excluded.kind, label = excluded.label, amount = excluded.amount,
  ref = excluded.ref, weight = excluded.weight, tier = excluded.tier;

-- ---------------------------------------------------------------- the spin
-- Cost rises with everything else: 250 -> 1000.
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
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;
  if not coalesce(p.is_admin, false) and coalesce(p.discs, 0) < v_cost then
    raise exception 'That costs % Discs', v_cost;
  end if;

  select sum(weight) into v_total from public.spin_items;
  if coalesce(v_total, 0) < 1 then raise exception 'Nothing to win'; end if;

  v_roll := floor(random() * v_total) + 1;
  for v_item in select * from public.spin_items order by key loop
    v_acc := v_acc + v_item.weight;
    exit when v_acc >= v_roll;
  end loop;

  if not coalesce(p.is_admin, false) then
    p.discs := p.discs - v_cost;
  end if;

  if v_item.kind = 'discs' then
    p.discs := p.discs + v_item.amount;
    v_gain := v_item.amount;
  elsif v_item.kind = 'banner_pick' then
    p.banner_picks := coalesce(p.banner_picks, 0) + 1;
  elsif v_item.kind = 'theme' then
    if v_item.ref = any(coalesce(p.owned_themes, '{}'::text[])) then
      v_dupe := true;
      p.discs := p.discs + v_item.amount;
      v_gain := v_item.amount;
    else
      p.owned_themes := (select array(select distinct unnest(coalesce(p.owned_themes, '{}'::text[]) || v_item.ref)));
    end if;
  elsif v_item.kind = 'banner' then
    if v_item.ref = any(coalesce(p.owned_banners, '{}'::text[])) then
      v_dupe := true;
      p.discs := p.discs + v_item.amount;
      v_gain := v_item.amount;
    else
      p.owned_banners := (select array(select distinct unnest(coalesce(p.owned_banners, '{}'::text[]) || v_item.ref)));
    end if;
  end if;

  update public.profiles set
    discs = p.discs, owned_themes = p.owned_themes,
    owned_banners = p.owned_banners, banner_picks = p.banner_picks
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'cost', case when coalesce(p.is_admin, false) then 0 else v_cost end,
    'key', v_item.key, 'kind', v_item.kind, 'label', v_item.label,
    'ref', v_item.ref, 'tier', v_item.tier,
    'gained', v_gain, 'duplicate', v_dupe,
    'discs', p.discs, 'banner_picks', p.banner_picks,
    'owned_themes', p.owned_themes, 'owned_banners', p.owned_banners);
end $$;

revoke all on function public.wallet_spin() from public, anon;
grant execute on function public.wallet_spin() to authenticated;

-- ---------------------------------------------------------------- the shop
update public.shop_items set cost = cost * 4 where cost > 0;

-- ---------------------------------------------------------------- earning
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

  if p.rating_awards_count < 10 then
    v_earn := 32;
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
    discs = coalesce(discs, 0) + 20,
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
    when 'earworm'     then v_amt := 200; v_cap := 3;
    when 'drop'        then v_amt := 300; v_cap := 1;
    when 'tournament'  then v_amt := 160; v_cap := 2;
    when 'achievement' then v_amt := 160; v_cap := 5;
    when 'higherlower' then v_amt := 160; v_cap := 3;
    else raise exception 'Unknown game: %', p_game;
  end case;

  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;

  if p.game_awards_date is distinct from v_today then
    p.game_awards_date := v_today;
    p.game_awards := '{}'::jsonb;
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

-- Login: 100 rising to 400 by day seven.
create or replace function public.wallet_daily_login()
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
  v_pick  boolean := false;
  v_first boolean := false;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;

  if p.login_last_date = v_today then
    return jsonb_build_object(
      'earned', 0, 'claimed_already', true, 'banner_pick', false,
      'login_streak', p.login_streak, 'login_best', p.login_best,
      'banner_picks', p.banner_picks, 'discs', p.discs);
  end if;

  v_first := p.login_last_date is null;
  v_gap := case when p.login_last_date is null then null
                else v_today - p.login_last_date end;

  if v_gap = 1 then p.login_streak := p.login_streak + 1;
  else p.login_streak := 1; end if;
  p.login_best := greatest(coalesce(p.login_best, 0), p.login_streak);
  p.login_last_date := v_today;

  v_earn := least(100 + (p.login_streak - 1) * 50, 400);

  if p.login_streak % 7 = 0 then
    v_pick := true;
    p.banner_picks := coalesce(p.banner_picks, 0) + 1;
  end if;

  update public.profiles set
    discs = coalesce(discs, 0) + v_earn,
    login_streak = p.login_streak, login_best = p.login_best,
    login_last_date = p.login_last_date, banner_picks = p.banner_picks
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'earned', v_earn, 'claimed_already', false, 'banner_pick', v_pick,
    'first_ever', v_first,
    'login_streak', p.login_streak, 'login_best', p.login_best,
    'banner_picks', p.banner_picks, 'discs', p.discs,
    'owned_banners', p.owned_banners, 'owned_themes', p.owned_themes,
    'streak_current', p.streak_current, 'streak_best', p.streak_best);
end $$;

revoke all on function public.wallet_daily_login() from public, anon;
grant execute on function public.wallet_daily_login() to authenticated;

-- Existing balances scale too, so nobody wakes up poor in the new prices.
update public.profiles set discs = coalesce(discs, 0) * 4 where coalesce(discs, 0) > 0;
update public.collection set price = price * 4;
