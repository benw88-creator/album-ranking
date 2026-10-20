-- Levels: a curve that lasts months, and nobody loses the level they have.
--
-- The old step was 80 * L^1.35. Against what an account actually earns (a
-- rating is 400 Discs + 1,200 bonus XP, a day active 2,000) a new account
-- was level 12 after about three albums, and the ladder to 200 was a few
-- weeks long. The new step is 1,500 * L^1.6:
--
--   after the first session (~8k XP)   level 3
--   a realistic week       (~150k)     level 8
--   a month                (~600k)     level 14
--   a year                 (~7.6M)     level 38
--
-- EXISTING ACCOUNTS KEEP THEIR LEVEL. profiles.level_floor is stamped with
-- the level each account has today, and a trigger that runs after every other
-- profile trigger holds level at or above it. They earn nothing back until the
-- new curve passes them, which is the honest version of "nobody goes
-- backwards" — the alternative re-levels everybody downwards on deploy.
--
-- Mirrors xpStep() in the Wallet module of index.html. Change one, change both.
--
-- Idempotent: create or replace, add column if not exists, and the floor only
-- ever rises. Apply by hand in the SQL editor, then record it:
--   supabase migration repair --status applied 20261021110000

create or replace function public.xp_step(p_level integer)
returns bigint
language sql immutable
as $$ select greatest(1, round(1500 * power(greatest(p_level, 1), 1.6)))::bigint; $$;

alter table public.profiles add column if not exists level_floor integer not null default 1;
comment on column public.profiles.level_floor is
  'The level an account had when the curve changed (20261021110000). level never drops below it.';

-- Stamp BEFORE recomputing, so the floor is the level people actually had.
update public.profiles set level_floor = level where coalesce(level, 1) > level_floor;

create or replace function public.hold_level_floor()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  -- A client can never write its own floor (or anything else here).
  if current_user = 'authenticated' then
    new.level_floor := case when tg_op = 'UPDATE' then old.level_floor else 1 end;
  end if;
  new.level := greatest(coalesce(new.level, 1), coalesce(new.level_floor, 1));
  return new;
end $$;

-- zz_: triggers fire in name order, and this must see the level that
-- pin_profile_economy has just computed.
drop trigger if exists zz_level_floor_trg on public.profiles;
create trigger zz_level_floor_trg before insert or update on public.profiles
  for each row execute function public.hold_level_floor();

update public.profiles p
   set level = greatest(p.level_floor, public.level_for_xp(coalesce(p.lifetime_xp, 0) + coalesce(p.xp_bonus, 0)))
 where p.level is distinct from greatest(p.level_floor, public.level_for_xp(coalesce(p.lifetime_xp, 0) + coalesce(p.xp_bonus, 0)));

do $$
begin
  if public.level_for_xp(8000) <> 3 then raise exception 'level curve: a first session should be level 3'; end if;
  if public.level_for_xp(150000) <> 8 then raise exception 'level curve: a week should be level 8'; end if;
  if public.level_for_xp(600000) <> 14 then raise exception 'level curve: a month should be level 14'; end if;
  if exists (select 1 from public.profiles where level < level_floor) then
    raise exception 'an account sits below its level floor';
  end if;
end $$;
