-- ============================================================================
-- Levels stop being a rendering of the wallet
--
-- Apply this by hand in the SQL editor, like the others. Idempotent.
--
-- ---------------------------------------------------------------------------
-- THE PROBLEM WITH THE OLD ONE
-- ---------------------------------------------------------------------------
-- `lifetime_xp` is commented "every Disc ever earned" and means it literally,
-- so Level was a second rendering of the wallet. It rose fastest for somebody
-- grinding minigames and barely moved for somebody quietly building a serious
-- crate — which is the opposite of what this app is for, and is the exact
-- criticism that produced Standing. Standing was the answer for the profile;
-- this is the answer for the number that is still on the Home tile, the
-- Collection standings row and the level-up pop.
--
-- ---------------------------------------------------------------------------
-- THE WEIGHTS, AND WHY THEY ARE THESE
-- ---------------------------------------------------------------------------
--   a Disc ever earned          1     unchanged, and that is deliberate
--   an album ranked         1,200     the act the app exists for
--   a song ranked             300     four to an album; you rate far more
--   a game completed          400     three to an album
--   a day active            2,000     cannot be hurried — one a day, ever
--
-- The brief's one hard constraint was that completing a game must be worth
-- MEANINGFULLY LESS than ranking thirty albums. Thirty albums is 36,000 and a
-- game is 400, so an album is three games and thirty albums is ninety of them.
--
-- Sized against a real week rather than against each other. A keen week is
-- roughly 30 albums, 60 songs, 21 games and 7 days:
--
--   albums  30 x 1,200 = 36,000
--   songs   60 x   300 = 18,000
--   games   21 x   400 =  8,400
--   days     7 x 2,000 = 14,000
--                        ------
--                        76,400   against ~70,000 Discs for the same week
--
-- So the two halves are about equal, which is the point: the wallet still
-- counts, and it no longer counts for everything.
--
-- ---------------------------------------------------------------------------
-- NOBODY LOSES A LEVEL, WHICH IS WHY DISCS STAY IN
-- ---------------------------------------------------------------------------
-- Level is ADDITIVE over the old number rather than a replacement for it.
-- `lifetime_xp` keeps its exact old meaning and its old value — the Statistics
-- tile prints it as "Lifetime Discs" and that must stay true — and `xp_bonus`
-- sits beside it. Level is level_for_xp(lifetime_xp + xp_bonus).
--
-- Dropping Discs from the formula would have re-levelled every account
-- downwards on deploy, and a progression bar that goes backwards because the
-- rules changed is the worst thing a progression bar can do. This way every
-- level anybody has is a level they keep, and the new inputs only add.
--
-- ---------------------------------------------------------------------------
-- WHERE THE NUMBERS COME FROM, AND WHY TWO ARE COUNTERS
-- ---------------------------------------------------------------------------
-- Albums and songs are COUNTED LIVE from `ratings`, never accumulated. A
-- counter can drift, and worse, a counter that only goes up means deleting a
-- rating and adding it again is free XP. A count cannot be farmed by anything
-- except actually rating things.
--
-- Games and active days have no table to count, so they are counters — and
-- both are incremented ONLY where the server already knows the event happened
-- and already has a cap on it:
--
--   * games_completed rises when `game_awards` rises, i.e. when
--     wallet_award_game actually PAYS. That is capped per game per day, so the
--     XP inherits the anti-forgery bound the Discs have rather than needing a
--     new one. A capped-out fourth game of the day pays no Discs and no XP,
--     which is consistent.
--   * active_days rises when `login_last_date` changes, i.e. once a day, in
--     wallet_daily_login. One a day, ever, is a bound nothing can beat.
--
-- Both are read off `pin_profile_economy`, which already sees every one of
-- those writes go past. NOTHING IN THE EXISTING WALLET FUNCTIONS IS TOUCHED —
-- they are long, several were edited by hand, and re-declaring them to add a
-- counter is how a re-typed copy loses a line.
--
-- BOTH NEW COLUMNS ARE PINNED. Without that a client writes itself 10,000
-- active days, which is 20,000,000 XP and level 200 on a fresh account.
-- ============================================================================

alter table public.profiles add column if not exists xp_bonus        bigint  not null default 0;
alter table public.profiles add column if not exists games_completed integer not null default 0;
alter table public.profiles add column if not exists active_days     integer not null default 0;

-- The pin trigger counts `ratings` on every definer-side profile write, which
-- is every award, every buy and every rating saved. Without this that is two
-- sequential scans of the whole table per write, and `ratings` holds every
-- rating every account has ever made. `kind` is in the index because both
-- counts filter on it and an index-only scan is the difference between this
-- being free and this being the slowest thing in the app.
create index if not exists ratings_user_kind_idx on public.ratings (user_id, kind);

-- ---------------------------------------------------------------- the table
-- One place the weights live. Display against payment is the arrangement
-- LADDER has with v_ladder — except this one can be enforced, because the
-- client reads these values rather than restating them (see wallet_level).
create or replace function public.xp_weights()
returns jsonb
language sql immutable
as $$ select jsonb_build_object('album', 1200, 'song', 300, 'game', 400, 'day', 2000) $$;

grant execute on function public.xp_weights() to anon, authenticated;

-- ---------------------------------------------------------------- the sum
-- Counts, not counters, for the two that have a table behind them.
create or replace function public.xp_bonus_for(p_user uuid)
returns bigint
language sql security definer stable
set search_path = public, pg_temp
as $$
  select
      1200 * coalesce((select count(*) from public.ratings r
                        where r.user_id = p_user and r.kind = 'album'), 0)
    +  300 * coalesce((select count(*) from public.ratings r
                        where r.user_id = p_user and r.kind = 'song'), 0)
    +  400 * coalesce((select games_completed from public.profiles where id = p_user), 0)
    + 2000 * coalesce((select active_days     from public.profiles where id = p_user), 0);
$$;

revoke all on function public.xp_bonus_for(uuid) from public, anon;
grant execute on function public.xp_bonus_for(uuid) to authenticated;

-- Sums the per-game counts in the daily `game_awards` blob. Its own function
-- because the pin trigger runs on every profile write and an inline
-- jsonb_each_text there would be re-parsed in two places.
--
-- jsonb_typeof FIRST. jsonb_each raises on a non-object, and this trigger
-- fires on every insert into profiles — the same lesson `badges` taught: a
-- counter is not worth failing a sign-up over.
create or replace function public.xp_awards_total(p jsonb)
returns integer
language sql immutable
as $$
  select case when jsonb_typeof(coalesce(p, '{}'::jsonb)) <> 'object' then 0
         else coalesce((select sum((value)::text::integer)
                          from jsonb_each_text(p) as t(key, value)
                         where value ~ '^[0-9]+$'), 0) end;
$$;

-- ---------------------------------------------------------------- the pin
-- The whole of pin_profile_economy as it stands after
-- ..._20260916140000_daily_free_spin.sql, with the two counters bumped and the
-- level derived from the sum. Nothing else is changed.
create or replace function public.pin_profile_economy()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    if tg_op = 'UPDATE' then
      -- Unchanged: lifetime_xp is still every Disc ever earned, and the
      -- Statistics tile prints it under exactly that name.
      if coalesce(new.discs, 0) > coalesce(old.discs, 0) then
        new.lifetime_xp := coalesce(old.lifetime_xp, 0) + (coalesce(new.discs, 0) - coalesce(old.discs, 0));
      end if;

      -- A game paid out. wallet_award_game merges a per-game count into
      -- game_awards for the day, so the day's total rising by one is a game
      -- completed — and it is already capped, which is what bounds this.
      if public.xp_awards_total(new.game_awards) > public.xp_awards_total(old.game_awards)
         or (new.game_awards_date is distinct from old.game_awards_date
             and public.xp_awards_total(new.game_awards) > 0) then
        new.games_completed := coalesce(old.games_completed, 0) + 1;
      end if;

      -- wallet_daily_login stamps this exactly once a day.
      if new.login_last_date is distinct from old.login_last_date
         and new.login_last_date is not null then
        new.active_days := coalesce(old.active_days, 0) + 1;
      end if;

      -- Recomputed here and not by the caller, so every definer path that
      -- touches a profile keeps the level honest without having to remember.
      new.xp_bonus :=
          1200 * coalesce((select count(*) from public.ratings r
                            where r.user_id = new.id and r.kind = 'album'), 0)
        +  300 * coalesce((select count(*) from public.ratings r
                            where r.user_id = new.id and r.kind = 'song'), 0)
        +  400 * coalesce(new.games_completed, 0)
        + 2000 * coalesce(new.active_days, 0);
      new.level := public.level_for_xp(coalesce(new.lifetime_xp, 0) + coalesce(new.xp_bonus, 0));
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
    new.game_plays_date     := null;
    new.game_plays          := '{}'::jsonb;
    new.spin_free_date      := null;
    new.login_streak        := 0;
    new.login_best          := 0;
    new.login_last_date     := null;
    new.banner_picks        := 0;
    new.album_picks         := 0;
    new.lifetime_xp         := 0;
    new.xp_bonus            := 0;
    new.games_completed     := 0;
    new.active_days         := 0;
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
  new.game_plays_date     := old.game_plays_date;
  new.game_plays          := old.game_plays;
  new.spin_free_date      := old.spin_free_date;
  new.login_streak        := old.login_streak;
  new.login_best          := old.login_best;
  new.login_last_date     := old.login_last_date;
  new.banner_picks        := old.banner_picks;
  new.album_picks         := old.album_picks;
  new.lifetime_xp         := old.lifetime_xp;
  -- WITHOUT THESE THREE LINES a client writes itself 10,000 active days,
  -- which is 20,000,000 XP and level 200 on a fresh account.
  new.xp_bonus            := old.xp_bonus;
  new.games_completed     := old.games_completed;
  new.active_days         := old.active_days;
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

-- ---------------------------------------------------------------- read
-- The client draws its bar from this. `xp` is now the SUM, because that is
-- what the level is derived from and a bar filling against a different number
-- from the one that decides the level is a bar that lies. `discs_xp` keeps the
-- old figure available, which is what the Statistics tile prints.
create or replace function public.wallet_level()
returns jsonb
language sql security definer stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'level', p.level,
    'xp', coalesce(p.lifetime_xp, 0) + coalesce(p.xp_bonus, 0),
    'discs_xp', p.lifetime_xp,
    'bonus_xp', p.xp_bonus,
    'albums', (select count(*) from public.ratings r where r.user_id = p.id and r.kind = 'album'),
    'songs',  (select count(*) from public.ratings r where r.user_id = p.id and r.kind = 'song'),
    'games',  p.games_completed,
    'days',   p.active_days,
    'weights', public.xp_weights(),
    'floor', public.xp_floor(p.level),
    'next', public.xp_floor(p.level + 1),
    'step', public.xp_step(p.level),
    'into', (coalesce(p.lifetime_xp, 0) + coalesce(p.xp_bonus, 0)) - public.xp_floor(p.level),
    'discs', p.discs)
  from public.profiles p where p.id = auth.uid();
$$;

revoke all on function public.wallet_level() from public, anon;
grant execute on function public.wallet_level() to authenticated;

-- ---------------------------------------------------------------- backfill
-- Everybody's bonus computed once, and their level with it. Absolute values,
-- so running this twice is the same answer.
--
-- games_completed and active_days start at zero and cannot be reconstructed —
-- nothing recorded them. That is honest rather than ideal: the two counters
-- begin now, and because the formula is ADDITIVE over lifetime_xp nobody's
-- level drops on the day this lands. Existing accounts simply gain the album
-- and song half immediately and start accruing the other two.
update public.profiles p
   set xp_bonus = public.xp_bonus_for(p.id)
 where coalesce(p.xp_bonus, 0) is distinct from public.xp_bonus_for(p.id);

update public.profiles p
   set level = public.level_for_xp(coalesce(p.lifetime_xp, 0) + coalesce(p.xp_bonus, 0))
 where p.level is distinct from public.level_for_xp(coalesce(p.lifetime_xp, 0) + coalesce(p.xp_bonus, 0));

-- ------------------------------------------------------------------- guards
do $$
declare v_src text; v_lvl integer;
begin
  select prosrc into v_src from pg_proc where proname = 'pin_profile_economy';

  -- The three lines a client would love to write for itself.
  if v_src not like '%new.xp_bonus            := old.xp_bonus%'
     or v_src not like '%new.active_days         := old.active_days%'
     or v_src not like '%new.games_completed     := old.games_completed%' then
    raise exception 'pin_profile_economy does not pin the new XP columns — a client could write itself level 200';
  end if;

  -- Additive, not a replacement. If lifetime_xp ever stops feeding the level,
  -- every account re-levels downwards on deploy.
  if v_src not like '%level_for_xp(coalesce(new.lifetime_xp, 0) + coalesce(new.xp_bonus, 0))%' then
    raise exception 'level is no longer derived from lifetime_xp + xp_bonus — accounts would lose levels';
  end if;

  -- The brief's one hard constraint, asserted rather than commented.
  if (public.xp_weights()->>'album')::int * 30 <= (public.xp_weights()->>'game')::int * 5 then
    raise exception 'thirty albums is worth less than five games — the weights are the wrong way round';
  end if;

  -- A rating cannot be farmed by deleting and re-adding it, because albums and
  -- songs are COUNTED and never accumulated.
  if (select prosrc from pg_proc where proname = 'xp_bonus_for') not like '%count(*)%' then
    raise exception 'xp_bonus_for accumulates instead of counting — deleting and re-adding a rating would pay twice';
  end if;

  -- jsonb_each raises on a non-object and this runs inside a trigger that
  -- fires on every sign-up.
  if public.xp_awards_total('"nonsense"'::jsonb) <> 0 then
    raise exception 'xp_awards_total does not survive a non-object game_awards';
  end if;
  if public.xp_awards_total('{"drop":1,"blitz":2}'::jsonb) <> 3 then
    raise exception 'xp_awards_total miscounts: got %', public.xp_awards_total('{"drop":1,"blitz":2}'::jsonb);
  end if;

  raise notice 'XP: album 1200, song 300, game 400, day 2000, plus every Disc ever earned.';
end $$;
