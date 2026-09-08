-- Groove roles: president, vice president, member.
--
-- The creator of a groove becomes its president. A president may promote any
-- member to vice president, and a vice president has the same powers as the
-- president — invite, promote, demote, remove. The one asymmetry is that the
-- president cannot be demoted or removed by anybody, including a VP, because
-- otherwise a promotion is a way to lose your own groove.
--
-- This also closes the gap noted in CLAUDE.md: a groove_members row could be
-- updated by its own member, which included their role. Role is now pinned by
-- a trigger and can only move through the definer functions below.

-- ---------------------------------------------------------------- the column
alter table public.groove_members
  add column if not exists role text not null default 'member';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'groove_members_role_check'
  ) then
    alter table public.groove_members
      add constraint groove_members_role_check
      check (role in ('president', 'vp', 'member'));
  end if;
end $$;

-- Whoever owns each existing groove becomes its president.
update public.groove_members m
   set role = 'president'
  from public.grooves g
 where g.id = m.groove_id
   and g.owner_id = m.user_id
   and m.role <> 'president';

-- ---------------------------------------------------------------- the pin
-- Client writes may never set or change a role. The definer functions below
-- flip a transaction-local flag when they legitimately need to.
create or replace function public.pin_groove_role()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('vinall.role_ok', true), '') = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.role := 'member';
  else
    new.role := old.role;
  end if;
  return new;
end $$;

drop trigger if exists pin_groove_role on public.groove_members;
create trigger pin_groove_role
  before insert or update on public.groove_members
  for each row execute function public.pin_groove_role();

-- ---------------------------------------------------------------- helpers
-- Security definer so the RLS policies below can call it without recursing
-- into their own table's policies.
create or replace function public.groove_is_leader(p_groove uuid, p_user uuid default auth.uid())
returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.groove_members
     where groove_id = p_groove
       and user_id = p_user
       and status = 'member'
       and role in ('president', 'vp')
  );
$$;

create or replace function public.groove_role_of(p_groove uuid, p_user uuid default auth.uid())
returns text
language sql security definer stable
set search_path = public, pg_temp
as $$
  select role from public.groove_members
   where groove_id = p_groove and user_id = p_user;
$$;

-- ---------------------------------------------------------------- creation
-- Replaces two client inserts. Doing it here means owner_id can't be supplied
-- by the caller and the president row cannot be missed or forged.
create or replace function public.groove_create(p_name text)
returns public.grooves
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  g public.grooves;
  nm text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if nm = '' then raise exception 'a groove needs a name'; end if;

  insert into public.grooves (name, owner_id)
  values (left(nm, 40), auth.uid())
  returning * into g;

  perform set_config('vinall.role_ok', '1', true);
  insert into public.groove_members (groove_id, user_id, status, role)
  values (g.id, auth.uid(), 'member', 'president');
  perform set_config('vinall.role_ok', '0', true);

  return g;
end $$;

-- ---------------------------------------------------------------- promotion
create or replace function public.groove_set_role(p_groove uuid, p_user uuid, p_role text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_role not in ('vp', 'member') then
    raise exception 'role must be vp or member';
  end if;
  if not public.groove_is_leader(p_groove) then
    raise exception 'only a president or vice president can change roles';
  end if;
  if public.groove_role_of(p_groove, p_user) = 'president' then
    raise exception 'the president cannot be changed';
  end if;
  if not exists (
    select 1 from public.groove_members
     where groove_id = p_groove and user_id = p_user and status = 'member'
  ) then
    raise exception 'that person is not a member of this groove';
  end if;

  perform set_config('vinall.role_ok', '1', true);
  update public.groove_members
     set role = p_role
   where groove_id = p_groove and user_id = p_user;
  perform set_config('vinall.role_ok', '0', true);
end $$;

-- ---------------------------------------------------------------- removal
create or replace function public.groove_remove_member(p_groove uuid, p_user uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.groove_is_leader(p_groove) then
    raise exception 'only a president or vice president can remove someone';
  end if;
  if public.groove_role_of(p_groove, p_user) = 'president' then
    raise exception 'the president cannot be removed';
  end if;
  if p_user = auth.uid() then
    raise exception 'use leave instead';
  end if;

  delete from public.groove_members
   where groove_id = p_groove and user_id = p_user;
end $$;

-- ---------------------------------------------------------------- invites
-- Restrictive policies AND with whatever permissive policies already exist,
-- so these can only narrow what is allowed — no need to know the current
-- policy set to add them safely.
drop policy if exists groove_members_insert_self_or_leader on public.groove_members;
create policy groove_members_insert_self_or_leader
  on public.groove_members as restrictive for insert
  to authenticated
  with check (
    user_id = auth.uid()                    -- accepting an invite, or a link join
    or public.groove_is_leader(groove_id)   -- a leader inviting someone
  );

drop policy if exists groove_members_delete_self_or_leader on public.groove_members;
create policy groove_members_delete_self_or_leader
  on public.groove_members as restrictive for delete
  to authenticated
  using (
    user_id = auth.uid()                    -- leaving
    or public.groove_is_leader(groove_id)   -- a leader removing someone
  );

-- ---------------------------------------------------------------- grants
revoke all on function public.groove_create(text)                     from public, anon;
revoke all on function public.groove_set_role(uuid, uuid, text)       from public, anon;
revoke all on function public.groove_remove_member(uuid, uuid)        from public, anon;
grant execute on function public.groove_create(text)                  to authenticated;
grant execute on function public.groove_set_role(uuid, uuid, text)    to authenticated;
grant execute on function public.groove_remove_member(uuid, uuid)     to authenticated;
grant execute on function public.groove_is_leader(uuid, uuid)         to authenticated;
grant execute on function public.groove_role_of(uuid, uuid)           to authenticated;
