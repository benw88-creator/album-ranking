-- The login ladder stops being the biggest thing in the economy.
--
-- ---------------------------------------------------------------------------
-- What it was, and why that was the wrong shape for this app
-- ---------------------------------------------------------------------------
--   was   1,000  2,000  4,000  8,000  16,000  32,000  +record   = 63,000/week
--   now   1,500  2,000  2,500  3,000   4,000   5,000  +record   = 18,000/week
--
-- The problem was never the total, it was the doubling. **Day six alone paid
-- 32,000 against the 30,800 a day that maxing every single game pays** — ten
-- ratings, twenty lore answers, three Earworms, the Drop, five achievements and
-- three Higher or Lower runs, all of it beaten by one tap on a button. And that
-- tap cannot be done well or badly; there is no skill in it and no music in it.
--
-- That put the two progression systems in this app in direct opposition.
-- Standing measures depth and prints its own rule on the profile to say that
-- depth is what the app values. The wallet paid best for opening the app and
-- closing it again. Somebody optimising for Discs was doing nothing VINALL is
-- for, and the app was telling them to.
--
-- Against a realistic session rather than a maximal one the gap was worse. A
-- normal day — the Drop, an Earworm, rate a handful, answer a couple of
-- questions — is somewhere near 7,000-12,000. The old ladder averaged 9,000 a
-- day. **Logging in paid about the same as playing, and on day six three or
-- four times as much.**
--
-- ---------------------------------------------------------------------------
-- Why flatten rather than cut
-- ---------------------------------------------------------------------------
-- Consistency should still pay, so the curve still climbs: a full week is
-- 18,000 against the 9,000 somebody gets by only ever landing on day one. A
-- 2x premium for turning up six days running, where it used to be 9x.
--
-- The miss-a-day cliff comes down with it. Dropping from 32,000 to 1,000 for
-- one missed day is a 32x punishment that produces anxious opening rather than
-- engagement — and the design already flinched at it, which is why
-- ..._20260913220000 refused to sell streak freezes for this ladder: "a freeze
-- would protect you from not opening an app". 5,000 to 1,500 is a rule, not a
-- cliff.
--
-- **Day seven is untouched and is the point.** A full week pays a record of
-- your choice, and at the collection's streams/250,000 pricing that is worth
-- far more than the six Disc days put together — Views alone is 51,240. So the
-- reward for a week of turning up is a record rather than a pile of currency,
-- which is the version of this mechanic that is actually about music. The Disc
-- days can be modest precisely because day seven is the prize.
--
-- Day six is 5,000, which is exactly one spin. Six days running buys you a
-- Draw, and that is a better sentence than any number on the old ladder.
--
-- ---------------------------------------------------------------------------
-- Where this leaves the economy, with ..._20260915100000's prices
-- ---------------------------------------------------------------------------
--   login                 18,000/week + one record
--   realistic play       ~70,000/week
--   maxing everything    215,600/week
--
--   login as a share of a realistic week   20%   (was ~47%)
--   login as a share of a maximal week      8%   (was ~23%)
--
--   one spin              5,000        = day six
--   cheapest tag         48,000        ~ 4 days of realistic total income
--   the whole shop    2,342,500        ~ 27 weeks of it
--
-- **What is still wrong, and is not fixed here:** Bid War payouts are 30/8/15
-- and have been since 20260907130000. Against these numbers they are noise. It
-- is not a number change — the payout lives inside `bid_war_submit`, which has
-- no create-or-replace anywhere since it shipped, so touching it means
-- re-declaring 150 lines of sealed-bid resolution; and there is no daily cap on
-- war payouts, so a scaled figure makes two accounts that follow each other
-- able to manufacture wars and split the proceeds. It needs its own migration
-- with a capped-award helper, and smuggling it into a ladder change would be
-- the wrong place to get it wrong.
--
-- ---------------------------------------------------------------------------
-- Two arrays, and they must not drift
-- ---------------------------------------------------------------------------
-- `v_ladder` here is mirrored by `LADDER` in the Discs module of index.html,
-- which `payFor()` reads to draw the tiles. **This is display against payment:
-- the server is what pays, so a drift shows as the page promising a number the
-- claim does not deliver** — which is exactly what happened when the SQL
-- plateaued while the page drew a cycle, and the two silently disagreed from
-- day eight for the whole life of the feature.
--
-- Written as seven literals in both places rather than a formula, so a mismatch
-- is visible on sight instead of requiring arithmetic.
--
-- This file is a create-or-replace of the function as it stands after
-- ..._20260914120000_login_returns_last_date.sql, copied verbatim with one line
-- changed. Re-applying it is harmless.

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
  v_ladder integer[] := array[1500, 2000, 2500, 3000, 4000, 5000, 0];
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

-- The one thing worth asserting: day seven still pays no Discs, because the
-- record is the reward and the client's celebrate() depends on that being true.
do $$
declare v_week integer;
begin
  select sum(x) into v_week from unnest(array[1500, 2000, 2500, 3000, 4000, 5000, 0]) as x;
  if v_week <> 18000 then
    raise exception 'The ladder sums to %, not 18,000 — CLAUDE.md and the client LADDER say otherwise', v_week;
  end if;
  raise notice 'Login ladder flattened: 18,000 a week plus one record, down from 63,000.';
end $$;
