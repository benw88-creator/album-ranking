-- Eight more themes. Apply by hand in the SQL editor, like the others.
-- Idempotent: `on conflict do nothing`, so re-running never re-prices a row
-- that has since been tuned by hand.
--
-- The client's THEMES map carries the same costs as a fallback, and the
-- tokens live in assets/themes2.css. Until this lands the cards render and
-- wallet_buy refuses the key — a row here is the entire server side.
--
-- Priced inside the existing theme band (Test Pressing 2,000 at the bottom,
-- Neon Vault 35,000 at the top). Every one is a sink like any other cosmetic,
-- and none is in spin_items, so the Draw's expected return is untouched.

insert into public.shop_items (kind, key, name, cost) values
  ('theme', 'reel',   'Reel to Reel',    12000),
  ('theme', 'canopy', 'Deep Canopy',     18000),
  ('theme', 'frost',  'Chrome Frost',    20000),
  ('theme', 'soul',   'Soul Train',      22000),
  ('theme', 'bop',    'Hard Bop',        25000),
  ('theme', 'velvet', 'Midnight Velvet', 28000),
  ('theme', 'vapor',  'Vapor Sunset',    32000),
  ('theme', 'strobe', 'Strobe',          35000)
on conflict (kind, key) do nothing;

-- ------------------------------------------------------------------- guards
do $$
declare v_n integer; v_cheapest integer;
begin
  select count(*) into v_n from public.shop_items
   where kind = 'theme' and key in ('reel','canopy','frost','soul','bop','velvet','vapor','strobe');
  if v_n <> 8 then
    raise exception 'more_themes: expected 8 rows, found %', v_n;
  end if;

  -- Test Pressing must stay the bottom rung: the onboarding shop beat depends
  -- on it (see ..._20260922140000_starter_theme.sql).
  select min(cost) into v_cheapest from public.shop_items where kind = 'theme' and cost > 0;
  if v_cheapest is distinct from (select cost from public.shop_items where kind = 'theme' and key = 'press') then
    raise exception 'more_themes: something now undercuts Test Pressing (cheapest theme %)', v_cheapest;
  end if;
end $$;
