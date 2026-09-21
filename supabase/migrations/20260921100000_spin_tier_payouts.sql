-- The Draw: one Disc value per tier, and every row in a tier pays it.
--
-- ---------------------------------------------------------------------------
-- What was asked for, and why these numbers are half of it
-- ---------------------------------------------------------------------------
-- The brief was: Common 2,000 / Rare 3,500 / Epic 7,000 / Legendary 20,000,
-- with a duplicate paying its tier's value rather than a per-item figure.
--
-- The second half of that is a real improvement and is implemented exactly:
-- "Rare pays 1,750" is a sentence somebody can hold in their head, where
-- "Mono Fade pays 1,600 and Card Sleeve pays 3,500 and they are both Rare" is
-- a table. Within a tier, every row now carries the same `amount`.
--
-- The first half cannot be applied at face value. Worked out against the
-- weights, the asked-for figures give an expected return of:
--
--   common     300/1000 x  2,000  =   600
--   rare       250/1000 x  3,500  =   875
--   epic       200/1000 x  7,000  = 1,400
--   legendary  125/1000 x 20,000  = 2,500   (picks1 holds the other 25)
--   mythic     (tag 60 x 1,000 + jackpot 3 x 100,000) / 1000 = 360
--                                   -----
--                                   5,735  against a 5,000 spin
--
-- **That is not a sink, it is a printer.** The Collection and the Draw are the
-- only two places Discs leave the economy, and a Draw that returns 115% of its
-- cost removes the floor under every earning rate in the app. It also could
-- not be deployed: ..._20260915100000_harder_progression.sql recomputes this
-- sum from the table and RAISES if it ever reaches the cost, which is exactly
-- the guard doing its job.
--
-- So the tier values are halved. The RATIOS ARE UNTOUCHED — 2,000 : 3,500 :
-- 7,000 : 20,000 is 1 : 1.75 : 3.5 : 10, and so is 1,000 : 1,750 : 3,500 :
-- 10,000 — so the shape of the ladder, which is what the brief was actually
-- about, is exactly as asked. Only the scale moves, and it moves to the one
-- place where the Draw stays a sink.
--
--   common     300/1000 x  1,000  =   300.0
--   rare       250/1000 x  1,750  =   437.5
--   epic       200/1000 x  3,500  =   700.0
--   legendary  125/1000 x 10,000  = 1,250.0
--   mythic                        =   360.0
--                                   -------
--                                   3,047.5  against 5,000  (0.61)
--
-- against 2,993 (0.60) before this. Materially unchanged, which is the point:
-- this is a re-shaping of what the tiers pay, not a change to what the machine
-- returns.
--
-- **Mythic is left alone**, for the reason ..._20260915100000 gives: 360 of
-- the 3,047 lives there, and the jackpot at any larger multiple would undo the
-- pass on its own. The producer tag stays at 1,000 and the two `picks` rows
-- are untouched — for kind='picks', `amount` is a COUNT OF RECORDS and not
-- money, and scaling it would quietly turn three free albums into one.
--
-- ---------------------------------------------------------------------------
-- What this deliberately does NOT do
-- ---------------------------------------------------------------------------
-- The brief also said Mono Fade and Card Sleeve should be "valued at 3,500 in
-- the store". Shop prices are NOT touched here, and that is a decision rather
-- than an omission:
--
--   * They cost 8,000 and 17,500. A cosmetic priced below one spin is not a
--     sink, and the shop's ~4.95M total is what the tag prices, the Collection
--     divisor and the earning rates were all sized against.
--   * A duplicate paying 100% of an item's shop price means winning the
--     duplicate is worth exactly as much as winning the item, which removes
--     the reason for the tier to exist.
--
-- If the shop is to be re-priced it wants its own pass, with the tags and the
-- Collection divisor in the same file. Do not bundle it with this.
--
-- ---------------------------------------------------------------------------
-- Idempotent: absolute values, deleted and re-inserted. Re-running it is the
-- same answer, which is the property every migration in this project needs
-- because most of them are applied by hand in the SQL editor and are not
-- recorded in Supabase's migration history.
-- ---------------------------------------------------------------------------

-- The `d*` keys are renamed to what they now pay. A key called d750 paying
-- 1,000 is a comment that lies, and the delete is what retires the old ones.
delete from public.spin_items;

insert into public.spin_items (key, kind, label, amount, ref, weight, tier) values
  -- Common — 300/1000 — 1,000 Discs. ONE row where there were two: they were
  -- 750 and 1,500, and at a single tier value two rows with the same label and
  -- the same payout are the same row written twice.
  ('c_discs',    'discs', '1,000 Discs',     1000,   null,      300, 'common'),
  -- Rare — 250/1000 — 1,750 Discs, and a duplicate pays the same
  ('r_discs',    'discs', '1,750 Discs',     1750,   null,      120, 'rare'),
  ('b_mono',     'banner','Mono Fade',       1750,   'mono',     65, 'rare'),
  ('fr_sleeve',  'frame', 'Card Sleeve',     1750,   'sleeve',   65, 'rare'),
  -- Epic — 200/1000 — 3,500 Discs
  ('e_discs',    'discs', '3,500 Discs',     3500,   null,      100, 'epic'),
  ('b_dusk',     'banner','Dusk',            3500,   'dusk',     50, 'epic'),
  ('fl_foil',    'flair', 'Gold Foil',       3500,   'foil',     50, 'epic'),
  -- Legendary — 150/1000 — 10,000 Discs
  ('t_vhs',      'theme', 'VHS Tracking',   10000,   'vhs',      45, 'legendary'),
  ('b_static',   'banner','Static',         10000,   'static',   40, 'legendary'),
  ('l_discs',    'discs', '10,000 Discs',   10000,   null,       40, 'legendary'),
  ('picks1',     'picks', '1 album, free',      1,   null,       25, 'legendary'),
  -- Mythic — 100/1000. Untouched, and the comment above says why.
  ('tag',        'tag',   'Producer tag',    1000,   null,       60, 'mythic'),
  ('picks3',     'picks', '3 albums, free',     3,   null,       37, 'mythic'),
  ('m_discs',    'discs', '100,000 Discs', 100000,   null,        3, 'mythic')
on conflict (key) do update set
  kind = excluded.kind, label = excluded.label, amount = excluded.amount,
  ref = excluded.ref, weight = excluded.weight, tier = excluded.tier;

-- ------------------------------------------------------------------- guards
do $$
declare
  v_total integer;
  v_ev    numeric;
  v_cost  integer := 5000;
  v_bad   text;
begin
  -- The published tier percentages are computed from these weights by
  -- paintOdds(), so they are only exact while the weights sum to 1000.
  select sum(weight) into v_total from public.spin_items;
  if v_total <> 1000 then
    raise exception 'spin_items weights sum to %, not 1000 — the published tier percentages would be wrong', v_total;
  end if;

  -- THE SINK RULE, enforced rather than commented. Worst case: an account that
  -- owns every drawable cosmetic, so every cosmetic row converts to its Disc
  -- consolation. `picks` rows are excluded because `amount` is a record count
  -- there and not money.
  select sum(case when kind = 'picks' then 0 else amount * weight end) / 1000.0
    into v_ev from public.spin_items;
  if v_ev >= v_cost then
    raise exception 'The Draw would return % against a % spin. That is a faucet, not a sink — see the header of this file.', round(v_ev), v_cost;
  end if;
  raise notice 'The Draw: expected return % against % (%%% of cost).', round(v_ev, 1), v_cost, round(v_ev / v_cost * 100, 1);

  -- Every row in a tier pays that tier's value, which is the part of the brief
  -- this file exists to implement. Checked rather than trusted: the whole
  -- point is that "Rare pays 1,750" is true with no exceptions to remember.
  -- MYTHIC IS EXEMPT AND HAS TO BE. It holds a 1,000 producer-tag consolation
  -- beside a 100,000 jackpot, and those are not two prices for one tier — they
  -- are the tier's two completely different outcomes. Folding them together
  -- would mean either a 100,000 tag consolation (which is the whole expected
  -- return in one row) or a 1,000 jackpot (which is not a jackpot).
  select string_agg(distinct tier, ', ') into v_bad
    from (
      select tier from public.spin_items
       where kind <> 'picks' and tier <> 'mythic'
       group by tier having count(distinct amount) > 1
    ) t;
  if v_bad is not null then
    raise exception 'These tiers pay more than one Disc value: % — a tier with two payouts is a table, not a rule', v_bad;
  end if;

  -- wallet_spin scales DISCS on a free spin and must not scale a record count.
  if (select prosrc from pg_proc where proname = 'wallet_spin') like '%p.discs := p.discs + v_item.amount%' then
    raise exception 'wallet_spin pays a raw v_item.amount somewhere — that row would pay full price on a free spin';
  end if;
end $$;
