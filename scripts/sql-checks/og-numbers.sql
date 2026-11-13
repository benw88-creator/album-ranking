-- Run inside a transaction that is rolled back: nothing persists.
--   supabase db query --linked --project-ref <LAB> -f scripts/sql-checks/og-numbers.sql
begin;
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); na smallint; nb smallint; mx smallint;
begin
  select coalesce(max(n),0) into mx from public.og_numbers;
  insert into auth.users (id, instance_id, aud, role, email, created_at)
    values (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'og-a@test.invalid', now());
  insert into auth.users (id, instance_id, aud, role, email, created_at)
    values (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'og-b@test.invalid', now());
  select n into na from public.og_numbers where user_id = a;
  select n into nb from public.og_numbers where user_id = b;
  if mx < 998 and (na is distinct from mx + 1 or nb is distinct from mx + 2) then
    raise exception 'signup numbering wrong: max % got % %', mx, na, nb;
  end if;
  -- A profile insert cannot claim a number, and an update cannot change it.
  insert into public.profiles (id, username, og_number) values (a, 'ogtest_a', 1);
  if (select og_number from public.profiles where id = a) is distinct from na then
    raise exception 'profile insert took a client number';
  end if;
  update public.profiles set og_number = 7 where id = a;
  if (select og_number from public.profiles where id = a) is distinct from na then
    raise exception 'profile update changed the number';
  end if;
  -- Re-assigning is a no-op.
  if public.og_assign(a) is distinct from na then raise exception 'og_assign not idempotent'; end if;
  -- Deleting the account retires the number; the next signup does not reuse it.
  delete from public.profiles where id = b;
  delete from auth.users where id = b;
  if not exists (select 1 from public.og_numbers where n = nb and user_id is null) then
    raise exception 'deleted number not retired';
  end if;
  insert into auth.users (id, instance_id, aud, role, email, created_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'og-c@test.invalid', now());
  if mx < 997 and (select max(n) from public.og_numbers) <> nb + 1 then
    raise exception 'retired number reused or skipped';
  end if;
  raise notice 'og-numbers: ok (a=%, b=% retired)', na, nb;
end $$;
rollback;
