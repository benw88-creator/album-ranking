-- Mythic was 9.73%, not 10%. One weight.
--
-- ..._20260913220000 trimmed the 100,000-Disc jackpot from weight 6 to 3 and
-- never gave the 3 back to the tier, so the pool summed to 997 instead of 1000
-- and every published percentage was wrong:
--
--            shipped        intended
--   Common   300/997 30.09%   30%
--   Rare     250/997 25.08%   25%
--   Epic     200/997 20.06%   20%
--   Legend   150/997 15.05%   15%
--   Mythic    97/997  9.73%   10%
--
-- Small, and it would have stayed invisible — a weighted walk over a table does
-- not care whether the weights are round, and nothing in the app ever prints
-- the total. **The weights summing to 1000 is the only thing that makes the
-- tier split legible as percentages at all**, which is exactly why it was
-- chosen over arbitrary numbers, and exactly why it has to be checked whenever
-- one of them moves.
--
-- The 3 goes back onto `picks3` rather than the jackpot: album picks pay no
-- Discs, so this is the one weight in the tier that can move without changing
-- the pool's expected return, which stays at ~886.6 against the 1,000 cost.
update public.spin_items set weight = 37 where key = 'picks3';

-- Fails loudly if anything else drifts.
do $$
declare v_total integer;
begin
  select sum(weight) into v_total from public.spin_items;
  if v_total <> 1000 then
    raise exception 'spin_items weights sum to %, not 1000 — the published tier percentages are wrong', v_total;
  end if;
end $$;
