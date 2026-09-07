-- ===========================================================================
-- Move the economy off the client.
--
-- Until now `discs`, the streak columns and the cosmetic arrays were written
-- straight from the browser through Cloud.saveProfile, which upserts whatever
-- fields it is handed. Anyone could set themselves any balance, any streak and
-- every cosmetic from the console. The daily rating cap was an in-memory
-- variable, so it was not a limit either.
--
-- Nothing can be sold on top of a currency users can type into existence, so
-- all of it moves behind security definer functions and a trigger that pins
-- the columns against direct writes.
-- ===========================================================================

alter table public.profiles
  add column if not exists rating_awards_date  date,
  add column if not exists rating_awards_count integer not null default 0,
  add column if not exists lore_awards_date    date,
  add column if not exists lore_awards_count   integer not null default 0;

-- Prices live in the database, not in the page that is trying to spend them.
create table if not exists public.shop_items (
  kind text not null check (kind in ('theme','banner')),
  key  text not null,
  name text not null,
  cost integer not null check (cost >= 0),
  primary key (kind, key)
);

insert into public.shop_items (kind, key, name, cost) values
  ('theme','classic','Crate',0),
  ('theme','sundown','Sundown',150),
  ('theme','cassette','Cassette',150),
  ('theme','citrus','Citrus',250),
  ('theme','neon','Neon Vault',350),
  ('theme','blanc','Blanc',400),
  ('banner','none','None',0),
  ('banner','aurora','Aurora',100),
  ('banner','ember','Ember',100),
  ('banner','mono','Mono Fade',80)
on conflict (kind, key) do update set name = excluded.name, cost = excluded.cost;

alter table public.shop_items enable row level security;
-- Prices are public; nobody may write them from the client.
create policy "anyone reads prices" on public.shop_items for select using (true);

-- ---------------------------------------------------------------------------
-- Pin every economy column against client writes. Replaces the narrower
-- is_admin trigger from 20260907090000 -- same technique, wider remit.
--
-- A trigger rather than column-level REVOKE because saveProfile() sends whole
-- rows: revoking would make ordinary profile edits fail outright, where this
-- quietly keeps the old values and lets the legitimate fields through.
-- ---------------------------------------------------------------------------
create or replace function public.pin_profile_economy()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  -- Only end users coming through the API are constrained. The SQL editor,
  -- service_role, and the wallet functions below all pass straight through.
  if auth.role() is distinct from 'authenticated' then
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

  -- Equipping is left to the client, but only to something actually owned,
  -- otherwise the cosmetics are free after all.
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

-- ---------------------------------------------------------------------------
-- The only ways to move the economy. Each returns the caller's fresh wallet
-- so the client never has to compute a balance itself.
-- ---------------------------------------------------------------------------
create or replace function public.wallet_state()
returns public.profiles
language sql security definer stable
set search_path = public, pg_temp
as $$ select * from public.profiles where id = auth.uid(); $$;

-- Awards discs for a rating and moves the streak. Mirrors what the browser
-- used to do -- 3 discs, 5 a day -- except the cap is now real.
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

  if p.rating_awards_count < 5 then
    v_earn := 3;
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

-- Buying: the price comes from shop_items, never from the request.
create or replace function public.wallet_buy(p_kind text, p_key text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := auth.uid();
  p      public.profiles;
  v_cost integer;
  v_owned text[];
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select cost into v_cost from public.shop_items where kind = p_kind and key = p_key;
  if v_cost is null then raise exception 'No such item'; end if;

  select * into p from public.profiles where id = v_me for update;

  v_owned := case when p_kind = 'theme' then coalesce(p.owned_themes, '{}'::text[])
                  else coalesce(p.owned_banners, '{}'::text[]) end;
  if p_key = any(v_owned) then raise exception 'Already owned'; end if;

  -- is_admin still gets everything free, as documented in the discs migration.
  if not coalesce(p.is_admin, false) and coalesce(p.discs, 0) < v_cost then
    raise exception 'Not enough Discs';
  end if;

  update public.profiles set
    discs = case when coalesce(is_admin, false) then discs else coalesce(discs, 0) - v_cost end,
    owned_themes  = case when p_kind = 'theme'  then array_append(coalesce(owned_themes, '{}'::text[]), p_key)  else owned_themes end,
    owned_banners = case when p_kind = 'banner' then array_append(coalesce(owned_banners, '{}'::text[]), p_key) else owned_banners end
  where id = v_me
  returning * into p;

  return jsonb_build_object('ok', true, 'discs', p.discs,
                            'owned_themes', p.owned_themes, 'owned_banners', p.owned_banners);
end;
$$;

-- Lore pays 2 discs a time, capped so the stack cannot be farmed. Awarded by
-- trigger rather than by the client, for the same reason as everything else.
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
    discs = coalesce(discs, 0) + 2,
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

revoke all on function public.wallet_state()                from public, anon;
revoke all on function public.wallet_record_rating()        from public, anon;
revoke all on function public.wallet_buy(text, text)        from public, anon;
grant execute on function public.wallet_state()             to authenticated;
grant execute on function public.wallet_record_rating()     to authenticated;
grant execute on function public.wallet_buy(text, text)     to authenticated;
