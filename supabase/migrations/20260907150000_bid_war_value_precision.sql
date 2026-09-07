-- Album ratings in Vinal are 0-100 (the #rate-slider is min=0 max=100); it is
-- the SONG slider that is 0-10. bid_war_values.value was declared
-- numeric(4,2), which tops out at 99.99, so a record whose community average
-- came to exactly 100 would abort bid_war_create with a numeric field
-- overflow. Widen it.
--
-- bid_wars.initiator_total / opponent_total are already numeric(5,2): five
-- records at 100 each caps the total at 500, well inside 999.99.

alter table public.bid_war_values
  alter column value type numeric(5,2);
