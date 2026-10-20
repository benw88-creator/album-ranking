-- Server-side write limits (2026-10-20). Idempotent.
--
-- Every table a client may write to had owner-only RLS and nothing bounding
-- VOLUME or SIZE, so one signed-in account (or, for client_errors, anyone)
-- could fill the free plan's 500MB in an afternoon. Limits sit far above the
-- busiest real use measured on production the same day:
--
--   new rows / user / UTC day   measured max   limit   over the limit
--   crate_feed                  87             600     skipped (imports post in bulk)
--   lore_answers                39             300     refused
--   analytics_events            624            3000    skipped
--   feed_comments               3              100     refused
--   follows                     -              300     refused
--   liked_songs                 -              5000    skipped (Spotify import)
--   listening_plays             4005 total     8000    skipped
--   grooves                     -              20      refused
--   lists                       59 total       100     refused
--   leaderboard_times (legacy)  -              200     skipped
--
--   sizes: app_state value 2MB (max 258KB), 100 keys a user; ratings.data
--   20KB (max 898B); lists.items 1MB (max 358KB); analytics props 4KB (78B);
--   listening_days 120,000 rows a user (max 55,678) and dates 2006..tomorrow;
--   client_errors fields truncated and 120 a minute across everybody.
--
-- "Skipped" returns NULL from the trigger so a bulk upsert keeps its other
-- rows; "refused" raises so the person sees why. Upserts of an existing row
-- count too (no generic way to tell): every limit is generous enough for that.

-- 1. One counter, more kinds (rating_insert_allowed from 20261020100000).
create or replace function public.rating_insert_allowed(p_user uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_cap integer := case p_kind
    when 'song' then 400  when 'album' then 150
    when 'feed' then 600  when 'lore' then 300  when 'analytics' then 3000
    when 'comment' then 100 when 'follow' then 300 when 'liked' then 5000
    when 'plays' then 8000 when 'groove' then 20 when 'list' then 100 when 'lb' then 200
    else 0 end;
  v_n integer;
begin
  if p_user is null or p_user is distinct from auth.uid() or v_cap = 0 then return false; end if;
  insert into public.rating_daily_inserts as d (user_id, day, kind, n)
    values (p_user, v_today, p_kind, 1)
    on conflict (user_id, day, kind) do update set n = d.n + 1
    where d.n < v_cap
    returning n into v_n;
  if v_n is null then return false; end if;
  if v_n = 1 then delete from public.rating_daily_inserts where user_id = p_user and day < v_today; end if;
  return true;
end $$;
revoke all on function public.rating_insert_allowed(uuid, text) from public, anon;
grant execute on function public.rating_insert_allowed(uuid, text) to authenticated;

-- 2. One trigger function for every table: args are kind, 'skip'|'raise', user column.
create or replace function public.daily_row_cap() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_user uuid;
begin
  if current_user <> 'authenticated' then return new; end if;   -- definer paths pass
  v_user := (to_jsonb(new) ->> tg_argv[2])::uuid;
  if public.rating_insert_allowed(v_user, tg_argv[0]) then return new; end if;
  if tg_argv[1] = 'raise' then raise exception 'Daily limit reached, try again tomorrow' using errcode = 'P0429'; end if;
  return null;
end $$;
revoke all on function public.daily_row_cap() from public, anon;

do $$
declare r record;
begin
  for r in select * from (values
    ('crate_feed','feed','skip','user_id'), ('lore_answers','lore','raise','user_id'),
    ('analytics_events','analytics','skip','user_id'), ('feed_comments','comment','raise','user_id'),
    ('follows','follow','raise','follower_id'), ('liked_songs','liked','skip','user_id'),
    ('listening_plays','plays','skip','user_id'), ('grooves','groove','raise','owner_id'),
    ('lists','list','raise','user_id'), ('leaderboard_times','lb','skip','user_id')
  ) v(t, k, m, c) loop
    execute format('drop trigger if exists daily_row_cap_trg on public.%I', r.t);
    execute format('create trigger daily_row_cap_trg before insert on public.%I for each row execute function public.daily_row_cap(%L, %L, %L)', r.t, r.k, r.m, r.c);
  end loop;
end $$;

-- 3. Sizes. NOT VALID: checked on every new write, existing rows untouched.
alter table public.app_state drop constraint if exists app_state_value_size;
alter table public.app_state add constraint app_state_value_size check (octet_length(value::text) <= 2000000) not valid;
alter table public.ratings drop constraint if exists ratings_data_size;
alter table public.ratings add constraint ratings_data_size check (octet_length(coalesce(data::text, '')) <= 20000) not valid;
alter table public.lists drop constraint if exists lists_items_size;
alter table public.lists add constraint lists_items_size check (octet_length(coalesce(items::text, '')) <= 1000000 and char_length(coalesce(title, '')) <= 200) not valid;
alter table public.analytics_events drop constraint if exists analytics_events_size;
alter table public.analytics_events add constraint analytics_events_size check (octet_length(coalesce(props::text, '')) <= 4000 and char_length(coalesce(name, '')) <= 80) not valid;

-- 4. app_state: at most 100 keys an account (SYNC_KEYS is ~25).
create or replace function public.app_state_key_cap() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if exists (select 1 from public.app_state where user_id = new.user_id and key = new.key) then return new; end if;
  if (select count(*) from public.app_state where user_id = new.user_id) >= 100 then
    raise exception 'Too many saved keys' using errcode = 'P0429';
  end if;
  return new;
end $$;
revoke all on function public.app_state_key_cap() from public, anon;
drop trigger if exists app_state_key_cap_trg on public.app_state;
create trigger app_state_key_cap_trg before insert on public.app_state
  for each row execute function public.app_state_key_cap();

-- 5. client_errors: anyone may insert (logged-out crashes matter), so bound it
--    globally and trim what it stores.
create or replace function public.client_errors_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Definer (anon cannot read the table to count it), so current_user is the
  -- owner here; nothing server-side inserts crash reports, so apply to all.
  if (select count(*) from public.client_errors where created_at > now() - interval '1 minute') >= 120 then
    return null;
  end if;
  new.message := left(new.message, 2000);
  new.stack   := left(new.stack, 4000);
  new.source  := left(new.source, 500);
  new.url     := left(new.url, 500);
  new.agent   := left(new.agent, 300);
  return new;
end $$;
revoke all on function public.client_errors_guard() from public, anon, authenticated;
drop trigger if exists client_errors_guard_trg on public.client_errors;
create trigger client_errors_guard_trg before insert on public.client_errors
  for each row execute function public.client_errors_guard();

-- 6. listening_days_put: a per-account ceiling and sane dates, patched into the
--    live definition rather than retyped (it is long and was edited by hand).
do $$
declare
  v_def text := pg_get_functiondef('public.listening_days_put(jsonb)'::regprocedure);
  v_mark text := 'at most 2000 rows per call''; end if;';
begin
  if position('listening history limit' in v_def) > 0 then return; end if;   -- already patched
  if position(v_mark in v_def) = 0 or position('where coalesce(r->>''day'', '''') <> ''''' in v_def) = 0 then
    raise exception 'listening_days_put is not the expected definition; patch by hand';
  end if;
  v_def := replace(v_def, v_mark, v_mark || '
  if (select count(*) from public.listening_days where user_id = v_uid) >= 120000 then
    raise exception ''listening history limit reached'' using errcode = ''P0429'';
  end if;');
  v_def := replace(v_def, 'where coalesce(r->>''day'', '''') <> ''''',
    'where coalesce(r->>''day'', '''') ~ ''^\d{4}-\d{2}-\d{2}$'' and (r->>''day'')::date between date ''2006-01-01'' and current_date + 1');
  execute v_def;
end $$;

do $$
begin
  if position('listening history limit' in pg_get_functiondef('public.listening_days_put(jsonb)'::regprocedure)) = 0 then
    raise exception 'listening_days_put cap missing';
  end if;
  if (select count(*) from pg_trigger where tgname = 'daily_row_cap_trg') <> 10 then
    raise exception 'daily_row_cap_trg expected on 10 tables';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.daily_row_cap()'::regprocedure) then
    raise exception 'daily_row_cap must be security invoker';
  end if;
end $$;
