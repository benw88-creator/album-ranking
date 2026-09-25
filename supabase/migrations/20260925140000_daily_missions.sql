-- Daily Missions — 10,000 Discs a day, six missions, each computed LIVE from
-- tables that already exist rather than a client-incremented counter, so
-- refreshing the page cannot move progress and a claim can only ever be
-- checked against what actually happened today.
--
-- Same shape as spin_free_date / game_awards_date: one pinned date column and
-- one pinned claimed-keys array, reset together the first time either is
-- touched on a new day. Apply by hand in the SQL editor, like the others.

alter table public.profiles
  add column if not exists missions_date    date,
  add column if not exists missions_claimed text[] not null default '{}'::text[];

-- ------------------------------------------------------------- definitions
-- Kept in one function so the client and the payout agree on the same list.
-- key, target, reward. Total 10,000.
create or replace function public.daily_missions_defs()
returns table(key text, label text, target integer, reward integer)
language sql immutable
as $$
  values
    ('rank3',   'Rank 3 albums today',        3, 2500),
    ('buy1',    'Buy a record',                1, 2000),
    ('game1',   'Play a minigame',             1, 1500),
    ('songs5',  'Rate 5 songs today',          5, 1500),
    ('lore1',   'Answer a Lore question',      1, 1500),
    ('login1',  'Open the app',                1, 1000)
$$;

-- ------------------------------------------------------------------ status
create or replace function public.daily_missions_status()
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  p public.profiles;
  v_claimed text[];
  v_rank3 integer; v_buy1 integer; v_game1 integer; v_songs5 integer; v_lore1 integer; v_login1 integer;
  d record;
  out jsonb := '[]'::jsonb;
  v_progress integer;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into p from public.profiles where id = v_me;
  v_claimed := case when p.missions_date is distinct from v_today then '{}'::text[] else coalesce(p.missions_claimed, '{}'::text[]) end;

  select count(distinct item_id) into v_rank3 from public.ratings
   where user_id = v_me and kind = 'album' and updated_at::date = v_today;
  select count(*) into v_buy1 from public.collection
   where user_id = v_me and bought_at::date = v_today;
  select case when p.game_awards_date = v_today and coalesce(p.game_awards, '{}'::jsonb) <> '{}'::jsonb then 1 else 0 end into v_game1;
  select count(distinct item_id) into v_songs5 from public.ratings
   where user_id = v_me and kind = 'song' and updated_at::date = v_today;
  select count(*) into v_lore1 from public.lore_answers
   where user_id = v_me and created_at::date = v_today;
  select case when p.login_last_date = v_today then 1 else 0 end into v_login1;

  for d in select * from public.daily_missions_defs() loop
    v_progress := case d.key
      when 'rank3'  then v_rank3
      when 'buy1'   then v_buy1
      when 'game1'  then v_game1
      when 'songs5' then v_songs5
      when 'lore1'  then v_lore1
      when 'login1' then v_login1
      else 0 end;
    out := out || jsonb_build_object(
      'key', d.key, 'label', d.label, 'target', d.target, 'reward', d.reward,
      'progress', least(v_progress, d.target),
      'done', v_progress >= d.target,
      'claimed', d.key = any(v_claimed));
  end loop;

  return jsonb_build_object('date', v_today, 'missions', out, 'claimed', v_claimed);
end $$;

revoke all on function public.daily_missions_status() from public, anon;
grant execute on function public.daily_missions_status() to authenticated;

-- ------------------------------------------------------------------- claim
create or replace function public.daily_missions_claim(p_key text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  p public.profiles;
  v_status jsonb;
  v_mission jsonb;
  v_reward integer;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;

  if p.missions_date is distinct from v_today then
    p.missions_date := v_today;
    p.missions_claimed := '{}'::text[];
  end if;

  if p_key = any(p.missions_claimed) then
    raise exception 'Already claimed today';
  end if;

  -- Re-derives progress itself rather than trusting the status call the
  -- client just made — the same posture wallet_buy takes with a price.
  v_status := public.daily_missions_status();
  select m into v_mission from jsonb_array_elements(v_status -> 'missions') m
   where m ->> 'key' = p_key;
  if v_mission is null then raise exception 'Unknown mission'; end if;
  if not (v_mission ->> 'done')::boolean then raise exception 'Not done yet'; end if;

  v_reward := (v_mission ->> 'reward')::integer;
  p.missions_claimed := p.missions_claimed || p_key;

  update public.profiles set
    discs = discs + v_reward,
    missions_date = p.missions_date,
    missions_claimed = p.missions_claimed
  where id = v_me
  returning * into p;

  return jsonb_build_object('ok', true, 'key', p_key, 'reward', v_reward, 'discs', p.discs);
end $$;

revoke all on function public.daily_missions_claim(text) from public, anon;
grant execute on function public.daily_missions_claim(text) to authenticated;

-- ------------------------------------------------------------------ guards
do $$
declare v_total integer;
begin
  select sum(reward) into v_total from public.daily_missions_defs();
  if v_total <> 10000 then
    raise exception 'Daily missions no longer sum to 10,000 — they sum to %', v_total;
  end if;
end $$;

-- A SEPARATE, NARROW trigger for just these two columns, rather than
-- re-declaring pin_profile_economy from a copy that might drift from the
-- live one. Same escape hatch (current_user, not the JWT — see
-- ..._fix_economy_pin.sql for why): a security definer function's UPDATE
-- runs as the function owner, not 'authenticated', so daily_missions_claim
-- passes straight through while a direct client PATCH cannot move either
-- column.
create or replace function public.pin_daily_missions()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' then
    new.missions_date    := old.missions_date;
    new.missions_claimed := old.missions_claimed;
  end if;
  return new;
end $$;

drop trigger if exists pin_daily_missions_trg on public.profiles;
create trigger pin_daily_missions_trg
  before update on public.profiles
  for each row execute function public.pin_daily_missions();
