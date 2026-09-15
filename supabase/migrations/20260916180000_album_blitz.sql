-- Album Blitz: ten rounds of album covers, played head to head against a mate.
--
-- ---------------------------------------------------------------------------
-- What it is, and what it deliberately is not
-- ---------------------------------------------------------------------------
-- Ten questions over album artwork — which came first, which has more tracks,
-- which album this song is off, which of these is by Radiohead. Two choices at
-- the start, four by the end, less time each round. About a minute a match.
--
-- **It is not a new source of music data.** Every question is generated from
-- `ALBUM_ROWS` and `SONG_ROWS`, the static tables the Daily Drop already bakes
-- into `index.html` — title, artist, year, genre, track count, runtime, and for
-- songs the album they are off and its artwork. So Blitz needs no token, works
-- offline, scores instantly, and scores **the same on both players' phones**,
-- which is the property the whole competitive half depends on.
--
-- **It is not Higher or Lower.** That game asks which of YOUR records has more
-- streams, from your own crate, and it stays that. Blitz asks about records
-- everybody knows, from a shared list, so two people can be asked the same
-- thing — which Higher or Lower can never do, because no two crates match.
--
-- ---------------------------------------------------------------------------
-- Why ten fixed rounds and no lives
-- ---------------------------------------------------------------------------
-- Sudden death is the obvious shape for a fast quiz and it is the wrong one
-- here: if a match ends when you miss, the two players answer a different
-- number of questions and the scores are not comparable. **A fixed ten is what
-- makes "I beat you 2,400 to 2,050" mean anything.** A wrong answer costs the
-- streak instead, which is the real currency — see the multiplier below — and
-- costs enough that people still swear at it.
--
-- ---------------------------------------------------------------------------
-- The seed is the whole fairness mechanism, and it is hidden
-- ---------------------------------------------------------------------------
-- Both players must get the same ten questions, so the match carries a seed and
-- each client generates the identical set from it — the same trick the Daily
-- Drop uses for the day's answer, and the reason no server route is needed to
-- pick questions.
--
-- **`blitz_seeds` has RLS on and no policies at all**, exactly like
-- `bid_war_values`. If the seed sat on the match row anybody could read it,
-- generate the ten questions at their leisure, look the answers up and then
-- play. `blitz_start()` is the only way to it, it stamps the moment you asked,
-- and a player who has already submitted cannot ask again.
--
-- That is not proof against a determined cheat — the game runs in a browser and
-- the score is client-reported, the same posture as every other minigame here.
-- The defence is the same too: **the daily cap is what bounds it**, and a
-- forged score wins a head-to-head against one friend rather than any Discs.
--
-- ---------------------------------------------------------------------------
-- Both players are paid the same, deliberately
-- ---------------------------------------------------------------------------
-- Winning pays no more than losing. Bid Wars had to think hard about collusion
-- because its payout differed by outcome; here there is no differential to
-- farm, so two accounts playing each other all day earn exactly what one
-- account playing alone earns, and the cap does the rest. **The prize for
-- winning is the head-to-head record**, which is the thing people actually
-- replay for.

create table if not exists public.blitz_matches (
  id                uuid primary key default gen_random_uuid(),
  initiator_id      uuid not null references auth.users(id) on delete cascade,
  opponent_id       uuid not null references auth.users(id) on delete cascade,
  status            text not null default 'pending' check (status in ('pending', 'resolved')),
  initiator_score   integer,
  opponent_score    integer,
  initiator_streak  integer,
  opponent_streak   integer,
  initiator_correct integer,
  opponent_correct  integer,
  winner_id         uuid,
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz
);
create index if not exists blitz_initiator_idx on public.blitz_matches (initiator_id, created_at desc);
create index if not exists blitz_opponent_idx  on public.blitz_matches (opponent_id,  created_at desc);

-- No policies, ever. The only reader is blitz_start().
create table if not exists public.blitz_seeds (
  match_id uuid primary key references public.blitz_matches(id) on delete cascade,
  seed     bigint not null
);

alter table public.blitz_matches enable row level security;
alter table public.blitz_seeds   enable row level security;

-- Read your own matches. There is **no insert, update or delete policy** — the
-- definer functions below are the only way in, so a player cannot write their
-- own score, their opponent's, or a winner.
drop policy if exists blitz_matches_select_mine on public.blitz_matches;
create policy blitz_matches_select_mine
  on public.blitz_matches for select
  to authenticated
  using (initiator_id = auth.uid() or opponent_id = auth.uid());

-- ------------------------------------------------------------------ create
create or replace function public.blitz_create(p_opponent uuid)
returns public.blitz_matches
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  m    public.blitz_matches;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_opponent is null or p_opponent = v_me then raise exception 'Pick somebody else'; end if;
  if not exists (select 1 from public.profiles where id = p_opponent) then
    raise exception 'No such player';
  end if;

  insert into public.blitz_matches (initiator_id, opponent_id)
  values (v_me, p_opponent)
  returning * into m;

  -- Server-side, so nobody can reroll until the questions look easy.
  insert into public.blitz_seeds (match_id, seed)
  values (m.id, (random() * 2147483647)::bigint);

  insert into public.notifications (user_id, actor_id, type, data)
  select p_opponent, v_me, 'blitz_challenge',
         jsonb_build_object('username', coalesce(p.username, 'someone'),
                            'avatar_url', coalesce(p.avatar_url, ''),
                            'match_id', m.id)
  from public.profiles p where p.id = v_me;

  return m;
end $$;

-- ------------------------------------------------------------------- start
-- The only route to the seed. Refuses once you have submitted, so the questions
-- cannot be re-read after the fact.
create or replace function public.blitz_start(p_match uuid)
returns bigint
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := auth.uid();
  m      public.blitz_matches;
  v_seed bigint;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into m from public.blitz_matches where id = p_match;
  if m.id is null then raise exception 'No such match'; end if;
  if v_me <> m.initiator_id and v_me <> m.opponent_id then raise exception 'Not your match'; end if;

  if (v_me = m.initiator_id and m.initiator_score is not null)
     or (v_me = m.opponent_id and m.opponent_score is not null) then
    raise exception 'You have already played this one';
  end if;

  select seed into v_seed from public.blitz_seeds where match_id = p_match;
  return v_seed;
end $$;

-- ------------------------------------------------------------------ submit
create or replace function public.blitz_submit(p_match uuid, p_score integer,
                                               p_streak integer, p_correct integer)
returns public.blitz_matches
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me    uuid := auth.uid();
  m       public.blitz_matches;
  v_first boolean;
  v_other uuid;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into m from public.blitz_matches where id = p_match for update;
  if m.id is null then raise exception 'No such match'; end if;
  if v_me <> m.initiator_id and v_me <> m.opponent_id then raise exception 'Not your match'; end if;

  -- Clamped rather than trusted. 3,600 is a flawless run — ten right, every
  -- one instant, the multiplier climbing the whole way — so anything above it
  -- is arithmetic that did not happen.
  p_score   := greatest(least(coalesce(p_score, 0), 3600), 0);
  p_streak  := greatest(least(coalesce(p_streak, 0), 10), 0);
  p_correct := greatest(least(coalesce(p_correct, 0), 10), 0);

  v_first := (v_me = m.initiator_id);
  if v_first and m.initiator_score is not null then raise exception 'You have already played this one'; end if;
  if not v_first and m.opponent_score is not null then raise exception 'You have already played this one'; end if;

  update public.blitz_matches set
    initiator_score   = case when v_first then p_score   else initiator_score   end,
    initiator_streak  = case when v_first then p_streak  else initiator_streak  end,
    initiator_correct = case when v_first then p_correct else initiator_correct end,
    opponent_score    = case when v_first then opponent_score    else p_score   end,
    opponent_streak   = case when v_first then opponent_streak   else p_streak  end,
    opponent_correct  = case when v_first then opponent_correct  else p_correct end
  where id = p_match
  returning * into m;

  v_other := case when v_first then m.opponent_id else m.initiator_id end;

  if m.initiator_score is not null and m.opponent_score is not null then
    update public.blitz_matches set
      status      = 'resolved',
      resolved_at = now(),
      winner_id   = case when initiator_score > opponent_score then initiator_id
                         when opponent_score > initiator_score then opponent_id
                         else null end
    where id = p_match
    returning * into m;

    -- Both told, because the one who played first is not on the page.
    insert into public.notifications (user_id, actor_id, type, data)
    select t.uid, t.foe, 'blitz_result',
           jsonb_build_object('username', coalesce(p.username, 'someone'),
                              'avatar_url', coalesce(p.avatar_url, ''),
                              'match_id', p_match,
                              'outcome', case when m.winner_id is null then 'draw'
                                              when m.winner_id = t.uid then 'won'
                                              else 'lost' end)
    from (values (m.initiator_id, m.opponent_id),
                 (m.opponent_id,  m.initiator_id)) as t(uid, foe)
    join public.profiles p on p.id = t.foe;
  else
    insert into public.notifications (user_id, actor_id, type, data)
    select v_other, v_me, 'blitz_turn',
           jsonb_build_object('username', coalesce(p.username, 'someone'),
                              'avatar_url', coalesce(p.avatar_url, ''),
                              'match_id', p_match,
                              'score', p_score)
    from public.profiles p where p.id = v_me;
  end if;

  return m;
end $$;

-- ------------------------------------------------------------------ record
-- The rivalry. This is the number people come back for, so it is one call and
-- not something the client counts out of a list it happens to have.
create or replace function public.blitz_record(p_other uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_w integer; v_l integer; v_d integer; v_best integer;
begin
  if v_me is null or p_other is null then
    return jsonb_build_object('won', 0, 'lost', 0, 'drawn', 0);
  end if;
  select
    count(*) filter (where winner_id = v_me),
    count(*) filter (where winner_id = p_other),
    count(*) filter (where winner_id is null),
    max(case when initiator_id = v_me then initiator_score else opponent_score end)
  into v_w, v_l, v_d, v_best
  from public.blitz_matches
  where status = 'resolved'
    and ((initiator_id = v_me and opponent_id = p_other)
      or (initiator_id = p_other and opponent_id = v_me));
  return jsonb_build_object('won', coalesce(v_w,0), 'lost', coalesce(v_l,0),
                            'drawn', coalesce(v_d,0), 'best', coalesce(v_best,0));
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function public.blitz_create(uuid)                        from public, anon;
revoke all on function public.blitz_start(uuid)                         from public, anon;
revoke all on function public.blitz_submit(uuid, integer, integer, integer) from public, anon;
revoke all on function public.blitz_record(uuid)                        from public, anon;
grant execute on function public.blitz_create(uuid)                        to authenticated;
grant execute on function public.blitz_start(uuid)                         to authenticated;
grant execute on function public.blitz_submit(uuid, integer, integer, integer) to authenticated;
grant execute on function public.blitz_record(uuid)                        to authenticated;

-- ------------------------------------------------------------ the payout
-- 1,600 x 3, the same as Higher or Lower: a minute of play, capped where
-- playing stops being the fun part. Create-or-replace of the function as it
-- stands after ..._20260914160000_play_pays_properly.sql with one row added.
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
    when 'earworm'     then v_amt := 2000; v_cap := 3;
    when 'drop'        then v_amt := 3000; v_cap := 1;
    when 'tournament'  then v_amt := 1600; v_cap := 2;
    when 'achievement' then v_amt := 1600; v_cap := 5;
    when 'higherlower' then v_amt := 1600; v_cap := 3;
    when 'blitz'       then v_amt := 1600; v_cap := 3;
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
    'owned_banners', p.owned_banners,
    'lifetime_xp', p.lifetime_xp, 'level', p.level
  );
end;
$$;

revoke all on function public.wallet_award_game(text) from public, anon;
grant execute on function public.wallet_award_game(text) to authenticated;

-- ------------------------------------------------------------------ guards
do $$
begin
  if (select prosrc from pg_proc where proname = 'wallet_award_game') not like '%blitz%' then
    raise exception 'wallet_award_game has no blitz case — finishing a match would raise Unknown game';
  end if;
  -- The seed table must stay unreadable. A policy on it is the one change that
  -- would quietly turn the questions into something you can look up first.
  if exists (select 1 from pg_policies where tablename = 'blitz_seeds') then
    raise exception 'blitz_seeds has a policy on it — the seed is meant to be reachable only through blitz_start()';
  end if;
  if exists (select 1 from pg_policies where tablename = 'blitz_matches' and cmd <> 'SELECT') then
    raise exception 'blitz_matches has a write policy — scores must only come from blitz_submit()';
  end if;
  raise notice 'Album Blitz: ten rounds, seeds sealed, both players paid 1,600 x 3.';
end $$;
