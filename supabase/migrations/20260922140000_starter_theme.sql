-- Test Pressing: one genuinely cheap theme, so a first session can end in a
-- real purchase.
--
-- Apply by hand in the SQL editor, like the others. Idempotent.
--
-- ---------------------------------------------------------------------------
-- WHY THERE HAD TO BE ONE
-- ---------------------------------------------------------------------------
-- The onboarding flow ends on the shop, and the point of that beat is that
-- somebody spends what they just earned — the Discs -> shop loop understood by
-- doing it rather than by being told. It could not happen. The cheapest thing
-- in the shop was Mono Fade at 8,000 and the honest ceiling on a first session
-- is a long way under that:
--
--   3 albums x 400                            1,200
--   3 songs  x 400                            1,200   (the 10-a-day cap is
--                                                      nowhere near binding)
--   one Earworm win                           2,000   -- IF they win
--                                             -----
--   guaranteed                                2,400
--   likely                                    4,400
--
-- The alternatives were both worse. Topping somebody up would be a
-- tutorial-only reward path to reconcile later, which is the thing the whole
-- onboarding is written to avoid. Discounting an existing item for new
-- accounts only is the same thing wearing a price tag.
--
-- So: a real item, at a real price, that anybody can buy at any time. It is
-- cheap because it is the plain one, not because it is for beginners.
--
-- ---------------------------------------------------------------------------
-- 2,000, AND WHY THAT IS NOT A HOLE IN THE ECONOMY
-- ---------------------------------------------------------------------------
-- It sits under the guaranteed 2,400 with room to spare, which is the whole
-- requirement — a purchase that only works when the round went well is not a
-- purchase the tutorial can promise.
--
-- It is a SINK like every other cosmetic: 2,000 Discs leave the economy and
-- nothing comes back. One item at the bottom of a ladder that runs to
-- 1,000,000 does not move what the shop is worth (~4.95M) and does not touch
-- the Draw's 3,047-against-5,000, which is the rule that keeps that a sink.
-- What it changes is that the ladder now HAS a bottom rung: this file has
-- argued before, about the tags, that "the entry price decides whether a thing
-- is ever owned at all", and every cosmetic here was four days of play away.
--
-- ---------------------------------------------------------------------------
-- WHAT IT LOOKS LIKE
-- ---------------------------------------------------------------------------
-- A white-label test pressing: near-black, and NO COLOUR ANYWHERE. Every other
-- theme has an accent hue — gold, orange, turquoise, lime, phosphor green,
-- terracotta, magenta — and this one has silver. That is the reason it can be
-- the cheap one without reading as the worst one: it is the plain pressing, and
-- a plain pressing is a real thing collectors want.
--
-- Nothing else changes. `wallet_buy` reads the price out of this table and
-- appends to `owned_themes`, so a row is the entire server side.
-- ---------------------------------------------------------------------------

insert into public.shop_items (kind, key, name, cost)
values ('theme', 'press', 'Test Pressing', 2000)
on conflict (kind, key) do update set name = excluded.name, cost = excluded.cost;

-- ------------------------------------------------------------------- guards
do $$
declare v_cost integer; v_cheapest integer;
begin
  select cost into v_cost from public.shop_items where kind = 'theme' and key = 'press';
  if v_cost is null then
    raise exception 'Test Pressing did not land in shop_items';
  end if;

  -- The one property the onboarding depends on. 2,400 is three albums and
  -- three songs at 400 each — what somebody has BEFORE the minigame, win or
  -- lose. If this ever stops being true the shop beat silently stops being a
  -- purchase and goes back to being a brochure.
  if v_cost > 2400 then
    raise exception 'Test Pressing costs % — over the 2,400 a first session is guaranteed', v_cost;
  end if;

  -- And it must be the bottom rung, or the tutorial would offer something
  -- cheaper that it has not been reasoned about.
  select min(cost) into v_cheapest from public.shop_items where cost > 0;
  if v_cheapest <> v_cost then
    raise exception 'something else now costs % — the cheapest item is no longer Test Pressing', v_cheapest;
  end if;

  raise notice 'Test Pressing added at % Discs. Cheapest paid item in the shop.', v_cost;
end $$;
