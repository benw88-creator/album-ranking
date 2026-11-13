-- RocketRun: five daily prompts answered from the whole MusicBrainz catalogue.
--
-- /api/rocketrun verifies the caller's JWT, looks the answer up on MusicBrainz,
-- checks it against the prompt (assets/rocketrun-rules.js) and only then calls
-- rr_submit as the service role. Nothing here is callable by a browser, and no
-- table has a write policy: the score, the rarity and the payout are decided
-- in this file and nowhere else.
--
-- Rarity is the share of OTHER players who gave the same answer to the same
-- prompt that day, smoothed toward a prior from MusicBrainz rating votes so the
-- first players of a day are graded sensibly (cold start). It is frozen at the
-- moment of answering. Idempotent: create if not exists / create or replace.

create table if not exists public.rr_days (
  day        integer primary key,
  questions  jsonb   not null,
  version    integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.rr_runs (
  user_id     uuid    not null references auth.users(id) on delete cascade,
  day         integer not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  total       integer not null default 0,
  attempts    integer not null default 0,
  awarded     integer not null default 0,
  primary key (user_id, day)
);

create table if not exists public.rr_answers (
  user_id    uuid     not null references auth.users(id) on delete cascade,
  day        integer  not null,
  q          smallint not null check (q between 0 and 4),
  key        text,                       -- 'rg:<mbid>' | 'ar:<mbid>'; null = passed
  label      text,
  sub        text,
  grade      smallint not null,          -- -1 passed, 0..4
  gain       integer  not null,
  pct        numeric(7,4),               -- smoothed share of other players, 0..100
  sample     integer  not null default 0,-- other players on this prompt at the time
  created_at timestamptz not null default now(),
  primary key (user_id, day, q)
);
create index if not exists rr_answers_rarity on public.rr_answers (day, q, key);
create unique index if not exists rr_answers_once on public.rr_answers (user_id, day, key) where key is not null;

-- MusicBrainz facts already looked up, so a popular answer costs one fetch ever.
create table if not exists public.rr_entities (
  id         text primary key,           -- 'rg:<mbid>' | 'ar:<mbid>'
  facts      jsonb not null,
  fetched_at timestamptz not null default now()
);

-- "I couldn't find it": a record of what the catalogue is missing.
create table if not exists public.rr_missing (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        integer not null,
  q          smallint not null,
  text       text not null check (char_length(text) between 1 and 120),
  created_at timestamptz not null default now()
);

alter table public.rr_days     enable row level security;
alter table public.rr_runs     enable row level security;
alter table public.rr_answers  enable row level security;
alter table public.rr_entities enable row level security;
alter table public.rr_missing  enable row level security;

drop policy if exists rr_days_read on public.rr_days;
create policy rr_days_read on public.rr_days for select
  using (day <= floor(extract(epoch from now()) / 86400)::int - 18262);   -- never a future day
drop policy if exists rr_runs_own on public.rr_runs;
create policy rr_runs_own on public.rr_runs for select using ((select auth.uid()) = user_id);
drop policy if exists rr_answers_own on public.rr_answers;
create policy rr_answers_own on public.rr_answers for select using ((select auth.uid()) = user_id);
-- rr_entities and rr_missing: RLS on, no policies.

create or replace function public.rr_today() returns integer language sql stable as $$
  select (floor(extract(epoch from now()) / 86400))::int - 18262   -- days since 2020-01-01 UTC
$$;

-- Distance for a smoothed pick rate. GRADES in assets/rocketrun-rules.js mirrors it.
create or replace function public.rr_grade(p numeric) returns smallint language sql immutable as $$
  select (case when p >= 0.15 then 0 when p >= 0.05 then 1 when p >= 0.015 then 2 when p >= 0.004 then 3 else 4 end)::smallint
$$;
create or replace function public.rr_gain(g smallint) returns integer language sql immutable as $$
  select (array[500, 1200, 2500, 5000, 9000])[g + 1]
$$;
-- Cold-start prior: an answer nobody has rated on MusicBrainz is a deep cut,
-- one with 90 votes (OK Computer) is a classic.
create or replace function public.rr_prior(votes integer) returns numeric language sql immutable as $$
  select least(0.25, 0.006 + 0.025 * ln(1 + greatest(coalesce(votes, 0), 0)))::numeric
$$;

create or replace function public.rr_day_put(p_day integer, p_questions jsonb, p_version integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if p_day > public.rr_today() + 1 then raise exception 'future day'; end if;
  insert into public.rr_days (day, questions, version) values (p_day, p_questions, p_version)
    on conflict (day) do nothing;
  select questions into v from public.rr_days where day = p_day;
  return v;
end $$;

-- A day's run may still be answered until 26h after it opened, so a UK
-- player starting at 23:55 is not cut off at midnight.
create or replace function public.rr_open(p_day integer) returns boolean language sql stable as $$
  select p_day = public.rr_today() or (p_day = public.rr_today() - 1 and extract(hour from now() at time zone 'utc') < 2)
$$;

-- Every answer request spends an attempt BEFORE the MusicBrainz lookup, so a
-- script cannot make the route hammer MusicBrainz on our behalf.
create or replace function public.rr_attempt(p_user uuid, p_day integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rr_runs;
begin
  if not public.rr_open(p_day) then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  insert into public.rr_runs (user_id, day) values (p_user, p_day) on conflict do nothing;
  update public.rr_runs set attempts = attempts + 1 where user_id = p_user and day = p_day returning * into r;
  if r.finished_at is not null then return jsonb_build_object('ok', false, 'reason', 'finished'); end if;
  if r.attempts > 80 then return jsonb_build_object('ok', false, 'reason', 'attempts'); end if;
  return jsonb_build_object('ok', true, 'next', (select count(*) from public.rr_answers where user_id = p_user and day = p_day));
end $$;

create or replace function public.rr_streak(p_user uuid) returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d integer := public.rr_today(); n integer := 0;
begin
  if not exists (select 1 from public.rr_runs where user_id = p_user and day = d and finished_at is not null) then d := d - 1; end if;
  while exists (select 1 from public.rr_runs where user_id = p_user and day = d and finished_at is not null) loop
    n := n + 1; d := d - 1;
  end loop;
  return n;
end $$;

create or replace function public.rr_state(p_user uuid, p_day integer)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'day', p_day,
    'started', r.user_id is not null,
    'finished', r.finished_at is not null,
    'total', coalesce(r.total, 0),
    'awarded', coalesce(r.awarded, 0),
    'streak', public.rr_streak(p_user),
    'best', (select max(total) from public.rr_runs where user_id = p_user and finished_at is not null),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('q', a.q, 'key', a.key, 'label', a.label, 'sub', a.sub,
        'grade', a.grade, 'gain', a.gain, 'pct', a.pct, 'sample', a.sample) order by a.q)
      from public.rr_answers a where a.user_id = p_user and a.day = p_day), '[]'::jsonb))
  from (select 1) one
  left join public.rr_runs r on r.user_id = p_user and r.day = p_day
$$;

-- The one writer. p_key null = pass (0 m). Answers are taken in order, once
-- each, never repeated within a run; the fifth closes the run, files the
-- leaderboard rows and pays once a day.
create or replace function public.rr_submit(p_user uuid, p_day integer, p_q integer, p_key text,
                                            p_label text, p_sub text, p_votes integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.rr_runs;
  v_next integer; v_n integer; v_c integer; v_p numeric; v_g smallint; v_gain integer;
  v_ms integer; v_award integer := 0; v_used integer; pr public.profiles; v_today date := (now() at time zone 'utc')::date;
begin
  if not public.rr_open(p_day) then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if not exists (select 1 from public.rr_days where day = p_day) then return jsonb_build_object('ok', false, 'reason', 'no_day'); end if;
  insert into public.rr_runs (user_id, day) values (p_user, p_day) on conflict do nothing;
  select * into r from public.rr_runs where user_id = p_user and day = p_day for update;
  if r.finished_at is not null then return jsonb_build_object('ok', false, 'reason', 'finished'); end if;

  select count(*) into v_next from public.rr_answers where user_id = p_user and day = p_day;
  if p_q <> v_next then return jsonb_build_object('ok', false, 'reason', 'order', 'next', v_next); end if;
  if p_key is not null and exists (select 1 from public.rr_answers where user_id = p_user and day = p_day and key = p_key) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  if p_key is null then
    v_g := -1; v_gain := 0; v_p := null; v_n := 0;
  else
    select count(*), count(*) filter (where key = p_key) into v_n, v_c
      from public.rr_answers where day = p_day and q = p_q and key is not null and user_id <> p_user;
    v_p := (v_c + 20 * public.rr_prior(p_votes)) / (v_n + 20);
    v_g := public.rr_grade(v_p);
    v_gain := public.rr_gain(v_g);
  end if;

  insert into public.rr_answers (user_id, day, q, key, label, sub, grade, gain, pct, sample)
    values (p_user, p_day, p_q, p_key, left(p_label, 200), left(p_sub, 200), v_g, v_gain, round(v_p * 100, 4), v_n);
  update public.rr_runs set total = total + v_gain where user_id = p_user and day = p_day returning * into r;

  if p_q = 4 then
    v_ms := least(2147483647, greatest(0, (extract(epoch from (now() - r.started_at)) * 1000)::bigint))::int;
    -- One Disc payout a day, through the same counter every game uses, so the
    -- "Play a minigame" mission and games_completed both see it.
    select * into pr from public.profiles where id = p_user for update;
    if pr.id is not null then
      if pr.game_awards_date is distinct from v_today then pr.game_awards := '{}'::jsonb; end if;
      v_used := coalesce((pr.game_awards ->> 'rocketrun')::integer, 0);
      if v_used < 1 then
        v_award := 1600;
        update public.profiles set discs = coalesce(discs, 0) + v_award, game_awards_date = v_today,
          game_awards = coalesce(pr.game_awards, '{}'::jsonb) || jsonb_build_object('rocketrun', v_used + 1)
        where id = p_user;
      end if;
    end if;
    update public.rr_runs set finished_at = now(), awarded = v_award where user_id = p_user and day = p_day returning * into r;

    insert into public.game_bests (game, mode, artist_key, day, user_id, score, elapsed_ms, achieved_at)
      values ('rocketrun', 'daily', '*', p_day, p_user, r.total, v_ms, now())
      on conflict (game, mode, artist_key, day, user_id) do nothing;
    insert into public.game_bests (game, mode, artist_key, day, user_id, score, elapsed_ms, achieved_at)
      values ('rocketrun', 'daily', '*', -1, p_user, r.total, v_ms, now())
      on conflict (game, mode, artist_key, day, user_id) do update
        set score = excluded.score, elapsed_ms = excluded.elapsed_ms, achieved_at = excluded.achieved_at
        where excluded.score > public.game_bests.score;
  end if;

  return jsonb_build_object('ok', true, 'q', p_q, 'grade', v_g, 'gain', v_gain,
    'pct', round(v_p * 100, 2), 'sample', v_n, 'total', r.total,
    'finished', r.finished_at is not null, 'award', v_award,
    'streak', case when r.finished_at is not null then public.rr_streak(p_user) end);
end $$;

create or replace function public.rr_report_missing(p_user uuid, p_day integer, p_q integer, p_text text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from public.rr_missing where user_id = p_user and day = p_day) >= 10 then return false; end if;
  insert into public.rr_missing (user_id, day, q, text) values (p_user, p_day, p_q, left(btrim(p_text), 120));
  return true;
end $$;

do $$ declare f text; begin
  foreach f in array array['rr_day_put(integer, jsonb, integer)', 'rr_attempt(uuid, integer)', 'rr_streak(uuid)',
    'rr_state(uuid, integer)', 'rr_submit(uuid, integer, integer, text, text, text, integer)',
    'rr_report_missing(uuid, integer, integer, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Guards: no browser may write these tables or call the writers.
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename like 'rr\_%' and cmd <> 'SELECT') then
    raise exception 'rocketrun: a write policy exists on an rr_ table';
  end if;
  if has_function_privilege('authenticated', 'public.rr_submit(uuid, integer, integer, text, text, text, integer)', 'execute') then
    raise exception 'rocketrun: rr_submit is callable by authenticated';
  end if;
  if public.rr_gain(0::smallint) <> 500 or public.rr_gain(4::smallint) <> 9000 then raise exception 'rocketrun: gains moved; update GRADES'; end if;
end $$;
