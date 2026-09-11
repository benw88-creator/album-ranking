-- Daily login rewards, a login streak, the seven-day album banner, and a
-- roughly 2x inflation pass across every other payout.
--
-- ---------------------------------------------------------------------------
-- Why inflate at all, and why sinks matter more
-- ---------------------------------------------------------------------------
-- Before this the ceiling was ~256 Discs a day if you did literally everything,
-- and ~60 on a realistic session. The whole shop -- five themes and three
-- banners -- costs 1,580. So a normal player spends about a month earning
-- their way to owning everything, and the day they do, Discs stop meaning
-- anything at all.
--
-- Inflating the faucet on its own brings that day forward. It only works
-- alongside a sink, which is what the album banner below is: a reward that is
-- different every time somebody claims one, so it cannot be "finished".
--
-- Bid War payouts (30/8/15) are deliberately NOT inflated. They were already
-- the largest single award in the game, and the point of this pass is to bring
-- everything else up to parity with them rather than to chase them upward.
-- Leaving them also avoids replacing the whole of bid_war_submit -- a hundred
-- lines of resolution logic -- to change three numbers.

-- ---------------------------------------------------------------- columns
alter table public.profiles
  add column if not exists login_streak    integer not null default 0,
  add column if not exists login_best      integer not null default 0,
  add column if not exists login_last_date date,
  add column if not exists banner_picks    integer not null default 0;

comment on column public.profiles.banner_picks is
  'Unspent album-banner entitlements, one granted every 7th consecutive day of logging in.';

-- ---------------------------------------------------------------- the login
-- Note this rewards opening the app rather than using it, which is a weaker
-- thing to reward than the rating streak next to it. It is capped and it
-- plateaus for that reason: 10 discs on day one rising to 40 by day seven and
-- flat after that, so a long streak is about the banner at each seventh day
-- rather than an ever-growing pile for turning up.
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

  -- Already claimed today: report the state and change nothing. The client
  -- calls this on every load, so it has to be safe to call constantly.
  if p.login_last_date = v_today then
    return jsonb_build_object(
      'earned', 0, 'claimed_already', true, 'banner_pick', false,
      'login_streak', p.login_streak, 'login_best', p.login_best,
      'banner_picks', p.banner_picks, 'discs', p.discs);
  end if;

  v_first := p.login_last_date is null;
  v_gap := case when p.login_last_date is null then null
                else v_today - p.login_last_date end;

  if v_gap = 1 then
    p.login_streak := p.login_streak + 1;
  else
    -- A missed day resets it. No freezes here, unlike the rating streak: a
    -- freeze on a login streak protects you from not opening an app, which is
    -- protecting nothing.
    p.login_streak := 1;
  end if;
  p.login_best := greatest(coalesce(p.login_best, 0), p.login_streak);
  p.login_last_date := v_today;

  -- 10, 15, 20 … 40, then flat.
  v_earn := least(10 + (p.login_streak - 1) * 5, 40);

  -- Every seventh day, an album of your choice as a banner.
  if p.login_streak % 7 = 0 then
    v_pick := true;
    p.banner_picks := coalesce(p.banner_picks, 0) + 1;
  end if;

  update public.profiles set
    discs           = coalesce(discs, 0) + v_earn,
    login_streak    = p.login_streak,
    login_best      = p.login_best,
    login_last_date = p.login_last_date,
    banner_picks    = p.banner_picks
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'earned', v_earn, 'claimed_already', false, 'banner_pick', v_pick,
    'first_ever', v_first,
    'login_streak', p.login_streak, 'login_best', p.login_best,
    'banner_picks', p.banner_picks, 'discs', p.discs,
    'owned_banners', p.owned_banners, 'owned_themes', p.owned_themes,
    'streak_current', p.streak_current, 'streak_best', p.streak_best);
end;
$$;

-- ------------------------------------------------------- the album banner
-- The seven-day reward. Spends one entitlement and adds a banner keyed by the
-- album's cover URL, so every claim is a different object and the shop can
-- never be "completed".
--
-- The URL arrives from the client, so it is checked here rather than trusted:
-- only Spotify's own image CDN is accepted. Without that this is an arbitrary
-- image embed on a public profile, which is a content moderation problem and a
-- tracking-pixel problem in one.
create or replace function public.wallet_claim_album_banner(p_art text, p_label text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me  uuid := auth.uid();
  p     public.profiles;
  v_key text;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_art is null or p_art !~ '^https://i\.scdn\.co/image/[A-Za-z0-9]+$' then
    raise exception 'That is not a Spotify cover image';
  end if;

  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;
  if coalesce(p.banner_picks, 0) < 1 then
    raise exception 'No album banner to claim — seven days in a row earns one';
  end if;

  v_key := 'album:' || p_art;

  update public.profiles set
    banner_picks  = p.banner_picks - 1,
    owned_banners = (select array(select distinct unnest(coalesce(p.owned_banners, '{}'::text[]) || v_key))),
    active_banner = v_key
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'banner', v_key, 'label', p_label,
    'banner_picks', p.banner_picks,
    'owned_banners', p.owned_banners, 'active_banner', p.active_banner,
    'discs', p.discs);
end;
$$;

revoke all on function public.wallet_daily_login()                       from public, anon;
revoke all on function public.wallet_claim_album_banner(text, text)      from public, anon;
grant execute on function public.wallet_daily_login()                    to authenticated;
grant execute on function public.wallet_claim_album_banner(text, text)   to authenticated;

-- ---------------------------------------------------------------- inflation
-- Ratings: 3 discs x 5/day -> 5 discs x 8/day. 15 a day becomes 40.
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

  if p.rating_awards_count < 8 then
    v_earn := 5;
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
    streak_current = p.streak_current,
    streak_best = p.streak_best,
    streak_last_date = p.streak_last_date,
    streak_freezes = p.streak_freezes,
    rating_awards_date = p.rating_awards_date,
    rating_awards_count = p.rating_awards_count
  where id = v_me
  returning * into p;

  return jsonb_build_object('earned', v_earn, 'milestone', v_hit,
                            'discs', p.discs, 'streak_current', p.streak_current,
                            'streak_best', p.streak_best, 'streak_freezes', p.streak_freezes);
end;
$$;

-- Lore: 2 -> 3 per answer, cap unchanged at 20 a day. 40 becomes 60.
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
    discs = coalesce(discs, 0) + 3,
    lore_awards_date = v_today,
    lore_awards_count = v_count + 1
  where id = new.user_id;

  return new;
end;
$$;

drop trigger if exists award_lore_disc on public.lore_answers;
create trigger award_lore_disc
  after insert on public.lore_answers
  for each row execute function public.award_lore_disc();

-- Games, all roughly doubled. Caps unchanged: the cap is the anti-forgery
-- defence, not the balance lever.
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
    when 'earworm'     then v_amt := 25; v_cap := 3;
    when 'drop'        then v_amt := 40; v_cap := 1;
    when 'tournament'  then v_amt := 20; v_cap := 2;
    when 'achievement' then v_amt := 20; v_cap := 5;
    when 'higherlower' then v_amt := 20; v_cap := 3;
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
    'earned', v_earn, 'capped', (v_earn = 0), 'discs', p.discs,
    'streak_current', p.streak_current, 'streak_best', p.streak_best,
    'streak_freezes', p.streak_freezes,
    'owned_themes', p.owned_themes, 'owned_banners', p.owned_banners);
end;
$$;

revoke all on function public.wallet_award_game(text) from public, anon;
grant execute on function public.wallet_award_game(text) to authenticated;

-- ---------------------------------------------------------------- new sinks
-- More to spend it on, which is the half that makes inflation safe. Themes
-- need matching CSS in index.html; these three are defined there.
insert into public.shop_items (kind, key, name, cost) values
  ('theme','vhs','VHS Tracking',300),
  ('theme','bone','Bone China',300),
  ('banner','tape','Tape Loop',140),
  ('banner','dusk','Dusk',140),
  ('banner','static','Static',180)
on conflict (kind, key) do update set name = excluded.name, cost = excluded.cost;

-- ---------------------------------------------------------------- the pin
-- Four new economy columns, so four more lines in the trigger. Miss one and a
-- client can reset its own login streak and reclaim the seven-day banner every
-- single day.
--
-- Everything else is unchanged from ..._20260911100000_game_awards.sql,
-- including the `current_user` escape hatch — read the note in
-- ..._20260909160000_fix_economy_pin.sql before touching that line.
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
    new.login_streak        := 0;
    new.login_best          := 0;
    new.login_last_date     := null;
    new.banner_picks        := 0;
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
