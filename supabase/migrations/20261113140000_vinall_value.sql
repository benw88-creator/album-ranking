-- VINALL Value replaces kworb stream totals (api/_streams.js).
--
-- kworb's figures were scraped with no licence, from numbers kworb itself
-- scrapes from Spotify, and matched against Deezer tracklists. The value is
-- now Wikipedia readers over twelve months (CC0) plus a capped uplift from
-- ratings on VINALL. See APPLE_REVIEW_FIXES/IMPLEMENTATION.md.
--
-- 1. Purge every kworb-derived cache row. The new code only reads rows with
--    source 'vinall-value', so this is hygiene, not correctness: no kworb
--    number can price anything after the deploy whether or not this runs.
-- 2. Close pending streams-mode wars. Their values were frozen at creation
--    from kworb; settling them would pay out on the old metric. Same remedy as
--    20260907220000_purge_stale_values.sql: declined, nobody paid, nobody
--    charged (bids carry no Discs).
-- 3. collection.price is NOT touched: it is what somebody paid, not kworb data.
--
-- Idempotent: re-running deletes nothing new and finds no pending kworb war.

delete from public.album_plays where source = 'kworb';

update public.bid_wars
   set status = 'declined'
 where status = 'pending'
   and coalesce(mode, 'streams') = 'streams';

do $$
begin
  if exists (select 1 from public.album_plays where source = 'kworb') then
    raise exception 'kworb rows survived the purge';
  end if;
  if exists (select 1 from public.bid_wars where status = 'pending' and coalesce(mode, 'streams') = 'streams') then
    raise exception 'a pending streams-mode war survived';
  end if;
end $$;
