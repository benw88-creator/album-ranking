-- The tutorial's Recall round gets a board of its own.
--
-- Every new account's first Recall round is the SAME song — "Memories" by David
-- Guetta (feat. Kid Cudi), Deezer track 5594020 — so it is the one score in the
-- app every player has against an identical question. It is kept apart from the
-- Endless and Daily boards on purpose: one round of one song is not a run, and
-- mixing it into Endless (where the tutorial used to be filed) put a one-song
-- score beside fifty-song runs.
--
-- One row per person, ever, and the FIRST attempt is the one kept. Misses are
-- recorded too (score 0): the board is "how everybody did on their first go",
-- and leaving the misses out would make every rank a flattering one.
--
--   recall_tutorial_start()   stamps the moment the first clip was played. Kept
--                             on conflict, so starting again never resets it.
--   recall_tutorial_submit()  judges the answer against the fixed title and
--                             scores it with recall_points(), on the SERVER'S
--                             clock: the elapsed time used is never less than
--                             the time the server itself saw pass since start
--                             (less 400ms for the round trip). A client can
--                             claim it was slower, never faster.
--   recall_tutorial_board()   the same shape as game_board, so the client's
--                             leaderboard sheet draws it unchanged.
--
-- No write policy on either table (guarded below). Both cascade from
-- auth.users, so account deletion needs no delete_my_data() entry.
-- Additive and idempotent: create ... if not exists / create or replace only.
-- No backfill: it records from launch, as asked.
--
-- Apply by hand, then record it:
--   supabase migration repair --status applied 20261029120000

create table if not exists public.recall_tutorial_runs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null default now()
);
alter table public.recall_tutorial_runs enable row level security;

create table if not exists public.recall_tutorial (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  score        integer not null default 0,
  correct      boolean not null default false,
  step         integer not null,             -- 0..3 = 1s / 3s / 5s / 10s heard
  attempts     integer not null default 1,
  elapsed_ms   integer not null,             -- as scored (server floor applied)
  server_ms    integer,                      -- what the server saw, for audit
  verified     boolean not null default true,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists recall_tutorial_board_idx
  on public.recall_tutorial (score desc, elapsed_ms asc, created_at asc);
alter table public.recall_tutorial enable row level security;
-- Scores are public, like every other board. Reads go through the board
-- function, which joins usernames; this policy only lets a player see rows.
drop policy if exists recall_tutorial_read on public.recall_tutorial;
create policy recall_tutorial_read on public.recall_tutorial for select using (true);

-- The fixed answer, in recall_norm form. One place, so the client constant
-- (Recall.TUTORIAL in index.html) has exactly one twin.
create or replace function public.recall_tutorial_answer()
returns text language sql immutable as $$ select 'memories'::text $$;

create or replace function public.recall_tutorial_start()
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me  uuid := auth.uid();
  v_row public.recall_tutorial;
  v_run public.recall_tutorial_runs;
begin
  if v_me is null then return jsonb_build_object('error', 'not_signed_in'); end if;
  select * into v_row from public.recall_tutorial where user_id = v_me;
  if v_row.user_id is not null then
    return jsonb_build_object('already', true, 'score', v_row.score, 'correct', v_row.correct);
  end if;
  insert into public.recall_tutorial_runs (user_id) values (v_me)
    on conflict (user_id) do nothing;
  select * into v_run from public.recall_tutorial_runs where user_id = v_me;
  return jsonb_build_object('started_at', v_run.started_at, 'now', now());
end $$;

create or replace function public._recall_tutorial_rank(p_score integer, p_ms integer, p_at timestamptz)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'rank', 1 + count(*) filter (where t.score > p_score
                                    or (t.score = p_score and t.elapsed_ms < p_ms)
                                    or (t.score = p_score and t.elapsed_ms = p_ms and t.created_at < p_at)),
    'total', count(*))
  from public.recall_tutorial t
$$;

create or replace function public.recall_tutorial_submit(
  p_guess text, p_step integer, p_attempts integer, p_elapsed_ms integer default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_run     public.recall_tutorial_runs;
  v_row     public.recall_tutorial;
  v_srv     integer;
  v_ms      integer;
  v_correct boolean;
  v_score   integer;
  v_ok      boolean := true;
  v_note    text;
  v_rank    jsonb;
begin
  if v_me is null then return jsonb_build_object('error', 'not_signed_in'); end if;

  select * into v_row from public.recall_tutorial where user_id = v_me;
  if v_row.user_id is not null then
    v_rank := public._recall_tutorial_rank(v_row.score, v_row.elapsed_ms, v_row.created_at);
    return jsonb_build_object('already', true, 'score', v_row.score, 'correct', v_row.correct,
      'step', v_row.step, 'elapsed_ms', v_row.elapsed_ms,
      'rank', v_rank->'rank', 'total', v_rank->'total');
  end if;

  -- No start, no score: a submission the server never saw begin cannot be timed.
  select * into v_run from public.recall_tutorial_runs where user_id = v_me;
  if v_run.user_id is null then return jsonb_build_object('error', 'not_started'); end if;

  p_step     := greatest(least(coalesce(p_step, 3), 3), 0);
  p_attempts := greatest(least(coalesce(p_attempts, 1), 8), 1);
  v_srv      := least(extract(epoch from (now() - v_run.started_at)) * 1000, 2000000000)::integer;
  v_ms       := greatest(coalesce(p_elapsed_ms, 0), v_srv - 400, 0);
  v_correct  := public.recall_norm(coalesce(p_guess, '')) = public.recall_tutorial_answer();

  -- Nobody names a song before its first second has played. A correct answer
  -- the server saw arrive inside that is filed, as a miss, and flagged.
  if v_correct and v_srv < 1000 then
    v_correct := false; v_ok := false; v_note := 'too fast';
  end if;

  v_score := case when v_correct then public.recall_points(p_step, v_ms) else 0 end;

  insert into public.recall_tutorial
    (user_id, score, correct, step, attempts, elapsed_ms, server_ms, verified, note)
  values (v_me, v_score, v_correct, p_step, p_attempts, v_ms, v_srv, v_ok, v_note)
  on conflict (user_id) do nothing
  returning * into v_row;
  if v_row.user_id is null then
    -- A second tab got there first; the first is the one that counts.
    select * into v_row from public.recall_tutorial where user_id = v_me;
  end if;

  v_rank := public._recall_tutorial_rank(v_row.score, v_row.elapsed_ms, v_row.created_at);
  return jsonb_build_object('already', false, 'score', v_row.score, 'correct', v_row.correct,
    'step', v_row.step, 'elapsed_ms', v_row.elapsed_ms, 'verified', v_row.verified,
    'rank', v_rank->'rank', 'total', v_rank->'total');
end $$;

-- Same shape as game_board, so the leaderboard sheet draws it with no special
-- case beyond the sub line. NULL auth.uid() is a signed-out reader: no friends
-- board and no "me", said explicitly rather than left to `user_id = NULL`.
create or replace function public.recall_tutorial_board(p_friends boolean default false, p_limit integer default 50)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := auth.uid();
  v_fr   boolean := coalesce(p_friends, false) and v_me is not null;
  v_rows jsonb;
  v_mine public.recall_tutorial;
  v_myrk integer;
  v_tot  integer;
begin
  if coalesce(p_friends, false) and v_me is null then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'me', null);
  end if;
  p_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  select coalesce(jsonb_agg(x order by x.rk), '[]'::jsonb) into v_rows from (
    select t.user_id, t.score, t.elapsed_ms, t.correct, t.step,
           case t.step when 0 then 1 when 1 then 3 when 2 then 5 else 10 end as heard,
           t.created_at as achieved_at, p.username, p.avatar_url,
           row_number() over (order by t.score desc, t.elapsed_ms asc, t.created_at asc) as rk
    from public.recall_tutorial t
    left join public.profiles p on p.id = t.user_id
    where (not v_fr or t.user_id = v_me
           or t.user_id in (select f.following_id from public.follows f where f.follower_id = v_me))
    order by t.score desc, t.elapsed_ms asc, t.created_at asc
    limit p_limit) x;

  select count(*) into v_tot from public.recall_tutorial t
    where (not v_fr or t.user_id = v_me
           or t.user_id in (select f.following_id from public.follows f where f.follower_id = v_me));

  if v_me is not null then select * into v_mine from public.recall_tutorial where user_id = v_me; end if;
  if v_mine.user_id is not null then
    select 1 + count(*) into v_myrk from public.recall_tutorial t
      where (t.score > v_mine.score or (t.score = v_mine.score and t.elapsed_ms < v_mine.elapsed_ms)
             or (t.score = v_mine.score and t.elapsed_ms = v_mine.elapsed_ms and t.created_at < v_mine.created_at))
        and (not v_fr or t.user_id = v_me
             or t.user_id in (select f.following_id from public.follows f where f.follower_id = v_me));
  end if;

  return jsonb_build_object('rows', v_rows, 'total', v_tot,
    'me', case when v_mine.user_id is null then null else jsonb_build_object(
      'rank', v_myrk, 'score', v_mine.score, 'elapsed_ms', v_mine.elapsed_ms,
      'correct', v_mine.correct, 'step', v_mine.step) end);
end $$;

revoke all on function public._recall_tutorial_rank(integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.recall_tutorial_start() from public, anon;
revoke all on function public.recall_tutorial_submit(text, integer, integer, integer) from public, anon;
grant execute on function public.recall_tutorial_start() to authenticated;
grant execute on function public.recall_tutorial_submit(text, integer, integer, integer) to authenticated;
grant execute on function public.recall_tutorial_board(boolean, integer) to anon, authenticated;

do $$
begin
  -- The only ways in are the definer functions. A write policy would let a
  -- browser file its own score.
  if exists (select 1 from pg_policies where schemaname = 'public'
             and tablename in ('recall_tutorial', 'recall_tutorial_runs')
             and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')) then
    raise exception 'recall_tutorial tables must have no write policy';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'recall_tutorial_runs') then
    raise exception 'recall_tutorial_runs must have no policy at all';
  end if;
  -- The answer has to survive the spellings the client accepts as exact.
  if public.recall_norm('Memories (feat. Kid Cudi)') <> public.recall_tutorial_answer()
     or public.recall_norm('memories') <> public.recall_tutorial_answer() then
    raise exception 'recall_tutorial_answer disagrees with recall_norm';
  end if;
end $$;
