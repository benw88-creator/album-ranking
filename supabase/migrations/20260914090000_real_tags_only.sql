-- Producer tags: drop the seven invented ones, add six real ones, rename one.
--
-- ---------------------------------------------------------------------------
-- Why the house tags go
-- ---------------------------------------------------------------------------
-- STRAIGHT OUT THE CRATE, DROP THE NEEDLE, NO SKIPS, DOLLAR BIN DIGGER, PROMO
-- USE ONLY, MONO. AS INTENDED. and FIRST PRESS were written to fill the cheap
-- end of the ladder so a new account could reach one in its first week. Sat
-- next to tags people have actually heard, they read as filler — the whole
-- appeal of a producer tag is recognition, and an invented one has none to
-- offer. Nineteen real ones beats twenty-six where seven are made up.
--
-- Refunded rather than just deleted, because somebody may have bought one and
-- the refund has to happen *before* the row it reads the price from is gone.
-- Order matters here and there is no second chance: delete first and the cost
-- is unrecoverable.

-- ------------------------------------------------------------------ refund
update public.profiles p
   set discs = coalesce(p.discs, 0) + (
     select coalesce(sum(s.cost), 0)
     from public.shop_items s
     where s.kind = 'tag'
       and s.key = any(p.owned_tags)
       and s.key in ('crate','needle','noskips','dollarbin','promo','asintended','firstpress'))
 where p.owned_tags && array['crate','needle','noskips','dollarbin','promo','asintended','firstpress']::text[];

-- ---------------------------------------------------------------- unequip
-- An active_tag pointing at a key with no row would render as nothing, and the
-- pin trigger would then refuse to let the client change it — active_tag is
-- only writable to something in owned_tags, and this key is about to leave it.
update public.profiles
   set active_tag = null
 where active_tag in ('crate','needle','noskips','dollarbin','promo','asintended','firstpress');

update public.profiles
   set owned_tags = (
     select coalesce(array_agg(t), '{}'::text[])
     from unnest(coalesce(owned_tags, '{}'::text[])) t
     where t not in ('crate','needle','noskips','dollarbin','promo','asintended','firstpress'))
 where owned_tags && array['crate','needle','noskips','dollarbin','promo','asintended','firstpress']::text[];

delete from public.shop_items
 where kind = 'tag'
   and key in ('crate','needle','noskips','dollarbin','promo','asintended','firstpress');

-- -------------------------------------------------------- rename and add
-- MUSTARD ON THE BEAT -> MUSTARD. The key is unchanged, so anyone holding it
-- keeps it; only what the chip says changes.
--
-- The six new ones slot into the existing 4,000-16,000 ladder by how much
-- weight the tag carries, not by how good it is.
insert into public.shop_items (kind, key, name, cost) values
  ('tag','mustard',    'MUSTARD',              6000),
  ('tag','justbeatit', 'JUST BEAT IT',         4000),
  ('tag','beef',       '1738',                 5000),
  ('tag','astro',      'ASTRO',                6000),
  ('tag','sober',      'I CAN’T SPELL SOBER',  7000),
  ('tag','fuckumean',  'FUCKUMEAN',            8000),
  ('tag','drizzy',     'DRIZZY',               9000)
on conflict (kind, key) do update set name = excluded.name, cost = excluded.cost;

-- The Mythic tag prize draws straight from these rows, so the pool follows
-- this file with no second edit: the seven that left are gone from it and the
-- six that arrived are in it.
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.shop_items where kind = 'tag';
  if v_n <> 19 then
    raise exception 'expected 19 producer tags, found % — the client TAGS map and shop_items have drifted', v_n;
  end if;
end $$;
