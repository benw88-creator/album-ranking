-- Higher or Lower joins the payout table.
--
-- Same shape as every other entry: the server owns the amount and the cap, the
-- client only names the game. 12 discs for a run of five or more, three times a
-- day — the client decides whether the run qualified, which it can lie about,
-- so the cap is what actually bounds the exploit. Same reasoning as the rest of
-- wallet_award_game; see ..._20260911100000_game_awards.sql.
--
-- This is a create-or-replace of that function with one row added to the case.
-- Nothing else changes.

create or replace function public.wallet_award_game(p_game text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  p       public.profiles;
  v_today date := (now() at time zone 'utc')::date;
  v_amt   integer;
  v_cap   integer;
  v_used  integer;
  v_earn  integer := 0;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  case p_game
    when 'earworm'     then v_amt := 15; v_cap := 3;
    when 'drop'        then v_amt := 20; v_cap := 1;
    when 'tournament'  then v_amt := 10; v_cap := 2;
    when 'achievement' then v_amt := 10; v_cap := 5;
    when 'higherlower' then v_amt := 12; v_cap := 3;
    else raise exception 'Unknown game: %', p_game;
  end case;

  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;

  if p.game_awards_date is distinct from v_today then
    p.game_awards_date := v_today;
    p.game_awards := '{}'::jsonb;
  end if;

  v_used := coalesce((p.game_awards ->> p_game)::integer, 0);
  if v_used < v_cap then
    v_earn := v_amt;
    p.game_awards := p.game_awards || jsonb_build_object(p_game, v_used + 1);
  end if;

  update public.profiles set
    discs            = coalesce(discs, 0) + v_earn,
    game_awards_date = p.game_awards_date,
    game_awards      = p.game_awards
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'earned', v_earn,
    'capped', (v_earn = 0),
    'discs',  p.discs,
    'streak_current', p.streak_current,
    'streak_best', p.streak_best,
    'streak_freezes', p.streak_freezes,
    'owned_themes', p.owned_themes,
    'owned_banners', p.owned_banners
  );
end;
$$;

revoke all on function public.wallet_award_game(text) from public, anon;
grant execute on function public.wallet_award_game(text) to authenticated;
