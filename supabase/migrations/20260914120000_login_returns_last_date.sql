-- `wallet_daily_login` never told the client which day it had just claimed.
--
-- ---------------------------------------------------------------------------
-- The bug
-- ---------------------------------------------------------------------------
-- Three places in the client decide whether today's login is still available:
-- the Discs ladder, the nav dot, and the Home claim card. All three read
-- `Wallet.get().login_last_date`.
--
-- Nothing ever put it there. `load()` did not copy it off the profile row,
-- `applyWallet()` did not apply it, and this function did not return it — so it
-- was `undefined` on every single render since the feature shipped, and
-- `claimedToday` was therefore permanently false.
--
-- What that looked like: you press the live day, the server pays, the page
-- re-renders — and because login_streak *did* update while login_last_date did
-- not, the ladder immediately offers you the **next** day. Press that and the
-- server correctly answers `claimed_already` and pays nothing, while the tile
-- still animates. The first claim of the day worked and every press after it
-- was theatre over a no-op.
--
-- **A value read in three places and written in none is not a small bug**, and
-- nothing caught it because every symptom was "the button does nothing", which
-- is also what a correct second press looks like.
--
-- The client half of the fix is in index.html: `login_last_date` is now in the
-- initial state, copied in `load()`, and applied in `applyWallet()`. This half
-- is the server telling it the truth rather than the client deriving it —
-- deriving "it must be today" is how payFor() drifted from the pay formula, and
-- there is no reason to guess a value the row already holds.
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
      'login_last_date', p.login_last_date,
      'album_picks', p.album_picks, 'discs', p.discs);
  end if;

  v_first := p.login_last_date is null;
  v_gap := case when p.login_last_date is null then null
                else v_today - p.login_last_date end;

  if v_gap = 1 then p.login_streak := p.login_streak + 1;
  else p.login_streak := 1; end if;
  p.login_best := greatest(coalesce(p.login_best, 0), p.login_streak);
  p.login_last_date := v_today;

  -- Position inside the current week of seven. Mirrored by LADDER in the Discs
  -- module.
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
    -- The field this whole migration exists for. Without it the client cannot
    -- know the day is spent and offers the next one immediately.
    'login_last_date', p.login_last_date,
    'album_picks', p.album_picks, 'discs', p.discs,
    'owned_banners', p.owned_banners, 'owned_themes', p.owned_themes,
    'streak_current', p.streak_current, 'streak_best', p.streak_best,
    'lifetime_xp', p.lifetime_xp, 'level', p.level);
end $$;

revoke all on function public.wallet_daily_login() from public, anon;
grant execute on function public.wallet_daily_login() to authenticated;
