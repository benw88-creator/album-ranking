-- OG numbers: #001-#999, by registration order, permanent.
--
-- og_numbers is the authority. A row is never deleted: when an account is
-- deleted its user_id goes NULL and the number is retired, so max(n) only
-- ever rises and a number is never handed out twice. profiles.og_number is a
-- pinned copy so the profile read (select *) carries it with no extra trip.
--
-- Idempotent: re-running assigns numbers only to accounts that have none,
-- continuing after the highest number ever issued.

create table if not exists public.og_numbers (
  n           smallint primary key check (n between 1 and 999),
  user_id     uuid unique references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now()
);
alter table public.og_numbers enable row level security;
drop policy if exists og_numbers_read on public.og_numbers;
create policy og_numbers_read on public.og_numbers for select using (true);
revoke insert, update, delete on public.og_numbers from anon, authenticated;

alter table public.profiles add column if not exists og_number smallint;

-- One allocator, used by the signup trigger and the backfill. Serialised by a
-- transaction advisory lock so two signups cannot read the same max.
create or replace function public.og_assign(p_user uuid) returns smallint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v smallint;
begin
  if p_user is null then return null; end if;
  perform pg_advisory_xact_lock(hashtext('vinall_og_numbers'));
  select n into v from og_numbers where user_id = p_user;
  if v is not null then return v; end if;
  select coalesce(max(n), 0) + 1 into v from og_numbers;
  if v > 999 then return null; end if;
  insert into og_numbers (n, user_id) values (v, p_user);
  update profiles set og_number = v where id = p_user;
  return v;
end $$;
revoke all on function public.og_assign(uuid) from public, anon, authenticated;

-- Backfill: every existing account without a number, oldest first, id breaks
-- ties. Runs before the signup trigger exists, inside this transaction.
do $$
declare r record;
begin
  perform pg_advisory_xact_lock(hashtext('vinall_og_numbers'));
  for r in
    select u.id from auth.users u
    where not exists (select 1 from public.og_numbers o where o.user_id = u.id)
    order by u.created_at, u.id
  loop
    exit when public.og_assign(r.id) is null;
  end loop;
end $$;

-- profiles.og_number is never the client's to write.
create or replace function public.pin_og_number() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- Always the table's value, on insert and update alike, whoever writes.
  new.og_number := (select n from og_numbers where user_id = new.id);
  return new;
end $$;
drop trigger if exists pin_og_number_trg on public.profiles;
create trigger pin_og_number_trg before insert or update on public.profiles
  for each row execute function public.pin_og_number();

-- Copy any number assigned before the column existed.
update public.profiles p set og_number = o.n
  from public.og_numbers o where o.user_id = p.id and p.og_number is distinct from o.n;

-- Signup assigns the number. A failure here must never fail a signup, so it
-- is swallowed: the account then simply has no number.
create or replace function public.og_on_signup() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    perform public.og_assign(new.id);
  exception when others then
    null;
  end;
  return new;
end $$;
drop trigger if exists og_on_signup_trg on auth.users;
create trigger og_on_signup_trg after insert on auth.users
  for each row execute function public.og_on_signup();

-- Guards.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'og_numbers' and cmd <> 'SELECT') then
    raise exception 'og_numbers must have no write policy';
  end if;
  if exists (select n from public.og_numbers group by n having count(*) > 1) then
    raise exception 'duplicate OG number';
  end if;
end $$;
