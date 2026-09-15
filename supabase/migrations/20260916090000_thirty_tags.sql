-- Thirty producer tags, at prices set one by one rather than by a multiplier.
--
-- ---------------------------------------------------------------------------
-- What changes
-- ---------------------------------------------------------------------------
-- Eleven new tags, and every price set explicitly:
--
--   21,000  21                       100,000  I SEE DEAD PEOPLE        new
--   35,000  IT'S LIT                 105,000  I CAN'T SPELL SOBER
--   40,000  1738                     110,000  DRIZZY
--   45,000  IT'S BISCUITS...         120,000  METRO BOOMIN WANT SOME MORE
--   55,000  TAY KEITH...             125,000  MIKE WILL MADE-IT        new
--   60,000  PLUH                     125,000  I'M IN LOVE WITH THE COCO new
--   65,000  WHEEZY OUTTA HERE  new   130,000  CASH CARTI B!TCH
--   70,000  M-M-M-MAYBACH MUSIC      140,000  FWEAH                    new
--   75,000  JUST BEAT IT             150,000  PLUTO
--   80,000  ASTRO                    160,000  SMOKE SOME, DRINK SOME...new
--   85,000  SREMMLIFE!               175,000  FUKUMEAN
--   90,000  D.A. GOT THAT DOPE! new  200,000  MURDA ON THE BEAT...     new
--   95,000  SOUTHSIDE ON THE TRACK   225,000  RUN THAT BACK, TURBO!    new
--          new                       300,000  YO PIERRE...
--  100,000  MUSTARD                  300,000  WAKE UP, F1LTHY          new
--                                  1,000,000  I GOT TOO MUCH PROFIT
--
-- All thirty is **4,381,000 Discs**, against 1,770,000 for the nineteen. The
-- cheapest tag comes DOWN from 48,000 to 21,000, which matters more than the
-- top moving: the entry price is what decides whether a tag is a thing anybody
-- ever owns, and 21,000 is about a day of realistic play where 48,000 was four.
--
-- **I GOT TOO MUCH PROFIT at 1,000,000 is 3.3x the next most expensive thing
-- in the app** and is set from the list as given. If that was meant to be
-- 100,000 or 200,000 it is one line here and one in the TAGS map; nothing else
-- depends on it.
--
-- ---------------------------------------------------------------------------
-- Nobody loses a tag
-- ---------------------------------------------------------------------------
-- All nineteen existing keys are in the new set, so there is nothing to delete
-- and nothing to refund — unlike ..._20260914090000_real_tags_only.sql, which
-- had to refund from `shop_items` *before* deleting the row or the price was
-- unrecoverable.
--
-- Three are renamed and **the keys are untouched**, so anyone holding one keeps
-- it and only the chip's label changes — the same treatment MUSTARD ON THE BEAT
-- got:
--
--   taykeith   TAY KEITH, FTNU              -> TAY KEITH, F****IN' UP THE BEAT
--   metro      IF YOUNG METRO DON'T TRUST YOU -> METRO BOOMIN WANT SOME MORE
--   pluh       pluh                          -> PLUH
--
-- ---------------------------------------------------------------------------
-- Two older guards now read false, on purpose
-- ---------------------------------------------------------------------------
-- **..._20260914090000_real_tags_only.sql ends by asserting there are exactly
-- nineteen tags.** There are thirty. That file is idempotent up to its last
-- statement, so re-applying it now raises there and changes nothing — loud and
-- harmless, but it is where a `supabase db push` would stop.
--
-- **..._20260915100000_harder_progression.sql is sentinelled on metro costing
-- 16,000 or 192,000.** It is 120,000 now, so that file refuses to re-apply and
-- says prices have been set by hand. That is the guard doing its job rather
-- than a fault: a multiplier must never run over prices somebody has since set
-- deliberately.
--
-- Absolute values and `on conflict do update`, so this file is the same answer
-- however many times it runs.

insert into public.shop_items (kind, key, name, cost) values
  ('tag','twentyone',  '21',                                    21000),
  ('tag','lit',        'IT’S LIT',                              35000),
  ('tag','beef',       '1738',                                  40000),
  ('tag','biscuits',   'IT’S BISCUITS, IT’S GRAVY',             45000),
  ('tag','taykeith',   'TAY KEITH, F****IN’ UP THE BEAT',       55000),
  ('tag','pluh',       'PLUH',                                  60000),
  ('tag','wheezy',     'WHEEZY OUTTA HERE',                     65000),
  ('tag','maybach',    'M-M-M-MAYBACH MUSIC',                   70000),
  ('tag','justbeatit', 'JUST BEAT IT',                          75000),
  ('tag','astro',      'ASTRO',                                 80000),
  ('tag','sremm',      'SREMMLIFE!',                            85000),
  ('tag','dadope',     'D.A. GOT THAT DOPE!',                   90000),
  ('tag','southside',  'SOUTHSIDE ON THE TRACK',                95000),
  ('tag','mustard',    'MUSTARD',                              100000),
  ('tag','deadpeople', 'I SEE DEAD PEOPLE',                    100000),
  ('tag','sober',      'I CAN’T SPELL SOBER',                  105000),
  ('tag','drizzy',     'DRIZZY',                               110000),
  ('tag','metro',      'METRO BOOMIN WANT SOME MORE',          120000),
  ('tag','mikewill',   'MIKE WILL MADE-IT',                    125000),
  ('tag','coco',       'I’M IN LOVE WITH THE COCO',            125000),
  ('tag','carti',      'CASH CARTI B!TCH',                     130000),
  ('tag','fweah',      'FWEAH',                                140000),
  ('tag','pluto',      'PLUTO',                                150000),
  ('tag','smokesome',  'SMOKE SOME, DRINK SOME, POP ONE',      160000),
  ('tag','fuckumean',  'FUKUMEAN',                             175000),
  ('tag','murda',      'MURDA ON THE BEAT SO IT’S NOT NICE',   200000),
  ('tag','turbo',      'RUN THAT BACK, TURBO!',                225000),
  ('tag','pierre',     'YO PIERRE, YOU WANNA COME OUT HERE?',  300000),
  ('tag','f1lthy',     'WAKE UP, F1LTHY',                      300000),
  ('tag','profit',     'I GOT TOO MUCH PROFIT',               1000000)
on conflict (kind, key) do update set name = excluded.name, cost = excluded.cost;

-- ------------------------------------------------------------------- guards
-- The Mythic tag prize draws straight from these rows, so the eleven new ones
-- are in the pool with no second edit — and the client TAGS map is the only
-- other place a tag exists. It renders the label; drift shows as a chip with
-- no name.
do $$
declare v_n integer; v_sum bigint; v_min integer; v_max integer;
begin
  select count(*), sum(cost), min(cost), max(cost)
    into v_n, v_sum, v_min, v_max
    from public.shop_items where kind = 'tag';

  if v_n <> 30 then
    raise exception 'expected 30 producer tags, found % — the client TAGS map and shop_items have drifted', v_n;
  end if;
  if v_sum <> 4381000 then
    raise exception 'the tags total % Discs, not 4,381,000 — a price moved without this file moving', v_sum;
  end if;
  raise notice 'Tags: % of them, % to % Discs, % for the lot.', v_n, v_min, v_max, v_sum;
end $$;

-- Nobody was holding a tag that no longer exists. This finds anyone who is,
-- which would mean a key was dropped rather than renamed.
do $$
declare v_orphans integer;
begin
  select count(*) into v_orphans from public.profiles p
   where exists (
     select 1 from unnest(coalesce(p.owned_tags, '{}'::text[])) t
      where t not in (select key from public.shop_items where kind = 'tag'));
  if v_orphans > 0 then
    raise warning '% account(s) hold a tag with no shop_items row — they will render as a blank chip', v_orphans;
  end if;
end $$;
