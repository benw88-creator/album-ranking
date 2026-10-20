-- Daily cap on NEW rating rows (2026-10-20). Idempotent.
--
-- ratings has an owner-only write policy with no volume limit, and album
-- milestones (197,000 Discs), xp_bonus (level), the Higher or Lower bound and
-- the referral gate all COUNT rows. So a console loop could insert 500 fake
-- ratings and claim the lot in seconds.
--
-- A new row past 150 albums / 400 songs a UTC day is SKIPPED (the trigger
-- returns NULL), never refused: reconcileRatings and the importer upsert in
-- chunks of 200, and one refused row would fail the whole chunk every day.
-- Skipped rows stay in the person's crate (app_state) and land on later days.
-- Updating an existing row (a re-rate, an upsert) never counts. Busiest real
-- day measured before this: 129 albums, 263 songs.
--
-- ponytail: a rate limit, not proof of listening. A determined cheat reaches
-- 500 albums in four days instead of four seconds. Lower the caps if abused.

create table if not exists public.rating_daily_inserts (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  kind text not null,
  n integer not null default 0,
  primary key (user_id, day, kind)
);
alter table public.rating_daily_inserts enable row level security;

create or replace function public.rating_insert_allowed(p_user uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_cap integer := case when p_kind = 'song' then 400 else 150 end;
  v_n integer;
begin
  if p_user is null or p_user is distinct from auth.uid() then return false; end if;
  insert into public.rating_daily_inserts as d (user_id, day, kind, n)
    values (p_user, v_today, p_kind, 1)
    on conflict (user_id, day, kind) do update set n = d.n + 1
    where d.n < v_cap
    returning n into v_n;
  if v_n is null then return false; end if;   -- at the cap: the row lock made this atomic
  if v_n = 1 then delete from public.rating_daily_inserts where user_id = p_user and day < v_today; end if;
  return true;
end $$;
revoke all on function public.rating_insert_allowed(uuid, text) from public, anon;
grant execute on function public.rating_insert_allowed(uuid, text) to authenticated;

-- INVOKER: current_user is 'authenticated' only for a direct client write.
create or replace function public.rating_daily_cap() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if exists (select 1 from public.ratings r
              where r.user_id = new.user_id and r.kind = new.kind and r.item_id = new.item_id) then
    return new;   -- an update / re-rate, including an upsert of an existing row
  end if;
  if not public.rating_insert_allowed(new.user_id, new.kind) then return null; end if;
  return new;
end $$;
revoke all on function public.rating_daily_cap() from public, anon;

drop trigger if exists rating_daily_cap_trg on public.ratings;
create trigger rating_daily_cap_trg before insert on public.ratings
  for each row execute function public.rating_daily_cap();

do $$
begin
  if exists (select 1 from pg_policy where polrelid = 'public.rating_daily_inserts'::regclass) then
    raise exception 'rating_daily_inserts must have no policies';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.rating_daily_cap()'::regprocedure) then
    raise exception 'rating_daily_cap must be security invoker';
  end if;
end $$;
