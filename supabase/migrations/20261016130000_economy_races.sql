-- Economy race fixes (2026-10-16). NOT APPLIED until the owner approves.
-- Idempotent: safe to run twice. Touches no stored data.
--
-- 1. award_lore_disc read lore_awards_count without a lock and then wrote
--    count = v_count + 1 while discs moved relatively. Fifty parallel
--    lore_answers inserts all read the same count and all paid 250, so the
--    20-a-day cap could be raced to ~250,000 Discs a day. The check and the
--    payout are now ONE conditional UPDATE: Postgres re-evaluates its WHERE
--    on the locked row, so concurrent inserts serialise on the profile and
--    the twenty-first finds the cap.
--
-- 2. limit_comp_claims (20261015200000) counted committed milestone_claims
--    rows, so parallel wallet_claim_milestone('comp:<invented id>') calls all
--    saw "fewer than two today" and each paid 12,000. A per-user transaction
--    advisory lock makes the count-then-insert atomic per account.
--
-- 3. pin_profile_economy's INSERT branch resets every owned_* array but not
--    the active_* columns, and the client creates its own profile row. So an
--    insert (a new account, or one re-created after delete_my_data) could
--    equip a theme, frame, flair, banner or tag it does not own, including
--    the not-for-sale 'virji'; later updates revert to that forged value.
--    A separate INVOKER trigger, so the long economy body is not retyped.
--    It only acts on a genuinely new row: equipping is an upsert of an
--    existing row, and resetting there would unequip everybody.

create or replace function public.award_lore_disc()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  if new.skipped or new.choice is null then return new; end if;
  update public.profiles set
    discs = coalesce(discs, 0) + 250,
    lore_awards_count = case when lore_awards_date is distinct from v_today then 1
                             else coalesce(lore_awards_count, 0) + 1 end,
    lore_awards_date = v_today
  where id = new.user_id
    and (lore_awards_date is distinct from v_today or coalesce(lore_awards_count, 0) < 20);
  return new;
end $$;

create or replace function public.limit_comp_claims() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.key like 'comp:%' then
    -- Held to commit: a second claim by the same account waits, then counts this one.
    perform pg_advisory_xact_lock(hashtextextended('comp_claims:' || new.user_id::text, 0));
    if not exists (select 1 from public.milestone_claims where user_id = new.user_id and key = new.key)
       and (select count(*) from public.milestone_claims
             where user_id = new.user_id and key like 'comp:%'
               and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') >= 2 then
      raise exception 'Two discography rewards a day — come back tomorrow for this one';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.limit_comp_claims() from public, anon, authenticated;

create or replace function public.pin_profile_cosmetics_on_insert() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  -- Equipping goes through saveProfile's UPSERT, and BEFORE INSERT triggers
  -- fire for an upsert even when the row exists (its NEW becomes EXCLUDED).
  -- An existing row is left to pin_profile_economy's UPDATE ownership checks.
  if exists (select 1 from public.profiles where id = new.id) then return new; end if;
  new.active_theme  := 'classic';
  new.active_banner := null;
  new.active_tag    := null;
  new.active_flair  := null;
  new.active_frame  := null;
  return new;
end $$;
revoke all on function public.pin_profile_cosmetics_on_insert() from public, anon;
drop trigger if exists pin_profile_cosmetics_on_insert_trg on public.profiles;
create trigger pin_profile_cosmetics_on_insert_trg before insert on public.profiles
  for each row execute function public.pin_profile_cosmetics_on_insert();

do $$
begin
  if position('for update' in lower(pg_get_functiondef('public.award_lore_disc()'::regprocedure))) = 0
     and position('< 20' in pg_get_functiondef('public.award_lore_disc()'::regprocedure)) = 0 then
    raise exception 'award_lore_disc must check the cap on the locked row';
  end if;
  if position('pg_advisory_xact_lock' in pg_get_functiondef('public.limit_comp_claims()'::regprocedure)) = 0 then
    raise exception 'limit_comp_claims must lock before counting';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.pin_profile_cosmetics_on_insert()'::regprocedure) then
    raise exception 'pin_profile_cosmetics_on_insert must be security invoker';
  end if;
end $$;
