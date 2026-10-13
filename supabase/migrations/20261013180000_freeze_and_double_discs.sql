-- Streak Freeze at 5,000 Discs (one per missed day), and a 2x Disc Boost.
--
-- Apply by hand in the SQL editor, like the others. Idempotent.
--
-- 1. STREAK FREEZE. The freeze already existed for the RATING streak (the
--    Home "Streak" tile) and was consumed in wallet_record_rating, but one
--    freeze bridged a gap of ANY length. It now covers exactly one missed
--    day; too few freezes resets the streak and keeps them. Days are UTC
--    dates, the same boundary as every other daily rule in the economy.
--    wallet_record_rating below is extracted from
--    20260914160000_play_pays_properly.sql by a script and changed only in
--    the freeze block, the update list and the return — not retyped.
--    Price 30,000 -> 5,000. NOTE: the guard in 20260915100000 that asserts
--    30,000 will now read false if that file is ever re-run, the same
--    accepted state as its other sentinels.
--
-- 2. 2x DISCS. Bought and started in one call (wallet_activate_double),
--    3 hours from the server's clock, refused while one is running so two
--    can never stack. The doubling is a BEFORE UPDATE trigger that runs
--    before pin_profile_economy (triggers fire in name order) and doubles a
--    Disc rise ONLY when the same update shows an eligible award counter
--    moving: ratings, Lore answers, minigames other than Bid Wars, daily
--    missions. Spins, refunds, purchases, the login ladder, referrals,
--    milestones and Bid Wars (the collusion arithmetic) are never doubled.
--    The price is a constant here and mirrored in the client, deliberately
--    NOT a shop_items row: wallet_buy accepts any 'boost' row and would sell
--    one without starting it.
--    Clients cannot write boost_until or streak_freeze_used_on: the trigger
--    pins both for an 'authenticated' writer, as pin_profile_economy does
--    for every other economy column.

alter table public.profiles add column if not exists boost_until timestamptz;
alter table public.profiles add column if not exists streak_freeze_used_on date;

update public.shop_items set cost = 5000 where kind = 'boost' and key = 'freeze';

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

  -- The 10 is the defence. The 400 is the lever.
  if p.rating_awards_count < 10 then
    v_earn := 400;
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
      -- One freeze covers ONE missed day. Missing more days than you hold
      -- freezes resets the streak and leaves the freezes where they are:
      -- spending them on a streak that breaks anyway would be a loss with
      -- nothing bought.
      if coalesce(p.streak_freezes, 0) >= v_gap - 1 then
        p.streak_freezes := p.streak_freezes - (v_gap - 1);
        p.streak_current := p.streak_current + 1;
        p.streak_freeze_used_on := v_today - 1;
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
    streak_freeze_used_on = p.streak_freeze_used_on,
    rating_awards_date = p.rating_awards_date, rating_awards_count = p.rating_awards_count
  where id = v_me
  returning * into p;

  return jsonb_build_object('earned', v_earn, 'milestone', v_hit,
                            'discs', p.discs, 'streak_current', p.streak_current,
                            'streak_best', p.streak_best, 'streak_freezes', p.streak_freezes,
                            'streak_freeze_used_on', p.streak_freeze_used_on,
                            'boost_until', p.boost_until);
end $$;
revoke all on function public.wallet_record_rating() from public, anon;
grant execute on function public.wallet_record_rating() to authenticated;

create or replace function public.wallet_activate_double()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := auth.uid();
  p      public.profiles;
  v_cost constant integer := 10000;   -- mirrored as DOUBLE.cost in index.html
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;
  if p.boost_until is not null and p.boost_until > now() then
    raise exception 'A 2x boost is already running';
  end if;
  if not coalesce(p.is_admin, false) and coalesce(p.discs, 0) < v_cost then
    raise exception 'Not enough Discs';
  end if;
  update public.profiles set
    discs = case when coalesce(is_admin, false) then discs else coalesce(discs, 0) - v_cost end,
    boost_until = now() + interval '3 hours'
  where id = v_me
  returning * into p;
  return jsonb_build_object('ok', true, 'discs', p.discs, 'boost_until', p.boost_until, 'now', now());
end $$;
revoke all on function public.wallet_activate_double() from public, anon;
grant execute on function public.wallet_activate_double() to authenticated;

create or replace function public.boost_profile_awards()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rise     integer;
  v_eligible boolean := false;
  v_old_g    integer := 0;
  v_new_g    integer := 0;
  k          text;
begin
  -- A client may never write these two.
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.boost_until := null; new.streak_freeze_used_on := null;
    else
      new.boost_until := old.boost_until; new.streak_freeze_used_on := old.streak_freeze_used_on;
    end if;
    return new;
  end if;
  if tg_op <> 'UPDATE' then return new; end if;
  if old.boost_until is null or old.boost_until <= now() then return new; end if;
  v_rise := coalesce(new.discs, 0) - coalesce(old.discs, 0);
  if v_rise <= 0 then return new; end if;

  -- Ratings and Lore: the day's award counter moved (a new date restarts it).
  if (new.rating_awards_date is distinct from old.rating_awards_date and coalesce(new.rating_awards_count, 0) > 0)
     or (new.rating_awards_date = old.rating_awards_date and coalesce(new.rating_awards_count, 0) > coalesce(old.rating_awards_count, 0)) then
    v_eligible := true;
  end if;
  if (new.lore_awards_date is distinct from old.lore_awards_date and coalesce(new.lore_awards_count, 0) > 0)
     or (new.lore_awards_date = old.lore_awards_date and coalesce(new.lore_awards_count, 0) > coalesce(old.lore_awards_count, 0)) then
    v_eligible := true;
  end if;
  -- Minigames, summed across every key except Bid Wars.
  if jsonb_typeof(new.game_awards) = 'object' then
    for k in select jsonb_object_keys(new.game_awards) loop
      if k <> 'bidwar' then v_new_g := v_new_g + coalesce((new.game_awards ->> k)::integer, 0); end if;
    end loop;
  end if;
  if jsonb_typeof(old.game_awards) = 'object' and new.game_awards_date is not distinct from old.game_awards_date then
    for k in select jsonb_object_keys(old.game_awards) loop
      if k <> 'bidwar' then v_old_g := v_old_g + coalesce((old.game_awards ->> k)::integer, 0); end if;
    end loop;
  end if;
  if v_new_g > v_old_g then v_eligible := true; end if;
  -- Daily missions: one more mission claimed today.
  if (new.missions_date is distinct from old.missions_date and coalesce(cardinality(new.missions_claimed), 0) > 0)
     or (new.missions_date = old.missions_date and coalesce(cardinality(new.missions_claimed), 0) > coalesce(cardinality(old.missions_claimed), 0)) then
    v_eligible := true;
  end if;

  if v_eligible then new.discs := coalesce(new.discs, 0) + v_rise; end if;
  return new;
end $$;

-- "boost_..." sorts before "pin_profile_economy_trg", so it runs first and
-- the pin trigger's lifetime-XP accounting sees the doubled rise.
drop trigger if exists boost_profile_awards_trg on public.profiles;
create trigger boost_profile_awards_trg
  before insert or update on public.profiles
  for each row execute function public.boost_profile_awards();

-- Guards.
do $$
begin
  if 'boost_profile_awards_trg' >= 'pin_profile_economy_trg' then
    raise exception 'boost trigger must sort before the pin trigger';
  end if;
  if exists (select 1 from public.shop_items where kind = 'boost' and key = 'double') then
    raise exception 'double must not be a shop_items row: wallet_buy would sell it without starting it';
  end if;
  if (select cost from public.shop_items where kind = 'boost' and key = 'freeze') <> 5000 then
    raise exception 'Streak Freeze should cost 5000';
  end if;
  if position('v_gap - 1' in pg_get_functiondef('public.wallet_record_rating()'::regprocedure)) = 0 then
    raise exception 'wallet_record_rating did not pick up the one-freeze-per-day rule';
  end if;
end $$;
