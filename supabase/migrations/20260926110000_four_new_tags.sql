-- Four new producer tags. shop_items is the real price — the `cost` beside
-- each entry in TAGS client-side is a fallback, not the price, and the two
-- have drifted before. Insert here so wallet_buy and the Mythic tag prize
-- pool both see them immediately.

insert into public.shop_items (kind, key, name, cost) values
  ('tag', 'cashmoneyap', 'CASH MONEY AP', 50000),
  ('tag', 'leanhabit',   'PROMETHAZINE HABIT LEAN HABIT CODEINE HABIT', 68000),
  ('tag', 'likeadream',  'LIFE IS LIKE A MOTHERFUCKIN’ DREAM', 118000),
  ('tag', 'countingup',  'I’M COUNTING UP MONEY FOR FUN', 145000)
on conflict (kind, key) do update set name = excluded.name, cost = excluded.cost;
