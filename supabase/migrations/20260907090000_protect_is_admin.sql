-- Stop clients writing `profiles.is_admin`.
--
-- The UPDATE policy on profiles is `USING (auth.uid() = id)` with no WITH CHECK.
-- That restricts which ROWS a user may update, but says nothing about which
-- COLUMNS -- and Cloud.saveProfile() upserts arbitrary client-supplied fields.
-- So any signed-up user could set is_admin = true on their own row, which the
-- client reads to unlock every theme and price every shop item at "Free (Admin)".
--
-- A column-level REVOKE would break saveProfile outright, because it sends whole
-- rows and would start erroring. A trigger instead silently pins the column to
-- its previous value, so existing client code keeps working unchanged.
--
-- Non-API callers (the SQL editor, service_role) are unaffected, so granting
-- yourself admin by hand still works exactly as documented in
-- supabase-migration-discs.sql.

create or replace function public.pin_profile_is_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- only constrain end users authenticated through the API
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.is_admin := false;          -- no OLD row to inherit from
  else
    new.is_admin := old.is_admin;   -- ignore whatever the client sent
  end if;

  return new;
end;
$$;

drop trigger if exists pin_profile_is_admin on public.profiles;

create trigger pin_profile_is_admin
  before insert or update on public.profiles
  for each row execute function public.pin_profile_is_admin();
