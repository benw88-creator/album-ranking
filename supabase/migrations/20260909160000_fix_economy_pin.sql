-- The Discs economy has been inert for every non-admin user since
-- ..._190000_server_economy.sql. This is a one-function fix.
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
-- `pin_profile_economy` is a BEFORE INSERT OR UPDATE trigger on profiles that
-- reverts any client attempt to move discs, streaks or owned cosmetics. Its
-- pass-through for legitimate writes was:
--
--     if auth.role() is distinct from 'authenticated' then return new; end if;
--
-- with the comment "the wallet functions below all pass straight through".
-- They did not. `auth.role()` reads the request's JWT claim out of a
-- request-scoped GUC that PostgREST sets once, at the start of the request.
-- SECURITY DEFINER changes the *executing role*; it does not touch those
-- claims. So inside wallet_record_rating(), auth.role() is still
-- 'authenticated', the guard does not fire, and the trigger overwrites the
-- award with `new.discs := old.discs`.
--
-- Every server-side economy write was being silently reverted:
--
--   * wallet_record_rating()  — 3 discs per rating, and the streak
--   * wallet_buy()            — the deduction and the cosmetic
--   * award_lore_disc()       — 2 discs per lore answer
--   * bid_war_submit()        — the +30 / +8 / +15 payouts
--
-- Two things hid it. `wallet_record_rating` returns `earned` from a local
-- variable while `discs` comes from `returning *` — the post-trigger row — so
-- the client cheerfully toasted "+3 Discs" next to a number that never moved.
-- And the only person who would have noticed is an admin, whose balance
-- renders as the literal '∞' regardless of what is stored.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
-- `current_user` is what the original check meant. PostgREST issues
-- SET LOCAL ROLE per request, so a client's own UPDATE arrives with
-- current_user = 'authenticated'. Inside a SECURITY DEFINER function
-- current_user is the function's owner instead, and the SQL editor and
-- service_role are neither — so all three intended escape hatches work and
-- the client is still pinned. No writer function has to change.
--
-- Note for anything added later: ..._20260908120000_groove_roles.sql solves
-- the same problem with a transaction-local `vinall.role_ok` flag that each
-- definer function sets. That also works. What does not work is any check
-- based on the JWT, because the JWT is identical either side of a definer
-- boundary. `current_user` is the boundary.

create or replace function public.pin_profile_economy()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  -- Only writes arriving as the API's own role are constrained. A SECURITY
  -- DEFINER function runs as its owner, the SQL editor as postgres, and
  -- service_role as itself: all pass through.
  if current_user <> 'authenticated' then
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

  -- Equipping stays a client write, but only to something actually owned,
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
-- Nothing is back-paid.
-- ---------------------------------------------------------------------------
-- Deliberately. There is no record of what anyone would have earned: the
-- award counters were reverted by the same trigger, so rating_awards_count
-- and lore_awards_count are 0 for everybody and the history is simply not
-- there. Reconstructing it from ratings and lore_answers row counts would
-- ignore the daily caps and hand out numbers nobody actually earned.
--
-- If you want to make good, do it as a deliberate one-off grant from the SQL
-- editor rather than pretending it accrued — something like the line below,
-- left commented because it is a decision, not a migration:
--
--   update public.profiles set discs = coalesce(discs, 0) + 50
--    where id in (select id from public.profiles where not coalesce(is_admin, false));
