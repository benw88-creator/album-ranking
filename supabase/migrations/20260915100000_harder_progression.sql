-- Progression gets substantially harder: the spin costs 5x, the shop costs 5x,
-- producer tags cost 12x, and every non-Mythic prize pays 5x.
--
-- ---------------------------------------------------------------------------
-- 1. What moves, and what deliberately does not
-- ---------------------------------------------------------------------------
--   spin cost           1,000  ->  5,000
--   spin prizes         x5, EXCEPT every Mythic row, which is untouched
--   producer tags       x12    (4,000-16,000  ->  48,000-192,000)
--   everything else     x5     (themes, banners, flair, frames, boosts)
--   earning rates       unchanged
--
-- **Income is not cut.** Prices are the only lever moved here, which is worth
-- saying because the obvious alternative — halving what a rating pays — is the
-- same arithmetic with a worse feel: the thing you do most often paying less is
-- felt every session, where a distant price is felt once, when you look at it.
--
-- The one number this pass does NOT fix is still the one CLAUDE.md says to fix
-- first: **the login ladder pays 63,000 a week for opening the app**, against
-- ~215,600 a week for playing everything every day — so roughly a quarter of a
-- maximal week's income, and a far larger share of a realistic one, arrives for
-- turning up. Raising prices makes that ratio matter more, not less, because
-- the login half is the half that needs no engagement at all. If one number is
-- revisited next, make it that one — this file did not, because it was not
-- asked to.
--
-- ---------------------------------------------------------------------------
-- 2. The Draw's expected return, recomputed — the rule this file exists under
-- ---------------------------------------------------------------------------
-- "An economy whose only sink pays out more than it takes is not a sink, it is
-- a printer." The pool was 886.6 against 1,000, a ratio of 0.89. Multiplying
-- every non-Mythic prize by five while the cost also goes up five would hold
-- that ratio exactly — except the Mythic rows do not move, and Mythic is where
-- 360 of the old 886.6 lived. So the ratio improves sharply:
--
--   Common      750 x170 +  1500 x130                     =   322.5
--   Rare       2500 x120 +  mono 1600 x65 + sleeve 3500 x65 =  631.5
--   Epic       5000 x100 +  dusk 2800 x50 + foil 4500 x50   =  865.0
--   Legendary  6000 x45  + static 3600 x40 + 10000 x40      =  814.0
--              + 1 album pick x25                           =     0
--   Mythic   100000 x3   + tag 1000 x60 + 3 picks x37       =   360.0
--                                                     total  2,993.0
--
--   2,993 against 5,000 = 0.599, where it was 0.887.
--
-- The Draw is now a much stronger sink than it was, which is the point of the
-- exercise. There is a `do $$` block at the bottom that recomputes this from
-- the table and refuses the migration if it ever goes above the cost, so the
-- next person to change a weight cannot turn the sink into a printer silently.
--
-- ---------------------------------------------------------------------------
-- 3. The duplicate rule survives for cosmetics and is abandoned for tags
-- ---------------------------------------------------------------------------
-- "A duplicate pays 20% of its shop price." Cosmetic `amount`s and cosmetic
-- shop prices both go up 5x, so that holds exactly — 1600/8000, 3500/17500,
-- 4500/22500 and the rest are all still a fifth.
--
-- **Tags break it, deliberately.** They go up 12x while the Mythic tag prize's
-- `amount` stays at 1,000 (it is a Mythic row), so a duplicate tag now pays
-- about 2% of the cheapest tag rather than 20%. The consequence, stated rather
-- than discovered: **once somebody owns all nineteen tags, Mythic's most likely
-- outcome pays 1,000 Discs against a 5,000 spin.** That is a bad moment, and it
-- is a long way off — owning all nineteen is 1,770,000 Discs of buying — but it
-- is the number to raise when somebody gets close. The tag row's weight is
-- 60/1000, so each 1,000 added to it costs the pool 60 of expected return —
-- the 0.599 ratio absorbs that many times over.
--
-- ---------------------------------------------------------------------------
-- 4. This migration is idempotent and the previous two inflation passes were not
-- ---------------------------------------------------------------------------
-- `..._20260913140000` ran `cost = cost * 4` and `..._20260913220000` ran
-- `cost = cost * 5`, both unguarded. Applying either twice multiplies twice,
-- and CLAUDE.md's own rule is that re-application is the normal case here
-- because these are pasted into the SQL editor by hand and a later
-- `supabase db push` will try them all again.
--
-- So the shop pass is guarded on a sentinel: the most expensive tag is 16,000
-- before this file and 192,000 after it, so the block simply does not fire a
-- second time. `spin_items` needs no guard — it is deleted and re-inserted at
-- absolute values, which is the same answer however many times it runs.

-- ------------------------------------------------------------------- the shop
do $$
declare v_top integer;
begin
  select cost into v_top from public.shop_items where kind = 'tag' and key = 'metro';

  if v_top is null then
    raise notice 'No metro tag row — shop prices left alone. Check shop_items.';
  elsif v_top = 192000 then
    raise notice 'Shop prices already raised — nothing to do.';
  elsif v_top <> 16000 then
    raise exception 'metro costs % — expected 16,000 (not yet raised) or 192,000 (already raised). Prices have been changed by hand; work out which and set them explicitly rather than multiplying blind.', v_top;
  else
    -- Tags carry the status, so they carry the cost.
    update public.shop_items set cost = cost * 12 where kind = 'tag' and cost > 0;
    -- Themes, banners, flair, frames and the Streak Freeze boost.
    update public.shop_items set cost = cost * 5 where kind <> 'tag' and cost > 0;
    raise notice 'Shop prices raised: tags x12, everything else x5.';
  end if;
end $$;

-- ------------------------------------------------------------------- the Draw
-- Absolute values, so this is the same answer however many times it is applied.
-- The `d*` keys are renamed to what they now pay, because a key called d150
-- paying 750 is a comment that lies. The delete is what retires the old ones.
--
-- For kind='picks', `amount` is how many free records it grants, not a Disc
-- consolation — picks can never be a duplicate, so the column means something
-- else in those two rows and must be excluded from any expected-return sum.
delete from public.spin_items;

insert into public.spin_items (key, kind, label, amount, ref, weight, tier) values
  -- Common — 300/1000
  ('d750',      'discs', '750 Discs',        750,    null,      170, 'common'),
  ('d1500',     'discs', '1,500 Discs',      1500,   null,      130, 'common'),
  -- Rare — 250/1000
  ('d2500',     'discs', '2,500 Discs',      2500,   null,      120, 'rare'),
  ('b_mono',    'banner','Mono Fade',        1600,   'mono',     65, 'rare'),
  ('fr_sleeve', 'frame', 'Card Sleeve',      3500,   'sleeve',   65, 'rare'),
  -- Epic — 200/1000
  ('d5000',     'discs', '5,000 Discs',      5000,   null,      100, 'epic'),
  ('b_dusk',    'banner','Dusk',             2800,   'dusk',     50, 'epic'),
  ('fl_foil',   'flair', 'Gold Foil',        4500,   'foil',     50, 'epic'),
  -- Legendary — 150/1000
  ('t_vhs',     'theme', 'VHS Tracking',     6000,   'vhs',      45, 'legendary'),
  ('b_static',  'banner','Static',           3600,   'static',   40, 'legendary'),
  ('d10000',    'discs', '10,000 Discs',     10000,  null,       40, 'legendary'),
  ('picks1',    'picks', '1 album, free',    1,      null,       25, 'legendary'),
  -- Mythic — 100/1000. Untouched: the jackpot at 5x would be 500,000, which is
  -- 100 expected return on its own and would undo the whole pass.
  ('tag',       'tag',   'Producer tag',     1000,   null,       60, 'mythic'),
  ('picks3',    'picks', '3 albums, free',   3,      null,       37, 'mythic'),
  ('d100000',   'discs', '100,000 Discs',    100000, null,        3, 'mythic')
on conflict (key) do update set
  kind = excluded.kind, label = excluded.label, amount = excluded.amount,
  ref = excluded.ref, weight = excluded.weight, tier = excluded.tier;

-- ------------------------------------------------------------------ the spin
-- create-or-replace of wallet_spin with one number changed: v_cost. Everything
-- else is copied from ..._20260913220000 verbatim.
create or replace function public.wallet_spin()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  p        public.profiles;
  v_cost   integer := 5000;
  v_total  integer;
  v_roll   integer;
  v_acc    integer := 0;
  v_item   public.spin_items;
  v_gain   integer := 0;
  v_dupe   boolean := false;
  v_ref    text;
  v_shown  text;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;
  if not coalesce(p.is_admin, false) and coalesce(p.discs, 0) < v_cost then
    raise exception 'That costs % Discs', v_cost;
  end if;

  select sum(weight) into v_total from public.spin_items;
  if coalesce(v_total, 0) < 1 then raise exception 'Nothing to win'; end if;

  -- random() here rather than anywhere the client can reach: a browser that
  -- picked its own prize would be a browser that always drew a Mythic.
  v_roll := floor(random() * v_total) + 1;
  for v_item in select * from public.spin_items order by key loop
    v_acc := v_acc + v_item.weight;
    exit when v_acc >= v_roll;
  end loop;

  -- Spend first, so a failure below cannot hand out a free spin.
  if not coalesce(p.is_admin, false) then
    p.discs := p.discs - v_cost;
  end if;

  v_ref   := v_item.ref;
  v_shown := v_item.label;

  if v_item.kind = 'discs' then
    p.discs := p.discs + v_item.amount;
    v_gain := v_item.amount;

  elsif v_item.kind = 'picks' then
    p.album_picks := coalesce(p.album_picks, 0) + v_item.amount;

  elsif v_item.kind = 'tag' then
    -- No fixed ref: a random tag you do not own yet, from the same rows you
    -- could buy. Own them all and it pays out instead, which is what stops the
    -- top of the ladder becoming worthless to a completed account.
    select key into v_ref
      from public.shop_items
     where kind = 'tag'
       and not (key = any(coalesce(p.owned_tags, '{}'::text[])))
     order by random() limit 1;

    if v_ref is null then
      v_dupe := true;
      v_ref  := null;
      p.discs := p.discs + v_item.amount;
      v_gain := v_item.amount;
    else
      select name into v_shown from public.shop_items where kind = 'tag' and key = v_ref;
      p.owned_tags := (select array(select distinct unnest(coalesce(p.owned_tags, '{}'::text[]) || v_ref)));
    end if;

  elsif v_item.kind in ('theme', 'banner', 'flair', 'frame') then
    if v_ref = any(coalesce(
         case v_item.kind
           when 'theme'  then p.owned_themes
           when 'banner' then p.owned_banners
           when 'flair'  then p.owned_flairs
           else p.owned_frames end, '{}'::text[])) then
      v_dupe := true;
      p.discs := p.discs + v_item.amount;
      v_gain := v_item.amount;
    elsif v_item.kind = 'theme' then
      p.owned_themes := (select array(select distinct unnest(coalesce(p.owned_themes, '{}'::text[]) || v_ref)));
    elsif v_item.kind = 'banner' then
      p.owned_banners := (select array(select distinct unnest(coalesce(p.owned_banners, '{}'::text[]) || v_ref)));
    elsif v_item.kind = 'flair' then
      p.owned_flairs := (select array(select distinct unnest(coalesce(p.owned_flairs, '{}'::text[]) || v_ref)));
    else
      p.owned_frames := (select array(select distinct unnest(coalesce(p.owned_frames, '{}'::text[]) || v_ref)));
    end if;
  end if;

  update public.profiles set
    discs         = p.discs,
    owned_themes  = p.owned_themes,
    owned_banners = p.owned_banners,
    owned_tags    = p.owned_tags,
    owned_flairs  = p.owned_flairs,
    owned_frames  = p.owned_frames,
    album_picks   = p.album_picks
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'cost', case when coalesce(p.is_admin, false) then 0 else v_cost end,
    'key', v_item.key, 'kind', v_item.kind, 'label', v_item.label,
    'granted', v_shown, 'ref', v_ref, 'tier', v_item.tier,
    'gained', v_gain, 'duplicate', v_dupe,
    -- For kind='picks' this is how many records it just handed over.
    'picks', case when v_item.kind = 'picks' then v_item.amount else 0 end,
    'discs', p.discs, 'album_picks', p.album_picks,
    'owned_themes', p.owned_themes, 'owned_banners', p.owned_banners,
    'owned_tags', p.owned_tags, 'owned_flairs', p.owned_flairs,
    'owned_frames', p.owned_frames,
    'lifetime_xp', p.lifetime_xp, 'level', p.level);
end $$;

revoke all on function public.wallet_spin() from public, anon;
grant execute on function public.wallet_spin() to authenticated;

-- ------------------------------------------------------------------- guards
-- The tier split is only legible as 30/25/20/15/10 while the weights sum to
-- 1000. It shipped at 997 once and nothing said so.
do $$
declare v_total integer;
begin
  select sum(weight) into v_total from public.spin_items;
  if v_total <> 1000 then
    raise exception 'spin_items weights sum to %, not 1000 — the published tier percentages are wrong', v_total;
  end if;
end $$;

-- The rule that matters, enforced by the database instead of by a comment
-- somebody has to remember to read. `picks` rows are excluded because their
-- `amount` is a count of records, not Discs.
do $$
declare
  v_ev   numeric;
  v_cost integer := 5000;
begin
  select sum(case when kind = 'picks' then 0 else amount end * weight) / 1000.0
    into v_ev from public.spin_items;
  if v_ev >= v_cost then
    raise exception 'The Draw expects to pay % against a % spin. That is a printer, not a sink — redo the sum at the top of this file.', round(v_ev, 1), v_cost;
  end if;
  raise notice 'The Draw: expected return % against a % spin (ratio %).',
    round(v_ev, 1), v_cost, round(v_ev / v_cost, 3);
end $$;

-- Prices landed where this file says they did.
do $$
declare
  v_metro integer; v_pluh integer; v_holo integer; v_freeze integer;
begin
  select cost into v_metro  from public.shop_items where kind = 'tag'   and key = 'metro';
  select cost into v_pluh   from public.shop_items where kind = 'tag'   and key = 'pluh';
  select cost into v_holo   from public.shop_items where kind = 'flair' and key = 'holo';
  select cost into v_freeze from public.shop_items where kind = 'boost' and key = 'freeze';
  if v_metro <> 192000 or v_pluh <> 48000 or v_holo <> 60000 or v_freeze <> 30000 then
    raise exception 'Shop prices are not where they should be (metro %, pluh %, holo %, freeze %) — expected 192000 / 48000 / 60000 / 30000.',
      v_metro, v_pluh, v_holo, v_freeze;
  end if;
  raise notice 'Shop: tags 48,000-192,000; the whole shop is about 2,342,500 Discs.';
end $$;
