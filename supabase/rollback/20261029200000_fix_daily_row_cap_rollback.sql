-- ROLLBACK for 20261029200000_fix_daily_row_cap.sql (not a migration).
-- Returns crate_feed to the shared daily_row_cap trigger. daily_row_cap's body
-- is already the pre-audit one, so this restores the exact pre-audit state —
-- it does NOT bring back the broken version. Feed re-posts then count toward
-- the daily cap again.
--   supabase migration repair --status reverted 20261029200000
begin;
drop trigger if exists daily_row_cap_trg on public.crate_feed;
create trigger daily_row_cap_trg before insert on public.crate_feed
  for each row execute function public.daily_row_cap('feed', 'skip', 'user_id');
drop function if exists public.crate_feed_row_cap();
commit;
