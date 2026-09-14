-- Daily play limits, separate from daily payout caps.
--
-- ---------------------------------------------------------------------------
-- Why this is not the same thing as wallet_award_game
-- ---------------------------------------------------------------------------
-- wallet_award_game already caps Higher or Lower at three payouts a day. That
-- caps the *money*, not the *game*: the fourth run and the four hundredth were
-- both allowed, both paid nothing, and the only thing that said so was a toast
-- telling you to play for the love of it. A limit you only discover by hitting
-- it is a disappointment; a limit stated on the start screen is a rule, and a
-- chain game is better for being scarce.
--
-- So this counts runs *started*, not runs that earned. Same shape as
-- ..._20260911100000_game_awards.sql — a jsonb of per-game counts and the date
-- they belong to, so adding a game later is a client change and not a
-- migration.
--
-- ---------------------------------------------------------------------------
-- What it can and cannot enforce
-- ---------------------------------------------------------------------------
-- The client calls game_start_run() before it deals the first pair, and stops
-- if the answer is no. Someone with the API and the will to use it can simply
-- not call it — exactly as they can not call wallet_award_game — so this is
-- not a defence against a determined cheat. It does not need to be: the money
-- is already bounded at three by the payout cap, and a fourth unpaid run
-- forged by hand costs nobody anything. What this buys is that the limit is
-- the same on every device somebody signs in on, which localStorage alone
-- could never manage.

-- ---------------------------------------------------------------- counters
alter table public.profiles
  add column if not exists game_plays_date date,
  add column if not exists game_plays      jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- the cap
-- One place, so the number the start screen shows and the number the server
-- enforces cannot drift. A game with no entry here is unlimited.
create or replace function public.game_play_cap(p_game text)
returns integer
language sql immutable
set search_path = public, pg_temp
as $$
  select case p_game
    when 'higherlower' then 3
    else null
  end;
$$;

-- ---------------------------------------------------------------- read
-- Read-only: what is left today, without spending anything. The start screen
-- calls this every time the modal opens.
create or replace function public.game_plays_left(p_game text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  p       public.profiles;
  v_today date := (now() at time zone 'utc')::date;
  v_cap   integer := public.game_play_cap(p_game);
  v_used  integer;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into p from public.profiles where id = v_me;
  if p.id is null then raise exception 'No profile'; end if;

  -- A counter from yesterday is a counter of zero. Nothing is written here;
  -- the reset happens for real on the next game_start_run.
  v_used := case when p.game_plays_date is distinct from v_today then 0
                 else coalesce((p.game_plays ->> p_game)::integer, 0) end;

  return jsonb_build_object(
    'game',      p_game,
    'date',      v_today,
    'used',      v_used,
    'cap',       v_cap,
    'remaining', case when v_cap is null then null else greatest(v_cap - v_used, 0) end
  );
end;
$$;

-- ---------------------------------------------------------------- spend
-- Takes one run if there is one to take. `allowed` false means the caller must
-- not start the game; it is not an error, so it does not raise.
create or replace function public.game_start_run(p_game text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  p       public.profiles;
  v_today date := (now() at time zone 'utc')::date;
  v_cap   integer := public.game_play_cap(p_game);
  v_used  integer;
  v_ok    boolean;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;

  if p.game_plays_date is distinct from v_today then
    p.game_plays_date := v_today;
    p.game_plays := '{}'::jsonb;
  end if;

  v_used := coalesce((p.game_plays ->> p_game)::integer, 0);
  v_ok   := v_cap is null or v_used < v_cap;

  if v_ok then
    v_used := v_used + 1;
    p.game_plays := p.game_plays || jsonb_build_object(p_game, v_used);
  end if;

  -- Written even when refused, so a stale date from yesterday is cleared the
  -- first time somebody asks rather than sitting there until they earn.
  update public.profiles set
    game_plays_date = p.game_plays_date,
    game_plays      = p.game_plays
  where id = v_me;

  return jsonb_build_object(
    'game',      p_game,
    'date',      v_today,
    'allowed',   v_ok,
    'used',      v_used,
    'cap',       v_cap,
    'remaining', case when v_cap is null then null else greatest(v_cap - v_used, 0) end
  );
end;
$$;

-- ---------------------------------------------------------------- the pin
-- Otherwise the counter is a client-writable column and the limit is advice.
-- This is a create-or-replace of the trigger function as it stands after
-- ..._20260913180000_mythic_tags_and_shop.sql, with game_plays_date and
-- game_plays added to both lists. Nothing else in it changes; if you edit this
-- function again, copy the latest version rather than this one.
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
    new.game_plays_date     := null;
    new.game_plays          := '{}'::jsonb;
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
  new.game_plays_date     := old.game_plays_date;
  new.game_plays          := old.game_plays;
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

-- ---------------------------------------------------------------- grants
revoke all on function public.game_play_cap(text)   from public, anon;
revoke all on function public.game_plays_left(text) from public, anon;
revoke all on function public.game_start_run(text)  from public, anon;
grant execute on function public.game_play_cap(text)   to authenticated;
grant execute on function public.game_plays_left(text) to authenticated;
grant execute on function public.game_start_run(text)  to authenticated;
