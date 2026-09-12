-- Levels and XP.
--
-- ---------------------------------------------------------------------------
-- Two currencies, one earning motion
-- ---------------------------------------------------------------------------
-- Discs are a balance: you earn them and you spend them, so they go down, and
-- a number that goes down cannot also be a record of how far you have come.
-- XP is the other half — it only ever rises, it is never spent, and it is what
-- a level is made of.
--
-- The trick is that nothing new has to award it. **XP is every Disc you have
-- ever earned**, accrued at the moment the balance rises. That means one
-- trigger covers every path at once — ratings, lore, all five games, the daily
-- login, Bid War payouts, The Draw — including any path added later, without
-- touching a single one of those functions. Spending discs does not reduce it,
-- because only an increase accrues.
--
-- It lives inside pin_profile_economy rather than in a trigger of its own,
-- because that function already runs BEFORE UPDATE, already has old and new in
-- hand, and already knows the difference between a server write and a client
-- one. A second trigger would be a second thing to keep in step.
--
-- ---------------------------------------------------------------------------
-- The curve
-- ---------------------------------------------------------------------------
-- Each level costs round(80 * n^1.35) more XP than the last:
--
--   L1→2     80        L5→6     686
--   L2→3    204        L10→11  1790
--   L3→4    348        L20→21  4570
--   L4→5    510        L50→51 15900
--
-- Against a realistic ~250 XP day that is a level or two on the first day,
-- then a steady stretch — fast enough that the first levels arrive while
-- somebody is still deciding whether they care, slow enough that level 20
-- means something. The exponent matters more than the base: 1.35 doubles the
-- cost roughly every five levels, which is the shape Duolingo, Reddit karma
-- tiers and most battle passes settle on. Below about 1.2 the curve is flat
-- and levels stop reading as progress; above 1.6 it walls up within a week.

alter table public.profiles
  add column if not exists lifetime_xp bigint  not null default 0,
  add column if not exists level       integer not null default 1;

comment on column public.profiles.lifetime_xp is
  'Every Disc ever earned. Never spent, never decreases. Accrued by pin_profile_economy.';

-- XP needed to go from p_level to the next one.
create or replace function public.xp_step(p_level integer)
returns bigint
language sql immutable
as $$ select greatest(1, round(80 * power(greatest(p_level, 1), 1.35)))::bigint; $$;

-- Total XP at which p_level begins.
create or replace function public.xp_floor(p_level integer)
returns bigint
language plpgsql immutable
as $$
declare v_total bigint := 0; i integer;
begin
  for i in 1 .. greatest(p_level, 1) - 1 loop
    v_total := v_total + public.xp_step(i);
  end loop;
  return v_total;
end $$;

-- Level for a given total. Capped at 200 so a pathological value cannot spin
-- the loop forever.
create or replace function public.level_for_xp(p_xp bigint)
returns integer
language plpgsql immutable
as $$
declare v_level integer := 1; v_acc bigint := 0;
begin
  loop
    exit when v_level >= 200;
    v_acc := v_acc + public.xp_step(v_level);
    exit when coalesce(p_xp, 0) < v_acc;
    v_level := v_level + 1;
  end loop;
  return v_level;
end $$;

-- Everything the client needs to draw a progress bar, in one call.
create or replace function public.wallet_level()
returns jsonb
language sql security definer stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'level', p.level,
    'xp', p.lifetime_xp,
    'floor', public.xp_floor(p.level),
    'next', public.xp_floor(p.level + 1),
    'step', public.xp_step(p.level),
    'into', p.lifetime_xp - public.xp_floor(p.level),
    'discs', p.discs)
  from public.profiles p where p.id = auth.uid();
$$;

revoke all on function public.wallet_level() from public, anon;
grant execute on function public.wallet_level() to authenticated;

-- Backfill: everyone's current balance is the best evidence available of what
-- they have earned. It undercounts anybody who has already spent, which is
-- generous in the right direction — nobody loses a level they had.
update public.profiles
   set lifetime_xp = greatest(coalesce(lifetime_xp, 0), coalesce(discs, 0))
 where coalesce(lifetime_xp, 0) < coalesce(discs, 0);

update public.profiles
   set level = public.level_for_xp(lifetime_xp)
 where level is distinct from public.level_for_xp(lifetime_xp);

-- ---------------------------------------------------------------- the pin
-- Same function as ..._20260911200000, with the XP accrual added at the top of
-- the server-write branch and the two new columns pinned in the client branch.
-- Without the pin a client sets its own level, which is the only thing a level
-- is worth anything for.
create or replace function public.pin_profile_economy()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    -- A server-side write. Any rise in the balance is XP earned; a fall is
    -- somebody spending, which changes nothing here.
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
    new.rating_awards_count := 0;
    new.lore_awards_count   := 0;
    new.game_awards_date    := null;
    new.game_awards         := '{}'::jsonb;
    new.login_streak        := 0;
    new.login_best          := 0;
    new.login_last_date     := null;
    new.banner_picks        := 0;
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

  return new;
end;
$$;

drop trigger if exists pin_profile_is_admin on public.profiles;
drop trigger if exists pin_profile_economy  on public.profiles;
create trigger pin_profile_economy
  before insert or update on public.profiles
  for each row execute function public.pin_profile_economy();
