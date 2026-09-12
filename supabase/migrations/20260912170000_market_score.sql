-- Market-mode Bid Wars are valued by an album's standing out of 100, not by
-- what a copy costs.
--
-- The price version worked but measured the wrong thing: a war became a test
-- of which pressing was scarce, which is knowledge about the second-hand
-- market rather than about music.
--
-- The obvious replacement — Discogs' community rating × 20 — does not work as
-- a game on its own. Collectors rate almost everything between 3.7 and 4.6, so
-- every album scores 74 to 92 and five of them land within a few points. There
-- is nothing to read.
--
-- So the rating is weighted by its own sample size, in `scoreFromCommunity()`
-- in api/_discogs.js:
--
--   score = 50 + (avg*20 - 50) * w,   w = min(1, ln(1+count) / ln(1+3000))
--
-- A 4.6 from three thousand people is a consensus; a 4.8 from twelve is three
-- enthusiasts. Log-scaled because the gap between 10 and 100 ratings matters
-- far more than between 3,000 and 3,100, and it pulls a thinly-rated record
-- toward the middle rather than to zero — being obscure should cost you some
-- standing, not all of it. Famous and loved lands near 90, famous and divisive
-- near 70, obscure near 60 whatever its four ratings said. Thirty points of
-- spread across a board is a game.
--
-- `price_minor` and `currency` stay on the table. They are still returned by
-- /api/album-market as a diagnostic, they are simply no longer what a war is
-- worth, so an album with no copies for sale is now perfectly valuable.

alter table public.album_market
  add column if not exists score integer;

comment on column public.album_market.score is
  'Standing out of 100: Discogs community rating scaled and weighted by rating count. What a market-mode war is valued by.';

-- Anything cached under the price valuation has no score, and a row with a
-- null score is skipped by the war route rather than mis-valued. Clearing them
-- forces one clean refetch instead of leaving a half-populated cache that
-- silently drops albums from every board.
delete from public.album_market where score is null;
