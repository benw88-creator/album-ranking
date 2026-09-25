-- The Lore mission now wants 5 answers, not 1 — one question is answered in
-- passing on almost every visit and paid out too easily against the other
-- five missions. Progress already counts distinct lore_answers rows created
-- today (daily_missions_status), so raising the target is the whole change;
-- nothing else needed touching for progress to persist across the five.

create or replace function public.daily_missions_defs()
returns table(key text, label text, target integer, reward integer)
language sql immutable
as $$
  values
    ('rank3',   'Rank 3 albums today',        3, 2500),
    ('buy1',    'Buy a record',                1, 2000),
    ('game1',   'Play a minigame',             1, 1500),
    ('songs5',  'Rate 5 songs today',          5, 1500),
    ('lore1',   'Answer 5 Lore questions',     5, 1500),
    ('login1',  'Open the app',                1, 1000)
$$;

do $$
declare v_total integer;
begin
  select sum(reward) into v_total from public.daily_missions_defs();
  if v_total <> 10000 then
    raise exception 'Daily missions no longer sum to 10,000 — they sum to %', v_total;
  end if;
end $$;
