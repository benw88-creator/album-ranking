-- The Draw: a Disc-priced spin, and a second inflation pass to feed it.
--
-- ---------------------------------------------------------------------------
-- What this is, and what it deliberately is not
-- ---------------------------------------------------------------------------
-- A case-opening reel. You pay Discs, a strip of possible prizes scrolls past,
-- it decelerates, and it lands on one.
--
-- It is not gambling, and the distance is worth keeping:
--
--   * Discs cannot be bought. They are earned only, there is no purchase path,
--     and terms.html already says so in as many words.
--   * Nothing it awards has cash value or leaves the app.
--   * The odds are published in the UI, not buried. Apple requires disclosed
--     odds for anything loot-box shaped (guideline 3.1.1) and it is the right
--     thing to do regardless.
--
-- If a way to buy Discs for money is ever added, this feature becomes a
-- regulated product in the UK and several other markets. Do not add one
-- without taking advice first.
--
-- ---------------------------------------------------------------------------
-- Why the server picks
-- ---------------------------------------------------------------------------
-- The browser is told what it won, never asked. The whole animation is theatre
-- played out after the result already exists -- exactly like bid_war_submit,
-- where the resolution happens in Postgres and the reveal is a rendering of
-- something already decided. A client that picked its own prize would be a
-- client that always picked the rarest one.

-- ---------------------------------------------------------------- the pool
create table if not exists public.spin_items (
  key     text primary key,
  kind    text not null check (kind in ('discs', 'theme', 'banner', 'banner_pick')),
  label   text not null,
  -- amount: Discs awarded for kind='discs'; for the others it is the Disc
  -- consolation when you already own the thing.
  amount  integer not null default 0,
  ref     text,
  weight  integer not null check (weight > 0),
  tier    text not null default 'common' check (tier in ('common','uncommon','rare','legendary'))
);

alter table public.spin_items enable row level security;
-- Odds are public on purpose. A published table is the disclosure.
drop policy if exists "anyone reads the odds" on public.spin_items;
create policy "anyone reads the odds" on public.spin_items for select using (true);

insert into public.spin_items (key, kind, label, amount, ref, weight, tier) values
  ('d80',      'discs',       '80 Discs',      80,  null,     300, 'common'),
  ('d200',     'discs',       '200 Discs',     200, null,     250, 'common'),
  ('d500',     'discs',       '500 Discs',     500, null,     150, 'uncommon'),
  ('b_tape',   'banner',      'Tape Loop',     150, 'tape',    70, 'uncommon'),
  ('b_dusk',   'banner',      'Dusk',          150, 'dusk',    70, 'uncommon'),
  ('b_static', 'banner',      'Static',        180, 'static',  70, 'uncommon'),
  ('t_vhs',    'theme',       'VHS Tracking',  300, 'vhs',     35, 'rare'),
  ('t_bone',   'theme',       'Bone China',    300, 'bone',    35, 'rare'),
  ('t_neon',   'theme',       'Neon Vault',    350, 'neon',    10, 'legendary'),
  ('album',    'banner_pick', 'Album banner',  0,   null,      10, 'legendary')
on conflict (key) do update set
  kind = excluded.kind, label = excluded.label, amount = excluded.amount,
  ref = excluded.ref, weight = excluded.weight, tier = excluded.tier;

-- ---------------------------------------------------------------- the spin
create or replace function public.wallet_spin()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  p        public.profiles;
  v_cost   integer := 250;
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

  -- Weighted pick, walked server-side. random() here rather than anywhere the
  -- client can reach.
  v_roll := floor(random() * v_total) + 1;
  for v_item in select * from public.spin_items order by key loop
    v_acc := v_acc + v_item.weight;
    exit when v_acc >= v_roll;
  end loop;

  -- Spend first, so a failure below cannot hand out a free spin.
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
      -- Owning it already must not mean winning nothing. A duplicate pays its
      -- shop price back in Discs, which is the only thing that keeps the rare
      -- tiers worth landing on once you have them.
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
    discs         = p.discs,
    owned_themes  = p.owned_themes,
    owned_banners = p.owned_banners,
    banner_picks  = p.banner_picks
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'cost', case when coalesce(p.is_admin, false) then 0 else v_cost end,
    'key', v_item.key, 'kind', v_item.kind, 'label', v_item.label,
    'ref', v_item.ref, 'tier', v_item.tier,
    'gained', v_gain, 'duplicate', v_dupe,
    'discs', p.discs, 'banner_picks', p.banner_picks,
    'owned_themes', p.owned_themes, 'owned_banners', p.owned_banners);
end;
$$;

revoke all on function public.wallet_spin() from public, anon;
grant execute on function public.wallet_spin() to authenticated;

-- ------------------------------------------------------- inflation, again
-- Roughly another doubling, so The Draw at 250 is something you can afford a
-- few times a day rather than once a week. The ceiling goes to roughly 900 a
-- day for someone doing everything; a realistic session lands near 250, which
-- is one spin.
--
-- This is only safe because The Draw is a bottomless sink. Without it, this
-- much inflation would buy out the whole shop inside three days.
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
    v_earn := 8;
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
    discs = coalesce(discs, 0) + 5,
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
    when 'earworm'     then v_amt := 50; v_cap := 3;
    when 'drop'        then v_amt := 75; v_cap := 1;
    when 'tournament'  then v_amt := 40; v_cap := 2;
    when 'achievement' then v_amt := 40; v_cap := 5;
    when 'higherlower' then v_amt := 40; v_cap := 3;
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

-- Login: 25 rising to 100 by day seven, then flat.
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

  if v_gap = 1 then
    p.login_streak := p.login_streak + 1;
  else
    p.login_streak := 1;
  end if;
  p.login_best := greatest(coalesce(p.login_best, 0), p.login_streak);
  p.login_last_date := v_today;

  v_earn := least(25 + (p.login_streak - 1) * 12, 100);

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

revoke all on function public.wallet_daily_login() from public, anon;
grant execute on function public.wallet_daily_login() to authenticated;
