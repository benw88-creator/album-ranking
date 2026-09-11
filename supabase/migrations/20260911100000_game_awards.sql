-- Minigame Disc payouts have never actually paid out.
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
-- `Wallet.awardDiscs(amount, opts)` in index.html reads like it grants discs.
-- It does not. It calls wallet_state() -- a read-only select of your own
-- profile -- applies the result, then toasts '+45 Discs' and fires a particle.
-- The `amount` argument never reaches the database. There is no server
-- function that awards it, and after ..._190000_server_economy.sql there is no
-- client write that could either, because the pin trigger reverts it.
--
-- So five call sites have been showing a reward that does not exist:
--
--   Earworm            up to ~45 discs
--   Daily Drop         10-60 discs
--   Album Tournament   10 discs
--   Achievement claim  up to 50 discs
--   Completionist      30 discs
--
-- (The lore call site happens to be honest, because award_lore_disc is a real
-- trigger on lore_answers. The toast there is telling the truth by accident.)
--
-- A reward that vanishes on refresh is worse for retention than no reward, so
-- this is not a cosmetic bug.
--
-- ---------------------------------------------------------------------------
-- The shape of the fix
-- ---------------------------------------------------------------------------
-- The server owns the amount. The client says *which game* it finished and
-- nothing else -- it cannot name a number, the way wallet_buy takes a key and
-- never a price.
--
-- These games are played entirely in the browser, so the server cannot verify
-- that anyone actually won. That is unavoidable and it is the same posture as
-- wallet_record_rating(), which you can call without rating anything. The
-- defence is the same too: a hard daily cap per game, so the most a forged
-- call can earn is what honest play would have earned anyway. That is a
-- deliberately different bar from Bid Wars, where the payout is computed
-- inside bid_war_submit and cannot be forged at all.

-- ---------------------------------------------------------------- counters
-- Per-day, per-game counts. jsonb rather than a column each, so adding a game
-- later is a client change and not a migration.
alter table public.profiles
  add column if not exists game_awards_date date,
  add column if not exists game_awards      jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- the award
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

  -- Amount and daily cap live here, never in the request. Daily Drop is one a
  -- day because it *is* one a day; the rest are capped at roughly the point
  -- where playing stops being the fun part.
  case p_game
    when 'earworm'     then v_amt := 15; v_cap := 3;
    when 'drop'        then v_amt := 20; v_cap := 1;
    when 'tournament'  then v_amt := 10; v_cap := 2;
    when 'achievement' then v_amt := 10; v_cap := 5;
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
    discs            = coalesce(discs, 0) + v_earn,
    game_awards_date = p.game_awards_date,
    game_awards      = p.game_awards
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'earned', v_earn,
    'capped', (v_earn = 0),
    'discs',  p.discs,
    'streak_current', p.streak_current,
    'streak_best', p.streak_best,
    'streak_freezes', p.streak_freezes,
    'owned_themes', p.owned_themes,
    'owned_banners', p.owned_banners
  );
end;
$$;

revoke all on function public.wallet_award_game(text) from public, anon;
grant execute on function public.wallet_award_game(text) to authenticated;

-- ---------------------------------------------------------------- the pin
-- The two new columns are economy state, so they have to be pinned like the
-- rest. Without this a client could reset its own daily counters and farm the
-- caps indefinitely -- which is the whole point of having caps.
--
-- Everything else here is unchanged from ..._20260909160000_fix_economy_pin.sql,
-- including the `current_user` escape hatch. Read the note in that file before
-- touching this: a check based on the JWT does not work, because the JWT is
-- identical on both sides of a security definer boundary.
create or replace function public.pin_profile_economy()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
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
