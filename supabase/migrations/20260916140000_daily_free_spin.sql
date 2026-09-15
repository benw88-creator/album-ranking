-- One free spin a day, for everybody.
--
-- ---------------------------------------------------------------------------
-- What this costs, stated plainly before anything else
-- ---------------------------------------------------------------------------
-- The Draw's expected return is **2,993 Discs**. A free spin is that much value
-- injected daily with nothing taken out, so at worst case this is
-- **~21,000 Discs a week — more than the entire login ladder (18,000)**, and it
-- undoes a good part of what ..._20260915140000 just did to the income mix.
--
-- The realistic figure is lower for an account that does not own every
-- cosmetic, because most of that 2,993 is duplicate payouts: a fresh account
-- wins *items* where a complete one wins Discs. The pure-Disc rows alone are
-- ~1,822 a day. So the honest range is **1,800-3,000 Discs a day**, against a
-- realistic day's play of 7,000-12,000.
--
-- **This does not break the sink rule.** That rule is about the ratio a *paid*
-- spin returns, and 2,993 against 5,000 is untouched — a free spin is a faucet
-- sitting next to the sink, not a change to it. But it is a faucet, and it is
-- the biggest single one in the app after the login ladder. If the numbers get
-- another pass, this is the line to look at first.
--
-- It was asked for and it is a good feature: the Draw is the most enjoyable
-- thing in the app and 5,000 a go means most people would see it rarely.
-- Everything above is so the cost is a decision rather than a discovery.
--
-- ---------------------------------------------------------------------------
-- How it works
-- ---------------------------------------------------------------------------
-- `profiles.spin_free_date` holds the day the free spin was last taken, in UTC,
-- the same shape as `login_last_date` and `game_awards_date`. wallet_spin sets
-- v_cost to 0 and stamps the date in the same transaction that grants the
-- prize, so there is no window where a second call is also free.
--
-- **The server decides, never the caller.** The browser asks
-- `spin_free_available()` only to label the button, exactly as the ladder draws
-- from LADDER while wallet_daily_login is what pays.
--
-- **The column is pinned.** Without that line in pin_profile_economy a client
-- clears the date and takes a free spin on every reload — the same hole the
-- daily award counters would have had. This is a create-or-replace of the
-- trigger as it stands after ..._20260914233000_game_play_limits.sql with two
-- lines added and nothing else touched.

alter table public.profiles
  add column if not exists spin_free_date date;

-- Read-only, for the button label. Says nothing a spin would not reveal.
create or replace function public.spin_free_available()
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select spin_free_date is distinct from (now() at time zone 'utc')::date
       from public.profiles where id = auth.uid()),
    false);
$$;

revoke all on function public.spin_free_available() from public, anon;
grant execute on function public.spin_free_available() to authenticated;

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
    new.spin_free_date      := null;
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
  -- Without this a client clears the date and takes a free spin every reload.
  new.spin_free_date      := old.spin_free_date;
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

create or replace function public.wallet_spin()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  p        public.profiles;
  v_cost   integer := 5000;
  v_today  date := (now() at time zone 'utc')::date;
  v_free   boolean := false;
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

  -- One free spin a day. Decided here and not by the caller: the browser
  -- knowing whether it is owed one is display, the same relationship the
  -- ladder has with wallet_daily_login.
  if p.spin_free_date is distinct from v_today then
    v_free := true;
    v_cost := 0;
    p.spin_free_date := v_today;
  end if;

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
    discs           = p.discs,
    spin_free_date  = p.spin_free_date,
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
    'free', v_free,
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

-- ------------------------------------------------------------------- guards
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='profiles'
                    and column_name='spin_free_date') then
    raise exception 'profiles.spin_free_date missing';
  end if;
  if (select prosrc from pg_proc where proname='pin_profile_economy') not like '%spin_free_date%' then
    raise exception 'pin_profile_economy does not pin spin_free_date — a client could clear it and spin free every reload';
  end if;
  if (select prosrc from pg_proc where proname='wallet_spin') not like '%spin_free_date%' then
    raise exception 'wallet_spin does not stamp spin_free_date — the free spin would never be spent';
  end if;
  raise notice 'One free spin a day. Expected cost to the economy: ~1,800-3,000 Discs per user per day.';
end $$;
