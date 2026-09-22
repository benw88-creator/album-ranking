-- The daily free spin stops paying Discs at a quarter.
--
-- Apply by hand in the SQL editor, like the others. Idempotent.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGES
-- ---------------------------------------------------------------------------
-- `v_share` is gone. A free spin now pays exactly what a paid spin pays, so
-- the reel can never land on "+875" off a tile that says 3,500 — which is what
-- "fractional/quarter-disc amounts" was describing. Every Disc figure the Draw
-- can produce is now a round number off `spin_items`, on both kinds of spin.
--
-- ---------------------------------------------------------------------------
-- WHAT IT COSTS, STATED RATHER THAN DISCOVERED
-- ---------------------------------------------------------------------------
-- The pool's expected return is 3,047 Discs. Quartered that was ~762 a day,
-- about 5,300 a week — roughly 7% of a realistic week's ~70,000. In full it is
-- ~21,300 a week, which is **30% of a realistic week, from one tap a day**.
--
-- That is the same shape as the problem ..._20260915140000 was written to fix.
-- The login ladder used to pay about as much for opening the app as playing it
-- did, the two progression systems ended up in opposition, and the ladder was
-- flattened for it. A free spin at full value is now the larger of the two
-- "turn up and tap" faucets.
--
-- It is applied because it was asked for after that trade was put in writing,
-- and it is recorded here so the number is knowable rather than a surprise.
-- THE SINK IS UNAFFECTED: a paid spin still returns 3,047 against 5,000, which
-- is the rule that keeps the Draw a sink, and nothing here touches it.
--
-- IF THIS NEEDS PULLING BACK, the cheapest lever is the cost of the free spin
-- rather than its payout — make it every OTHER day, or gate it behind having
-- rated something that day, so it still pays properly when it pays at all. A
-- fractional payout was always the confusing way to express "this is worth
-- less".
--
-- Everything else in wallet_spin is verbatim from
-- ..._20260916140000_daily_free_spin.sql: the row lock, the free-spin
-- stamping in the same transaction, the tag branch, the duplicate branch and
-- the returned shape are all untouched.
-- ---------------------------------------------------------------------------

create or replace function public.wallet_spin()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  p        public.profiles;
  v_cost   integer := 5000;
  v_today  date := (now() at time zone 'utc')::date;
  v_free   boolean := false;
  v_pay    integer;
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

  -- One free spin a day, decided here and never by the caller. The only thing
  -- free about it now is the cost.
  if p.spin_free_date is distinct from v_today then
    v_free  := true;
    v_cost  := 0;
    p.spin_free_date := v_today;
  end if;

  if not coalesce(p.is_admin, false) and coalesce(p.discs, 0) < v_cost then
    raise exception 'That costs % Discs', v_cost;
  end if;

  select sum(weight) into v_total from public.spin_items;
  if coalesce(v_total, 0) < 1 then raise exception 'Nothing to win'; end if;

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
  -- The row's own amount, whole. No scaling anywhere.
  v_pay   := v_item.amount;

  if v_item.kind = 'discs' then
    p.discs := p.discs + v_pay;
    v_gain := v_pay;

  elsif v_item.kind = 'picks' then
    p.album_picks := coalesce(p.album_picks, 0) + v_item.amount;

  elsif v_item.kind = 'tag' then
    select key into v_ref
      from public.shop_items
     where kind = 'tag'
       and not (key = any(coalesce(p.owned_tags, '{}'::text[])))
     order by random() limit 1;

    if v_ref is null then
      v_dupe := true;
      v_ref  := null;
      p.discs := p.discs + v_pay;
      v_gain := v_pay;
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
      p.discs := p.discs + v_pay;
      v_gain := v_pay;
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
    discs           = p.discs,
    spin_free_date  = p.spin_free_date,
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
    'free', v_free,
    'key', v_item.key, 'kind', v_item.kind, 'label', v_item.label,
    'granted', v_shown, 'ref', v_ref, 'tier', v_item.tier,
    'gained', v_gain, 'duplicate', v_dupe,
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
do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc where proname = 'wallet_spin';

  -- The whole point of the file. If a share ever comes back, a tile saying
  -- 3,500 pays 875 again.
  if v_src like '%v_share%' then
    raise exception 'wallet_spin still scales its Disc payout — the free spin is meant to pay in full';
  end if;

  -- Still exactly one free spin a day, and still stamped in the same
  -- transaction that pays. Removing the scaling must not have loosened that.
  if v_src not like '%spin_free_date%' then
    raise exception 'wallet_spin no longer stamps spin_free_date — the free spin would never be spent';
  end if;

  -- `amount` is a COUNT OF RECORDS for kind='picks' and must never be added to
  -- discs, whatever the scaling does.
  if v_src like '%p.discs := p.discs + v_item.amount%'
     and v_src not like '%v_pay   := v_item.amount%' then
    raise exception 'wallet_spin adds a raw amount to discs without going through v_pay';
  end if;

  raise notice 'Free spin pays in full. Expected return per spin is unchanged at ~3,047; the free one now injects ~21,300 a week rather than ~5,300.';
end $$;
