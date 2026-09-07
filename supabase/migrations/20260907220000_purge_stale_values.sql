-- The Bid War reveal showed totals that were orders of magnitude too low:
-- Rodeo at 717K where the real figure is 3.95B. The valuation code is right --
-- re-run against those exact albums it returns 3.95B, 6.86B, 4.42B and 2.94B
-- at 100% track matches. What was wrong was the stored data.
--
-- A war's values are frozen at creation, deliberately, so neither player can
-- watch them move. That also means any war created while Last.fm playcounts
-- were the valuation carries scrobble-scale numbers forever, and any cached
-- album_plays row from that era would keep feeding them to new wars.
--
-- So: empty the cache entirely (it refills from kworb on demand) and clear
-- wars that have not been settled. Settled wars are left alone -- they are
-- history, and rewriting a result someone already saw is worse than a wrong
-- number in an old game.

delete from public.album_plays;

update public.bid_wars
   set status = 'declined'
 where status = 'pending';
