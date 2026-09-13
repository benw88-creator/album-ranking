-- Playing pays a sensible fraction of what things cost.
--
-- ---------------------------------------------------------------------------
-- The problem
-- ---------------------------------------------------------------------------
-- A spin is 1,000. The cheapest tag is 4,000, the dearest 16,000, and the whole
-- shop is ~262,000. Against that, rating an album paid 160 — so ten ratings,
-- the daily cap, came to 1,600: one and a half spins, or a third of the
-- cheapest thing in the shop. The core action of the app was the worst-paid
-- thing in it.
--
-- Roughly a 2x on everything except the Daily Drop, which gets 2x as well but
-- from a base that was already the biggest single payout. Ratios between the
-- games are untouched — this is about their size relative to *prices*, not
-- relative to each other.
--
--   rating       160 -> 400   x10/day  =  4,000
--   lore         100 -> 250   x20/day  =  5,000
--   earworm    1,000 -> 2,000  x3      =  6,000
--   drop       1,500 -> 3,000  x1      =  3,000
--   achievement  800 -> 1,600  x5      =  8,000
--   higherlower  800 -> 1,600  x3      =  4,800
--   tournament   800 -> 1,600  x2      =  3,200   (parked — no card, no way in)
--                                        ------
--   a day of everything                   30,800
--
-- What that buys: a realistic session of ~9,000 is nine spins or two cheap
-- tags; a full day is two mid-priced tags; the entire shop is about eight and
-- a half days of maxing every game. Discs stay worth counting.
--
-- ---------------------------------------------------------------------------
-- What deliberately did NOT move
-- ---------------------------------------------------------------------------
-- * **The caps.** Ten ratings, twenty lore answers, three Earworms. These are
--   the anti-forgery defence, not the balance lever — every one of these games
--   runs in the browser and a win cannot be verified, so the cap is the only
--   thing standing between a daily payout and a console loop. Move amounts,
--   never caps.
-- * **The Draw's cost and pool.** Its expected return (~887 against 1,000) is
--   a ratio between two Disc figures, so raising what you earn cannot make it
--   pay out more than it takes. The sink holds.
-- * **The Collection divisor.** Views stays 51,240, which at the new ceiling is
--   under two days of doing everything rather than just over. Re-pricing it
--   would mean re-pricing stored rows too, since `collection.price` is both
--   what a record cost and what it counts for — and a divisor change that
--   touches only new purchases makes net worth incoherent between them.
-- * **Bid Wars**, still 30/8/15, still needing a daily cap before it can be
--   scaled. See the note in ..._20260913220000.
-- * **The login ladder.** It still pays more than playing does at the top end
--   (32,000 on day six against 30,800 for a full day of games) — but they are
--   now the same order of magnitude rather than one dwarfing the other, which
--   is most of what was wrong.

create or replace function public.wallet_record_rating()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  p       public.profiles;
  v_today date := (now() at time zone 'utc')::date;
  v_gap   integer;
  v_earn  integer := 0;
  v_miles integer[] := array[7, 30, 100, 365];
  v_hit   integer := null;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;

  if p.rating_awards_date is distinct from v_today then
    p.rating_awards_date := v_today;
    p.rating_awards_count := 0;
  end if;

  -- The 10 is the defence. The 400 is the lever.
  if p.rating_awards_count < 10 then
    v_earn := 400;
    p.rating_awards_count := p.rating_awards_count + 1;
  end if;

  if p.streak_last_date is distinct from v_today then
    v_gap := case when p.streak_last_date is null then null
                  else v_today - p.streak_last_date end;
    if v_gap is null then
      p.streak_current := 1;
    elsif v_gap = 1 then
      p.streak_current := p.streak_current + 1;
    elsif v_gap > 1 then
      if coalesce(p.streak_freezes, 0) > 0 then
        p.streak_freezes := p.streak_freezes - 1;
        p.streak_current := p.streak_current + 1;
      else
        p.streak_current := 1;
      end if;
    end if;
    p.streak_best := greatest(coalesce(p.streak_best, 0), p.streak_current);
    p.streak_last_date := v_today;
    if p.streak_current = any(v_miles) then v_hit := p.streak_current; end if;
  end if;

  update public.profiles set
    discs = coalesce(discs, 0) + v_earn,
    streak_current = p.streak_current, streak_best = p.streak_best,
    streak_last_date = p.streak_last_date, streak_freezes = p.streak_freezes,
    rating_awards_date = p.rating_awards_date, rating_awards_count = p.rating_awards_count
  where id = v_me
  returning * into p;

  return jsonb_build_object('earned', v_earn, 'milestone', v_hit,
                            'discs', p.discs, 'streak_current', p.streak_current,
                            'streak_best', p.streak_best, 'streak_freezes', p.streak_freezes);
end $$;

create or replace function public.award_lore_disc()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_count integer;
begin
  if new.skipped or new.choice is null then return new; end if;

  select case when lore_awards_date is distinct from v_today then 0
              else coalesce(lore_awards_count, 0) end
    into v_count
  from public.profiles where id = new.user_id;

  if v_count is null or v_count >= 20 then return new; end if;

  update public.profiles set
    discs = coalesce(discs, 0) + 250,
    lore_awards_date = v_today, lore_awards_count = v_count + 1
  where id = new.user_id;

  return new;
end $$;

drop trigger if exists award_lore_disc on public.lore_answers;
create trigger award_lore_disc
  after insert on public.lore_answers
  for each row execute function public.award_lore_disc();

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

  -- Adding a game means adding a `when` here and nothing else.
  case p_game
    when 'earworm'     then v_amt := 2000; v_cap := 3;
    when 'drop'        then v_amt := 3000; v_cap := 1;
    when 'achievement' then v_amt := 1600; v_cap := 5;
    when 'higherlower' then v_amt := 1600; v_cap := 3;
    -- Album Tournament has no card and so no way in. Kept in step anyway, so
    -- putting the card back is putting a card back.
    when 'tournament'  then v_amt := 1600; v_cap := 2;
    else raise exception 'Unknown game: %', p_game;
  end case;

  select * into p from public.profiles where id = v_me for update;
  if p.id is null then raise exception 'No profile'; end if;

  if p.game_awards_date is distinct from v_today then
    p.game_awards_date := v_today;
    p.game_awards      := '{}'::jsonb;
  end if;

  v_used := coalesce((p.game_awards ->> p_game)::integer, 0);
  if v_used < v_cap then
    v_earn := v_amt;
    p.game_awards := p.game_awards || jsonb_build_object(p_game, v_used + 1);
  end if;

  update public.profiles set
    discs = coalesce(discs, 0) + v_earn,
    game_awards_date = p.game_awards_date, game_awards = p.game_awards
  where id = v_me
  returning * into p;

  return jsonb_build_object(
    'earned', v_earn, 'capped', (v_earn = 0), 'discs', p.discs,
    'streak_current', p.streak_current, 'streak_best', p.streak_best,
    'streak_freezes', p.streak_freezes,
    'owned_themes', p.owned_themes, 'owned_banners', p.owned_banners);
end $$;

revoke all on function public.wallet_award_game(text) from public, anon;
grant execute on function public.wallet_award_game(text) to authenticated;
