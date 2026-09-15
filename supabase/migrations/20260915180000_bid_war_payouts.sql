-- Bid War payouts, scaled at last, and capped for the first time.
--
-- ---------------------------------------------------------------------------
-- 1. The numbers
-- ---------------------------------------------------------------------------
--   win   30  ->  3,000      loss  8  ->  800      draw  15  ->  1,500
--
-- Exactly 100x, so the ratios the original chose are untouched: a loss is 27%
-- of a win and a draw is half. Those were deliberate — a game where losing pays
-- nothing is a game people stop accepting challenges for — and nothing about
-- them needed revisiting, only their scale. 30 Discs was set when a spin cost
-- 100; a spin costs 5,000 now, and two wins buys one.
--
-- This was the last thing in the economy still denominated in the old money,
-- and it had been left alone through four inflation passes for the two reasons
-- below, both of which are dealt with here rather than deferred again.
--
-- ---------------------------------------------------------------------------
-- 2. Why this was never just three integers
-- ---------------------------------------------------------------------------
-- **bid_war_submit has had no create-or-replace since 20260907130000.** So
-- changing the payout means re-declaring the whole of sealed-bid resolution —
-- the most safety-critical function in this schema, the one that decides who
-- won, and the only payout in the app a client cannot forge. It is reproduced
-- here verbatim from that file, extracted programmatically rather than retyped,
-- with exactly one block replaced and four locals added.
--
-- **There was no daily cap on war payouts.** At 30 Discs that did not matter.
-- At 3,000 it does: a war cannot be *forged*, but it can be *manufactured* —
-- two accounts that follow each other create wars, both bid, and split the
-- proceeds for no effort at all. Inflation is what turns that from pointless
-- into profitable, which is why the cap had to arrive in the same file as the
-- amounts and not after them.
--
-- The cap is **three paid settlements a day, per player**, matching Earworm and
-- Higher or Lower. The number that makes it safe:
--
--   two accounts manufacturing wars all day   3 x (3,000 + 800) = 11,400
--                                             between them, so 5,700 each
--   either of them simply playing the games                      30,800 each
--
-- **Collusion pays less than honest play.** That is the property to preserve if
-- these numbers ever move again — not "collusion is capped" but "collusion is
-- worse than not colluding". A cap that leaves manufacturing profitable is a
-- cap that sets the going rate for it.
--
-- war_award() does the whole thing in one UPDATE with no explicit row lock, so
-- concurrent settlements serialise on the row rather than deadlocking, and
-- bid_war_submit applies the two awards in uuid order so that two wars between
-- the same pair settling at once cannot take each other's profiles in opposite
-- order.
--
-- It shares game_awards / game_awards_date with wallet_award_game under the key
-- 'bidwar'. They cooperate: whichever runs first that day sets the date, and
-- the other sees a matching date and merges rather than resetting.
--
-- ---------------------------------------------------------------------------
-- 3. The client was printing a number it had not checked
-- ---------------------------------------------------------------------------
-- var payout = oc === 'won' ? 30 : oc === 'draw' ? 15 : 8 — hardcoded in the
-- reveal, and 'Plus 30 Discs.' hardcoded again in the celebrate. Two constants
-- kept in step with SQL by hand, which is the arrangement that produced the
-- payFor() drift and the login ladder drift before it.
--
-- With a cap it stops being merely brittle and becomes wrong: a capped player
-- gets nothing and the page still says +3,000. So bid_wars carries
-- initiator_award and opponent_award — what was actually paid — and the client
-- renders that. The function already returns public.bid_wars, so the new
-- columns ride along with no signature change and no client breakage.
--
-- Wars resolved before this migration have null there, and the client shows no
-- Disc line for them rather than inventing one.

-- ------------------------------------------------------------------- columns
alter table public.bid_wars
  add column if not exists initiator_award integer,
  add column if not exists opponent_award  integer;

-- --------------------------------------------------------------- the award
-- Returns what it actually paid, which is 0 once the cap is spent. One atomic
-- UPDATE: the SET expressions read the pre-update row under the row lock the
-- UPDATE itself takes, so two settlements for the same player serialise.
create or replace function public.war_award(p_user uuid, p_amount integer)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_cap   integer := 3;
  v_used  integer;
begin
  if p_user is null then return 0; end if;

  update public.profiles set
    discs = coalesce(discs, 0) + case
              when game_awards_date is distinct from v_today then p_amount
              when coalesce((game_awards ->> 'bidwar')::integer, 0) < v_cap then p_amount
              else 0 end,
    game_awards_date = v_today,
    -- A rolled date wipes yesterday's counters for every game, which is what
    -- wallet_award_game does too. A matching date merges, so the two functions
    -- do not clear each other.
    game_awards = case
              when game_awards_date is distinct from v_today
                then jsonb_build_object('bidwar', 1)
              else coalesce(game_awards, '{}'::jsonb) ||
                   jsonb_build_object('bidwar',
                     coalesce((game_awards ->> 'bidwar')::integer, 0) + 1) end
  where id = p_user
  returning coalesce((game_awards ->> 'bidwar')::integer, 0) into v_used;

  if v_used is null then return 0; end if;
  -- The counter is never clamped, so "the new count is within the cap" is
  -- exactly "this one was paid".
  return case when v_used <= v_cap then p_amount else 0 end;
end $$;

-- Called only from inside bid_war_submit, which is itself definer. Nothing
-- reachable from a browser may hand itself Discs.
revoke all on function public.war_award(uuid, integer) from public, anon, authenticated;

create or replace function public.bid_war_submit(p_war uuid, p_bids jsonb)
returns public.bid_wars
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_war     public.bid_wars;
  v_other   uuid;
  v_sum     numeric;
  v_a       jsonb;
  v_b       jsonb;
  v_ta      numeric := 0;
  v_tb      numeric := 0;
  v_records jsonb := '[]'::jsonb;
  v_winner  uuid;
  v_val     numeric;
  v_bid_a   numeric;
  v_bid_b   numeric;
  v_key     text;
  r         jsonb;
  v_pay_a   integer;
  v_pay_b   integer;
  v_paid_a  integer;
  v_paid_b  integer;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into v_war from public.bid_wars where id = p_war for update;
  if v_war.id is null then raise exception 'War not found'; end if;
  if v_me <> v_war.initiator_id and v_me <> v_war.opponent_id then
    raise exception 'Not your war';
  end if;
  if v_war.status <> 'pending' then raise exception 'This war is already settled'; end if;
  if exists (select 1 from public.bid_war_bids where war_id = p_war and user_id = v_me) then
    raise exception 'You have already bid on this war';
  end if;

  -- Validate against the board, not against anything the client claims.
  if jsonb_typeof(p_bids) <> 'object' then raise exception 'Malformed bids'; end if;

  if exists (
    select 1 from jsonb_each_text(p_bids) b
    where b.key not in (select x->>'album_id' from jsonb_array_elements(v_war.records) x)
  ) then raise exception 'Bid placed on a record that is not in this war'; end if;

  if exists (select 1 from jsonb_each_text(p_bids) b where b.value !~ '^[0-9]+$') then
    raise exception 'Bids must be whole, non-negative numbers';
  end if;

  select coalesce(sum(b.value::numeric), 0) into v_sum from jsonb_each_text(p_bids) b;
  if v_sum > v_war.chips then
    raise exception 'That spends % chips but you only have %', v_sum, v_war.chips;
  end if;

  insert into public.bid_war_bids (war_id, user_id, bids) values (p_war, v_me, p_bids);

  v_other := case when v_me = v_war.initiator_id
                  then v_war.opponent_id else v_war.initiator_id end;

  -- Other player hasn't bid yet: nudge them and stop here.
  if not exists (select 1 from public.bid_war_bids where war_id = p_war and user_id = v_other) then
    insert into public.notifications (user_id, actor_id, type, data)
    select v_other, v_me, 'bid_war_turn',
           jsonb_build_object('username', coalesce(p.username, 'someone'),
                              'avatar_url', coalesce(p.avatar_url, ''),
                              'war_id', p_war)
    from public.profiles p where p.id = v_me;
    return v_war;
  end if;

  -- Both bids are in. Settle it.
  select bids into v_a from public.bid_war_bids
    where war_id = p_war and user_id = v_war.initiator_id;
  select bids into v_b from public.bid_war_bids
    where war_id = p_war and user_id = v_war.opponent_id;

  for r in select value from jsonb_array_elements(v_war.records) loop
    v_key := r->>'album_id';
    select value into v_val from public.bid_war_values
      where war_id = p_war and album_id = v_key;
    v_val   := coalesce(v_val, 0);
    v_bid_a := coalesce((v_a->>v_key)::numeric, 0);
    v_bid_b := coalesce((v_b->>v_key)::numeric, 0);

    -- Equal bids: the record goes to nobody. Cleaner than a coin flip, and
    -- it means a tie is a decision both players can reason about up front.
    if    v_bid_a > v_bid_b then v_ta := v_ta + v_val;
    elsif v_bid_b > v_bid_a then v_tb := v_tb + v_val;
    end if;

    v_records := v_records || jsonb_build_array(
      r || jsonb_build_object(
        'value',         v_val,
        'bid_initiator', v_bid_a,
        'bid_opponent',  v_bid_b,
        'won_by', case when v_bid_a > v_bid_b then v_war.initiator_id
                       when v_bid_b > v_bid_a then v_war.opponent_id
                       else null end)
    );
  end loop;

  v_winner := case when v_ta > v_tb then v_war.initiator_id
                   when v_tb > v_ta then v_war.opponent_id
                   else null end;

  update public.bid_wars set
    status          = 'resolved',
    records         = v_records,
    initiator_total = v_ta,
    opponent_total  = v_tb,
    winner_id       = v_winner,
    resolved_at     = now()
  where id = p_war
  returning * into v_war;

  -- Discs are awarded here rather than in the browser, so a Bid War payout
  -- is the one part of the economy a client cannot invent. A loss still pays
  -- something: turning up should never be worth nothing.
  --
  -- Through war_award(), which applies the daily cap. A war cannot be forged
  -- but it CAN be manufactured, and at these amounts that is the whole risk —
  -- see the header. The awards are applied in uuid order so two wars between
  -- the same pair settling at once cannot deadlock on each other's profiles.
  if v_winner is null then
    v_pay_a := 1500; v_pay_b := 1500;
  elsif v_winner = v_war.initiator_id then
    v_pay_a := 3000; v_pay_b := 800;
  else
    v_pay_a := 800;  v_pay_b := 3000;
  end if;

  if v_war.initiator_id < v_war.opponent_id then
    v_paid_a := public.war_award(v_war.initiator_id, v_pay_a);
    v_paid_b := public.war_award(v_war.opponent_id,  v_pay_b);
  else
    v_paid_b := public.war_award(v_war.opponent_id,  v_pay_b);
    v_paid_a := public.war_award(v_war.initiator_id, v_pay_a);
  end if;

  -- What was actually paid, stored on the war. The client used to hardcode
  -- 30/15/8 and print it next to a balance it had not checked; with a cap that
  -- is not merely brittle, it is wrong every time somebody is capped. Same
  -- lesson as login_last_date: the server returns the field, the client does
  -- not infer it.
  update public.bid_wars set
    initiator_award = v_paid_a,
    opponent_award  = v_paid_b
  where id = p_war
  returning * into v_war;

  insert into public.notifications (user_id, actor_id, type, data)
  select t.uid, t.foe, 'bid_war_result',
         jsonb_build_object('username', coalesce(p.username, 'someone'),
                            'avatar_url', coalesce(p.avatar_url, ''),
                            'war_id', p_war,
                            'outcome', case when v_winner is null then 'draw'
                                            when v_winner = t.uid then 'won'
                                            else 'lost' end)
  from (values (v_war.initiator_id, v_war.opponent_id),
               (v_war.opponent_id,  v_war.initiator_id)) as t(uid, foe)
  join public.profiles p on p.id = t.foe;

  return v_war;
end;
$$;

revoke all on function public.bid_war_submit(uuid, jsonb) from public, anon;
grant execute on function public.bid_war_submit(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------- guards
do $$
declare v_src text;
begin
  if to_regprocedure('public.war_award(uuid, integer)') is null then
    raise exception 'war_award did not get created';
  end if;

  select prosrc into v_src from pg_proc where proname = 'bid_war_submit';

  -- The one thing a reader of bid_war_submit has to be able to trust: the
  -- payout goes through the cap, not straight at profiles.discs.
  if v_src like '%update public.profiles set discs%' then
    raise exception 'bid_war_submit still credits profiles.discs directly — the cap is not in the path';
  end if;
  if v_src not like '%public.war_award(%' then
    raise exception 'bid_war_submit does not call war_award — the old body is still installed';
  end if;

  -- The columns the client now reads instead of guessing.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'bid_wars'
                    and column_name = 'initiator_award') then
    raise exception 'bid_wars.initiator_award missing';
  end if;

  raise notice 'Bid Wars: win 3,000 / draw 1,500 / loss 800, capped at 3 paid settlements a day.';
end $$;
