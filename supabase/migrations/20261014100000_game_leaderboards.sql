-- ============================================================================
-- Leaderboards for every minigame, scored and timed by the server.
--
-- game_runs  — one row per run. game_start() stamps started_at; game_finish()
--              measures elapsed against it and computes the score. A run can
--              finish exactly once, so a duplicate or replayed submission is
--              refused, and starting a new non-daily run voids any open one,
--              so nobody can start ten and file only the best.
-- game_bests — one row per (board, player): the leaderboard itself. Reads are
--              an index range ordered by score, never a scan of game_runs.
--
-- What the server cannot know: these games run in the browser and most of
-- their questions are built there, so CORRECTNESS is client-reported for
-- everything except Recall's daily (taken from recall_results) and Higher or
-- Lower (points recomputed from the streak). The defence is the same as every
-- other minigame here: server time, plausibility floors (nobody answers five
-- covers in 7 seconds), score ceilings, one finish per run, and rate limits.
--
-- Nothing here pays Discs, touches profiles, or changes an existing table.
-- Idempotent: safe to run twice.
-- ============================================================================

create table if not exists public.game_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  game          text not null,
  mode          text not null,
  artist_key    text,
  artist_label  text,
  day           integer,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  elapsed_ms    integer,
  score         integer,
  detail        jsonb,
  status        text not null default 'open' check (status in ('open','done','void'))
);
create index if not exists game_runs_user_recent on public.game_runs (user_id, game, started_at desc);
-- One go at each daily, enforced by the database rather than a check somebody
-- has to remember.
create unique index if not exists game_runs_one_daily on public.game_runs (user_id, game, mode, day) where day is not null;
alter table public.game_runs enable row level security;
drop policy if exists game_runs_own on public.game_runs;
create policy game_runs_own on public.game_runs for select using (user_id = auth.uid());

create table if not exists public.game_bests (
  game          text not null,
  mode          text not null,
  artist_key    text not null default '*',   -- '*' is the overall board
  day           integer not null default -1, -- -1 is all-time
  user_id       uuid not null references auth.users(id) on delete cascade,
  artist_label  text,
  score         integer not null,
  elapsed_ms    integer not null,
  run_id        uuid,
  achieved_at   timestamptz not null default now(),
  primary key (game, mode, artist_key, day, user_id)
);
create index if not exists game_bests_board on public.game_bests (game, mode, artist_key, day, score desc, elapsed_ms asc, achieved_at asc);
create index if not exists game_bests_user on public.game_bests (user_id);
alter table public.game_bests enable row level security;
-- Scores are public, like the Crate's spread: a leaderboard nobody can read is not one.
drop policy if exists game_bests_read on public.game_bests;
create policy game_bests_read on public.game_bests for select using (true);

-- ---- which boards exist ----------------------------------------------------
-- A (game, mode) pair is a board only when its runs are comparable. Not here,
-- deliberately: Earworm unlimited and Higher or Lower's ratings mode (both
-- built from YOUR crate), Cover Fire head-to-heads, Bid Wars.
create or replace function public.game_spec(p_game text, p_mode text)
returns jsonb language sql immutable as $$
  select (case
    when p_game in ('cover','coverx','tracklist','year') and p_mode = 'artist'
      then '{"artist":true,"daily":false,"max_ms":3600000}'
    when p_game = 'drop' and p_mode in ('album','song')
      then '{"artist":false,"daily":true,"max_ms":129600000}'
    when p_game = 'earworm' and p_mode = 'daily'
      then '{"artist":false,"daily":true,"max_ms":129600000}'
    when p_game = 'blitz' and p_mode = 'daily'
      then '{"artist":false,"daily":true,"max_ms":3600000}'
    when p_game = 'blitz' and p_mode = 'solo'
      then '{"artist":false,"daily":false,"max_ms":3600000}'
    when p_game = 'recall' and p_mode = 'daily'
      then '{"artist":false,"daily":true,"max_ms":129600000}'
    when p_game = 'recall' and p_mode = 'endless'
      then '{"artist":false,"daily":false,"max_ms":7200000}'
    when p_game = 'higherlower' and p_mode = 'streams'
      then '{"artist":false,"daily":false,"max_ms":7200000}'
  end)::jsonb
$$;

-- ---- scoring, one formula per kind of game ----------------------------------
-- Raises on anything implausible; game_finish turns that into a voided run.
create or replace function public.game_score(p_game text, p_mode text, p_r jsonb, p_ms integer, p_user uuid, p_day integer)
returns integer language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c int; near int; pool int; g int; s int; n int; k int; letters int;
  par numeric; diff numeric; f numeric; speed numeric;
begin
  p_r := coalesce(p_r, '{}'::jsonb);

  -- Five rounds on one artist's records. Accuracy first (1,000 a round; a
  -- year within one is 700), then speed against a par per game worth at most
  -- 300 a CORRECT round — so a fast wrong run gains nothing and speed tops out
  -- at 23% of the ceiling. Difficulty by game, and the pool factor is what
  -- makes the overall board fair across artists: naming one of five albums
  -- is easier than one of forty, so a small discography is worth less.
  if p_game in ('cover','coverx','tracklist','year') then
    c    := least(greatest(coalesce((p_r->>'correct')::int, 0), 0), 5);
    near := case when p_game = 'year' then least(greatest(coalesce((p_r->>'near')::int, 0), 0), c) else 0 end;
    pool := least(greatest(coalesce((p_r->>'pool')::int, 5), 5), 200);
    if p_ms < 7500 then raise exception 'too fast'; end if;
    par  := case p_game when 'coverx' then 15000 when 'tracklist' then 18000 when 'year' then 10000 else 12000 end;
    diff := case p_game when 'coverx' then 1.35 when 'tracklist' then 1.2 when 'year' then 1.1 else 1.0 end;
    f    := least(1.0, 0.55 + 0.45 * ln(pool) / ln(20));
    speed := greatest(0, least(1, (par * 5 - p_ms) / (par * 5 - 7500)));
    return round(((c - near) * 1000 + near * 700 + 300 * c * speed) * diff * f);
  end if;

  -- Wordle-shaped dailies: guesses decide it, time only separates equals —
  -- the most speed can add (500 / 400) is less than one guess (1,000).
  if p_game = 'drop' then
    g := (p_r->>'guesses')::int;
    if g is null or g < 1 or g > 6 then raise exception 'bad guesses'; end if;
    if not coalesce((p_r->>'solved')::boolean, false) then return 0; end if;
    if p_ms < g * 1500 then raise exception 'too fast'; end if;
    return (7 - g) * 1000 + round(500 * greatest(0, least(1, (600000 - p_ms) / 570000.0)));
  end if;

  -- Earworm also rewards a longer title (more letters to find) and charges
  -- for the hint.
  if p_game = 'earworm' then
    g := (p_r->>'guesses')::int;
    letters := least(greatest(coalesce((p_r->>'letters')::int, 1), 1), 40);
    if g is null or g < 1 or g > 6 then raise exception 'bad guesses'; end if;
    if not coalesce((p_r->>'solved')::boolean, false) then return 0; end if;
    if p_ms < g * 2000 then raise exception 'too fast'; end if;
    return (7 - g) * 1000 + least(letters, 15) * 20
         - case when coalesce((p_r->>'hinted')::boolean, false) then 400 else 0 end
         + round(400 * greatest(0, least(1, (600000 - p_ms) / 570000.0)));
  end if;

  -- Cover Fire already scores speed, streak and RISK in the round; the server
  -- holds it to what ten rounds can make (4,200, the blitz_submit ceiling)
  -- and to what that many right answers can make.
  if p_game = 'blitz' then
    s := coalesce((p_r->>'score')::int, -1);
    c := coalesce((p_r->>'correct')::int, -1);
    if s < 0 or s > 4200 or c < 0 or c > 10 then raise exception 'out of range'; end if;
    if s > c * 600 + 600 then raise exception 'score exceeds answers'; end if;
    if p_ms < 9000 then raise exception 'too fast'; end if;
    return s;
  end if;

  -- Recall's daily is already scored server-side by recall_submit; the board
  -- takes that number and nothing the browser says.
  if p_game = 'recall' and p_mode = 'daily' then
    select r.score into s from public.recall_results r
      where r.user_id = p_user and r.mode = 'daily' and r.day = p_day;
    if not found then raise exception 'no daily result'; end if;
    return coalesce(s, 0);
  end if;

  if p_game = 'recall' then   -- endless: at most 1,000 + a 500 streak bonus a song
    s := coalesce((p_r->>'score')::int, -1);
    n := coalesce((p_r->>'played')::int, -1);
    k := coalesce((p_r->>'songs')::int, -1);
    if s < 0 or n < 1 or n > 500 or k < 0 or k > n then raise exception 'out of range'; end if;
    if s > k * 1500 then raise exception 'score exceeds songs'; end if;
    if p_ms < n * 1000 then raise exception 'too fast'; end if;
    return s;
  end if;

  -- Higher or Lower: only the streak is taken; the points are recomputed with
  -- the game's own multiplier (x1, x1.5, x2 ... every three in a row).
  if p_game = 'higherlower' then
    n := coalesce((p_r->>'streak')::int, -1);
    if n < 0 or n > 2000 then raise exception 'out of range'; end if;
    if p_ms < n * 400 then raise exception 'too fast'; end if;
    select coalesce(sum(round(10 * (1 + floor(i / 3.0) * 0.5))), 0)::int into s from generate_series(0, n - 1) i;
    return s;
  end if;

  raise exception 'unknown game';
end $$;

-- ---- start --------------------------------------------------------------------
create or replace function public.game_start(p_game text, p_mode text, p_artist_key text default null,
                                             p_artist_label text default null, p_day integer default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me    uuid := auth.uid();
  v_spec  jsonb := public.game_spec(p_game, p_mode);
  v_today integer := ((now() at time zone 'utc')::date - date '2020-01-01');
  v_daily boolean;
  v_key   text; v_label text;
  v_row   public.game_runs;
  v_n     integer;
begin
  if v_me is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  if v_spec is null then return jsonb_build_object('error', 'unknown_game'); end if;
  v_daily := (v_spec->>'daily')::boolean;
  -- Days are the client's local date (as every daily here counts them), so
  -- one either side of UTC is allowed and nothing further.
  if v_daily and (p_day is null or p_day < v_today - 1 or p_day > v_today + 1) then
    return jsonb_build_object('error', 'bad_day');
  end if;
  if (v_spec->>'artist')::boolean then
    v_key   := nullif(left(btrim(coalesce(p_artist_key, '')), 120), '');
    v_label := nullif(left(btrim(coalesce(p_artist_label, '')), 120), '');
    if v_key is null or v_key = '*' then return jsonb_build_object('error', 'artist_required'); end if;
  end if;

  select count(*) into v_n from public.game_runs
    where user_id = v_me and game = p_game and started_at > now() - interval '1 hour';
  if v_n >= 60 then return jsonb_build_object('error', 'rate_limited'); end if;

  if v_daily then
    insert into public.game_runs (user_id, game, mode, day)
      values (v_me, p_game, p_mode, p_day)
      on conflict (user_id, game, mode, day) where day is not null do nothing
      returning * into v_row;
    if v_row.id is null then
      select * into v_row from public.game_runs
        where user_id = v_me and game = p_game and mode = p_mode and day = p_day;
      -- The daily clock runs from when you first saw the puzzle; reopening
      -- resumes it rather than resetting it.
      if v_row.status = 'open' then
        return jsonb_build_object('id', v_row.id, 'started_at', v_row.started_at, 'now', now(), 'resumed', true);
      end if;
      return jsonb_build_object('error', 'already_played', 'score', v_row.score, 'elapsed_ms', v_row.elapsed_ms);
    end if;
  else
    update public.game_runs set status = 'void'
      where user_id = v_me and game = p_game and status = 'open' and day is null;
    insert into public.game_runs (user_id, game, mode, artist_key, artist_label)
      values (v_me, p_game, p_mode, v_key, v_label)
      returning * into v_row;
  end if;
  return jsonb_build_object('id', v_row.id, 'started_at', v_row.started_at, 'now', now());
end $$;

-- ---- the board's rank arithmetic ------------------------------------------------
create or replace function public._game_rank(p_game text, p_mode text, p_artist text, p_day integer,
                                             p_score integer, p_ms integer, p_me uuid, p_friends boolean)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'rank', 1 + count(*) filter (where b.score > p_score or (b.score = p_score and b.elapsed_ms < p_ms)),
    'total', count(*))
  from public.game_bests b
  where b.game = p_game and b.mode = p_mode and b.artist_key = p_artist and b.day = p_day
    and (not p_friends or b.user_id = p_me
         or b.user_id in (select f.following_id from public.follows f where f.follower_id = p_me))
$$;

create or replace function public._game_keep_best(p_run public.game_runs, p_artist text, p_day integer,
                                                  p_score integer, p_ms integer)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.game_bests (game, mode, artist_key, day, user_id, artist_label, score, elapsed_ms, run_id, achieved_at)
  values (p_run.game, p_run.mode, p_artist, p_day, p_run.user_id, p_run.artist_label, p_score, p_ms, p_run.id, now())
  on conflict (game, mode, artist_key, day, user_id) do update
    set artist_label = excluded.artist_label, score = excluded.score, elapsed_ms = excluded.elapsed_ms,
        run_id = excluded.run_id, achieved_at = excluded.achieved_at
    where excluded.score > public.game_bests.score
       or (excluded.score = public.game_bests.score and excluded.elapsed_ms < public.game_bests.elapsed_ms)
$$;

-- ---- finish ---------------------------------------------------------------------
create or replace function public.game_finish(p_run uuid, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me    uuid := auth.uid();
  v_run   public.game_runs;
  v_spec  jsonb;
  v_ms    integer;
  v_score integer;
  v_akey  text; v_day integer;
  v_prev  public.game_bests;
  v_best  public.game_bests;
  v_pb    boolean := false;
  v_main  jsonb; v_all jsonb;
begin
  if v_me is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  select * into v_run from public.game_runs where id = p_run and user_id = v_me for update;
  if not found then return jsonb_build_object('error', 'unknown_run'); end if;
  if v_run.status <> 'open' then return jsonb_build_object('error', 'already_finished'); end if;
  v_spec := public.game_spec(v_run.game, v_run.mode);
  v_ms := least(extract(epoch from (now() - v_run.started_at)) * 1000, 2000000000)::integer;
  if v_ms > (v_spec->>'max_ms')::integer then
    update public.game_runs set status = 'void', finished_at = now(), elapsed_ms = v_ms where id = p_run;
    return jsonb_build_object('error', 'expired');
  end if;

  begin
    v_score := public.game_score(v_run.game, v_run.mode, p_result, v_ms, v_me, v_run.day);
  exception when others then
    update public.game_runs set status = 'void', finished_at = now(), elapsed_ms = v_ms,
      detail = jsonb_build_object('rejected', sqlerrm, 'result', p_result) where id = p_run;
    return jsonb_build_object('error', 'rejected', 'reason', sqlerrm);
  end;

  update public.game_runs set status = 'done', finished_at = now(), elapsed_ms = v_ms,
    score = v_score, detail = p_result where id = p_run;

  v_akey := coalesce(v_run.artist_key, '*');
  v_day  := coalesce(v_run.day, -1);
  select * into v_prev from public.game_bests
    where game = v_run.game and mode = v_run.mode and artist_key = v_akey and day = v_day and user_id = v_me;
  if v_score > 0 then
    perform public._game_keep_best(v_run, v_akey, v_day, v_score, v_ms);
    if v_akey <> '*' or v_day <> -1 then perform public._game_keep_best(v_run, '*', -1, v_score, v_ms); end if;
    v_pb := v_prev.user_id is null or v_score > v_prev.score or (v_score = v_prev.score and v_ms < v_prev.elapsed_ms);
  end if;

  select * into v_best from public.game_bests
    where game = v_run.game and mode = v_run.mode and artist_key = v_akey and day = v_day and user_id = v_me;
  if v_best.user_id is not null then
    v_main := public._game_rank(v_run.game, v_run.mode, v_akey, v_day, v_best.score, v_best.elapsed_ms, v_me, false);
  end if;
  if v_akey <> '*' or v_day <> -1 then
    select * into v_best from public.game_bests
      where game = v_run.game and mode = v_run.mode and artist_key = '*' and day = -1 and user_id = v_me;
    if v_best.user_id is not null then
      v_all := public._game_rank(v_run.game, v_run.mode, '*', -1, v_best.score, v_best.elapsed_ms, v_me, false);
    end if;
    select * into v_best from public.game_bests
      where game = v_run.game and mode = v_run.mode and artist_key = v_akey and day = v_day and user_id = v_me;
  end if;

  return jsonb_build_object(
    'score', v_score, 'elapsed_ms', v_ms, 'pb', v_pb,
    'best_score', v_best.score, 'best_ms', v_best.elapsed_ms,
    'rank', v_main->'rank', 'total', v_main->'total',
    'overall_rank', v_all->'rank', 'overall_total', v_all->'total',
    'artist_key', v_akey, 'day', v_day, 'game', v_run.game, 'mode', v_run.mode);
end $$;

-- ---- reading a board ------------------------------------------------------------
create or replace function public.game_board(p_game text, p_mode text, p_artist text default '*',
                                             p_day integer default -1, p_friends boolean default false,
                                             p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_me   uuid := auth.uid();
  v_rows jsonb;
  v_mine public.game_bests;
  v_rank jsonb;
  v_akey text := coalesce(nullif(p_artist, ''), '*');
  v_day  integer := coalesce(p_day, -1);
  -- NULL means signed out, and a signed-out reader has no friends board: say
  -- so explicitly rather than letting `user_id = NULL` decide it.
  v_fr   boolean := coalesce(p_friends, false) and v_me is not null;
begin
  if coalesce(p_friends, false) and v_me is null then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'me', null);
  end if;
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  select coalesce(jsonb_agg(x order by x.rk), '[]'::jsonb) into v_rows from (
    select b.user_id, b.score, b.elapsed_ms, b.artist_label, b.achieved_at,
           p.username, p.avatar_url,
           row_number() over (order by b.score desc, b.elapsed_ms asc, b.achieved_at asc) as rk
    from public.game_bests b
    left join public.profiles p on p.id = b.user_id
    where b.game = p_game and b.mode = p_mode and b.artist_key = v_akey and b.day = v_day
      and (not v_fr or b.user_id = v_me
           or b.user_id in (select f.following_id from public.follows f where f.follower_id = v_me))
    order by b.score desc, b.elapsed_ms asc, b.achieved_at asc
    limit p_limit) x;

  if v_me is not null then
    select * into v_mine from public.game_bests
      where game = p_game and mode = p_mode and artist_key = v_akey and day = v_day and user_id = v_me;
  end if;
  if v_mine.user_id is not null then
    v_rank := public._game_rank(p_game, p_mode, v_akey, v_day, v_mine.score, v_mine.elapsed_ms, v_me, v_fr);
  else
    v_rank := public._game_rank(p_game, p_mode, v_akey, v_day, 2147483647, 0, v_me, v_fr);
    v_rank := jsonb_build_object('rank', null, 'total', (v_rank->>'total')::int);
  end if;

  return jsonb_build_object('rows', v_rows, 'total', v_rank->'total',
    'me', case when v_mine.user_id is null then null else jsonb_build_object(
      'rank', v_rank->'rank', 'score', v_mine.score, 'elapsed_ms', v_mine.elapsed_ms,
      'artist_label', v_mine.artist_label) end);
end $$;

-- Artists that have a board for this game, for the filter's search box.
create or replace function public.game_board_artists(p_game text, p_mode text, p_q text default '')
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', a.artist_key, 'label', a.label, 'players', a.n) order by a.n desc, a.label), '[]'::jsonb)
  from (
    select artist_key, max(artist_label) as label, count(*) as n
    from public.game_bests
    where game = p_game and mode = p_mode and day = -1 and artist_key <> '*'
      and (coalesce(p_q, '') = '' or artist_label ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    group by artist_key
    order by count(*) desc, max(artist_label)
    limit 12) a
$$;

revoke all on function public.game_score(text, text, jsonb, integer, uuid, integer) from public, anon, authenticated;
revoke all on function public._game_rank(text, text, text, integer, integer, integer, uuid, boolean) from public, anon, authenticated;
revoke all on function public._game_keep_best(public.game_runs, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.game_start(text, text, text, text, integer) from public, anon;
revoke all on function public.game_finish(uuid, jsonb) from public, anon;
grant execute on function public.game_start(text, text, text, text, integer) to authenticated;
grant execute on function public.game_finish(uuid, jsonb) to authenticated;
grant execute on function public.game_board(text, text, text, integer, boolean, integer) to anon, authenticated;
grant execute on function public.game_board_artists(text, text, text) to anon, authenticated;

-- ---- guards ------------------------------------------------------------------
do $$
begin
  -- The only ways in are game_start / game_finish. A write policy on either
  -- table would let a browser file its own score.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('game_runs','game_bests')
             and cmd in ('INSERT','UPDATE','DELETE','ALL')) then
    raise exception 'game_runs / game_bests must have no write policy';
  end if;
  -- Scoring sanity: a perfect, quick, large-pool Cover run, and the HL sum.
  if public.game_score('cover','artist','{"correct":5,"pool":40}', 7500, null, null) <> 6500 then
    raise exception 'cover ceiling moved';
  end if;
  if public.game_score('cover','artist','{"correct":0,"pool":40}', 8000, null, null) <> 0 then
    raise exception 'a wrong fast run must score nothing';
  end if;
  if public.game_score('higherlower','streams','{"streak":4}', 5000, null, null) <> 45 then  -- 10+10+10+15
    raise exception 'higher or lower points disagree with the client';
  end if;
  if public.game_score('drop','album','{"guesses":2,"solved":true}', 3600000, null, null) <> 5000 then
    raise exception 'drop scoring moved';
  end if;
end $$;
