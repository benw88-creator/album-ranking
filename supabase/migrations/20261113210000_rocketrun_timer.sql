-- RocketRun: 30 seconds a question, owned by the server.
--
-- A question's clock starts the first time it is opened (rr_open_q) and is
-- never restarted by a refresh, a reconnect or a second device. An answer is
-- judged on when the REQUEST ARRIVED (p_received, stamped by /api/rocketrun
-- before any MusicBrainz lookup), so slow validation never costs a player who
-- answered in time. 2.5s of grace covers the network. A question left open
-- past its deadline is passed for 0 m the next time anything touches the run.
--
-- rr_answers.timed_out marks those passes, so the recap can say "Out of time"
-- rather than "Passed". Idempotent.

alter table public.rr_runs    add column if not exists q_open    smallint;
alter table public.rr_runs    add column if not exists q_open_at timestamptz;
alter table public.rr_answers add column if not exists timed_out boolean not null default false;

create or replace function public.rr_limit_ms() returns integer language sql immutable as $$ select 30000 $$;
create or replace function public.rr_grace_ms() returns integer language sql immutable as $$ select 2500 $$;

-- Pass the open question if its time is up. Returns the rr_submit result when
-- it passed one, else null. Caller holds no lock; rr_submit takes the row lock.
create or replace function public.rr_expire(p_user uuid, p_day integer, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rr_runs; v_next integer; v jsonb;
begin
  select * into r from public.rr_runs where user_id = p_user and day = p_day;
  if r.user_id is null or r.finished_at is not null or r.q_open is null then return null; end if;
  select count(*) into v_next from public.rr_answers where user_id = p_user and day = p_day;
  if r.q_open <> v_next then return null; end if;
  if p_at <= r.q_open_at + make_interval(secs => (public.rr_limit_ms() + public.rr_grace_ms()) / 1000.0) then return null; end if;
  v := public.rr_submit(p_user, p_day, v_next, null, null, null, null);
  if (v ->> 'ok')::boolean then
    update public.rr_answers set timed_out = true where user_id = p_user and day = p_day and q = v_next;
    v := v || jsonb_build_object('timeout', true);
  end if;
  return v;
end $$;

-- Open question p_q. First call starts its clock; later calls return what is
-- left. -> {ok, q, remaining_ms} or {ok:false, reason} or a timeout pass.
create or replace function public.rr_open_q(p_user uuid, p_day integer, p_q integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rr_runs; v_next integer; v jsonb;
begin
  if not public.rr_open(p_day) then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  insert into public.rr_runs (user_id, day) values (p_user, p_day) on conflict do nothing;
  v := public.rr_expire(p_user, p_day, now());
  if v is not null then return jsonb_build_object('ok', false, 'reason', 'timeout', 'passed', v); end if;
  select * into r from public.rr_runs where user_id = p_user and day = p_day for update;
  if r.finished_at is not null then return jsonb_build_object('ok', false, 'reason', 'finished'); end if;
  select count(*) into v_next from public.rr_answers where user_id = p_user and day = p_day;
  if p_q <> v_next then return jsonb_build_object('ok', false, 'reason', 'order', 'next', v_next); end if;
  if r.q_open is distinct from p_q then
    update public.rr_runs set q_open = p_q, q_open_at = now() where user_id = p_user and day = p_day returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'q', p_q,
    'remaining_ms', greatest(0, public.rr_limit_ms() - (extract(epoch from (now() - r.q_open_at)) * 1000)::int));
end $$;

-- rr_attempt plus the clock. p_received is when the request reached the route.
create or replace function public.rr_attempt_q(p_user uuid, p_day integer, p_q integer, p_received timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a jsonb; r public.rr_runs; v jsonb;
begin
  a := public.rr_attempt(p_user, p_day);
  if not (a ->> 'ok')::boolean then return a; end if;
  if (a ->> 'next')::int <> p_q then return a; end if;
  select * into r from public.rr_runs where user_id = p_user and day = p_day;
  if r.q_open is distinct from p_q then
    -- Never opened (an old client): its clock starts now.
    update public.rr_runs set q_open = p_q, q_open_at = p_received where user_id = p_user and day = p_day;
    return a;
  end if;
  v := public.rr_expire(p_user, p_day, p_received);
  if v is not null then return jsonb_build_object('ok', false, 'reason', 'timeout', 'passed', v); end if;
  return a;
end $$;

-- A pass. Marked as out of time if the clock had run out when it arrived.
create or replace function public.rr_pass(p_user uuid, p_day integer, p_q integer, p_received timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rr_runs; v jsonb; v_late boolean;
begin
  select * into r from public.rr_runs where user_id = p_user and day = p_day;
  v_late := r.q_open = p_q and p_received >= r.q_open_at + make_interval(secs => public.rr_limit_ms() / 1000.0 - 1);
  v := public.rr_submit(p_user, p_day, p_q, null, null, null, null);
  if (v ->> 'ok')::boolean and v_late then
    update public.rr_answers set timed_out = true where user_id = p_user and day = p_day and q = p_q;
    v := v || jsonb_build_object('timeout', true);
  end if;
  return v;
end $$;

-- State, after expiring anything left open. Adds `open` {q, remaining_ms}.
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
    'limit_ms', public.rr_limit_ms(),
    'open', case when r.finished_at is null and r.q_open is not null
                  and r.q_open = (select count(*) from public.rr_answers a where a.user_id = p_user and a.day = p_day)
             then jsonb_build_object('q', r.q_open,
               'remaining_ms', greatest(0, public.rr_limit_ms() - (extract(epoch from (now() - r.q_open_at)) * 1000)::int)) end,
    'answers', coalesce((select jsonb_agg(jsonb_build_object('q', a.q, 'key', a.key, 'label', a.label, 'sub', a.sub,
        'grade', a.grade, 'gain', a.gain, 'pct', a.pct, 'sample', a.sample, 'timeout', a.timed_out) order by a.q)
      from public.rr_answers a where a.user_id = p_user and a.day = p_day), '[]'::jsonb))
  from (select 1) one
  left join public.rr_runs r on r.user_id = p_user and r.day = p_day
$$;

-- Warm lookups (the answer list's background fetch) spend attempts too, so
-- the ceiling moves from 80 to 150 a day.
create or replace function public.rr_attempt(p_user uuid, p_day integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.rr_runs;
begin
  if not public.rr_open(p_day) then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  insert into public.rr_runs (user_id, day) values (p_user, p_day) on conflict do nothing;
  update public.rr_runs set attempts = attempts + 1 where user_id = p_user and day = p_day returning * into r;
  if r.finished_at is not null then return jsonb_build_object('ok', false, 'reason', 'finished'); end if;
  if r.attempts > 150 then return jsonb_build_object('ok', false, 'reason', 'attempts'); end if;
  return jsonb_build_object('ok', true, 'next', (select count(*) from public.rr_answers where user_id = p_user and day = p_day));
end $$;

do $$ declare f text; begin
  foreach f in array array['rr_expire(uuid, integer, timestamptz)', 'rr_open_q(uuid, integer, integer)',
    'rr_attempt_q(uuid, integer, integer, timestamptz)', 'rr_pass(uuid, integer, integer, timestamptz)',
    'rr_state(uuid, integer)', 'rr_attempt(uuid, integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  if has_function_privilege('authenticated', 'public.rr_open_q(uuid, integer, integer)', 'execute') then
    raise exception 'rocketrun: rr_open_q is callable by authenticated';
  end if;
end $$;
